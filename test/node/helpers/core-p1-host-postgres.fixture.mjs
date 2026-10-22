// Synthetic source/precompleted applicability; actual Host authorization, RLS,
// WorkItem, ActionAttempt, SAVE, CAS and queue services on an owned loopback PG.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  postgresCapability,
  startOwnedPostgres,
} from '../../pg/owned-postgres-cluster.mjs';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { resetQ1Database, initialProjection } =
  await import('./q1-review-postgres.fixture.mjs');
const { drizzle } = require('drizzle-orm/postgres-js');
const { getTableConfig } = require('drizzle-orm/pg-core');
const {
  SqlExecutionContextMiddleware,
} = require('@lark-apaas/fullstack-nestjs-core');
const schema = require('../../../server/database/schema.ts');
const load = (path) => require(`../../../server/modules/${path}.ts`);
const { EngineeringMatterWorkingRepository } = load(
  'canonical-host/engineering-matter-working.repository',
);
const { EngineeringSearchProjectionWriter } = load(
  'canonical-host/engineering-search-projection',
);
const { JobAidWorkRepository } = load('canonical-host/jobaid-work.repository');
const { DialogueRepository } = load('canonical-host/dialogue.repository');
const { CanonicalModelSettingsService } = load(
  'model-settings/canonical-model-settings.service',
);
const { CanonicalModelSettingsRepository } = load(
  'model-settings/canonical-model-settings.repository',
);
const { ReviewConversationRepository } = load(
  'review-persistence/review-conversation.repository',
);
const { MiaodaWorkItemRepository } = load(
  'work-item/miaoda-work-item.repository',
);
const { MiaodaHostedCanonicalObjectAccessAdapter } = load(
  'work-item/miaoda-hosted-canonical-object-access.adapter',
);
const {
  OrdinaryCanonicalAuthorizationAdapter,
  OrdinaryCanonicalPermissionSnapshotAdapter,
} = load('canonical-host/ordinary-canonical-authorization.adapter');
const { EngineeringMatterRepository } = load(
  'canonical-host/engineering-matter.repository',
);
const { EngineeringMatterService } = load(
  'canonical-host/engineering-matter.service',
);
const { MatterActionAttemptService } = load(
  'canonical-host/matter-action-attempt.service',
);
const { registerMatterAttemptMcpTools } = load(
  'canonical-host/matter-attempt-mcp-tools',
);
const { MiaodaCanonicalWorkItemRegistrarAdapter } = load(
  'work-item/miaoda-canonical-work-item-registrar.adapter',
);
const { MiaodaDocumentVersionSourceResolver } = load(
  'work-item/miaoda-document-version-source.resolver',
);
const { ActionAttemptRepository } = load(
  'action-attempt/action-attempt.repository',
);
const { ActionAttemptLifecycleService } = load(
  'action-attempt/action-attempt-lifecycle.service',
);
const { ConfiguredDevelopmentCanonicalServiceScopeAuthorization } = load(
  'canonical-host/configured-development-service-scope.authorization',
);
const { MiaodaAutomaticWorkItemLeaseAuthorizationAdapter } = load(
  'canonical-host/miaoda-automatic-work-item-lease-authorization.adapter',
);
const { MiaodaAutomaticWorkItemSourceAuthorizationAdapter } = load(
  'canonical-host/miaoda-automatic-work-item-source-authorization.adapter',
);
const { OrdinaryDocumentManagementAuthorizer } = load(
  'document-management-runtime/ordinary-document-management-authorizer',
);
const { CanonicalJobAidProblemService } = load(
  'canonical-host/canonical-jobaid-problem.service',
);
const { CanonicalHostInitialAnalysisStatusService } = load(
  'canonical-host/canonical-host-initial-analysis-status.service',
);
const { CanonicalHostOpenClawAttemptStatusService } = load(
  'canonical-host/canonical-host-openclaw-attempt-status.service',
);
const { CanonicalHostOpenClawDynamicEvaluationService } = load(
  'canonical-host/canonical-host-openclaw-dynamic-evaluation.service',
);
const { CanonicalHostOpenClawOverallService } = load(
  'canonical-host/canonical-host-openclaw-overall.service',
);
const { CanonicalHostOpenClawReviewService } = load(
  'canonical-host/canonical-host-openclaw-review.service',
);
const { ReviewAttemptDispatchService } = load(
  'action-attempt/review-attempt-dispatch.service',
);
const { AutomaticWorkItemDispatchService } = load(
  'canonical-host/automatic-work-item-dispatch.service',
);
const { CanonicalHostCommonContextService, projectCommonAssessmentContext } =
  load('canonical-host/canonical-host-common-context.service');
const { canonicalJson, sealResultEnvelope, sealTaskEnvelope } = load(
  'action-attempt/action-attempt-envelope',
);
const {
  originalFixture,
} = require('../../unit/document-parsing/fixtures/document-original.fixture.ts');

function fixtureBrowserActor(userId, tenantId) {
  return {
    userId,
    tenantId,
    appId: 'app_17bzc551rsg',
    roles: [],
    env: 'runtime',
    objectAccessActor: {
      principalKind: 'FINAL_USER',
      transport: 'MIAODA_AUTHENTICATED_HTTP',
      canonicalSubject: { namespace: 'MIAODA_USER_ID', id: userId },
      subjectDecision: {
        source: 'MIAODA_GATEWAY_USER_CONTEXT',
        applicationScopeId: 'app_17bzc551rsg',
        tenantId,
        version: 'miaoda-hosted-native-sso.v1',
        decidedAt: '2026-10-16T00:00:00.000Z',
      },
      tenantId,
      applicationScopeId: 'app_17bzc551rsg',
      applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
      workspaceId: null,
      workspaceProvenance: 'UNAVAILABLE',
      env: 'runtime',
      platformRoles: [],
      identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
      feishuUserId: null,
      feishuOpenId: null,
      feishuIdentityProvenance: 'UNAVAILABLE',
      sessionId: null,
      sessionRevision: null,
      sessionProvenance: 'UNAVAILABLE',
    },
  };
}

