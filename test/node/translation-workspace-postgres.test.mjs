import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';
import { sealResultEnvelope as sealSkillResultEnvelope, WISELINK_SKILL_VERSION, WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only'); require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, sql: drizzleSql } = require('drizzle-orm');
const { getTableConfig } = require('drizzle-orm/pg-core');
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const { actionAttempt } = require('../../server/database/schema.ts');
const { sealTaskEnvelope, canonicalJson, parseTaskEnvelope } = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const { CanonicalTranslationWorkspaceRepository } = require('../../server/modules/canonical-host/canonical-translation-workspace.repository.ts');
const { ActionAttemptRepository } = require('../../server/modules/action-attempt/action-attempt.repository.ts');
const { ActionAttemptLifecycleService } = require('../../server/modules/action-attempt/action-attempt-lifecycle.service.ts');
const { readInitialAnalysisRequestInput } = require('../../server/modules/action-attempt/initial-analysis-request.ts');
const { CanonicalHostOpenClawTranslationService } = require('../../server/modules/canonical-host/canonical-host-openclaw-translation.service.ts');
const { fixedModelSettings } = require('../support/fixed-model-settings.ts');
const { ACTION_ATTEMPT_REQUEST_ORIGIN } = require('../../server/modules/action-attempt/action-attempt.types.ts');
const { CanonicalTranslationV2Service } = require('../../server/modules/canonical-host/canonical-translation-v2.service.ts');
const { buildTranslationSourcePlan } = require('../../server/modules/canonical-host/canonical-translation-source-plan.ts');
const { translationBatchDependenciesV2 } = require('../../server/modules/canonical-host/canonical-translation-v2-batch.ts');
const { checkTranslationBlockV2, buildTranslationWorkspaceReadingV2 } = require('../../server/modules/canonical-host/canonical-translation-v2-quality.ts');
const { parseBilingualTranslationArtifactV2 } = require('../../server/modules/canonical-host/canonical-translation-v2-artifact.ts');
const { MiaodaTranslationKnowledgeProductStore } = require('../../server/modules/canonical-host/miaoda-translation-knowledge-product.store.ts');
const { CanonicalTranslationKnowledgeGovernanceService } = require('../../server/modules/canonical-host/canonical-translation-knowledge-governance.ts');
const { HostOwnedV1TranslationRuleSetPrivateProvider } = require('../../server/modules/canonical-host/canonical-translation-rule-set-v1.private.ts');
const databaseUrl = process.env.TRANSLATION_WORKSPACE_TEST_DATABASE_URL;

test('real PostgreSQL translation work survives bounded requests and enforces scope, leases and immutable versions', { skip: !databaseUrl, concurrency: false }, async (t) => {
  const url = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.match(url.pathname, /^\/wiselink_translation_v2_test_[a-z0-9_]+$/u);
  const sql = postgres(databaseUrl, { max: 4, onnotice() {} });
  try {
    await reset(sql);
    const db = drizzle(sql);
    const repository = new CanonicalTranslationWorkspaceRepository(db);
    const knowledgeStore = new MiaodaTranslationKnowledgeProductStore(db);
    const knowledge = new CanonicalTranslationKnowledgeGovernanceService(knowledgeStore, new HostOwnedV1TranslationRuleSetPrivateProvider());
    const knowledgeBinding = { documentId: 'doc-test', revisionId: 'dv-test', sbdPackageId: 'pkg-test', sbdContentHash: 'synthetic-package-content', tcpPackageId: null, tcpContentHash: null };
    const plan = fixturePlan();
    await sql`INSERT INTO work_item VALUES ('WI-test', 'tenant-test', 'dv-test', 'pkg-test', ${plan.source.parsedArtifact.ref}, ${plan.source.parsedArtifact.sha256}, 'engineer-test', 1)`;
    await sql`INSERT INTO identity_subject_mapping VALUES ('engineer-test', 'tenant-test', 'cli_aadde8b579f95bc9', 'ACTIVE')`;
    let workspace = await repository.prepare({ tenantId: 'tenant-test', workItemId: 'WI-test', plan });
    let active = await seedAttempt(sql, workspace, 'first', 'miaoda/minimax-m3');
    let fence = { workspaceId: workspace.workspaceId, tenantId: 'tenant-test', workItemId: 'WI-test', principalId: 'service-principal',
      attemptRef: active.task.operationRef, leaseToken: active.leaseToken, leaseGeneration: 1 };
    workspace = await repository.attachAttempt(fence);
    const execution = { modelRef: 'miaoda/minimax-m3', modelVersion: 'minimax-m3-synthetic-test', skillVersion: WISELINK_SKILL_VERSION,
      promptVersion: 'wiselink-translation-block@r09.c44', providerRequestId: 'synthetic-provider-request', generatedAt: null, usage: { inputTokens: 120, outputTokens: 32 } };
    const artifacts = new Map(); let persistCount = 0;
    const artifactStore = { persistAndReadback: async (bytes) => {
      persistCount += 1; const hash = createHash('sha256').update(bytes).digest('hex'); const ref = `artifact://synthetic/${hash}`;
      artifacts.set(ref, Buffer.from(bytes)); return { artifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref, sha256: hash, byteLength: bytes.length, mediaType: 'application/json' }, bytes };
    }, readActualBytes: async (artifact) => artifacts.get(artifact.ref) };
    const service = new CanonicalTranslationV2Service(repository, null, { readScoped: async ({ attemptRef, tenantId, workItemId }) => {
      const [row] = await db.select().from(actionAttempt).where(eq(actionAttempt.operationRef, attemptRef));
      if (row?.tenantId !== tenantId || row?.workItemId !== workItemId) throw new Error('TEST_ATTEMPT_NOT_FOUND'); return row;
    } }, artifactStore, { authorizeOpenClawAttempt: async () => ({ tenantId: 'tenant-test', workItemId: 'WI-test', principalId: 'service-principal' }) });
    const command = (args) => service.execute({ attemptRef: fence.attemptRef, leaseToken: fence.leaseToken, leaseGeneration: fence.leaseGeneration, ...args });
    let firstRequest; let firstSaved; let secondSaved; let final; let importedKnowledge;

    await t.test('one exact workspace; fresh tenant scope and one registered request under concurrent transactions', async () => {
      const again = await repository.prepare({ tenantId: 'tenant-test', workItemId: 'WI-test', plan });
      assert.equal(again.workspaceId, workspace.workspaceId);
      await assert.rejects(repository.read({ ...fence, tenantId: 'other-tenant' }), /WORKSPACE_NOT_FOUND/u);
      const registrations = await Promise.allSettled(['request-a', 'request-b'].map((clientRequestId) => repository.registerGeneration({ ...fence, clientRequestId,
        blockIds: ['b1'], purpose: 'GENERATE', targetBlockRevisionId: null, dependencies: translationBatchDependenciesV2(workspace, ['b1']) })));
      assert.equal(registrations.filter((entry) => entry.status === 'fulfilled').length, 1);
      assert.match(registrations.find((entry) => entry.status === 'rejected').reason.message, /ALREADY_IN_FLIGHT/u);
      firstRequest = registrations.find((entry) => entry.status === 'fulfilled').value;
      await repository.recordGenerationFailure({ ...fence, generationRequestRef: firstRequest.generationRequestRef,
        error: { origin: 'TRANSPORT', code: 'SYNTHETIC_RESPONSE_LOSS', outcome: 'GENERATION_UNKNOWN', retryable: false } });
      assert.equal((await repository.read(fence)).generationRequests[0].status, 'REGISTERED');
      await assert.rejects(repository.registerGeneration({ ...fence, clientRequestId: 'must-not-redispatch', blockIds: ['b1'], purpose: 'GENERATE', targetBlockRevisionId: null,
        dependencies: translationBatchDependenciesV2(workspace, ['b1']) }), /ALREADY_IN_FLIGHT/u);
    });
    await t.test('late known body is saved once, changed replay conflicts, and saved does not mean readable', async () => {
      const args = { ...fence, generationRequestRef: firstRequest.generationRequestRef, actualExecution: execution,
        candidates: [{ blockId: 'b1', elements: [{ elementId: 'e-heading', kind: 'heading', translatedText: '合成测试说明', anchorIds: ['a1'] }] }] };
      await assert.rejects(repository.saveCandidates({ ...args,
        actualExecution: { ...execution, modelVersion: 'configured-route:other/model' } }), /RUNTIME_BINDING_INVALID/u);
      [firstSaved] = await repository.saveCandidates(args);
      const [same] = await repository.saveCandidates(args);
      assert.equal(same.blockRevisionId, firstSaved.blockRevisionId); assert.equal(same.savedAt, firstSaved.savedAt);
      await assert.rejects(repository.saveCandidates({ ...args, candidates: [{ ...args.candidates[0], elements: [{ ...args.candidates[0].elements[0], translatedText: '不同的正文' }] }] }), /IDEMPOTENCY_CONFLICT/u);
      assert.equal((await repository.read(fence)).generationRequests[0].status, 'SAVED');
      const snapshot = await repository.readSnapshot(fence); const reading = buildTranslationWorkspaceReadingV2(snapshot.workspace, snapshot.revisions);
      assert.equal(reading.blocks[0].readingStatus, 'PENDING_CHECK'); assert.equal(reading.coverage.readableSourceCharacters, 0);
      assert.ok(reading.coverage.savedSourceCharacters > 0); assert.equal((await sql`SELECT revision FROM work_item`)[0].revision, 1);
      await assert.rejects(sql`UPDATE translation_block_revision SET candidate_json = '{}' WHERE block_revision_id = ${firstSaved.blockRevisionId}`, /CONTENT_IMMUTABLE/u);
      const check = checkTranslationBlockV2({ plan, candidate: firstSaved.candidate });
      firstSaved = await repository.checkAndSelect({ ...fence, blockRevisionId: firstSaved.blockRevisionId, expectedRowVersion: firstSaved.rowVersion, check });
      assert.equal(firstSaved.selectedForReading, true);
      const replay = await repository.checkAndSelect({ ...fence, blockRevisionId: firstSaved.blockRevisionId, expectedRowVersion: 1, check });
      assert.equal(replay.checkedAt, firstSaved.checkedAt);
    });
    await t.test('Host saves before checking and ties semantic review to the exact candidate revision', async () => {
      const next = await command({ phase: 'NEXT', requestId: 'second-block' });
      assert.equal(next.action, 'GENERATE'); assert.deepEqual(next.blockIds, ['b2']);
      const replay = await command({ phase: 'NEXT', requestId: 'second-block' }); assert.equal(replay.generationRequestRef, next.generationRequestRef);
      await assert.rejects(command({ phase: 'SAVE', generationRequestRef: next.generationRequestRef,
        candidates: [{ blockId: 'b2', elements: [{ kind: 'paragraph', translatedText: '指示消失时，在 5 秒后更换组件。', anchorIds: ['a2'] }] }],
        actualExecution: { ...execution, modelRef: 'other/model' } }), /RUNTIME_BINDING_INVALID/u);
      const saved = await command({ phase: 'SAVE', generationRequestRef: next.generationRequestRef,
        candidates: [{ blockId: 'b2', elements: [{ kind: 'paragraph', translatedText: '指示消失时，在 5 秒后更换组件。', anchorIds: ['a2'] }] }], actualExecution: execution });
      secondSaved = saved.blocks[0]; assert.equal(secondSaved.checkedAt, null); assert.equal(secondSaved.selectedForReading, false);
      const check = await command({ phase: 'NEXT', requestId: 'check-second-block' });
      assert.equal(check.action, 'CHECK'); assert.equal(check.targetBlockRevisionId, secondSaved.blockRevisionId);
      await assert.rejects(command({ phase: 'CHECK', generationRequestRef: check.generationRequestRef, expectedRowVersion: check.targetRowVersion,
        semanticReview: { blockId: 'b1', issues: [] }, actualExecution: execution }), /SEMANTIC_REVIEW_SCOPE_INVALID/u);
      const blocked = await command({ phase: 'CHECK', generationRequestRef: check.generationRequestRef, expectedRowVersion: check.targetRowVersion,
        semanticReview: { blockId: 'b2', issues: [{ code: 'NEGATION_CHANGED', severity: 'BLOCK', message: 'Synthetic negation change', anchorIds: ['a2'] }] }, actualExecution: execution });
      assert.equal(blocked.selectedForReading, false);
      const correction = await command({ phase: 'NEXT', requestId: 'correct-second-block' });
      assert.equal(correction.action, 'CORRECT'); assert.deepEqual(correction.blockIds, ['b2']);
      const fixed = await command({ phase: 'SAVE', generationRequestRef: correction.generationRequestRef,
        candidates: [{ blockId: 'b2', elements: [{ kind: 'paragraph', translatedText: '除非指示在 5 秒后仍然存在，否则不要更换该组件。', anchorIds: ['a2'] }] }], actualExecution: execution });
      assert.equal(fixed.blocks[0].contentRevision, 2);
      const recheck = await command({ phase: 'NEXT', requestId: 'recheck-second-block' });
      assert.equal(recheck.action, 'CHECK'); assert.equal(recheck.targetBlockRevisionId, fixed.blocks[0].blockRevisionId);
      const accepted = await command({ phase: 'CHECK', generationRequestRef: recheck.generationRequestRef, expectedRowVersion: recheck.targetRowVersion,
        semanticReview: { blockId: 'b2', issues: [] }, actualExecution: execution });
      assert.equal(accepted.selectedForReading, true);
      assert.equal((await command({ phase: 'NEXT', requestId: 'finished' })).action, 'DONE');
      assert.equal((await repository.read(fence)).generationRequests.filter((request) => request.purpose === 'CORRECT').length, 1);
    });
    await t.test('final assembly uses saved selections, is idempotent and detects a forged manifest', async () => {
      final = await command({ phase: 'ASSEMBLE' });
      assert.equal(final.completeness, 'COMPLETE'); assert.equal(persistCount, 1);
      assert.deepEqual(await command({ phase: 'ASSEMBLE' }), final); assert.equal(persistCount, 1);
      const artifact = parseBilingualTranslationArtifactV2(artifacts.get(final.artifact.ref));
      assert.equal(artifact.blocks[1].selected.contentRevision, 2);
      const workItem = { workItemId: 'WI-test', source: { documentId: 'doc-test', documentVersionId: 'dv-test' }, package: { packageId: 'pkg-test', artifact: plan.source.parsedArtifact } };
      const loaded = await service.loadFinalForCommit(active.task, final, workItem); assert.deepEqual(loaded.value, artifact);
      await assert.rejects(service.loadFinalForCommit(active.task, { ...final, manifest: { ...final.manifest, blockRevisions: [] } }, workItem), /FINAL_RESULT_BINDING_INVALID/u);
      assert.equal((await sql`SELECT revision FROM work_item`)[0].revision, 1);
    });
    await t.test('knowledge imports selected semantic blocks through the existing committed-attempt guard and retains exact mappings', async () => {
      const result = sealSkillResultEnvelope({ task: active.task, modelOutput: final,
        provenance: { modelVersion: execution.modelVersion, skillVersion: execution.skillVersion, promptVersion: execution.promptVersion,
          toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION }, runMetrics: { inputUnits: 120, outputUnits: 32, durationMs: 1 } } });
      // Synthetic committed attempt fixture; this is not a production commit.
      await sql`UPDATE action_attempt SET status = 'SUCCEEDED', projection_applied = true, result_content_hash = ${result.contentHash}, result_envelope_json = ${JSON.stringify(result)} WHERE operation_ref = ${fence.attemptRef}`;
      const value = parseBilingualTranslationArtifactV2(artifacts.get(final.artifact.ref));
      const hash = await knowledgeStore.readFinalSemanticCommit({ tenantId: fence.tenantId, workItemId: fence.workItemId,
        actionAttemptId: active.task.actionAttemptId, artifact: final.artifact, value });
      assert.equal(hash, result.contentHash);
      await assert.rejects(knowledgeStore.readFinalSemanticCommit({ tenantId: fence.tenantId, workItemId: fence.workItemId,
        actionAttemptId: active.task.actionAttemptId, artifact: { ...final.artifact, sha256: 'f'.repeat(64) }, value }), /BINDING_INVALID/u);
      const input = { tenantId: fence.tenantId, workItemId: fence.workItemId, snapshotWorkItemRevision: 1, ownerActorId: 'engineer-test', importedByActorId: 'engineer-test',
        sourceArtifact: final.artifact, artifact: value, currentBinding: knowledgeBinding, finalActionAttemptId: active.task.actionAttemptId, finalResultContentHash: hash,
        validFrom: '2026-09-01T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z', importedAt: '2026-09-09T00:00:00.000Z' };
      importedKnowledge = await knowledge.importSemanticCandidates(input); assert.equal(importedKnowledge.createdCount, 2);
      assert.equal((await knowledge.importSemanticCandidates(input)).reusedCount, 2);
      const readInput = { tenantId: fence.tenantId, workItemId: fence.workItemId, currentWorkItemRevision: 1,
        assetId: importedKnowledge.assetIds[0], asOf: '2026-09-09T00:00:00.000Z', currentBinding: knowledgeBinding };
      const snapshot = await knowledge.readCandidate(readInput);
      assert.equal(snapshot.candidate.unit.kind, 'semantic_block:heading'); assert.equal(snapshot.candidate.unit.unitId, firstSaved.blockRevisionId);
      assert.deepEqual(snapshot.semanticScope.anchors, value.anchors.filter((anchor) => value.blocks[0].source.anchorIds.includes(anchor.anchorId)));
      assert.deepEqual(snapshot.semanticScope.elements, firstSaved.candidate.elements); assert.equal(snapshot.retrievalEligibility, 'BLOCKED');
      const confirmed = await knowledge.confirmByHuman({ ...readInput, actorKind: 'HUMAN', actorId: 'engineer-test', reason: 'Synthetic candidate feedback', occurredAt: readInput.asOf });
      assert.equal(confirmed.retrievalEligibility, 'SUGGESTION_ONLY'); assert.equal(confirmed.formalKnowledge, false);
      assert.equal(await knowledgeStore.readSemanticScope({ tenantId: 'wrong-tenant', workItemId: fence.workItemId, blockRevisionId: firstSaved.blockRevisionId }), null);
      await sql`UPDATE action_attempt SET status = 'RUNNING' WHERE operation_ref = ${fence.attemptRef}`;
    });
    await t.test('cancel rejects late writes; a normal successor reuses exact bodies without relabeling models', async () => {
      const oldFence = fence;
      await sql`UPDATE action_attempt SET status = 'CANCELLED', cancel_requested_at = now() WHERE operation_ref = ${fence.attemptRef}`;
      await assert.rejects(repository.saveCandidates({ ...oldFence, generationRequestRef: firstRequest.generationRequestRef, candidates: [firstSaved.candidate], actualExecution: execution }), /LEASE_FENCE_REJECTED/u);
      active = await seedAttempt(sql, workspace, 'second', 'synthetic-dli/gpt-model');
      fence = { ...fence, attemptRef: active.task.operationRef, leaseToken: active.leaseToken };
      workspace = await repository.attachAttempt(fence);
      const snapshot = await repository.readSnapshot(fence);
      const reading = buildTranslationWorkspaceReadingV2(snapshot.workspace, snapshot.revisions);
      assert.equal(reading.completeness, 'COMPLETE');
      assert.ok(reading.blocks.every((block) => block.selected.provenance.executionModel.modelRef === 'miaoda/minimax-m3'));
      assert.ok(reading.blocks.every((block) => block.selected.provenance.originAttemptId === 'ATT-first'));
      await assert.rejects(repository.checkAndSelect({ ...oldFence, blockRevisionId: firstSaved.blockRevisionId, expectedRowVersion: firstSaved.rowVersion, check: firstSaved.check }), /LEASE_FENCE_REJECTED/u);
      const request = await repository.registerGeneration({ ...fence, clientRequestId: 'new-authorized-model', blockIds: ['b1'], purpose: 'CORRECT',
        targetBlockRevisionId: firstSaved.blockRevisionId, dependencies: translationBatchDependenciesV2(workspace, ['b1']) });
      const [newBody] = await repository.saveCandidates({ ...fence, generationRequestRef: request.generationRequestRef,
        candidates: [{ blockId: 'b1', elements: [{ elementId: 'e-new', kind: 'heading', translatedText: '合成测试说明', anchorIds: ['a1'] }] }],
        actualExecution: { ...execution, modelRef: 'synthetic-dli/gpt-model', modelVersion: 'synthetic-dli-version' } });
      await repository.checkAndSelect({ ...fence, blockRevisionId: newBody.blockRevisionId, expectedRowVersion: newBody.rowVersion, check: checkTranslationBlockV2({ plan, candidate: newBody.candidate }) });
      const after = await repository.readSnapshot(fence);
      assert.equal(after.workspace.resultArtifact, null);
      const models = buildTranslationWorkspaceReadingV2(after.workspace, after.revisions).blocks.map((block) => block.selected.provenance.executionModel.modelRef);
      assert.deepEqual(models, ['synthetic-dli/gpt-model', 'miaoda/minimax-m3']);
      await assert.rejects(sql`UPDATE translation_block_revision SET selected_for_reading = true WHERE block_revision_id = ${firstSaved.blockRevisionId}`, /unique|duplicate/u);
      await sql`UPDATE work_item SET document_version_id = 'changed-source' WHERE work_item_id = 'WI-test'`;
      await assert.rejects(repository.attachAttempt(fence), /SOURCE_CHANGED/u);
      await sql`UPDATE work_item SET document_version_id = 'dv-test' WHERE work_item_id = 'WI-test'`;
    });
    await t.test('engineer revisions require owner, stable versions and complete source review, and retain the original model body', async () => {
      const [baseRevision] = (await repository.readBlocks(fence)).filter((entry) => entry.blockId === 'b1');
      const input = { workspaceId: workspace.workspaceId, tenantId: fence.tenantId, workItemId: fence.workItemId,
        actorUserId: 'engineer-test', expectedWorkItemRevision: 1, requestId: randomUUID(),
        baseBlockRevisionId: baseRevision.blockRevisionId, expectedRowVersion: baseRevision.rowVersion,
        candidate: { ...baseRevision.candidate, elements: baseRevision.candidate.elements.map((element) => ({ ...element, translatedText: '合成测试描述' })) } };
      await assert.rejects(repository.saveEngineerRevision(input), /ATTEMPT_ACTIVE/u);
      await sql`UPDATE action_attempt SET status = 'SUCCEEDED' WHERE operation_ref = ${fence.attemptRef}`;
      await assert.rejects(repository.saveEngineerRevision({ ...input, actorUserId: 'wrong-owner' }), /OWNER_MISMATCH/u);
      await assert.rejects(repository.saveEngineerRevision({ ...input, expectedWorkItemRevision: 2 }), /WORK_ITEM_CHANGED/u);
      await assert.rejects(repository.saveEngineerRevision({ ...input, expectedRowVersion: 999 }), /CAS_CONFLICT/u);
      await assert.rejects(repository.saveEngineerRevision({ ...input, candidate: { ...input.candidate,
        elements: [{ ...input.candidate.elements[0], anchorIds: ['a2'] }] } }), /MAPPING_CHANGED/u);
      const edited = await repository.saveEngineerRevision(input);
      assert.equal(edited.contentRevision, baseRevision.contentRevision + 1); assert.equal(edited.selectedForReading, true);
      assert.equal(edited.provenance.authorKind, 'ENGINEER'); assert.equal(edited.provenance.authorUserId, 'engineer-test');
      assert.equal(edited.provenance.modelVersion, null); assert.equal(edited.check.semanticReview.authorKind, 'ENGINEER');
      assert.equal((await repository.saveEngineerRevision(input)).blockRevisionId, edited.blockRevisionId);
      await assert.rejects(repository.saveEngineerRevision({ ...input, candidate: { ...input.candidate,
        elements: [{ ...input.candidate.elements[0], translatedText: '另一段正文' }] } }), /IDEMPOTENCY_CONFLICT/u);
      const versions = await repository.readBlocks(fence);
      assert.equal(versions.find((entry) => entry.blockRevisionId === baseRevision.blockRevisionId).candidate.elements[0].translatedText, '合成测试说明');
      assert.equal(versions.filter((entry) => entry.blockId === 'b1' && entry.selectedForReading).length, 1);
      assert.equal((await repository.read(fence)).resultArtifact, null);
      const oldKnowledge = await knowledge.readCandidate({ tenantId: fence.tenantId, workItemId: fence.workItemId, currentWorkItemRevision: 1,
        assetId: importedKnowledge.assetIds[0], asOf: '2026-09-09T00:00:00.000Z', currentBinding: knowledgeBinding });
      assert.equal(oldKnowledge.sourceCurrentness, 'STALE'); assert.equal(oldKnowledge.retrievalEligibility, 'BLOCKED');
      await assert.rejects(knowledgeStore.appendEvent({ tenantId: fence.tenantId, workItemId: fence.workItemId, snapshotWorkItemRevision: 1,
        assetId: importedKnowledge.assetIds[0], eventId: `TK-EVENT-${randomUUID()}`, requestId: randomUUID(), eventType: 'ENGINEER_ADOPTED',
        feedbackDecision: 'ADOPTED_AS_CANDIDATE_SUGGESTION', expectedRevision: 1, resultingRevision: 2, actorKind: 'HUMAN', actorId: 'engineer-test',
        reason: 'Synthetic stale attempt', createdAt: '2026-09-09T00:00:00.000Z' }), /KNOWLEDGE_TRANSLATION_BLOCK_CHANGED/u);
    });
    await t.test('an explicitly requested replacement preserves the readable body on failure and replaces only its complete block on a normal successor', async () => {
      const before = await repository.readSnapshot(fence);
      const oldReading = buildTranslationWorkspaceReadingV2(before.workspace, before.revisions);
      const oldFirst = oldReading.blocks[0].selected;
      const oldSecond = oldReading.blocks[1].selected;
      active = await seedAttempt(sql, workspace, 'replacement-failed', 'miaoda/minimax-m3', { retranslateBlockIds: ['b1'] });
      fence = { ...fence, attemptRef: active.task.operationRef, leaseToken: active.leaseToken };
      workspace = await repository.attachAttempt(fence);
      const failedRequest = await command({ phase: 'NEXT', requestId: 'replace-failed' });
      assert.deepEqual(failedRequest.blockIds, ['b1']);
      await command({ phase: 'RECORD_FAILURE', generationRequestRef: failedRequest.generationRequestRef,
        error: { origin: 'TRANSPORT', code: 'SYNTHETIC_KNOWN_FAILURE', outcome: 'KNOWN_FAILURE', retryable: false } });
      await assert.rejects(command({ phase: 'ASSEMBLE' }), /REQUESTED_BLOCK_NOT_REPLACED/u);
      const stillReadable = await command({ phase: 'READ' }); assert.equal(stillReadable.completeness, 'COMPLETE');
      await sql`UPDATE action_attempt SET status = 'CANCELLED', cancel_requested_at = now() WHERE operation_ref = ${fence.attemptRef}`;
      active = await seedAttempt(sql, workspace, 'replacement-next', 'miaoda/minimax-m3', { retranslateBlockIds: ['b1'] });
      fence = { ...fence, attemptRef: active.task.operationRef, leaseToken: active.leaseToken };
      workspace = await repository.attachAttempt(fence);
      const next = await command({ phase: 'NEXT', requestId: 'replace-next' });
      assert.equal(next.action, 'GENERATE'); assert.deepEqual(next.blockIds, ['b1']);
      await command({ phase: 'SAVE', generationRequestRef: next.generationRequestRef,
        candidates: [{ blockId: 'b1', elements: [{ kind: 'heading', translatedText: '合成测试的新描述', anchorIds: ['a1'] }] }],
        actualExecution: { ...execution, skillVersion: 'wiselink-research-and-synthesize@r09.c45',
          promptVersion: 'wiselink-translation-block@r09.c45', modelVersion: 'configured-route:miaoda/minimax-m3', providerRequestId: null } });
      const pending = await repository.readSnapshot(fence);
      assert.equal(buildTranslationWorkspaceReadingV2(pending.workspace, pending.revisions).blocks[0].selected.blockRevisionId, oldFirst.blockRevisionId);
      assert.equal((await command({ phase: 'NEXT', requestId: 'finish-replacement' })).action, 'DONE');
      const finalReplacement = await command({ phase: 'ASSEMBLE' });
      const replaced = parseBilingualTranslationArtifactV2(artifacts.get(finalReplacement.artifact.ref));
      assert.equal(replaced.blocks[0].selected.contentRevision, oldFirst.contentRevision + 1);
      assert.equal(replaced.blocks[0].selected.provenance.modelVersion, 'configured-route:miaoda/minimax-m3');
      assert.equal(replaced.blocks[0].selected.provenance.providerRequestId, null);
      assert.equal(replaced.blocks[1].selected.blockRevisionId, oldSecond.blockRevisionId);
      assert.equal((await repository.readBlocks(fence)).find((revision) => revision.blockRevisionId === oldFirst.blockRevisionId).candidate.elements[0].translatedText, oldFirst.candidate.elements[0].translatedText);
      await sql`UPDATE action_attempt SET status = 'SUCCEEDED' WHERE operation_ref = ${fence.attemptRef}`;
    });
    await t.test('one explicit request has one durable reservation under concurrency and after a terminal response is lost', async () => {
      const attemptRepository = new ActionAttemptRepository(db);
      const requestKey = `openclaw-v2:dynamic:WI-test:dv-test:${randomUUID()}`;
      const record = (index) => {
        const task = sealTaskEnvelope({ ...active.task, actionAttemptId: `ATT-queue-${index}`, operationRef: `AQ-queue-${index}`,
          taskType: 'OPENCLAW_DYNAMIC_EVALUATION', idempotencyKey: requestKey, modelInput: { synthetic: true } });
        return { id: randomUUID(), attemptId: task.actionAttemptId, operationRef: task.operationRef, workItemId: 'WI-test',
          actionType: task.taskType, attemptNo: 90 + index, status: 'QUEUED', actorUserId: 'service:openclaw-main', tenantId: 'tenant-test',
          requestOrigin: ACTION_ATTEMPT_REQUEST_ORIGIN, documentVersionId: 'dv-test', inputRevision: 1, baseRevision: 1,
          idempotencyKey: requestKey, taskEnvelopeJson: canonicalJson(task), taskInputHash: task.inputHash,
          executionModelJson: canonicalJson(task.executionModel), createdAt: new Date(), updatedAt: new Date() };
      };
      const concurrent = await Promise.all([attemptRepository.reserve(record(1)), attemptRepository.reserve(record(2))]);
      assert.equal(concurrent.filter((entry) => entry.created).length, 1);
      assert.equal(concurrent[0].row.attemptId, concurrent[1].row.attemptId);
      const other = { ...record(4), idempotencyKey: `${requestKey}-different`, actionType: 'OPENCLAW_OVERALL_SYNTHESIS' };
      await assert.rejects(attemptRepository.reserve(other), { code: 'ACTION_ATTEMPT_ACTIVE_CONFLICT', statusCode: 409 });
      await sql`UPDATE action_attempt SET status = 'SUCCEEDED' WHERE idempotency_key = ${requestKey}`;
      await sql`UPDATE work_item SET revision = 2 WHERE work_item_id = 'WI-test'`;
      const replay = await attemptRepository.reserve(record(3));
      assert.equal(replay.created, false); assert.equal(replay.row.status, 'SUCCEEDED');
      assert.equal(replay.row.attemptId, concurrent[0].row.attemptId);
      assert.equal((await sql`SELECT count(*)::int AS count FROM action_attempt WHERE idempotency_key = ${requestKey}`)[0].count, 1);
      await assert.rejects(attemptRepository.reserve(other), /WORK_ITEM_BINDING_CHANGED/u);
    });
    await t.test('RLS exposes only the owned tenant workspace and no authenticated mutation', async () => {
      const beforeRevision = (await sql`SELECT revision FROM work_item`)[0].revision;
      await sql.begin(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE authenticated');
        await tx`SELECT set_config('app.user_id', 'wrong-user', true)`;
        assert.equal((await tx`SELECT workspace_id FROM translation_workspace`).length, 0);
        assert.equal((await tx`SELECT block_revision_id FROM translation_block_revision`).length, 0);
      });
      await sql.begin(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE authenticated'); await tx`SELECT set_config('app.user_id', 'engineer-test', true)`;
        assert.equal((await tx`SELECT workspace_id FROM translation_workspace`).length, 1);
        assert.ok((await tx`SELECT block_revision_id FROM translation_block_revision`).length >= 3);
        assert.equal((await tx`UPDATE translation_workspace SET row_version = 999 RETURNING workspace_id`).length, 0);
      });
      assert.equal((await sql`SELECT revision FROM work_item`)[0].revision, beforeRevision);
    });
    await t.test('the browser service reads a consistent workspace through the official authenticated SQL context', async () => {
      await sql.unsafe('REVOKE INSERT, UPDATE, DELETE ON translation_workspace, translation_block_revision FROM authenticated');
      const sqlContext = new SqlExecutionContextMiddleware({ roleSchema: 'translation_snapshot_test' });
      const browser = (actorId, operation) => new Promise((resolve, reject) => sqlContext.use(
        { userContext: { userId: actorId, isSystemAccount: false, roles: [] } }, {},
        () => Promise.resolve().then(operation).then(resolve, reject),
      ));
      const current = { workItemId: fence.workItemId, source: { documentVersionId: plan.source.documentVersionId },
        package: { artifact: plan.source.parsedArtifact } };
      const reading = await browser('engineer-test', () => service.readCurrent(current, fence.tenantId));
      assert.equal(reading.workspaceId, workspace.workspaceId);
      assert.equal(reading.blocks.length, plan.blocks.length);
      assert.equal(await browser('wrong-user', () => service.readCurrent(current, fence.tenantId)), null);
      assert.equal(await browser('engineer-test', () => service.readCurrent(current, 'wrong-tenant')), null);
      await assert.rejects(browser('engineer-test', () => repository.readSnapshot({ ...fence, workItemId: 'wrong-work-item' })), /WORKSPACE_NOT_FOUND/u);
    });
    await t.test('a concurrent saved update cannot mix new block versions with an older workspace snapshot', async () => {
      const before = await repository.readSnapshot(fence);
      const blockId = before.revisions[0].blockRevisionId;
      const afterWorkspaceRead = async () => sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL lock_timeout = '1s'");
        await tx`UPDATE translation_workspace SET row_version = row_version + 1 WHERE workspace_id = ${workspace.workspaceId}`;
        await tx`UPDATE translation_block_revision SET row_version = row_version + 1 WHERE block_revision_id = ${blockId}`;
      });
      let firstSelect = true;
      const interleaved = new CanonicalTranslationWorkspaceRepository(new Proxy(db, { get(target, property) {
        if (property === 'transaction') return () => { throw new Error('HOSTED_TRANSACTION_MODE_SWITCH_UNAVAILABLE'); };
        if (property === 'select') return (...args) => {
          const query = target.select(...args);
          if (!firstSelect) return query;
          firstSelect = false;
          return afterQueryResult(query, afterWorkspaceRead);
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      } }));
      const during = await interleaved.readSnapshot(fence);
      assert.equal(during.workspace.rowVersion, before.workspace.rowVersion);
      assert.equal(during.revisions.find((entry) => entry.blockRevisionId === blockId).rowVersion, before.revisions[0].rowVersion);
      const after = await repository.readSnapshot(fence);
      assert.equal(after.workspace.rowVersion, before.workspace.rowVersion + 1);
      assert.equal(after.revisions.find((entry) => entry.blockRevisionId === blockId).rowVersion, before.revisions[0].rowVersion + 1);
    });
    await t.test('authenticated translation intents prepare at Hosted claim with one lease and fenced failure/cancellation', async (t) => {
      await sql.unsafe(`ALTER TABLE work_item ADD COLUMN projection_json text DEFAULT '{}';
        ALTER TABLE action_attempt ALTER COLUMN id SET DEFAULT gen_random_uuid(),
          ALTER COLUMN claim_count SET DEFAULT 0, ALTER COLUMN retry_count SET DEFAULT 0,
          ALTER COLUMN lease_generation SET DEFAULT 0, ALTER COLUMN projection_applied SET DEFAULT false;
        DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role_translation_snapshot_test')
          THEN CREATE ROLE service_role_translation_snapshot_test; END IF; END $$;
        GRANT service_role TO service_role_translation_snapshot_test;`);
      // These existing platform policies permit the queue, while translation
      // workspace RLS remains SELECT-only for the authenticated browser.
      for (const name of ['work_item', 'action_attempt']) {
        await sql.unsafe(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;
          CREATE POLICY ${name}_authenticated ON ${name} FOR ALL TO authenticated USING (true);
          CREATE POLICY ${name}_service ON ${name} FOR ALL TO service_role USING (true);`);
      }
      const sqlContext = new SqlExecutionContextMiddleware({ roleSchema: 'translation_snapshot_test' });
      const asRole = (system, operation) => new Promise((resolve, reject) => sqlContext.use(
        { userContext: { userId: system ? '-1' : 'engineer-test', isSystemAccount: system, roles: [] } }, {},
        () => Promise.resolve().then(operation).then(resolve, reject),
      ));
      const browser = (operation) => asRole(false, operation);
      const hosted = (operation) => asRole(true, operation);
      const attemptRepository = new ActionAttemptRepository(db);
      const lifecycle = new ActionAttemptLifecycleService(attemptRepository, fixedModelSettings());
      let sourceReads = 0;
      let sourceHook = async () => {};
      const reader = { readStructuredSource: async () => {
        const [role] = await db.execute(drizzleSql`SELECT current_user AS role`);
        assert.equal(role.role, 'service_role_translation_snapshot_test');
        sourceReads += 1;
        const source = fixtureSource();
        await sourceHook(source);
        return source;
      } };
      const items = new Map();
      const registrar = { getTenantScopedByWorkItemId: async ({ workItemId, tenantId }) => {
        assert.equal(tenantId, 'tenant-test'); assert.ok(items.has(workItemId));
        return items.get(workItemId);
      } };
      const scope = { authorizeOpenClawWorkItem: async ({ workItemId }) => ({
        tenantId: 'tenant-test', workItemId, principalId: 'service-principal',
        appId: 'app_17bzc551rsg', authorizationFingerprint: 'synthetic-scope',
      }), authorizeOpenClawAttempt: async ({ attemptRef }) => {
        const [row] = await db.select().from(actionAttempt).where(eq(actionAttempt.operationRef, attemptRef));
        assert.equal(row?.tenantId, 'tenant-test'); assert.ok(items.has(row.workItemId));
        return { tenantId: row.tenantId, workItemId: row.workItemId, principalId: 'service-principal' };
      } };
      const semantic = new CanonicalTranslationV2Service(repository, reader, lifecycle, {}, scope);
      const translation = new CanonicalHostOpenClawTranslationService(registrar, {}, reader, {}, lifecycle, scope, semantic);
      const originalFeatureFlag = process.env.WL_TRANSLATION_V2_ENABLED;
      process.env.WL_TRANSLATION_V2_ENABLED = '1';
      const newRequest = async (suffix) => {
        const workItem = { workItemId: `WI-intent-${suffix}`, revision: 1, phase: 'CANDIDATE_READBACK_VERIFIED',
          source: { documentId: 'doc-test', documentVersionId: 'dv-test' },
          package: { packageId: 'pkg-test', contractId: 'techpub.parsed-package.v1', contractRevision: 'frozen.2',
            artifact: plan.source.parsedArtifact, contentUnitCount: 2 } };
        items.set(workItem.workItemId, workItem);
        await sql`INSERT INTO work_item (work_item_id, tenant_id, document_version_id, package_id, package_artifact_ref,
          package_artifact_sha256, requested_by_user_id, revision, projection_json)
          VALUES (${workItem.workItemId}, 'tenant-test', 'dv-test', 'pkg-test', ${plan.source.parsedArtifact.ref},
            ${plan.source.parsedArtifact.sha256}, 'engineer-test', 1, ${JSON.stringify(workItem)})`;
        const requestId = randomUUID();
        const readsBefore = sourceReads;
        const receipt = await browser(async () => {
          const [role] = await db.execute(drizzleSql`SELECT current_user AS role`);
          assert.equal(role.role, 'authenticated_translation_snapshot_test');
          return translation.enqueueContinuation(workItem, 'tenant-test', requestId);
        });
        assert.equal(receipt.status, 'QUEUED'); assert.equal(receipt.created, true);
        assert.equal(sourceReads, readsBefore);
        assert.equal((await sql`SELECT workspace_id FROM translation_workspace WHERE work_item_id = ${workItem.workItemId}`).length, 0);
        const row = await hosted(() => lifecycle.readScoped({ ...receipt, tenantId: 'tenant-test', workItemId: workItem.workItemId }));
        const task = parseTaskEnvelope(row.taskEnvelopeJson);
        assert.equal(readInitialAnalysisRequestInput(task).requestId, requestId);
        assert.equal(row.claimCount, 0); assert.equal(row.leaseToken, null);
        return { workItem, requestId, receipt, row, task,
          begin: () => hosted(() => translation.begin(workItem.workItemId, requestId)),
          cancel: () => hosted(() => lifecycle.requestCancel({ attemptRef: receipt.attemptRef, tenantId: 'tenant-test',
            workItemId: workItem.workItemId, reason: 'Synthetic test cancellation' })),
        };
      };
      const unchangedBindings = (pending, prepared) => {
        const { modelInput: _pending, inputHash: pendingHash, ...before } = pending;
        const { modelInput: _prepared, inputHash: preparedHash, ...after } = prepared;
        assert.deepEqual(after, before); assert.notEqual(preparedHash, pendingHash);
        assert.equal(readInitialAnalysisRequestInput(prepared), null);
        assert.equal(prepared.modelInput.schemaVersion, 'wiselink.3_1.translation_task.v2');
      };
      try {
        await t.test('batched semantic checks bind every candidate and save atomically with exact replay', async () => {
          const pending = await newRequest('check-batch');
          sourceHook = async (source) => {
            source.units[0].kind = 'paragraph';
            source.units[0].payload = { text: 'Do not replace the sensor unless the indication remains after 7 seconds.', role: 'body' };
          };
          let claimed;
          try { claimed = await pending.begin(); }
          finally { sourceHook = async () => {}; }
          const binding = { attemptRef: claimed.attemptRef, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration };
          const cmd = (args) => hosted(() => semantic.execute({ ...binding, ...args }));
          const scopeInput = { workspaceId: claimed.task.modelInput.workspaceId, tenantId: 'tenant-test', workItemId: pending.workItem.workItemId };
          const snapshot = () => hosted(() => repository.readSnapshot(scopeInput));
          const generate = await cmd({ phase: 'NEXT', requestId: 'batch-generate', batchSemanticChecks: true });
          assert.equal(generate.action, 'GENERATE'); assert.deepEqual(generate.blockIds, ['b1', 'b2']);
          await cmd({ phase: 'SAVE', generationRequestRef: generate.generationRequestRef, actualExecution: execution,
            candidates: [
              { blockId: 'b1', elements: [{ kind: 'paragraph', translatedText: '除非指示在 7 秒后仍然存在，否则不要更换传感器。', anchorIds: ['a1'] }] },
              { blockId: 'b2', elements: [{ kind: 'paragraph', translatedText: '除非指示在 5 秒后仍然存在，否则不要更换该组件。', anchorIds: ['a2'] }] },
            ] });
          const next = await cmd({ phase: 'NEXT', requestId: 'batch-check', batchSemanticChecks: true });
          assert.equal(next.action, 'CHECK_BATCH'); assert.deepEqual(next.blockIds, ['b1', 'b2']);
          const before = await snapshot();
          assert.deepEqual(next.checkTargets, before.revisions.map((entry) => ({ blockId: entry.blockId,
            blockRevisionId: entry.blockRevisionId, rowVersion: entry.rowVersion })));
          const args = { phase: 'CHECK_BATCH', generationRequestRef: next.generationRequestRef, actualExecution: execution,
            semanticReviews: [{ blockId: 'b1', issues: [] }, { blockId: 'b2', issues: [
              { code: 'SYNTHETIC_MEANING_CHANGE', severity: 'BLOCK', message: 'Synthetic per-block semantic finding', anchorIds: ['a2'] },
            ] }] };
          await assert.rejects(cmd({ ...args, semanticReviews: [...args.semanticReviews].reverse() }), /TARGET_INVALID/u);
          await assert.rejects(cmd({ ...args, semanticReviews: args.semanticReviews.slice(0, 1) }));
          await assert.rejects(cmd({ ...args, semanticReviews: [args.semanticReviews[0], { ...args.semanticReviews[1],
            issues: [{ ...args.semanticReviews[1].issues[0], anchorIds: ['a1'] }] }] }), /SEMANTIC_REVIEW/u);
          await assert.rejects(cmd({ ...args, actualExecution: { ...execution, modelRef: 'other/model' } }), /MODEL_MISMATCH/u);
          assert.deepEqual(await snapshot(), before);
          const secondId = next.checkTargets[1].blockRevisionId;
          await sql`UPDATE translation_block_revision SET row_version = row_version + 1 WHERE block_revision_id = ${secondId}`;
          const stale = await snapshot();
          await assert.rejects(cmd(args), /CHECK_CAS_CONFLICT/u);
          assert.deepEqual(await snapshot(), stale, 'a later stale block rolls back every earlier block check');
          await sql`UPDATE translation_block_revision SET row_version = row_version - 1 WHERE block_revision_id = ${secondId}`;
          const saved = await cmd(args);
          assert.equal(saved.generationRequestRef, next.generationRequestRef);
          assert.deepEqual(saved.blocks.map((entry) => entry.selectedForReading), [true, false]);
          assert.ok(saved.blocks.every((entry, index) => entry.rowVersion === next.checkTargets[index].rowVersion + 1));
          const after = await snapshot();
          assert.equal(after.workspace.generationRequests.at(-1).status, 'SAVED');
          assert.deepEqual(await cmd(args), saved);
          assert.deepEqual(await snapshot(), after, 'exact result replay does not change versions or timestamps');
          await assert.rejects(cmd({ ...args, semanticReviews: [{ blockId: 'b1', issues: [] }, { blockId: 'b2', issues: [] }] }), /CHECK_CAS_CONFLICT/u);
          await pending.cancel();
          await assert.rejects(cmd(args));
          assert.deepEqual(await snapshot(), after, 'cancelled attempt cannot write or replay checks');
        });
        await t.test('browser replay creates no source work; runtime prepares once and preserves all request bindings', async () => {
          const pending = await newRequest('success');
          const readsBefore = sourceReads;
          assert.deepEqual(await browser(() => translation.enqueueContinuation(pending.workItem, 'tenant-test', pending.requestId)), {
            ...pending.receipt, created: false,
          });
          const claimed = await pending.begin();
          assert.equal(claimed.attemptRef, pending.receipt.attemptRef);
          assert.equal(sourceReads, readsBefore + 1);
          unchangedBindings(pending.task, claimed.task);
          assert.equal((await sql`SELECT workspace_id FROM translation_workspace WHERE work_item_id = ${pending.workItem.workItemId}`).length, 1);
          const replay = await pending.begin();
          assert.equal(replay.leaseToken, claimed.leaseToken); assert.equal(replay.leaseGeneration, 1);
          assert.equal(sourceReads, readsBefore + 1);
          const { inputHash: _claimedHash, ...unsealedClaimed } = claimed.task;
          const changed = sealTaskEnvelope({ ...unsealedClaimed, modelInput: { ...claimed.task.modelInput, contextRevision: 999 } });
          assert.equal(await hosted(() => attemptRepository.prepareInitialRequestInput(pending.row, changed)), null);
          await hosted(() => attemptRepository.failInitialRequestPreparation(pending.row, 'SYNTHETIC_LATE_FAILURE'));
          const current = await hosted(() => attemptRepository.readByAttemptId(pending.row.attemptId));
          assert.equal(current.status, 'RUNNING'); assert.equal(current.claimCount, 1);
          assert.equal(current.taskInputHash, claimed.task.inputHash); assert.equal(current.errorCode, null);
          await pending.cancel();
        });
        await t.test('source preparation failure terminates only its queued request without a lease or result', async () => {
          const pending = await newRequest('failure');
          sourceHook = async () => { throw new Error('SYNTHETIC_SOURCE_READ_FAILED'); };
          try { await assert.rejects(pending.begin(), /SYNTHETIC_SOURCE_READ_FAILED/u); }
          finally { sourceHook = async () => {}; }
          const current = await hosted(() => attemptRepository.readByAttemptId(pending.row.attemptId));
          assert.equal(current.status, 'FAILED'); assert.equal(current.errorCode, 'SYNTHETIC_SOURCE_READ_FAILED');
          assert.equal(current.claimCount, 0); assert.equal(current.leaseToken, null);
          assert.equal(current.taskInputHash, pending.task.inputHash);
          assert.equal(current.resultEnvelopeJson, null); assert.equal(current.projectionApplied, false);
        });
        await t.test('cancellation during preparation is preserved by both preparation and failure CAS', async () => {
          const pending = await newRequest('cancel');
          sourceHook = async () => { await pending.cancel(); };
          try { await assert.rejects(pending.begin(), /ACTION_ATTEMPT_ALREADY_CANCELLED/u); }
          finally { sourceHook = async () => {}; }
          await hosted(() => attemptRepository.failInitialRequestPreparation(pending.row, 'SYNTHETIC_LATE_FAILURE'));
          const current = await hosted(() => attemptRepository.readByAttemptId(pending.row.attemptId));
          assert.equal(current.status, 'CANCELLED'); assert.equal(current.claimCount, 0);
          assert.equal(current.taskInputHash, pending.task.inputHash); assert.equal(current.leaseToken, null);
          assert.equal(current.resultEnvelopeJson, null); assert.equal(current.projectionApplied, false);
        });
        await t.test('concurrent runtime preparation converges on one saved envelope and one lease', async () => {
          const pending = await newRequest('concurrent');
          let arrived = 0; let release;
          const bothRead = new Promise((resolve) => { release = resolve; });
          sourceHook = async () => { if (++arrived === 2) release(); await bothRead; };
          let claims;
          try { claims = await Promise.all([pending.begin(), pending.begin()]); }
          finally { sourceHook = async () => {}; }
          assert.equal(arrived, 2);
          assert.equal(claims[0].leaseToken, claims[1].leaseToken);
          assert.equal(claims[0].task.inputHash, claims[1].task.inputHash);
          unchangedBindings(pending.task, claims[0].task);
          const current = await hosted(() => attemptRepository.readByAttemptId(pending.row.attemptId));
          assert.equal(current.claimCount, 1); assert.equal(current.leaseGeneration, 1);
          assert.equal((await sql`SELECT workspace_id FROM translation_workspace WHERE work_item_id = ${pending.workItem.workItemId}`).length, 1);
          await pending.cancel();
        });
        await t.test('an expired queued request performs no source preparation and gets no new deadline', async () => {
          const pending = await newRequest('expired');
          const expiredAt = new Date(Date.now() - 1000);
          const { inputHash: _pendingHash, ...unsealedPending } = pending.task;
          const expiredTask = sealTaskEnvelope({ ...unsealedPending, deadline: expiredAt.toISOString() });
          await sql`UPDATE action_attempt SET deadline_at = ${expiredAt.toISOString()}, task_envelope_json = ${canonicalJson(expiredTask)},
            task_input_hash = ${expiredTask.inputHash} WHERE attempt_id = ${pending.row.attemptId}`;
          const readsBefore = sourceReads;
          await assert.rejects(pending.begin(), /ACTION_ATTEMPT_TIMED_OUT/u);
          assert.equal(sourceReads, readsBefore);
          const current = await hosted(() => attemptRepository.readByAttemptId(pending.row.attemptId));
          assert.equal(current.status, 'TIMED_OUT'); assert.equal(current.claimCount, 0);
          assert.equal(current.deadlineAt.toISOString(), expiredAt.toISOString());
        });
      } finally {
        if (originalFeatureFlag === undefined) delete process.env.WL_TRANSLATION_V2_ENABLED;
        else process.env.WL_TRANSLATION_V2_ENABLED = originalFeatureFlag;
      }
    });
  } finally { await sql.end({ timeout: 5 }); }
});

function afterQueryResult(query, operation) {
  return new Proxy(query, { get(target, property) {
    if (property === 'then') return (resolve, reject) => Promise.resolve(target)
      .then(async (result) => { await operation(); return result; }).then(resolve, reject);
    const value = Reflect.get(target, property);
    return typeof value === 'function'
      ? (...args) => afterQueryResult(value.apply(target, args), operation)
      : value;
  } });
}

async function reset(sql) {
  await sql.unsafe(`DROP TABLE IF EXISTS translation_knowledge_governance_event, translation_knowledge_import_request_item, translation_knowledge_source_ref,
    translation_knowledge_candidate, translation_block_revision, translation_workspace, action_attempt, work_item, identity_subject_mapping, dm_document_parse_run, dm_document_version CASCADE;
    DROP FUNCTION IF EXISTS translation_block_guard_subject() CASCADE;
    DROP FUNCTION IF EXISTS dm_guard_parse_run() CASCADE;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='user_profile') THEN CREATE TYPE user_profile AS (user_id text); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated_translation_snapshot_test') THEN CREATE ROLE authenticated_translation_snapshot_test; END IF; END $$;
    GRANT authenticated TO authenticated_translation_snapshot_test;
    CREATE TABLE work_item (work_item_id varchar(96) UNIQUE NOT NULL, tenant_id varchar(128) NOT NULL, document_version_id varchar(96), package_id text,
      package_artifact_ref text, package_artifact_sha256 varchar(64), requested_by_user_id varchar(255), revision integer, initial_aily_session_id text, UNIQUE(tenant_id,work_item_id));
    CREATE TABLE identity_subject_mapping (miaoda_user_id text, miaoda_tenant_id text, expected_client_id text, status text);`);
  // Parent fixture shape follows the generated schema; assertions exercise the
  // actual new DDL, constraints, RLS and repository transactions below.
  const columns = getTableConfig(actionAttempt).columns.map((column) => `"${column.name.replaceAll('"', '""')}" ${column.getSQLType()}`);
  await sql.unsafe(`CREATE TABLE action_attempt (${columns.join(',')}, UNIQUE(attempt_id), UNIQUE(operation_ref))`);
  const migrationConnection = await sql.reserve();
  try {
    await migrationConnection.unsafe(await readFile(new URL('../../migrations/0003_action_attempt_openclaw_v1.sql', import.meta.url), 'utf8'));
    await migrationConnection.unsafe(await readFile(new URL('../../migrations/0025_translation_workspace.sql', import.meta.url), 'utf8'));
    await migrationConnection.unsafe(await readFile(new URL('../../migrations/0015_translation_memory_knowledge_governance.sql', import.meta.url), 'utf8'));
  } finally {
    await migrationConnection.release();
  }
  await sql.unsafe(`CREATE TABLE dm_document_version (document_version_id varchar(96) PRIMARY KEY, source_artifact_id varchar(96), pdf_sha256 varchar(64), byte_length bigint);
    CREATE OR REPLACE FUNCTION engineering_matter_actor_has_tenant(t varchar) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT t = 'tenant-test' AND current_setting('app.user_id', true) = 'engineer-test' $$;
    CREATE OR REPLACE FUNCTION engineering_matter_document_owned_by_actor(t varchar, d varchar) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT t = 'tenant-test' AND d = 'dv-test' AND current_setting('app.user_id', true) = 'engineer-test' $$;`);
  const documentMigration = await sql.reserve();
  try {
  await documentMigration.unsafe(await readFile(new URL('../../migrations/0038_document_parse_run.sql', import.meta.url), 'utf8'));
  await documentMigration.unsafe(await readFile(new URL('../../migrations/0044_document_parse_step_lease.sql', import.meta.url), 'utf8'));
  await documentMigration.unsafe(await readFile(new URL('../../migrations/0047_document_translation_workspace_subject.sql', import.meta.url), 'utf8'));
  } finally { await documentMigration.release(); }
  await sql.unsafe('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role, authenticated');
}
function fixturePlan() {
  return buildTranslationSourcePlan({ documentVersionId: 'dv-test', packageId: 'pkg-test', title: 'Synthetic only',
    parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'artifact://synthetic/source', sha256: '1'.repeat(64), byteLength: 1, mediaType: 'application/json' },
    source: fixtureSource() });
}
function fixtureSource() {
  const texts = ['Synthetic test description', 'Do not replace the unit unless the indication remains after 5 seconds.'];
  return { modules: [{ moduleId: 'm', order: 0 }], findings: [], references: [],
      sourceLocators: texts.map((_text, i) => ({ sourceRefId: `sr${i}`, kind: 'pdf_page', artifactId: 'source', pageStart: i + 1, pageEnd: i + 1, charStart: null, charEnd: null, charOffsetUnit: null, normalizedPath: null, xpath: null, elementId: null, quote: null, bbox: null })),
      units: texts.map((text, i) => ({ unitId: `u${i}`, kind: i === 0 ? 'heading' : 'paragraph', moduleId: 'm', parentUnitId: i === 0 ? null : 'u0', order: i, depth: i,
        continuityKey: `u${i}`, sourceRefIds: [`sr${i}`], sourceSegmentIds: [`seg${i}`], mapping: { status: 'mapped_exactly', confidence: 'deterministic', findingIds: [] },
        payload: i === 0 ? { text, level: 1 } : { text, role: 'body' } })),
    };
}
async function seedAttempt(sql, workspace, suffix, modelRef, extraModelInput = {}) {
  const now = new Date(); const leaseToken = randomUUID(); const deadline = new Date(now.getTime() + 60 * 60_000);
  const executionModel = { modelRef, displayName: 'Synthetic model', providerKind: modelRef.startsWith('miaoda/') ? 'BUILT_IN' : 'CUSTOM', settingsRevision: 1, selectedAt: now.toISOString() };
  const task = sealTaskEnvelope({ schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', actionAttemptId: `ATT-${suffix}`, operationRef: `AQ-${suffix}`, taskType: 'OPENCLAW_TRANSLATE', priority: 1,
    tenantId: 'tenant-test', workItemId: 'WI-test', inputRevision: 1, baseRevision: 1, documentVersionId: 'dv-test', sourceRefs: [{ ref: workspace.plan.source.parsedArtifact.ref, sha256: workspace.plan.source.parsedArtifact.sha256 }],
    allowedConnectors: [], hostResolvedMissingInputs: [], modelInput: { schemaVersion: 'wiselink.3_1.translation_task.v2', workspaceId: workspace.workspaceId, planRevision: 1, contextRevision: 1, methodVersion: workspace.methodVersion, ...extraModelInput },
    executionModel, deadline: deadline.toISOString(), idempotencyKey: `synthetic-translation-${suffix}` });
  await sql`INSERT INTO action_attempt (id, attempt_id, operation_ref, work_item_id, action_type, status, actor_user_id, tenant_id, input_revision, base_revision, document_version_id,
    task_envelope_json, task_input_hash, idempotency_key, execution_model_json, lease_owner, lease_token, lease_generation, lease_expires_at, deadline_at, created_at, updated_at)
    VALUES (${randomUUID()}, ${task.actionAttemptId}, ${task.operationRef}, 'WI-test', 'OPENCLAW_TRANSLATE', 'RUNNING', 'service:openclaw-main', 'tenant-test', 1, 1, 'dv-test',
      ${canonicalJson(task)}, ${task.inputHash}, ${task.idempotencyKey}, ${canonicalJson(executionModel)}, 'service-principal', ${leaseToken}, 1, ${deadline.toISOString()}, ${deadline.toISOString()}, ${now.toISOString()}, ${now.toISOString()})`;
  return { task, leaseToken };
}

test('official plugin V2 persists truthful provenance and resumes saved blocks through existing leases', { skip: !databaseUrl, concurrency: false }, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/wiselink_translation_v2_test_[a-z0-9_]+$/u);
  const sql = postgres(databaseUrl, { max: 1, onnotice() {} });
  const { CanonicalTranslationV2PluginService } = require('../../server/modules/canonical-host/canonical-translation-v2-plugin.service.ts');
  try {
    await reset(sql);
    const repository = new CanonicalTranslationWorkspaceRepository(drizzle(sql));
    const fragmented = fixtureSource();
    const originalBody = fragmented.units[1];
    fragmented.units = [fragmented.units[0], ...['Do not replace', 'the unit unless', 'the indication remains after 5 seconds.'].map((text, i) => ({
      ...structuredClone(originalBody), unitId: `sentence-${i}`, order: i + 1, continuityKey: 'one-sentence',
      sourceRefIds: [`sentence-ref-${i}`], payload: { text, role: 'body' },
    }))];
    fragmented.sourceLocators = [fragmented.sourceLocators[0], ...[0, 1, 2].map(i => ({
      ...fragmented.sourceLocators[1], sourceRefId: `sentence-ref-${i}`, pageStart: i + 2, pageEnd: i + 2,
    }))];
    const plan = buildTranslationSourcePlan({ ...fixturePlan().source, title: 'Fragmented sentence fixture', source: fragmented });
    assert.equal(plan.blocks.length, 2);
    await sql`INSERT INTO work_item VALUES ('WI-test', 'tenant-test', 'dv-test', 'pkg-test', ${plan.source.parsedArtifact.ref}, ${plan.source.parsedArtifact.sha256}, 'engineer-test', 1)`;
    await sql`INSERT INTO identity_subject_mapping VALUES ('engineer-test', 'tenant-test', 'cli_aadde8b579f95bc9', 'ACTIVE')`;
    const workspace = await repository.prepare({ tenantId: 'tenant-test', workItemId: 'WI-test', plan });
    const legacy = await seedAttempt(sql, workspace, 'legacy-no-plugin', 'miaoda/minimax-m3');
    const legacyFence = { workspaceId: workspace.workspaceId, tenantId: 'tenant-test', workItemId: 'WI-test', principalId: 'service-principal',
      attemptRef: legacy.task.operationRef, leaseToken: legacy.leaseToken, leaseGeneration: 1 };
    await repository.attachAttempt(legacyFence);
    await assert.rejects(repository.assertOfficialExecution(legacyFence), /TRANSLATION_OFFICIAL_PLUGIN_BINDING_INVALID/u);
    await sql`UPDATE action_attempt SET status='FAILED' WHERE attempt_id=${legacy.task.actionAttemptId}`;
    const active = await seedAttempt(sql, workspace, 'official-plugin', 'miaoda/minimax-m3', { documentProducer: 'OFFICIAL_PLUGIN' });
    const fence = { ...legacyFence, attemptRef: active.task.operationRef, leaseToken: active.leaseToken };
    const calls = [];
    let upstreamCalls = 0;
    const { DocumentPluginOutputError } = require('../../server/modules/document-management/src/hosted/nest/document-official-plugin.service.ts');
    const producer = (check = false) => ({ kind: 'OFFICIAL_PLUGIN', instanceId: check ? 'wl-document-translation-check' : 'wl-document-translate',
      pluginVersion: check ? '1.0.26' : '1.0.11', actionKey: check ? 'textToJson' : 'translate', concreteModel: null });
    const plugins = {
      async translateProse(text, assertActive) { await assertActive();
        if (++upstreamCalls === 1) throw new DocumentPluginOutputError('DOCUMENT_TRANSLATION_OUTPUT_INVALID');
        calls.push(text); return {
        translation: text.includes('unless') ? '除非指示在 5 秒后仍然存在，否则不要更换该组件。' : '构造测试说明', producer: producer() }; },
      async checkTranslation(input, assertActive) { await assertActive(); return { review: { blockId: input.blockId, issues: [] }, producer: producer(true) }; },
    };
    const savedArtifacts = new Map();
    const artifacts = { persistAndReadback: async bytes => {
      const ref = 'artifact://synthetic/official-result'; savedArtifacts.set(ref, Buffer.from(bytes));
      return { artifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref, sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.length, mediaType: 'application/json' }, bytes };
    } };
    const v2 = new CanonicalTranslationV2Service(repository, {}, {}, artifacts, {});
    const service = new CanonicalTranslationV2PluginService(repository, plugins, v2);
    await assert.rejects(service.executeStep({ fence, requestId: 'malformed-output', assertAuthorized: async () => {} }), /DOCUMENT_TRANSLATION_OUTPUT_INVALID/);
    const failedRequest = (await repository.readSnapshot(fence)).workspace.generationRequests[0];
    assert.equal(failedRequest.status, 'FAILED');
    assert.equal(failedRequest.error.origin, 'OUTPUT_CONTRACT');
    assert.equal(failedRequest.error.outcome, 'KNOWN_FAILURE');
    // Save succeeded but caller lost the response. A later step must inspect saved rows.
    const actualSave = repository.saveCandidates.bind(repository);
    let loseResponse = true;
    repository.saveCandidates = async input => { const saved = await actualSave(input);
      if (loseResponse) { loseResponse = false; throw new Error('SAVE_RESPONSE_LOST'); } return saved; };
    await assert.rejects(service.executeStep({ fence, requestId: 'official-step-0', assertAuthorized: async () => {} }), /SAVE_RESPONSE_LOST/u);
    let outcome;
    for (let index = 1; index < 8; index++) {
      outcome = await service.executeStep({ fence, requestId: `official-step-${index}`, assertAuthorized: async () => {} });
      if (outcome.status === 'DONE') break;
    }
    assert.equal(outcome.status, 'DONE');
    assert.equal(upstreamCalls, 3, 'known malformed result permits a new bounded request');
    assert.equal(calls.length, 2);
    assert.ok(outcome.result.artifact);
    assert.ok(savedArtifacts.has(outcome.result.artifact.ref));
    const snapshot = await repository.readSnapshot(fence);
    const reading = buildTranslationWorkspaceReadingV2(snapshot.workspace, snapshot.revisions);
    assert.equal(reading.completeness, 'COMPLETE');
    for (const block of reading.blocks) {
      assert.equal(block.selected.provenance.executionModel, null);
      assert.equal(block.selected.provenance.modelVersion, null);
      assert.equal(block.selected.provenance.skillVersion, null);
      assert.equal(block.selected.provenance.producer.kind, 'OFFICIAL_PLUGIN');
      assert.equal(block.selected.provenance.usage.inputTokens, null);
    }
    assert.equal(reading.blocks[1].selected.check.semanticReview.producer.instanceId, 'wl-document-translation-check');
    assert.equal(reading.blocks[1].selected.candidate.elements.length, 1, 'one natural sentence is not split back into extraction fragments');
    assert.equal(reading.blocks[1].selected.candidate.elements[0].anchorIds.length, 3, 'the single translated sentence retains all three source anchors');
    assert.equal(calls[1], 'Do not replace\nthe unit unless\nthe indication remains after 5 seconds.');
    await sql`UPDATE action_attempt SET cancel_requested_at=now() WHERE attempt_id=${active.task.actionAttemptId}`;
    await assert.rejects(service.executeStep({ fence, requestId: 'cancelled', assertAuthorized: async () => {} }), /LEASE_FENCE_REJECTED/u);
    assert.equal(calls.length, 2);
  } finally { await sql.end({ timeout: 5 }); }
});

