import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
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
  CanonicalTranslationKnowledgeProductService,
} = require('../../server/modules/canonical-host/canonical-translation-knowledge-product.service.ts');
const {
  HostOwnedV1TranslationRuleSetPrivateProvider,
} = require('../../server/modules/canonical-host/canonical-translation-rule-set-v1.private.ts');
const {
  MiaodaTranslationKnowledgeProductStore,
} = require('../../server/modules/canonical-host/miaoda-translation-knowledge-product.store.ts');

const databaseUrl = process.env.TRANSLATION_KNOWLEDGE_PHASE2_TEST_DATABASE_URL;

test(
  'R09 Phase2 real PostgreSQL keeps TM feedback candidate-only, scoped, idempotent and current',
  { skip: !databaseUrl, concurrency: false },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
    try {
      await resetDatabase(sql);
      const fixture = buildFixture();
      await seedDatabase(sql, fixture);
      const db = drizzle(sql);
      const store = new MiaodaTranslationKnowledgeProductStore(db);
      const clock = { value: '2026-08-30T12:00:00.000Z' };
      const projections = new Map([
        [scopeKey('tenant-1', 'WI-TM-1'), fixture.workItem],
        [scopeKey('tenant-1', 'WI-TM-OTHER'), fixture.otherWorkItem],
        [scopeKey('tenant-2', 'WI-TM-TENANT2'), fixture.crossTenantWorkItem],
      ]);
      const service = new CanonicalTranslationKnowledgeProductService(
        authorization(projections),
        permissionSnapshots(),
        registrar(projections),
        artifactStore(fixture),
        { nowIso: () => clock.value },
        store,
        new HostOwnedV1TranslationRuleSetPrivateProvider(),
      );
      const actor = hostActor('tenant-1', 'user:engineer-1');
      const request = {
        requestId: 'REQ-TM-IMPORT-1',
        expectedWorkItemRevision: 8,
        validFrom: '2026-08-01T00:00:00.000Z',
        expiresAt: '2026-09-30T00:00:00.000Z',
      };

      const created = await service.createCandidates('WI-TM-1', request, actor);
      assert.equal(created.createdCount, 4);
      assert.equal(created.reusedCount, 0);
      assert.equal(created.replayed, false);
      assert.equal(created.candidates.length, 4);
      assertCandidateOnly(created);
      const first = created.candidates[0];
      const second = created.candidates[1];
      const third = created.candidates[2];
      const fourth = created.candidates[3];
      assert.ok(first && second && third && fourth);
      assert.deepEqual(Object.keys(first.unit).sort(), [
        'engineerRevisionId',
        'kind',
        'sourceRefIds',
        'sourceText',
        'translatedText',
        'unitId',
      ]);
      assert.equal('sourceArtifact' in first, false);
      assert.equal('translationExecution' in first, false);
      assert.equal('ownerActorId' in first, false);

      const replayedImport = await service.createCandidates(
        'WI-TM-1',
        request,
        actor,
      );
      assert.equal(replayedImport.createdCount, 0);
      assert.equal(replayedImport.reusedCount, 4);
      assert.equal(replayedImport.replayed, true);
      assert.deepEqual(
        replayedImport.candidates.map((candidate) => candidate.assetId),
        created.candidates.map((candidate) => candidate.assetId),
      );
      assert.equal(
        Number(
          (
            await sql`SELECT count(*) AS count FROM translation_knowledge_candidate`
          )[0].count,
        ),
        4,
      );

      const beforeValidity = await service.readCandidate(
        'WI-TM-1',
        first.assetId,
        '2026-07-31T23:59:59.999Z',
        actor,
      );
      assert.equal(beforeValidity.validityStatus, 'NOT_YET_VALID');
      assert.equal(beforeValidity.retrievalEligibility, 'BLOCKED');
      clock.value = '2026-07-31T23:59:59.999Z';
      await assert.rejects(
        service.recordFeedback(
          'WI-TM-1',
          first.assetId,
          {
            requestId: 'REQ-TM-FEEDBACK-NOT-YET-VALID',
            expectedWorkItemRevision: 8,
            expectedGovernanceRevision: 0,
            decision: 'ADOPTED_AS_CANDIDATE_SUGGESTION',
            comment: 'Must not be recorded before the validity window.',
          },
          actor,
        ),
        /KNOWLEDGE_CANDIDATE_NOT_YET_VALID/u,
      );
      clock.value = '2026-08-30T12:00:00.000Z';

      const thirdAggregate = await store.readAggregate(
        'tenant-1',
        'WI-TM-1',
        third.assetId,
      );
      assert.ok(thirdAggregate);
      await assert.rejects(
        store.saveCandidate({
          ...thirdAggregate.candidate,
          assetId: 'TM-CROSS-ACTION-PROBE',
          translationExecution: {
            ...thirdAggregate.candidate.translationExecution,
            actionAttemptId: 'AA-TM-CROSS',
            resultContentHash: 'd'.repeat(64),
          },
          unit: {
            ...thirdAggregate.candidate.unit,
            unitId: 'UNIT-CROSS-ACTION-PROBE',
          },
        }),
        /KNOWLEDGE_ACTION_ATTEMPT_SCOPE_CONFLICT/u,
      );

      await assert.rejects(
        service.readCandidate(
          'WI-TM-1',
          first.assetId,
          clock.value,
          hostActor('tenant-2', 'user:engineer-1'),
        ),
        /CANONICAL_WORK_ITEM_NOT_FOUND/u,
      );
      await assert.rejects(
        service.readCandidate('WI-TM-OTHER', first.assetId, clock.value, actor),
        /KNOWLEDGE_CANDIDATE_NOT_FOUND/u,
      );

      const adoptionRequest = {
        requestId: 'REQ-TM-FEEDBACK-ADOPT-1',
        expectedWorkItemRevision: 8,
        expectedGovernanceRevision: 0,
        decision: 'ADOPTED_AS_CANDIDATE_SUGGESTION',
        comment: 'Engineer reviewed the exact bound source and translation.',
      };
      const adopted = await service.recordFeedback(
        'WI-TM-1',
        first.assetId,
        adoptionRequest,
        actor,
      );
      assert.equal(adopted.receipt.learningEventRecorded, true);
      assert.equal(adopted.receipt.candidateSuggestionAdopted, true);
      assert.equal(adopted.receipt.replayed, false);
      assert.equal(adopted.candidate.confirmationStatus, 'HUMAN_CONFIRMED');
      assert.equal(adopted.candidate.retrievalEligibility, 'SUGGESTION_ONLY');
      assertCandidateOnly(adopted.receipt);

      const replayedFeedback = await service.recordFeedback(
        'WI-TM-1',
        first.assetId,
        adoptionRequest,
        actor,
      );
      assert.equal(
        replayedFeedback.receipt.receiptId,
        adopted.receipt.receiptId,
      );
      assert.equal(replayedFeedback.receipt.replayed, true);
      assert.equal(
        Number(
          (
            await sql`SELECT count(*) AS count FROM translation_knowledge_governance_event WHERE request_id = 'REQ-TM-FEEDBACK-ADOPT-1'`
          )[0].count,
        ),
        1,
      );
      await assert.rejects(
        service.recordFeedback(
          'WI-TM-1',
          first.assetId,
          { ...adoptionRequest, decision: 'REJECTED' },
          actor,
        ),
        /KNOWLEDGE_REQUEST_ID_CONFLICT/u,
      );
      await assert.rejects(
        service.recordFeedback(
          'WI-TM-1',
          first.assetId,
          {
            ...adoptionRequest,
            requestId: 'REQ-TM-FEEDBACK-CAS-CONFLICT',
          },
          actor,
        ),
        /KNOWLEDGE_GOVERNANCE_CAS_CONFLICT/u,
      );

      const rejected = await service.recordFeedback(
        'WI-TM-1',
        second.assetId,
        {
          requestId: 'REQ-TM-FEEDBACK-REJECT-1',
          expectedWorkItemRevision: 8,
          expectedGovernanceRevision: 0,
          decision: 'REJECTED',
          comment: 'Engineer rejected this suggestion after source review.',
        },
        actor,
      );
      assert.equal(rejected.receipt.candidateSuggestionAdopted, false);
      assert.equal(rejected.candidate.confirmationStatus, 'HUMAN_REJECTED');
      assert.equal(rejected.candidate.retrievalEligibility, 'BLOCKED');
      assertCandidateOnly(rejected.receipt);
      assertCandidateOnly(rejected.candidate);

      const concurrentRequest = {
        requestId: 'REQ-TM-FEEDBACK-CONCURRENT-1',
        expectedWorkItemRevision: 8,
        expectedGovernanceRevision: 0,
        decision: 'ADOPTED_AS_CANDIDATE_SUGGESTION',
        comment:
          'One explicit engineer request must create one learning event.',
      };
      const concurrentReceipts = await Promise.all([
        service.recordFeedback(
          'WI-TM-1',
          fourth.assetId,
          concurrentRequest,
          actor,
        ),
        service.recordFeedback(
          'WI-TM-1',
          fourth.assetId,
          concurrentRequest,
          actor,
        ),
      ]);
      assert.equal(
        concurrentReceipts[0].receipt.receiptId,
        concurrentReceipts[1].receipt.receiptId,
      );
      assert.deepEqual(
        concurrentReceipts.map((result) => result.receipt.replayed).sort(),
        [false, true],
      );
      assert.equal(
        Number(
          (
            await sql`SELECT count(*) AS count FROM translation_knowledge_governance_event WHERE request_id = 'REQ-TM-FEEDBACK-CONCURRENT-1'`
          )[0].count,
        ),
        1,
      );

      const current = projections.get(scopeKey('tenant-1', 'WI-TM-1'));
      projections.set(scopeKey('tenant-1', 'WI-TM-1'), {
        ...current,
        source: { ...current.source, documentVersionId: 'DV-TM-DRIFT' },
      });
      const sourceDrift = await service.readCandidate(
        'WI-TM-1',
        third.assetId,
        clock.value,
        actor,
      );
      assert.equal(sourceDrift.sourceCurrentness, 'STALE');
      assert.equal(sourceDrift.retrievalEligibility, 'BLOCKED');
      await assert.rejects(
        service.recordFeedback(
          'WI-TM-1',
          third.assetId,
          {
            requestId: 'REQ-TM-FEEDBACK-SOURCE-DRIFT',
            expectedWorkItemRevision: 8,
            expectedGovernanceRevision: 0,
            decision: 'ADOPTED_AS_CANDIDATE_SUGGESTION',
            comment: 'Must not be recorded against a stale source.',
          },
          actor,
        ),
        /KNOWLEDGE_SOURCE_NOT_CURRENT/u,
      );
      projections.set(scopeKey('tenant-1', 'WI-TM-1'), current);

      clock.value = request.expiresAt;
      const expired = await service.readCandidate(
        'WI-TM-1',
        fourth.assetId,
        clock.value,
        actor,
      );
      assert.equal(expired.validityStatus, 'EXPIRED');
      assert.equal(expired.retrievalEligibility, 'BLOCKED');
      await assert.rejects(
        service.recordFeedback(
          'WI-TM-1',
          fourth.assetId,
          {
            requestId: 'REQ-TM-FEEDBACK-EXPIRED',
            expectedWorkItemRevision: 8,
            expectedGovernanceRevision: 0,
            decision: 'ADOPTED_AS_CANDIDATE_SUGGESTION',
            comment: 'Must not be recorded at the expiry boundary.',
          },
          actor,
        ),
        /KNOWLEDGE_CANDIDATE_EXPIRED/u,
      );

      clock.value = '2026-08-31T12:00:00.000Z';
      await sql`UPDATE work_item SET revision = 9 WHERE tenant_id = 'tenant-1' AND work_item_id = 'WI-TM-1'`;
      projections.set(scopeKey('tenant-1', 'WI-TM-1'), {
        ...current,
        revision: 9,
      });
      const revisionDrift = await service.readCandidate(
        'WI-TM-1',
        third.assetId,
        clock.value,
        actor,
      );
      assert.equal(revisionDrift.sourceCurrentness, 'STALE');
      assert.equal(revisionDrift.retrievalEligibility, 'BLOCKED');
      await assert.rejects(
        service.recordFeedback(
          'WI-TM-1',
          third.assetId,
          {
            requestId: 'REQ-TM-FEEDBACK-REVISION-DRIFT',
            expectedWorkItemRevision: 8,
            expectedGovernanceRevision: 0,
            decision: 'ADOPTED_AS_CANDIDATE_SUGGESTION',
            comment: 'Must not be recorded against an old WorkItem revision.',
          },
          actor,
        ),
        /KNOWLEDGE_WORK_ITEM_CAS_CONFLICT/u,
      );

      const oldCandidate = await store.readAggregate(
        'tenant-1',
        'WI-TM-1',
        third.assetId,
      );
      assert.ok(oldCandidate);
      await assert.rejects(
        store.saveCandidate({
          ...oldCandidate.candidate,
          assetId: 'TM-CAS-PROBE',
          unit: {
            ...oldCandidate.candidate.unit,
            unitId: 'UNIT-CAS-PROBE',
          },
        }),
        /KNOWLEDGE_WORK_ITEM_CAS_CONFLICT/u,
      );
      assert.equal(
        Number(
          (
            await sql`SELECT count(*) AS count FROM translation_knowledge_governance_event`
          )[0].count,
        ),
        3,
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

function assertSafeIsolatedDatabase(url) {
  const parsed = new URL(url);
  assert.match(
    parsed.pathname,
    /^\/wiselink_tm_phase2_test_[a-z0-9_]+$/u,
    'real PostgreSQL test requires a dedicated wiselink_tm_phase2_test_* database',
  );
  assert.ok(
    parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost',
    'real PostgreSQL test must remain local',
  );
}

async function resetDatabase(sql) {
  await sql.unsafe(`
    DROP TABLE IF EXISTS translation_knowledge_governance_event CASCADE;
    DROP TABLE IF EXISTS translation_knowledge_import_request_item CASCADE;
    DROP TABLE IF EXISTS translation_knowledge_source_ref CASCADE;
    DROP TABLE IF EXISTS translation_knowledge_candidate CASCADE;
    DROP FUNCTION IF EXISTS translation_knowledge_assert_current_work_item() CASCADE;
    DROP TABLE IF EXISTS action_attempt CASCADE;
    DROP TABLE IF EXISTS work_item CASCADE;
    CREATE TABLE work_item (
      work_item_id varchar(96) NOT NULL UNIQUE,
      tenant_id varchar(128) NOT NULL,
      revision integer NOT NULL
    );
    CREATE TABLE action_attempt (
      attempt_id varchar(96) NOT NULL UNIQUE,
      tenant_id varchar(128) NOT NULL,
      work_item_id varchar(96) NOT NULL,
      document_version_id varchar(96) NOT NULL,
      action_type varchar(64) NOT NULL,
      status varchar(64) NOT NULL,
      projection_applied boolean NOT NULL,
      result_content_hash varchar(64) NOT NULL
    );
  `);
  const role = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'service_role'`;
  assert.equal(role.length, 1, 'local PostgreSQL must expose service_role');
  const migration = await readFile(
    resolve(
      process.cwd(),
      'migrations/0015_translation_memory_knowledge_governance.sql',
    ),
    'utf8',
  );
  await sql.unsafe(migration);
}

async function seedDatabase(sql, fixture) {
  await sql`
    INSERT INTO work_item (work_item_id, tenant_id, revision)
    VALUES
      ('WI-TM-1', 'tenant-1', 8),
      ('WI-TM-OTHER', 'tenant-1', 8),
      ('WI-TM-TENANT2', 'tenant-2', 8)
  `;
  await sql`
    INSERT INTO action_attempt (
      attempt_id,
      tenant_id,
      work_item_id,
      document_version_id,
      action_type,
      status,
      projection_applied,
      result_content_hash
    )
    VALUES
      (
        ${fixture.artifact.execution.actionAttemptId},
        'tenant-1',
        'WI-TM-1',
        'DV-TM-1',
        'OPENCLAW_TRANSLATE',
        'SUCCEEDED',
        true,
        ${fixture.artifact.execution.resultContentHash}
      ),
      (
        'AA-TM-CROSS',
        'tenant-2',
        'WI-TM-TENANT2',
        'DV-TM-1',
        'OPENCLAW_TRANSLATE',
        'SUCCEEDED',
        true,
        ${'d'.repeat(64)}
      )
  `;
}

function buildFixture() {
  const binding = {
    documentId: 'DOC-TM-1',
    revisionId: 'DV-TM-1',
    sbdPackageId: 'PKG-TM-1',
    sbdContentHash: 'package-content-tm-1',
    tcpPackageId: null,
    tcpContentHash: null,
  };
  const artifact = {
    schemaVersion: 'wiselink.3_1.bilingual_translation_artifact.v1',
    candidateOnly: true,
    source: binding,
    ruleSet: {
      ruleSetId: 'wiselink.host.translation-rules.zh-cn.v1',
      ruleSetVersion: '1.0.0',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
    },
    units: [
      [
        'UNIT-TM-1',
        'WARNING airplane AIMS-2 P/N 123-ABC 5 kg.',
        '警告 飞机 AIMS-2 P/N 123-ABC 5 kg。',
      ],
      ['UNIT-TM-2', 'NOTE flight deck.', '注 驾驶舱。'],
      ['UNIT-TM-3', 'Check the source revision.', '检查来源修订。'],
      ['UNIT-TM-4', 'Keep this candidate time-bound.', '此候选受有效期约束。'],
    ].map(([unitId, sourceText, translatedText], index) => ({
      unitId,
      kind: index === 0 ? 'warning' : 'paragraph',
      sourceText,
      translatedText,
      sourceRefIds: [`SRC-TM-${index + 1}`],
      engineerRevisionId: null,
    })),
    validation: {
      schemaVersion: 'wiselink.3_1.translation_validation.v0.candidate',
      verdict: 'ACCEPTED',
      rulePackId: 'wiselink.host.translation-rules.zh-cn.v1',
      rulePackVersion: '1.0.0',
      findings: [],
      validatedUnitCount: 4,
    },
    execution: {
      actionAttemptId: 'AA-TM-1',
      operationRef: 'OP-TM-1',
      modelVersion: 'GLM-5.3',
      promptVersion: 'translation.prompt.v1',
      skillVersion: 'translation.skill.v1',
      toolVersions: { host: '1.0.0' },
      resultContentHash: 'b'.repeat(64),
    },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(artifact));
  const artifactDescriptor = {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref: 'artifact://translation/bilingual-tm-1.json',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    mediaType: 'application/json',
  };
  const workItem = workItemProjection(
    'tenant-1',
    'WI-TM-1',
    binding,
    artifactDescriptor,
    artifact,
  );
  return {
    artifact,
    bytes,
    artifactDescriptor,
    workItem,
    otherWorkItem: {
      ...workItem,
      workItemId: 'WI-TM-OTHER',
      requestId: 'REQ-TM-OTHER',
    },
    crossTenantWorkItem: {
      ...workItem,
      workItemId: 'WI-TM-TENANT2',
      requestId: 'REQ-TM-TENANT2',
    },
  };
}

function workItemProjection(
  _tenantId,
  workItemId,
  binding,
  artifactDescriptor,
  artifact,
) {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId,
    requestId: 'REQ-WI-TM-1',
    revision: 8,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-v1',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor-fingerprint-1',
      decisionId: 'decision-parse-1',
      decisionHash: 'decision-hash-1',
      permissionSnapshotVersion: 'permission-v1',
    },
    source: {
      documentId: binding.documentId,
      documentVersionId: binding.revisionId,
      parserRequestId: 'PARSER-REQ-TM-1',
      sourceArtifactId: 'SOURCE-ART-TM-1',
      sourceFileSha256: 'a'.repeat(64),
      sourceByteLength: 1024,
      driveFileToken: 'drive-file-tm-1',
      driveSourceVersion: 'drive-version-tm-1',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      classifierReleaseId: 'classifier-tm-1',
      classifierReleaseHash: 'classifier-hash-tm-1',
      parserProfileId: 'parser-profile-tm-1',
      parserProfileHash: 'parser-profile-hash-tm-1',
      fingerprint: 'classification-fingerprint-tm-1',
    },
    package: {
      packageId: binding.sbdPackageId,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: 'artifact://package/tm-1.json',
        sha256: 'c'.repeat(64),
        byteLength: 2048,
        mediaType: 'application/json',
      },
      contentHash: binding.sbdContentHash,
      semanticHash: 'semantic-tm-1',
      provenanceHash: 'provenance-tm-1',
      coverageHash: 'coverage-tm-1',
      resultStatus: 'complete',
      title: 'TM Phase2 source package',
      contentUnitCount: artifact.units.length,
      sourceRefCount: artifact.units.length,
      readerReceiptId: 'reader-receipt-tm-1',
      fullValidatorProof: {
        validatorId: 'U0Frozen2SchemaSemanticValidator',
        validatorRevision: 'validator-tm-1',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        artifactSha256: 'c'.repeat(64),
      },
    },
    translation: {
      schemaVersion: 'wiselink.3_1.translation_candidate_projection.v1',
      status: 'CANDIDATE_ONLY',
      currentness: 'CURRENT',
      staleReason: null,
      sourceResultId: 'RESULT-TM-1',
      actionAttemptId: artifact.execution.actionAttemptId,
      inputRevision: 7,
      documentId: binding.documentId,
      documentVersionId: binding.revisionId,
      sourcePackageId: binding.sbdPackageId,
      sourcePackageContentHash: binding.sbdContentHash,
      ruleSetId: artifact.ruleSet.ruleSetId,
      ruleSetVersion: artifact.ruleSet.ruleSetVersion,
      sourceLocale: artifact.ruleSet.sourceLocale,
      targetLocale: artifact.ruleSet.targetLocale,
      sourceUnitCount: artifact.units.length,
      translatedUnitCount: artifact.units.length,
      pendingTranslationUnitCount: 0,
      sourceRefCount: artifact.units.length,
      engineerRevisionCount: 0,
      validationVerdict: 'ACCEPTED',
      validationFindingCount: 0,
      artifact: artifactDescriptor,
    },
    failure: null,
    recordingFailure: null,
  };
}

function authorization(projections) {
  return {
    authorize: async ({ actor, action, workItemId }) => ({
      action,
      allowed: projections.has(scopeKey(actor.tenantId, workItemId)),
      actorFingerprint: `actor:${actor.userId}`,
      decisionId: `decision:${action}:${workItemId}`,
      decisionHash: `decision-hash:${action}:${workItemId}`,
      permissionSnapshotVersion: 'permission-v1',
    }),
  };
}

function permissionSnapshots() {
  return {
    freshRead: async () => ({ permissionSnapshotVersion: 'permission-v1' }),
  };
}

function registrar(projections) {
  return {
    getTenantScopedByWorkItemId: async ({ workItemId, tenantId }) => {
      const projection = projections.get(scopeKey(tenantId, workItemId));
      if (!projection) throw new Error('CANONICAL_WORK_ITEM_NOT_FOUND');
      return structuredClone(projection);
    },
  };
}

function artifactStore(fixture) {
  return {
    readActualBytes: async (descriptor) => {
      assert.deepEqual(descriptor, fixture.artifactDescriptor);
      return Uint8Array.from(fixture.bytes);
    },
  };
}

function hostActor(tenantId, userId) {
  return {
    userId,
    tenantId,
    appId: 'app-test',
    roles: ['engineer'],
    env: 'test',
  };
}

function scopeKey(tenantId, workItemId) {
  return `${tenantId}:${workItemId}`;
}

function assertCandidateOnly(value) {
  const authority = value.authority;
  assert.deepEqual(authority, {
    candidateOnly: true,
    activeTerminology: false,
    formalKnowledge: false,
    companyProcedureActivated: false,
    engineeringApproved: false,
    productionPublished: false,
    translationCurrentChanged: false,
    frequencyCreatesAuthority: false,
  });
}
