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
const { eq } = require('drizzle-orm');
const { getTableConfig } = require('drizzle-orm/pg-core');
const { actionAttempt } = require('../../server/database/schema.ts');
const { sealTaskEnvelope, canonicalJson } = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const { CanonicalTranslationWorkspaceRepository } = require('../../server/modules/canonical-host/canonical-translation-workspace.repository.ts');
const { ActionAttemptRepository } = require('../../server/modules/action-attempt/action-attempt.repository.ts');
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
  } finally { await sql.end({ timeout: 5 }); }
});

async function reset(sql) {
  await sql.unsafe(`DROP TABLE IF EXISTS translation_knowledge_governance_event, translation_knowledge_import_request_item, translation_knowledge_source_ref,
    translation_knowledge_candidate, translation_block_revision, translation_workspace, action_attempt, work_item, identity_subject_mapping CASCADE;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='user_profile') THEN CREATE TYPE user_profile AS (user_id text); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
    CREATE TABLE work_item (work_item_id varchar(96) UNIQUE NOT NULL, tenant_id varchar(128) NOT NULL, document_version_id varchar(96), package_id text,
      package_artifact_ref text, package_artifact_sha256 varchar(64), requested_by_user_id varchar(255), revision integer, UNIQUE(tenant_id,work_item_id));
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
  await sql.unsafe('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role, authenticated');
}
function fixturePlan() {
  const texts = ['Synthetic test description', 'Do not replace the unit unless the indication remains after 5 seconds.'];
  return buildTranslationSourcePlan({ documentVersionId: 'dv-test', packageId: 'pkg-test', title: 'Synthetic only',
    parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'artifact://synthetic/source', sha256: '1'.repeat(64), byteLength: 1, mediaType: 'application/json' },
    source: { modules: [{ moduleId: 'm', order: 0 }], findings: [], references: [],
      sourceLocators: texts.map((_text, i) => ({ sourceRefId: `sr${i}`, kind: 'pdf_page', artifactId: 'source', pageStart: i + 1, pageEnd: i + 1, charStart: null, charEnd: null, charOffsetUnit: null, normalizedPath: null, xpath: null, elementId: null, quote: null, bbox: null })),
      units: texts.map((text, i) => ({ unitId: `u${i}`, kind: i === 0 ? 'heading' : 'paragraph', moduleId: 'm', parentUnitId: i === 0 ? null : 'u0', order: i, depth: i,
        continuityKey: `u${i}`, sourceRefIds: [`sr${i}`], sourceSegmentIds: [`seg${i}`], mapping: { status: 'mapped_exactly', confidence: 'deterministic', findingIds: [] },
        payload: i === 0 ? { text, level: 1 } : { text, role: 'body' } })),
    } });
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
