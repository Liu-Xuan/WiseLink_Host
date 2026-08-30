import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import postgres from 'postgres';

const require = createRequire(import.meta.url);
const { drizzle } = require('drizzle-orm/postgres-js');
const {
  sealResultEnvelope,
} = require('../../dist/server/modules/action-attempt/action-attempt-envelope.js');
const {
  ActionAttemptLifecycleService,
} = require('../../dist/server/modules/action-attempt/action-attempt-lifecycle.service.js');
const {
  ActionAttemptRepository,
} = require('../../dist/server/modules/action-attempt/action-attempt.repository.js');
const {
  buildSbJobAidAssessmentPackage,
} = require('../../dist/server/modules/assessment-workbench/job-aid-runtime/assessmentPackage.js');
const {
  buildJobAidCriterionSetVersion,
  hashExecutableCriterionList,
} = require('../../dist/server/modules/assessment-workbench/job-aid-runtime/criterionSet.js');
const {
  buildUnifiedSbJobAidAssessmentInput,
} = require('../../dist/server/modules/assessment-workbench/unified-assessment-input.js');
const {
  CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY,
} = require('../../dist/server/modules/canonical-host/canonical-host-openclaw-runtime-policy.js');
const {
  CanonicalHostOpenClawDynamicEvaluationService,
} = require('../../dist/server/modules/canonical-host/canonical-host-openclaw-dynamic-evaluation.service.js');
const {
  CanonicalHostAssessmentService,
} = require('../../dist/server/modules/canonical-host/canonical-host-assessment.service.js');
const {
  CanonicalRuleSetLifecycleRepository,
} = require('../../dist/server/modules/canonical-host/canonical-rule-set-lifecycle.repository.js');
const {
  CanonicalRuleSetLifecycleService,
} = require('../../dist/server/modules/canonical-host/canonical-rule-set-lifecycle.service.js');
const {
  MiaodaWorkItemRepository,
} = require('../../dist/server/modules/work-item/miaoda-work-item.repository.js');

const databaseUrl = process.env.CANONICAL_RULE_SET_TEST_DATABASE_URL;
const root = process.cwd();
const tenantId = 'tenant-rule-set-pg';
const otherTenantId = 'tenant-rule-set-pg-other';
const roleId = 'role_rule_set_engineering_owner_pg';
const ownerUserId = 'owner-rule-set-pg';
const otherOwnerUserId = 'owner-rule-set-pg-other';

