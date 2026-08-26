import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import postgres from 'postgres';

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const {
  sealResultEnvelope,
} = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const {
  ActionAttemptLifecycleService,
} = require('../../server/modules/action-attempt/action-attempt-lifecycle.service.ts');
const {
  ActionAttemptRepository,
} = require('../../server/modules/action-attempt/action-attempt.repository.ts');
const {
  CanonicalHostApplicabilityInputProducer,
} = require('../../server/modules/canonical-host/canonical-host-applicability-input.producer.ts');
const {
  CanonicalHostOpenClawApplicabilityService,
} = require('../../server/modules/canonical-host/canonical-host-openclaw-applicability.service.ts');
const {
  APPLICABILITY_MCP_SERVER_NAME,
  APPLICABILITY_MCP_SERVER_VERSION,
  APPLICABILITY_MODEL_VERSION,
  APPLICABILITY_PROMPT_VERSION,
  APPLICABILITY_SKILL_VERSION,
  applicabilityRuntimePolicy,
} = require('../../server/modules/canonical-host/canonical-host-openclaw-applicability.contract.ts');
const {
  MiaodaCanonicalWorkItemRegistrarAdapter,
} = require('../../server/modules/work-item/miaoda-canonical-work-item-registrar.adapter.ts');
const {
  MiaodaWorkItemRepository,
} = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const {
  MiaodaOrdinaryArtifactStoreAdapter,
} = require('../../server/modules/unified-reader/miaoda-ordinary-artifact-store.adapter.ts');

const databaseUrl = process.env.APPLICABILITY_C4_TEST_DATABASE_URL;

test(
  'R09 C4 real PostgreSQL producer -> begin -> commit uses existing WorkItem CAS and ActionAttempt lifecycle',
  { skip: !databaseUrl, concurrency: false },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 8 });
    let artifactOwner = null;
    try {
      await resetDatabase(sql);
      const fixture = buildFixture();
      artifactOwner = await prepareOrdinaryArtifactOwner(fixture);
      await seedWorkItem(sql, fixture.workItem);
      const db = drizzle(sql);
      const workItems = new MiaodaWorkItemRepository(db);
      const registrar = new MiaodaCanonicalWorkItemRegistrarAdapter(workItems);
      const attemptRepository = new ActionAttemptRepository(db);
      const attempts = new ActionAttemptLifecycleService(attemptRepository);
      const scope = serviceScope();
      const artifactStore = artifactOwner.store;
      const reader = {
        readAllSourceUnits: async () => structuredClone(fixture.sourceUnits),
      };
      const controlledSelection = {
        readCurrent: async () => structuredClone(fixture.selection),
      };
      const producer = new CanonicalHostApplicabilityInputProducer(
        registrar,
        artifactStore,
        reader,
        scope,
        controlledSelection,
      );
      const applicability = new CanonicalHostOpenClawApplicabilityService(
        registrar,
        artifactStore,
        reader,
        attempts,
        scope,
        producer,
      );

      const produced = await producer.produce('APCTX-C4-OPAQUE', 'request-c4');
      assert.equal(produced.revision, 8);
      assert.equal(produced.applicabilityInput.workItemId, 'WI-C4');
      assert.equal(produced.applicabilityInput.documentVersionId, 'DV-C4');
      assert.deepEqual(
        produced.applicabilityInput.fleetMasterData.assets.map(
          (asset) => asset.assetId,
        ),
        ['ASSET-C4'],
      );

      const begin = await applicability.begin(
        'APCTX-C4-OPAQUE',
        'request-c4-evaluation',
      );
      assert.equal(begin.task.baseRevision, 8);
      assert.equal(begin.task.hostResolvedMissingInputs.length, 0);
      assert.equal(
        begin.modelInput.fleetBinding.selectionRevision,
        'selection-C4',
      );
      assert.equal(
        begin.modelInput.sourceExpressions[0].applicabilityLevel,
        'document_effectivity',
      );
      assert.equal(begin.modelInput.sourceExpressions[0].contentRef, null);

      const candidate = candidateFor(begin.modelInput);
      const result = sealResultEnvelope({
        schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
        actionAttemptId: begin.task.actionAttemptId,
        operationRef: begin.task.operationRef,
        taskType: 'OPENCLAW_APPLICABILITY_EVALUATION',
        workItemId: begin.task.workItemId,
        baseRevision: begin.task.baseRevision,
        status: 'SUCCEEDED',
        businessOutcome: 'CANDIDATE_READY',
        candidateStatus: null,
        modelOutput: JSON.stringify(candidate),
        outputArtifactRefs: [],
        sourceRefs: structuredClone(begin.task.sourceRefs),
        factsConsidered: begin.modelInput.controlledFacts.map(
          (fact) => fact.factId,
        ),
        missingInputs: [],
        conflicts: [],
        warnings: [],
        modelVersion: APPLICABILITY_MODEL_VERSION,
        promptVersion: APPLICABILITY_PROMPT_VERSION,
        skillVersion: APPLICABILITY_SKILL_VERSION,
        toolVersions: {
          [APPLICABILITY_MCP_SERVER_NAME]: APPLICABILITY_MCP_SERVER_VERSION,
        },
        runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
        errorCode: null,
        errorDetail: null,
      });
      const committed = await applicability.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        result,
      );
      assert.equal(committed.workItemRevision, 9);
      assert.equal(committed.status, 'CANDIDATE_ONLY');
      assert.equal(committed.applicability.decision, 'NOT_APPLICABLE');
      assert.equal(committed.applicability.pass, false);

      const [workItemReadback] = await sql`
        SELECT revision, projection_json AS "projectionJson"
        FROM work_item WHERE work_item_id = 'WI-C4'
      `;
      const projection = JSON.parse(workItemReadback.projectionJson);
      assert.equal(workItemReadback.revision, 9);
      assert.equal(projection.applicabilityInput.documentVersionId, 'DV-C4');
      assert.equal(projection.applicability.decision, 'NOT_APPLICABLE');
      const [attemptReadback] = await sql`
        SELECT status, projection_applied AS "projectionApplied",
          result_content_hash AS "resultContentHash"
        FROM action_attempt WHERE operation_ref = ${begin.attemptRef}
      `;
      assert.deepEqual(attemptReadback, {
        status: 'SUCCEEDED',
        projectionApplied: true,
        resultContentHash: result.contentHash,
      });
      assert.equal(await artifactOwner.scoped.physicalFileCount(), 3);
      assert.equal(await artifactOwner.scoped.candidatePhysicalCount(), 1);
    } finally {
      await artifactOwner?.cleanup();
      await sql.end({ timeout: 5 });
    }
  },
);

