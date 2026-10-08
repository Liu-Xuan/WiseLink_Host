import {
  appendSuiteGraphCatalogDocuments,
  buildSuiteMatterGraph,
} from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import type { AssessmentEvidence } from '../../shared/assessment-reading.interface';
import type { EngineeringMatterCatalogEntry } from '../../shared/api.interface';
import type { JobAidProblemWorkContent } from '../../shared/jobaid-problem-assessment.interface';
import { libraryMatterFixture } from './fixtures/library-matter';

const passage = (evidenceRef: string): AssessmentEvidence => ({
  kind: 'DOCUMENT_PASSAGE', evidenceRef, title: '保存的资料片段',
  excerpt: '原文范围', versionLabel: 'R01', documentVersionId: 'saved-document',
  workItemId: null, sourceRefId: 'saved-source', locator: 'section 1',
});

const problemWork = (evidence: AssessmentEvidence[]): JobAidProblemWorkContent => ({
  schemaVersion: 'wiselink.jobaid-problem-work.v3', headline: '问题工作',
  listBrief: '问题正文', understanding: '仍需核实', decisiveIssueKeys: [],
  overviewStatus: 'NOT_AVAILABLE', issues: [], roundCompletion: 'IN_PROGRESS',
  completionReason: '', changeSummary: '', unchangedExplanation: '',
  methodBinding: {
    packRef: 'method', version: 'R01', sources: [],
    attachment5: 'R00_CONTENT_REPORTED_R01_LINK_UNCONFIRMED',
  },
  evidence, readSourceRefs: [], capabilities: [],
  historyReview: {
    required: false, priorAssessmentRefs: [], engineeringDocumentRefs: [],
    coverage: 'NOT_REQUIRED', limitation: null,
  },
});

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
  it('projects problem-only saved evidence and resolves a claim premise from the same work', () => {
    const read = libraryMatterFixture();
    const current = read.working.current!;
    current.state.problemWork = problemWork([passage('problem-source')]);
    current.state.substantiveResult!.content.claims[0].premises = [{
      evidenceRef: 'problem-source', role: 'SUPPORTS', explanation: '保存的引用',
      limitation: null,
    }];
    const graph = buildSuiteMatterGraph(read);
    const edge = graph.graph.relations.find(item => item.type === 'SUPPORTS')!;
    expect(graph.targets.get(edge.source)).toMatchObject({
      kind: 'evidence', workRef: current.matterWorkRevisionId,
      evidence: { evidenceRef: 'problem-source' },
    });
    expect(graph.missingEvidenceRefs).toEqual([]);
    current.state.substantiveResult = null;
    current.substantiveResultRef = null;
    current.substantiveResultRevision = null;
    expect([...buildSuiteMatterGraph(read).targets.values()]).toContainEqual(
      expect.objectContaining({ kind: 'evidence', evidence: expect.objectContaining({ evidenceRef: 'problem-source' }) }),
    );
  });
  it('uses only evidence saved on the exact selected revision', () => {
    const read = libraryMatterFixture();
    const history = structuredClone(read.working.current!);
    history.matterWorkRevisionId = 'selected-old-work';
    history.workingRevision = 1;
    history.state.substantiveResult!.evidence = [];
    history.state.problemWork = problemWork([passage('old-problem-source')]);
    history.state.substantiveResult!.content.claims[0].premises = [{
      evidenceRef: 'current-only', role: 'SUPPORTS', explanation: '未保存在旧工作',
      limitation: null,
    }];
    read.working.current!.state.substantiveResult!.evidence = [passage('current-only')];
    const graph = buildSuiteMatterGraph(read, {
      workRef: history.matterWorkRevisionId, revision: history,
    });
    expect([...graph.targets.values()].filter(target => target.kind === 'evidence'))
      .toEqual([expect.objectContaining({
        workRef: 'selected-old-work',
        evidence: expect.objectContaining({ evidenceRef: 'old-problem-source' }),
      })]);
    expect(graph.missingEvidenceRefs).toEqual(['current-only']);
  });
  it('deduplicates identical saved evidence across pools and rejects a conflicting ref', () => {
    const read = libraryMatterFixture();
    const evidence = passage('shared-source');
    read.working.current!.state.substantiveResult!.evidence = [evidence];
    read.working.current!.state.problemWork = problemWork([Object.fromEntries(Object.entries(evidence).reverse()) as AssessmentEvidence]);
    const graph = buildSuiteMatterGraph(read);
    expect([...graph.targets.values()].filter(target => target.kind === 'evidence'))
      .toHaveLength(1);
    read.working.current!.state.problemWork!.evidence = [{
      ...evidence, excerpt: '相同 ID 的不同原文',
    }];
    expect(() => buildSuiteMatterGraph(read)).toThrow('evidenceRef 指向冲突依据');
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
    expected.expected.acquisitionStatus = 'PARTIALLY_ACQUIRED';
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
  it('freezes an explicitly pinned current work without calling it historical', () => {
    const read = libraryMatterFixture();
    read.matter.materials = [{
      kind: 'MEMBER', materialId: 'today', familyId: 'family',
      documentVersionId: 'today-document', scope: '', contribution: '今日登记',
      basis: [], origin: 'ENGINEER', disposition: 'INCLUDED',
    }];
    const current = read.working.current!;
    current.state.substantiveInputs = [{
      kind: 'DOCUMENT_VERSION', inputId: 'saved-input', familyId: 'family',
      documentVersionId: 'saved-document', workItemId: null,
      workItemRevision: null, resultRef: null, resultRevision: null,
      original: { parseRunId: 'saved-run', parseRevision: 1 },
    }];
    const todayEntry: EngineeringMatterCatalogEntry = {
      workItemId: 'today-work-item', relationRole: 'RELATED',
      linkedAtWorkItemRevision: 1, currentWorkItemRevision: 1,
      workItemChangedSinceLink: false, workItemStatus: 'ACTIVE',
      document: {
        documentId: 'today-document', documentVersionId: 'today-document',
        documentCode: 'SB-TODAY', businessRevision: 'R01',
        normalizedFamily: 'SB-TODAY',
      },
      documentCurrentness: {
        familyId: 'today-family', currentDocumentVersionId: 'today-document',
        currentGeneration: 1, selectedVersionIsCurrent: true,
      },
      sourceNavigation: {
        status: 'NOT_PARSED', sourceRefCount: 0,
        structuredContentPath: null,
      },
    };
    const graph = buildSuiteMatterGraph(read, {
      workRef: current.matterWorkRevisionId, revision: current,
    });
    expect(graph.historical).toBe(false);
    expect(graph.pinnedSavedWork).toBe(true);
    expect(graph.graph.groups.map(group => group.key)).not.toContain('MEMBER');
    expect(graph.graph.groups.map(group => group.key)).toContain('inputs');
    expect(appendSuiteGraphCatalogDocuments(graph, [todayEntry])).toBe(graph);
  });
  it('rejects a result from another matter or saved revision', () => {
    const read = libraryMatterFixture();
    read.working.current!.state.substantiveResult!.resultRevision++;
    expect(() => buildSuiteMatterGraph(read)).toThrow('身份不一致');
  });
});
