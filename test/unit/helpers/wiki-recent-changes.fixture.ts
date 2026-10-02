import type { ReviewConversationReadModel, ReviewTurnReadModel } from '@shared/api.interface';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import type { WikiSavedWork } from '../../../client/src/features/matter/wiki-recent-changes';

/** Fixed projection fixtures; these tests do not exercise Host saves or model quality. */
export const matterRevision: EngineeringMatterWorkingRevisionReadModel = {
  matterWorkRevisionId: 'MW-2', matterId: 'M1', workingRevision: 2,
  basedOnMatterRevisionId: 'MR-1', updateKind: 'CORRECTION', changeSummary: '保存固定核查范围。',
  substantiveResultRef: null, substantiveResultRevision: null,
  state: { schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1',
    focus: { question: '固定问题', targetRefs: [] }, substantiveResult: null,
    openQuestions: [], reviewConditions: [], substantiveInputs: [], coverage: [] },
  change: { changedBecause: '核对固定输入', addedClaimIds: [], replacedClaimIds: [], retiredClaims: [],
    explicitlyUnchangedClaimIds: [], openQuestionDelta: null, reviewConditionDelta: null, coverageUpdates: [] },
  source: { actionAttemptId: 'db-attempt-2', reviewTurnId: 'T2' },
  createdAt: '2026-10-02T08:00:00.000Z',
};
export const matterWork: WikiSavedWork = { kind: 'ENGINEERING_MATTER', revision: matterRevision };
export const jobAidRevision = {
  workRevisionRef: 'JW-2', workItemId: 'WI1', workRevision: 2, previousWorkRevisionRef: 'JW-1',
  requestId: 'review-turn:T2', actionAttemptId: 'db-attempt-2', basedOnWorkItemRevision: 5,
  documentVersionId: 'DV1', createdAt: '2026-10-02T08:00:00.000Z',
  content: { changeSummary: '保存固定问题更正。' },
} as JobAidWorkRevision;
export const jobAidWork: WikiSavedWork = { kind: 'WORK_ITEM', revision: jobAidRevision };

export function turn(overrides: Partial<ReviewTurnReadModel> = {}): ReviewTurnReadModel {
  return { purpose: 'UPDATE_ASSESSMENT', reviewTurnId: 'T2', turnNo: 2, requestId: 'request-2',
    inputRevision: 5, userMessage: '核查固定问题', reviewScope: { kind: 'WORK_ITEM' },
    engineerSuppliedInput: { engineerSuppliedInputId: 'EI2', inputType: 'ENGINEER_TEXT',
      adoptionStatus: 'CANDIDATE_UNADOPTED', text: '核查固定问题', attachmentRefs: [] },
    attachmentRefs: [], createdAt: '2026-10-02T07:00:00.000Z',
    assistantCandidate: { responseType: 'RESYNTHESIS_RESULT', answer: '保存候选', sourceRefs: [],
      missingInputs: [], candidateEvidenceRefs: [], reviewActionDraft: null, affectedItemIds: [], warnings: [],
      actionAttemptRef: 'operation-2', completedAt: '2026-10-02T08:00:01.000Z',
      provenance: { runtimeAppId: 'app_17c3zn24kv2', profileRef: 'wiselink-engineering',
        modelVersion: 'fixture', promptVersion: 'fixture', skillVersion: 'fixture', toolVersions: {}, resultContentHash: 'fixture' },
      jobAidWorkingUpdate: { status: 'APPLIED', workRevisionRef: 'JW-2', workRevision: 2, affectedIssueKeys: [] } },
    ...overrides };
}
export function conversation(turns = [turn()]): ReviewConversationReadModel {
  return { schemaVersion: 'wiselink.3_1.review_conversation.v1.c1', reviewConversationId: 'RC1',
    workItemId: 'WI1', reviewScope: { kind: 'WORK_ITEM' }, startedAtRevision: 1,
    lastSyncedRevision: 5, currentWorkItemRevision: 5, currentRevisionSynced: true, status: 'ACTIVE',
    createdAt: '2026-10-02T07:00:00.000Z', lastActiveAt: '2026-10-02T08:00:01.000Z', closedAt: null, turns };
}

export const sourceReading = {
  familyId: 'F1', binding: { documentVersionId: 'DV1', parseRunId: 'PR1', parseRevision: 1,
    sourceArtifactId: 'A1', sourceSha256: 'fixture', sourceByteLength: 10 },
  candidate: { schemaVersion: 'wiselink.document.activity-candidate.v1', runRef: 'DA1', candidateRevision: 2,
    candidateOnly: true, sourceBinding: { original: { documentVersionId: 'DV1', parseRunId: 'PR1',
      parseRevision: 1, sourceArtifactId: 'A1', sourceSha256: 'fixture', sourceByteLength: 10 }, semanticRevision: 1 },
    readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: { sectionIds: [] }, deliveredRanges: [],
      sourceCoverage: { knownPageCount: null, readPageIndexes: [], unresolvedRanges: [] } }, sourceAnchors: [],
    statements: [{ statementKey: 'S1', statementId: 'S1', label: '来源目标计划', quotes: [],
      time: { role: 'TARGET', precision: 'UNKNOWN', expression: 'TBD', raw: 'TBD', quoteIndex: 0 },
      statusRaw: '计划', limitations: [] }], producer: { skillVersion: 'fixture', modelVersion: 'fixture' },
    savedAt: '2026-10-01T08:00:00.000Z' },
};
