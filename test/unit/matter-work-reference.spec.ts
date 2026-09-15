import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ReferenceWorkNotices from '../../client/src/features/matter/ReferenceWorkNotices';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import { assessmentEvidenceRoots } from '@shared/assessment-evidence-roots';
import { buildMatterWorkReference } from '../../server/modules/canonical-host/matter-work-reference';
import { materializeJobAidWork } from '../../server/modules/canonical-host/jobaid-problem-work';
import { materializeMatterJobAidCommand } from '../../server/modules/canonical-host/matter-jobaid-save';
import { materializeEngineeringMatterWorkingState, parseEngineeringMatterWorkingState } from '../../server/modules/canonical-host/engineering-matter-working-state';
import { JOBAID_METHOD_BINDING } from '../../server/modules/canonical-host/jobaid-method-pack';
import { readStoredOverallEvidence, overallModelEvidenceRegistry } from '../../server/modules/canonical-host/overall-assessment-reading';

const root: AssessmentEvidence = { evidenceRef: 'DOC-A:original:1', kind: 'DOCUMENT_PASSAGE',
  documentVersionId: 'DOC-A', workItemId: null, sourceRefId: 'original:1', locator: 'Page 1',
  title: 'Synthetic original', versionLabel: 'R1', excerpt: 'Use only after confirming the target configuration.' };
const history = { required: false, priorAssessmentRefs: [], engineeringDocumentRefs: [],
  coverage: 'NOT_REQUIRED' as const, limitation: null };
const proposal = (body: string) => ({ schemaVersion: 'wiselink.jobaid-problem-work.v3',
  issues: [{ issueKey: 'condition', question: 'Which conditions apply?', body }],
  roundCompletion: 'IN_PROGRESS', completionReason: 'Target configuration remains unknown.', changeSummary: 'Preserve the conditions.' });
function sourceWork(): EngineeringMatterWorkingRevisionReadModel {
  const work = materializeJobAidWork(proposal(`Confirm the configuration before applying the document. [[${root.evidenceRef}]]`), {
    matterId: 'MAT-A', previous: null, evidence: [root], readSourceRefs: [root.evidenceRef],
    capabilities: [], history, methodBinding: JOBAID_METHOD_BINDING,
  });
  return { matterWorkRevisionId: 'MWREV-A1', matterId: 'MAT-A', workingRevision: 1,
    basedOnMatterRevisionId: 'MREV-A1', updateKind: 'INITIAL_SYNTHESIS', changeSummary: 'Synthetic setup',
    substantiveResultRef: null, substantiveResultRevision: null, source: null, createdAt: '2026-09-15T00:00:00Z',
    state: { schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1',
      focus: { question: 'Conditions', targetRefs: [] }, substantiveResult: null, openQuestions: [], reviewConditions: [],
      substantiveInputs: [], coverage: [], problemWork: work },
    change: { changedBecause: null, addedClaimIds: [], replacedClaimIds: [], retiredClaims: [],
      explicitlyUnchangedClaimIds: [], openQuestionDelta: null, reviewConditionDelta: null, coverageUpdates: [] } };
}
const request = { matterId: 'MAT-A', workRef: 'MWREV-A1', issueKey: 'condition', purpose: 'Compare conditions with B.' };

test('live source notices keep exact old and corrected routes distinct, including an unchanged comparison', () => {
  const notice = { sourceWork: { subjectKind: 'ENGINEERING_MATTER' as const, subjectId: 'MAT-A', workRef: 'MWREV-A1', issueKey: 'condition' },
    evidenceRef: 'PRIOR-A', affectedIssueKeys: ['B-condition'], overviewStatus: 'STALE' as const,
    correctionNotices: [{ attemptRef: 'AQ-A2', issueKey: 'condition', reason: 'Check the original condition.',
      attemptStatus: 'SUCCEEDED', correctedWorkRef: 'MWREV-A2' }] };
  const render = (value: typeof notice) => renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ReferenceWorkNotices, { notices: [value] })));
  const html = render(notice);
  expect(html).toContain('其综合尚未覆盖');
  expect(html).toContain('sourceWorkRef=MWREV-A1');
  expect(html).toContain('sourceWorkRef=MWREV-A2');
  const unchanged = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ReferenceWorkNotices,
    { notices: [{ ...notice, correctionNotices: [{ ...notice.correctionNotices[0], unchanged: true, correctedWorkRef: null }] }] })));
  expect(unchanged).toContain('已完成比较并保留原认识');
  expect(unchanged).not.toContain('尚未取得更正后的保存结果');
});

