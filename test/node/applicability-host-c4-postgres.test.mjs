import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
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

const databaseUrl = process.env.APPLICABILITY_C4_TEST_DATABASE_URL;

test(
  'R09 C4 real PostgreSQL producer -> begin -> commit uses existing WorkItem CAS and ActionAttempt lifecycle',
  { skip: !databaseUrl },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 8 });
    try {
      await resetDatabase(sql);
      const fixture = buildFixture();
      await seedWorkItem(sql, fixture.workItem);
      const db = drizzle(sql);
      const workItems = new MiaodaWorkItemRepository(db);
      const registrar = new MiaodaCanonicalWorkItemRegistrarAdapter(workItems);
      const attemptRepository = new ActionAttemptRepository(db);
      const attempts = new ActionAttemptLifecycleService(attemptRepository);
      const scope = serviceScope();
      const artifactStore = memoryArtifactStore(fixture.artifacts);
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
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

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

function memoryArtifactStore(initial) {
  const values = new Map(initial);
  let counter = 0;
  return {
    readActualBytes: async (artifact) => {
      const bytes = values.get(artifact.ref);
      if (!bytes) throw new Error('TEST_ARTIFACT_NOT_FOUND');
      return bytes.slice();
    },
    persistAndReadback: async (bytes) => {
      counter += 1;
      const ref = `artifact://c4/applicability-${counter}.json`;
      const copy = bytes.slice();
      values.set(ref, copy);
      return {
        artifact: artifact(ref, copy),
        bytes: copy.slice(),
        reused: false,
      };
    },
  };
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
    artifacts: [
      [packageArtifact.ref, packageBytes],
      [bilingualArtifact.ref, bilingualBytes],
    ],
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
