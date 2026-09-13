import { buildMatterJobAidTask } from '../../server/modules/canonical-host/matter-jobaid-task';

describe('Matter JobAid task protocol', () => {
  it('delivers the current source change and exact semantic binding independently of historical work', () => {
    const binding = { inputId: 'WI-new', workItemId: 'WI-new', workItemRevision: 3,
      documentVersionId: 'DV-new', resultRef: null, resultRevision: null,
      original: { parseRunId: 'PRUN-6', parseRevision: 6, semantic: { revision: 1, profileRef: 'boeing.ftd.sections.v1' } } };
    const task = buildMatterJobAidTask({ matterId: 'MAT-test', matterRevisionId: 'MR-1',
      actorUserId: 'actor-1', title: 'Source update', inputs: [binding],
      trigger: { kind: 'SOURCE_CHANGE', inputIds: ['WI-new'] }, previous: null });
    expect(task.modelInput.sourceChanges).toEqual([{ inputId: 'WI-new', current: binding,
      covered: null, reasons: ['NOT_COVERED'] }]);
    expect(task.modelInput.availableDocuments[0].boundOriginal).toEqual(binding.original);
    expect(task.modelInput.availableDocuments[0].readingScope).toBe('NOT_READ_THIS_ATTEMPT');
    expect(task.modelInput.trigger).toEqual({ kind: 'SOURCE_CHANGE', inputIds: ['WI-new'] });
  });

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
