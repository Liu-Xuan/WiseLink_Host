import type { AssessmentEvidence } from '../../shared/assessment-reading.interface';
import type { TdmsExactEndpoint, TdmsRecordSummary, TdmsRelationAssertion, TdmsRelationReadResponse } from '../../shared/tdms-source.interface';
import { appendSuiteTdmsSources } from '../../client/src/pages/RelationGraphPage/suite-tdms-source-projection';
import type { SuiteMatterGraphRead } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import { buildSuiteGraphPresentation } from '../../client/src/pages/RelationGraphPage/suite-graph-presentation';

function record(ref = 'native-v1', extra: Partial<TdmsRecordSummary> = {}): TdmsRecordSummary {
  return {
    recordRef: 'record-1', sourceRevisionRef: ref, recordKind: 'ENGINEER_ASSESSMENT', sourceRecordId: 'assessment-1',
    sourceKey: 'TDMS', sourceInstanceId: 'instance', title: '同名评估', fileType: null,
    sourceVersion: { rawRevision: null, rawIteration: null, confirmation: 'VERSION_UNCONFIRMED' },
    businessVersion: { rawRevision: 'B', rawIteration: null, confirmation: 'SOURCE_DECLARED' },
    state: { rawCode: 'Draft', rawName: '草稿' }, authors: [], observedAt: '2026-10-01T10:00:00Z', capturedAt: '2026-10-02T10:00:00Z',
    coverage: { status: 'PARTIAL', gaps: ['history unknown'], readback: 'NOT_VERIFIED' }, relatedDocumentVersionIds: [],
    fieldSelectors: [], sourceVerification: 'DECLARED_ONLY', currentness: 'SELECTED_HOST_OBSERVATION', ...extra,
  };
}
const native = (ref = 'native-v1'): TdmsExactEndpoint => ({ kind: 'NATIVE_RECORD_REVISION', sourceRevisionRef: ref });
const document = (ref = 'dv-1'): TdmsExactEndpoint => ({ kind: 'DOCUMENT_VERSION', documentVersionId: ref });
function assertion(ref = 'a-1', extra: Partial<TdmsRelationAssertion> = {}): TdmsRelationAssertion {
  return {
    assertionRef: ref, relationRef: `rel-${ref}`, sourceRelationId: `source-${ref}`, captureRef: 'capture-1',
    rawKind: 'assesses', controlledKind: 'REFERENCES', from: native(), to: document(),
    authority: 'SOURCE_EXPLICIT', selector: '/relationship/1', observedAt: '2026-10-01T10:00:00Z',
    coverage: { status: 'PARTIAL', gaps: ['scope unknown'], readback: 'NOT_VERIFIED' }, scope: {},
    completionEffect: 'UNSPECIFIED', changeClass: 'UNSPECIFIED', rawFields: {}, sourceVerification: 'DECLARED_ONLY', selectedHead: true, ...extra,
  };
}
function reading(relations: TdmsRelationAssertion[], ref = 'native-v1'): TdmsRelationReadResponse {
  return {
    sourceRevisionRef: ref, relations, limitations: ['来源声明未独立核验'],
    receipt: { receiptRef: 'receipt-1', sourceRevisionRef: ref, readAt: '2026-10-03T10:00:00Z',
      purpose: 'WIKI_NATIVE_RELATIONS', fieldPaths: null, taskContextRef: null, readPerformed: true,
      permissionRevision: 'membership-revision-1', engineeringAdoption: 'NOT_CREATED', executionVerified: false },
  };
}
function base(): SuiteMatterGraphRead {
  return {
    graph: { id: 'matter-1', title: 'Matter', rootKind: 'matter', groups: [{ key: 'MEMBER', title: '资料', items: [{ id: 'doc-node', title: 'Doc' }] }],
      relations: [{ id: 'member-1', source: 'matter-1', target: 'doc-node', type: 'MEMBER', label: '事项资料' }] },
    targets: new Map([['doc-node', { kind: 'document', documentVersionId: 'dv-1', familyId: 'family-1' }]]),
    relationDetails: new Map(), notices: [], workRef: 'work-1', historical: false, overviewStatus: null, missingEvidenceRefs: [],
  };
}
function savedEvidence(ref = 'native-v1'): Extract<AssessmentEvidence, {kind: 'TDMS_NATIVE_RECORD'}> {
  return { kind: 'TDMS_NATIVE_RECORD', evidenceRef: 'evidence-1', title: 'Saved source', excerpt: '', versionLabel: 'B', nativeSource: record(ref),
    nativeReadReceipt: { ...reading([], ref).receipt, purpose: 'JOB_AID_NATIVE_RECORD', taskContextRef: 'task-1', fieldPaths: ['content.opinions'] } };
}
function withEvidence(evidence = savedEvidence(), historical = false): SuiteMatterGraphRead {
  const read = base();
  read.historical = historical;
  read.graph.groups.push({ key: 'evidence', title: '保存依据', items: [{ id: 'evidence-node', title: 'Saved evidence' }] });
  read.targets.set('evidence-node', { kind: 'evidence', evidence, workRef: 'work-1' });
  return read;
}
function nativeTargets(read: SuiteMatterGraphRead) { return [...read.targets.values()].filter(target => target.kind === 'tdms-record'); }
function tdmsEdges(read: SuiteMatterGraphRead) { return read.graph.relations.filter(edge => edge.type.startsWith('TDMS_')); }

