import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { TdmsRecordSummary, TdmsRelationAssertion, TdmsRelationReadResponse } from '@shared/tdms-source.interface';
import { TdmsSourceRelations } from '@client/src/features/tdms-source/TdmsRecordDetails';
import TdmsSourceRelationGraph from '@client/src/features/tdms-source/TdmsSourceRelationGraph';
import { buildTdmsRelationGraph, tdmsGraphEndpointId } from '@client/src/features/tdms-source/tdms-relation-graph';
import { savedTdmsSourceRefs } from '@client/src/features/tdms-source/saved-tdms-source-refs';

jest.mock('@client/src/features/tdms-source/tdms-relation-graph.css', () => ({}));
jest.mock('@client/src/pages/RelationGraphPage/relation-graph.css', () => ({}));

const rootRef = 'TDMS/observed/R-old';
const coverage = { status: 'PARTIAL' as const, gaps: ['constructed unread attachment'], readback: 'NOT_VERIFIED' as const };
function assertion(overrides: Partial<TdmsRelationAssertion> = {}): TdmsRelationAssertion {
  return {
    sourceRelationId: 'REL-source', rawKind: 'references', controlledKind: 'REFERENCES',
    from: { kind: 'NATIVE_RECORD_REVISION', sourceRevisionRef: rootRef },
    to: { kind: 'DOCUMENT_VERSION', documentVersionId: 'DV-exact-old' },
    authority: 'CANDIDATE_ONLY', selector: 'constructed-rel-selector', observedAt: '2026-10-01T00:00:00Z',
    coverage, scope: { aircraft: ['constructed-only'] }, completionEffect: 'OLD_COMPLETION_RECOGNIZED',
    changeClass: 'EQUIVALENT', rawFields: { source: 'constructed test boundary' }, relationRef: 'REL-host',
    assertionRef: 'ASSERT-exact', selectedHead: false, captureRef: 'CAPTURE-old', sourceVerification: 'DECLARED_ONLY',
    ...overrides,
  };
}
function reading(relations: TdmsRelationAssertion[] = [assertion()]): TdmsRelationReadResponse {
  return {
    sourceRevisionRef: rootRef, relations,
    receipt: { receiptRef: 'READ-rel-exact', sourceRevisionRef: rootRef, readAt: '2026-10-05T00:00:00Z',
      purpose: 'WIKI_NATIVE_RELATIONS', fieldPaths: null, taskContextRef: null, readPerformed: true,
      permissionRevision: 'ACL-constructed', engineeringAdoption: 'NOT_CREATED', executionVerified: false },
    limitations: ['Constructed response; no real TDMS or server authorization exercised'],
  };
}
const summary: TdmsRecordSummary = {
  recordRef: 'NATIVE-old', sourceRevisionRef: rootRef, recordKind: 'ENGINEERING_FILE', sourceRecordId: 'OID-old',
  sourceKey: 'TDMS', sourceInstanceId: 'constructed-source', title: 'Constructed old engineering file',
  fileType: { rawCode: 'AEO', rawName: 'AEO' }, sourceVersion: { rawRevision: '12', rawIteration: '1', confirmation: 'SOURCE_DECLARED' },
  businessVersion: { rawRevision: 'B-old', rawIteration: null, confirmation: 'SOURCE_DECLARED' },
  state: { rawCode: 'Issued', rawName: 'Issued' }, authors: [], observedAt: '2026-10-01T00:00:00Z',
  capturedAt: '2026-10-02T00:00:00Z', coverage, relatedDocumentVersionIds: ['DV-exact-old'],
  fieldSelectors: [], sourceVerification: 'DECLARED_ONLY', currentness: 'SELECTED_HOST_OBSERVATION',
};
function renderList(value: TdmsRelationAssertion): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(TdmsSourceRelations, { read: reading([value]), onOpen: jest.fn() })));
}

describe('fresh recovered TDMS real renderers', () => {
  it.each([
    ['EQUIVALENT', 'OLD_COMPLETION_RECOGNIZED'],
    ['EQUIVALENT', 'REEXECUTE_NEW_VERSION'],
    ['REPLACES', 'OLD_COMPLETION_RECOGNIZED'],
    ['REPLACES', 'REEXECUTE_NEW_VERSION'],
  ] as const)('does not give candidate %s/%s source authority or completion credit', (changeClass, completionEffect) => {
    const html = renderList(assertion({ changeClass, completionEffect }));
    expect(html).toContain('候选关系，尚未核实');
    expect(html).toContain(`待核字段 ${changeClass}`);
    expect(html).toContain(`待核字段 ${completionEffect}`);
    expect(html).toContain('不形成实施结论');
    expect(html).toContain('不形成完成认可或重做要求');
    for (const phrase of ['源明确等效', '源明确取代', '源明确认可此范围旧版完成', '源明确要求此范围按新版重做'])
      expect(html).not.toContain(phrase);
  });
  it('retains explicit source declarations without claiming Host execution', () => {
    const html = renderList(assertion({ authority: 'SOURCE_EXPLICIT' }));
    expect(html).toContain('源明确关系'); expect(html).toContain('源明确等效');
    expect(html).toContain('源明确认可此范围旧版完成'); expect(html).toContain('与工程执行状态分开');
    expect(html).not.toContain('待核字段');
  });
  it('does not infer effects from unspecified candidate fields', () => {
    const html = renderList(assertion({ changeClass: 'UNSPECIFIED', completionEffect: 'UNSPECIFIED' }));
    expect(html).toContain('未明确，不推定旧版认可或新版重做'); expect(html).not.toContain('源明确');
  });
  it('does not grant source authority to an unexpected response authority', () => {
    const html = renderList(assertion({ authority: 'UNKNOWN' as TdmsRelationAssertion['authority'] }));
    expect(html).toContain('待核字段 EQUIVALENT'); expect(html).not.toContain('源明确认可');
  });
  it('uses the recovered existing graph canvas and states source/candidate boundaries', () => {
    const html = renderToStaticMarkup(createElement(TdmsSourceRelationGraph, { reading: reading(), rootRecord: summary }));
    expect(html).toContain('rg-canvas'); expect(html).toContain('TDMS 准确来源关系图谱');
    expect(html).toContain('源明确关系与候选关系分别标注'); expect(html).toContain('未核验实际执行');
    expect(html).toContain('准确来源修订'); expect(html).not.toContain('bytesBase64');
  });
});