test('independent DocumentVersion translates with no WorkItem and rejects stale original or wrong subject', { skip: !databaseUrl, concurrency: false }, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/wiselink_translation_v2_test_[a-z0-9_]+$/u);
  const sql = postgres(databaseUrl, { max: 1, onnotice() {} });
  const { CanonicalTranslationV2PluginService } = require('../../server/modules/canonical-host/canonical-translation-v2-plugin.service.ts');
  try {
    await reset(sql);
    await sql.unsafe(`DROP FUNCTION IF EXISTS action_attempt_check_document_original() CASCADE;
      DROP FUNCTION IF EXISTS action_attempt_preserve_document_subject() CASCADE;
      DROP FUNCTION IF EXISTS document_translation_attempt_owned(varchar,varchar,varchar,varchar,integer) CASCADE;
      ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_subject CHECK (true);
      CREATE TABLE IF NOT EXISTS engineering_matter (tenant_id varchar, matter_id varchar, current_matter_revision_id varchar);
      CREATE OR REPLACE FUNCTION engineering_matter_owned_by_actor(t varchar, m varchar) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
      CREATE OR REPLACE FUNCTION engineering_matter_all_links_owned_by_actor(t varchar, m varchar) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
      CREATE POLICY action_attempt_matter_subject_boundary ON action_attempt AS RESTRICTIVE FOR ALL TO PUBLIC USING (true);`);
    await sql.unsafe(await readFile(new URL('../../migrations/0048_document_translation_attempt_subject.sql', import.meta.url), 'utf8'));
    await sql.unsafe(await readFile(new URL('../../migrations/0052_document_subject_explicit_platform_roles.sql', import.meta.url), 'utf8'));
    const documentPolicies = await sql`SELECT policyname, roles, permissive FROM pg_policies
      WHERE schemaname='public' AND policyname IN ('translation_workspace_document_boundary',
        'translation_block_document_boundary','action_attempt_document_subject_boundary')`;
    assert.equal(documentPolicies.length, 3);
    for (const policy of documentPolicies) {
      assert.equal(policy.permissive, 'RESTRICTIVE');
      assert.deepEqual([...policy.roles].sort(), ['authenticated', 'service_role']);
    }
    const repository = new CanonicalTranslationWorkspaceRepository(drizzle(sql));
    const plan = fixturePlan();
    plan.source.packageId = 'parse-document-test';
    plan.source.parsedArtifact.ref = 'document-original://dv-test/parse-document-test';
    plan.source.originalBinding = { documentVersionId: 'dv-test', parseRunId: 'parse-document-test', parseRevision: 1,
      sourceArtifactId: 'pdf-test', sourceSha256: 'a'.repeat(64), sourceByteLength: 123 };
    const binding = { documentVersionId: 'dv-test', sourceArtifactId: 'pdf-test', pdfSha256: 'a'.repeat(64), byteLength: 123 };
    const manifest = { role: 'MANIFEST', relativePath: 'original/manifest.json', readback: 'VERIFIED',
      sha256: plan.source.parsedArtifact.sha256, byteLength: 1, mediaType: 'application/json' };
    await sql`INSERT INTO dm_document_version VALUES ('dv-test','pdf-test',${'a'.repeat(64)},123)`;
    await sql`INSERT INTO dm_document_parse_run (parse_run_id,document_version_id,tenant_id,actor_user_id,request_id,
      parse_revision,expected_published_revision,status,bucket_id,source_binding,manifest_artifact,deadline_at,completed_at)
      VALUES ('parse-document-test','dv-test','tenant-test','engineer-test','request-doc',1,0,'PUBLISHED','test',${JSON.stringify(binding)}::jsonb,${JSON.stringify(manifest)}::jsonb,now()+interval '1 hour',now())`;
    await sql.unsafe("SET ROLE service_role; SELECT set_config('app.user_id','engineer-test',false)");
    const scope = { tenantId: 'tenant-test', workItemId: null, documentVersionId: 'dv-test' };
    const workspace = await repository.prepare({ ...scope, plan });
    assert.equal(workspace.workItemId, null);
    assert.equal(workspace.subjectKind, 'DOCUMENT_VERSION');
    assert.equal((await repository.prepare({ ...scope, plan })).workspaceId, workspace.workspaceId);
    assert.equal((await sql`SELECT count(*)::int n FROM work_item`)[0].n, 0);
    const { sealDocumentTranslationTaskEnvelope } = require('../../server/modules/action-attempt/document-translation-task-envelope.ts');
    const deadline = new Date(Date.now() + 3600000).toISOString();
    const task = sealDocumentTranslationTaskEnvelope({ schemaVersion: 'wiselink.document.translation_task.v1',
      actionAttemptId: 'ATT-document', operationRef: 'AQ-document', tenantId: 'tenant-test', documentVersionId: 'dv-test',
      parseRunId: 'parse-document-test', parseRevision: 1, workspaceId: workspace.workspaceId,
      modelInput: { schemaVersion: 'wiselink.3_1.translation_task.v2', documentProducer: 'OFFICIAL_PLUGIN',
        workspaceId: workspace.workspaceId, planRevision: 1, contextRevision: 1, methodVersion: workspace.methodVersion,
        source: workspace.plan.source }, deadline, idempotencyKey: 'doc-translation-test' });
    const active = { task, leaseToken: randomUUID() };
    await sql`INSERT INTO action_attempt (id,attempt_id,operation_ref,subject_kind,document_version_id,producer_run_id,action_type,
      status,actor_user_id,tenant_id,input_revision,task_envelope_json,task_input_hash,lease_owner,lease_token,lease_generation,lease_expires_at,deadline_at)
      VALUES (${randomUUID()},${task.actionAttemptId},${task.operationRef},'DOCUMENT_VERSION','dv-test','parse-document-test','DOCUMENT_TRANSLATE',
        'RUNNING','engineer-test','tenant-test',1,${canonicalJson(task)},${task.inputHash},'service-principal',${active.leaseToken},1,${deadline},${deadline})`;
    const fence = { ...scope, workspaceId: workspace.workspaceId, attemptRef: task.operationRef, principalId: 'service-principal',
      leaseToken: active.leaseToken, leaseGeneration: 1 };
    await assert.rejects(repository.readSnapshot({ ...fence, documentVersionId: 'another-dv' }), /WORKSPACE_NOT_FOUND/);
    await assert.rejects(repository.attachAttempt({ ...fence, documentVersionId: 'another-dv' }), /LEASE_FENCE_REJECTED/);
    const calls = [];
    const producer = (check = false) => ({ kind: 'OFFICIAL_PLUGIN', instanceId: check ? 'wl-document-translation-check' : 'wl-document-translate',
      pluginVersion: check ? '1.0.26' : '1.0.11', actionKey: check ? 'textToJson' : 'translate', concreteModel: null });
    const plugins = {
      async translateProse(text, assertActive) { await assertActive(); calls.push(text); return {
        translation: text.includes('unless') ? '除非指示在 5 秒后仍然存在，否则不要更换该组件。' : '构造测试说明', producer: producer() }; },
      async checkTranslation(input, assertActive) { await assertActive(); return { review: { blockId: input.blockId, issues: [] }, producer: producer(true) }; },
    };
    const savedArtifacts = new Map();
    const artifacts = { persistAndReadback: async bytes => {
      const ref = 'artifact://synthetic/official-result'; savedArtifacts.set(ref, Buffer.from(bytes));
      return { artifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref, sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.length, mediaType: 'application/json' }, bytes };
    } };
    const v2 = new CanonicalTranslationV2Service(repository, {}, {}, artifacts, {});
    const service = new CanonicalTranslationV2PluginService(repository, plugins, v2);
    // Save succeeded but caller lost the response. A later step must inspect saved rows.
    const actualSave = repository.saveCandidates.bind(repository);
    let loseResponse = true;
    repository.saveCandidates = async input => { const saved = await actualSave(input);
      if (loseResponse) { loseResponse = false; throw new Error('SAVE_RESPONSE_LOST'); } return saved; };
    await assert.rejects(service.executeStep({ fence, requestId: 'official-step-0', assertAuthorized: async () => {} }), /SAVE_RESPONSE_LOST/u);
    let outcome;
    for (let index = 1; index < 8; index++) {
      outcome = await service.executeStep({ fence, requestId: `official-step-${index}`, assertAuthorized: async () => {} });
      if (outcome.status === 'DONE') break;
    }
    assert.equal(outcome.status, 'DONE');
    assert.equal(calls.length, 2);
    assert.ok(outcome.result.artifact);
    assert.ok(savedArtifacts.has(outcome.result.artifact.ref));
    const snapshot = await repository.readSnapshot(fence);
    const reading = buildTranslationWorkspaceReadingV2(snapshot.workspace, snapshot.revisions);
    assert.equal(reading.completeness, 'COMPLETE');
    for (const block of reading.blocks) {
      assert.equal(block.selected.provenance.executionModel, null);
      assert.equal(block.selected.provenance.modelVersion, null);
      assert.equal(block.selected.provenance.skillVersion, null);
      assert.equal(block.selected.provenance.producer.kind, 'OFFICIAL_PLUGIN');
      assert.equal(block.selected.provenance.usage.inputTokens, null);
    }
    assert.equal(reading.blocks[1].selected.check.semanticReview.producer.instanceId, 'wl-document-translation-check');
    await sql.unsafe("SELECT set_config('app.user_id','another-user',false)");
    await assert.rejects(repository.readSnapshot(fence), /WORKSPACE_NOT_FOUND/);
    await sql.unsafe("SELECT set_config('app.user_id','engineer-test',false)");
    await assert.rejects(repository.assertOfficialExecution({ ...fence, leaseToken: 'stale-token' }), /LEASE_FENCE_REJECTED/);
    await sql`INSERT INTO dm_document_parse_run (parse_run_id,document_version_id,tenant_id,actor_user_id,request_id,
      parse_revision,expected_published_revision,status,bucket_id,source_binding,manifest_artifact,deadline_at,completed_at)
      VALUES ('parse-document-test-2','dv-test','tenant-test','engineer-test','request-doc-2',2,1,'PUBLISHED','test',
        ${JSON.stringify(binding)}::jsonb,${JSON.stringify({ ...manifest, sha256: 'f'.repeat(64) })}::jsonb,now()+interval '1 hour',now())`;
    await assert.rejects(repository.assertOfficialExecution(fence), /WORKSPACE_SOURCE_CHANGED/);
    assert.equal((await repository.readSnapshot(fence)).revisions.length, 2, 'historical original translation remains readable');
    await sql`UPDATE action_attempt SET cancel_requested_at=now() WHERE attempt_id=${active.task.actionAttemptId}`;
    await assert.rejects(service.executeStep({ fence, requestId: 'cancelled', assertAuthorized: async () => {} }), /LEASE_FENCE_REJECTED/u);
    assert.equal(calls.length, 2);
    await sql`UPDATE action_attempt SET status='CANCELLED' WHERE attempt_id=${active.task.actionAttemptId}`;
    const nextPlan = structuredClone(plan);
    nextPlan.source.packageId = 'parse-document-test-2';
    nextPlan.source.parsedArtifact.ref = 'document-original://dv-test/parse-document-test-2';
    nextPlan.source.parsedArtifact.sha256 = 'f'.repeat(64);
    nextPlan.source.originalBinding.parseRunId = 'parse-document-test-2';
    nextPlan.source.originalBinding.parseRevision = 2;
    const nextWorkspace = await repository.prepare({ ...scope, plan: nextPlan });
    const { inputHash: _oldHash, ...taskInput } = task;
    const nextTask = sealDocumentTranslationTaskEnvelope({ ...taskInput, actionAttemptId: 'ATT-document-2', operationRef: 'AQ-document-2',
      parseRunId: 'parse-document-test-2', parseRevision: 2, workspaceId: nextWorkspace.workspaceId,
      modelInput: { ...task.modelInput, workspaceId: nextWorkspace.workspaceId, source: nextWorkspace.plan.source },
      idempotencyKey: 'doc-translation-reuse' });
    const nextToken = randomUUID();
    await sql`INSERT INTO action_attempt (id,attempt_id,operation_ref,subject_kind,document_version_id,producer_run_id,action_type,
      status,actor_user_id,tenant_id,input_revision,task_envelope_json,task_input_hash,lease_owner,lease_token,lease_generation,lease_expires_at,deadline_at)
      VALUES (${randomUUID()},${nextTask.actionAttemptId},${nextTask.operationRef},'DOCUMENT_VERSION','dv-test','parse-document-test-2','DOCUMENT_TRANSLATE',
        'RUNNING','engineer-test','tenant-test',2,${canonicalJson(nextTask)},${nextTask.inputHash},'service-principal',${nextToken},1,${deadline},${deadline})`;
    const nextFence = { ...fence, workspaceId: nextWorkspace.workspaceId, attemptRef: nextTask.operationRef, leaseToken: nextToken };
    const reused = await service.executeStep({ fence: nextFence, requestId: 'reuse-1', assertAuthorized: async () => {} });
    assert.equal(reused.reused, true);
    assert.equal(reused.blockIds.length, 2);
    const afterReuse = await repository.readSnapshot(nextFence);
    assert.equal(afterReuse.workspace.generationRequests.every(request => request.purpose === 'REUSE' && request.status === 'SAVED'), true);
    assert.equal(afterReuse.revisions.every(revision => revision.provenance.reusedFrom?.parseRunId === 'parse-document-test'), true);
    assert.deepEqual(afterReuse.revisions.map(revision => revision.candidate.elements.map(element => element.translatedText)),
      snapshot.revisions.map(revision => revision.candidate.elements.map(element => element.translatedText)));
    const assembledReuse = await service.executeStep({ fence: nextFence, requestId: 'reuse-2', assertAuthorized: async () => {} });
    assert.equal(assembledReuse.status, 'DONE');
    assert.equal(calls.length, 2, 'same content and context must not generate new translation');
    assert.equal((await repository.readSnapshot(nextFence)).revisions.length, 2, 'reentry does not copy twice');

  } finally { await sql.end({ timeout: 5 }); }
});


