import { buildSuiteMatterGraph } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import { libraryMatterFixture } from './fixtures/library-matter';

describe('saved matter graph projection', () => {
  it('preserves candidate claims and does not fabricate material relationships for a missing contract', () => {
    const read = libraryMatterFixture();
    const graph = buildSuiteMatterGraph(read);
    expect(graph.graph.groups.map(group => group.key)).toEqual(['questions', 'claims']);
    expect(graph.notices).toHaveLength(1);
    expect(graph.overviewStatus).toBeNull();
    expect([...graph.targets.values()].find(target => target.kind === 'claim')).toMatchObject({kind: 'claim', workRef: 'test-working-3'});
    expect(graph.graph.relations[0].type).toBe('SAVED_CLAIM');
  });
  it('retains exact evidence, premise direction and limitations without inventing missing evidence', () => {
    const read = libraryMatterFixture();
    const result = read.working.current!.state.substantiveResult!;
    result.evidence.push({kind: 'DOCUMENT_PASSAGE', evidenceRef: 'source', title: '条件', excerpt: '仅限条件X', versionLabel: 'R01', documentVersionId: 'old-version', workItemId: null, sourceRefId: 'exact-source', locator: '{"parseRunId":"old-run"}'});
    result.content.claims[0].premises = [{ evidenceRef: 'source', role: 'LIMITS', explanation: '限定范围', limitation: '不得推广' }, {evidenceRef: 'missing', role: 'CONTEXT', explanation: '未读回', limitation: null}];
    const graph = buildSuiteMatterGraph(read);
    const relation = graph.graph.relations.find(item => item.type === 'LIMITS')!;
    expect(graph.targets.get(relation.source)).toMatchObject({kind: 'evidence', evidence: {documentVersionId: 'old-version'}});
    expect(graph.targets.get(relation.target)?.kind).toBe('claim');
    expect(graph.relationDetails.get(relation.id)).toMatchObject({limitation: '不得推广'});
    expect(graph.missingEvidenceRefs).toEqual(['missing']);
    expect(graph.graph.relations.filter(item => item.type === 'CONTEXT')).toHaveLength(0);
  });
  it('does not turn excluded or expected material into adopted or existing source documents', () => {
    const read = libraryMatterFixture();
    read.matter.materials = [{kind: 'EXPECTED', materialId: 'expected', familyId: null, documentVersionId: null, scope: '范围', contribution: '待发布', basis: [], origin: 'ENGINEER', disposition: 'INCLUDED', expected: {issuer: null, documentNumber: null, description: '补充试验', expectedContribution: '验证', expectedDate: null, sourceAsOf: '2026-09-17', publicationStatus: 'PLANNED', acquisitionStatus: 'NOT_ACQUIRED', fulfilledBy: []}}, {kind: 'RELATED', materialId: 'excluded', familyId: 'family', documentVersionId: 'version', scope: '', contribution: '不纳入', basis: [], origin: 'ENGINEER', disposition: 'EXCLUDED'}];
    const graph = buildSuiteMatterGraph(read);
    expect(graph.graph.groups.map(group => group.key)).toEqual(['EXPECTED', 'questions', 'claims']);
    expect([...graph.targets.values()].some(target => target.kind === 'document')).toBe(false);
    expect(graph.notices).toContain('已排除资料：不纳入');
    const expected = read.matter.materials[0];
    if (expected.kind !== 'EXPECTED') throw new Error('fixture');
    expected.expected.fulfilledBy.push({familyId: 'f', documentVersionId: 'v1', scope: '仅取得附录'});
    const acquired = buildSuiteMatterGraph(read);
    const edge = acquired.graph.relations.find(item => item.type === 'FULFILLED_BY')!;
    expect(acquired.relationDetails.get(edge.id)).toMatchObject({kind: 'FULFILLED_BY', index: 0, target: {documentVersionId: 'v1', scope: '仅取得附录'}});
  });
  it('rejects mismatched current work identity but permits work predating new materials', () => {
    const read = libraryMatterFixture();
    read.working.current!.basedOnMatterRevisionId = 'earlier-materials';
    expect(() => buildSuiteMatterGraph(read)).not.toThrow();
    read.working.current!.workingRevision--;
    expect(() => buildSuiteMatterGraph(read)).toThrow('身份不一致');
    read.working.current!.workingRevision++;
    read.working.current!.matterId = 'other';
    expect(() => buildSuiteMatterGraph(read)).toThrow('身份不一致');
  });
  it('reads only the pinned historical work and never mixes current material or pending changes', () => {
    const read = libraryMatterFixture();
    const history = structuredClone(read.working.current!);
    history.matterWorkRevisionId = 'old-work';
    history.workingRevision = 1;
    history.basedOnMatterRevisionId = 'old-materials';
    history.state.substantiveInputs = [{kind: 'DOCUMENT_VERSION', inputId: 'old-input', familyId: 'f', documentVersionId: 'old-dv', workItemId: null, workItemRevision: null, resultRef: null, resultRevision: null, original: {parseRunId: 'old-run', parseRevision: 1}}];
    read.matter.materials = [{kind: 'MEMBER', materialId: 'new', familyId: 'f', documentVersionId: 'new-dv', scope: '', contribution: '新资料', basis: [], origin: 'ENGINEER', disposition: 'INCLUDED'}];
    expect(() => buildSuiteMatterGraph(read, {workRef: 'old-work', revision: null})).toThrow('指定历史工作');
    const graph = buildSuiteMatterGraph(read, {workRef: 'old-work', revision: history});
    expect(graph.graph.groups.map(group => group.key)).not.toContain('MEMBER');
    expect([...graph.targets.values()].find(target => target.kind === 'input')).toMatchObject({binding: {documentVersionId: 'old-dv', original: {parseRunId: 'old-run'}}});
    expect(graph.workRef).toBe('old-work');
  });
  it('rejects a result from another matter or saved revision', () => {
    const read = libraryMatterFixture();
    read.working.current!.state.substantiveResult!.resultRevision++;
    expect(() => buildSuiteMatterGraph(read)).toThrow('身份不一致');
  });
});