test(
  'real PostgreSQL bootstrap and dynamic recovery stay bound to immutable 150-rule snapshots',
  { skip: !databaseUrl, concurrency: false },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    // 0013 is an executable transaction artifact; one reserved connection is
    // required when applying its BEGIN/COMMIT text verbatim.
    const sql = postgres(databaseUrl, { max: 1 });
    let ownerDirectory;
    try {
      await resetDatabase(sql);
      const workItem = workItemProjection();
      const otherWorkItem = {
        ...workItemProjection(),
        workItemId: 'WI-RULE-SET-PG-OTHER',
        requestId: 'REQ-RULE-SET-PG-OTHER',
      };
      await seedWorkItem(sql, workItem, tenantId);
      await seedWorkItem(sql, otherWorkItem, otherTenantId);
      const harness = createHarness(sql, workItem);
      const otherRuleSets = new CanonicalRuleSetLifecycleService(
        harness.repository,
        {},
      );
      const synchronousAssessment = createSynchronousAssessmentService(
        sql,
        otherWorkItem,
        otherRuleSets,
      );

      await assert.rejects(
        harness.dynamic.begin(workItem.workItemId),
        /RULE_SET_ACTIVE_SNAPSHOT_REQUIRED/,
      );
      await assert.rejects(
        synchronousAssessment.evaluateCandidate(
          {
            workItemId: otherWorkItem.workItemId,
            assessmentAsOf: '2026-08-30T00:00:00.000Z',
            generatedAt: '2026-08-30T00:00:00.000Z',
          },
          serviceActor(otherTenantId, otherOwnerUserId),
        ),
        /RULE_SET_ACTIVE_SNAPSHOT_REQUIRED/,
      );
      assert.equal(await attemptCount(sql), 0);

      ownerDirectory = await mkdtemp(join(tmpdir(), 'wiselink-rule-owner-'));
      const ownerMapPath = join(ownerDirectory, 'owners.json');
      await writeFile(
        ownerMapPath,
        JSON.stringify({
          schemaVersion: 'wiselink.3_1.rule_set_bootstrap_owner_map.v1',
          tenants: {
            [tenantId]: { engineeringOwnerUserId: ownerUserId },
            [otherTenantId]: {
              engineeringOwnerUserId: otherOwnerUserId,
            },
          },
        }),
      );
      const missingRole = runBootstrapProcess(ownerMapPath, null);
      assert.notEqual(missingRole.status, 0);
      assert.match(
        missingRole.stderr,
        /WL_CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ID is required/,
      );
      assert.equal(
        Number(
          (
            await sql`SELECT count(*)::int AS count FROM canonical_rule_set_snapshot`
          )[0].count,
        ),
        0,
      );
      const firstBootstrap = runBootstrap(ownerMapPath);
      assert.equal(firstBootstrap.status, 'applied');
      assert.equal(firstBootstrap.tenantCount, 2);
      assert.deepEqual(
        firstBootstrap.activeHeads.map((head) => head.tenantId).sort(),
        [otherTenantId, tenantId].sort(),
      );
      const replay = runBootstrap(ownerMapPath);
      assert.equal(replay.status, 'idempotent_replay');
      assert.equal(
        Number(
          (
            await sql`SELECT count(*)::int AS count FROM canonical_rule_set_activation`
          )[0].count,
        ),
        2,
      );

      const synchronousRepository = new MiaodaWorkItemRepository(drizzle(sql));
      const synchronousRetry =
        await synchronousRepository.reserveAssessmentAction({
          workItemId: otherWorkItem.workItemId,
          actionType: 'EVALUATE_JOB_AID',
          triggerRequestId: otherWorkItem.requestId,
          requestOrigin: 'MIAODA',
          actorUserId: otherOwnerUserId,
          tenantId: otherTenantId,
          attemptNo: 1,
        });
      assert.equal(synchronousRetry.created, true);
      await synchronousRepository.completeAssessmentAction(
        synchronousRetry.attemptId,
      );

      const activeA = await harness.ruleSets.readActiveRuntime(tenantId);
      assert.equal(activeA.snapshotId, 'JACS-72D0484B6F1C17A38F671F46');
      assertActual150RuleEvaluation(activeA);
      assert.equal(
        (await harness.ruleSets.readActiveRuntime(otherTenantId)).snapshotId,
        activeA.snapshotId,
      );

      const runningA = await harness.dynamic.begin(workItem.workItemId);
      assert.equal(runningA.status, 'RUNNING');
      assert.equal(
        runningA.modelInput.ruleSetBinding.snapshotId,
        activeA.snapshotId,
      );
      assert.equal(runningA.modelInput.ruleSetBinding.criteriaCount, 150);

      const snapshotB = await createReplacementSnapshot(
        harness.repository,
        'replacement-b',
      );
      const snapshotC = await createReplacementSnapshot(
        harness.repository,
        'replacement-c',
      );
      assert.equal(
        await harness.repository.getSnapshot(
          otherTenantId,
          snapshotB.criterionSetId,
        ),
        null,
      );
      const promotions = await Promise.allSettled([
        harness.repository.appendActivation({
          tenantId,
          targetCriterionSetId: snapshotB.criterionSetId,
          expectedRevision: 1,
          action: 'PROMOTE',
          engineeringOwnerUserId: ownerUserId,
          requiredRoleId: roleId,
          reason: 'Concurrent real PostgreSQL replacement B.',
        }),
        harness.repository.appendActivation({
          tenantId,
          targetCriterionSetId: snapshotC.criterionSetId,
          expectedRevision: 1,
          action: 'PROMOTE',
          engineeringOwnerUserId: ownerUserId,
          requiredRoleId: roleId,
          reason: 'Concurrent real PostgreSQL replacement C.',
        }),
      ]);
      const fulfilledPromotions = promotions.filter(
        (result) => result.status === 'fulfilled',
      );
      const rejectedPromotions = promotions.filter(
        (result) => result.status === 'rejected',
      );
      assert.equal(fulfilledPromotions.length, 1);
      assert.equal(rejectedPromotions.length, 1);
      assert.match(
        String(rejectedPromotions[0].reason?.code),
        /RULE_SET_CURRENT_CAS_CONFLICT/,
      );
      const activeB = await harness.ruleSets.readActiveRuntime(tenantId);
      assert.ok(
        [snapshotB.criterionSetId, snapshotC.criterionSetId].includes(
          activeB.snapshotId,
        ),
      );
      assertActual150RuleEvaluation(activeB);

      const currentReaderAfterPromote = harness.ruleSets.readActiveRuntime.bind(
        harness.ruleSets,
      );
      harness.ruleSets.readActiveRuntime = async () => {
        throw new Error('CURRENT_RULE_SET_READ_DURING_RUNNING_RECOVERY');
      };
      const runningRecovery = await harness.dynamic.begin(
        runningA.task.workItemId,
      );
      harness.ruleSets.readActiveRuntime = currentReaderAfterPromote;
      assert.equal(runningRecovery.status, 'RUNNING');
      assert.equal(
        runningRecovery.modelInput.ruleSetBinding.snapshotId,
        activeA.snapshotId,
      );

      const committedA = await harness.dynamic.commit(
        runningA.attemptRef,
        runningRecovery.leaseToken,
        runningRecovery.leaseGeneration,
        resultFor(runningRecovery),
      );
      assert.equal(committedA.baseRules.criterionSetId, activeA.snapshotId);
      assert.equal(harness.usedSnapshots.at(-1), activeA.snapshotId);

      const currentWorkItem =
        await harness.registrar.getTenantScopedByWorkItemId({
          tenantId,
          workItemId: workItem.workItemId,
        });
      const committingB = await harness.dynamic.begin(
        currentWorkItem.workItemId,
      );
      assert.equal(
        committingB.modelInput.ruleSetBinding.snapshotId,
        activeB.snapshotId,
      );
      let interrupted = false;
      const actualPrepare = harness.attempts.prepareCommit.bind(
        harness.attempts,
      );
      harness.attempts.prepareCommit = async (input) => {
        const prepared = await actualPrepare(input);
        if (!interrupted && prepared.row.status === 'COMMITTING') {
          interrupted = true;
          await harness.repository.appendActivation({
            tenantId,
            targetCriterionSetId: activeA.snapshotId,
            expectedRevision: 2,
            action: 'ROLLBACK',
            engineeringOwnerUserId: ownerUserId,
            requiredRoleId: roleId,
            reason: 'Real PostgreSQL COMMITTING recovery rollback.',
          });
          throw new Error('SIMULATED_PROCESS_EXIT_AFTER_COMMITTING');
        }
        return prepared;
      };
      const committingResult = resultFor(committingB);
      await assert.rejects(
        harness.dynamic.commit(
          committingB.attemptRef,
          committingB.leaseToken,
          committingB.leaseGeneration,
          committingResult,
        ),
        /SIMULATED_PROCESS_EXIT_AFTER_COMMITTING/,
      );
      assert.equal(
        await attemptStatus(sql, committingB.attemptRef),
        'COMMITTING',
      );
      assert.equal(
        (await harness.ruleSets.readActiveRuntime(tenantId)).snapshotId,
        activeA.snapshotId,
      );

      const actualReadActiveRuntime = harness.ruleSets.readActiveRuntime.bind(
        harness.ruleSets,
      );
      harness.ruleSets.readActiveRuntime = async () => {
        throw new Error('CURRENT_RULE_SET_READ_DURING_RECOVERY');
      };
      const committingRecovery = await harness.dynamic.begin(
        committingB.task.workItemId,
      );
      harness.ruleSets.readActiveRuntime = actualReadActiveRuntime;
      assert.equal(committingRecovery.status, 'COMMITTING');
      assert.equal(
        committingRecovery.modelInput.ruleSetBinding.snapshotId,
        activeB.snapshotId,
      );

      const recoveredB = await harness.dynamic.commit(
        committingB.attemptRef,
        committingRecovery.leaseToken,
        committingRecovery.leaseGeneration,
        committingResult,
      );
      assert.equal(recoveredB.baseRules.criterionSetId, activeB.snapshotId);
      assert.equal(harness.usedSnapshots.at(-1), activeB.snapshotId);
      assert.equal(
        await attemptStatus(sql, committingB.attemptRef),
        'SUCCEEDED',
      );

      const postRollback = await harness.dynamic.begin(workItem.workItemId);
      assert.equal(
        postRollback.modelInput.ruleSetBinding.snapshotId,
        activeA.snapshotId,
      );
      const committedPostRollback = await harness.dynamic.commit(
        postRollback.attemptRef,
        postRollback.leaseToken,
        postRollback.leaseGeneration,
        resultFor(postRollback),
      );
      assert.equal(
        committedPostRollback.baseRules.criterionSetId,
        activeA.snapshotId,
      );
    } finally {
      await sql.end({ timeout: 5 });
      if (ownerDirectory) await rm(ownerDirectory, { recursive: true });
    }
  },
);