describe('TDMS projection into the existing Suite graph data model', () => {
  it('does not turn catalogue/context visibility, title or timestamps into a matter relation', () => {
    const read = base();
    const result = appendSuiteTdmsSources(read, { records: [record()], relations: [] });
    expect(result).toBe(read);
    expect(nativeTargets(result)).toHaveLength(0);
    expect(tdmsEdges(result)).toHaveLength(0);
  });
  it('retains original root/nodes/relations and connects only an actual exact document binding', () => {
    const read = base();
    const before = JSON.stringify({ ...read, targets: [...read.targets], relationDetails: [...read.relationDetails] });
    const item = record('native-v1', { relatedDocumentVersionIds: ['dv-1', 'dv-missing', 'dv-1'] });
    const result = appendSuiteTdmsSources(read, { records: [item], relations: [] });
    expect(JSON.stringify({ ...read, targets: [...read.targets], relationDetails: [...read.relationDetails] })).toBe(before);
    expect(result.graph.id).toBe(read.graph.id);
    expect(result.graph.relations[0]).toBe(read.graph.relations[0]);
    expect(result.relationDetails).toBe(read.relationDetails);
    expect(tdmsEdges(result)).toHaveLength(1);
    expect(tdmsEdges(result)[0]).toMatchObject({ source: 'doc-node', type: 'TDMS_DOCUMENT_BINDING', authority: 'HOST_RECORDED', currentness: 'UNKNOWN' });
    expect(tdmsEdges(result).some(edge => edge.source === 'matter-1')).toBe(false);
    expect([...result.tdmsRelationDetails!.values()][0]).toEqual({ kind: 'TDMS_DOCUMENT_BINDING', sourceRevisionRef: 'native-v1', documentVersionId: 'dv-1' });
  });
  it('does not accept a document target detached from actual graph nodes', () => {
    const read = base(); read.graph.groups = [];
    expect(appendSuiteTdmsSources(read, { records: [record('native-v1', { relatedDocumentVersionIds: ['dv-1'] })], relations: [] })).toBe(read);
  });
  it('uses exact refs, retaining separate observations of the same titled record', () => {
    const result = appendSuiteTdmsSources(base(), { records: [record('native-v1', { relatedDocumentVersionIds: ['dv-1'] }), record('native-v2', { relatedDocumentVersionIds: ['dv-1'] })], relations: [] });
    expect(nativeTargets(result).map(target => target.sourceRevisionRef)).toEqual(['native-v1', 'native-v2']);
    expect(result.graph.groups.find(group => group.key === 'tdms:ENGINEER_ASSESSMENT')?.items).toHaveLength(2);
  });
  it('rejects conflicting metadata for a single immutable ref instead of choosing by arrival order', () => {
    expect(() => appendSuiteTdmsSources(base(), { records: [record(), record('native-v1', { title: 'conflict' })], relations: [] })).toThrow('冲突元数据');
  });
  it('allowlists draft metadata, preserving gaps and business/technical version separation', () => {
    const full = { ...record('native-v1', { relatedDocumentVersionIds: ['dv-1'] }), content: { opinions: [{text: 'DO_NOT_LEAK'}], sourceEvents: [{rawKind: 'Executed'}] }, rawFields: { hidden: 'DO_NOT_LEAK' }, artifacts: [{documentVersionId: 'not-an-opening-grant'}], selectedFields: [{value: 'DO_NOT_LEAK'}] };
    const result = appendSuiteTdmsSources(base(), { records: [full], relations: [] });
    const projected = nativeTargets(result)[0].record;
    expect(projected).toEqual(record('native-v1', { relatedDocumentVersionIds: ['dv-1'] }));
    expect(JSON.stringify([...result.targets])).not.toContain('DO_NOT_LEAK');
    expect(projected?.sourceVersion).toMatchObject({ rawRevision: null, rawIteration: null, confirmation: 'VERSION_UNCONFIRMED' });
    expect(projected?.businessVersion?.rawRevision).toBe('B');
    expect(projected?.coverage).toEqual(full.coverage);
    expect(projected?.sourceKey).toBe('TDMS');
    expect(tdmsEdges(result)).toHaveLength(1);
    expect(result.graph.groups.some(group => group.key === 'statements')).toBe(false);
  });
  it('uses receipt-bound saved evidence without manufacturing a new read receipt', () => {
    const evidence = savedEvidence(); const read = withEvidence(evidence);
    const result = appendSuiteTdmsSources(read, { records: [], relations: [] });
    expect(tdmsEdges(result)[0]).toMatchObject({ source: 'evidence-node', authority: 'HOST_RECORDED', currentness: 'UNKNOWN' });
    expect(result.targets.get('evidence-node')).toBe(read.targets.get('evidence-node'));
    expect([...result.tdmsRelationDetails!.values()][0]).toEqual({ kind: 'TDMS_SAVED_EVIDENCE', sourceRevisionRef: 'native-v1', evidenceRef: 'evidence-1', workRef: 'work-1' });
    expect(nativeTargets(result)[0].record).toEqual(evidence.nativeSource);
  });
  it.each(['source', 'scope', 'purpose', 'permission', 'context', 'performed', 'work'] as const)('rejects a mismatched saved evidence %s binding', (mode) => {
    const evidence = savedEvidence(); const read = withEvidence(evidence);
    if (mode === 'source') evidence.nativeReadReceipt.sourceRevisionRef = 'other';
    if (mode === 'scope') evidence.nativeScope = { sourceRevisionRef: 'other', fieldSelectors: [], grouping: 'TRANSPARENT_FIELDS', limitations: [] };
    if (mode === 'purpose') Object.assign(evidence.nativeReadReceipt, { purpose: 'WIKI_NATIVE_RECORD' });
    if (mode === 'permission') evidence.nativeReadReceipt.permissionRevision = '';
    if (mode === 'context') evidence.nativeReadReceipt.taskContextRef = '';
    if (mode === 'performed') Object.assign(evidence.nativeReadReceipt, { readPerformed: false });
    if (mode === 'work') read.workRef = 'other';
    const result = appendSuiteTdmsSources(read, { records: [], relations: [] });
    expect(nativeTargets(result)).toHaveLength(0);
    expect(tdmsEdges(result)).toHaveLength(0);
  });
  it('keeps historical saved refs without substituting current catalogue metadata or relations', () => {
    const result = appendSuiteTdmsSources(withEvidence(savedEvidence('old-v1'), true), {
      records: [record('old-v1', { title: 'mutated current metadata', relatedDocumentVersionIds: ['dv-1'] }), record('new-v2')],
      relations: [reading([assertion('today', { from: native('old-v1') })], 'old-v1')], includeCandidates: true, includeHistoricalAssertions: true,
    });
    expect(nativeTargets(result)).toHaveLength(1);
    expect(nativeTargets(result)[0].record?.title).toBe('同名评估');
    expect(tdmsEdges(result)).toHaveLength(1);
    expect(tdmsEdges(result)[0]).toMatchObject({ type: 'TDMS_SAVED_EVIDENCE', currentness: 'HISTORICAL_HOST_OBSERVATION' });
    expect(result.notices.join(' ')).toContain('未随工作保存');
  });
  it('does not introduce history nodes solely from current document bindings or relations', () => {
    const read = base(); read.historical = true;
    const result = appendSuiteTdmsSources(read, { records: [record('native-v1', {relatedDocumentVersionIds: ['dv-1']})], relations: [reading([assertion()])] });
    expect(nativeTargets(result)).toHaveLength(0);
    expect(tdmsEdges(result)).toHaveLength(0);
  });
  it('keeps an explicitly pinned current work frozen without relabelling it historical', () => {
    const read = withEvidence(savedEvidence('old-v1'));
    read.pinnedSavedWork = true;
    const result = appendSuiteTdmsSources(read, {
      records: [record('new-v2', { relatedDocumentVersionIds: ['dv-1'] })],
      relations: [reading([assertion('today', { from: native('old-v1') })], 'old-v1')],
    });
    expect(nativeTargets(result).map(target => target.sourceRevisionRef)).toEqual(['old-v1']);
    expect(tdmsEdges(result)).toHaveLength(1);
    expect(tdmsEdges(result)[0]).toMatchObject({ type: 'TDMS_SAVED_EVIDENCE', currentness: 'UNKNOWN' });
    expect(result.historical).toBe(false);
    expect(result.notices.join(' ')).toContain('未混入');
  });
  it('connects an authorized assertion to an existing exact document without a catalogue-based root edge', () => {
    const response = reading([assertion()]);
    const result = appendSuiteTdmsSources(base(), { records: [record()], relations: [response] });
    expect(tdmsEdges(result)).toHaveLength(1);
    expect(tdmsEdges(result)[0]).toMatchObject({ id: '["TDMS_ASSERTION","a-1"]', source: '["NATIVE_RECORD_REVISION","native-v1"]', target: 'doc-node', authority: 'SOURCE_EXPLICIT', currentness: 'SELECTED_HOST_OBSERVATION' });
    const detail = result.tdmsRelationDetails!.get(tdmsEdges(result)[0].id);
    expect(detail).toEqual({kind: 'TDMS_ASSERTION', assertion: response.relations[0], receipt: response.receipt, limitations: response.limitations});
    expect(detail?.kind === 'TDMS_ASSERTION' && detail.receipt).toBe(response.receipt);
  });
  it('keeps relation-only native endpoints metadata-unknown, not a fake record or document', () => {
    const result = appendSuiteTdmsSources(base(), { records: [], relations: [reading([assertion()])] });
    expect(nativeTargets(result)[0]).toEqual({ kind: 'tdms-record', sourceRevisionRef: 'native-v1', record: null });
    expect(result.graph.groups[1].items[0].subtitle).toContain('未读');
  });
  it.each(['source', 'permission', 'purpose', 'performed'] as const)('rejects a relation receipt with invalid %s', (mode) => {
    const response = reading([assertion()]);
    if (mode === 'source') response.receipt.sourceRevisionRef = 'other';
    if (mode === 'permission') response.receipt.permissionRevision = '';
    if (mode === 'purpose') response.receipt.purpose = 'WIKI_NATIVE_RECORD';
    if (mode === 'performed') Object.assign(response.receipt, {readPerformed: false});
    const result = appendSuiteTdmsSources(base(), { records: [], relations: [response] });
    expect(tdmsEdges(result)).toHaveLength(0);
    expect(nativeTargets(result)).toHaveLength(0);
  });
  it('drops disconnected assertions even if an endpoint is an otherwise relevant document', () => {
    const response = reading([assertion('other', {from: native('other-ref')})]);
    const result = appendSuiteTdmsSources(base(), {records: [], relations: [response]});
    expect(tdmsEdges(result)).toHaveLength(0);
  });
  it('does not expose unanchored authorized neighborhoods just because they share the source scope', () => {
    const response = reading([assertion('private-neighborhood', {to: native('other-native')})]);
    expect(appendSuiteTdmsSources(base(), {records: [record()], relations: [response]})).toEqual(base());
  });
  it('follows exact authorized native assertions independent of response ordering', () => {
    const responses = [reading([assertion('second', {from: native('n2'), to: native('n3')})], 'n2'), reading([assertion('first', {to: native('n2')})]), reading([assertion('anchor')])];
    const result = appendSuiteTdmsSources(base(), { records: [], relations: responses });
    expect(new Set(nativeTargets(result).map(target => target.sourceRevisionRef))).toEqual(new Set(['native-v1', 'n2', 'n3']));
    expect(tdmsEdges(result)).toHaveLength(3);
  });
  it('deduplicates the same assertion from authorized neighborhoods but rejects identity conflicts', () => {
    const one = assertion();
    const result = appendSuiteTdmsSources(base(), {records: [], relations: [reading([one, one]), reading([one])]});
    expect(tdmsEdges(result)).toHaveLength(1);
    expect(() => appendSuiteTdmsSources(base(), { records: [], relations: [reading([one, {...one, authority: 'CANDIDATE_ONLY'}])], includeCandidates: true })).toThrow('冲突关系');
  });
  it.each([['candidate', false], ['candidate', true], ['history', false], ['history', true]] as const)('does not hide an assertion identity conflict behind the default %s filter (reversed=%s)', (mode, reversed) => {
    const one = assertion();
    const conflicting = mode === 'candidate' ? {...one, authority: 'CANDIDATE_ONLY' as const} : {...one, selectedHead: false};
    expect(() => appendSuiteTdmsSources(base(), {records: [], relations: [reading(reversed ? [conflicting, one] : [one, conflicting])]})).toThrow('冲突关系');
  });
  it.each([false, true])('rejects conflicting saved-evidence metadata for the same exact ref (historical=%s)', historical => {
    const read = withEvidence(savedEvidence(), historical);
    const second = {...savedEvidence(), evidenceRef: 'evidence-2', nativeSource: record('native-v1', {title: 'conflict'})};
    read.graph.groups[1].items.push({id: 'evidence-node-2', title: 'Evidence 2'});
    read.targets.set('evidence-node-2', {kind: 'evidence', evidence: second, workRef: 'work-1'});
    expect(() => appendSuiteTdmsSources(read, {records: [], relations: []})).toThrow('冲突元数据');
    second.nativeSource = record();
    const result = appendSuiteTdmsSources(read, {records: [], relations: []});
    expect(nativeTargets(result)).toHaveLength(1);
    expect(tdmsEdges(result)).toHaveLength(2);
  });
  it('qualifies declared completeness without dropping non-atomic readback gaps', () => {
    const source = record('native-v1', {relatedDocumentVersionIds: ['dv-1'], coverage: {status: 'COMPLETE', gaps: ['non-atomic source read'], readback: 'NON_ATOMIC'}});
    const result = appendSuiteTdmsSources(base(), {records: [source], relations: []});
    expect(result.graph.groups[1].items[0].subtitle).toContain('所声明范围完整');
    expect(nativeTargets(result)[0].record?.coverage).toEqual(source.coverage);
  });
  it('keeps same-text unresolved endpoints local to each assertion', () => {
    const unresolved: TdmsExactEndpoint = {kind: 'UNRESOLVED', rawIdentity: 'SAME TITLE', versionGap: 'revision unknown'};
    const result = appendSuiteTdmsSources(base(), {records: [record('native-v1', {relatedDocumentVersionIds: ['dv-1']})], relations: [reading([assertion('a1', {to: unresolved}), assertion('a2', {to: unresolved})])]});
    const targets = [...result.targets.values()].filter(target => target.kind === 'tdms-unresolved');
    expect(targets).toHaveLength(2);
    expect(targets.map(target => target.assertionRef)).toEqual(['a1', 'a2']);
  });
  it('does not synthesize an original-opening target for an external exact document endpoint', () => {
    const result = appendSuiteTdmsSources(base(), {records: [record('native-v1', {relatedDocumentVersionIds: ['dv-1']})], relations: [reading([assertion('outside', {to: document('outside')})])]});
    expect(tdmsEdges(result).some(edge => edge.type === 'TDMS_ASSERTION')).toBe(false);
    expect(result.notices.join(' ')).toContain('不在当前原图');
    expect([...result.targets.values()].some(target => target.kind === 'document' && target.documentVersionId === 'outside')).toBe(false);
  });
  it('requires explicit candidate/history opt-in and keeps unknown currentness unknown', () => {
    const response = reading([assertion('source'), assertion('candidate', {authority: 'CANDIDATE_ONLY'}), assertion('history', {selectedHead: false}), assertion('unknown', {selectedHead: undefined})]);
    const normal = appendSuiteTdmsSources(base(), {records: [], relations: [response]});
    expect(tdmsEdges(normal).map(edge => edge.id)).toEqual(['["TDMS_ASSERTION","source"]', '["TDMS_ASSERTION","unknown"]']);
    const expanded = appendSuiteTdmsSources(base(), {records: [], relations: [response], includeCandidates: true, includeHistoricalAssertions: true});
    expect(tdmsEdges(expanded).map(edge => [edge.authority, edge.currentness])).toEqual([
      ['SOURCE_EXPLICIT', 'SELECTED_HOST_OBSERVATION'], ['CANDIDATE_ONLY', 'SELECTED_HOST_OBSERVATION'], ['SOURCE_EXPLICIT', 'HISTORICAL_HOST_OBSERVATION'], ['SOURCE_EXPLICIT', 'UNKNOWN'],
    ]);
    expect(tdmsEdges(expanded)[3].label).toContain('当前性未知');
  });
  it('rejects reuse of an already projected read so stale protected data cannot accumulate', () => {
    const projected = appendSuiteTdmsSources(base(), {records: [], relations: [reading([assertion()])]});
    expect(() => appendSuiteTdmsSources(projected, {records: [], relations: []})).toThrow('不能叠加旧投影');
  });
  it('projects into the unchanged existing presentation and preserves exact relationship IDs and omissions', () => {
    const result = appendSuiteTdmsSources(base(), {records: [], relations: [reading([assertion()])]});
    const presentation = buildSuiteGraphPresentation(result.graph);
    expect(presentation.counts.represented.relationships).toBe(2);
    expect(presentation.omittedRelationships).toEqual([]);
    expect(presentation.elements.filter(item => item.group === 'edges' && item.data.viewKind === 'relationship').map(item => item.data.businessId)).toEqual(result.graph.relations.map(edge => edge.id));
    expect(buildSuiteGraphPresentation(result.graph, {hiddenGroups: ['tdms:UNKNOWN']}).omittedRelationships).toEqual([{ id: '["TDMS_ASSERTION","a-1"]', reason: 'hiddenGroup' }]);
  });
});