test('unknown plugin outcome keeps the same request pending and prevents blind regeneration', { skip: !databaseUrl, concurrency: false }, async () => {
  const url = new URL(databaseUrl); assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/wiselink_translation_v2_test_[a-z0-9_]+$/u);
  const sql = postgres(databaseUrl, { max: 1, onnotice() {} });
  try {
    await reset(sql);
    const repository = new CanonicalTranslationWorkspaceRepository(drizzle(sql)), plan = fixturePlan();
    await sql`INSERT INTO work_item VALUES ('WI-test','tenant-test','dv-test','pkg-test',${plan.source.parsedArtifact.ref},${plan.source.parsedArtifact.sha256},'engineer-test',1)`;
    const workspace = await repository.prepare({ tenantId: 'tenant-test', workItemId: 'WI-test', plan });
    const active = await seedAttempt(sql, workspace, 'unknown', 'miaoda/minimax-m3', { documentProducer: 'OFFICIAL_PLUGIN' });
    const fence = { tenantId: 'tenant-test', workItemId: 'WI-test', workspaceId: workspace.workspaceId,
      attemptRef: active.task.operationRef, principalId: 'service-principal', leaseToken: active.leaseToken, leaseGeneration: 1 };
    let calls = 0;
    const { CanonicalTranslationV2PluginService } = require('../../server/modules/canonical-host/canonical-translation-v2-plugin.service.ts');
    const service = new CanonicalTranslationV2PluginService(repository, {
      async translateProse() { calls++;
        if (calls === 1) return { translation: '构造测试说明', producer: { kind: 'OFFICIAL_PLUGIN', instanceId: 'wl-document-translate', pluginVersion: '1.0.11', actionKey: 'translate', concreteModel: null } };
        throw new Error('UPSTREAM_TIMEOUT'); },
    }, null);
    await service.executeStep({ fence, requestId: 'prefix', assertAuthorized: async () => {} });
    await assert.rejects(service.executeStep({ fence, requestId: 'unknown-1', assertAuthorized: async () => {} }), /UPSTREAM_TIMEOUT/);
    const state = await repository.readSnapshot(fence);
    assert.equal(state.workspace.generationRequests[0].status, 'REGISTERED');
    assert.equal(state.workspace.generationRequests[0].error.outcome, 'GENERATION_UNKNOWN');
    const retry = await service.executeStep({ fence, requestId: 'unknown-2', assertAuthorized: async () => {} });
    assert.equal(retry.status, 'NEEDS_RECOVERY'); assert.equal(calls, 2);
    assert.equal((await repository.readSnapshot(fence)).revisions.length, 1);
    const reading = buildTranslationWorkspaceReadingV2(state.workspace, state.revisions);
    assert.equal(reading.blocks[0].readingStatus, 'READABLE');
    assert.equal(reading.blocks[0].selected.candidate.elements[0].translatedText, '构造测试说明');
  } finally { await sql.end({ timeout: 5 }); }
});