function createHarness(sql, initialWorkItem) {
  const db = drizzle(sql);
  const repository = new CanonicalRuleSetLifecycleRepository(db);
  const ruleSets = new CanonicalRuleSetLifecycleService(repository, {});
  const attempts = new ActionAttemptLifecycleService(
    new ActionAttemptRepository(db),
  );
  const registrar = sqlRegistrar(sql);
  const usedSnapshots = [];
  const assessment = {
    async prepareDynamicRulesCandidateWithRuleSet(_input, runtime) {
      usedSnapshots.push(runtime.snapshotId);
      return {
        dynamicRulesInput: {
          criterionSetId: runtime.criterionSet.criterionSetId,
          criterionIds: runtime.rulePack.criteria.map(
            (criterion) => criterion.criterion_id,
          ),
        },
        overall: { transport: {} },
      };
    },
  };
  const processor = {
    buildRequest(dynamicRulesInput) {
      return {
        privateEnvelope: {
          callerCorrelationRef: initialWorkItem.requestId,
          correlation: {},
        },
        modelInput: {
          purpose: 'EVALUATE_DYNAMIC_RULES',
          expectedSelfCheck: {
            criterionSetId: dynamicRulesInput.criterionSetId,
            criterionCount: dynamicRulesInput.criterionIds.length,
          },
          criterionIds: [...dynamicRulesInput.criterionIds],
        },
      };
    },
    consumeOutput(request) {
      assert.equal(new Set(request.modelInput.criterionIds).size, 150);
      return {
        ruleResults: request.modelInput.criterionIds.map((ruleId) => ({
          ruleId,
          sourceRefs: [],
        })),
        overallSelfCheck: { rulesWithMissingInputs: 0 },
        criterionCount: 150,
      };
    },
  };
  const artifactStore = {
    async persistAndReadback(bytes) {
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      return {
        artifact: {
          storeRole: 'UnifiedArtifactStoreCandidate',
          ref: `test://dynamic/${sha256}`,
          sha256,
          byteLength: bytes.byteLength,
          mediaType: 'application/json',
        },
        actualBytes: Uint8Array.from(bytes),
        reused: false,
      };
    },
  };
  const scope = {
    async authorizeOpenClawWorkItem({ workItemId }) {
      return serviceScope(workItemId);
    },
    async authorizeOpenClawAttempt({ attemptRef }) {
      const [row] = await sql`
        SELECT work_item_id AS "workItemId"
        FROM action_attempt WHERE operation_ref = ${attemptRef}
      `;
      assert.ok(row);
      return { ...serviceScope(row.workItemId), attemptRef };
    },
  };
  const dynamic = new CanonicalHostOpenClawDynamicEvaluationService(
    registrar,
    artifactStore,
    assessment,
    processor,
    { assertLedgerCompatibleWithDynamicBytes: async () => {} },
    attempts,
    ruleSets,
    scope,
  );
  return {
    dynamic,
    attempts,
    registrar,
    repository,
    ruleSets,
    usedSnapshots,
  };
}

