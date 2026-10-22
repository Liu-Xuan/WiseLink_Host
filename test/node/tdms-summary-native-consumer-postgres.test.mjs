import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  postgresCapability,
  startOwnedPostgres,
} from '../pg/owned-postgres-cluster.mjs';
process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { seedReceivers, seedNative } =
  await import('./helpers/tdms-saved-native-postgres.fixture.mjs');
const { drizzle } = require('drizzle-orm/postgres-js'),
  { getTableConfig } = require('drizzle-orm/pg-core');
const schema = require('../../server/database/schema.ts'),
  summarySchema = require('../../server/database/derived-summary.schema.ts');
const {
  dmDocumentParseRun,
} = require('../../server/database/document-parsing.schema.ts');
const { sql } = require('drizzle-orm');
const {
  SqlExecutionContextMiddleware,
} = require('@lark-apaas/fullstack-nestjs-core');
const {
  EngineeringMatterWorkingRepository,
} = require('../../server/modules/canonical-host/engineering-matter-working.repository.ts');
const {
  JobAidWorkRepository,
} = require('../../server/modules/canonical-host/jobaid-work.repository.ts');
const {
  CanonicalJobAidProblemService,
} = require('../../server/modules/canonical-host/canonical-jobaid-problem.service.ts');
const {
  ReviewConversationRepository,
} = require('../../server/modules/review-persistence/review-conversation.repository.ts');
const {
  DerivedSummaryMembersService,
} = require('../../server/modules/canonical-host/derived-summary-members.service.ts');
const {
  DerivedSummaryRepository,
} = require('../../server/modules/canonical-host/derived-summary.repository.ts');
const {
  DerivedSummaryService,
} = require('../../server/modules/canonical-host/derived-summary.service.ts');
const {
  DerivedSummaryRuntimeService,
} = require('../../server/modules/canonical-host/derived-summary-runtime.service.ts');
const {
  TdmsBrowserNativeVerifier,
} = require('../../server/modules/tdms-source/tdms-browser-native-verifier.ts');
const {
  TdmsRetainedRuntimeFacts,
} = require('../../server/modules/tdms-source/tdms-retained-runtime-facts.ts');
const {
  MiaodaHostedCanonicalObjectAccessAdapter,
} = require('../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter.ts');
const {
  MiaodaWorkItemRepository,
} = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const {
  ConfiguredDevelopmentCanonicalServiceScopeAuthorization,
} = require('../../server/modules/canonical-host/configured-development-service-scope.authorization.ts');
const {
  canonicalJson,
  canonicalSha256,
} = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const {
  taskModelSelection,
} = require('../../server/modules/model-settings/canonical-model-catalog.ts');
const {
  JOBAID_METHOD_BINDING,
} = require('../../server/modules/canonical-host/jobaid-method-pack.ts');
const {
  findDocumentOriginalEvidence,
} = require('../../server/modules/canonical-host/document-original-engineering-reading.ts');
const {
  originalFixture,
} = require('../unit/document-parsing/fixtures/document-original.fixture.ts');
const {
  tdmsRuntimeFixture,
} = require('../unit/fixtures/tdms-runtime.fixture.ts');
const APP = 'app_17bzc551rsg',
  SCHEMA = 'workspace_aadkpkjef3slu',
  CLIENT = 'cli_aadde8b579f95bc9';
const role = 'service_role_' + SCHEMA,
  browserRole = 'authenticated_' + SCHEMA;
const config = {
  WL_OPENCLAW_SERVICE_SCOPE_ENABLED: '1',
  WL_OPENCLAW_GATEWAY_AUTH_MODE: 'API_KEY',
  WL_OPENCLAW_SERVICE_SCOPE_ENV: 'DEV',
  WL_OPENCLAW_SERVICE_PRINCIPAL_ID: 'service:summary-test',
  WL_OPENCLAW_SERVICE_TENANT_ID: 'tenant-a',
  WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED: '1',
};