test('semantic object-value correction preserves the previous candidate and fixes only its block', { skip: !databaseUrl, concurrency: false }, async () => {
  const url = new URL(databaseUrl); assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/wiselink_translation_v2_test_[a-z0-9_]+$/u);
  const sql = postgres(databaseUrl, { max: 1, onnotice() {} });
  try {
    await reset(sql);
    const source = fixtureSource();
    source.units[1].payload.text = 'Valve A opens at 10 kPa and valve B opens at 20 kPa.';
    const plan = buildTranslationSourcePlan({ ...fixturePlan().source, title: 'Synthetic correction', source });
    const repository = new CanonicalTranslationWorkspaceRepository(drizzle(sql));
    await sql`INSERT INTO work_item VALUES ('WI-test','tenant-test','dv-test','pkg-test',${plan.source.parsedArtifact.ref},${plan.source.parsedArtifact.sha256},'engineer-test',1)`;
    const workspace = await repository.prepare({ tenantId: 'tenant-test', workItemId: 'WI-test', plan });
    const active = await seedAttempt(sql, workspace, 'semantic-correction', 'miaoda/minimax-m3', { documentProducer: 'OFFICIAL_PLUGIN' });
    const fence = { tenantId: 'tenant-test', workItemId: 'WI-test', workspaceId: workspace.workspaceId,
      attemptRef: active.task.operationRef, principalId: 'service-principal', leaseToken: active.leaseToken, leaseGeneration: 1 };
    const producer = check => ({ kind: 'OFFICIAL_PLUGIN', instanceId: check ? 'wl-document-translation-check' : 'wl-document-translate',
      pluginVersion: check ? '1.0.26' : '1.0.11', actionKey: check ? 'textToJson' : 'translate', concreteModel: null });
    const wrong = '阀门 A 在 20 kPa 时开启，阀门 B 在 10 kPa 时开启。';
    const corrected = '阀门 A 在 10 kPa 时开启，阀门 B 在 20 kPa 时开启。';
    let headingCalls = 0, correctionCalls = 0, sawBlocked = false;
    const plugins = {
      async translateProse(text, assertActive, context) {
        await assertActive();
        if (!text.includes('Valve')) { headingCalls++; return { translation: '构造测试说明', producer: producer(false) }; }
        if (context.correctionIssues.length) {
          correctionCalls++;
          assert.equal(context.previousCandidate.elements[0].translatedText, wrong);
          assert.equal(context.correctionIssues.some(issue => issue.code.includes('VALUE_OBJECT_BINDING')), true);
          return { translation: corrected, producer: producer(false) };
        }
        return { translation: wrong, producer: producer(false) };
      },
      async checkTranslation(input, assertActive) {
        await assertActive();
        const issues = input.candidate.elements[0].translatedText === wrong
          ? [{ code: 'VALUE_OBJECT_BINDING', severity: 'BLOCK', message: 'The numeric values are assigned to the wrong valves.', anchorIds: input.anchors.map(anchor => anchor.anchorId) }]
          : [];
        return { review: { blockId: input.blockId, issues }, producer: producer(true) };
      },
    };
    const artifacts = { async persistAndReadback(bytes) { return { bytes, artifact: { storeRole: 'UnifiedArtifactStoreCandidate',
      ref: 'artifact://synthetic/corrected', sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, mediaType: 'application/json' } }; } };
    const v2 = new CanonicalTranslationV2Service(repository, {}, {}, artifacts, {});
    const { CanonicalTranslationV2PluginService } = require('../../server/modules/canonical-host/canonical-translation-v2-plugin.service.ts');
    const service = new CanonicalTranslationV2PluginService(repository, plugins, v2);
    let outcome;
    for (let step = 0; step < 10; step++) {
      outcome = await service.executeStep({ fence, requestId: `correct-${step}`, assertAuthorized: async () => {} });
      const snapshot = await repository.readSnapshot(fence);
      if (snapshot.revisions.some(revision => revision.check?.issues.some(issue => issue.code.includes('VALUE_OBJECT_BINDING')))) sawBlocked = true;
      if (outcome.status === 'DONE') break;
    }
    assert.equal(outcome.status, 'DONE'); assert.equal(sawBlocked, true); assert.equal(correctionCalls, 1); assert.equal(headingCalls, 1);
    const snapshot = await repository.readSnapshot(fence), body = snapshot.revisions.filter(revision => revision.blockId === plan.blocks[1].blockId);
    assert.equal(body.length, 2);
    assert.equal(body.find(revision => !revision.selectedForReading).candidate.elements[0].translatedText, wrong);
    assert.equal(body.find(revision => revision.selectedForReading).candidate.elements[0].translatedText, corrected);
  } finally { await sql.end({ timeout: 5 }); }
});