export async function startCoreP1HostFixture({
  matter = false,
  browser = false,
  legacySemanticTasks = false,
} = {}) {
  const cluster = await startOwnedPostgres(await postgresCapability());
  const sql = cluster.admin;
  const files = await mkdtemp(join(tmpdir(), 'wiselink-core-p1-artifacts-'));
  const savedEnvironment = {};
  const OriginalDate = globalThis.Date;
  let clockOffset = 0;
  class HostTestDate extends OriginalDate {
    constructor(...args) {
      super(...(args.length ? args : [OriginalDate.now() + clockOffset]));
    }
    static now() {
      return OriginalDate.now() + clockOffset;
    }
  }
  globalThis.Date = HostTestDate;
  const environment = {
    WL_OPENCLAW_SERVICE_SCOPE_ENABLED: '1',
    WL_OPENCLAW_GATEWAY_AUTH_MODE: 'API_KEY',
    WL_OPENCLAW_SERVICE_SCOPE_ENV: 'DEV',
    WL_OPENCLAW_SERVICE_PRINCIPAL_ID: 'service:core-p1-test',
    WL_OPENCLAW_SERVICE_TENANT_ID: 'tenant-core-p1',
    WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED: '1',
    WL_JOBAID_PROBLEM_V2_ENABLED: '1',
    WL_OPENCLAW_SERVICE_WORK_ITEM_ID: undefined,
    WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS: undefined,
    ...(matter
      ? {
          WL_OPENCLAW_MATTER_SCOPE_ENABLED: '1',
          WL_OPENCLAW_SERVICE_MATTER_ACTOR_ID: 'actor-core-p1',
          WL_OPENCLAW_SERVICE_MATTER_IDS: undefined,
          WL_OPENCLAW_SERVICE_MATTER_ID: undefined,
        }
      : {}),
  };
  for (const [key, value] of Object.entries(environment)) {
    savedEnvironment[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await resetQ1Database(sql);
    // Q1 adds current columns mechanically; retain the production subject default
    // for WorkItem-only fixtures too (0034 otherwise runs only in Matter mode).
    await sql.unsafe("ALTER TABLE action_attempt ALTER COLUMN subject_kind SET DEFAULT 'WORK_ITEM'");
    // Existing personal-dialogue storage/policies, only in this owned cluster.
    // Aily is not invoked; its real table is required by contribution reads.
    await sql.unsafe('CREATE TABLE identity_session(id uuid PRIMARY KEY)');
    const ailyMigration = await readFile(
      new URL(
        '../../../migrations/0029_review_aily_user_delegation.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await sql.unsafe(
      ailyMigration.slice(
        ailyMigration.indexOf('CREATE TABLE review_aily_query'),
        ailyMigration.lastIndexOf('COMMIT;'),
      ),
    );
    await sql.unsafe(
      await readFile(
        new URL(
          '../../../migrations/0030_personal_dialogue.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    // Extend Q1's minimal source fixture with the real columns queried by the
    // ordinary SourceResolver. No production migration or endpoint is used.
    for (const table of [
      schema.dmDocumentVersion,
      schema.dmPublicationFamily,
      schema.dmAcquisition,
      schema.dmSourceArtifact,
      schema.dmIngressPreflight,
      schema.dmCurrentnessDecision,
      schema.translationWorkspace,
    ]) {
      const config = getTableConfig(table);
      await sql.unsafe(
        `CREATE TABLE IF NOT EXISTS "${config.name}" (fixture_placeholder boolean)`,
      );
      for (const column of config.columns)
        await sql.unsafe(
          `ALTER TABLE "${config.name}" ADD COLUMN IF NOT EXISTS "${column.name}" ${column.getSQLType()}`,
        );
    }
    for (const name of [
      '0062_auto_work_item_authorization.sql',
      '0063_auto_work_item_lease_ack.sql',
      '0064_auto_work_item_block_receipt.sql',
      '0065_auto_work_item_authenticated_intake.sql',
    ])
      await sql.unsafe(
        await readFile(
          new URL(`../../../migrations/${name}`, import.meta.url),
          'utf8',
        ),
      );
    if (matter) {
      // Q1 creates the current columns but omits Matter tables. Reuse the
      // existing Matter DDL/RLS in this same owned database; no platform DDL.
      await sql.unsafe(`CREATE UNIQUE INDEX core_p3_family_identity ON dm_publication_family(family_id);
        CREATE UNIQUE INDEX core_p3_document_identity ON dm_document_version(document_version_id)`);
      await sql.unsafe(
        await readFile(
          new URL(
            '../../../server/database/canonical-model-setting.ddl.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      for (const name of [
        '0014_engineering_matter_catalog.sql',
        '0032_engineering_matter_material.sql',
        '0033_engineering_matter_explicit_material_runtime.sql',
        '0023_engineering_matter_working_state.sql',
        '0024_engineering_matter_hosted_runtime_actor.sql',
        '0034_action_attempt_matter_subject.sql',
        '0035_engineering_matter_attempt_work.sql',
        '0036_matter_jobaid_save_before_finish.sql',
        '0037_matter_restrictive_policy_runtime_roles.sql',
        '0044_document_parse_step_lease.sql',
        '0048_document_translation_attempt_subject.sql',
        '0055_document_semantic_revision.sql',
      ]) {
        let ddl = await readFile(
          new URL(`../../../migrations/${name}`, import.meta.url),
          'utf8',
        );
        if (name === '0034_action_attempt_matter_subject.sql') {
          // The current schema already supplied these three columns. Retain
          // the original subject constraints, FK, triggers and RLS unchanged.
          ddl = ddl.replace(
            /ALTER TABLE action_attempt[\s\S]*?;/u,
            "ALTER TABLE action_attempt ALTER COLUMN subject_kind SET DEFAULT 'WORK_ITEM';",
          );
        }
        await sql.unsafe(ddl);
      }
      const nativeRead = await readFile(
        new URL(
          '../../../migrations/0078_native_tenant_shared_read.sql',
          import.meta.url,
        ),
        'utf8',
      );
      for (const name of [
        'native_app_shared_read_allowed',
        'native_app_work_item_readable',
        'native_app_document_readable',
        'native_app_matter_revision_readable',
      ]) {
        const definition = nativeRead.match(
          new RegExp(
            `CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$;`,
            'u',
          ),
        )?.[0];
        assert.ok(definition);
        // Same SQL admission/receipt predicates with this fixture's exact
        // authenticated ROLE, schema and synthetic tenant. Service calls still
        // use actor ownership; this does not admit the service ROLE as a browser.
        await sql.unsafe(
          definition
            .replaceAll(
              'authenticated_workspace_aadkpkjef3slu',
              'authenticated_wiselink_jobaid_test',
            )
            .replaceAll('workspace_aadkpkjef3slu', 'public')
            .replaceAll("'63849986'", "'tenant-core-p1'"),
        );
      }
    }
    await sql.unsafe(
      'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role,authenticated',
    );
    const login = `tdms_fixture_app_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    await sql.unsafe(
      `CREATE ROLE ${login} LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE service_role_wiselink_jobaid_test,authenticated_wiselink_jobaid_test`,
    );
    const appSql = await cluster.connect(login);
    const db = drizzle(appSql);
    const adminDb = drizzle(sql);
    const tenantId = 'tenant-core-p1',
      actorUserId = 'actor-core-p1';
    if (matter || browser)
      await appSql`SELECT set_config('app.user_id', ${actorUserId}, false)`;
    const sqlContext = new SqlExecutionContextMiddleware({
      roleSchema: 'wiselink_jobaid_test',
    });
    const hosted = (callback) =>
      new Promise((resolve, reject) =>
        sqlContext.use(
          { userContext: { userId: '-1', isSystemAccount: true, roles: [] } },
          {},
          () => Promise.resolve().then(callback).then(resolve, reject),
        ),
      );
    const projectionWriter = new EngineeringSearchProjectionWriter(db);
    const actors = new EngineeringMatterWorkingRepository(
      db,
      sqlContext,
      { roleSchema: 'wiselink_jobaid_test' },
      projectionWriter,
    );
    const work = new JobAidWorkRepository(db, actors, projectionWriter);
    const dialogues = new DialogueRepository(actors);
    const workItems = new MiaodaWorkItemRepository(db);
    const objectAccess = new MiaodaHostedCanonicalObjectAccessAdapter(
      workItems,
    );
    const registrar = new MiaodaCanonicalWorkItemRegistrarAdapter(workItems);
    const reviews = new ReviewConversationRepository(db);
    const attemptRepository = new ActionAttemptRepository(db);
    // Read/pin the actual persisted WorkItem model instead of the old stub.
    // This does not exercise tenant settings management or its manager RPC.
    const modelSettingsRepository = new CanonicalModelSettingsRepository(db);
    const modelSettings = new CanonicalModelSettingsService(
      modelSettingsRepository,
    );
    const attempts = new ActionAttemptLifecycleService(
      attemptRepository,
      modelSettings,
    );
    const sources = new MiaodaDocumentVersionSourceResolver(db);
    const ordinaryAuthorization = new OrdinaryDocumentManagementAuthorizer(
      workItems,
      undefined,
    );
    const sourceAuthorization =
      new MiaodaAutomaticWorkItemSourceAuthorizationAdapter(
        ordinaryAuthorization,
      );
    const leaseAuthorization =
      new MiaodaAutomaticWorkItemLeaseAuthorizationAdapter(
        workItems,
        sources,
        sourceAuthorization,
        reviews,
        attemptRepository,
      );
    const serviceScope =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization(
        leaseAuthorization,
        workItems,
      );
    const originals = new Map();
    // Only material/model input is synthetic. This reader verifies the real
    // ordinary source permission on every call before returning fixture bytes.
    const originalReader = {
      readDocumentOriginal: async (documentVersionId, parseRunId, scope) => {
        await ordinaryAuthorization.assertCanRead({
          ...scope,
          action: 'DOCUMENT_READ',
          documentVersionId,
        });
        const original = originals.get(parseRunId);
        assert.ok(
          original && original.binding.documentVersionId === documentVersionId,
        );
        return {
          original: structuredClone(original),
          structuredSource: structuredClone(original.source),
          run: {
            ...original.binding,
            manifestArtifact: {
              role: 'MANIFEST',
              readback: 'VERIFIED',
              relativePath: 'original/manifest.json',
              sha256: 'b'.repeat(64),
              byteLength: 100,
            },
          },
        };
      },
    };
    let nextArtifactHook;
    const artifactStore = {
      persistAndReadback: async (bytes) => {
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const hook = nextArtifactHook;
        nextArtifactHook = undefined;
        if (hook) await hook({ sha256, byteLength: bytes.byteLength });
        const path = join(files, sha256);
        await writeFile(path, bytes, { mode: 0o600 });
        const readback = await readFile(path);
        assert.equal(
          createHash('sha256').update(readback).digest('hex'),
          sha256,
        );
        return {
          artifact: {
            ref: `artifact://core-p1/${sha256}`,
            sha256,
            byteLength: bytes.byteLength,
            mediaType: 'application/json',
            storeRole: 'U0_PARSED_PACKAGE',
          },
        };
      },
    };
    const preparationReader = new CanonicalHostCommonContextService(
      reviews,
      workItems,
      artifactStore,
      undefined,
      undefined,
      dialogues,
    );
    const common = {
      readPreparationFacts: (input) =>
        preparationReader.readPreparationFacts(input),
      buildForWorkItemWithEvidence: async (item) => ({
        common: projectCommonAssessmentContext(
          item,
          {
            context: {
              status: 'UNAVAILABLE',
              reason: 'CONSTRUCTED_OFFLINE_SOURCE',
            },
            documentReadingStatus: 'AVAILABLE',
            items: [],
            sections: [],
            resourceRefs: [],
          },
          [],
        ),
        availableReadingEvidence: [],
      }),
    };
    const problem = new CanonicalJobAidProblemService(
      registrar,
      artifactStore,
      serviceScope,
      browser
        ? new OrdinaryCanonicalAuthorizationAdapter(objectAccess)
        : undefined,
      browser
        ? new OrdinaryCanonicalPermissionSnapshotAdapter(objectAccess)
        : undefined,
      attempts,
      workItems,
      reviews,
      common,
      work,
      undefined,
      originalReader,
      { read: async () => null },
      db,
      undefined,
      browser ? objectAccess : undefined,
    );
    // Reproduce a pre-upgrade sealed task without changing production task construction.
    const buildInput = problem.buildInput.bind(problem);
    problem.buildInput = async (...args) => {
      const input = await buildInput(...args);
      if (legacySemanticTasks) {
        delete input.contentValidationVersion;
        delete input.modelInput.contentValidationVersion;
        for (const evidence of [...input.sourceCatalog, ...input.modelInput.deliveredEvidence])
          if (evidence.kind === 'METHOD_CLAUSE') delete evidence.classificationDefinitions;
      }
      return input;
    };
    // One deterministic interleaving after the real preparation read. SAVE,
    // authorization, locks and CAS continue through their actual services.
    let nextPreparationHook;
    const currentPreparation = problem.currentPreparation.bind(problem);
    problem.currentPreparation = async (...args) => {
      const view = await currentPreparation(...args);
      const hook = nextPreparationHook;
      nextPreparationHook = undefined;
      if (hook) await hook(structuredClone(view));
      return view;
    };
    const initialStatus = new CanonicalHostInitialAnalysisStatusService(
      db,
      attempts,
      work,
      originalReader,
    );
    const attemptStatus = new CanonicalHostOpenClawAttemptStatusService(
      attempts,
      serviceScope,
    );
    const dynamic = new CanonicalHostOpenClawDynamicEvaluationService(
      registrar,
      artifactStore,
      undefined,
      undefined,
      undefined,
      attempts,
      undefined,
      serviceScope,
      sources,
      common,
      problem,
      initialStatus,
    );
    const overall = new CanonicalHostOpenClawOverallService(
      registrar,
      artifactStore,
      workItems,
      undefined,
      undefined,
      undefined,
      attempts,
      serviceScope,
      common,
      problem,
    );
    const reviewService = new CanonicalHostOpenClawReviewService(
      reviews,
      workItems,
      undefined,
      undefined,
      attempts,
      artifactStore,
      serviceScope,
      new ReviewAttemptDispatchService(
        attemptRepository,
        attempts,
        modelSettings,
      ),
      common,
      undefined,
      actors,
      problem,
    );
    const dispatch = new AutomaticWorkItemDispatchService(
      workItems,
      sources,
      serviceScope,
      sourceAuthorization,
      leaseAuthorization,
      initialStatus,
      reviews,
      work,
      attemptRepository,
      undefined,
      undefined,
      problem,
    );
    await sql`INSERT INTO identity_subject_mapping(miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
      VALUES(${actorUserId},${tenantId},'cli_aadde8b579f95bc9','ACTIVE')`;
    const hash = 'a'.repeat(64);
    await adminDb.insert(schema.dmPublicationFamily).values({
      id: randomUUID(),
      familyId: 'fam-core-p1',
      ...(browser
        ? { canonicalIdentityKey: 'tenant:tenant-core-p1:family:synthetic' }
        : {}),
      documentFamily: 'SB',
      currentDocumentVersionId: 'dv-job',
      currentGeneration: 1,
    });
    await adminDb.insert(schema.dmSourceArtifact).values({
      id: randomUUID(),
      sourceArtifactId: 'ART-TEST',
      sha256: hash,
      byteLength: 1234,
      readbackVerified: true,
    });
    await adminDb.insert(schema.dmAcquisition).values({
      id: randomUUID(),
      acquisitionId: 'acq-core-p1',
      documentVersionId: 'dv-job',
      sourceArtifactId: 'ART-TEST',
      acquiredBy: actorUserId,
      status: browser ? 'COMMITTED_CANONICAL' : 'COMMITTED',
      idempotencyKey: browser
        ? 'tenant:tenant-core-p1:request:core-p1'
        : 'core-p1',
    });
    await adminDb.insert(schema.dmDocumentVersion).values({
      id: randomUUID(),
      documentVersionId: 'dv-job',
      documentId: 'doc-job',
      familyId: 'fam-core-p1',
      sourceArtifactId: 'ART-TEST',
      acquisitionId: 'acq-core-p1',
      pdfSha256: hash,
      byteLength: 1234,
      lifecycleStatus: 'COMMITTED_IMMUTABLE',
      committedBy: actorUserId,
    });
    await adminDb.insert(schema.dmIngressPreflight).values({
      id: randomUUID(),
      acquisitionId: 'acq-core-p1',
      documentVersionId: 'dv-job',
      status: 'COMMITTED',
    });
    await adminDb.insert(schema.dmCurrentnessDecision).values({
      id: randomUUID(),
      familyId: 'fam-core-p1',
      nextDocumentVersionId: 'dv-job',
      nextGeneration: 1,
    });
    const original = originalFixture();
    original.binding.documentVersionId = 'dv-job';
    original.coverage = {
      knownPageCount: 2,
      readPageIndexes: [0, 1],
      unresolvedRanges: [],
    };
    originals.set(original.binding.parseRunId, original);
    await sql`INSERT INTO dm_document_parse_run(parse_run_id,document_version_id,tenant_id,actor_user_id,request_id,
      parse_revision,expected_published_revision,status,bucket_id,source_binding,manifest_artifact,deadline_at,completed_at)
      VALUES(${original.binding.parseRunId},'dv-job',${tenantId},${actorUserId},'parse-fixture',2,0,'PUBLISHED','fixture',
      ${JSON.stringify({ documentVersionId: 'dv-job', sourceArtifactId: 'ART-TEST', pdfSha256: hash, byteLength: 1234 })}::jsonb,
      ${JSON.stringify({ role: 'MANIFEST', readback: 'VERIFIED', relativePath: 'original/manifest.json' })}::jsonb,now()+interval '1 hour',now())`;

    const seed = async (workItemId = 'WI-core-p1', options = {}) => {
      const item = initialProjection(workItemId);
      item.package.contentHash = hash;
      // Constructed precondition only: P1 tests start after applicability.
      item.applicabilityInput = {
        currentness: 'CURRENT',
        workItemId,
        documentVersionId: 'dv-job',
        sourcePackageId: item.package.packageId,
        sourcePackageContentHash: hash,
        applicabilityContextRef: 'APP-FIXTURE',
        bindingRevision: 1,
        aircraftNumber: 'TEST',
        assessmentAsOf: '2026-10-15',
      };
      const appId = `ATT-app-${randomUUID()}`;
      item.applicability = {
        schemaVersion: 'wiselink.3_1.applicability_candidate_projection.v2',
        status: 'CANDIDATE_ONLY',
        currentness: 'CURRENT',
        documentVersionId: 'dv-job',
        sourcePackageId: item.package.packageId,
        sourcePackageContentHash: hash,
        applicabilityContextRef: 'APP-FIXTURE',
        applicabilityBindingRevision: 1,
        aircraftNumber: 'TEST',
        assessmentAsOf: '2026-10-15',
        sourceReadingMode: 'VERIFIED_ENGLISH',
        translationActionAttemptId: null,
        actionAttemptId: appId,
        decision: 'UNKNOWN',
        pass: true,
        blockingUnknownCount: 0,
        sourceExpressionCount: 0,
      };
      await adminDb.insert(schema.workItem).values({
        workItemId,
        tenantId,
        requestId: item.requestId,
        requestedByUserId: actorUserId,
        actionType: 'PARSE_PDF',
        runKey: 'canonical',
        status: item.phase,
        analysisModelJson: canonicalJson(
          options.executionModel ?? {
            modelRef: 'miaoda/minimax-m3',
            displayName: 'MiniMax-M3',
            providerKind: 'BUILT_IN',
            settingsRevision: 0,
            selectedAt: '2026-09-06T00:00:00.000Z',
          },
        ),
        documentId: 'doc-job',
        documentVersionId: 'dv-job',
        sourceArtifactId: 'ART-TEST',
        sourceFileSha256: hash,
        sourceByteLength: 1234,
        revision: 1,
        packageId: item.package.packageId,
        projectionJson: canonicalJson(item),
      });
      const task = sealTaskEnvelope({
        schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
        actionAttemptId: appId,
        operationRef: `AQ-${randomUUID().replaceAll('-', '')}`,
        taskType: 'OPENCLAW_APPLICABILITY_EVALUATION',
        priority: 50,
        tenantId,
        workItemId,
        inputRevision: 1,
        baseRevision: 1,
        documentVersionId: 'dv-job',
        sourceRefs: [],
        allowedConnectors: [],
        hostResolvedMissingInputs: [],
        modelInput: {
          modelInput: {
            documentOverview: { original: { binding: original.binding } },
          },
        },
        deadline: new Date(Date.now() + 3600000).toISOString(),
        idempotencyKey: `fixture-app-${workItemId}`,
      });
      await adminDb.insert(schema.actionAttempt).values({
        attemptId: appId,
        operationRef: task.operationRef,
        workItemId,
        tenantId,
        actionType: task.taskType,
        attemptNo: 1,
        requestOrigin: 'OPENCLAW_MCP_V1',
        status: 'SUCCEEDED',
        actorUserId,
        inputRevision: 1,
        baseRevision: 1,
        documentVersionId: 'dv-job',
        taskEnvelopeJson: canonicalJson(task),
        taskInputHash: task.inputHash,
        idempotencyKey: task.idempotencyKey,
        triggerRequestId: `REQ-${appId}`,
        claimCount: 1,
        retryCount: 0,
        leaseGeneration: 1,
        projectionApplied: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      });
      await sql`INSERT INTO auto_work_item_authorization(tenant_id,work_item_id,request_id,actor_user_id,document_id,
        document_version_id,source_artifact_id,source_file_sha256,source_byte_length,grant_kind,status)
        VALUES(${tenantId},${workItemId},${item.requestId},${actorUserId},'doc-job','dv-job','ART-TEST',${hash},1234,
        'MIAODA_CANONICAL_PARSE_REQUEST','WAITING')`;
      return item;
    };
    const readInitialStatus = (workItemId) =>
      hosted(async () => {
        const scope = await serviceScope.authorizeWorkItemRead({
          transport: 'READONLY_MCP',
          operation: 'READ_STATUS',
          workItemId,
        });
        const item = await registrar.getTenantScopedByWorkItemId({
          tenantId: scope.tenantId,
          workItemId,
        });
        return {
          workItemId,
          entry: { workItemId },
          integratedAssessmentSummary: item.integratedAssessment ?? null,
          revision: item.revision,
          initialAnalysis: await initialStatus.project({
            workItem: item,
            tenantId: scope.tenantId,
          }),
        };
      });
    const callTool = (name, args) =>
      hosted(async () => {
        const registered = matterTools.get(name);
        if (registered) {
          const result = await registered.handler(
            registered.inputSchema.parse(args),
          );
          assert.equal(result.isError, undefined);
          return JSON.parse(result.content[0].text);
        }
        switch (name) {
          case 'get_parse_status':
            return readInitialStatus(args.workItemId);
          case 'get_deep_link':
            await serviceScope.authorizeWorkItemRead({
              transport: 'READONLY_MCP',
              operation: 'READ_DEEP_LINK',
              workItemId: args.workItemId,
            });
            return {
              workItemId: args.workItemId,
              url:
                'https://constructed.invalid/work-item/' +
                encodeURIComponent(args.workItemId),
            };
          case 'begin_dynamic_evaluation':
            return dynamic.begin(args.workItemId, args.requestId);
          case 'begin_overall_synthesis':
            return overall.begin(
              args.workItemId,
              args.providers ?? [],
              args.requestId,
            );
          case 'save_assessment_work':
            return problem.saveWork(args);
          case 'read_assessment_work':
            return problem.readAttemptWork(
              args.attemptRef,
              args.requestId,
              args.workItemId,
            );
          case 'read_assessment_sources':
            return problem.readSources(args);
          case 'commit_dynamic_evaluation_candidate':
          case 'commit_dynamic_evaluation':
            return dynamic.commit(
              args.attemptRef,
              args.leaseToken,
              args.leaseGeneration,
              args.result ?? JSON.parse(args.resultJson),
              args.workItemId,
            );
          case 'commit_overall_candidate':
          case 'commit_overall_synthesis':
            return overall.commit(
              args.attemptRef,
              args.leaseToken,
              args.leaseGeneration,
              args.result ?? JSON.parse(args.resultJson),
              args.workItemId,
            );
          case 'get_action_attempt_status':
            return attemptStatus.status(args.attemptRef, args.workItemId);
          case 'heartbeat_action_attempt': {
            const scope = await serviceScope.authorizeOpenClawAttempt({
              operation: 'HEARTBEAT_ATTEMPT',
              ...args,
            });
            return attempts.heartbeat({
              ...args,
              tenantId: scope.tenantId,
              workItemId: scope.workItemId,
              principalId: scope.principalId,
              automaticLeaseRequired: !!scope.automaticWorkItemLease,
            });
          }
          case 'cancel_action_attempt': {
            const scope = await serviceScope.authorizeOpenClawAttempt({
              operation: 'CANCEL_ATTEMPT',
              ...args,
            });
            return attempts.requestCancel({
              ...args,
              tenantId: scope.tenantId,
              workItemId: scope.workItemId,
              automaticLeaseRequired: !!scope.automaticWorkItemLease,
            });
          }
          default:
            throw new Error(`CORE_P1_FIXTURE_TOOL_NOT_IMPLEMENTED:${name}`);
        }
      });
    const actor = fixtureBrowserActor(actorUserId, tenantId);
    const withBrowser = (callback) =>
      new Promise((resolve, reject) =>
        sqlContext.use(
          {
            userContext: {
              userId: actorUserId,
              isSystemAccount: false,
              roles: [],
            },
          },
          {},
          () => Promise.resolve().then(callback).then(resolve, reject),
        ),
      );
    const matterTools = new Map();
    const matterIds = new Set();
    const matterService = matter
      ? new EngineeringMatterService(
          new EngineeringMatterRepository(db),
          workItems,
          sources,
          objectAccess,
          actors,
        )
      : null;
    const matterAttempts = matter
      ? new MatterActionAttemptService(actors, modelSettings)
      : null;
    if (matter)
      registerMatterAttemptMcpTools(
        {
          registerTool(name, configuration, handler) {
            matterTools.set(name, { ...configuration, handler });
          },
        },
        matterAttempts,
        serviceScope,
        {
          async readDocumentSourcePagesForRuntime(
            documentVersionId,
            range,
            scope,
          ) {
            await ordinaryAuthorization.assertCanRead({
              ...scope,
              action: 'DOCUMENT_READ',
              documentVersionId,
            });
            const evidenceRef = `DOCUMENT_VERSION:${documentVersionId}:page:${range.pageStart}`;
            return {
              documentVersionId,
              sourceSha256: hash,
              sourceByteLength: 1234,
              pageCount: 1,
              extractionScope: 'NATIVE_TEXT_LAYER',
              pages: [
                {
                  page: range.pageStart,
                  sourceRefId: evidenceRef,
                  text: 'Synthetic original: the condition remains target-specific and unverified.',
                  textLayerStatus: 'PRESENT',
                  visualContentVerified: false,
                  evidence: {
                    kind: 'DOCUMENT_PASSAGE',
                    workItemId: null,
                    documentVersionId,
                    evidenceRef,
                    sourceRefId: evidenceRef,
                    title: 'Constructed original condition',
                    versionLabel: null,
                    locator: `Page ${range.pageStart}`,
                    excerpt:
                      'Synthetic original: the condition remains target-specific and unverified.',
                  },
                },
              ],
            };
          },
        },
        originalReader,
      );
    return {
      setSemanticContract(enabled) { legacySemanticTasks = !enabled; },
      sql,
      db,
      hosted,
      work,
      workItems,
      attempts,
      attemptRepository,
      dialogues,
      reviews,
      modelSettings,
      modelSettingsRepository,
      problem,
      reviewService,
      dispatch,
      serviceScope,
      tenantId,
      actorUserId,
      actor,
      withBrowser,
      matterAttempts,
      async seedMatter(
        workItemId,
        requestId = `fixture-matter-${randomUUID()}`,
      ) {
        assert.ok(matterService, 'explicit Matter fixture option required');
        await sql`INSERT INTO canonical_model_setting(tenant_id,revision,model_ref,changed_by_user_id)
          VALUES(${tenantId},1,'miaoda/glm-5.3',${actorUserId}) ON CONFLICT(tenant_id)
          DO UPDATE SET revision=EXCLUDED.revision,model_ref=EXCLUDED.model_ref`;
        const created = await withBrowser(() =>
          matterService.create(
            {
              requestId,
              title: `Synthetic isolated ${requestId}`,
              primaryWorkItemId: workItemId,
            },
            actor,
          ),
        );
        matterIds.add(created.matter.matterId);
        process.env.WL_OPENCLAW_SERVICE_MATTER_IDS = JSON.stringify([
          ...matterIds,
        ]);
        return created;
      },
      original: structuredClone(original),
      seed,
      async seedEngineerContribution({
        workItemId,
        text,
        kind = 'CORRECTION',
      }) {
        return hosted(async () => {
          const scope = { tenantId, actorId: actorUserId };
          const thread = await dialogues.create(
            scope,
            `fixture-thread-${randomUUID()}`,
            [workItemId],
          );
          const { message } = await dialogues.append(scope, {
            threadRef: thread.thread_ref,
            requestKey: `fixture-message-${randomUUID()}`,
            expectedRevision: thread.revision,
            userText: text,
            origin: 'HOST',
            originDetails: {},
            focusIds: [workItemId],
            purpose: 'CONTRIBUTION_ONLY',
            context: {
              generationQuery: text,
              contextWorkItemIds: [workItemId],
              focus: [],
              historyMessageRefs: [],
              earlierMessagesOmitted: false,
            },
          });
          const contribution = await dialogues.saveContribution(scope, {
            threadRef: thread.thread_ref,
            requestKey: `fixture-contribution-${randomUUID()}`,
            expectedRevision: message.thread_revision,
            messageRef: message.message_ref,
            sourcePart: 'USER',
            selection: { start: 0, end: text.length },
            workItemId,
            kind,
          });
          return { thread, message, contribution };
        });
      },
      async withReviewScope(workItemId, callback) {
        // Existing manual Review scope for one exact owned fixture WorkItem.
        // Restored before any queue/consumer work; no authority is mocked.
        const previous = process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID;
        process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID = workItemId;
        try {
          return await hosted(() =>
            work.withActorScope(actorUserId, () => callback(reviewService)),
          );
        } finally {
          if (previous === undefined)
            delete process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID;
          else process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID = previous;
        }
      },
      async seedReviewTurn({
        workItemId,
        text,
        targetIssueKeys,
        purpose = 'CHAT',
      }) {
        return new Promise((resolve, reject) =>
          sqlContext.use(
            {
              userContext: {
                userId: actorUserId,
                isSystemAccount: false,
                roles: [],
              },
            },
            {},
            () =>
              Promise.resolve()
                .then(async () => {
                  const current = await registrar.getTenantScopedByWorkItemId({
                    tenantId,
                    workItemId,
                  });
                  const { aggregate } = await reviews.createOrResume({
                    tenantId,
                    actorId: actorUserId,
                    workItemId,
                    currentRevision: current.revision,
                  });
                  const { turn } = await reviews.appendTextTurn({
                    conversation: aggregate.conversation,
                    requestId: `fixture-turn-${randomUUID()}`,
                    userMessage: text,
                    currentRevision: current.revision,
                    targetIssueKeys,
                    purpose,
                  });
                  return turn;
                })
                .then(resolve, reject),
          ),
        );
      },
      callTool,
      readInitialStatus,
      nextWorkItem: (body) => hosted(() => dispatch.nextWorkItem(body)),
      acknowledgeWorkItem: (body) =>
        hosted(() => dispatch.acknowledgeWorkItem(body)),
      async advance(milliseconds = 7200000) {
        clockOffset += milliseconds;
        return { offsetMs: clockOffset, hostNow: new Date().toISOString() };
      },
      async readArtifact(artifact) {
        assert.match(artifact.sha256, /^[a-f0-9]{64}$/u);
        assert.equal(artifact.ref, `artifact://core-p1/${artifact.sha256}`);
        const bytes = await readFile(join(files, artifact.sha256));
        assert.equal(bytes.byteLength, artifact.byteLength);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
        return JSON.parse(bytes.toString('utf8'));
      },
      readBrowserSnapshot: (workItemId) => hosted(() => actors.withActorScope(actorUserId,
        () => work.readBrowserSnapshot({
          tenantId, workItemId, documentVersionId: original.binding.documentVersionId,
        }))),
      armArtifactPersistHook(callback) {
        assert.equal(nextArtifactHook, undefined);
        nextArtifactHook = callback;
      },
      armPreparationReadHook(callback) {
        assert.equal(nextPreparationHook, undefined);
        nextPreparationHook = callback;
      },
      async reserveInitial({
        workItemId,
        requestId = randomUUID(),
        deadlineMs = 5000,
      }) {
        return hosted(async () => {
          const scope = await serviceScope.authorizeOpenClawWorkItem({
            operation: 'BEGIN_DYNAMIC',
            workItemId,
          });
          const current = await registrar.getTenantScopedByWorkItemId({
            tenantId: scope.tenantId,
            workItemId,
          });
          const original = await problem.readOriginalContinuationBinding(
            current,
            scope,
          );
          const { buildInitialAnalysisRequestInput } = load(
            'action-attempt/initial-analysis-request',
          );
          const receipt = await attempts.reserve({
            tenantId: scope.tenantId,
            workItemId,
            taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
            actorUserId: 'service:openclaw-main',
            documentVersionId: current.source.documentVersionId,
            inputRevision: current.revision,
            baseRevision: current.revision,
            idempotencyKey: `openclaw-v2:dynamic:${workItemId}:${current.source.documentVersionId}:${requestId}`,
            deadlineAt: new Date(Date.now() + deadlineMs),
            sourceRefs: [
              {
                ref: current.source.sourceArtifactId,
                sha256: current.source.sourceFileSha256,
              },
            ],
            allowedConnectors: [],
            buildModelInput: async () =>
              buildInitialAnalysisRequestInput({
                taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
                requestId,
                originalParseRunId: original.parseRunId,
              }),
          });
          return { requestId, attemptRef: receipt.task.operationRef };
        });
      },
      async snapshot() {
        return {
          work: await sql`SELECT * FROM assessment_work_revision ORDER BY work_revision`,
          attempts:
            await sql`SELECT * FROM action_attempt ORDER BY created_at,attempt_no`,
          grants:
            await sql`SELECT * FROM auto_work_item_authorization ORDER BY work_item_id`,
          workItems: await sql`SELECT * FROM work_item ORDER BY work_item_id`,
          ...(matter
            ? {
                matters:
                  await sql`SELECT * FROM engineering_matter ORDER BY matter_id`,
                matterWork:
                  await sql`SELECT * FROM engineering_matter_work_revision ORDER BY matter_id,working_revision`,
              }
            : {}),
        };
      },
      roleEvidence: () =>
        hosted(() =>
          db.execute(require('drizzle-orm')
            .sql`SELECT session_user,current_user,
        (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,
        (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypassrls,
        (SELECT tableowner FROM pg_tables WHERE tablename='assessment_work_revision') AS table_owner`),
        ),
      async correctInput(workItemId) {
        return hosted(async () => {
          const current = await registrar.getTenantScopedByWorkItemId({
            tenantId,
            workItemId,
          });
          const { revision, ...next } = current;
          return registrar.compareAndSet({
            workItemId,
            expectedRevision: revision,
            syncPrimaryAttempt: false,
            next: {
              ...next,
              permissionSnapshotVersion: `corrected-${revision}`,
            },
          });
        });
      },
      async correctSource(workItemId) {
        return hosted(async () => {
          const current = await registrar.getTenantScopedByWorkItemId({
            tenantId,
            workItemId,
          });
          const { revision, ...next } = current;
          return registrar.compareAndSet({
            workItemId,
            expectedRevision: revision,
            syncPrimaryAttempt: false,
            next: {
              ...next,
              source: { ...next.source, sourceFileSha256: 'c'.repeat(64) },
            },
          });
        });
      },
      async revokeActor() {
        await sql`UPDATE identity_subject_mapping SET status='REVOKED' WHERE miaoda_user_id=${actorUserId}`;
      },
      proposal(claim, completion = 'COMPLETE') {
        const source = claim.task.modelInput.sourceCatalog.find(
          (item) => item.kind === 'DOCUMENT_PASSAGE',
        );
        return {
          schemaVersion: 'wiselink.jobaid-problem-work.v3',
          headline: '条件与限制',
          listBrief: '保留原文限制。',
          overview: `保留完整前提 [[${source.evidenceRef}]]`,
          roundCompletion: completion,
          completionReason: '构造材料的本轮分析已保存。',
          changeSummary: '保存原文条件。',
          issues: [
            {
              issueKey: 'condition',
              question: '原文条件是什么？',
              body: `保留原文条件与例外 [[${source.evidenceRef}]]`,
            },
          ],
          unchangedIssueKeys: [],
          retiredIssues: [],
        };
      },
      result(claim, workRevisionRef, consistencyCheck) {
        const marker = claim.task.modelInput.savedWorkReconciliation;
        return sealResultEnvelope({
          schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
          actionAttemptId: claim.task.actionAttemptId,
          operationRef: claim.attemptRef,
          taskType: claim.task.taskType,
          workItemId: claim.task.workItemId,
          baseRevision: claim.task.baseRevision,
          status: 'SUCCEEDED',
          businessOutcome: 'CANDIDATE_READY',
          candidateStatus: null,
          modelOutput: canonicalJson({
            workRevisionRef,
            ...(consistencyCheck ? { consistencyCheck } : {}),
          }),
          sourceRefs: claim.task.sourceRefs,
          outputArtifactRefs: [],
          factsConsidered: [],
          missingInputs: [],
          conflicts: [],
          warnings: [],
          modelVersion: marker ? null : 'constructed-fake-model',
          promptVersion: claim.task.modelInput.schemaVersion.endsWith('.v3')
            ? 'wiselink-jobaid-problem@v3'
            : 'wiselink-jobaid-problem@v2',
          skillVersion: 'wiselink-research-and-synthesize@r09.c205',
          toolVersions: {
            'wiselink-openclaw-engineering-assessment': '1.2.0',
            'jobaid-problem-protocol':
              claim.task.modelInput.schemaVersion.endsWith('.v3') ? '3' : '2',
            ...(marker ? { 'host-saved-work-reconciliation': '1' } : {}),
          },
          runMetrics: { durationMs: 0, inputUnits: 0, outputUnits: 0 },
          errorCode: null,
          errorDetail: null,
          ...(marker
            ? {
                executionKind: 'HOST_SAVED_WORK_RECONCILIATION',
                modelRequests: 0,
                sourceWork: {
                  workRevisionRef,
                  sourceActionAttemptId: marker.sourceActionAttemptId,
                },
              }
            : {}),
        });
      },
      ownership: {
        root: cluster.root,
        data: cluster.data,
        instance: cluster.instance,
        database: cluster.expected.database,
        applicationLogin: login,
        constructedPreconditions: [
          'source material',
          'previous applicability projection',
        ],
      },
      async close() {
        globalThis.Date = OriginalDate;
        for (const [key, value] of Object.entries(savedEnvironment)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        await cluster.stop();
        await rm(files, { recursive: true, force: true });
      },
    };
  } catch (error) {
    globalThis.Date = OriginalDate;
    await cluster.stop();
    await rm(files, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    throw error;
  }
}