function createSynchronousAssessmentService(sql, initialWorkItem, ruleSets) {
  const permissionSnapshotVersion = 'permission:rule-set-pg-sync-zero';
  const registrar = sqlRegistrar(sql);
  const authorization = {
    async authorize({ action, actor, workItemId }) {
      assert.equal(action, 'EVALUATE_JOB_AID');
      assert.equal(actor.tenantId, otherTenantId);
      assert.equal(workItemId, initialWorkItem.workItemId);
      return {
        action,
        allowed: true,
        actorFingerprint: 'actor:rule-set-pg-sync-zero',
        decisionId: 'decision:rule-set-pg-sync-zero',
        decisionHash: 'decision-hash:rule-set-pg-sync-zero',
        permissionSnapshotVersion,
      };
    },
  };
  const permissionSnapshots = {
    async freshRead({ decision }) {
      assert.equal(
        decision.permissionSnapshotVersion,
        permissionSnapshotVersion,
      );
      return { permissionSnapshotVersion };
    },
  };
  return new CanonicalHostAssessmentService(
    registrar,
    authorization,
    permissionSnapshots,
    {},
    {},
    new MiaodaWorkItemRepository(drizzle(sql)),
    {},
    ruleSets,
  );
}

function serviceScope(workItemId) {
  return {
    principalId: 'service:openclaw-rule-set-pg',
    appId: 'app_17bzc551rsg',
    tenantId,
    workItemId,
    authorizationFingerprint: 'scope:rule-set-pg',
  };
}