// Constructed replay of the actual rev6 pattern: partial multi-block GENERATE, lease advance, then CHECK.
test('saved block remains checkable after its partial generation is superseded by a new lease', { skip: !databaseUrl, concurrency: false }, async () => {
  const url = new URL(databaseUrl); assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/wiselink_translation_v2_test_[a-z0-9_]+$/u);
  const sql = postgres(databaseUrl, { max: 1, onnotice() {} });
  try {
    await reset(sql);
    const repository = new CanonicalTranslationWorkspaceRepository(drizzle(sql)), plan = fixturePlan();
    await sql`INSERT INTO work_item VALUES ('WI-test','tenant-test','dv-test','pkg-test',${plan.source.parsedArtifact.ref},${plan.source.parsedArtifact.sha256},'engineer-test',1)`;
    const workspace = await repository.prepare({ tenantId: 'tenant-test', workItemId: 'WI-test', plan });
    const active = await seedAttempt(sql, workspace, 'saved-old-generation', 'miaoda/minimax-m3', { documentProducer: 'OFFICIAL_PLUGIN' });
    const oldFence = { tenantId: 'tenant-test', workItemId: 'WI-test', workspaceId: workspace.workspaceId,
      attemptRef: active.task.operationRef, principalId: 'service-principal', leaseToken: active.leaseToken, leaseGeneration: 1 };
    await repository.attachAttempt(oldFence);
    const request = await repository.registerGeneration({ ...oldFence, clientRequestId: 'partial', blockIds: ['b1', 'b2'],
      purpose: 'GENERATE', targetBlockRevisionId: null, dependencies: translationBatchDependenciesV2(workspace, ['b1', 'b2']) });
    const producer = { kind: 'OFFICIAL_PLUGIN', instanceId: 'wl-document-translate', pluginVersion: '1.0.11', actionKey: 'translate', concreteModel: null };
    const execution = { producer, promptVersion: 'wiselink-document-translation@1', providerRequestId: null, generatedAt: null, usage: { inputTokens: null, outputTokens: null } };
    const candidate = { blockId: 'b2', elements: [{ elementId: 'e1', kind: 'paragraph', translatedText: '除非指示在 5 秒后仍然存在，否则不得更换组件。', anchorIds: ['a2'] }] };
    const [saved] = await repository.saveCandidates({ ...oldFence, generationRequestRef: request.generationRequestRef, candidates: [candidate], actualExecution: execution });
    await repository.checkAndSelect({ ...oldFence, blockRevisionId: saved.blockRevisionId, expectedRowVersion: saved.rowVersion,
      check: checkTranslationBlockV2({ plan, candidate }) });
    const newToken = randomUUID();
    await sql`UPDATE action_attempt SET lease_generation=2, lease_token=${newToken} WHERE attempt_id=${active.task.actionAttemptId}`;
    const fence = { ...oldFence, leaseToken: newToken, leaseGeneration: 2 };
    await repository.attachAttempt(fence);
    assert.equal((await repository.readSnapshot(fence)).workspace.generationRequests[0].status, 'SUPERSEDED');
    let checks = 0;
    const { CanonicalTranslationV2PluginService } = require('../../server/modules/canonical-host/canonical-translation-v2-plugin.service.ts');
    const service = new CanonicalTranslationV2PluginService(repository, {
      async checkTranslation(input, assertActive) { await assertActive(); checks++;
        return { review: { blockId: input.blockId, issues: [] }, producer: { ...producer, instanceId: 'wl-document-translation-check', pluginVersion: '1.0.26', actionKey: 'textToJson' } }; },
      async translateProse() { throw new Error('SAVED_BLOCK_MUST_NOT_BE_REGENERATED'); },
    }, null);
    const result = await service.executeStep({ fence, requestId: 'new-lease-check', assertAuthorized: async () => {} });
    assert.equal(result.status, 'PROGRESSED'); assert.equal(checks, 1);
    const state = await repository.readSnapshot(fence);
    assert.equal(state.revisions.length, 1); assert.equal(state.revisions[0].selectedForReading, true);
    assert.deepEqual(state.revisions[0].candidate, saved.candidate);
    assert.equal(state.workspace.generationRequests[0].status, 'SUPERSEDED', 'old request is not revived');
    await assert.rejects(repository.assertOfficialExecution(oldFence), /LEASE_FENCE_REJECTED/);
    await assert.rejects(repository.saveCandidates({ ...fence, generationRequestRef: request.generationRequestRef, candidates: [candidate], actualExecution: execution }), /GENERATION/);
  } finally { await sql.end({ timeout: 5 }); }
});