test('builds full saved analysis from the exact identity and retains only its actual root sources', () => {
  const revision = sourceWork();
  revision.state.problemWork!.evidence.push({ ...root, evidenceRef: 'unrelated', excerpt: 'Unrelated private text.' });
  const evidence = buildMatterWorkReference(request, revision);
  expect(evidence).toHaveLength(2);
  expect(evidence[0]).toMatchObject({ kind: 'PRIOR_RESULT', resultRef: request.workRef, resultRevision: 1,
    originalEvidenceRefs: [root.evidenceRef], sourceWork: { subjectKind: 'ENGINEERING_MATTER',
      subjectId: 'MAT-A', workRef: request.workRef, issueKey: request.issueKey } });
  expect(JSON.parse(evidence[0].excerpt).issue).toEqual(revision.state.problemWork!.issues[0]);
  expect(JSON.stringify(evidence)).not.toContain('Unrelated private text');
  expect(() => buildMatterWorkReference({ ...request, workRef: 'MWREV-A2' }, revision)).toThrow('NOT_FOUND');
  expect(() => buildMatterWorkReference({ ...request, issueKey: 'missing' }, revision)).toThrow('NOT_FOUND');
});

test('deduplicates a root reached directly and through two prior results, and reports missing or cyclic lineage', () => {
  const a: AssessmentEvidence = { kind: 'PRIOR_RESULT', evidenceRef: 'A', resultRef: 'WA', resultRevision: 1,
    originalEvidenceRefs: [root.evidenceRef], title: 'A', versionLabel: null, excerpt: 'A' };
  const b: AssessmentEvidence = { ...a, evidenceRef: 'B', resultRef: 'WB', originalEvidenceRefs: ['A', root.evidenceRef] };
  expect(assessmentEvidenceRoots(['A', 'B', root.evidenceRef], [root, a, b])).toEqual({ rootRefs: [root.evidenceRef], unresolvedRefs: [] });
  expect(assessmentEvidenceRoots(['B'], [a, b])).toEqual({ rootRefs: [], unresolvedRefs: [root.evidenceRef] });
  expect(assessmentEvidenceRoots(['A'], [{ ...a, originalEvidenceRefs: ['B'] }, b]).unresolvedRefs).toContain('A');
});

test('normal B materialization retains a cited A identity and roots without copying A conditions or ratings into B', () => {
  const evidence = buildMatterWorkReference(request, sourceWork());
  const command = materializeMatterJobAidCommand({ matterId: 'MAT-B', matterRevisionId: 'MREV-B1',
    attemptRef: 'AQ-B1', requestId: 'save-B1', expectedWorkRevision: 0, previous: null, inputs: [],
    proposal: proposal(`The A investigation is context only; B still needs its own configuration evidence. [[${evidence[0].evidenceRef}]]`),
    evidence, readSourceRefs: evidence.map(item => item.evidenceRef), capabilities: [], history,
    methodBinding: JOBAID_METHOD_BINDING });
  const { state } = materializeEngineeringMatterWorkingState({ matterId: 'MAT-B', current: null, command });
  const saved = parseEngineeringMatterWorkingState(JSON.stringify(state), 'MAT-B');
  expect(saved.problemWork!.evidence).toEqual(evidence);
  expect(saved.problemWork!.issues[0].riskScenarios).toEqual([]);
  expect(saved.problemWork!.issues[0].measures).toEqual([]);
  expect(saved.substantiveInputs).toEqual([]);
  expect(readStoredOverallEvidence(saved.problemWork!.evidence)).toEqual(evidence);
  expect(overallModelEvidenceRegistry(evidence)[0]).toMatchObject({ sourceWork: evidence[0].kind === 'PRIOR_RESULT' ? evidence[0].sourceWork : null,
    originalEvidenceRefs: [root.evidenceRef] });
});

test('a delivered but unused prior work is not persisted as a B use relationship', () => {
  const evidence = buildMatterWorkReference(request, sourceWork());
  const command = materializeMatterJobAidCommand({ matterId: 'MAT-B', matterRevisionId: 'MREV-B1',
    attemptRef: 'AQ-B1', requestId: 'save-B1', expectedWorkRevision: 0, previous: null, inputs: [],
    proposal: proposal(`B quotes the original condition directly. [[${root.evidenceRef}]]`),
    evidence, readSourceRefs: evidence.map(item => item.evidenceRef), capabilities: [], history,
    methodBinding: JOBAID_METHOD_BINDING });
  expect(command.nextProblemWork!.evidence).toEqual([root]);
});