function serviceActor(targetTenantId, userId) {
  return {
    userId,
    tenantId: targetTenantId,
    appId: 'app_17bzc551rsg',
    roles: [],
    env: 'hosted',
  };
}

function sqlRegistrar(sql) {
  return {
    async getTenantScopedByWorkItemId(input) {
      const [row] = await sql`
        SELECT projection_json AS "projectionJson"
        FROM work_item
        WHERE work_item_id = ${input.workItemId}
          AND tenant_id = ${input.tenantId}
      `;
      assert.ok(row);
      return JSON.parse(row.projectionJson);
    },
    async compareAndSet(input) {
      const next = {
        ...structuredClone(input.next),
        revision: input.expectedRevision + 1,
      };
      const rows = await sql`
        UPDATE work_item SET revision = ${next.revision},
          projection_json = ${JSON.stringify(next)},
          updated_at = CURRENT_TIMESTAMP
        WHERE work_item_id = ${input.workItemId}
          AND revision = ${input.expectedRevision}
        RETURNING revision
      `;
      if (rows.length !== 1) throw new Error('WORK_ITEM_CAS_CONFLICT');
      return next;
    },
  };
}

function resultFor(begin) {
  return sealResultEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
    actionAttemptId: begin.task.actionAttemptId,
    operationRef: begin.task.operationRef,
    taskType: begin.task.taskType,
    workItemId: begin.task.workItemId,
    baseRevision: begin.task.baseRevision,
    status: 'SUCCEEDED',
    businessOutcome: 'CANDIDATE_READY',
    candidateStatus: null,
    modelOutput: JSON.stringify({ accepted: true }),
    outputArtifactRefs: [],
    sourceRefs: [...begin.task.sourceRefs],
    factsConsidered: [],
    missingInputs: [],
    conflicts: [],
    warnings: [],
    modelVersion: 'official-provider/rule-set-pg-test',
    promptVersion: 'dynamic-prompt-v1',
    skillVersion: CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY.skillVersion,
    toolVersions: {
      [CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY.mcpServerName]:
        CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY.mcpServerVersion,
    },
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
    errorCode: null,
    errorDetail: null,
  });
}

