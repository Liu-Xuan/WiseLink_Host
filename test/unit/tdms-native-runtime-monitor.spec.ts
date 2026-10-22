import { adaptJobAidWorkingRead, savedNativeObservations } from '../../client/src/pages/DocumentParsingPage/runtime-monitor/adapt-jobaid-working-read';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
import { tdmsNativeEvidenceFixture } from './fixtures/tdms-native-evidence.fixture';

const context = { observedAt: '2026-10-23T12:00:00Z', environment: 'test-only saved source', scopeKey: '1:work-item-test', label: 'test', mode: 'snapshot' as const };
function readWithNative() {
  const read = jobAidReadingFixture();
  read.current!.content.evidence = [tdmsNativeEvidenceFixture()];
  read.current!.createdAt = '2026-10-04T10:00:00Z';
  return read;
}

it('projects the exact saved source version and historical receipt into its enclosing saved work', () => {
  const read = readWithNative();
  const evidence = tdmsNativeEvidenceFixture();
  const runtime = adaptJobAidWorkingRead(read, context)!;
  const node = runtime.nodes.find(item => item.id === 'business.company_records')!;
  const edge = runtime.edges.find(item => item.from === node.id)!;
  expect(node.kind).toBe('fact');
  expect(node.requests).toEqual([]);
  expect(node.sourceObservedAt).toBeUndefined();
  expect(node.coverage).toEqual({ label: expect.stringContaining('UNKNOWN'), tone: 'wait' });
  expect(node.outputs).toEqual([{ label: '保存这些证据的工作 3', ref: read.current!.workRevisionRef }]);
  expect(edge).toMatchObject({ from: node.id, to: 'assessment.research', templateId: 'company.research', status: 'consumed',
    refs: [evidence.nativeSource.sourceRevisionRef, evidence.nativeReadReceipt.receiptRef, evidence.evidenceRef, read.current!.workRevisionRef] });
  expect(edge.label).toContain(evidence.nativeReadReceipt.readAt);
  expect(edge.label).toContain('R00');
  expect(edge.label).toContain('迭代 2');
  expect(edge.label).not.toContain(context.observedAt);
  expect(runtime.meta.observedAt).toBe(context.observedAt);
  expect(runtime.nodes.find(item => item.id === 'assessment.research')!.inputRefs).toContainEqual({ label: expect.any(String), ref: node.inputRefs[0].ref });
});

it('does not promote a selected source or metadata-only work to a READ relationship', () => {
  const read = jobAidReadingFixture();
  read.current!.content.evidence = [];
  const selectedMetadata = { ...read, selectedNativeSourceRevisionRef: 'selected-but-never-read' };
  const runtime = adaptJobAidWorkingRead(selectedMetadata, context)!;
  expect(runtime.edges.filter(item => item.from === 'business.company_records')).toEqual([]);
  const node = runtime.nodes.find(item => item.id === 'business.company_records')!;
  expect(node.inputRefs).toEqual([]);
  expect(node.business).toBe('未取得可核对的来源证据；工程采用与执行情况未提供');
  expect(node.summary).toContain('不能据此断言从未读取');
  const { content: _content, ...metadata } = read.current!;
  expect(savedNativeObservations(metadata)).toEqual({ observations: [], gaps: [] });
});

it.each(['receipt', 'approval', 'version'] as const)('reports an incomplete %s carrier without inventing a source READ', field => {
  const read = readWithNative();
  const evidence = tdmsNativeEvidenceFixture();
  if (field === 'receipt') evidence.nativeReadReceipt.readPerformed = false as unknown as true;
  if (field === 'approval') evidence.nativeSource.state = { rawCode: 'Pending', rawName: 'Pending' };
  if (field === 'version') evidence.nativeScope.approval.approvalSubject.sourceVersion.rawIteration = '99';
  read.current!.content.evidence = [evidence];
  const runtime = adaptJobAidWorkingRead(read, context)!;
  expect(runtime.edges.some(item => item.from === 'business.company_records')).toBe(false);
  expect(runtime.nodes.find(item => item.id === 'business.company_records')!.summary).toContain('未建立读取关系');
  expect(savedNativeObservations(read.current).observations).toEqual([]);
});

it('keeps two real receipts for one evidence distinct and rejects ambiguous duplicate identities', () => {
  const read = readWithNative();
  const second = tdmsNativeEvidenceFixture();
  second.nativeReadReceipt.receiptRef = 'native-receipt-2';
  read.current!.content.evidence.push(second);
  const saved = savedNativeObservations(read.current);
  expect(saved.observations).toHaveLength(2);
  expect(new Set(saved.observations.map(item => item.navigationRef)).size).toBe(2);
  const conflicting = tdmsNativeEvidenceFixture();
  conflicting.excerpt = 'A conflicting body must not win by array position';
  read.current!.content.evidence.push(conflicting);
  const ambiguous = savedNativeObservations(read.current);
  expect(ambiguous.observations.map(item => item.evidence.nativeReadReceipt.receiptRef)).toEqual(['native-receipt-2']);
  expect(ambiguous.gaps).toEqual(['同一保存证据与回执出现重复，未建立该读取关系']);
});

it('connects current native evidence to Overall only through the exact consumed saved work', () => {
  const read = readWithNative();
  let runtime = adaptJobAidWorkingRead(read, context)!;
  expect(runtime.edges.find(item => item.templateId === 'research.overall')).toMatchObject({ status: 'unknown', refs: ['work-before-test'] });
  expect(runtime.edges.find(item => item.templateId === 'change.work')).toMatchObject({ status: 'pending', refs: ['work-current-test'] });
  expect(runtime.edges.some(item => item.from === 'business.company_records' && item.to === 'assessment.overall')).toBe(false);
  read.overallBasedOnWorkRevisionRef = read.current!.workRevisionRef;
  read.overallStatus = 'CURRENT';
  runtime = adaptJobAidWorkingRead(read, context)!;
  expect(runtime.edges.find(item => item.templateId === 'research.overall')).toMatchObject({ status: 'consumed', refs: ['work-current-test'] });
  expect(runtime.edges.some(item => item.templateId === 'change.work')).toBe(false);
});