test(
  'actual Summary and JobAid consumers preserve genuine native caller across claim, original IO, SAVE, finish and terminal read',
  { timeout: 60000 },
  async (t) => {
    const capability = await postgresCapability();
    assert.equal(capability.available, true, capability.reason);
    const owned = await startOwnedPostgres(capability),
      previous = Object.fromEntries(
        Object.keys(config).map((k) => [k, process.env[k]]),
      );
    Object.assign(process.env, config);
    try {
      const admin = owned.admin,
        login =
          'tdms_fixture_app_' + randomUUID().replaceAll('-', '').slice(0, 16);
      await admin.unsafe(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE ${browserRole} NOLOGIN NOSUPERUSER NOBYPASSRLS;
   CREATE ROLE ${login} LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE ${role},${browserRole}; CREATE SCHEMA ${SCHEMA};
   SET search_path TO ${SCHEMA},pg_catalog; CREATE TYPE user_profile AS(user_id text); GRANT USAGE ON SCHEMA ${SCHEMA} TO ${role},${browserRole}`);
      for (const table of [
        schema.workItem,
        schema.actionAttempt,
        schema.assessmentWorkRevision,
        schema.identitySubjectMapping,
        schema.dmDocumentVersion,
        schema.dmPublicationFamily,
        schema.dmSourceArtifact,
        schema.dmAcquisition,
        schema.dmIngressPreflight,
        dmDocumentParseRun,
        summarySchema.derivedSummary,
        summarySchema.derivedSummaryRevision,
      ]) {
        const c = getTableConfig(table);
        await admin.unsafe(
          `CREATE TABLE ${c.name} (${c.columns.map((v) => `"${v.name}" ${v.getSQLType()}`).join(',')})`,
        );
      }
      for (const file of [
        'tdms-source-rebuild-v1.draft.sql',
        'tdms-processing-set-v1.draft.sql',
      ])
        await admin.unsafe(
          await readFile(
            new URL('../../server/database/' + file, import.meta.url),
            'utf8',
          ),
        );
      await seedReceivers(admin);
      await admin.unsafe(`ALTER TABLE action_attempt ADD COLUMN summary_request_command_json text;
   CREATE TABLE dm_document_semantic_revision(tenant_id text,document_version_id text,parse_run_id text,parse_revision integer,semantic_revision integer);
   CREATE FUNCTION engineering_matter_work_item_owned_by_actor(t text,w varchar) RETURNS boolean LANGUAGE SQL SECURITY INVOKER AS $$
    SELECT EXISTS(SELECT 1 FROM work_item WHERE tenant_id=t AND work_item_id=w AND requested_by_user_id=current_setting('app.user_id',true)) $$;
   CREATE FUNCTION engineering_matter_document_owned_by_actor(t text,d varchar) RETURNS boolean LANGUAGE SQL SECURITY INVOKER AS $$
    SELECT EXISTS(SELECT 1 FROM work_item WHERE tenant_id=t AND document_version_id=d AND requested_by_user_id=current_setting('app.user_id',true)) $$;
   CREATE FUNCTION derived_summary_runtime_actor(t text,s text,a text,p text) RETURNS text LANGUAGE SQL SECURITY INVOKER AS $$
    SELECT x.actor_user_id FROM action_attempt x JOIN derived_summary h ON h.summary_id=x.summary_id AND h.tenant_id=x.tenant_id
    WHERE x.tenant_id=t AND x.summary_id=s AND x.operation_ref=a AND x.summary_delegated_principal_id=p AND h.actor_user_id=x.actor_user_id
    AND current_user='${role}' $$;
   GRANT SELECT,UPDATE,INSERT ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${role},${browserRole}`);
      for (const table of [
        'tdms_record_revision',
        'tdms_relation_assertion',
        'tdms_processing_revision_set',
        'tdms_processing_set_head',
        'tdms_capture',
        'tdms_read_receipt',
      ])
        await admin.unsafe(
          `CREATE POLICY fixture_scope ON ${table} TO ${role},${browserRole} USING(tenant_id='tenant-a' AND current_setting('app.user_id',true)='user-a')`,
        );
      const client = await owned.connect(login);
      await client.unsafe(
        `SET search_path TO ${SCHEMA},pg_catalog; SET ROLE ${browserRole}`,
      );
      await client`SELECT set_config('app.user_id','user-a',false)`;
      const database = drizzle(client),
        adminDb = drizzle(admin),
        f = tdmsRuntimeFixture(),
        { binding } = f;
      const actor = {
        ...f.actor,
        applicationScopeId: APP,
        subjectDecision: {
          ...f.actor.subjectDecision,
          applicationScopeId: APP,
          version: 'miaoda-hosted-native-sso.v1',
        },
      };
      const host = {
        userId: binding.actorUserId,
        tenantId: binding.tenantId,
        appId: APP,
        objectAccessActor: actor,
      };
      const authority =
          new ConfiguredDevelopmentCanonicalServiceScopeAuthorization(),
        scope = await authority.authorizeOpenClawAutoWorkItemQueue();
      const profile = {
        current: () => ({ tenantId: binding.tenantId, clientId: CLIENT }),
      };
      const objectAccess = new MiaodaHostedCanonicalObjectAccessAdapter(
        new MiaodaWorkItemRepository(database),
      );
      const native = new TdmsBrowserNativeVerifier(
          authority,
          profile,
          objectAccess,
        ),
        retained = new TdmsRetainedRuntimeFacts();
      const productionFacts = native.facts;
      // Only this test supplies constructed ACTIVE facts to reach downstream release.
  // The unmodified retained provider must reject UNKNOWN and roll claim back.
  const constructedActiveFacts = {
        resolveSelections: (input) => retained.resolveSelections(input),
        readProjectionFacts: async () => structuredClone(f.facts),
      };
      native.facts = constructedActiveFacts;
      const nativeCalls = [];
      const verifier = {
        assertInTransaction: async (input) => {
          nativeCalls.push({
            caller: structuredClone(input.summaryCaller),
            evidenceRefs: input.evidence.map((e) => e.evidenceRef),
          });
          return native.assertInTransaction(input);
        },
        authorize: () => {
          throw new Error('ROOT_POOL_NATIVE_IO_FORBIDDEN');
        },
        readExactEvidence: () => {
          throw new Error('ROOT_POOL_NATIVE_IO_FORBIDDEN');
        },
        assertCurrentEvidence: () => {
          throw new Error('ROOT_POOL_NATIVE_IO_FORBIDDEN');
        },
      };
      const context = await f.adapter.discover(f.principal, binding);
      const evidence = (
        await f.adapter.read(f.principal, {
          context,
          evidenceRefs: [context.projection.selectedSetApprovedRefs[0]],
          purpose: 'JOB_AID_NATIVE_RECORD',
          taskContextRef: binding.taskContextRef,
        })
      ).evidence[0];
      await seedNative(admin, adminDb, f, context, evidence);
      const original = originalFixture();
      original.binding.documentVersionId = binding.documentVersionId;
      const loaded = {
        original,
        structuredSource: original.source,
        run: {
          documentVersionId: binding.documentVersionId,
          parseRunId: original.binding.parseRunId,
          parseRevision: original.binding.parseRevision,
          manifestArtifact: {
            relativePath: 'original/manifest.json',
            readback: 'VERIFIED',
            sha256: 'e'.repeat(64),
            byteLength: 1234,
          },
        },
      };
      const originalEvidence = {
        ...findDocumentOriginalEvidence(loaded, 'SR-TEST-P1'),
        workItemId: binding.workItemId,
      };
      const content = {
        schemaVersion: 'wiselink.jobaid-problem-work.v3',
        headline: 'Exact saved native work',
        listBrief: 'Constructed candidate',
        understanding: 'Complete selected work',
        decisiveIssueKeys: [],
        overviewStatus: 'CURRENT',
        issues: [],
        roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
        completionReason: 'Uncertainty retained',
        changeSummary: 'Constructed test',
        unchangedExplanation: '',
        methodBinding: JOBAID_METHOD_BINDING,
        evidence: [evidence, originalEvidence],
        readSourceRefs: [evidence.evidenceRef, originalEvidence.evidenceRef],
        capabilities: [],
        historyReview: {
          required: false,
          priorAssessmentRefs: [],
          engineeringDocumentRefs: [],
          coverage: 'NOT_REQUIRED',
          limitation: null,
        },
      };
      await admin`UPDATE assessment_work_revision SET content_json=${JSON.stringify(content)},work_revision=1,created_at=now(),request_id='work-request',based_on_work_item_revision=1 WHERE assessment_work_revision_id='work-selected'`;
      await admin`DELETE FROM assessment_work_revision WHERE assessment_work_revision_id='work-other'`;
      await admin`UPDATE work_item SET projection_json=${JSON.stringify({ source: { documentVersionId: binding.documentVersionId, sourceArtifactId: 'artifact', sourceFileSha256: 'a'.repeat(64) } })}`;
      await admin`UPDATE dm_publication_family SET current_document_version_id=${binding.documentVersionId},current_generation=1,status='ACTIVE'`;
      const sqlContext = new SqlExecutionContextMiddleware({
        roleSchema: SCHEMA,
      });
      const transactions = new EngineeringMatterWorkingRepository(
        database,
        sqlContext,
        { roleSchema: SCHEMA },
        null,
      );
      const works = new JobAidWorkRepository(database, transactions, null);
      const jobAid = new CanonicalJobAidProblemService(
        null,
        null,
        authority,
        null,
        null,
        null,
        new MiaodaWorkItemRepository(database),
        new ReviewConversationRepository(database),
        null,
        works,
        undefined,
        undefined,
        undefined,
        database,
        undefined,
        objectAccess,
        undefined,
        verifier,
      );
      let originalReads = 0,
        revokeOnOriginal = false;
      const reader = {
        readDocumentOriginal: async () => {
          originalReads++;
          await database.execute(sql`SELECT 1 AS pool_is_free`);
          if (revokeOnOriginal)
            await admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`;
          return loaded;
        },
      };
      const members = new DerivedSummaryMembersService(
        jobAid,
        transactions,
        reader,
        verifier,
      );
      const repository = new DerivedSummaryRepository(
          database,
          transactions,
          members,
        ),
        summaries = new DerivedSummaryService(repository, members, authority);
      const runtime = new DerivedSummaryRuntimeService(
        repository,
        members,
        summaries,
      );
      const member = {
        kind: 'WORK_ITEM_WORK',
        workItemId: binding.workItemId,
        documentVersionId: binding.documentVersionId,
        workRef: 'work-selected',
        workRevision: 1,
        issueKeys: [],
      };
      const owner = {
        tenantId: binding.tenantId,
        actorUserId: binding.actorUserId,
      };
      const [reading, basis] = await repository.browser(host, async (db, o) => {
        const [r] = await members.readAll([member], o, db);
        return [r, await repository.contextBasis([r], o, db)];
      });
      const selection = {
        kind: 'ATA4',
        title: 'Explicit fixture',
        fleetFamilyId: 'F',
        fleetModelIds: ['M'],
        ata2: '46',
        ata4: '46-00',
        selectionReason: 'Constructed selection',
      };
      const model = taskModelSelection('miaoda/glm-5.3', new Date()),
        deadline = new Date(Date.now() + 3600000);
      const taskBasis = {
        schemaVersion: 'wiselink.derived-summary-task.v1',
        taskType: 'OPENCLAW_DERIVED_SUMMARY',
        subject: { kind: 'DERIVED_SUMMARY', summaryId: 'summary' },
        expectedSummaryRevision: 0,
        requestId: 'request-summary',
        actionAttemptId: 'attempt-summary',
        operationRef: 'task-summary',
        deadlineAt: deadline.toISOString(),
        executionModel: model,
        contextBasis: basis,
        modelInput: {
          scope: selection,
          classificationStatus: 'CANDIDATE',
          instruction: 'Retain exact uncertainty',
          members: [reading],
          evidence: [evidence, originalEvidence],
          limitations: [],
        },
      };
      const task = { ...taskBasis, taskInputHash: canonicalSha256(taskBasis) };
      await adminDb
        .insert(summarySchema.derivedSummary)
        .values({
          id: randomUUID(),
          summaryId: 'summary',
          tenantId: binding.tenantId,
          actorUserId: binding.actorUserId,
          currentRevision: 0,
          scopeJson: selection,
          membersJson: [member],
        });
      await adminDb
        .insert(schema.actionAttempt)
        .values({
          id: randomUUID(),
          attemptId: 'attempt-summary',
          operationRef: 'task-summary',
          tenantId: binding.tenantId,
          actorUserId: binding.actorUserId,
          subjectKind: 'DERIVED_SUMMARY',
          actionType: 'OPENCLAW_DERIVED_SUMMARY',
          status: 'QUEUED',
          claimCount: 0,
          leaseGeneration: 0,
          triggerRequestId: 'request-summary',
          baseRevision: 0,
          inputRevision: 0,
          deadlineAt: deadline,
          taskEnvelopeJson: canonicalJson(task),
          taskInputHash: task.taskInputHash,
          executionModelJson: canonicalJson(model),
        });
      await admin`UPDATE action_attempt SET summary_id='summary',summary_delegated_principal_id=${scope.principalId},summary_request_command_json=${canonicalJson(
        {
          requestId: task.requestId,
          expectedSummaryRevision: 0,
          scope: selection,
          members: [member],
          instruction: task.modelInput.instruction,
          modelRef: model.modelRef,
        },
      )} WHERE operation_ref='task-summary'`;
      await client.unsafe(`SET ROLE ${role}`);
      const target = {
        summaryId: 'summary',
        attemptRef: 'task-summary',
        scope,
      };
      const row = async () =>
        (
          await admin`SELECT status,claim_count,lease_token,lease_generation,review_activity_json FROM action_attempt WHERE operation_ref='task-summary'`
        )[0];
      await t.test(
        'actual queued claim rolls back when retained validity is UNKNOWN, then takes a genuine lease before JobAid native checks',
        async () => {
          native.facts = productionFacts;
          await assert.rejects(
            runtime.claim(target),
            /TDMS_RUNTIME_OPINION_NOT_APPROVED/,
          );
          assert.equal((await row()).status, 'QUEUED');
          assert.equal((await row()).claim_count, 0);
          assert.equal((await row()).lease_token, null);
          native.facts = constructedActiveFacts;
          const claim = await runtime.claim(target);
          Object.assign(target, {
            leaseToken: claim.leaseToken,
            leaseGeneration: claim.leaseGeneration,
          });
          assert.equal((await row()).status, 'RUNNING');
          assert.equal((await row()).claim_count, 1);
          assert.ok(
            nativeCalls.some(
              (call) =>
                call.caller?.kind === 'RUNTIME' &&
                call.caller.attemptRef === target.attemptRef,
            ),
          );
          assert.ok(
            nativeCalls.every(
              (call) =>
                call.caller?.kind === 'BROWSER' ||
                call.caller?.kind === 'RUNTIME',
            ),
          );
        },
      );
      await t.test(
        'real member read and original Source IO re-enter exact native caller before and after IO',
        async () => {
          const out = await runtime.readMemberWork({
            ...target,
            evidenceRefs: [reading.evidenceRef],
            purpose: 'Member read',
          });
          assert.equal(out.members[0].member.workRef, 'work-selected');
          const before = nativeCalls.length;
          const sources = await runtime.readSources({
            ...target,
            evidenceRefs: [evidence.evidenceRef],
            purpose: 'Original verification',
          });
          assert.equal(
            sources.evidence[0].nativeReadReceipt.receiptRef,
            evidence.nativeReadReceipt.receiptRef,
          );
          assert.equal(originalReads, 1);
          assert.ok(nativeCalls.length > before);
          const journalBefore = (await row()).review_activity_json;
          revokeOnOriginal = true;
          await assert.rejects(
            runtime.readSources({
              ...target,
              evidenceRefs: [evidence.evidenceRef],
              purpose: 'Revocation during original IO',
            }),
            /TDMS_RECEIVER_ACTION_DENIED/,
          );
          assert.equal((await row()).review_activity_json, journalBefore);
          revokeOnOriginal = false;
          await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`;
        },
      );
      const saveInput = {
        ...target,
        requestId: 'request-summary',
        expectedSummaryRevision: 0,
        contentJson: JSON.stringify({
          headline: 'Candidate summary',
          listBrief: 'Limited saved member',
          body: `Exact candidate [[${reading.evidenceRef}]]`,
          limitations: [],
        }),
      };
      await t.test(
        'real SAVE and finish commit once; terminal readSaved and idempotent finish/SAVE use exact durable proof',
        async () => {
          const saved = await runtime.save(saveInput);
          assert.equal(saved.replay, false);
          // A real SAVE/claim writer locks the summary head before its attempt. FINISH
          // must wait at that same first key, without already holding the attempt key.
          const writerClient = await owned.connect(login);
          await writerClient.unsafe(
            `SET search_path TO ${SCHEMA},pg_catalog; SET ROLE ${role}`,
          );
          await writerClient`SELECT set_config('app.user_id','user-a',false)`;
          const [readerPid] = await client`SELECT pg_backend_pid() AS pid`,
            [writerPid] = await writerClient`SELECT pg_backend_pid() AS pid`;
          let held, release;
          const headHeld = new Promise((r) => {
              held = r;
            }),
            resumeWriter = new Promise((r) => {
              release = r;
            });
          const writer = drizzle(writerClient).transaction(async (db) => {
            await db.execute(
              sql`SELECT summary_id FROM derived_summary WHERE summary_id='summary' FOR UPDATE`,
            );
            held();
            await resumeWriter;
            await db.execute(
              sql`SELECT attempt_id FROM action_attempt WHERE operation_ref='task-summary' FOR UPDATE`,
            );
          });
          await headHeld;
          const finishing = runtime.finish({
            ...target,
            requestId: 'request-summary',
          });
          try {
            let blocked = false;
            for (let i = 0; i < 50; i++) {
              const [observed] =
                await admin`SELECT ${writerPid.pid}::integer=ANY(pg_blocking_pids(${readerPid.pid}::integer)) AS blocked`;
              if (observed.blocked) {
                blocked = true;
                break;
              }
              await new Promise((r) => setTimeout(r, 20));
            }
            assert.equal(
              blocked,
              true,
              'FINISH must wait for the real summary head writer',
            );
          } finally {
            release();
          }
          const [finished] = await Promise.all([finishing, writer]);
          assert.equal(finished.status, 'SUCCEEDED');
          assert.equal((await row()).lease_token, null);
          const output = await runtime.readSaved({
            ...target,
            requestId: 'request-summary',
          });
          assert.equal(output.summary.summaryRef, saved.summaryRef);
          assert.equal(
            (await runtime.finish({ ...target, requestId: 'request-summary' }))
              .status,
            'SUCCEEDED',
          );
          assert.equal((await runtime.save(saveInput)).replay, true);
          assert.equal(
            (
              await admin`SELECT count(*)::integer AS n FROM derived_summary_revision`
            )[0].n,
            1,
          );
          assert.ok(
            nativeCalls.some(
              (call) =>
                call.caller?.purpose === 'SAVED_RESULT' &&
                call.caller.requestId === 'request-summary',
            ),
          );
          await assert.rejects(
            runtime.readSaved({ ...target, requestId: 'wrong-request' }),
            /TDMS_SUMMARY_DELEGATION_REJECTED/,
          );
          await assert.rejects(
            runtime.readSources({
              ...target,
              evidenceRefs: [evidence.evidenceRef],
              purpose: 'Terminal cannot execute',
            }),
            /JOBAID_WORK_LEASE_FENCE_REJECTED/,
          );
          await admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`;
          await assert.rejects(
            runtime.readSaved({ ...target, requestId: 'request-summary' }),
            /TDMS_RECEIVER_ACTION_DENIED/,
          );
          const previousCalls = nativeCalls.length;
          const status = await runtime.status(target);
          assert.equal(status.status, 'SUCCEEDED');
          assert.equal(nativeCalls.length, previousCalls);
        },
      );
    } finally {
      for (const [key, value] of Object.entries(previous))
        value === undefined
          ? delete process.env[key]
          : (process.env[key] = value);
      await owned.stop();
    }
  },
);
