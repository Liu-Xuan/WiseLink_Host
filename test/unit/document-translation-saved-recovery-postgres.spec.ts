import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../../server/modules/action-attempt/action-attempt-envelope';
import { parseDocumentTranslationTaskEnvelope, sealDocumentTranslationTaskEnvelope } from '../../server/modules/action-attempt/document-translation-task-envelope';
import { DocumentTranslationAttemptRepository } from '../../server/modules/action-attempt/document-translation-attempt.repository';
import { buildTranslationSourcePlan } from '../../server/modules/canonical-host/canonical-translation-source-plan';
import { nextTranslationWorkV2 } from '../../server/modules/canonical-host/canonical-translation-v2-batch';
import { buildTranslationWorkspaceReadingV2, checkTranslationBlockV2 } from '../../server/modules/canonical-host/canonical-translation-v2-quality';
import { readTranslationWorkspaceSnapshot } from '../../server/modules/canonical-host/canonical-translation-workspace.repository';
import { CanonicalTranslationV2Service } from '../../server/modules/canonical-host/canonical-translation-v2.service';
import { taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';
import type { TranslationBlockRevisionV2, TranslationGenerationRequestV2 } from '@shared/canonical-translation-v2.interface';

const databaseUrl = process.env.DOCUMENT_TRANSLATION_RESUME_TEST_DATABASE_URL;
const describePg = databaseUrl ? describe : describe.skip;
const scope = { tenantId: 'resume-tenant', actorUserId: 'resume-actor', documentVersionId: 'DV-resume' };
const parseRunId = 'PR-resume';
const rootRequestId = 'auto-translation-0123456789abcdef0123456789abcdef';
const artifact = { storeRole: 'UnifiedArtifactStoreCandidate' as const,
  ref: `document-original://${scope.documentVersionId}/${parseRunId}`,
  sha256: 'b'.repeat(64), byteLength: 100, mediaType: 'application/json' as const };
const binding = { documentVersionId: scope.documentVersionId, parseRunId, parseRevision: 2,
  sourceArtifactId: 'SRC-resume', sourceSha256: 'a'.repeat(64), sourceByteLength: 200 };
const model = taskModelSelection('m3probe/minimax-m3', new Date('2026-09-29T00:00:00Z'));
const time = '2026-09-29T00:00:00.000Z';

function fixture() {
  const plan = buildTranslationSourcePlan({ documentVersionId: scope.documentVersionId,
    packageId: parseRunId, title: 'Synthetic recovery', parsedArtifact: artifact,
    source: { modules: [0, 1].map(index => ({ moduleId: `m${index}`, order: index })),
      findings: [], references: [],
      sourceLocators: [0, 1].map(index => ({ sourceRefId: `sr${index}`, kind: 'pdf_page' as const,
        artifactId: 'source', pageStart: index + 1, pageEnd: index + 1, charStart: null,
        charEnd: null, charOffsetUnit: null, normalizedPath: null, xpath: null,
        elementId: null, quote: null, bbox: null })),
      units: [0, 1].map(index => ({ unitId: `u${index}`, kind: 'paragraph', moduleId: `m${index}`,
        parentUnitId: null, order: index, depth: 0, continuityKey: `u${index}`,
        sourceRefIds: [`sr${index}`], sourceSegmentIds: [`seg${index}`], mapping: {},
        payload: { text: `Synthetic procedure ${index + 1}.`, role: 'body' } })) } });
  const boundPlan = { ...plan, source: { ...plan.source, originalBinding: binding } };
  const modelInput = { schemaVersion: 'wiselink.3_1.translation_task.v2' as const,
    workspaceId: 'TW-resume', planRevision: 1, contextRevision: 1,
    methodVersion: 'semantic-translation@2.0', documentProducer: 'HOSTED_M3' as const,
    source: boundPlan.source };
  const root = sealDocumentTranslationTaskEnvelope({ schemaVersion: 'wiselink.document.translation_task.v1',
    actionAttemptId: 'DTA-resume-1', operationRef: 'DTQ-resume-1', tenantId: scope.tenantId,
    documentVersionId: scope.documentVersionId, parseRunId, parseRevision: 2,
    workspaceId: 'TW-resume', modelInput, deadline: '2026-09-30T00:00:00.000Z',
    idempotencyKey: 'root-resume' });
  const prior = sealDocumentTranslationTaskEnvelope({ schemaVersion: 'wiselink.document.translation_task.v1',
    actionAttemptId: 'DTA-resume-2', operationRef: 'DTQ-resume-2', tenantId: scope.tenantId,
    documentVersionId: scope.documentVersionId, parseRunId, parseRevision: 2,
    workspaceId: 'TW-resume', modelInput, deadline: '2026-09-30T00:00:00.000Z',
    idempotencyKey: 'original-resume', knownFailureRecovery: {
      kind: 'KNOWN_FAILURE', predecessorAttemptId: root.actionAttemptId,
      predecessorAttemptRef: root.operationRef } });
  const provenance = (ref: string) => ({ authorKind: 'MODEL' as const,
    authorUserId: scope.actorUserId, executionModel: model, modelVersion: 'test',
    skillVersion: 'test', promptVersion: 'test', generationRequestRef: ref,
    originAttemptId: prior.actionAttemptId, providerRequestId: null,
    usage: { inputTokens: 1, outputTokens: 1 } });
  const revisions: TranslationBlockRevisionV2[] = boundPlan.blocks.map((block, index) => {
    const generationRequestRef = `TG-${index}`;
    const candidate = { blockId: block.blockId,
      elements: [{ elementId: `e${index}`, kind: 'paragraph' as const,
        translatedText: `合成步骤 ${index + 1}`, anchorIds: block.anchorIds }] };
    const review = { result: { blockId: block.blockId, issues: [] },
      provenance: provenance(generationRequestRef) };
    return { blockRevisionId: `TB-${index}`, workspaceId: prior.workspaceId,
      blockId: block.blockId, planRevision: 1, contentRevision: 1, rowVersion: 1,
      candidate, dependencies: { planRevision: 1, contextRevision: 1,
        sourceAnchorIds: block.anchorIds, contextAnchorIds: [], methodVersion: modelInput.methodVersion },
      provenance: provenance(generationRequestRef), generatedAt: null, savedAt: time,
      check: checkTranslationBlockV2({ plan: boundPlan, candidate,
        ...(index === 0 ? { semanticReview: review } : {}) }),
      checkedAt: index === 0 ? time : null, selectedForReading: index === 0 };
  });
  const dependencies = revisions[0].dependencies;
  const generations: TranslationGenerationRequestV2[] = revisions.map((revision, index) => ({
    generationRequestRef: `TG-${index}`, clientRequestId: `gen-${index}`,
    attemptId: prior.actionAttemptId, leaseGeneration: 1,
    blockIds: [revision.blockId], dependencies: revision.dependencies,
    purpose: 'GENERATE', targetBlockRevisionId: revision.blockRevisionId,
    status: 'SAVED', registeredAt: time, finishedAt: time, error: null }));
  generations.push({ generationRequestRef: 'TG-check-failed', clientRequestId: 'check-failed',
    attemptId: prior.actionAttemptId, leaseGeneration: 1,
    blockIds: revisions.map(revision => revision.blockId), dependencies,
    purpose: 'CHECK_BATCH', targetBlockRevisionId: null,
    checkTargets: revisions.map(revision => ({ blockId: revision.blockId,
      blockRevisionId: revision.blockRevisionId, rowVersion: revision.rowVersion })),
    status: 'FAILED', registeredAt: time, finishedAt: time,
    error: { origin: 'OUTPUT_CONTRACT', code: 'DOCUMENT_TRANSLATION_CHECK_FAILED',
      outcome: 'KNOWN_FAILURE', retryable: false } });
  return { boundPlan, modelInput, root, prior, revisions, generations };
}

describePg('saved document translation recovery on isolated PostgreSQL temp tables', () => {
  let client: ReturnType<typeof postgres>;
  let repository: DocumentTranslationAttemptRepository;

  beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, onnotice() {} });
    await client.unsafe(`
      CREATE TEMP TABLE dm_document_version (document_version_id text PRIMARY KEY);
      CREATE TEMP TABLE dm_document_parse_run (tenant_id text, document_version_id text,
        parse_run_id text, parse_revision integer, status text, manifest_artifact jsonb);
      CREATE TEMP TABLE dm_document_reading_run (tenant_id text, actor_user_id text,
        document_version_id text, request_id text, status text, deadline_at timestamptz,
        lease_expires_at timestamptz);
      CREATE TEMP TABLE action_attempt (
        id uuid DEFAULT gen_random_uuid(), attempt_id text PRIMARY KEY, work_item_id text,
        subject_kind text, matter_id text, matter_revision_id text, action_type text,
        attempt_no integer, trigger_request_id text, request_origin text, status text,
        producer_run_id text, package_artifact_ref text, package_artifact_sha256 text,
        failure_artifact_ref text, failure_artifact_sha256 text, error_code text,
        error_message text, actor_user_id text, tenant_id text, started_at timestamptz,
        completed_at timestamptz, created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(), priority integer DEFAULT 100,
        input_revision integer, base_revision integer, document_version_id text,
        task_envelope_json text, task_input_hash text, result_envelope_json text,
        result_content_hash text, idempotency_key text UNIQUE, claim_count integer DEFAULT 0,
        retry_count integer DEFAULT 0, max_attempts integer DEFAULT 3, lease_owner text,
        lease_token text, lease_generation integer DEFAULT 0, lease_expires_at timestamptz,
        last_heartbeat_at timestamptz, next_attempt_at timestamptz, deadline_at timestamptz,
        cancel_requested_at timestamptz, cancel_reason text, terminal_reason text,
        projection_applied boolean DEFAULT false, executor_session_key text,
        operation_ref text UNIQUE, commit_started_at timestamptz, lease_slot integer,
        review_activity_json text, execution_model_json text, _created_by text, _updated_by text);
      CREATE TEMP TABLE translation_workspace (
        id uuid DEFAULT gen_random_uuid(), workspace_id text PRIMARY KEY, tenant_id text,
        work_item_id text, subject_kind text, document_version_id text, package_id text,
        parsed_artifact_ref text, parsed_artifact_sha256 text, target_locale text,
        plan_revision integer, context_revision integer, source_plan_json text,
        method_version text, active_attempt_id text, generation_requests_json text,
        row_version integer, result_artifact_json text, result_manifest_json text,
        _created_at timestamptz DEFAULT now(), _created_by text,
        _updated_at timestamptz DEFAULT now(), _updated_by text);
      CREATE TEMP TABLE translation_block_revision (
        id uuid DEFAULT gen_random_uuid(), block_revision_id text PRIMARY KEY,
        tenant_id text, work_item_id text, workspace_id text, block_id text,
        plan_revision integer, content_revision integer, generation_request_ref text,
        origin_attempt_id text, author_kind text, author_user_id text,
        candidate_json text, dependencies_json text, provenance_json text,
        generated_at timestamptz, saved_at timestamptz, check_status text,
        check_json text, checked_at timestamptz, selected_for_reading boolean,
        row_version integer, _created_at timestamptz DEFAULT now(), _created_by text,
        _updated_at timestamptz DEFAULT now(), _updated_by text);
    `);
    const hosted = readFileSync(resolve(process.cwd(), 'migrations/0070_source_intake_acquisition_intent.sql'), 'utf8');
    const subjectConstraint = hosted.match(/ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_subject CHECK \([\s\S]*?\n\);/u)?.[0];
    const original = readFileSync(resolve(process.cwd(), 'migrations/0048_document_translation_attempt_subject.sql'), 'utf8');
    const originalGuard = original.match(/CREATE FUNCTION action_attempt_check_document_original\(\)[\s\S]*?\$\$;/u)?.[0];
    const immutableGuard = original.match(/CREATE FUNCTION action_attempt_preserve_document_subject\(\)[\s\S]*?\$\$;/u)?.[0];
    if (!subjectConstraint || !originalGuard || !immutableGuard)
      throw new Error('DOCUMENT_TRANSLATION_MIGRATION_GUARD_NOT_FOUND');
    await client.unsafe(subjectConstraint);
    await client.unsafe(originalGuard.replace('CREATE FUNCTION ', 'CREATE FUNCTION pg_temp.'));
    await client.unsafe(immutableGuard.replace('CREATE FUNCTION ', 'CREATE FUNCTION pg_temp.'));
    await client.unsafe(`CREATE TRIGGER action_attempt_check_document_original
      BEFORE INSERT OR UPDATE ON action_attempt FOR EACH ROW
      EXECUTE FUNCTION pg_temp.action_attempt_check_document_original();
      CREATE TRIGGER action_attempt_preserve_document_subject
      BEFORE UPDATE ON action_attempt FOR EACH ROW
      EXECUTE FUNCTION pg_temp.action_attempt_preserve_document_subject();
      CREATE UNIQUE INDEX uk_action_attempt_document_number
        ON action_attempt(tenant_id,document_version_id,action_type,attempt_no)
        WHERE subject_kind='DOCUMENT_VERSION';
      CREATE UNIQUE INDEX uk_action_attempt_active_document_task
        ON action_attempt(tenant_id,document_version_id,action_type)
        WHERE subject_kind='DOCUMENT_VERSION'
          AND status IN ('QUEUED','RUNNING','RETRY_SCHEDULED','COMMITTING');`);
    repository = new DocumentTranslationAttemptRepository(drizzle(client) as never);
  });
  afterAll(async () => { await client?.end(); });

  async function seed(expired = false) {
    const base = fixture();
    const { inputHash: _hash, ...priorInput } = base.prior;
    const data = expired ? { ...base, prior: sealDocumentTranslationTaskEnvelope({
      ...priorInput, deadline: new Date(Date.now() - 60_000).toISOString() }) } : base;
    await client`TRUNCATE action_attempt,translation_workspace,translation_block_revision,
      dm_document_version,dm_document_parse_run`;
    await client`INSERT INTO dm_document_version(document_version_id) VALUES (${scope.documentVersionId})`;
    await client`INSERT INTO dm_document_parse_run(tenant_id,document_version_id,parse_run_id,
      parse_revision,status,manifest_artifact) VALUES (${scope.tenantId},${scope.documentVersionId},
      ${parseRunId},2,'PUBLISHED',${canonicalJson({ role: 'MANIFEST',
        relativePath: 'original/manifest.json', readback: 'VERIFIED',
        sha256: artifact.sha256, byteLength: artifact.byteLength })}::jsonb)`;
    await client`INSERT INTO action_attempt(attempt_id,subject_kind,action_type,attempt_no,
      trigger_request_id,request_origin,status,producer_run_id,error_code,actor_user_id,
      tenant_id,input_revision,document_version_id,task_envelope_json,task_input_hash,
      idempotency_key,deadline_at,terminal_reason,operation_ref,execution_model_json)
      VALUES (${data.root.actionAttemptId},'DOCUMENT_VERSION','DOCUMENT_TRANSLATE',1,
        ${rootRequestId},'HOST_DOCUMENT','FAILED',${parseRunId},'DOCUMENT_TRANSLATION_CHECK_FAILED',
        ${scope.actorUserId},${scope.tenantId},2,${scope.documentVersionId},
        ${canonicalJson(data.root)},${data.root.inputHash},${data.root.idempotencyKey},
        ${data.root.deadline},'DOCUMENT_TRANSLATION_CHECK_FAILED',${data.root.operationRef},${canonicalJson(model)})`;
    await client`INSERT INTO action_attempt(attempt_id,subject_kind,action_type,attempt_no,
      trigger_request_id,request_origin,status,producer_run_id,error_code,actor_user_id,
      tenant_id,input_revision,document_version_id,task_envelope_json,task_input_hash,
      idempotency_key,deadline_at,terminal_reason,operation_ref,execution_model_json)
      VALUES (${data.prior.actionAttemptId},'DOCUMENT_VERSION','DOCUMENT_TRANSLATE',2,
        ${`${rootRequestId}:known-failure`},'HOST_DOCUMENT','FAILED',${parseRunId},'DOCUMENT_TRANSLATION_CHECK_FAILED',
        ${scope.actorUserId},${scope.tenantId},2,${scope.documentVersionId},
        ${canonicalJson(data.prior)},${data.prior.inputHash},${data.prior.idempotencyKey},
        ${data.prior.deadline}, 'DOCUMENT_TRANSLATION_CHECK_FAILED',${data.prior.operationRef},${canonicalJson(model)})`;
    await client`INSERT INTO translation_workspace(workspace_id,tenant_id,work_item_id,subject_kind,
      document_version_id,package_id,parsed_artifact_ref,parsed_artifact_sha256,target_locale,
      plan_revision,context_revision,source_plan_json,method_version,active_attempt_id,
      generation_requests_json,row_version)
      VALUES (${data.prior.workspaceId},${scope.tenantId},NULL,'DOCUMENT_VERSION',
        ${scope.documentVersionId},${parseRunId},${artifact.ref},${artifact.sha256},'zh-CN',
        1,1,${canonicalJson(data.boundPlan)},${data.modelInput.methodVersion},
        ${data.prior.actionAttemptId},${canonicalJson(data.generations)},1)`;
    for (const revision of data.revisions) {
      await client`INSERT INTO translation_block_revision(block_revision_id,tenant_id,workspace_id,
        block_id,plan_revision,content_revision,generation_request_ref,origin_attempt_id,
        author_kind,author_user_id,candidate_json,dependencies_json,provenance_json,
        saved_at,check_status,check_json,checked_at,selected_for_reading,row_version)
        VALUES (${revision.blockRevisionId},${scope.tenantId},${revision.workspaceId},
          ${revision.blockId},${revision.planRevision},${revision.contentRevision},
          ${revision.provenance.generationRequestRef},${revision.provenance.originAttemptId},
          'MODEL',${scope.actorUserId},${canonicalJson(revision.candidate)},
          ${canonicalJson(revision.dependencies)},${canonicalJson(revision.provenance)},
          ${time},${revision.check ? 'CHECKED' : 'PENDING'},
          ${revision.check ? canonicalJson(revision.check) : null},${revision.checkedAt},
          ${revision.selectedForReading},1)`;
    }
    return data;
  }

  it('queues a unique successor, keeps saved candidates, and NEXT checks the old pending revision', async () => {
    const data = await seed();
    const current = { parseRunId, parseRevision: 2, modelInput: data.modelInput };
    const successor = await repository.resumeSavedKnownFailure(scope, data.prior.operationRef,
      rootRequestId, current, model);
    expect(successor.status).toBe('QUEUED');
    expect(successor.triggerRequestId).toBe(`${rootRequestId}:resume-3`);
    expect((await repository.latest(scope, rootRequestId))?.attemptId).toBe(successor.attemptId);
    const dispatch = await new MiaodaWorkItemRepository(drizzle(client) as never)
      .documentDeliveryDispatchState({ ...scope, readingRequestId: 'unused-reading',
        translationRequestId: rootRequestId, readingSelected: false, translationSelected: true });
    expect(dispatch).toEqual({ pending: true, missing: false });
    expect((await repository.resumeSavedKnownFailure(scope, data.prior.operationRef,
      rootRequestId, current, model)).attemptId).toBe(successor.attemptId);
    const snapshot = await readTranslationWorkspaceSnapshot(drizzle(client) as never,
      { tenantId: scope.tenantId, workItemId: null,
        documentVersionId: scope.documentVersionId, workspaceId: data.prior.workspaceId });
    expect(snapshot.revisions).toHaveLength(2);
    const reading = buildTranslationWorkspaceReadingV2(snapshot.workspace, snapshot.revisions);
    const next = nextTranslationWorkV2(snapshot.workspace, snapshot.revisions, reading,
      undefined, { batchSemanticChecks: true });
    expect(next).toMatchObject({ kind: 'CHECK', blockIds: [data.revisions[1].blockId] });
    expect(snapshot.workspace.generationRequests.filter(request => request.status === 'FAILED')).toHaveLength(1);
    expect(snapshot.workspace.generationRequests.filter(request =>
      request.attemptId === successor.attemptId && request.status === 'FAILED')).toHaveLength(0);
    const v2 = new CanonicalTranslationV2Service({ attachAttempt: jest.fn(),
      readSnapshot: jest.fn().mockResolvedValue(snapshot) } as never,
    null as never, null as never, null as never, null as never);
    const read = await v2.executeDocument({ phase: 'READ', attemptRef: successor.operationRef,
      leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 1 },
    { attemptRef: successor.operationRef!, principalId: 'test-runner',
      leaseToken: '00000000-0000-4000-8000-000000000001',
      leaseGeneration: 1, tenantId: scope.tenantId, workItemId: null,
      documentVersionId: scope.documentVersionId, workspaceId: data.prior.workspaceId },
    scope.actorUserId, async () => {},
    parseDocumentTranslationTaskEnvelope(successor.taskEnvelopeJson!), model);
    expect(read).toMatchObject({ terminalFailureCode: null, retryableFailureCount: 0 });
    const [old] = await client`SELECT status FROM action_attempt WHERE attempt_id=${data.prior.actionAttemptId}`;
    expect(old.status).toBe('FAILED');
    await client`UPDATE action_attempt SET status='FAILED',error_code='DOCUMENT_TRANSLATION_CHECK_FAILED',
      terminal_reason='DOCUMENT_TRANSLATION_CHECK_FAILED' WHERE attempt_id=${successor.attemptId}`;
    const secondFailure = { ...data.generations.at(-1)!, generationRequestRef: 'TG-check-again',
      clientRequestId: 'check-again', attemptId: successor.attemptId };
    await client`UPDATE translation_workspace SET generation_requests_json=${canonicalJson([
      ...data.generations, secondFailure])}`;
    const nextSuccessor = await repository.resumeSavedKnownFailure(scope, successor.operationRef!,
      rootRequestId, current, model);
    expect(nextSuccessor.triggerRequestId).toBe(`${rootRequestId}:resume-4`);
    expect((await repository.latest(scope, rootRequestId))?.attemptId).toBe(nextSuccessor.attemptId);
    expect((await repository.resumeSavedKnownFailure(scope, data.prior.operationRef,
      rootRequestId, current, model)).attemptId).toBe(successor.attemptId);
  });

  it('discovers a completed partial resume and admits its exact repair successor', async () => {
    const data = await seed();
    const current = { parseRunId, parseRevision: 2, modelInput: data.modelInput };
    const successor = await repository.resumeSavedKnownFailure(scope, data.prior.operationRef,
      rootRequestId, current, model);
    const blocked = { ...data.revisions[1].check!, semanticCheck: 'COMPLETED' as const,
      issues: [{ code: 'TEST_REVIEW', severity: 'BLOCK' as const,
        origin: 'TRANSLATION' as const, message: 'Synthetic issue',
        blockIds: [data.revisions[1].blockId], anchorIds: data.boundPlan.blocks[1].anchorIds }] };
    await client`UPDATE translation_block_revision SET check_json=${canonicalJson(blocked)},
      checked_at=${time} WHERE block_revision_id=${data.revisions[1].blockRevisionId}`;
    await client`UPDATE translation_workspace SET result_artifact_json=${canonicalJson({
      storeRole: 'UnifiedArtifactStoreCandidate', ref: 'artifact://synthetic/partial',
      sha256: 'c'.repeat(64), byteLength: 1, mediaType: 'application/json' })}`;
    await client`UPDATE action_attempt SET status='SUCCEEDED',terminal_reason='REMAINING_LIMITATIONS',
      result_envelope_json=${canonicalJson({ status: 'REMAINING_LIMITATIONS',
        artifact: { completeness: 'PARTIAL' } })} WHERE attempt_id=${successor.attemptId}`;
    const dispatch = await new MiaodaWorkItemRepository(drizzle(client) as never)
      .documentDeliveryDispatchState({ ...scope, readingRequestId: 'unused-reading',
        translationRequestId: rootRequestId, readingSelected: false, translationSelected: true });
    expect(dispatch).toEqual({ pending: true, missing: false });
    const repairRequestId = `${rootRequestId}:partial-repair`;
    const repairTask = sealDocumentTranslationTaskEnvelope({
      schemaVersion: 'wiselink.document.translation_task.v1', actionAttemptId: 'DTA-repair',
      operationRef: 'DTQ-repair', tenantId: scope.tenantId,
      documentVersionId: scope.documentVersionId, parseRunId, parseRevision: 2,
      workspaceId: data.prior.workspaceId,
      modelInput: { ...data.modelInput, retranslateBlockIds: [data.revisions[1].blockId] },
      deadline: '2026-09-30T00:00:00.000Z',
      idempotencyKey: `document-translation:${scope.documentVersionId}:${repairRequestId}` });
    const repair = await repository.reserve(scope, repairTask, repairRequestId,
      model, successor.operationRef!, 'PARTIAL');
    expect(repair.status).toBe('QUEUED');
    expect(repair.triggerRequestId).toBe(repairRequestId);
  });

  it('rejects a changed source, an active competing attempt, and unknown generation outcome', async () => {
    const data = await seed();
    const current = { parseRunId, parseRevision: 2, modelInput: data.modelInput };
    await client`UPDATE dm_document_parse_run SET manifest_artifact=${canonicalJson({ sha256: 'c'.repeat(64), byteLength: 100 })}::jsonb`;
    await expect(repository.resumeSavedKnownFailure(scope, data.prior.operationRef,
      rootRequestId, current, model)).rejects.toThrow('RECOVERY_SOURCE_CHANGED');
    await client`UPDATE dm_document_parse_run SET manifest_artifact=${canonicalJson({ sha256: artifact.sha256, byteLength: 100 })}::jsonb`;
    await client`INSERT INTO action_attempt(attempt_id,subject_kind,action_type,attempt_no,
      trigger_request_id,request_origin,status,producer_run_id,actor_user_id,tenant_id,
      document_version_id,input_revision) VALUES ('DTA-other','DOCUMENT_VERSION','DOCUMENT_TRANSLATE',3,
      'other','HOST_DOCUMENT','QUEUED',${parseRunId},${scope.actorUserId},${scope.tenantId},
      ${scope.documentVersionId},2)`;
    await expect(repository.resumeSavedKnownFailure(scope, data.prior.operationRef,
      rootRequestId, current, model)).rejects.toThrow('RECOVERY_COORDINATOR_CHANGED');
    await client`DELETE FROM action_attempt WHERE attempt_id='DTA-other'`;
    const unknown = data.generations.map(request => request.generationRequestRef === 'TG-check-failed'
      ? { ...request, error: { ...request.error!, outcome: 'GENERATION_UNKNOWN' as const } } : request);
    await client`UPDATE translation_workspace SET generation_requests_json=${canonicalJson(unknown)}`;
    await expect(repository.resumeSavedKnownFailure(scope, data.prior.operationRef,
      rootRequestId, current, model)).rejects.toThrow('RECOVERY_GENERATION_UNSETTLED');
  });

  it('does not discover or select a nonnumeric resume suffix', async () => {
    const data = await seed();
    await client`INSERT INTO action_attempt(attempt_id,subject_kind,action_type,attempt_no,
      trigger_request_id,request_origin,status,producer_run_id,actor_user_id,tenant_id,
      input_revision,document_version_id,task_envelope_json,task_input_hash,
      idempotency_key,deadline_at,operation_ref,execution_model_json)
      VALUES ('DTA-unbound','DOCUMENT_VERSION','DOCUMENT_TRANSLATE',3,
        ${`${rootRequestId}:resume-unbound`},'HOST_DOCUMENT','QUEUED',${parseRunId},
        ${scope.actorUserId},${scope.tenantId},2,${scope.documentVersionId},
        ${canonicalJson(data.prior)},${data.prior.inputHash},'unbound-request',
        now()+interval '1 hour','DTQ-unbound',${canonicalJson(model)})`;
    expect((await repository.latest(scope, rootRequestId))?.attemptId)
      .toBe(data.prior.actionAttemptId);
    const dispatch = await new MiaodaWorkItemRepository(drizzle(client) as never)
      .documentDeliveryDispatchState({ ...scope, readingRequestId: 'unused-reading',
        translationRequestId: rootRequestId, readingSelected: false,
        translationSelected: true });
    expect(dispatch).toEqual({ pending: false, missing: false });
  });

  async function seedNeverClaimedExpired() {
    const data = await seed(true);
    const expired = data.prior;
    await client`UPDATE action_attempt SET status='FAILED',
      error_code='DOCUMENT_TRANSLATION_DEADLINE_EXPIRED',
      terminal_reason='DOCUMENT_TRANSLATION_DEADLINE_EXPIRED',
      claim_count=0, started_at=NULL,
      lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL
      WHERE attempt_id=${data.prior.actionAttemptId}`;
    const previousGenerations = data.generations.map(request => ({ ...request,
      attemptId: data.root.actionAttemptId }));
    await client`UPDATE translation_workspace SET active_attempt_id=${data.root.actionAttemptId},
      generation_requests_json=${canonicalJson(previousGenerations)}`;
    for (const revision of data.revisions) {
      await client`UPDATE translation_block_revision SET
        origin_attempt_id=${data.root.actionAttemptId},
        provenance_json=${canonicalJson({ ...revision.provenance,
          originAttemptId: data.root.actionAttemptId })}
        WHERE block_revision_id=${revision.blockRevisionId}`;
    }
    return { ...data, expired, previousGenerations };
  }

  it('discovers a never-claimed deadline and atomically creates one exact successor', async () => {
    const data = await seedNeverClaimedExpired();
    const dispatch = () => new MiaodaWorkItemRepository(drizzle(client) as never)
      .documentDeliveryDispatchState({ ...scope, readingRequestId: 'unused-reading',
        translationRequestId: rootRequestId, readingSelected: false,
        translationSelected: true });
    expect(await dispatch()).toEqual({ pending: true, missing: false });
    const preserved = await client`SELECT block_revision_id,candidate_json,selected_for_reading
      FROM translation_block_revision ORDER BY block_revision_id`;
    const [first, duplicate] = await Promise.all([
      repository.recoverExpired(scope, data.expired.operationRef, rootRequestId),
      repository.recoverExpired(scope, data.expired.operationRef, rootRequestId),
    ]);
    expect(first.attemptId).toBe(duplicate.attemptId);
    expect(first.triggerRequestId).toBe(`${rootRequestId}:expired-resume`);
    expect(first.status).toBe('QUEUED');
    expect(first.deadlineAt!.getTime()).toBeGreaterThan(Date.now());
    const successorTask = parseDocumentTranslationTaskEnvelope(first.taskEnvelopeJson!);
    expect(successorTask.expiredRecovery).toEqual({
      predecessorAttemptId: data.expired.actionAttemptId,
      predecessorAttemptRef: data.expired.operationRef, rootRequestId });
    expect(successorTask.modelInput).toEqual(data.expired.modelInput);
    expect(first.executionModelJson).toBe(canonicalJson(model));
    const [old] = await client`SELECT status,deadline_at FROM action_attempt
      WHERE attempt_id=${data.expired.actionAttemptId}`;
    expect(old.status).toBe('FAILED');
    expect(new Date(old.deadline_at).toISOString()).toBe(data.expired.deadline);
    expect(await client`SELECT block_revision_id,candidate_json,selected_for_reading
      FROM translation_block_revision ORDER BY block_revision_id`).toEqual(preserved);
    const snapshot = await readTranslationWorkspaceSnapshot(drizzle(client) as never,
      { tenantId: scope.tenantId, workItemId: null,
        documentVersionId: scope.documentVersionId, workspaceId: data.prior.workspaceId });
    const reading = buildTranslationWorkspaceReadingV2(snapshot.workspace, snapshot.revisions);
    expect(nextTranslationWorkV2(snapshot.workspace, snapshot.revisions, reading,
      undefined, { batchSemanticChecks: true })).toMatchObject({ kind: 'CHECK',
      blockIds: [data.revisions[1].blockId] });
    expect((await client`SELECT attempt_id FROM action_attempt WHERE
      trigger_request_id=${`${rootRequestId}:expired-resume`}`)).toHaveLength(1);
    expect(await dispatch()).toEqual({ pending: true, missing: false });
    await client`UPDATE action_attempt SET status='SUCCEEDED' WHERE attempt_id=${first.attemptId}`;
    expect(await dispatch()).toEqual({ pending: false, missing: false });
    expect((await repository.latest(scope, rootRequestId))?.attemptId).toBe(first.attemptId);
  });

  it('rejects a claimed deadline and leaves unknown generations for attention', async () => {
    const data = await seedNeverClaimedExpired();
    await client`UPDATE action_attempt SET claim_count=1,started_at=now()-interval '2 hours'
      WHERE attempt_id=${data.expired.actionAttemptId}`;
    await expect(repository.recoverExpired(scope, data.expired.operationRef,
      rootRequestId)).rejects.toThrow('EXPIRED_PREDECESSOR_INVALID');
    await client`UPDATE action_attempt SET claim_count=0,started_at=NULL
      WHERE attempt_id=${data.expired.actionAttemptId}`;
    for (const generation of [{ ...data.previousGenerations[0], status: 'REGISTERED' as const },
      { ...data.previousGenerations[0], error: {
        origin: 'UPSTREAM' as const, code: 'TEST_UNKNOWN',
        outcome: 'GENERATION_UNKNOWN' as const, retryable: false } }]) {
      await client`UPDATE translation_workspace SET generation_requests_json=${canonicalJson([generation])}`;
      const dispatch = await new MiaodaWorkItemRepository(drizzle(client) as never)
        .documentDeliveryDispatchState({ ...scope, readingRequestId: 'unused-reading',
          translationRequestId: rootRequestId, readingSelected: false,
          translationSelected: true });
      expect(dispatch).toEqual({ pending: false, missing: false });
      await expect(repository.recoverExpired(scope, data.expired.operationRef,
        rootRequestId)).rejects.toThrow('EXPIRED_GENERATION_UNSETTLED');
    }
  });

  it('discovers an overdue queued attempt before STATUS records its terminal failure', async () => {
    const data = await seedNeverClaimedExpired();
    await client`UPDATE action_attempt SET status='QUEUED',error_code=NULL,
      terminal_reason=NULL WHERE attempt_id=${data.expired.actionAttemptId}`;
    const dispatch = () => new MiaodaWorkItemRepository(drizzle(client) as never)
      .documentDeliveryDispatchState({ ...scope, readingRequestId: 'unused-reading',
        translationRequestId: rootRequestId, readingSelected: false,
        translationSelected: true });
    expect(await dispatch()).toEqual({ pending: true, missing: false });
    await repository.expire(scope);
    const recovered = await repository.recoverExpired(scope,
      data.expired.operationRef, rootRequestId);
    expect(recovered.status).toBe('QUEUED');
  });

  it('continues saved blocks after the expired successor has a known CHECK failure', async () => {
    const data = await seedNeverClaimedExpired();
    const expired = await repository.recoverExpired(scope,
      data.expired.operationRef, rootRequestId);
    const checkFailure: TranslationGenerationRequestV2 = {
      ...data.previousGenerations.at(-1)!,
      generationRequestRef: 'TG-expired-check-failed',
      clientRequestId: 'expired-check-failed',
      attemptId: expired.attemptId, status: 'FAILED',
      error: { origin: 'OUTPUT_CONTRACT', code: 'DOCUMENT_TRANSLATION_CHECK_FAILED',
        outcome: 'KNOWN_FAILURE', retryable: false },
    };
    await client`UPDATE action_attempt SET status='FAILED',
      error_code='DOCUMENT_TRANSLATION_CHECK_FAILED',
      terminal_reason='DOCUMENT_TRANSLATION_CHECK_FAILED'
      WHERE attempt_id=${expired.attemptId}`;
    const current = { parseRunId, parseRevision: 2, modelInput: data.modelInput };
    for (const unsettled of [
      { ...checkFailure, status: 'REGISTERED' as const, error: null },
      { ...checkFailure, error: { ...checkFailure.error!,
        outcome: 'GENERATION_UNKNOWN' as const } },
    ]) {
      await client`UPDATE translation_workspace SET
        generation_requests_json=${canonicalJson([...data.previousGenerations, unsettled])}`;
      await expect(repository.resumeSavedKnownFailure(scope, expired.operationRef!,
        rootRequestId, current, model)).rejects.toThrow('RECOVERY_GENERATION_UNSETTLED');
    }
    await client`UPDATE translation_workspace SET
      generation_requests_json=${canonicalJson([...data.previousGenerations, checkFailure])}`;
    await expect(repository.resumeSavedKnownFailure({ ...scope, actorUserId: 'other-actor' },
      expired.operationRef!, rootRequestId, current, model))
      .rejects.toThrow('DOCUMENT_TRANSLATION_PREDECESSOR_NOT_FOUND');
    await expect(repository.resumeSavedKnownFailure(scope, expired.operationRef!,
      'different-root', current, model)).rejects.toThrow('RECOVERY_PREDECESSOR_INVALID');
    const resumed = await repository.resumeSavedKnownFailure(scope,
      expired.operationRef!, rootRequestId, current, model);
    expect(resumed.triggerRequestId).toBe(`${rootRequestId}:resume-${expired.attemptNo + 1}`);
    expect((await repository.resumeSavedKnownFailure(scope,
      expired.operationRef!, rootRequestId, current, model)).attemptId).toBe(resumed.attemptId);
    const task = parseDocumentTranslationTaskEnvelope(resumed.taskEnvelopeJson!);
    expect(task.expiredRecovery).toBeUndefined();
    expect(task.modelInput).toEqual(data.modelInput);
    const snapshot = await readTranslationWorkspaceSnapshot(drizzle(client) as never,
      { tenantId: scope.tenantId, workItemId: null,
        documentVersionId: scope.documentVersionId, workspaceId: data.prior.workspaceId });
    expect(snapshot.revisions).toHaveLength(2);
    const reading = buildTranslationWorkspaceReadingV2(snapshot.workspace, snapshot.revisions);
    expect(nextTranslationWorkV2(snapshot.workspace, snapshot.revisions, reading,
      undefined, { batchSemanticChecks: true })).toMatchObject({ kind: 'CHECK',
      blockIds: [data.revisions[1].blockId] });
    await expect(repository.recoverExpired(scope, expired.operationRef!, rootRequestId))
      .rejects.toThrow('RECOVERY_REQUEST_CONFLICT');
  });

  it('admissibly repairs partial output across expired and known-failure successors', async () => {
    const data = await seedNeverClaimedExpired();
    const expired = await repository.recoverExpired(scope,
      data.expired.operationRef, rootRequestId);
    const checkFailure: TranslationGenerationRequestV2 = {
      ...data.previousGenerations.at(-1)!,
      generationRequestRef: 'TG-expired-partial-check',
      clientRequestId: 'expired-partial-check', attemptId: expired.attemptId,
      status: 'FAILED', error: { origin: 'OUTPUT_CONTRACT',
        code: 'DOCUMENT_TRANSLATION_CHECK_FAILED', outcome: 'KNOWN_FAILURE',
        retryable: false },
    };
    await client`UPDATE action_attempt SET status='FAILED',
      error_code='DOCUMENT_TRANSLATION_CHECK_FAILED',
      terminal_reason='DOCUMENT_TRANSLATION_CHECK_FAILED'
      WHERE attempt_id=${expired.attemptId}`;
    await client`UPDATE translation_workspace SET
      generation_requests_json=${canonicalJson([...data.previousGenerations, checkFailure])}`;
    const resumed = await repository.resumeSavedKnownFailure(scope,
      expired.operationRef!, rootRequestId,
      { parseRunId, parseRevision: 2, modelInput: data.modelInput }, model);
    const blocked = { ...data.revisions[1].check!, semanticCheck: 'COMPLETED' as const,
      issues: [{ code: 'TEST_REVIEW', severity: 'BLOCK' as const,
        origin: 'TRANSLATION' as const, message: 'Synthetic issue',
        blockIds: [data.revisions[1].blockId],
        anchorIds: data.boundPlan.blocks[1].anchorIds }] };
    await client`UPDATE translation_block_revision SET check_json=${canonicalJson(blocked)},
      checked_at=${time} WHERE block_revision_id=${data.revisions[1].blockRevisionId}`;
    await client`UPDATE translation_workspace SET result_artifact_json=${canonicalJson({
      storeRole: 'UnifiedArtifactStoreCandidate', ref: 'artifact://synthetic/partial',
      sha256: 'c'.repeat(64), byteLength: 1, mediaType: 'application/json' })}`;
    await client`UPDATE action_attempt SET status='SUCCEEDED',
      terminal_reason='REMAINING_LIMITATIONS',
      result_envelope_json=${canonicalJson({ status: 'REMAINING_LIMITATIONS',
        artifact: { completeness: 'PARTIAL' } })}
      WHERE attempt_id=${resumed.attemptId}`;
    const repairRequestId = `${rootRequestId}:partial-repair`;
    const repairTask = sealDocumentTranslationTaskEnvelope({
      schemaVersion: 'wiselink.document.translation_task.v1',
      actionAttemptId: 'DTA-expired-partial-repair',
      operationRef: 'DTQ-expired-partial-repair', tenantId: scope.tenantId,
      documentVersionId: scope.documentVersionId, parseRunId, parseRevision: 2,
      workspaceId: data.prior.workspaceId,
      modelInput: { ...data.modelInput,
        retranslateBlockIds: [data.revisions[1].blockId] },
      deadline: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: `document-translation:${scope.documentVersionId}:${repairRequestId}` });
    const reserve = (actorScope = scope, requestId = repairRequestId) =>
      repository.reserve(actorScope, repairTask, requestId,
        model, resumed.operationRef!, 'PARTIAL');
    await expect(reserve({ ...scope, actorUserId: 'other-actor' }))
      .rejects.toThrow('DOCUMENT_TRANSLATION_RECOVERY_INELIGIBLE');
    await expect(reserve(scope, 'unrelated-root:partial-repair'))
      .rejects.toThrow('DOCUMENT_TRANSLATION_PARTIAL_SUCCESSOR_INELIGIBLE');
    for (const unsettled of [
      { ...checkFailure, generationRequestRef: 'TG-unsettled',
        status: 'REGISTERED' as const, finishedAt: null, error: null },
      { ...checkFailure, generationRequestRef: 'TG-unknown',
        error: { ...checkFailure.error!, outcome: 'GENERATION_UNKNOWN' as const } },
    ]) {
      await client`UPDATE translation_workspace SET generation_requests_json=${canonicalJson([
        ...data.previousGenerations, checkFailure, unsettled])}`;
      await expect(reserve()).rejects.toThrow('DOCUMENT_TRANSLATION_PARTIAL_SUCCESSOR_INELIGIBLE');
    }
    await client`UPDATE translation_workspace SET
      generation_requests_json=${canonicalJson([...data.previousGenerations, checkFailure])}`;
    const revisionsBefore = await client`SELECT block_revision_id,candidate_json FROM
      translation_block_revision ORDER BY block_revision_id`;
    const partial = await reserve();
    expect(partial.status).toBe('QUEUED');
    expect(partial.triggerRequestId).toBe(repairRequestId);
    expect(parseDocumentTranslationTaskEnvelope(partial.taskEnvelopeJson!).modelInput
      .retranslateBlockIds).toEqual([data.revisions[1].blockId]);
    expect((await reserve()).attemptId).toBe(partial.attemptId);
    expect(await client`SELECT block_revision_id,candidate_json FROM
      translation_block_revision ORDER BY block_revision_id`).toEqual(revisionsBefore);
  });

  it('recovers a sealed partial-input defect after the expired known-failure chain', async () => {
    const data = await seedNeverClaimedExpired();
    const expired = await repository.recoverExpired(scope,
      data.expired.operationRef, rootRequestId);
    const checkFailure: TranslationGenerationRequestV2 = {
      ...data.previousGenerations.at(-1)!, generationRequestRef: 'TG-input-check',
      clientRequestId: 'input-check', attemptId: expired.attemptId,
      status: 'FAILED', error: { origin: 'OUTPUT_CONTRACT',
        code: 'DOCUMENT_TRANSLATION_CHECK_FAILED', outcome: 'KNOWN_FAILURE',
        retryable: false },
    };
    await client`UPDATE action_attempt SET status='FAILED',
      error_code='DOCUMENT_TRANSLATION_CHECK_FAILED',
      terminal_reason='DOCUMENT_TRANSLATION_CHECK_FAILED'
      WHERE attempt_id=${expired.attemptId}`;
    await client`UPDATE translation_workspace SET
      generation_requests_json=${canonicalJson([...data.previousGenerations, checkFailure])}`;
    const resumed = await repository.resumeSavedKnownFailure(scope,
      expired.operationRef!, rootRequestId,
      { parseRunId, parseRevision: 2, modelInput: data.modelInput }, model);
    const blocked = { ...data.revisions[1].check!, semanticCheck: 'COMPLETED' as const,
      issues: [{ code: 'TEST_REVIEW', severity: 'BLOCK' as const,
        origin: 'TRANSLATION' as const, message: 'Synthetic issue',
        blockIds: [data.revisions[1].blockId],
        anchorIds: data.boundPlan.blocks[1].anchorIds }] };
    await client`UPDATE translation_block_revision SET check_json=${canonicalJson(blocked)},
      checked_at=${time} WHERE block_revision_id=${data.revisions[1].blockRevisionId}`;
    const resultArtifact = { storeRole: 'UnifiedArtifactStoreCandidate',
      ref: 'artifact://synthetic/partial', sha256: 'c'.repeat(64),
      byteLength: 1, mediaType: 'application/json' };
    const manifest = { workspaceId: data.prior.workspaceId, planRevision: 1,
      contextRevision: 1, workspaceRowVersion: 1,
      blockRevisions: [{ blockId: data.revisions[0].blockId,
        blockRevisionId: data.revisions[0].blockRevisionId,
        contentRevision: data.revisions[0].contentRevision }] };
    await client`UPDATE translation_workspace SET
      result_artifact_json=${canonicalJson(resultArtifact)},
      result_manifest_json=${canonicalJson(manifest)}`;
    await client`UPDATE action_attempt SET status='SUCCEEDED',
      terminal_reason='REMAINING_LIMITATIONS',
      result_envelope_json=${canonicalJson({ status: 'REMAINING_LIMITATIONS',
        artifact: { completeness: 'PARTIAL', manifest } })}
      WHERE attempt_id=${resumed.attemptId}`;
    const oldRequestId = `${rootRequestId}:partial-repair`;
    const broken = sealDocumentTranslationTaskEnvelope({
      schemaVersion: 'wiselink.document.translation_task.v1',
      actionAttemptId: 'DTA-broken-partial-input',
      operationRef: 'DTQ-broken-partial-input', tenantId: scope.tenantId,
      documentVersionId: scope.documentVersionId, parseRunId, parseRevision: 2,
      workspaceId: data.prior.workspaceId, modelInput: data.modelInput,
      deadline: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: `document-translation:${scope.documentVersionId}:${oldRequestId}` });
    await client`INSERT INTO action_attempt(attempt_id,subject_kind,action_type,attempt_no,
      trigger_request_id,request_origin,status,producer_run_id,actor_user_id,tenant_id,
      input_revision,document_version_id,task_envelope_json,task_input_hash,
      idempotency_key,deadline_at,operation_ref,execution_model_json)
      VALUES (${broken.actionAttemptId},'DOCUMENT_VERSION','DOCUMENT_TRANSLATE',
        ${resumed.attemptNo + 1},${oldRequestId},'HOST_DOCUMENT','QUEUED',${parseRunId},
        ${scope.actorUserId},${scope.tenantId},2,${scope.documentVersionId},
        ${canonicalJson(broken)},${broken.inputHash},${broken.idempotencyKey},
        ${broken.deadline},${broken.operationRef},${canonicalJson(model)})`;
    await client`UPDATE translation_workspace SET active_attempt_id=${broken.actionAttemptId}`;
    const fixedRequestId = `${rootRequestId}:partial-repair-v2`;
    const corrected = sealDocumentTranslationTaskEnvelope({
      schemaVersion: 'wiselink.document.translation_task.v1',
      actionAttemptId: 'DTA-fixed-partial-input',
      operationRef: 'DTQ-fixed-partial-input', tenantId: scope.tenantId,
      documentVersionId: scope.documentVersionId, parseRunId, parseRevision: 2,
      workspaceId: data.prior.workspaceId,
      recoveryOf: { operationRef: broken.operationRef, inputHash: broken.inputHash },
      modelInput: { ...data.modelInput,
        retranslateBlockIds: [data.revisions[1].blockId] },
      deadline: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: `document-translation:${scope.documentVersionId}:${fixedRequestId}` });
    await expect(repository.recoverPartialInput({ ...scope, actorUserId: 'other-actor' },
      corrected, rootRequestId, broken.operationRef, model))
      .rejects.toThrow('PARTIAL_INPUT_RECOVERY_INELIGIBLE');
    for (const unsettled of [
      { ...checkFailure, generationRequestRef: 'TG-input-registered',
        status: 'REGISTERED' as const, finishedAt: null, error: null },
      { ...checkFailure, generationRequestRef: 'TG-input-unknown',
        error: { ...checkFailure.error!, outcome: 'GENERATION_UNKNOWN' as const } },
    ]) {
      await client`UPDATE translation_workspace SET generation_requests_json=${canonicalJson([
        ...data.previousGenerations, checkFailure, unsettled])}`;
      await expect(repository.recoverPartialInput(scope, corrected,
        rootRequestId, broken.operationRef, model))
        .rejects.toThrow('PARTIAL_INPUT_RECOVERY_INELIGIBLE');
    }
    await client`UPDATE translation_workspace SET
      generation_requests_json=${canonicalJson([...data.previousGenerations, checkFailure])}`;
    const fixed = await repository.recoverPartialInput(scope, corrected,
      rootRequestId, broken.operationRef, model);
    expect(fixed.status).toBe('QUEUED');
    expect(fixed.triggerRequestId).toBe(fixedRequestId);
    expect((await repository.recoverPartialInput(scope, corrected,
      rootRequestId, broken.operationRef, model)).attemptId).toBe(fixed.attemptId);
    const [old] = await client`SELECT status,terminal_reason FROM action_attempt
      WHERE attempt_id=${broken.actionAttemptId}`;
    expect(old).toMatchObject({ status: 'CANCELLED',
      terminal_reason: 'DOCUMENT_TRANSLATION_PARTIAL_INPUT_SUPERSEDED' });
  });

  it('serializes two database connections against the current migration guards', async () => {
    const data = await seedNeverClaimedExpired();
    const schema = `translation_expired_${randomUUID().replaceAll('-', '')}`;
    const second = postgres(databaseUrl!, { max: 1, onnotice() {} });
    try {
      await client.unsafe(`CREATE SCHEMA ${schema}`);
      for (const table of ['dm_document_version', 'dm_document_parse_run',
        'dm_document_reading_run', 'action_attempt', 'translation_workspace',
        'translation_block_revision']) {
        await client.unsafe(`CREATE TABLE ${schema}.${table}
          (LIKE pg_temp.${table} INCLUDING ALL)`);
        await client.unsafe(`INSERT INTO ${schema}.${table} SELECT * FROM pg_temp.${table}`);
      }
      const original = readFileSync(resolve(process.cwd(),
        'migrations/0048_document_translation_attempt_subject.sql'), 'utf8');
      for (const name of ['action_attempt_check_document_original',
        'action_attempt_preserve_document_subject']) {
        const source = original.match(new RegExp(
          `CREATE FUNCTION ${name}\\(\\)[\\s\\S]*?\\$\\$;`, 'u'))?.[0];
        if (!source) throw new Error(`DOCUMENT_TRANSLATION_MIGRATION_${name}_NOT_FOUND`);
        await client.unsafe(source.replace('CREATE FUNCTION ', `CREATE FUNCTION ${schema}.`));
      }
      await client.unsafe(`CREATE TRIGGER action_attempt_check_document_original
        BEFORE INSERT OR UPDATE ON ${schema}.action_attempt FOR EACH ROW
        EXECUTE FUNCTION ${schema}.action_attempt_check_document_original();
        CREATE TRIGGER action_attempt_preserve_document_subject
        BEFORE UPDATE ON ${schema}.action_attempt FOR EACH ROW
        EXECUTE FUNCTION ${schema}.action_attempt_preserve_document_subject();`);
      await client.unsafe(`CREATE FUNCTION ${schema}.engineering_matter_actor_has_tenant(t varchar)
        RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT t='resume-tenant' $$;
        CREATE FUNCTION ${schema}.engineering_matter_document_owned_by_actor(t varchar,dv varchar)
        RETURNS boolean LANGUAGE sql STABLE AS $$
          SELECT t='resume-tenant' AND dv='DV-resume' $$;`);
      await client.unsafe(`SET search_path TO ${schema},pg_temp`);
      const ownership = original.match(/CREATE FUNCTION document_translation_attempt_owned\([\s\S]*?\$\$;/u)?.[0];
      if (!ownership) throw new Error('DOCUMENT_TRANSLATION_RLS_FUNCTION_NOT_FOUND');
      await client.unsafe(ownership.replace('CREATE FUNCTION ', `CREATE FUNCTION ${schema}.`));
      for (const name of ['action_attempt_document_subject_boundary',
        'action_attempt_document_read', 'action_attempt_document_actor',
        'action_attempt_document_no_native_insert']) {
        const source = original.match(new RegExp(`CREATE POLICY ${name}[\\s\\S]*?;`, 'u'))?.[0];
        if (!source) throw new Error(`DOCUMENT_TRANSLATION_RLS_${name}_NOT_FOUND`);
        await client.unsafe(source);
      }
      await client.unsafe(`ALTER TABLE ${schema}.action_attempt ENABLE ROW LEVEL SECURITY;
        GRANT USAGE ON SCHEMA ${schema} TO service_role,authenticated;
        GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA ${schema}
          TO service_role,authenticated;`);
      await second.unsafe(`SET search_path TO ${schema},public`);
      await client.unsafe(`SET app.user_id TO '${scope.actorUserId}'; SET ROLE service_role`);
      await second.unsafe(`SET app.user_id TO '${scope.actorUserId}'; SET ROLE service_role`);
      const firstRepository = new DocumentTranslationAttemptRepository(drizzle(client) as never);
      const secondRepository = new DocumentTranslationAttemptRepository(drizzle(second) as never);
      const [first, duplicate] = await Promise.all([
        firstRepository.recoverExpired(scope, data.expired.operationRef, rootRequestId),
        secondRepository.recoverExpired(scope, data.expired.operationRef, rootRequestId),
      ]);
      expect(first.attemptId).toBe(duplicate.attemptId);
      const rows = await second`SELECT attempt_id FROM action_attempt
        WHERE trigger_request_id=${`${rootRequestId}:expired-resume`}`;
      expect(rows).toHaveLength(1);
      const [old] = await second`SELECT status,deadline_at FROM action_attempt
        WHERE attempt_id=${data.expired.actionAttemptId}`;
      expect(old.status).toBe('FAILED');
      expect(new Date(old.deadline_at).toISOString()).toBe(data.expired.deadline);
      await second.unsafe("SET app.user_id TO 'other-actor'");
      await expect(secondRepository.recoverExpired(scope, data.expired.operationRef,
        rootRequestId)).rejects.toThrow('EXPIRED_PREDECESSOR_INVALID');
      await second.unsafe(`SET app.user_id TO '${scope.actorUserId}'`);
      await second.unsafe('RESET ROLE');
      await second.unsafe('SET ROLE authenticated');
      await expect(second`INSERT INTO action_attempt(attempt_id,subject_kind,action_type,
        attempt_no,trigger_request_id,status,producer_run_id,actor_user_id,tenant_id,
        input_revision,document_version_id) VALUES ('DTA-browser-forged','DOCUMENT_VERSION',
        'DOCUMENT_TRANSLATE',9,'browser-forged','QUEUED',${parseRunId},${scope.actorUserId},
        ${scope.tenantId},2,${scope.documentVersionId})`).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.unsafe('RESET ROLE');
      await client.unsafe('SET search_path TO pg_temp,public');
      await second.unsafe('RESET ROLE');
      await second.end();
      await client.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  });
});
