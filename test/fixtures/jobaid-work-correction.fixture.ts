import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { JOBAID_PROBLEM_WORK_SCHEMA, type JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { JOBAID_WORK_CORRECTION_SCHEMA, type JobAidWorkCorrectionRequest } from '@shared/jobaid-work-correction.interface';
import { JOBAID_METHOD_BINDING } from '../../server/modules/canonical-host/jobaid-method-pack';
import { materializeJobAidWork } from '../../server/modules/canonical-host/jobaid-problem-work';

/** Synthetic only: this fixture contains no 747, FTD or production replacement text. */
export function correctionFixture() {
  const evidence: AssessmentEvidence[] = Array.from({ length: 70 }, (_, index) => ({
    evidenceRef: `DOCUMENT_ORIGINAL:dv-job:parse-test:u${index + 1}`, kind: 'DOCUMENT_PASSAGE',
    workItemId: 'WI-job', documentVersionId: 'dv-job', sourceRefId: `u${index + 1}`,
    locator: `page ${index + 1}`, title: 'Synthetic test source', versionLabel: 'R1',
    excerpt: `Synthetic source passage ${index + 1}.`,
  }));
  const ref = evidence[0].evidenceRef;
  const content = materializeJobAidWork({ schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA,
    headline: 'Synthetic saved headline', listBrief: 'Synthetic saved brief',
    overview: `Synthetic overview [[${ref}]]`,
    issues: [{ issueKey: 'TEST-A', question: 'Synthetic question A', body: `Original test body [[${ref}]]`,
      riskScenarios: [{ scenario: 'Synthetic scenario', conditions: ['Unverified synthetic condition'],
        method: 'JA_AC_R01', severity: { label: '严重', reason: 'Original synthetic reason', basisRefs: [ref] },
        likelihood: null, limitations: ['Frequency remains unknown'], controlComparison: 'Synthetic controls need verification' }] },
    { issueKey: 'TEST-B', question: 'Synthetic question B', body: `Untouched issue [[${ref}]]` }],
    roundCompletion: 'COMPLETE', completionReason: 'Synthetic complete saved work',
    changeSummary: 'Synthetic original save',
  }, { workItemId: 'WI-job', methodBinding: JOBAID_METHOD_BINDING, previous: null,
    evidence, readSourceRefs: evidence.map(item => item.evidenceRef), capabilities: [],
    history: { required: false, priorAssessmentRefs: [], engineeringDocumentRefs: [],
      coverage: 'NOT_REQUIRED', limitation: null } });
  const base: JobAidWorkRevision = { workRevisionRef: 'JAWR-base', workItemId: 'WI-job',
    workRevision: 4, previousWorkRevisionRef: 'JAWR-previous', requestId: 'original-save',
    actionAttemptId: 'ATT-base', basedOnWorkItemRevision: 7, documentVersionId: 'dv-job',
    createdAt: '2026-10-18T00:00:00.000Z', content };
  const issue = content.issues[0];
  const request: JobAidWorkCorrectionRequest = { schemaVersion: JOBAID_WORK_CORRECTION_SCHEMA,
    requestId: 'correct-test-1', baseWorkRef: base.workRevisionRef, baseWorkRevision: base.workRevision,
    expectedWorkItemRevision: 7, changes: [
      { field: 'ISSUE_BODY', issueKey: issue.issueKey, issueRef: issue.issueRef,
        expectedOldValue: issue.body, newValue: `Corrected synthetic body [[${ref}]]`,
        reason: 'Synthetic correction reason', evidenceRefs: [ref] },
      { field: 'RISK_SEVERITY_REASON', issueKey: issue.issueKey, issueRef: issue.issueRef,
        scenarioIndex: 0, expectedScenario: structuredClone(issue.riskScenarios[0]),
        expectedOldValue: issue.riskScenarios[0].severity!.reason, newValue: 'Corrected synthetic severity reason',
        reason: 'Synthetic wording correction', evidenceRefs: [ref] },
    ] };
  return { base, request, ref };
}
