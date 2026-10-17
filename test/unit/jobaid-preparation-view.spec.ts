import {
  buildJobAidPreparationView,
  preparationAfterSavedWork,
} from '../../server/modules/canonical-host/jobaid-preparation-view';
import type { JobAidEngineerPreparationFacts } from '../../server/modules/canonical-host/jobaid-preparation-view';
import { materializeJobAidWork } from '../../server/modules/canonical-host/jobaid-problem-work';
import { JOBAID_METHOD_BINDING } from '../../server/modules/canonical-host/jobaid-method-pack';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';

const facts: JobAidEngineerPreparationFacts = {
  pendingEngineerInputs: [
    {
      ref: 'correction-1',
      revision: 2,
      kind: 'CORRECTION',
      text: '不得视为已确认。',
      sourcePart: 'USER',
      origin: 'PERSONAL_DIALOGUE',
      recordedAt: '2026-10-15T00:00:00Z',
    },
  ],
  savedUpdates: [
    {
      status: 'UNCHANGED',
      workRevisionRef: null,
      workRevision: 1,
      affectedIssueKeys: [],
      instruction: '仍需核实。',
    },
  ],
  humanConfirmedDecisions: [],
  humanConfirmationStatus: 'NOT_RECORDED',
  limitations: [],
};
function work(): JobAidWorkRevision {
  const content = materializeJobAidWork(
    {
      schemaVersion: 'wiselink.jobaid-problem-work.v3',
      headline: '条件尚待核实',
      listBrief: '不能推断为不适用。',
      overview: '条件未知。',
      roundCompletion: 'IN_PROGRESS',
      completionReason: '需要原始条件。',
      changeSummary: '保留未知。',
      issues: [
        {
          issueKey: 'condition',
          question: '是否满足条件？',
          body: '未取得条件证明。 [[source:dv-exact:range-1]]',
          openQuestions: [
            {
              question: '缺失的条件是什么？',
              affects: '适用前提',
              nextEvidence: '准确原文',
              reason: '尚未取得',
            },
          ],
        },
      ],
    },
    {
      workItemId: 'WI',
      methodBinding: JOBAID_METHOD_BINDING,
      previous: null,
      evidence: [
        {
          evidenceRef: 'source:dv-exact:range-1',
          kind: 'DOCUMENT_PASSAGE',
          workItemId: 'WI',
          documentVersionId: 'dv-exact',
          sourceRefId: 'range-1',
          locator: 'page 1',
          title: '构造原文',
          versionLabel: 'R1',
          excerpt: 'The condition remains unconfirmed.',
        },
      ],
      readSourceRefs: ['source:dv-exact:range-1'],
      capabilities: [],
      history: {
        required: false,
        priorAssessmentRefs: [],
        engineeringDocumentRefs: [],
        coverage: 'NOT_REQUIRED',
        limitation: null,
      },
    },
  );
  return {
    workRevisionRef: 'JAWR-1',
    workItemId: 'WI',
    workRevision: 1,
    previousWorkRevisionRef: null,
    requestId: 'save-original',
    actionAttemptId: 'ATT-original',
    basedOnWorkItemRevision: 7,
    documentVersionId: 'dv-exact',
    createdAt: '2026-10-15T00:00:00Z',
    content,
  };
}

test('preparation retains the sealed goal and exact input while projecting unfinished work without source bodies', () => {
  const saved = work();
  const before = JSON.stringify(saved);
  const view = buildJobAidPreparationView({
    taskPurpose: 'INITIAL_PROBLEM_ASSESSMENT',
    taskInputRevision: 7,
    current: { revision: 8, source: { documentVersionId: 'dv-exact' } },
    documentVersionId: 'dv-exact',
    originalBinding: null,
    latestWork: saved,
    facts,
    sealedGoal: { goal: '只复核当前条件。', targetIssueKeys: ['condition'] },
  });
  expect(view).toMatchObject({
    goal: '只复核当前条件。',
    targetIssueKeys: ['condition'],
    taskInputRevision: 7,
    currentInputRevision: 8,
    currentInputChanged: true,
    lastSaved: { workRevisionRef: 'JAWR-1', basedOnInputRevision: 7 },
    humanConfirmationStatus: 'NOT_RECORDED',
    humanConfirmedDecisions: [],
  });
  expect(view.unfinishedItems).toContainEqual(
    expect.objectContaining({ kind: 'OPEN_QUESTION', issueKey: 'condition' }),
  );
  expect(view.unfinishedItems).toContainEqual(
    expect.objectContaining({ kind: 'ROUND_IN_PROGRESS' }),
  );
  expect(view).not.toHaveProperty('evidence');
  expect(view).not.toHaveProperty('readSourceRefs');
  expect(JSON.stringify(saved)).toBe(before);
  const next = preparationAfterSavedWork(view, {
    ...saved,
    workRevisionRef: 'JAWR-2',
    workRevision: 2,
  });
  expect(next.currentInputChanged).toBe(true);
  expect(next.goal).toBe(view.goal);
  expect(next.targetIssueKeys).toEqual(view.targetIssueKeys);
  expect(next.pendingEngineerInputs).toEqual(view.pendingEngineerInputs);
  expect(next.savedUpdates[0].status).toBe('UNCHANGED');
  expect(next.humanConfirmedDecisions).toEqual([]);
  expect(next.lastSaved?.workRevisionRef).toBe('JAWR-2');
});

test('no saved work and unreadable confirmation are explicit, never inferred as inapplicable', () => {
  const view = buildJobAidPreparationView({
    taskPurpose: 'OVERALL_CONSISTENCY',
    taskInputRevision: 3,
    current: { revision: 3, source: { documentVersionId: 'dv' } },
    documentVersionId: 'dv',
    originalBinding: null,
    latestWork: null,
    facts: {
      ...facts,
      humanConfirmationStatus: 'UNAVAILABLE',
      limitations: ['FORMAL_ENGINEER_CONFIRMATION_NOT_READABLE'],
    },
  });
  expect(view.lastSaved).toBe(null);
  expect(view.unfinishedItems).toEqual([
    {
      issueKey: null,
      kind: 'NO_SAVED_WORK',
      description: '尚无已保存的问题工作。',
    },
  ]);
  expect(view.humanConfirmationStatus).toBe('UNAVAILABLE');
  expect(view.targetIssueKeys).toEqual([]);
});
