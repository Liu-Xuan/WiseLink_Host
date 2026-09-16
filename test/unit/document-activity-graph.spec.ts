import { buildActivityGraphElements, activityGraphNodeId, selectionForGraphNode } from '../../client/src/features/trinity/document-activity-graph';
import type { DocumentActivityReadingResponse } from '@shared/document-activity.interface';
import cytoscape from 'cytoscape';

type ActivityStatements = NonNullable<DocumentActivityReadingResponse['candidate']>['statements'];
function reading(candidateRevision: number, statements: ActivityStatements): DocumentActivityReadingResponse {
  const binding = { documentVersionId: 'DV', parseRunId: 'PR', parseRevision: 1, sourceArtifactId: 'A', sourceSha256: 'S', sourceByteLength: 1 };
  return { familyId: 'F', binding, candidate: { schemaVersion: 'wiselink.document.activity-candidate.v1', candidateOnly: true, sourceBinding: { original: binding, semanticRevision: 1 }, readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: { sectionIds: [] }, deliveredRanges: [], sourceCoverage: { knownPageCount: 0, readPageIndexes: [], unresolvedRanges: [] } }, sourceAnchors: [{ anchorId: 'A1', sourceText: 'text', sourceUnitId: 'u', payloadPath: 'p', sourceRefIds: ['R1'], sourceLocators: [] }], runRef: 'run', candidateRevision, producer: { skillVersion: 's', modelVersion: 'm' }, savedAt: '2026-09-16', statements } };
}

describe('document activity graph model', () => {
  const statement = (id: string, anchorId = 'A1') => ({ statementId: id, statementKey: id, label: '相似声明', quotes: [{ anchorId, start: 0, end: 4, text: 'text' }], time: null, statusRaw: null, limitations: [] });
  it('isolates candidate identities and does not merge similar statements', () => {
    const a = reading(1, [statement('S1'), statement('S2')]);
    const b = reading(2, [statement('S1')]);
    expect(activityGraphNodeId(a, 'statement', 'S1')).not.toBe(activityGraphNodeId(b, 'statement', 'S1'));
    expect(buildActivityGraphElements(a).filter((item) => item.data.kind === 'statement')).toHaveLength(2);
  });
  it('selects quote and anchor precisely and drops edges for missing anchors', () => {
    const value = reading(1, [statement('S1'), statement('S2', 'MISSING')]);
    const elements = buildActivityGraphElements(value);
    expect(elements.filter((item) => item.data.kind === 'quote-anchor')).toHaveLength(1);
    expect(selectionForGraphNode(value, { kind: 'quote', statementId: 'S1', anchorId: 'A1' })).toEqual({ statementId: 'S1', anchorId: 'A1' });
    expect(selectionForGraphNode(value, { kind: 'anchor', anchorId: 'A1' })).toEqual({ statementId: null, anchorId: 'A1' });
    expect(selectionForGraphNode(value, { kind: 'sourceRef' })).toBeNull();
  });
  it('keeps shared anchors and SourceRefs as one node without merging quote identities', () => {
    const value = reading(1, [statement('S1'), statement('S2')]);
    value.candidate!.sourceAnchors[0].sourceRefIds = ['R1', 'R1'];
    const elements = buildActivityGraphElements(value);
    expect(elements.filter((item) => item.data.kind === 'quote')).toHaveLength(2);
    expect(elements.filter((item) => item.data.kind === 'anchor')).toHaveLength(1);
    expect(elements.filter((item) => item.data.kind === 'sourceRef')).toHaveLength(1);
    const graph = cytoscape({ headless: true, elements });
    expect(graph.nodes()).toHaveLength(6);
    expect(graph.edges('[kind="statement-quote"]')).toHaveLength(2);
    expect(graph.edges('[kind="quote-anchor"]')).toHaveLength(2);
    expect(graph.edges('[kind="anchor-sourceRef"]')).toHaveLength(1);
    graph.destroy();
  });
});
