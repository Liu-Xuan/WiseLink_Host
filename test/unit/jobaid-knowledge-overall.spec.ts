import { createHash } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { CanonicalWorkItemProjection } from '../../shared/api.interface';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { ACTION_ATTEMPT_REQUEST_ORIGIN } from '../../server/modules/action-attempt/action-attempt.types';
import { ActionAttemptLifecycleService } from '../../server/modules/action-attempt/action-attempt-lifecycle.service';
import { canonicalJson, parseTaskEnvelope, sealTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope';
import { AILY_TASK_ROLE_MAPPING } from '../../server/modules/canonical-host/aily-executor-run';
import { buildJobAidProblemTask, parseJobAidProblemTask } from '../../server/modules/canonical-host/jobaid-problem-task';
import { buildJobAidChecklistBinding } from '../../server/modules/canonical-host/jobaid-checklist-binding';
import { projectCommonAssessmentContext } from '../../server/modules/canonical-host/canonical-host-common-context.service';
import { JOBAID_METHOD_BINDING } from '../../server/modules/canonical-host/jobaid-method-pack';
import { buildJobAidOverallProjection, deterministicJobAidOverallBody } from '../../server/modules/canonical-host/jobaid-overall-projection';
import { parseAilyStageOverall } from '../../server/modules/canonical-host/program-controlled-assessment';
import { CANONICAL_MIAODA_APP_ID } from '../../server/modules/canonical-host/canonical-host.constants';
import type { CanonicalAilyFinalUserActorContext } from '../../server/modules/work-item/canonical-object-access.port';
import { isHostedCanonicalFinalUserActor } from '../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter';
import { JOBAID_PROBLEM_RESULT_SCHEMA, jobAidReadingResult, type AilyStageOverallReceipt } from '../../shared/jobaid-problem-assessment.interface';
import { fixedModelSettings } from '../support/fixed-model-settings';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import type { AssessmentReadingResult } from '../../shared/assessment-reading.interface';

const actor = { tenantId: 'tenant-A', userId: 'owner' } as CanonicalHostActor;
const reading: AssessmentReadingResult = {
  resultRef: 'OVERALL-1', resultRevision: 1,
  scope: { kind: 'WORK_ITEM', workItemId: 'WI-1', documentVersionId: 'DV-1' },
  content: { schemaVersion: 'wiselink.3_1.assessment_reading.v1',
    headline: '综合主题', listBrief: '简明意见', lead: '完整意见',
    claims: [], decisiveClaimIds: [] },
  evidence: [], candidateOnly: true,
};

function setup(overrides: { basedOnJobAidWorkRevisionRef?: string;
  readingResult?: AssessmentReadingResult } = {}) {
  const service = Object.create(
    CanonicalJobAidProblemService.prototype,
  ) as CanonicalJobAidProblemService;
  const revision = { workRevisionRef: 'JAWR-1' };
  const assertEvidenceOwned = jest.fn().mockResolvedValue(undefined);
  Object.assign(service, {
    readAuthorizedBrowserRevision: jest.fn().mockResolvedValue({
      workItem: { source: { documentVersionId: 'DV-1' },
        integratedAssessment: { overallSynthesis: {
          status: 'CANDIDATE_ONLY',
          basedOnJobAidWorkRevisionRef: 'JAWR-1',
          readingResult: reading,
          ...overrides,
        } } },
      revision,
    }),
    assertEvidenceOwned,
  });
  return { service, revision, assertEvidenceOwned };
}

describe('exact Overall in authorized JobAid knowledge reads', () => {
  it('returns the saved result only for its exact work and rechecks evidence', async () => {
    const { service, revision, assertEvidenceOwned } = setup();
    await expect(service.readBrowserKnowledgeRevision('WI-1', 'JAWR-1', actor))
      .resolves.toEqual({ revision, overall: { status: 'CANDIDATE_ONLY', readingResult: reading } });
    expect(assertEvidenceOwned).toHaveBeenCalledWith(
      reading.evidence, 'tenant-A', 'owner', 'WI-1',
    );
  });

  it('does not attach an Overall based on another JobAid revision', async () => {
    const { service, revision, assertEvidenceOwned } = setup({
      basedOnJobAidWorkRevisionRef: 'JAWR-OLDER',
    });
    await expect(service.readBrowserKnowledgeRevision('WI-1', 'JAWR-1', actor))
      .resolves.toEqual({ revision, overall: null });
    expect(assertEvidenceOwned).not.toHaveBeenCalled();
  });

  it('rejects a mismatched source scope and propagates source revocation', async () => {
    const mismatch = setup({ readingResult: { ...reading,
      scope: { kind: 'WORK_ITEM', workItemId: 'WI-OTHER', documentVersionId: 'DV-1' } } });
    await expect(mismatch.service.readBrowserKnowledgeRevision('WI-1', 'JAWR-1', actor))
      .rejects.toThrow('JOBAID_OVERALL_SOURCE_BINDING_INVALID');
    expect(mismatch.assertEvidenceOwned).not.toHaveBeenCalled();

    const revoked = setup();
    revoked.assertEvidenceOwned.mockRejectedValue(new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED'));
    await expect(revoked.service.readBrowserKnowledgeRevision('WI-1', 'JAWR-1', actor))
      .rejects.toMatchObject({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404,
        message: 'CANONICAL_WORK_ITEM_NOT_FOUND' });
  });
});

// These identities stand in for the already-verified Host ingress boundary.
// The real public readers, source checks, scoped attempt reader and artifact
// comparison below remain in use; no private reader/authorization method is mocked.
function nativeStageReader(userId = 'stage-reader'): CanonicalHostActor {
  return { userId, tenantId: 'tenant-A', appId: CANONICAL_MIAODA_APP_ID, roles: [], env: 'preview',
    objectAccessActor: { principalKind: 'FINAL_USER', transport: 'MIAODA_AUTHENTICATED_HTTP',
      canonicalSubject: { namespace: 'MIAODA_USER_ID', id: userId },
      subjectDecision: { source: 'MIAODA_GATEWAY_USER_CONTEXT', applicationScopeId: CANONICAL_MIAODA_APP_ID,
        tenantId: 'tenant-A', version: 'miaoda-hosted-native-sso.v1', decidedAt: '2026-10-30T00:00:00.000Z' },
      tenantId: 'tenant-A', applicationScopeId: CANONICAL_MIAODA_APP_ID,
      applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT', workspaceId: null, workspaceProvenance: 'UNAVAILABLE',
      env: 'preview', platformRoles: [], identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
      feishuUserId: null, feishuOpenId: null, feishuIdentityProvenance: 'UNAVAILABLE',
      sessionId: null, sessionRevision: null, sessionProvenance: 'UNAVAILABLE' } };
}

function oauthStageReader(userId = 'stage-producer'): CanonicalHostActor {
  const reader = nativeStageReader(userId);
  reader.objectAccessActor = { ...reader.objectAccessActor!,
    subjectDecision: { ...reader.objectAccessActor!.subjectDecision, source: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      version: 'feishu-oauth-verified.v1' },
    applicationScopeProvenance: 'HOST_CONFIGURED_MIAODA_APP_ID', identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
    feishuOpenId: 'ou_synthetic_legacy', feishuIdentityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
    sessionId: 'synthetic-session', sessionRevision: 1, sessionProvenance: 'SERVER_OPAQUE_SESSION' };
  return reader;
}

function sharedStageReaderFixture(options: { receipt?: boolean; historical?: boolean } = {}) {
  const producer = 'stage-producer';
  const revision = structuredClone(jobAidReadingFixture().current!);
  Object.assign(revision, { workRevisionRef: 'JAWR-stage', workRevision: 3, requestId: 'SAVE-stage',
    actionAttemptId: 'ATT-stage', workItemId: 'WI-stage', documentVersionId: 'DV-stage',
    basedOnWorkItemRevision: 5, previousWorkRevisionRef: null });
  revision.content.methodBinding = structuredClone(JOBAID_METHOD_BINDING);
  revision.content.roundCompletion = 'COMPLETE_WITH_OPEN_QUESTIONS';
  const passage = revision.content.evidence.find(item => item.kind === 'DOCUMENT_PASSAGE');
  if (!passage || passage.kind !== 'DOCUMENT_PASSAGE') throw new Error('SYNTHETIC_PASSAGE_REQUIRED');
  Object.assign(passage, { workItemId: 'WI-source', documentVersionId: revision.documentVersionId });
  revision.content.evidence.push({ ...passage, evidenceRef: 'evidence-related',
    workItemId: 'WI-related', documentVersionId: 'DV-related', sourceRefId: 'SR-related' });
  const workItem: CanonicalWorkItemProjection = {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate', workItemId: revision.workItemId,
    requestId: 'intake-stage', revision: 5, phase: 'CANDIDATE_READBACK_VERIFIED', permissionSnapshotVersion: 'permission-stage',
    parseAuthorization: { action: 'PARSE_PDF', actorFingerprint: 'synthetic', decisionId: 'synthetic',
      decisionHash: 'synthetic', permissionSnapshotVersion: 'permission-stage' },
    source: { documentId: 'DOC-stage', documentVersionId: revision.documentVersionId,
      sourceArtifactId: 'ART-stage', sourceFileSha256: 'a'.repeat(64), sourceByteLength: 1234,
      parserRequestId: null, driveFileToken: null, driveSourceVersion: null },
    classification: { status: 'CONFIRMED', normalizedFamily: 'FTD', classifierReleaseId: 'synthetic-stage-classifier',
      classifierReleaseHash: 'a'.repeat(64), parserProfileId: 'synthetic-stage-parser',
      parserProfileHash: 'b'.repeat(64), fingerprint: 'c'.repeat(64) }, package: null,
    integratedAssessment: null, failure: null, recordingFailure: null,
  };
  const common = projectCommonAssessmentContext(workItem, { context: { status: 'AVAILABLE' },
    documentReadingStatus: 'AVAILABLE', items: [], sections: [], resourceRefs: [] }, []);
  const input = buildJobAidProblemTask({ workItem, actorUserId: producer, permissionSnapshotVersion: 'permission-stage',
    purpose: 'INITIAL_PROBLEM_ASSESSMENT', sourceCatalog: revision.content.evidence,
    sourceBindings: [{ kind: 'SOURCE_FILE', workItemId: workItem.workItemId,
      documentVersionId: revision.documentVersionId, artifactRef: 'ART-stage', artifactSha256: 'a'.repeat(64) }],
    common, previousWork: null, expectedWorkRevision: 0, priorAssessmentRefs: [] });
  const original = originalFixture(); original.binding.documentVersionId = revision.documentVersionId;
  original.binding.sourceArtifactId = workItem.source.sourceArtifactId;
  for (const locator of original.source.sourceLocators) locator.artifactId = workItem.source.sourceArtifactId;
  input.executionMode = 'AILY_AGENT_V1'; input.requestedModelRef = 'aily/deepseek-v4-pro';
  input.checklistBinding = buildJobAidChecklistBinding({ workItemId: revision.workItemId,
    documentVersionId: revision.documentVersionId, basedOnWorkItemRevision: 5 });
  input.modelInput.executionMode = 'AILY_AGENT_V1'; input.modelInput.executionRoleMapping = structuredClone(AILY_TASK_ROLE_MAPPING);
  input.modelInput.checklistBinding = structuredClone(input.checklistBinding);
  input.modelInput.documentOverview.original = { binding: original.binding, coverage: original.coverage, findings: original.source.findings };
  input.modelInput.programOriginal = { binding: original.binding, coverage: original.coverage,
    units: original.source.units, sourceLocators: original.source.sourceLocators, findings: original.source.findings };
  const model = { modelRef: input.requestedModelRef, displayName: 'DeepSeek V4 Pro', providerKind: 'BUILT_IN' as const,
    settingsRevision: 0, selectedAt: '2026-10-29T00:00:00.000Z' };
  const task = sealTaskEnvelope({ schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', actionAttemptId: revision.actionAttemptId,
    operationRef: 'AQ-stage', taskType: 'OPENCLAW_DYNAMIC_EVALUATION', priority: 100, tenantId: 'tenant-A',
    workItemId: revision.workItemId, inputRevision: 5, baseRevision: 5, documentVersionId: revision.documentVersionId,
    sourceRefs: [{ ref: 'ART-stage', sha256: 'a'.repeat(64) }], allowedConnectors: [], hostResolvedMissingInputs: [],
    modelInput: input, executionModel: model, deadline: '2026-10-31T00:00:00.000Z', idempotencyKey: 'stage-synthetic-request' });
  const readProof = { kind: 'ASSESSMENT_WORK_READ', workRevisionRef: revision.workRevisionRef,
    workRevision: revision.workRevision, saveRequestId: revision.requestId, observedAt: '2026-10-29T00:01:00.000Z' };
  const sourceAssessment = { actionAttemptId: revision.actionAttemptId, workRevisionRef: revision.workRevisionRef,
    workRevision: revision.workRevision, saveRequestId: revision.requestId, readObservedAt: readProof.observedAt };
  const bytes = Buffer.from(canonicalJson(deterministicJobAidOverallBody(revision, sourceAssessment)));
  const artifact: AilyStageOverallReceipt['artifact'] = { ref: 'artifact://synthetic-stage',
    sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length,
    mediaType: 'application/json', storeRole: 'UnifiedArtifactStoreCandidate' };
  const receipt: AilyStageOverallReceipt = { schemaVersion: 'wiselink.aily-stage-overall.v1',
    workRevisionRef: revision.workRevisionRef, workRevision: revision.workRevision, sourceAssessment,
    artifact, observedAt: '2026-10-29T00:02:00.000Z' };
  const row: ActionAttemptRow = { attemptId: task.actionAttemptId, operationRef: task.operationRef, triggerRequestId: 'REQ-stage',
    workItemId: task.workItemId, actionType: task.taskType, attemptNo: 1, status: 'SUCCEEDED', requestOrigin: ACTION_ATTEMPT_REQUEST_ORIGIN,
    tenantId: task.tenantId, actorUserId: producer, priority: 100, inputRevision: 5, baseRevision: 5,
    documentVersionId: task.documentVersionId, taskEnvelopeJson: canonicalJson(task), taskInputHash: task.inputHash,
    executionModelJson: canonicalJson(model), resultEnvelopeJson: null, resultContentHash: null, idempotencyKey: task.idempotencyKey,
    claimCount: 1, retryCount: 0, maxAttempts: 3, leaseOwner: null, leaseToken: null, leaseGeneration: 1,
    leaseExpiresAt: null, lastHeartbeatAt: null, nextAttemptAt: null, deadlineAt: new Date(task.deadline),
    cancelRequestedAt: null, cancelReason: null, terminalReason: null, projectionApplied: false,
    executorSessionKey: 'g2-action-attempt:AQ-stage', commitStartedAt: null, leaseSlot: null,
    startedAt: new Date('2026-10-29T00:00:00.000Z'), completedAt: new Date('2026-10-29T00:03:00.000Z'),
    createdAt: new Date('2026-10-29T00:00:00.000Z'), updatedAt: new Date('2026-10-29T00:03:00.000Z'), reviewActivityJson: '[]' };
  const journal = () => { row.reviewActivityJson = canonicalJson([readProof,
    ...(options.receipt === false ? [] : [{ kind: 'AILY_STAGE_OVERALL', receipt, observedAt: receipt.observedAt }])]); };
  journal();
  const reSeal = () => {
    const { inputHash: _hash, ...unsealed } = task;
    Object.assign(task, sealTaskEnvelope(unsealed));
    row.taskEnvelopeJson = canonicalJson(task); row.taskInputHash = task.inputHash;
  };
  const assertValidSealedTask = () => {
    const parsed = parseTaskEnvelope(row.taskEnvelopeJson!);
    expect(parsed.inputHash).toBe(row.taskInputHash);
    expect(parseJobAidProblemTask(parsed).modelInput.executionMode).toBe('AILY_AGENT_V1');
  };
  assertValidSealedTask(); expect(parseAilyStageOverall(receipt)).toEqual(receipt);
  const artifactBytes = new Map<string, Uint8Array>([[artifact.ref, bytes]]);
  const artifactStore = { readActualBytes: jest.fn(async (selected: { ref: string }) => {
    const actual = artifactBytes.get(selected.ref); if (!actual) throw new Error('SYNTHETIC_ARTIFACT_MISSING'); return actual;
  }) };
  workItem.integratedAssessment = { status: 'OVERALL_CANDIDATE_READY', baseRules: {
    schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA, status: 'CANDIDATE_ONLY', revision: 1, sourceResultId: 'synthetic-result',
    workRevisionRef: revision.workRevisionRef, workRevision: revision.workRevision, issueCount: revision.content.issues.length,
    openQuestionCount: 1, roundCompletion: revision.content.roundCompletion, methodBinding: revision.content.methodBinding,
    headline: revision.content.headline, listBrief: revision.content.listBrief, artifact, actionAttemptId: revision.actionAttemptId,
    readingResult: jobAidReadingResult(revision),
  }, overallSynthesis: null };
  const final = buildJobAidOverallProjection({ workItem, revision, artifact, actionAttemptId: revision.actionAttemptId,
    sourceResultId: 'synthetic-final', applicabilityStatus: 'WAITING_INPUT' });
  final.readingResult!.evidence.push({ ...passage, evidenceRef: 'evidence-final', workItemId: 'WI-final',
    documentVersionId: 'DV-final', sourceRefId: 'SR-final' });
  workItem.integratedAssessment.overallSynthesis = final;
  if (options.historical) { workItem.source.documentVersionId = 'DV-current'; workItem.integratedAssessment.overallSynthesis = null; }
  const deniedWorks = new Set<string>(); const deniedDocuments = new Set<string>();
  const queries: Array<ReturnType<PgDialect['sqlToQuery']>> = [];
  const database = { execute: jest.fn(async (statement: SQL) => {
    const query = new PgDialect().sqlToQuery(statement); queries.push(query);
    const ids = query.params.filter((value): value is string => typeof value === 'string' && value.startsWith('['))
      .flatMap(value => JSON.parse(value) as string[]);
    return [{ allowed: !ids.some(id => deniedWorks.has(id) || deniedDocuments.has(id)) }];
  }) };
  const write = jest.fn(async () => { throw new Error('SYNTHETIC_READER_MUST_NOT_WRITE'); });
  const authorization = { authorize: jest.fn().mockResolvedValue({ allowed: true, action: 'READ_DOCUMENT_PARSING',
    actorFingerprint: 'synthetic', decisionId: 'synthetic', decisionHash: 'synthetic', permissionSnapshotVersion: 'permission-stage' }) };
  const permissionSnapshots = { freshRead: jest.fn().mockResolvedValue({ permissionSnapshotVersion: 'permission-stage' }) };
  const registrar = { getTenantScopedByWorkItemId: jest.fn().mockResolvedValue(workItem), compareAndSet: write };
  const documents = new Map([['WI-stage', 'DV-stage'], ['WI-source', 'DV-stage'], ['WI-related', 'DV-related'], ['WI-final', 'DV-final']]);
  const workItems = { readReadableAutoProcessingCompletion: jest.fn().mockResolvedValue(null),
    loadAuthorizationBinding: jest.fn(async (selection: { workItemId: string }) =>
      documents.has(selection.workItemId) ? { documentVersionId: documents.get(selection.workItemId) } : null) };
  const conversations = { hasActiveOfficialActorMapping: jest.fn().mockResolvedValue(true) };
  const repository = { readByAttemptId: jest.fn(async () => row), markCommitting: write, finishTerminal: write };
  const attempts = new ActionAttemptLifecycleService(repository as never, fixedModelSettings());
  const work = { readByRef: jest.fn().mockResolvedValue(revision), saveValidated: write, recordAilyStage: write,
    readBrowserSnapshot: jest.fn(async () => ({ execution: { attemptId: row.attemptId, attemptRef: row.operationRef,
      actionType: row.actionType, status: row.status, executionMode: 'AILY_AGENT_V1', executionModel: model,
      activityJson: row.reviewActivityJson, createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null },
      current: revision, savedActivity: [], latestAttempt: { attemptId: row.attemptId, status: row.status, inputRevision: row.inputRevision } })) };
  const service = new CanonicalJobAidProblemService(registrar as never, artifactStore as never, {} as never,
    authorization as never, permissionSnapshots as never, attempts, workItems as never, conversations as never,
    {} as never, work as never, undefined, undefined, undefined, database as never);
  const readExact = (reader = nativeStageReader()) => service.readBrowserKnowledgeRevision(workItem.workItemId, revision.workRevisionRef, reader);
  return { producer, revision, workItem, input, task, row, receipt, readProof, final, journal, reSeal, assertValidSealedTask,
    artifactBytes, artifactStore, deniedWorks, deniedDocuments, queries, database, documents,
    authorization, permissionSnapshots, registrar, workItems, conversations, repository, work, service, readExact, write };
}

describe('real public JobAid stage reader keeps producer and current reader separate', () => {
  it('reads another creator through the authorized native knowledge reader with exact stage and final evidence', async () => {
    const h = sharedStageReaderFixture(); const reader = nativeStageReader();
    await expect(h.service.readBrowserRevision(h.workItem.workItemId, h.revision.workRevisionRef, reader))
      .resolves.toBe(h.revision);
    const result = await h.readExact(reader);
    expect(result.revision).toBe(h.revision); expect(result.overall).toEqual({ status: 'CANDIDATE_ONLY', readingResult: h.final.readingResult });
    expect(result.stageOverall).toEqual({ status: 'CURRENT', receipt: h.receipt, readingResult: jobAidReadingResult(h.revision) });
    expect(h.authorization.authorize).toHaveBeenCalledWith({ actor: reader, action: 'READ_DOCUMENT_PARSING', workItemId: h.workItem.workItemId });
    expect(h.permissionSnapshots.freshRead).toHaveBeenCalled();
    expect(h.work.readByRef).toHaveBeenCalledWith({ tenantId: reader.tenantId, workItemId: h.workItem.workItemId, workRevisionRef: h.revision.workRevisionRef });
    expect(h.repository.readByAttemptId).toHaveBeenCalledWith(h.revision.actionAttemptId);
    expect(h.workItems.loadAuthorizationBinding).toHaveBeenCalledWith({ tenantId: reader.tenantId, actorUserId: reader.userId,
      workItemId: 'WI-final', readScope: 'TENANT' }, h.database);
    expect(h.queries).toHaveLength(3);
    expect(h.work.readByRef).toHaveBeenCalledTimes(2);
    expect(h.work.readBrowserSnapshot).not.toHaveBeenCalled();
    for (const query of h.queries) {
      expect(query.sql).toContain('native_app_shared_read_allowed'); expect(query.sql).toContain("current_setting('app.user_id',true)");
      expect(query.params).toContain(reader.tenantId); expect(query.params).toContain(reader.userId);
      expect(query.params).not.toContain(h.producer);
    }
    expect(h.artifactStore.readActualBytes).toHaveBeenCalledWith(h.receipt.artifact);
    expect(h.conversations.hasActiveOfficialActorMapping).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled();
  });

  it('reads another creator body and final even when that exact Aly revision has no stage receipt', async () => {
    const h = sharedStageReaderFixture({ receipt: false });
    await expect(h.readExact()).resolves.toEqual({ revision: h.revision,
      overall: { status: 'CANDIDATE_ONLY', readingResult: h.final.readingResult } });
    expect(h.artifactStore.readActualBytes).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled();
  });

  it('uses the same source-authorized native rule in the real current-workspace reader', async () => {
    const h = sharedStageReaderFixture();
    await expect(h.service.readBrowser(h.workItem.workItemId, nativeStageReader())).resolves.toMatchObject({
      current: h.revision, stageOverall: { status: 'CURRENT', receipt: h.receipt }, autoProcessingAcknowledgement: null });
    expect(h.database.execute).toHaveBeenCalled(); expect(h.artifactStore.readActualBytes).toHaveBeenCalledTimes(1);
    expect(h.write).not.toHaveBeenCalled();
  });

  it('keeps exact historical task/row/revision DV readable and marks the stage stale against the current WI', async () => {
    const h = sharedStageReaderFixture({ historical: true });
    await expect(h.readExact()).resolves.toMatchObject({ revision: h.revision, overall: null, stageOverall: { status: 'STALE', receipt: h.receipt } });
    expect(h.task.documentVersionId).toBe(h.revision.documentVersionId); expect(h.task.documentVersionId).not.toBe(h.workItem.source.documentVersionId);
    expect(h.write).not.toHaveBeenCalled();
  });

  it('retains the valid old OAuth owner read and refuses another OAuth reader', async () => {
    const h = sharedStageReaderFixture(); const owner = oauthStageReader(h.producer);
    expect(isHostedCanonicalFinalUserActor(owner.objectAccessActor!)).toBe(true);
    await expect(h.readExact(owner)).resolves.toMatchObject({ revision: h.revision, stageOverall: { receipt: h.receipt } });
    expect(h.database.execute).not.toHaveBeenCalled();
    expect(h.conversations.hasActiveOfficialActorMapping).toHaveBeenCalledWith({ tenantId: owner.tenantId, actorId: h.producer }, undefined);
    h.artifactStore.readActualBytes.mockClear();
    await expect(h.readExact(oauthStageReader('other-oauth'))).rejects.toThrow('AILY_STAGE_OVERALL_BINDING_CHANGED');
    expect(h.artifactStore.readActualBytes).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled();
  });

  it.each(['transport', 'provenance', 'app', 'tenant', 'subject', 'kind-only', 'signed-aily', 'team'] as const)(
    'does not infer native shared access from %s', async invalid => {
      const h = sharedStageReaderFixture(); const reader = nativeStageReader();
      const identity = reader.objectAccessActor!;
      if (invalid === 'transport') Reflect.set(identity, 'transport', 'DIRECT_HTTP');
      if (invalid === 'provenance') Reflect.set(identity, 'identityProvenance', 'FEISHU_OAUTH_USER_ACCESS_TOKEN');
      if (invalid === 'app') reader.appId = 'app_other';
      if (invalid === 'tenant') identity.tenantId = 'tenant-other';
      if (invalid === 'subject') identity.canonicalSubject.id = 'subject-other';
      if (invalid === 'kind-only') { reader.objectAccessActor = undefined; Reflect.set(h.revision.content, 'kind', 'AILY_AGENT_V1'); }
      if (invalid === 'team') { reader.objectAccessActor = undefined; Reflect.set(h.revision.content, 'kind', 'TEAM_AGENT'); }
      if (invalid === 'signed-aily') {
        const signed: CanonicalAilyFinalUserActorContext = { ...identity, transport: 'AILY_SIGNED_MCP_HTTP',
          subjectDecision: { ...identity.subjectDecision, source: 'AILY_SIGNED_JWT_AND_MIAODA_AUTHNPAAS_ID_CONVERT',
            version: 'aily-jwt-hs256.authnpaas-user-convert.v1' },
          applicationScopeProvenance: 'HOST_CONFIGURED_MIAODA_APP_ID', identityProvenance: 'AILY_SIGNED_JWT',
          feishuIdentityProvenance: 'AILY_SIGNED_JWT', feishuUserId: 'synthetic-feishu-user', feishuOpenId: null,
          agentId: 'agent_synthetic', tokenExpiresAt: '2026-10-31T00:00:00.000Z',
          sessionId: null, sessionRevision: null, sessionProvenance: 'UNAVAILABLE' };
        expect(isHostedCanonicalFinalUserActor(signed)).toBe(true);
        Reflect.set(reader, 'objectAccessActor', signed);
      }
      await expect(h.readExact(reader)).rejects.toThrow('AILY_STAGE_OVERALL_BINDING_CHANGED');
      expect(h.artifactStore.readActualBytes).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled();
    });

  it.each(['producer', 'task-tenant', 'task-work', 'task-attempt', 'task-operation', 'task-document', 'task-input',
    'row-producer', 'row-tenant', 'row-work', 'row-document', 'row-base', 'row-input-hash', 'revision-base'] as const)(
    'rejects %s binding drift even with a valid sealed task', async mismatch => {
      const h = sharedStageReaderFixture();
      if (mismatch === 'producer') h.input.actorUserId = 'different-producer';
      if (mismatch === 'task-tenant') h.task.tenantId = 'tenant-other';
      if (mismatch === 'task-work') h.task.workItemId = 'WI-other';
      if (mismatch === 'task-attempt') h.task.actionAttemptId = 'ATT-other';
      if (mismatch === 'task-operation') h.task.operationRef = 'AQ-other';
      if (mismatch === 'task-document') h.task.documentVersionId = 'DV-other';
      if (mismatch === 'task-input') h.task.inputRevision = 6;
      h.input.checklistBinding = buildJobAidChecklistBinding({ workItemId: h.task.workItemId,
        documentVersionId: h.task.documentVersionId, basedOnWorkItemRevision: h.task.inputRevision });
      h.input.modelInput.checklistBinding = structuredClone(h.input.checklistBinding);
      h.reSeal(); h.assertValidSealedTask();
      if (mismatch === 'row-producer') h.row.actorUserId = 'different-producer';
      if (mismatch === 'row-tenant') h.row.tenantId = 'tenant-other';
      if (mismatch === 'row-work') h.row.workItemId = 'WI-other';
      if (mismatch === 'row-document') h.row.documentVersionId = 'DV-other';
      if (mismatch === 'row-base') h.row.baseRevision = 6;
      if (mismatch === 'row-input-hash') h.row.taskInputHash = 'f'.repeat(64);
      if (mismatch === 'revision-base') h.revision.basedOnWorkItemRevision = 6;
      await expect(h.readExact()).rejects.toThrow();
      expect(h.artifactStore.readActualBytes).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled();
    });

  it.each(['read-time', 'read-save', 'receipt-attempt', 'receipt-save', 'receipt-revision', 'artifact-bytes'] as const)(
    'rejects %s drift through exact READ and actual artifact consumers', async mismatch => {
      const h = sharedStageReaderFixture();
      if (mismatch === 'read-time') h.readProof.observedAt = '2026-10-29T00:01:30.000Z';
      if (mismatch === 'read-save') h.readProof.saveRequestId = 'SAVE-other';
      if (mismatch === 'receipt-attempt') h.receipt.sourceAssessment.actionAttemptId = 'ATT-other';
      if (mismatch === 'receipt-save') h.receipt.sourceAssessment.saveRequestId = 'SAVE-other';
      if (mismatch === 'receipt-revision') { h.receipt.workRevision = 9; h.receipt.sourceAssessment.workRevision = 9; }
      if (mismatch === 'artifact-bytes') {
        const bytes = Buffer.from(canonicalJson({ different: 'valid saved JSON but not this stage body' }));
        h.artifactBytes.set(h.receipt.artifact.ref, bytes);
        h.receipt.artifact.sha256 = createHash('sha256').update(bytes).digest('hex'); h.receipt.artifact.byteLength = bytes.length;
      }
      h.journal(); expect(parseAilyStageOverall(h.receipt)).toEqual(h.receipt); h.assertValidSealedTask();
      await expect(h.readExact()).rejects.toThrow(mismatch === 'artifact-bytes' ? 'AILY_STAGE_OVERALL_ARTIFACT_UNCONFIRMED'
        : mismatch.startsWith('read-') ? 'JOBAID_PROGRAM_INDEPENDENT_READ_REQUIRED' : 'AILY_STAGE_OVERALL_BINDING_CHANGED');
      if (mismatch === 'artifact-bytes') expect(h.artifactStore.readActualBytes).toHaveBeenCalledTimes(1);
      expect(h.write).not.toHaveBeenCalled();
    });

  it.each(['primary', 'related-work', 'related-document', 'final-source'] as const)(
    'propagates current %s authorization revocation before returning saved content', async denied => {
      const h = sharedStageReaderFixture();
      if (denied === 'primary') h.authorization.authorize.mockResolvedValue({ allowed: false });
      if (denied === 'related-work') h.deniedWorks.add('WI-related');
      if (denied === 'related-document') h.deniedDocuments.add('DV-related');
      if (denied === 'final-source') h.documents.delete('WI-final');
      await expect(h.readExact()).rejects.toMatchObject({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404 });
      if (denied === 'primary') expect(h.work.readByRef).not.toHaveBeenCalled();
      else expect(h.queries.some(query => query.params.includes('stage-reader'))).toBe(true);
      expect(h.write).not.toHaveBeenCalled();
    });
});