async function createReplacementSnapshot(repository, variant) {
  const rulePackJson = await readFile(
    resolve(
      root,
      'server/runtime-assets/assessment-host/job-aid/rule-pack-0.2.json',
    ),
    'utf8',
  );
  const rulePack = JSON.parse(rulePackJson);
  const artifactDigest = `sha256:${createHash('sha256')
    .update(rulePackJson)
    .digest('hex')}`;
  const canonicalCriteriaHash = hashExecutableCriterionList(rulePack.criteria);
  const criterionSet = buildJobAidCriterionSetVersion({
    rulePack,
    artifactRef: `test://rule-set/${variant}-v0.2`,
    artifactDigest,
    artifactVersion: `${variant}-v0.2`,
    canonicalCriteriaHash,
    sourceJobAidDocumentVersionStatus: 'VERSION_UNCONFIRMED',
    lifecycleStatus: 'ACTIVE',
  });
  await repository.createSnapshot({
    tenantId,
    criterionSetId: criterionSet.criterionSetId,
    criterionSetHash: criterionSet.criterionSetHash,
    memberIdentityHash: criterionSet.memberIdentityHash,
    criteriaCount: criterionSet.criteriaCount,
    rulePackVersion: '0.2',
    rulePackJson,
    artifactRef: criterionSet.ruleArtifact.artifactRef,
    artifactDigest: criterionSet.ruleArtifact.artifactDigest,
    artifactVersion: criterionSet.ruleArtifact.artifactVersion,
    canonicalCriteriaHash,
    sourceJobAidDocumentVersionId: null,
    sourceJobAidVersionStatus: 'VERSION_UNCONFIRMED',
    createdByEngineeringOwnerUserId: ownerUserId,
  });
  return criterionSet;
}

function assertActual150RuleEvaluation(runtime) {
  const fixtureDirectory = resolve(
    root,
    'server/runtime-assets/assessment-host/real-sb/737-34-3830-original-issue',
  );
  const artifactBytes = require('node:fs').readFileSync(
    resolve(fixtureDirectory, 'unified-package.frozen-2.json'),
  );
  const artifactRecord = JSON.parse(
    require('node:fs').readFileSync(
      resolve(fixtureDirectory, 'artifact-record.frozen-2.json'),
      'utf8',
    ),
  );
  const assessmentInput = buildUnifiedSbJobAidAssessmentInput({
    documentVersionBinding: {
      documentId: 'document_10085d27e5c05266403bb74c',
      documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
      artifactRecord,
      lifecycleStatus: 'FROZEN',
      selectionStatus: 'SELECTED',
      isCurrent: true,
      classification: {
        schemaVersion: 'wiselink.v3_1.document_classification_envelope.v1',
        classificationId: 'CLS-RULE-SET-PG',
        classificationHash: `sha256:${'a'.repeat(64)}`,
        status: 'CONFIRMED',
        normalizedFamily: 'SB',
        issuer: 'BOEING',
        subtype: 'service_bulletin',
        profileId:
          'document-family-profile:issuer.boeing.service_bulletin@1.0.0',
        nativeParseProfileId: 'boeing.sb',
      },
    },
    artifactBytes: new Uint8Array(artifactBytes),
    assessmentAsOf: '2026-08-30T00:00:00.000Z',
  });
  const result = buildSbJobAidAssessmentPackage({
    input: assessmentInput,
    rulePack: runtime.rulePack,
    rulePackHash: runtime.rulePackHash,
    criterionSet: runtime.criterionSet,
    generatedAt: '2026-08-30T00:00:00.000Z',
  });
  assert.equal(result.rulePackBinding.criterionSetId, runtime.snapshotId);
  assert.equal(result.evaluationItems.length, 150);
  assert.equal(
    new Set(result.evaluationItems.map((item) => item.criterion_id)).size,
    150,
  );
}

function runBootstrap(ownerMapPath) {
  const result = runBootstrapProcess(ownerMapPath, roleId);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runBootstrapProcess(ownerMapPath, configuredRoleId) {
  const environment = {
    ...process.env,
    CANONICAL_RULE_SET_BOOTSTRAP_DATABASE_URL: databaseUrl,
  };
  if (configuredRoleId) {
    environment.WL_CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ID =
      configuredRoleId;
  } else {
    delete environment.WL_CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ID;
  }
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'scripts/bootstrap-canonical-rule-set-v0-2.mjs'),
      '--owner-map',
      ownerMapPath,
      '--apply',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: environment,
    },
  );
  return result;
}

