import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  postgresCapability,
  startOwnedPostgres,
} from '../pg/owned-postgres-cluster.mjs';
import { startCoreP1HostFixture } from './helpers/core-p1-host-postgres.fixture.mjs';
process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { getTableConfig } = require('drizzle-orm/pg-core');
const { sql } = require('drizzle-orm');
const schema = require('../../server/database/schema.ts');
const {
  autoWorkItemAuthorization,
} = require('../../server/database/auto-work-item-authorization.schema.ts');
const {
  authenticateTdmsRuntimeDelegation,
  assertTdmsSourceActor,
} = require('../../server/modules/tdms-source/tdms-runtime-delegation.ts');
const {
  assertPublicActor,
} = require('../../server/modules/tdms-source/tdms-source.authorization.ts');
const {
  TdmsRuntimeReceiptRepository,
} = require('../../server/modules/tdms-source/tdms-runtime-receipt.repository.ts');
const {
  TdmsRuntimeReceiverRepository,
} = require('../../server/modules/tdms-source/tdms-runtime-receiver.repository.ts');
const {
  receiverAuthority,
} = require('../../server/modules/tdms-source/tdms-receiver-authorization.validation.ts');
const {
  ConfiguredDevelopmentCanonicalServiceScopeAuthorization,
} = require('../../server/modules/canonical-host/configured-development-service-scope.authorization.ts');
const {
  tdmsRuntimeFixture,
} = require('../unit/fixtures/tdms-runtime.fixture.ts');
const {
  TdmsProductionRuntimeReader,
} = require('../../server/modules/tdms-source/tdms-production-runtime-reader.ts');
const config = {
  WL_OPENCLAW_SERVICE_SCOPE_ENABLED: '1',
  WL_OPENCLAW_GATEWAY_AUTH_MODE: 'API_KEY',
  WL_OPENCLAW_SERVICE_SCOPE_ENV: 'DEV',
  WL_OPENCLAW_SERVICE_PRINCIPAL_ID: 'service:runtime-test',
  WL_OPENCLAW_SERVICE_TENANT_ID: 'tenant-a',
  WL_OPENCLAW_SERVICE_WORK_ITEM_ID: 'WI-runtime',
  WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED: '1',
  WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS: undefined,
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test(
  'production reader leaves ordinary BEGIN, SAVE and saved-work recovery on the real Host path',
  { timeout: 60000 },
  async () => {
    const f = await startCoreP1HostFixture();
    try {
      let profileReads = 0;
      const reader = new TdmsProductionRuntimeReader(
        f.db,
        f.serviceScope,
        f.work,
        {
          current() {
            profileReads++;
            throw new Error('ORDINARY_TASK_MUST_NOT_READ_TDMS_PROFILE');
          },
        },
      );
      f.problem.tdmsReader = reader;
      f.problem.nativeVerifier = reader;
      await f.seed('WI-core-p1');
      assert.equal(
        (await f.nextWorkItem({ resumeWorkItemId: 'WI-core-p1' })).status,
        'CLAIMED',
      );
      const claim = await f.callTool('begin_dynamic_evaluation', {
        workItemId: 'WI-core-p1',
      });
      assert.equal(claim.task.modelInput.tdmsContext, undefined);
      const saved = await f.callTool('save_assessment_work', {
        workItemId: 'WI-core-p1',
        attemptRef: claim.attemptRef,
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
        requestId: 'ordinary-with-production-reader',
        expectedWorkRevision: 0,
        workJson: JSON.stringify(f.proposal(claim)),
      });
      const read = await f.callTool('read_assessment_work', {
        workItemId: 'WI-core-p1',
        attemptRef: claim.attemptRef,
        requestId: 'ordinary-with-production-reader',
      });
      assert.equal(read.revision.workRevisionRef, saved.workRevisionRef);
      assert.equal(profileReads, 0);
      const ordinary = await f.hosted(async () => {
        const scope = await f.serviceScope.authorizeOpenClawWorkItem({
          operation: 'BEGIN_DYNAMIC',
          workItemId: 'WI-core-p1',
        });
        return reader.discover(
          {
            scope: { ...scope, successorReviewDelegation: { invalid: true } },
            actorUserId: f.actorUserId,
          },
          {
            tenantId: f.tenantId,
            actorUserId: f.actorUserId,
            workItemId: 'WI-core-p1',
            documentVersionId: claim.task.documentVersionId,
            taskContextRef: 'ordinary-successor-metadata',
          },
        );
      });
      assert.equal(ordinary, null);
      assert.equal(profileReads, 0);
    } finally {
      await f.close();
    }
  },
);

test(
  'production TDMS service delegation and immutable READ audit use actual roles and held PG transactions',
  { timeout: 60000 },
  async (t) => {
    const capability = await postgresCapability();
    assert.equal(capability.available, true, capability.reason);
    const owned = await startOwnedPostgres(capability);
    const previous = Object.fromEntries(
      Object.keys(config).map((k) => [k, process.env[k]]),
    );
    for (const [key, value] of Object.entries(config))
      value === undefined
        ? delete process.env[key]
        : (process.env[key] = value);
    try {
      const admin = owned.admin;
      const role = 'service_role_workspace_aadkpkjef3slu',
        browserRole = 'authenticated_workspace_aadkpkjef3slu';
      const login =
        'tdms_fixture_app_' + randomUUID().replaceAll('-', '').slice(0, 16);
      await admin.unsafe(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE ${browserRole} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE ${login} LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE ${role},${browserRole};
      CREATE SCHEMA workspace_aadkpkjef3slu; SET search_path TO workspace_aadkpkjef3slu,pg_catalog;
      CREATE TYPE user_profile AS(user_id text); GRANT USAGE ON SCHEMA workspace_aadkpkjef3slu TO ${role},${browserRole};`);
      for (const table of [
        schema.workItem,
        schema.actionAttempt,
        autoWorkItemAuthorization,
      ]) {
        const tableConfig = getTableConfig(table);
        await admin.unsafe(
          `CREATE TABLE ${tableConfig.name} (${tableConfig.columns.map((c) => `"${c.name}" ${c.getSQLType()}`).join(',')})`,
        );
        await admin.unsafe(`ALTER TABLE ${tableConfig.name} ENABLE ROW LEVEL SECURITY;
        CREATE POLICY fixture_scope ON ${tableConfig.name} TO ${role},${browserRole}
          USING(tenant_id='tenant-a' AND current_setting('app.user_id',true)='user-a');
        GRANT SELECT,UPDATE ON ${tableConfig.name} TO ${role},${browserRole};`);
      }
      await admin.unsafe(`CREATE TABLE tdms_read_receipt(tenant_id text,source_key text,source_instance_id text,scope_id text,
      receipt_ref text,source_revision_ref text,actor_id text,data jsonb,UNIQUE(tenant_id,receipt_ref));
      ALTER TABLE tdms_read_receipt ENABLE ROW LEVEL SECURITY;
      CREATE POLICY fixture_receipts ON tdms_read_receipt TO ${role},${browserRole}
        USING(tenant_id='tenant-a' AND actor_id=current_setting('app.user_id',true));
      GRANT SELECT,INSERT ON tdms_read_receipt TO ${role},${browserRole};`);
      const client = await owned.connect(login);
      await client.unsafe(
        `SET search_path TO workspace_aadkpkjef3slu,pg_catalog; SET ROLE ${role}`,
      );
      await client`SELECT set_config('app.user_id','user-a',false)`;
      const queries = [];
      const database = drizzle(client, {
        logger: {
          logQuery(query) {
            queries.push(query);
          },
        },
      });
      const f = tdmsRuntimeFixture({
          workItemId: 'WI-runtime',
          documentVersionId: 'DV-runtime',
        }),
        binding = f.binding;
      const authorization =
        new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
      const scope = await authorization.authorizeOpenClawWorkItem({
        operation: 'BEGIN_DYNAMIC',
        workItemId: binding.workItemId,
      });
      const principal = { scope, actorUserId: binding.actorUserId };
      await admin`INSERT INTO work_item(work_item_id,tenant_id,requested_by_user_id,document_id,document_version_id,
      request_id,source_artifact_id,source_file_sha256,source_byte_length,projection_json)
      VALUES(${binding.workItemId},${binding.tenantId},${binding.actorUserId},'doc',${binding.documentVersionId},
      'request','artifact',${'a'.repeat(64)},42,'{"nativeBodyCanary":"SECRET_BODY"}')`;
      const auth = (db, overrides = {}) =>
        authenticateTdmsRuntimeDelegation({
          database: db,
          authorization,
          principal,
          binding,
          ...overrides,
        });
      await t.test(
        'real admission mints a distinct non-browser actor; JSON and browser-role lookalikes fail',
        async () => {
          const actor = await database.transaction((db) => auth(db));
          assert.equal(actor.principalKind, 'SERVICE_DELEGATE');
          assertTdmsSourceActor(actor);
          assert.throws(
            () => assertTdmsSourceActor(structuredClone(actor)),
            /TDMS_VERIFIED_SERVICE_DELEGATION_REQUIRED/,
          );
          assert.throws(
            () => assertPublicActor(actor),
            /TDMS_VERIFIED_PUBLIC_ACTOR_REQUIRED/,
          );
          await assert.rejects(
            database.transaction((db) => auth(db, { stage: 'EXECUTION' })),
            /TDMS_RUNTIME_DELEGATION_REJECTED/,
          );
          await client.unsafe(`SET ROLE ${browserRole}`);
          await assert.rejects(
            database.transaction((db) => auth(db)),
            /TDMS_RUNTIME_DELEGATION_REJECTED/,
          );
          await client.unsafe(`SET ROLE ${role}`);
          await assert.rejects(
            database.transaction((db) =>
              auth(db, {
                principal: {
                  ...principal,
                  scope: { ...scope, tenantId: 'other' },
                },
              }),
            ),
            /CANONICAL_SERVICE_SCOPE|NOT_FOUND/,
          );
          assert.equal(
            queries.some((q) => q.includes('projection_json')),
            false,
            'admission never fetches a WorkItem body projection',
          );
        },
      );
      const context = await f.adapter.discover(f.principal, binding);
      const read = await f.adapter.read(f.principal, {
        context,
        evidenceRefs: context.projection.selectedSetApprovedRefs,
        purpose: 'JOB_AID_NATIVE_RECORD',
        taskContextRef: binding.taskContextRef,
      });
      const evidence = read.evidence[0];
      assert.ok(evidence);
      const task = {
        modelInput: {
          actorUserId: binding.actorUserId,
          tdmsContext: context,
          previousWork: { content: { secret: 'BODY_CANARY' } },
        },
      };
      const attemptId = randomUUID();
      await admin`INSERT INTO action_attempt(id,attempt_id,operation_ref,tenant_id,work_item_id,document_version_id,actor_user_id,
      status,lease_owner,lease_token,lease_generation,lease_expires_at,deadline_at,task_envelope_json,task_input_hash,review_activity_json)
      VALUES(${attemptId},'attempt',${binding.taskContextRef},${binding.tenantId},${binding.workItemId},${binding.documentVersionId},
      'service:openclaw-main','RUNNING',${scope.principalId},'attempt-token',1,now()+interval '1 hour',now()+interval '1 hour',
      ${JSON.stringify(task)},'hash','[{"secret":"JOURNAL_BODY_CANARY"}]')`;
      const running = {
        ...principal,
        scope: { ...scope, attemptRef: binding.taskContextRef },
      };
      await t.test(
        'execution uses real service actor column and sealed owner; terminal checks remain read-only',
        async () => {
          queries.length = 0;
          await database.transaction((db) =>
            auth(db, { principal: running, stage: 'EXECUTION' }),
          );
          assert.equal(
            queries.some(
              (q) =>
                q.includes('review_activity_json') ||
                q.includes('result_envelope_json'),
            ),
            false,
          );
          await admin`UPDATE action_attempt SET status='SUCCEEDED',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL`;
          await database.transaction((db) =>
            auth(db, { principal: running, stage: 'SAVED_VERIFICATION' }),
          );
          await assert.rejects(
            database.transaction((db) =>
              auth(db, { principal: running, stage: 'EXECUTION' }),
            ),
            /TDMS_RUNTIME_DELEGATION_REJECTED/,
          );
          await admin`UPDATE action_attempt SET task_envelope_json=${JSON.stringify({ ...task, modelInput: { ...task.modelInput, actorUserId: 'wrong-owner' } })}`;
          await assert.rejects(
            database.transaction((db) =>
              auth(db, { principal: running, stage: 'METADATA' }),
            ),
            /TDMS_RUNTIME_DELEGATION_REJECTED/,
          );
          await admin`UPDATE action_attempt SET task_envelope_json=${JSON.stringify(task)}`;
        },
      );
      await t.test(
        'READ audit survives separate transactions and later journal receipts need no duplicate body',
        async () => {
          const saved = f.receipts.find(
            (v) =>
              v.receipt.receiptRef === evidence.nativeReadReceipt.receiptRef,
          );
          const insert = async (value) =>
            database.transaction((db) =>
              db.execute(sql`INSERT INTO tdms_read_receipt VALUES(
        ${value.scope.tenantId},${value.scope.sourceKey},${value.scope.sourceInstanceId},${value.scope.scopeId},
        ${value.receipt.receiptRef},${value.receipt.sourceRevisionRef},${value.actorId},${JSON.stringify(value)}::jsonb)`),
            );
          await insert(saved);
          await database.transaction((db) =>
            new TdmsRuntimeReceiptRepository(db).assertReceipt(
              binding,
              evidence,
            ),
          );
          await assert.rejects(
            database.transaction((db) =>
              new TdmsRuntimeReceiptRepository(db).assertReceipt(
                { ...binding, actorUserId: 'someone-else' },
                evidence,
              ),
            ),
            /SAVED_RECEIPT_MISMATCH/,
          );
          const second = (
            await f.adapter.read(f.principal, {
              context,
              evidenceRefs: [evidence.evidenceRef],
              purpose: 'JOB_AID_NATIVE_RECORD',
              taskContextRef: binding.taskContextRef,
            })
          ).evidence[0];
          await insert(
            f.receipts.find(
              (v) =>
                v.receipt.receiptRef === second.nativeReadReceipt.receiptRef,
            ),
          );
          const journal = [
            {
              kind: 'ASSESSMENT_SOURCES_READ',
              nativeEvidence: [evidence],
              nativeReadReceipts: [evidence.nativeReadReceipt],
            },
            {
              kind: 'ASSESSMENT_SOURCES_READ',
              nativeEvidence: [],
              nativeReadReceipts: [second.nativeReadReceipt],
            },
          ];
          await admin`UPDATE action_attempt SET review_activity_json=${JSON.stringify(journal)}`;
          queries.length = 0;
          await database.transaction((db) =>
            new TdmsRuntimeReceiptRepository(db).savedBinding(
              binding.taskContextRef,
              binding,
            ),
          );
          await database.transaction((db) =>
            new TdmsRuntimeReceiptRepository(db).assertTaskContext(context),
          );
          assert.equal(
            queries.some((q) => q.includes('review_activity_json')),
            false,
            'metadata task lookup does not read journal bodies',
          );
          await database.transaction((db) =>
            new TdmsRuntimeReceiptRepository(db).assertReceipt(
              binding,
              second,
              true,
            ),
          );
          await assert.rejects(
            database.transaction((db) =>
              new TdmsRuntimeReceiptRepository(db).assertReceipt(
                binding,
                {
                  ...second,
                  nativeReadReceipt: {
                    ...second.nativeReadReceipt,
                    receiptRef: 'invented',
                  },
                },
                true,
              ),
            ),
            /SAVED_RECEIPT_MISMATCH/,
          );
          await admin`UPDATE action_attempt SET review_activity_json=${JSON.stringify(journal.slice(0, 1))}`;
          await assert.rejects(
            database.transaction((db) =>
              new TdmsRuntimeReceiptRepository(db).assertReceipt(
                binding,
                second,
                true,
              ),
            ),
            /SAVED_RECEIPT_MISMATCH/,
          );
        },
      );
      await t.test(
        'fresh queue admission preserves its current generation while checking old saved tasks',
        async () => {
          delete process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID;
          const lease = {
            tenantId: binding.tenantId,
            principalId: scope.principalId,
            workItemId: binding.workItemId,
            requestId: 'request',
            actorUserId: binding.actorUserId,
            documentId: 'doc',
            documentVersionId: binding.documentVersionId,
            sourceArtifactId: 'artifact',
            sourceFileSha256: 'a'.repeat(64),
            sourceByteLength: 42,
            leaseGeneration: 2,
            leaseExpiresAt: new Date(Date.now() + 3600000).toISOString(),
          };
          const queueAuth =
            new ConfiguredDevelopmentCanonicalServiceScopeAuthorization({
              authorizeActiveLease: async () => lease,
            });
          const queueScope = await queueAuth.authorizeOpenClawWorkItem({
            operation: 'BEGIN_DYNAMIC',
            workItemId: binding.workItemId,
          });
          await admin`INSERT INTO auto_work_item_authorization(tenant_id,work_item_id,request_id,actor_user_id,document_id,document_version_id,
        source_artifact_id,source_file_sha256,source_byte_length,grant_kind,status,lease_owner,lease_generation,lease_expires_at)
        VALUES(${lease.tenantId},${lease.workItemId},${lease.requestId},${lease.actorUserId},${lease.documentId},${lease.documentVersionId},
        ${lease.sourceArtifactId},${lease.sourceFileSha256},${lease.sourceByteLength},'MIAODA_CANONICAL_PARSE_REQUEST','LEASED',
        ${lease.principalId},2,${lease.leaseExpiresAt})`;
          await admin`UPDATE action_attempt SET task_envelope_json=${JSON.stringify(
            {
              modelInput: {
                ...task.modelInput,
                automaticWorkItemLease: {
                  requestId: 'request',
                  leaseGeneration: 1,
                },
              },
            },
          )}`;
          const current = {
            scope: { ...queueScope, attemptRef: binding.taskContextRef },
            actorUserId: binding.actorUserId,
          };
          await database.transaction((db) =>
            auth(db, {
              authorization: queueAuth,
              principal: current,
              stage: 'SAVED_VERIFICATION',
            }),
          );
          await assert.rejects(
            database.transaction((db) =>
              auth(db, {
                authorization: queueAuth,
                principal: {
                  ...current,
                  scope: {
                    ...current.scope,
                    authorizationFingerprint: 'forged',
                  },
                },
                stage: 'SAVED_VERIFICATION',
              }),
            ),
            /NOT_FOUND/,
          );
          await admin`UPDATE auto_work_item_authorization SET status='COMPLETED'`;
          await assert.rejects(
            database.transaction((db) =>
              auth(db, {
                authorization: queueAuth,
                principal: current,
                stage: 'METADATA',
              }),
            ),
            /TDMS_RUNTIME_DELEGATION_REJECTED/,
          );
          process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID = 'WI-runtime';
        },
      );
      await t.test(
        'actual receiver grant is independent of service role and its lock fences controlled revoke',
        async () => {
          await seedReceiverTables(
            admin,
            role,
            browserRole,
            binding.actorUserId,
          );
          const profile = {
            current: () => ({
              tenantId: binding.tenantId,
              clientId: 'fixture-client',
            }),
          };
          const held = deferred(),
            release = deferred();
          let revokeFinished = false;
          const protectedRead = database.transaction(async (db) => {
            const actor = await auth(db);
            const rows = await new TdmsRuntimeReceiverRepository(
              db,
              profile,
            ).authorities(actor, f.scope);
            assert.equal(rows.length, 1);
            assert.ok(receiverAuthority(rows[0], actor, 'READ_RECORD'));
            held.resolve();
            await release.promise;
            const again = await new TdmsRuntimeReceiverRepository(
              db,
              profile,
            ).authorities(actor, f.scope);
            assert.ok(receiverAuthority(again[0], actor, 'READ_RECORD'));
          });
          await held.promise;
          const revoke =
            admin`UPDATE tdms_source_receiver_grant SET status='REVOKED',revoked_at=now()`.then(
              () => {
                revokeFinished = true;
              },
            );
          await new Promise((resolve) => setTimeout(resolve, 80));
          assert.equal(revokeFinished, false);
          release.resolve();
          await protectedRead;
          await revoke;
          await database.transaction(async (db) => {
            const actor = await auth(db);
            const rows = await new TdmsRuntimeReceiverRepository(
              db,
              profile,
            ).authorities(actor, f.scope);
            assert.equal(
              receiverAuthority(rows[0], actor, 'READ_RECORD'),
              null,
            );
          });
          await admin`UPDATE identity_subject_mapping SET status='REVOKED'`;
          await assert.rejects(
            database.transaction(async (db) => {
              const actor = await auth(db);
              await new TdmsRuntimeReceiverRepository(db, profile).authorities(
                actor,
                f.scope,
              );
            }),
            /TDMS_RECEIVER_BOUND_IDENTITY_MISMATCH/,
          );
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

async function seedReceiverTables(db, role, browserRole, actor) {
  // Reduced local storage/policies exercise production queries and lock protocol;
  // they are neither an online migration nor a claim about installed hosted RLS.
  await db.unsafe(`CREATE TABLE identity_subject_mapping(miaoda_user_id text,miaoda_tenant_id text,expected_client_id text,status text);
    CREATE FUNCTION tdms_act_bound_identity(t text,c text) RETURNS boolean LANGUAGE SQL SECURITY INVOKER AS $$
      SELECT t='tenant-a' AND c='fixture-client' AND current_schema()='workspace_aadkpkjef3slu'
        AND current_user IN ('${role}','${browserRole}') AND (SELECT count(*)=1 FROM identity_subject_mapping
        WHERE miaoda_user_id=current_setting('app.user_id',true) AND miaoda_tenant_id=t AND expected_client_id=c AND status='ACTIVE') $$;
    CREATE TABLE tdms_source_receiver(receiver_id text,tenant_id text,application_scope_id text,source_key text,
      source_instance_id text,scope_id text,source_subject_namespace text,source_subject_id text,authority_ref text,
      authority_revision text,authority_evidence_ref text,approved_by_subject text,approved_at timestamptz,
      valid_from timestamptz,valid_until timestamptz,status text,revoked_at timestamptz,revision integer);
    CREATE TABLE tdms_source_receiver_grant(receiver_id text,actor_subject_id text,source_subject_namespace text,
      source_subject_id text,permission_revision text,authority_evidence_ref text,approved_by_subject text,approved_at timestamptz,
      valid_from timestamptz,valid_until timestamptz,status text,revoked_at timestamptz,revision integer,actions_json jsonb);
    CREATE FUNCTION fixture_guard_receiver_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('wiselink:tdms-receiver:'||OLD.receiver_id,0));
      NEW.revision:=OLD.revision+1;RETURN NEW;END;$$;
    CREATE TRIGGER fixture_revoke BEFORE UPDATE ON tdms_source_receiver_grant FOR EACH ROW EXECUTE FUNCTION fixture_guard_receiver_change();
    GRANT SELECT ON identity_subject_mapping,tdms_source_receiver,tdms_source_receiver_grant TO ${role},${browserRole};`);
  await db`INSERT INTO identity_subject_mapping VALUES(${actor},'tenant-a','fixture-client','ACTIVE')`;
  await db`INSERT INTO tdms_source_receiver VALUES('receiver','tenant-a','app_17bzc551rsg','TDMS','instance','shared-source',
    'TDMS_USER','source-user','authority','r1','proof','approver',now()-interval '1 day',now()-interval '1 day',now()+interval '1 day','ACTIVE',NULL,1)`;
  const decision = {
    allowed: true,
    authorityRef: 'a',
    authorityRevision: 'r',
    authorityEvidenceRef: 'proof',
    approvedBySubject: 'approver',
    validFrom: new Date(Date.now() - 86400000).toISOString(),
    validUntil: new Date(Date.now() + 86400000).toISOString(),
    purpose: 'read',
    retainedCaptureReadAllowed: true,
    permittedMembers: {
      records: [],
      artifacts: [],
      relationIds: [],
      relatedDocumentVersionIds: [],
    },
  };
  await db`INSERT INTO tdms_source_receiver_grant VALUES('receiver',${actor},'TDMS_USER','source-user','permission','proof','approver',
    now()-interval '1 day',now()-interval '1 day',now()+interval '1 day','ACTIVE',NULL,1,${db.json({ READ_RECORD: decision })})`;
}
