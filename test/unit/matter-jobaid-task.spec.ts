import { buildMatterJobAidTask } from '../../server/modules/canonical-host/matter-jobaid-task';

describe('Matter JobAid task protocol', () => {
  it('rejects a previous revision that has only the retired summary shape', () => {
    expect(() => buildMatterJobAidTask({
      matterId: 'MAT-legacy',
      matterRevisionId: 'MR-1',
      actorUserId: 'actor-1',
      title: 'Legacy state',
      inputs: [],
      trigger: { kind: 'USER_REQUEST', requestId: 'REQ-1', instruction: '继续评估' },
      previous: {
        matterWorkRevisionId: 'MWR-1',
        matterId: 'MAT-legacy',
        workingRevision: 1,
        basedOnMatterRevisionId: 'MR-0',
        updateKind: 'INITIAL_SYNTHESIS',
        changeSummary: '旧摘要',
        substantiveResultRef: 'RESULT-1',
        substantiveResultRevision: 1,
        state: {
          schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1',
          focus: { question: '旧问题', targetRefs: [] },
          substantiveResult: null,
          openQuestions: [],
          reviewConditions: [],
          substantiveInputs: [],
          coverage: [],
        },
        change: {
          changedBecause: null,
          addedClaimIds: [],
          replacedClaimIds: [],
          retiredClaims: [],
          explicitlyUnchangedClaimIds: [],
          openQuestionDelta: null,
          reviewConditionDelta: null,
          coverageUpdates: [],
        },
        source: null,
        createdAt: '2026-09-12T00:00:00.000Z',
      },
    })).toThrow('JOBAID_PREVIOUS_WORK_INCOMPLETE');
  });
});