describe('fresh recovered TDMS exact graph projection and saved history pins', () => {
  it.each(['wrong-ref', 'wrong-purpose', 'not-read'] as const)('rejects graph receipt %s', mismatch => {
    const data = reading();
    if (mismatch === 'wrong-ref') data.receipt.sourceRevisionRef = 'other';
    if (mismatch === 'wrong-purpose') data.receipt.purpose = 'WIKI_NATIVE_RECORD';
    if (mismatch === 'not-read') data.receipt.readPerformed = false as true;
    expect(buildTdmsRelationGraph(data, summary)).toEqual({ elements: [], nodes: [], edges: [], assertions: [] });
  });
  it('keeps only connected exact assertions and deduplicates their immutable assertion identity', () => {
    const disconnected = assertion({ assertionRef: 'OTHER', from: { kind: 'NATIVE_RECORD_REVISION', sourceRevisionRef: 'other' } });
    const projection = buildTdmsRelationGraph(reading([assertion(), assertion(), disconnected]), summary);
    expect(projection.edges).toHaveLength(1); expect(projection.assertions).toHaveLength(1);
    expect(projection.nodes.map(node => node.id).join(' ')).not.toContain('OTHER');
    expect(projection.edges[0].tdmsAuthority).toBe('CANDIDATE_ONLY');
    expect(projection.nodes.find(node => node.endpoint.kind === 'DOCUMENT_VERSION')?.endpoint)
      .toEqual({ kind: 'DOCUMENT_VERSION', documentVersionId: 'DV-exact-old' });
  });
  it('does not join unresolved names across source assertions or substitute current document versions', () => {
    const unresolved = { kind: 'UNRESOLVED' as const, rawIdentity: 'same OR/VR text', versionGap: 'unknown source version' };
    const projection = buildTdmsRelationGraph(reading([
      assertion({ assertionRef: 'A', to: unresolved }), assertion({ assertionRef: 'B', to: unresolved }),
    ]));
    const unresolvedNodes = projection.nodes.filter(node => node.kind === 'TDMS_UNRESOLVED');
    expect(unresolvedNodes).toHaveLength(2); expect(unresolvedNodes[0].id).not.toBe(unresolvedNodes[1].id);
    expect(tdmsGraphEndpointId(unresolved, 'A', 'from')).not.toBe(tdmsGraphEndpointId(unresolved, 'A', 'to'));
    expect(projection.nodes.some(node => node.kind === 'TDMS_DOCUMENT_VERSION')).toBe(false);
  });
  it('does not borrow a mismatched current root summary or infer its business version from technical revision', () => {
    const projection = buildTdmsRelationGraph(reading(), { ...summary, sourceRevisionRef: 'current-other', title: 'MUST NOT LEAK' });
    expect(projection.nodes.map(node => node.label).join(' ')).not.toContain('MUST NOT LEAK');
    const known = buildTdmsRelationGraph(reading(), summary);
    expect(known.nodes[0].label).toContain('B-old'); expect(known.nodes[0].label).toContain(rootRef);
  });
  it('takes historical native pins only from matching saved record and performed receipt, not the current directory', () => {
    const evidence: AssessmentEvidence = { evidenceRef: 'EV-native-old', title: summary.title, versionLabel: null, excerpt: 'constructed saved excerpt',
      kind: 'TDMS_NATIVE_RECORD', nativeSource: summary,
      nativeReadReceipt: { ...reading().receipt, purpose: 'JOB_AID_NATIVE_RECORD', taskContextRef: 'TASK-constructed', fieldPaths: ['content.opinions'] } };
    expect(savedTdmsSourceRefs([evidence, evidence])).toEqual([rootRef]);
    expect(savedTdmsSourceRefs([{ ...evidence, nativeReadReceipt: { ...evidence.nativeReadReceipt, sourceRevisionRef: 'current-other' } }])).toEqual([]);
    expect(savedTdmsSourceRefs([{ ...evidence, nativeReadReceipt: { ...evidence.nativeReadReceipt, readPerformed: false as true } }])).toEqual([]);
    expect(savedTdmsSourceRefs([])).toEqual([]);
  });
});