async function attemptCount(sql) {
  const [row] = await sql`SELECT count(*)::int AS count FROM action_attempt`;
  return Number(row.count);
}

async function attemptStatus(sql, attemptRef) {
  const [row] = await sql`
    SELECT status FROM action_attempt WHERE operation_ref = ${attemptRef}
  `;
  return row?.status ?? null;
}

async function seedWorkItem(sql, workItem, targetTenantId) {
  await sql`
    INSERT INTO work_item(
      work_item_id, tenant_id, action_type, document_id, document_version_id,
      source_artifact_id, source_file_sha256, source_byte_length,
      normalized_family, request_id, status, revision, projection_json,
      package_id, package_artifact_ref, package_artifact_sha256,
      requested_by_user_id, run_key
    ) VALUES (
      ${workItem.workItemId}, ${targetTenantId}, 'PARSE_PDF',
      ${workItem.source.documentId}, ${workItem.source.documentVersionId},
      ${workItem.source.sourceArtifactId}, ${workItem.source.sourceFileSha256},
      ${workItem.source.sourceByteLength}, 'SB', ${workItem.requestId},
      ${workItem.phase}, ${workItem.revision}, ${JSON.stringify(workItem)},
      ${workItem.package.packageId}, ${workItem.package.artifact.ref},
      ${workItem.package.artifact.sha256}, 'requester-rule-set-pg', 'canonical'
    )
  `;
}

function workItemProjection() {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-RULE-SET-PG',
    requestId: 'REQ-RULE-SET-PG',
    revision: 5,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-rule-set-pg',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor-rule-set-pg',
      decisionId: 'decision-rule-set-pg',
      decisionHash: 'decision-hash-rule-set-pg',
      permissionSnapshotVersion: 'permission-rule-set-pg',
    },
    source: {
      documentId: 'DOC-RULE-SET-PG',
      documentVersionId: 'DV-RULE-SET-PG',
      parserRequestId: 'PARSER-RULE-SET-PG',
      sourceArtifactId: 'SOURCE-RULE-SET-PG',
      sourceFileSha256: 'b'.repeat(64),
      sourceByteLength: 100,
      driveFileToken: 'drive-rule-set-pg',
      driveSourceVersion: '1',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      classifierReleaseId: 'classifier-rule-set-pg',
      classifierReleaseHash: 'classifier-hash-rule-set-pg',
      parserProfileId: 'issuer.boeing',
      parserProfileHash: 'profile-hash-rule-set-pg',
      fingerprint: 'fingerprint-rule-set-pg',
    },
    package: {
      packageId: 'PKG-RULE-SET-PG',
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: 'test://package/rule-set-pg',
        sha256: 'c'.repeat(64),
        byteLength: 100,
        mediaType: 'application/json',
      },
      contentHash: 'd'.repeat(64),
      semanticHash: 'e'.repeat(64),
      provenanceHash: 'f'.repeat(64),
      coverageHash: '1'.repeat(64),
      resultStatus: 'complete',
      title: 'RuleSet PostgreSQL test',
      contentUnitCount: 2,
      sourceRefCount: 2,
      readerReceiptId: 'reader-rule-set-pg',
      fullValidatorProof: {
        validatorId: 'U0Frozen2SchemaSemanticValidator',
        validatorRevision: 'v1',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        artifactSha256: '2'.repeat(64),
      },
    },
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  };
}

function assertSafeIsolatedDatabase(value) {
  const parsed = new URL(value);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/wiselink_rule_set_lifecycle_test');
}