test(
  'R09 C4 real PostgreSQL rejects all three commit races without terminal/orphan mutation',
  { skip: !databaseUrl, concurrency: false },
  async (t) => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 8 });
    try {
      await t.test('controlled selection drift after begin', async (t) => {
        const harness = await realHarness(sql);
        t.after(() => harness.artifactOwner.cleanup());
        const before = await readWorkItemRow(sql);
        harness.selection.selectionRevision = 'selection-C4-r2';
        harness.selection.fleetMasterData.sourceRevisionKey =
          'fleet-revision-C4-r2';
        harness.selection.fleetMasterData.authorityRevision = 'authority-C4-r2';
        harness.selection.fleetMasterData.assets[0].assetVersionId =
          'ASSET-V-C4-r2';
        harness.selection.fleetMasterData.assets[0].recordHash =
          'asset-hash-C4-r2';

        await assert.rejects(
          harness.commit(),
          /APPLICABILITY_CONTROLLED_SELECTION_DRIFT/u,
        );
        const after = await readWorkItemRow(sql);
        assert.deepEqual(after, before);
        assert.deepEqual(
          await readAttemptRaceState(sql, harness.begin.attemptRef),
          {
            status: 'RUNNING',
            completedAt: null,
            terminalReason: null,
            projectionApplied: false,
            resultEnvelopeJson: null,
            resultContentHash: null,
            leaseToken: harness.begin.leaseToken,
            leaseGeneration: harness.begin.leaseGeneration,
          },
        );
        assert.equal(await harness.artifactOwner.scoped.physicalFileCount(), 2);
        assert.equal(
          await harness.artifactOwner.scoped.candidatePhysicalCount(),
          0,
        );
      });

      await t.test(
        'WorkItem drift after prepare preserves COMMITTING',
        async (t) => {
          const harness = await realHarness(sql, {
            afterPrepare: () => bumpWorkItemRevision(sql),
          });
          t.after(() => harness.artifactOwner.cleanup());
          await assert.rejects(
            harness.commit(),
            /APPLICABILITY_COMMITTING_WORK_ITEM_DRIFT/u,
          );
          const attempt = await readAttemptRaceState(
            sql,
            harness.begin.attemptRef,
          );
          assert.equal(attempt.status, 'COMMITTING');
          assert.equal(attempt.completedAt, null);
          assert.equal(attempt.terminalReason, null);
          assert.equal(attempt.projectionApplied, false);
          assert.equal(attempt.resultContentHash, harness.result.contentHash);
          assert.equal(
            JSON.parse(attempt.resultEnvelopeJson).contentHash,
            harness.result.contentHash,
          );
          assert.equal(attempt.leaseToken, harness.begin.leaseToken);
          assert.equal(attempt.leaseGeneration, harness.begin.leaseGeneration);
          assert.equal(
            await harness.artifactOwner.scoped.physicalFileCount(),
            2,
          );
          assert.equal(
            await harness.artifactOwner.scoped.candidatePhysicalCount(),
            0,
          );
        },
      );

      await t.test(
        'artifact stage then losing WorkItem CAS discards bytes',
        async (t) => {
          const harness = await realHarness(sql, {
            beforeCandidateCas: () => bumpWorkItemRevision(sql),
          });
          t.after(() => harness.artifactOwner.cleanup());
          const beforeProjection = JSON.parse(
            (await readWorkItemRow(sql)).projectionJson,
          );
          await assert.rejects(harness.commit(), /WORK_ITEM_CAS_CONFLICT/u);
          const after = await readWorkItemRow(sql);
          const afterProjection = JSON.parse(after.projectionJson);
          assert.equal(after.revision, beforeProjection.revision + 1);
          assert.equal(afterProjection.revision, beforeProjection.revision + 1);
          assert.equal(afterProjection.applicability ?? null, null);
          assert.equal(
            await harness.artifactOwner.scoped.physicalFileCount(),
            2,
          );
          assert.equal(
            await harness.artifactOwner.scoped.candidatePhysicalCount(),
            0,
          );
          const attempt = await readAttemptRaceState(
            sql,
            harness.begin.attemptRef,
          );
          assert.equal(attempt.status, 'COMMITTING');
          assert.equal(attempt.completedAt, null);
          assert.equal(attempt.terminalReason, null);
          assert.equal(attempt.projectionApplied, false);
          assert.equal(attempt.resultContentHash, harness.result.contentHash);
        },
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

test(
  'R09 C4 real PostgreSQL and physical FileService keep CAS as the sole publication boundary',
  { skip: !databaseUrl, concurrency: false },
  async (t) => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 8 });
    try {
      await t.test(
        'finalized bytes and descriptor exist while current remains unpublished before CAS',
        async (t) => {
          let beforePublication = null;
          const harness = await realHarness(sql, {
            beforeCandidateCas: async () => {
              beforePublication = await readWorkItemRow(sql);
            },
            rejectArtifactCallsAfterCas: true,
          });
          t.after(() => harness.artifactOwner.cleanup());

          const committed = await harness.commit();
          assert.equal(beforePublication.revision, 8);
          assert.equal(
            JSON.parse(beforePublication.projectionJson).applicability ?? null,
            null,
          );
          assert.equal(committed.workItemRevision, 9);
          assert.match(
            committed.applicability.artifact.ref,
            /\/applicability-candidate\/[0-9a-f]{64}\/[0-9a-f]{64}$/u,
          );
          assert.equal(
            await harness.artifactOwner.scoped.candidatePhysicalCount(),
            1,
          );
        },
      );

      await t.test(
        'finalize durability failure leaves current unpublished and attempt sealed COMMITTING',
        async (t) => {
          const harness = await realHarness(sql, {
            failFinalizeDurability: true,
          });
          t.after(() => harness.artifactOwner.cleanup());

          await assert.rejects(
            harness.commit(),
            /ARTIFACT_READBACK_MISMATCH:METADATA/u,
          );
          const workItem = await readWorkItemRow(sql);
          assert.equal(workItem.revision, 8);
          assert.equal(
            JSON.parse(workItem.projectionJson).applicability ?? null,
            null,
          );
          assert.equal(
            await harness.artifactOwner.scoped.candidatePhysicalCount(),
            0,
          );
          const attempt = await readAttemptRaceState(
            sql,
            harness.begin.attemptRef,
          );
          assert.equal(attempt.status, 'COMMITTING');
          assert.equal(attempt.completedAt, null);
          assert.equal(attempt.terminalReason, null);
          assert.equal(attempt.projectionApplied, false);
          assert.equal(attempt.resultContentHash, harness.result.contentHash);
          assert.equal(
            JSON.parse(attempt.resultEnvelopeJson).contentHash,
            harness.result.contentHash,
          );
          assert.equal(attempt.leaseToken, harness.begin.leaseToken);
          assert.equal(attempt.leaseGeneration, harness.begin.leaseGeneration);
        },
      );

      await t.test(
        'unknown applied CAS outcome recovers exact current and duplicate stays idempotent',
        async (t) => {
          const harness = await realHarness(sql, {
            throwAfterCandidateCasApply: true,
            rejectArtifactCallsAfterCas: true,
          });
          t.after(() => harness.artifactOwner.cleanup());

          const recovered = await harness.commit();
          assert.equal(recovered.workItemRevision, 9);
          assert.equal(
            recovered.applicability.actionAttemptId,
            harness.begin.task.actionAttemptId,
          );
          const duplicate = await harness.commit();
          assert.deepEqual(duplicate, recovered);
          assert.equal((await readWorkItemRow(sql)).revision, 9);
          assert.equal(
            await harness.artifactOwner.scoped.candidatePhysicalCount(),
            1,
          );
          assert.equal(
            (await readAttemptRaceState(sql, harness.begin.attemptRef)).status,
            'SUCCEEDED',
          );
        },
      );

      await t.test(
        'same-attempt concurrent duplicate preserves the winner stable artifact',
        async (t) => {
          const firstReachedCas = deferred();
          const releaseFirstCas = deferred();
          const harness = await realHarness(sql, {
            beforeCandidateCas: async () => {
              firstReachedCas.resolve();
              await releaseFirstCas.promise;
            },
          });
          t.after(() => harness.artifactOwner.cleanup());

          const firstCommit = harness.commit();
          await firstReachedCas.promise;
          let second;
          try {
            second = await harness.commit();
          } finally {
            releaseFirstCas.resolve();
          }
          const first = await firstCommit;

          assert.deepEqual(first, second);
          assert.equal(first.workItemRevision, 9);
          const workItem = await readWorkItemRow(sql);
          const current = JSON.parse(workItem.projectionJson);
          assert.equal(workItem.revision, 9);
          assert.equal(
            current.applicability.actionAttemptId,
            harness.begin.task.actionAttemptId,
          );
          assert.deepEqual(
            current.applicability.artifact,
            first.applicability.artifact,
          );
          assert.equal(
            await harness.artifactOwner.scoped.candidatePhysicalCount(),
            1,
          );
          const bytes = await harness.artifactOwner.store.readActualBytes(
            current.applicability.artifact,
          );
          assert.equal(
            bytes.byteLength,
            current.applicability.artifact.byteLength,
          );
          assert.equal(
            createHash('sha256').update(bytes).digest('hex'),
            current.applicability.artifact.sha256,
          );
          assert.equal(
            (await readAttemptRaceState(sql, harness.begin.attemptRef)).status,
            'SUCCEEDED',
          );
        },
      );

      await t.test(
        'CAS barrier preserves same physical ref when current descriptor metadata drifts',
        async (t) => {
          let ownedDescriptor = null;
          const harness = await realHarness(sql, {
            beforeCandidateCas: async (input) => {
              ownedDescriptor = structuredClone(
                input.next.applicability.artifact,
              );
              await publishCompetingCurrent(sql, input, (current) => {
                current.applicability.artifact.byteLength += 1;
              });
            },
          });
          t.after(() => harness.artifactOwner.cleanup());

          await assert.rejects(
            harness.commit(),
            /APPLICABILITY_RECOVERY_CURRENT_BINDING_MISMATCH/u,
          );
          const workItem = await readWorkItemRow(sql);
          const current = JSON.parse(workItem.projectionJson);
          assert.equal(workItem.revision, 9);
          assert.equal(current.applicability.artifact.ref, ownedDescriptor.ref);
          assert.equal(
            current.applicability.artifact.storeRole,
            ownedDescriptor.storeRole,
          );
          assert.notEqual(
            current.applicability.artifact.byteLength,
            ownedDescriptor.byteLength,
          );
          assert.equal(
            await harness.artifactOwner.scoped.candidatePhysicalCount(),
            1,
          );
          const bytes =
            await harness.artifactOwner.store.readActualBytes(ownedDescriptor);
          assert.equal(
            createHash('sha256').update(bytes).digest('hex'),
            ownedDescriptor.sha256,
          );
          assert.equal(
            (await readAttemptRaceState(sql, harness.begin.attemptRef)).status,
            'COMMITTING',
          );
        },
      );

      await t.test(
        'CAS barrier preserves same physical ref when current attempt binding drifts',
        async (t) => {
          let ownedDescriptor = null;
          const harness = await realHarness(sql, {
            beforeCandidateCas: async (input) => {
              ownedDescriptor = structuredClone(
                input.next.applicability.artifact,
              );
              await publishCompetingCurrent(sql, input, (current) => {
                current.applicability.actionAttemptId = 'ATT-C4-COMPETING';
              });
            },
          });
          t.after(() => harness.artifactOwner.cleanup());

          await assert.rejects(
            harness.commit(),
            /APPLICABILITY_RECOVERY_CURRENT_PHYSICAL_REF_CONFLICT/u,
          );
          const workItem = await readWorkItemRow(sql);
          const current = JSON.parse(workItem.projectionJson);
          assert.equal(workItem.revision, 9);
          assert.equal(
            current.applicability.actionAttemptId,
            'ATT-C4-COMPETING',
          );
          assert.deepEqual(current.applicability.artifact, ownedDescriptor);
          assert.equal(
            await harness.artifactOwner.scoped.candidatePhysicalCount(),
            1,
          );
          const bytes =
            await harness.artifactOwner.store.readActualBytes(ownedDescriptor);
          assert.equal(bytes.byteLength, ownedDescriptor.byteLength);
          assert.equal(
            (await readAttemptRaceState(sql, harness.begin.attemptRef)).status,
            'COMMITTING',
          );
        },
      );

      await t.test(
        'CAS barrier discards owned bytes when current references a different physical ref',
        async (t) => {
          let ownedDescriptor = null;
          let competingArtifact = null;
          const harness = await realHarness(sql, {
            beforeCandidateCas: async (input) => {
              ownedDescriptor = structuredClone(
                input.next.applicability.artifact,
              );
              await publishCompetingCurrent(sql, input, (current) => {
                current.applicability.actionAttemptId = 'ATT-C4-COMPETING';
                current.applicability.artifact = structuredClone(
                  competingArtifact.artifact,
                );
              });
            },
          });
          t.after(() => harness.artifactOwner.cleanup());
          const competingBytes = new TextEncoder().encode(
            JSON.stringify({ candidate: 'competing-current' }),
          );
          const staged =
            await harness.artifactOwner.store.stageCandidateAndReadback({
              bytes: competingBytes,
              ownerRef: 'ATT-C4-COMPETING',
            });
          competingArtifact =
            await harness.artifactOwner.store.finalizeStagedCandidate(staged);

          await assert.rejects(harness.commit(), /WORK_ITEM_CAS_CONFLICT/u);
          const workItem = await readWorkItemRow(sql);
          const current = JSON.parse(workItem.projectionJson);
          assert.equal(workItem.revision, 9);
          assert.deepEqual(
            current.applicability.artifact,
            competingArtifact.artifact,
          );
          assert.equal(
            await harness.artifactOwner.scoped.candidatePhysicalCount(),
            1,
          );
          await assert.rejects(
            harness.artifactOwner.store.readActualBytes(ownedDescriptor),
            /ARTIFACT_READBACK_MISMATCH:METADATA/u,
          );
          const bytes = await harness.artifactOwner.store.readActualBytes(
            competingArtifact.artifact,
          );
          assert.deepEqual(bytes, competingBytes);
          assert.equal(
            (await readAttemptRaceState(sql, harness.begin.attemptRef)).status,
            'COMMITTING',
          );
        },
      );

      await t.test(
        'unknown unapplied CAS outcome safely discards the finalized artifact without retry',
        async (t) => {
          const harness = await realHarness(sql, {
            throwBeforeCandidateCas: true,
          });
          t.after(() => harness.artifactOwner.cleanup());

          await assert.rejects(
            harness.commit(),
            /WORK_ITEM_CAS_OUTCOME_UNKNOWN/u,
          );
          const workItem = await readWorkItemRow(sql);
          assert.equal(workItem.revision, 8);
          assert.equal(
            JSON.parse(workItem.projectionJson).applicability ?? null,
            null,
          );
          assert.equal(
            await harness.artifactOwner.scoped.candidatePhysicalCount(),
            0,
          );
          assert.equal(
            (await readAttemptRaceState(sql, harness.begin.attemptRef)).status,
            'COMMITTING',
          );
        },
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function publishCompetingCurrent(sql, input, mutate) {
  const current = structuredClone(input.next);
  current.revision = input.expectedRevision + 1;
  mutate(current);
  const updated = await sql`
    UPDATE work_item
    SET revision = ${current.revision},
      projection_json = ${JSON.stringify(current)},
      updated_at = CURRENT_TIMESTAMP
    WHERE work_item_id = ${input.workItemId}
      AND revision = ${input.expectedRevision}
    RETURNING revision
  `;
  assert.equal(updated.length, 1);
}

function assertSafeIsolatedDatabase(value) {
  const parsed = new URL(value);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/wiselink_applicability_c4_test');
}

async function resetDatabase(sql) {
  await sql.unsafe('DROP SCHEMA public CASCADE');
  await sql.unsafe('CREATE SCHEMA public');
  await sql.unsafe('CREATE TYPE user_profile AS (user_id text)');
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
      producer_run_id varchar(96),
      package_artifact_ref text,
      package_artifact_sha256 varchar(64),
      failure_artifact_ref text,
      failure_artifact_sha256 varchar(64),
      error_code varchar(160),
      error_message text,
      actor_user_id varchar(255) NOT NULL,
      tenant_id varchar(128) NOT NULL,
      started_at timestamptz(3),
      completed_at timestamptz(3),
      created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      priority integer NOT NULL DEFAULT 100,
      input_revision integer,
      base_revision integer,
      document_version_id varchar(96),
      task_envelope_json text,
      task_input_hash varchar(64),
      result_envelope_json text,
      result_content_hash varchar(64),
      idempotency_key varchar(255),
      claim_count integer NOT NULL DEFAULT 0,
      retry_count integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 3,
      lease_owner varchar(160),
      lease_token varchar(96),
      lease_generation integer NOT NULL DEFAULT 0,
      lease_expires_at timestamptz(3),
      last_heartbeat_at timestamptz(3),
      next_attempt_at timestamptz(3),
      deadline_at timestamptz(3),
      cancel_requested_at timestamptz(3),
      cancel_reason text,
      terminal_reason varchar(160),
      projection_applied boolean NOT NULL DEFAULT false,
      executor_session_key varchar(512),
      operation_ref varchar(128),
      commit_started_at timestamptz(3),
      lease_slot integer,
      _created_by user_profile,
      _updated_by user_profile,
      UNIQUE (work_item_id, action_type, attempt_no)
    )
  `);
  await sql.unsafe(`
    CREATE UNIQUE INDEX uk_action_attempt_idempotency
    ON action_attempt(tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
      AND status IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING')
  `);
  await sql.unsafe(`
    CREATE UNIQUE INDEX uk_action_attempt_active_work_task
    ON action_attempt(work_item_id, action_type)
    WHERE status IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING')
  `);
  await sql.unsafe(`
    CREATE UNIQUE INDEX uk_action_attempt_operation_ref
    ON action_attempt(operation_ref) WHERE operation_ref IS NOT NULL
  `);
  await sql.unsafe(`
    CREATE UNIQUE INDEX uk_action_attempt_lease_slot
    ON action_attempt(tenant_id, request_origin, lease_slot)
    WHERE status IN ('RUNNING', 'COMMITTING') AND lease_slot IS NOT NULL
  `);
}

async function seedWorkItem(sql, workItem) {
  await sql`
    INSERT INTO work_item (
      work_item_id, tenant_id, action_type, document_id, document_version_id,
      source_artifact_id, source_file_sha256, source_byte_length,
      normalized_family, request_id, status, revision, projection_json,
      package_id, package_artifact_ref, package_artifact_sha256,
      requested_by_user_id, run_key
    ) VALUES (
      ${workItem.workItemId}, 'tenant-C4', 'PARSE_PDF',
      ${workItem.source.documentId}, ${workItem.source.documentVersionId},
      ${workItem.source.sourceArtifactId}, ${workItem.source.sourceFileSha256},
      ${workItem.source.sourceByteLength}, ${workItem.classification.normalizedFamily},
      ${workItem.requestId}, ${workItem.phase}, ${workItem.revision},
      ${JSON.stringify(workItem)}, ${workItem.package.packageId},
      ${workItem.package.artifact.ref}, ${workItem.package.artifact.sha256},
      'actor-C4', 'c4'
    )
  `;
}

function serviceScope() {
  const base = {
    principalId: 'service:openclaw-main',
    appId: 'app_17bzc551rsg',
    tenantId: 'tenant-C4',
    workItemId: 'WI-C4',
    authorizationFingerprint: 'scope-c4',
  };
  return {
    authorizeOpenClawApplicabilityContext: async ({
      applicabilityContextRef,
      requestId,
    }) => ({ ...base, applicabilityContextRef, requestId }),
    authorizeOpenClawAttempt: async ({ attemptRef }) => ({
      ...base,
      attemptRef,
    }),
  };
}

async function realHarness(sql, options = {}) {
  await resetDatabase(sql);
  const fixture = buildFixture();
  const artifactOwner = await prepareOrdinaryArtifactOwner(fixture);
  await seedWorkItem(sql, fixture.workItem);
  const db = drizzle(sql);
  const workItems = new MiaodaWorkItemRepository(db);
  const actualRegistrar = new MiaodaCanonicalWorkItemRegistrarAdapter(
    workItems,
  );
  let candidateCasHookUsed = false;
  const registrar = {
    getTenantScopedByWorkItemId: (input) =>
      actualRegistrar.getTenantScopedByWorkItemId(input),
    compareAndSet: async (input) => {
      if (
        !candidateCasHookUsed &&
        input.next.applicability?.actionAttemptId &&
        options.beforeCandidateCas
      ) {
        candidateCasHookUsed = true;
        await options.beforeCandidateCas(input);
      }
      if (
        input.next.applicability?.actionAttemptId &&
        options.throwBeforeCandidateCas
      ) {
        throw new Error('WORK_ITEM_CAS_OUTCOME_UNKNOWN');
      }
      const updated = await actualRegistrar.compareAndSet(input);
      if (input.next.applicability?.actionAttemptId) {
        if (options.rejectArtifactCallsAfterCas) {
          artifactOwner.scoped.rejectCalls = true;
        }
        if (options.throwAfterCandidateCasApply) {
          throw new Error('WORK_ITEM_CAS_OUTCOME_UNKNOWN');
        }
      }
      return updated;
    },
  };
  const attemptRepository = new ActionAttemptRepository(db);
  const attempts = new ActionAttemptLifecycleService(attemptRepository);
  if (options.afterPrepare) {
    const actualPrepare = attempts.prepareCommit.bind(attempts);
    let prepareHookUsed = false;
    attempts.prepareCommit = async (input) => {
      const prepared = await actualPrepare(input);
      if (!prepareHookUsed && prepared.row.status === 'COMMITTING') {
        prepareHookUsed = true;
        await options.afterPrepare();
      }
      return prepared;
    };
  }
  const scope = serviceScope();
  const selection = fixture.selection;
  const controlledSelection = {
    readCurrent: async () => structuredClone(selection),
  };
  const reader = {
    readAllSourceUnits: async () => structuredClone(fixture.sourceUnits),
  };
  const producer = new CanonicalHostApplicabilityInputProducer(
    registrar,
    artifactOwner.store,
    reader,
    scope,
    controlledSelection,
  );
  if (options.failFinalizeDurability) {
    const actualFinalize = artifactOwner.store.finalizeStagedCandidate.bind(
      artifactOwner.store,
    );
    artifactOwner.store.finalizeStagedCandidate = async (staged) => {
      await artifactOwner.scoped.removeAllCandidateFiles();
      return actualFinalize(staged);
    };
  }
  const applicability = new CanonicalHostOpenClawApplicabilityService(
    registrar,
    artifactOwner.store,
    reader,
    attempts,
    scope,
    producer,
  );
  await producer.produce('APCTX-C4-OPAQUE', 'request-c4');
  const begin = await applicability.begin(
    'APCTX-C4-OPAQUE',
    'request-c4-evaluation',
  );
  const result = resultFor(begin);
  return {
    selection,
    artifactOwner,
    begin,
    result,
    commit: () =>
      applicability.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        result,
      ),
  };
}

async function readWorkItemRow(sql) {
  const [row] = await sql`
    SELECT revision, projection_json AS "projectionJson"
    FROM work_item WHERE work_item_id = 'WI-C4'
  `;
  return row;
}

async function bumpWorkItemRevision(sql) {
  const current = await readWorkItemRow(sql);
  const projection = JSON.parse(current.projectionJson);
  projection.revision += 1;
  await sql`
    UPDATE work_item
    SET revision = ${projection.revision},
      projection_json = ${JSON.stringify(projection)},
      updated_at = CURRENT_TIMESTAMP
    WHERE work_item_id = 'WI-C4' AND revision = ${current.revision}
  `;
}

async function readAttemptRaceState(sql, attemptRef) {
  const [row] = await sql`
    SELECT status, completed_at AS "completedAt",
      terminal_reason AS "terminalReason",
      projection_applied AS "projectionApplied",
      result_envelope_json AS "resultEnvelopeJson",
      result_content_hash AS "resultContentHash",
      lease_token AS "leaseToken",
      lease_generation AS "leaseGeneration"
    FROM action_attempt WHERE operation_ref = ${attemptRef}
  `;
  return row;
}

class LocalScopedArtifactOwner {
  metadata = new Map();
  nextId = 0;
  rejectCalls = false;

  constructor(bucketId, root) {
    this.bucketId = bucketId;
    this.root = root;
  }

  async getFileMetadata(filePath) {
    this.assertCallsAllowed();
    const absolute = this.absolutePath(filePath);
    const value = this.metadata.get(filePath);
    if (!value || !(await exists(absolute))) return null;
    const info = await stat(absolute);
    return {
      id: value.id,
      bucketID: this.bucketId,
      filePath: `/${filePath}`,
      metadata: {
        contentLength: String(info.size),
        mimeType: value.mimeType,
      },
    };
  }

  async upload(bytes, options) {
    this.assertCallsAllowed();
    const absolute = this.absolutePath(options.filePath);
    if (!options.upsert && (await exists(absolute))) {
      throw new Error('LOCAL_FILE_ALREADY_EXISTS');
    }
    await mkdir(dirname(absolute), { recursive: true });
    this.nextId += 1;
    await writeFile(absolute, bytes, { flag: options.upsert ? 'w' : 'wx' });
    this.metadata.set(options.filePath, {
      id: `local-file-${this.nextId}`,
      mimeType: options.contentType,
    });
    return { filePath: options.filePath };
  }

  async download(filePath) {
    this.assertCallsAllowed();
    const value = this.metadata.get(filePath);
    if (!value) throw new Error('LOCAL_FILE_NOT_FOUND');
    return {
      content: Uint8Array.from(await readFile(this.absolutePath(filePath))),
      metadata: { id: value.id },
    };
  }

  async remove(filePaths) {
    this.assertCallsAllowed();
    for (const filePath of filePaths) {
      await unlink(this.absolutePath(filePath)).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
      this.metadata.delete(filePath);
    }
  }

  async removeAllCandidateFiles() {
    for (const filePath of [...this.metadata.keys()]) {
      if (filePath.includes('/applicability-candidate/')) {
        await this.remove([filePath]);
      }
    }
  }

  async candidatePhysicalCount() {
    return (await this.physicalPaths()).filter((path) =>
      path.includes('/applicability-candidate/'),
    ).length;
  }

  async physicalFileCount() {
    return (await this.physicalPaths()).length;
  }

  async physicalPaths() {
    const paths = await walkFiles(this.root);
    return paths.map((path) => relative(this.root, path).split(sep).join('/'));
  }

  assertCallsAllowed() {
    if (this.rejectCalls) throw new Error('POST_CAS_ARTIFACT_CALL');
  }

  absolutePath(filePath) {
    const absolute = resolve(this.root, filePath);
    if (
      filePath.startsWith('/') ||
      absolute === this.root ||
      !absolute.startsWith(`${this.root}${sep}`)
    ) {
      throw new Error('LOCAL_FILE_PATH_INVALID');
    }
    return absolute;
  }
}

async function prepareOrdinaryArtifactOwner(fixture) {
  const root = await mkdtemp(join(tmpdir(), 'wiselink-c4-artifacts-'));
  const scoped = new LocalScopedArtifactOwner('bucket-c4-local', root);
  const store = new MiaodaOrdinaryArtifactStoreAdapter({
    getDefaultBucket: async () => 'bucket-c4-local',
    from: () => scoped,
  });
  const packageStored = await store.persistAndReadback(fixture.packageBytes);
  const bilingualStored = await store.persistAndReadback(
    fixture.bilingualBytes,
  );
  fixture.workItem.package.artifact = packageStored.artifact;
  fixture.workItem.translation.artifact = bilingualStored.artifact;
  return {
    store,
    scoped,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function walkFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...(await walkFiles(path)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

function buildFixture() {
  const packageBytes = new TextEncoder().encode(
    JSON.stringify({
      sourceRefs: [{ sourceRefId: 'SRC-C4' }],
      modules: [{ moduleId: 'MODULE-C4' }],
      applicability: {
        sourceExpressions: [
          {
            expressionId: 'EXP-C4',
            text: 'Applicable to Boeing 737-8 airplanes.',
            form: 'display_text',
            authority: 'source_asserted',
            sourceRefIds: ['SRC-C4'],
          },
        ],
        assignments: [
          {
            assignmentId: 'ASSIGN-C4',
            expressionId: 'EXP-C4',
            authority: 'source_asserted',
            target: {
              kind: 'module',
              targetId: 'MODULE-C4',
              sourceRefIds: ['SRC-C4'],
            },
          },
        ],
      },
    }),
  );
  const bilingualBytes = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 'wiselink.3_1.bilingual_translation_artifact.v1',
      candidateOnly: true,
      source: {
        documentId: 'DOC-C4',
        revisionId: 'DV-C4',
        sbdPackageId: 'PKG-C4',
        sbdContentHash: 'sha256:package-content-c4',
        tcpPackageId: null,
        tcpContentHash: null,
      },
      ruleSet: {
        ruleSetId: 'wiselink.host.translation-rules.zh-cn.v1',
        ruleSetVersion: '1.0.0',
      },
      units: [
        {
          unitId: 'UNIT-C4',
          kind: 'paragraph',
          sourceText: 'Applicable to Boeing 737-8 airplanes.',
          translatedText: '适用于波音 737-8 飞机。',
          sourceRefIds: ['SRC-C4'],
          engineerRevisionId: null,
        },
      ],
      validation: { verdict: 'ACCEPTED' },
      execution: { actionAttemptId: 'ATT-TRANSLATE-C4' },
    }),
  );
  const packageArtifact = artifact('artifact://c4/package.json', packageBytes);
  const bilingualArtifact = artifact(
    'artifact://c4/translation.json',
    bilingualBytes,
  );
  const workItem = {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-C4',
    requestId: 'REQ-C4',
    revision: 7,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'perm-C4',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor-C4',
      decisionId: 'decision-C4',
      decisionHash: 'decision-hash-C4',
      permissionSnapshotVersion: 'perm-C4',
    },
    source: {
      documentId: 'DOC-C4',
      documentVersionId: 'DV-C4',
      parserRequestId: 'PARSER-C4',
      sourceArtifactId: 'SOURCE-C4',
      sourceFileSha256: 'b'.repeat(64),
      sourceByteLength: 1,
      driveFileToken: 'drive-C4',
      driveSourceVersion: 'v1',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      classifierReleaseId: 'classifier-C4',
      classifierReleaseHash: 'c'.repeat(64),
      parserProfileId: 'parser-C4',
      parserProfileHash: 'd'.repeat(64),
      fingerprint: 'classification-C4',
    },
    package: {
      packageId: 'PKG-C4',
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: packageArtifact,
      contentHash: 'sha256:package-content-c4',
      semanticHash: 'sha256:semantic-c4',
      provenanceHash: 'sha256:provenance-c4',
      coverageHash: 'sha256:coverage-c4',
      resultStatus: 'complete',
      title: 'SB C4',
      contentUnitCount: 1,
      sourceRefCount: 1,
      readerReceiptId: 'reader-C4',
      usagePolicy: {
        presentationMode: 'ENGINEERING_DOCUMENT',
        qualityStatus: 'PASS',
        applicability: {
          sourceExpressionCount: 1,
          normalizedCandidateCount: 0,
          assignmentCount: 1,
        },
        assessmentAutoAdoptionAllowed: false,
        aeoAutoAdoptionAllowed: false,
        projectionSource: 'IMMUTABLE_PACKAGE_ACTUAL_BYTES',
      },
      fullValidatorProof: {},
    },
    translation: {
      schemaVersion: 'wiselink.3_1.translation_candidate_projection.v1',
      status: 'CANDIDATE_ONLY',
      currentness: 'CURRENT',
      staleReason: null,
      sourceResultId: 'translation-C4',
      actionAttemptId: 'ATT-TRANSLATE-C4',
      inputRevision: 6,
      documentId: 'DOC-C4',
      documentVersionId: 'DV-C4',
      sourcePackageId: 'PKG-C4',
      sourcePackageContentHash: 'sha256:package-content-c4',
      ruleSetId: 'wiselink.host.translation-rules.zh-cn.v1',
      ruleSetVersion: '1.0.0',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      sourceUnitCount: 1,
      translatedUnitCount: 1,
      pendingTranslationUnitCount: 0,
      sourceRefCount: 1,
      engineerRevisionCount: 0,
      validationVerdict: 'ACCEPTED',
      validationFindingCount: 0,
      artifact: bilingualArtifact,
    },
    failure: null,
    recordingFailure: null,
  };
  return {
    workItem,
    packageBytes,
    bilingualBytes,
    sourceUnits: [
      {
        unitId: 'UNIT-C4',
        kind: 'paragraph',
        text: 'Applicable to Boeing 737-8 airplanes.',
        sourceRefIds: ['SRC-C4'],
      },
    ],
    selection: {
      schemaVersion: 'wiselink.3_1.controlled_applicability_selection.v1',
      selectionRevision: 'selection-C4',
      currentness: 'CURRENT',
      documentVersionId: 'DV-C4',
      aircraftNumber: 'B-1234',
      assessmentAsOf: '2026-08-27',
      fleetMasterData: {
        schemaVersion: 'wiselink.v3_1.applicability_fleet.fleet_master_data.v1',
        sourceSnapshotId: 'fleet-snapshot-C4',
        sourceRevisionKey: 'fleet-revision-C4',
        authorityRevision: 'authority-C4',
        sourceAsOf: '2026-08-27',
        assets: [
          {
            assetId: 'ASSET-C4',
            assetVersionId: 'ASSET-V-C4',
            aircraftNumber: 'B-1234',
            aircraftModel: 'B737-8',
            sourceRef: {
              sourceTable: 'fleet_asset',
              sourceRecordId: 'asset-C4',
            },
            recordHash: 'asset-hash-C4',
          },
        ],
        facts: [],
      },
    },
  };
}

function resultFor(begin) {
  const candidate = candidateFor(begin.modelInput);
  return sealResultEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
    actionAttemptId: begin.task.actionAttemptId,
    operationRef: begin.task.operationRef,
    taskType: 'OPENCLAW_APPLICABILITY_EVALUATION',
    workItemId: begin.task.workItemId,
    baseRevision: begin.task.baseRevision,
    status: 'SUCCEEDED',
    businessOutcome: 'CANDIDATE_READY',
    candidateStatus: null,
    modelOutput: JSON.stringify(candidate),
    outputArtifactRefs: [],
    sourceRefs: structuredClone(begin.task.sourceRefs),
    factsConsidered: begin.modelInput.controlledFacts.map(
      (fact) => fact.factId,
    ),
    missingInputs: [],
    conflicts: [],
    warnings: [],
    modelVersion: APPLICABILITY_MODEL_VERSION,
    promptVersion: APPLICABILITY_PROMPT_VERSION,
    skillVersion: APPLICABILITY_SKILL_VERSION,
    toolVersions: {
      [APPLICABILITY_MCP_SERVER_NAME]: APPLICABILITY_MCP_SERVER_VERSION,
    },
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
    errorCode: null,
    errorDetail: null,
  });
}

function candidateFor(task) {
  return {
    schemaVersion: 'wiselink.3_1.applicability_candidate.v1',
    operation: 'EXTRACT_APPLICABILITY',
    candidateStatus: 'CANDIDATE',
    inputRevision: task.inputRevision,
    documentVersionRef: task.documentVersionRef,
    sourcePackage: structuredClone(task.sourcePackage),
    bilingualBinding: structuredClone(task.bilingualBinding),
    aircraft: structuredClone(task.aircraft),
    fleetBinding: structuredClone(task.fleetBinding),
    expressions: [
      {
        expressionId: 'EXP-C4',
        sourceRefIds: ['SRC-C4'],
        extractionStatus: 'extracted',
        expressionAst: {
          type: 'assert',
          property: 'model',
          operator: 'eq',
          value: 'A320',
        },
      },
    ],
    runtime: applicabilityRuntimePolicy(),
    authority: {
      candidateOnly: true,
      createsEvidenceRef: false,
      createsClosureDecision: false,
      createsActionReadiness: false,
      createsAirworthinessConclusion: false,
    },
  };
}

function artifact(ref, bytes) {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    mediaType: 'application/json',
  };
}