async function resetDatabase(sql) {
  await sql.unsafe('DROP SCHEMA public CASCADE');
  await sql.unsafe('CREATE SCHEMA public');
  await sql.unsafe(`DO $$ BEGIN
    CREATE ROLE service_role;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;`);
  await sql.unsafe('CREATE TYPE user_profile AS (user_id text)');
  await sql.unsafe(`
    CREATE TABLE identity_subject_mapping (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      miaoda_tenant_id varchar(128) NOT NULL,
      status varchar(32) NOT NULL DEFAULT 'ACTIVE'
    )
  `);
  await sql.unsafe(`
    CREATE TABLE work_item (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      work_item_id varchar(96) NOT NULL UNIQUE,
      tenant_id varchar(128) NOT NULL,
      action_type varchar(64) NOT NULL,
      document_id varchar(96) NOT NULL,
      document_version_id varchar(96) NOT NULL,
      source_artifact_id varchar(96) NOT NULL,
      source_file_sha256 varchar(64) NOT NULL,
      source_byte_length bigint NOT NULL,
      normalized_family varchar(64) NOT NULL,
      request_id varchar(96) NOT NULL,
      status varchar(64) NOT NULL DEFAULT 'reserved',
      revision integer NOT NULL DEFAULT 0,
      projection_json text,
      package_id text,
      package_artifact_ref text,
      package_artifact_sha256 varchar(64),
      failure_code varchar(160),
      failure_artifact_ref text,
      failure_artifact_sha256 varchar(64),
      requested_by_user_id varchar(255) NOT NULL,
      created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      run_key varchar(96) NOT NULL DEFAULT 'canonical',
      _created_by user_profile,
      _updated_by user_profile,
      UNIQUE (tenant_id, action_type, document_version_id, run_key)
    )
  `);
  await sql.unsafe(`
    CREATE TABLE action_attempt (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      attempt_id varchar(96) NOT NULL UNIQUE,
      work_item_id varchar(96) NOT NULL REFERENCES work_item(work_item_id),
      action_type varchar(64) NOT NULL,
      attempt_no integer NOT NULL DEFAULT 1,
      trigger_request_id varchar(96) NOT NULL,
      request_origin varchar(32) NOT NULL,
      status varchar(64) NOT NULL DEFAULT 'pending',
      producer_run_id varchar(96), package_artifact_ref text,
      package_artifact_sha256 varchar(64), failure_artifact_ref text,
      failure_artifact_sha256 varchar(64), error_code varchar(160),
      error_message text, actor_user_id varchar(255) NOT NULL,
      tenant_id varchar(128) NOT NULL, started_at timestamptz(3),
      completed_at timestamptz(3),
      created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      priority integer NOT NULL DEFAULT 100, input_revision integer,
      base_revision integer, document_version_id varchar(96),
      task_envelope_json text, task_input_hash varchar(64),
      result_envelope_json text, result_content_hash varchar(64),
      idempotency_key varchar(255), claim_count integer NOT NULL DEFAULT 0,
      retry_count integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 3, lease_owner varchar(160),
      lease_token varchar(96), lease_generation integer NOT NULL DEFAULT 0,
      lease_expires_at timestamptz(3), last_heartbeat_at timestamptz(3),
      next_attempt_at timestamptz(3), deadline_at timestamptz(3),
      cancel_requested_at timestamptz(3), cancel_reason text,
      terminal_reason varchar(160), projection_applied boolean NOT NULL DEFAULT false,
      executor_session_key varchar(512), operation_ref varchar(128),
      commit_started_at timestamptz(3), lease_slot integer,
      _created_by user_profile, _updated_by user_profile,
      UNIQUE (work_item_id, action_type, attempt_no)
    )
  `);
  await sql.unsafe(`CREATE UNIQUE INDEX uk_action_attempt_idempotency
    ON action_attempt(tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
      AND status IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING')`);
  await sql.unsafe(`CREATE UNIQUE INDEX uk_action_attempt_active_work_task
    ON action_attempt(work_item_id, action_type)
    WHERE status IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING')`);
  await sql.unsafe(`CREATE UNIQUE INDEX uk_action_attempt_operation_ref
    ON action_attempt(operation_ref) WHERE operation_ref IS NOT NULL`);
  await sql.unsafe(`CREATE UNIQUE INDEX uk_action_attempt_lease_slot
    ON action_attempt(tenant_id, request_origin, lease_slot)
    WHERE status IN ('RUNNING', 'COMMITTING') AND lease_slot IS NOT NULL`);
  await sql.unsafe(
    await readFile(
      resolve(root, 'migrations/0013_canonical_rule_set_lifecycle.sql'),
      'utf8',
    ),
  );
}
