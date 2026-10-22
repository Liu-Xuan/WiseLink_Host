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
const { drizzle } = require('drizzle-orm/postgres-js');
const { getTableConfig } = require('drizzle-orm/pg-core');
const schema = require('../../server/database/schema.ts');
const {
  autoWorkItemAuthorization,
} = require('../../server/database/auto-work-item-authorization.schema.ts');
const summarySchema = require('../../server/database/derived-summary.schema.ts');
const {
  TdmsBrowserNativeVerifier,
} = require('../../server/modules/tdms-source/tdms-browser-native-verifier.ts');
const {
  authenticateTdmsSummaryDelegation,
  assertTdmsSummarySourceActor,
} = require('../../server/modules/tdms-source/tdms-summary-delegation.ts');
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
  tdmsRuntimeFixture,
} = require('../unit/fixtures/tdms-runtime.fixture.ts');
const APP = 'app_17bzc551rsg',
  SCHEMA = 'workspace_aadkpkjef3slu';
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
const copy = structuredClone;

test(
  'browser and summary native verification use actual saved work, identity, grants and transaction locks',
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
   SET search_path TO ${SCHEMA},pg_catalog; CREATE TYPE user_profile AS(user_id text); GRANT USAGE ON SCHEMA ${SCHEMA} TO ${role},${browserRole};`);
      for (const table of [
        schema.workItem,
        autoWorkItemAuthorization,
        schema.actionAttempt,
        schema.assessmentWorkRevision,
        schema.identitySubjectMapping,
        schema.dmDocumentVersion,
        schema.dmPublicationFamily,
        schema.dmSourceArtifact,
        schema.dmAcquisition,
        schema.dmIngressPreflight,
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
      await admin.unsafe(
        `GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${role},${browserRole}`,
      );
      for (const table of [
        'tdms_record_revision',
        'tdms_relation_assertion',
        'tdms_processing_revision_set',
        'tdms_processing_set_head',
        'tdms_capture',
        'tdms_read_receipt',
      ])
        await admin.unsafe(
          `CREATE POLICY fixture_scope ON ${table} TO ${role},${browserRole} USING(tenant_id='tenant-a' AND current_setting('app.user_id',true) IN ('user-a','shared-reader'))`,
        );
      const client = await owned.connect(login);
      await client.unsafe(
        `SET search_path TO ${SCHEMA},pg_catalog; SET ROLE ${browserRole}`,
      );
      await client`SELECT set_config('app.user_id','user-a',false)`;
      const queries = [],
        results = [];
      const database = drizzle(client, {
          logger: {
            logQuery(query) {
              queries.push(query);
            },
          },
        }),
        adminDb = drizzle(admin);
      const f = tdmsRuntimeFixture(),
        { binding, scope } = f;
      const actor = {
        ...f.actor,
        applicationScopeId: APP,
        subjectDecision: {
          ...f.actor.subjectDecision,
          applicationScopeId: APP,
          version: 'miaoda-hosted-native-sso.v1',
        },
      };
      const authorization =
        new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
      const queueScope =
        await authorization.authorizeOpenClawAutoWorkItemQueue();
      const profile = {
        current: () => ({
          tenantId: binding.tenantId,
          clientId: 'fixture-client',
        }),
      };
      const objectAccess = new MiaodaHostedCanonicalObjectAccessAdapter(
        new MiaodaWorkItemRepository({}),
      );
      const verifier = new TdmsBrowserNativeVerifier(
        authorization,
        profile,
        objectAccess,
      );
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
      const browserCaller = {
        actor,
        action: 'REQUEST_OVERALL_REGENERATION',
        workItemId: binding.workItemId,
        documentVersionId: binding.documentVersionId,
        workItemRevision: 1,
        workRevisionRef: 'work-selected',
      };
      const identity = {
        tenantId: binding.tenantId,
        actorUserId: binding.actorUserId,
      };
      const observe = (db) =>
        new Proxy(db, {
          get(target, key) {
            if (key === 'execute')
              return async (query) => {
                const value = await target.execute(query);
                results.push(JSON.stringify(value));
                return value;
              };
            const value = target[key];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      const run = (extra = {}) =>
        database.transaction((db) =>
          verifier.assertInTransaction({
            actor: identity,
            browserCaller,
            evidence: [evidence],
            database: observe(db),
            ...extra,
          }),
        );
      const noBody = () => {
        assert.equal(
          queries.some(
            (q) =>
              q.includes('review_activity_json') ||
              q.includes("jsonb_extract_path(data,'record','content'"),
          ),
          false,
        );
        assert.equal(
          results.some(
            (r) =>
              r.includes('Unique complete opinion') ||
              r.includes('BODY_CANARY'),
          ),
          false,
        );
      };
      await t.test(
        'actual retained UNKNOWN validity rejects before journal/body; browser SQL role and active mapping are mandatory',
        async () => {
          await assert.rejects(run(), /TDMS_RUNTIME_OPINION_NOT_APPROVED/);
          noBody();
          await client.unsafe(`SET ROLE ${role}`);
          await assert.rejects(run(), /TDMS_NATIVE_SQL_IDENTITY_MISMATCH/);
          await client.unsafe(`SET ROLE ${browserRole}`);
          await admin`UPDATE identity_subject_mapping SET status='REVOKED'`;
          await assert.rejects(run(), /TDMS_RECEIVER_BOUND_IDENTITY_MISMATCH/);
          await admin`UPDATE identity_subject_mapping SET status='ACTIVE'`;
        },
      );
      // A constructed ACTIVE proof exercises downstream verifier behavior only. The
      // preceding case tests the unmodified production provider and its UNKNOWN denial.
      const retained = new TdmsRetainedRuntimeFacts();
      verifier.facts = {
        resolveSelections: (input) => retained.resolveSelections(input),
        readProjectionFacts: async () => copy(f.facts),
      };
      await t.test(
        'exact approved stored carrier reconstructs through real SQL and never mints a receipt',
        async () => {
          await run();
          assert.equal(
            (
              await admin`SELECT count(*)::integer AS n FROM tdms_read_receipt`
            )[0].n,
            1,
          );
          const forged = copy(evidence);
          forged.excerpt = 'forged';
          await assert.rejects(
            run({ evidence: [forged] }),
            /TDMS_NATIVE_SAVED_WORK_BINDING_MISMATCH/,
          );
        },
      );
      await t.test(
        'browser carrier belongs to exactly this set of read saved revisions',
        async () => {
          await admin`UPDATE assessment_work_revision SET content_json='{"evidence":[]}' WHERE assessment_work_revision_id='work-selected'`;
          await assert.rejects(
            run(),
            /TDMS_NATIVE_SAVED_WORK_BINDING_MISMATCH/,
          );
          await run({
            browserCaller: {
              ...browserCaller,
              workRevisionRefs: ['work-selected', 'work-other'],
            },
          });
          await assert.rejects(
            run({
              browserCaller: {
                ...browserCaller,
                workRevisionRefs: ['work-other'],
              },
            }),
            /TDMS_NATIVE_SAVED_WORK_BINDING_MISMATCH/,
          );
          await admin`UPDATE assessment_work_revision SET content_json=${JSON.stringify({ evidence: [evidence] })} WHERE assessment_work_revision_id='work-selected'`;
        },
      );
      await t.test(
        'fresh Source grant, set generation, original receipt and body substitutions all reject',
        async () => {
          await admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`;
          await assert.rejects(run(), /TDMS_RECEIVER_ACTION_DENIED/);
          await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`;
          await admin`UPDATE tdms_processing_set_head SET generation=2,data=jsonb_set(data,'{generation}','2')`;
          await assert.rejects(run(), /TDMS_PROCESSING_SET_SELECTION_CHANGED/);
          await admin`UPDATE tdms_processing_set_head SET generation=1,data=jsonb_set(data,'{generation}','1')`;
          await admin`UPDATE action_attempt SET review_activity_json='[]' WHERE operation_ref=${binding.taskContextRef}`;
          await assert.rejects(run(), /TDMS_RUNTIME_SAVED_RECEIPT_MISMATCH/);
          await admin`UPDATE action_attempt SET review_activity_json=${JSON.stringify([{ kind: 'ASSESSMENT_SOURCES_READ', nativeEvidence: [evidence] }])} WHERE operation_ref=${binding.taskContextRef}`;
          await admin`UPDATE tdms_record_revision SET data=jsonb_set(data,'{record,content,opinions,0,sourceSelector}','"swapped"') WHERE source_revision_ref='a'`;
          await assert.rejects(run(), /TDMS_RUNTIME_BODY_SUBSTITUTED/);
          await admin`UPDATE tdms_record_revision SET data=jsonb_set(data,'{record,content,opinions,0,sourceSelector}','"#opinion-a"') WHERE source_revision_ref='a'`;
        },
      );
      await t.test(
        'summary browser shared reader retains current own grants while verifying original owner receipt',
        async () => {
          const sharedActor = {
            ...actor,
            canonicalSubject: {
              ...actor.canonicalSubject,
              id: 'shared-reader',
            },
          };
          const sharedIdentity = {
            tenantId: binding.tenantId,
            actorUserId: 'shared-reader',
          };
          const sharedCaller = {
            kind: 'BROWSER',
            actor: {
              userId: 'shared-reader',
              tenantId: binding.tenantId,
              appId: APP,
              objectAccessActor: sharedActor,
            },
          };
          await admin`INSERT INTO identity_subject_mapping(id,miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
    VALUES(${randomUUID()},'shared-reader','tenant-a','fixture-client','ACTIVE')`;
          await client`SELECT set_config('app.user_id','shared-reader',false)`;
          await assert.rejects(
            run({
              actor: sharedIdentity,
              browserCaller: undefined,
              summaryCaller: sharedCaller,
            }),
            /TDMS_RECEIVER_ACTION_DENIED/,
          );
          await admin`INSERT INTO tdms_source_receiver_grant SELECT receiver_id,'shared-reader',source_subject_namespace,source_subject_id,
    permission_revision,authority_evidence_ref,approved_by_subject,approved_at,valid_from,valid_until,status,revoked_at,revision,actions_json
    FROM tdms_source_receiver_grant WHERE actor_subject_id='user-a'`;
          await run({
            actor: sharedIdentity,
            browserCaller: undefined,
            summaryCaller: sharedCaller,
          });
          await assert.rejects(
            run({
              actor: sharedIdentity,
              browserCaller: { ...browserCaller, actor: sharedActor },
            }),
            /TDMS_NATIVE_CURRENT_OBJECT_DENIED/,
          );
          await client`SELECT set_config('app.user_id','user-a',false)`;
        },
      );
      const caller = {
        kind: 'RUNTIME',
        summaryId: 'summary',
        attemptRef: 'summary-task',
        scope: queueScope,
      };
      const summary = () =>
        run({ browserCaller: undefined, summaryCaller: caller });
      await t.test(
        'real summary service delegation requires its exact owner, current live lease and queue transport',
        async () => {
          await client.unsafe(`SET ROLE ${role}`);
          await adminDb.insert(summarySchema.derivedSummary).values({
            summaryId: 'summary',
            tenantId: binding.tenantId,
            actorUserId: binding.actorUserId,
          });
          await adminDb.insert(schema.actionAttempt).values({
            attemptId: 'summary-attempt',
            operationRef: 'summary-task',
            summaryId: 'summary',
            tenantId: binding.tenantId,
            actorUserId: binding.actorUserId,
            subjectKind: 'DERIVED_SUMMARY',
            actionType: 'OPENCLAW_DERIVED_SUMMARY',
            status: 'RUNNING',
            leaseOwner: queueScope.principalId,
            leaseToken: 'summary-token',
            leaseGeneration: 1,
            leaseExpiresAt: new Date(Date.now() + 3600000),
            deadlineAt: new Date(Date.now() + 3600000),
            triggerRequestId: 'summary-request',
          });
          await admin`UPDATE action_attempt SET summary_id='summary',summary_delegated_principal_id=${queueScope.principalId} WHERE operation_ref='summary-task'`;
          const minted = await database.transaction((db) =>
            authenticateTdmsSummaryDelegation({
              database: db,
              authorization,
              caller,
              actor: identity,
            }),
          );
          assertTdmsSummarySourceActor(minted.actor);
          assert.throws(
            () => assertTdmsSummarySourceActor(copy(minted.actor)),
            /TDMS_SUMMARY_DELEGATION_REJECTED/,
          );
          await summary();
          await admin`UPDATE action_attempt SET lease_expires_at=now()-interval '1 second' WHERE operation_ref='summary-task'`;
          queries.length = 0;
          results.length = 0;
          await assert.rejects(summary(), /TDMS_SUMMARY_DELEGATION_REJECTED/);
          noBody();
          await admin`UPDATE action_attempt SET lease_expires_at=now()+interval '1 hour' WHERE operation_ref='summary-task'`;
          await assert.rejects(
            run({
              browserCaller: undefined,
              summaryCaller: {
                ...caller,
                scope: { ...queueScope, authorizationFingerprint: 'forged' },
              },
            }),
            /TDMS_SUMMARY_DELEGATION_REJECTED/,
          );
        },
      );
      await t.test(
        'completed summary needs exact saved-result proof and never authorizes fresh execution',
        async () => {
          await admin`UPDATE action_attempt SET status='SUCCEEDED',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE operation_ref='summary-task'`;
          await assert.rejects(summary(), /TDMS_SUMMARY_DELEGATION_REJECTED/);
          const savedCaller = {
            ...caller,
            purpose: 'SAVED_RESULT',
            requestId: 'summary-request',
          };
          await assert.rejects(
            run({ browserCaller: undefined, summaryCaller: savedCaller }),
            /TDMS_SUMMARY_DELEGATION_REJECTED/,
          );
          await adminDb.insert(summarySchema.derivedSummaryRevision).values({
            summaryId: 'summary',
            summaryRef: 'saved-summary',
            tenantId: binding.tenantId,
            actorUserId: binding.actorUserId,
            attemptId: 'summary-attempt',
            requestId: 'summary-request',
            contentJson: {
              attemptRef: 'summary-task',
              requestId: 'summary-request',
            },
          });
          await run({ browserCaller: undefined, summaryCaller: savedCaller });
          await assert.rejects(
            run({
              browserCaller: undefined,
              summaryCaller: { ...savedCaller, requestId: 'other-request' },
            }),
            /TDMS_SUMMARY_DELEGATION_REJECTED/,
          );
        },
      );
      await t.test(
        'expired COMMITTING recovery checks the sealed result and current grants without minting a receipt',
        async () => {
          await client.unsafe(`SET ROLE ${role}`);
          const recoveryCaller = {
            scope: queueScope,
            workItemId: binding.workItemId,
            documentVersionId: binding.documentVersionId,
            attemptRef: 'recovery-task',
            taskInputHash: 'sealed-input',
            resultContentHash: 'sealed-result',
          };
          await adminDb.insert(autoWorkItemAuthorization).values({
            tenantId: binding.tenantId,
            workItemId: binding.workItemId,
            actorUserId: binding.actorUserId,
            requestId: 'request',
            documentId: 'doc',
            documentVersionId: binding.documentVersionId,
            sourceArtifactId: 'artifact',
            sourceFileSha256: 'a'.repeat(64),
            sourceByteLength: 42,
            grantKind: 'MIAODA_CANONICAL_PARSE_REQUEST',
            status: 'LEASED',
            leaseOwner: queueScope.principalId,
            leaseToken: randomUUID(),
            leaseGeneration: 1,
            leaseExpiresAt: new Date(Date.now() - 1000),
          });
          await admin`UPDATE work_item SET source_artifact_id='artifact',source_file_sha256=${'a'.repeat(64)},source_byte_length=42`;
          await adminDb.insert(schema.actionAttempt).values({
            id: randomUUID(),
            attemptId: 'recovery-attempt',
            operationRef: recoveryCaller.attemptRef,
            tenantId: binding.tenantId,
            workItemId: binding.workItemId,
            documentVersionId: binding.documentVersionId,
            actorUserId: 'service:openclaw-main',
            actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
            status: 'COMMITTING',
            leaseOwner: queueScope.principalId,
            leaseToken: randomUUID(),
            leaseExpiresAt: new Date(Date.now() - 1000),
            commitStartedAt: new Date(Date.now() - 2000),
            taskInputHash: recoveryCaller.taskInputHash,
            resultContentHash: recoveryCaller.resultContentHash,
            taskEnvelopeJson: JSON.stringify({
              actionAttemptId: 'recovery-attempt',
              operationRef: recoveryCaller.attemptRef,
              tenantId: binding.tenantId,
              workItemId: binding.workItemId,
              documentVersionId: binding.documentVersionId,
              inputHash: recoveryCaller.taskInputHash,
              modelInput: {
                actorUserId: binding.actorUserId,
                automaticWorkItemLease: {
                  requestId: 'request',
                  leaseGeneration: 1,
                },
              },
            }),
            resultEnvelopeJson: JSON.stringify({
              contentHash: recoveryCaller.resultContentHash,
              status: 'SUCCEEDED',
            }),
          });
          const recover = (patch = {}) =>
            run({
              browserCaller: undefined,
              recoveryCaller: { ...recoveryCaller, ...patch },
            });
          await recover();
          assert.equal(
            (
              await admin`SELECT count(*)::integer AS n FROM tdms_read_receipt`
            )[0].n,
            1,
          );
          queries.length = 0;
          results.length = 0;
          await assert.rejects(
            recover({ resultContentHash: 'forged' }),
            /TDMS_COMMIT_RECOVERY_DELEGATION_REJECTED/,
          );
          noBody();
          await admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`;
          await assert.rejects(recover(), /TDMS_RECEIVER_ACTION_DENIED/);
          await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`;
          await admin`UPDATE action_attempt SET status='RUNNING' WHERE operation_ref='recovery-task'`;
          await assert.rejects(
            recover(),
            /TDMS_COMMIT_RECOVERY_DELEGATION_REJECTED/,
          );
          await admin`UPDATE action_attempt SET status='COMMITTING' WHERE operation_ref='recovery-task'`;
          await admin`UPDATE auto_work_item_authorization SET lease_generation=2`;
          await assert.rejects(
            recover(),
            /TDMS_COMMIT_RECOVERY_DELEGATION_REJECTED/,
          );
          await admin`UPDATE auto_work_item_authorization SET lease_generation=1`;
          await recover();
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

async function seedReceivers(db) {
  await db.unsafe(`CREATE FUNCTION tdms_act_bound_identity(t text,c text) RETURNS boolean LANGUAGE SQL SECURITY INVOKER AS $$
  SELECT t='tenant-a' AND c='fixture-client' AND current_schema()='${SCHEMA}' AND current_user IN ('${role}','${browserRole}') AND
   (SELECT count(*)=1 FROM identity_subject_mapping WHERE miaoda_user_id=current_setting('app.user_id',true)
    AND miaoda_tenant_id=t AND expected_client_id=c AND status='ACTIVE') $$;
  CREATE TABLE tdms_source_receiver(receiver_id text,tenant_id text,application_scope_id text,source_key text,source_instance_id text,
   scope_id text,source_subject_namespace text,source_subject_id text,authority_ref text,authority_revision text,authority_evidence_ref text,
   approved_by_subject text,approved_at timestamptz,valid_from timestamptz,valid_until timestamptz,status text,revoked_at timestamptz,revision integer);
  CREATE TABLE tdms_source_receiver_grant(receiver_id text,actor_subject_id text,source_subject_namespace text,source_subject_id text,
   permission_revision text,authority_evidence_ref text,approved_by_subject text,approved_at timestamptz,valid_from timestamptz,
   valid_until timestamptz,status text,revoked_at timestamptz,revision integer,actions_json jsonb);
  ALTER TABLE action_attempt ADD COLUMN summary_id text,ADD COLUMN summary_delegated_principal_id text;`);
  await db`INSERT INTO identity_subject_mapping(id,miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
  VALUES(${randomUUID()},'user-a','tenant-a','fixture-client','ACTIVE')`;
  await db`INSERT INTO tdms_source_receiver VALUES('receiver','tenant-a',${APP},'TDMS','instance','shared-source','TDMS_USER','source-user',
  'authority','r1','proof','approver',now()-interval '1 day',now()-interval '1 day',now()+interval '1 day','ACTIVE',NULL,1)`;
}
async function seedNative(admin, db, f, context, evidence) {
  const { binding, scope, set } = f;
  await db.insert(schema.workItem).values({
    workItemId: binding.workItemId,
    tenantId: binding.tenantId,
    requestedByUserId: binding.actorUserId,
    documentVersionId: binding.documentVersionId,
    revision: 1,
    documentId: 'doc',
    requestId: 'request',
    runKey: 'run',
  });
  await db.insert(schema.actionAttempt).values({
    id: randomUUID(),
    attemptId: 'attempt-original',
    operationRef: binding.taskContextRef,
    tenantId: binding.tenantId,
    workItemId: binding.workItemId,
    documentVersionId: binding.documentVersionId,
    actorUserId: 'service:openclaw-main',
    taskEnvelopeJson: JSON.stringify({
      modelInput: {
        actorUserId: binding.actorUserId,
        tdmsContext: context,
        privateBody: 'BODY_CANARY',
      },
    }),
    reviewActivityJson: JSON.stringify([
      { kind: 'ASSESSMENT_SOURCES_READ', nativeEvidence: [evidence] },
    ]),
  });
  for (const ref of ['work-selected', 'work-other'])
    await db.insert(schema.assessmentWorkRevision).values({
      assessmentWorkRevisionId: ref,
      workItemId: binding.workItemId,
      documentVersionId: binding.documentVersionId,
      tenantId: binding.tenantId,
      createdByUserId: binding.actorUserId,
      contentJson: JSON.stringify({ evidence: [evidence] }),
    });
  for (const [ref, value] of f.revisions)
    await admin`INSERT INTO tdms_record_revision(tenant_id,source_key,source_instance_id,scope_id,source_revision_ref,record_ref,data)
  VALUES(${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${ref},${value.record.recordRef},${JSON.stringify(value)}::jsonb)`;
  for (const [ref, value] of f.assertions)
    await admin`INSERT INTO tdms_relation_assertion(tenant_id,source_key,source_instance_id,scope_id,assertion_ref,relation_ref,data)
  VALUES(${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${ref},${value.assertion.relationRef},${JSON.stringify(value)}::jsonb)`;
  await admin`INSERT INTO tdms_processing_revision_set(tenant_id,source_key,source_instance_id,scope_id,set_revision_ref,processing_family_ref,cohort_ref,processing_observation_ref,data)
  VALUES(${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${set.setRevisionRef},${set.processingFamilyRef},${set.cohortRef},${set.processingObservationRef},${JSON.stringify(set)}::jsonb)`;
  await admin`INSERT INTO tdms_processing_set_head(tenant_id,source_key,source_instance_id,scope_id,processing_family_ref,selected_set_revision_ref,generation,data)
  VALUES(${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${set.processingFamilyRef},${set.setRevisionRef},1,${JSON.stringify(f.head)}::jsonb)`;
  const receipt = f.receipts[0];
  await admin`INSERT INTO tdms_read_receipt(tenant_id,source_key,source_instance_id,scope_id,receipt_ref,source_revision_ref,actor_id,data)
  VALUES(${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${receipt.receipt.receiptRef},${receipt.receipt.sourceRevisionRef},${receipt.actorId},${JSON.stringify(receipt)}::jsonb)`;
  const source = {
    schemaVersion: 'wiselink.tdms-formal-document-binding.v1',
    scope,
    applicationScopeId: APP,
    actorSubjectId: binding.actorUserId,
    requestId: 'capture-package',
    bindingId: 'attachment-binding',
    payloadDigest: 'payload',
    ownerSnapshotId: 'source-snapshot',
    sourceRecordId: 'source',
    sourceVersion: f.revisions.get('source').record.sourceVersion,
    businessVersion: null,
    sourceAttachmentId: 'attachment',
    sourceAttachmentVersion: null,
    sha256: 'a'.repeat(64),
    byteLength: 42,
    selection: {
      bucketId: 'bucket',
      filePath: 'path',
      expectedProviderObjectId: 'object',
    },
  };
  const descriptor = {
    identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
    pageCount: 1,
    sha256: source.sha256,
    sizeBytes: 42,
    sourceStorageKey: 'bucket:path',
    documentCode: 'SB',
    canonicalDocumentFamily: 'SB',
    issuer: 'TEST',
    businessRevision: 'A',
    revisionDate: '2026-10-01',
    sourceGeneratedDate: '2026-10-01',
    tdmsRegistration: source,
  };
  await db.insert(schema.dmPublicationFamily).values({
    id: randomUUID(),
    familyId: 'dm-family',
    canonicalIdentityKey: 'tenant:tenant-a:family:SB',
    documentFamily: 'SB',
    issuerAuthority: 'TEST',
    canonicalDocumentNumber: 'SB',
  });
  await db.insert(schema.dmSourceArtifact).values({
    id: randomUUID(),
    sourceArtifactId: 'artifact',
    sha256: source.sha256,
    byteLength: 42,
    mediaType: 'application/pdf',
    bucketId: 'bucket',
    filePath: 'path',
    readbackVerified: true,
  });
  await db.insert(schema.dmDocumentVersion).values({
    id: randomUUID(),
    documentVersionId: binding.documentVersionId,
    familyId: 'dm-family',
    sourceArtifactId: 'artifact',
    acquisitionId: 'acquisition',
    pdfSha256: source.sha256,
    byteLength: 42,
    businessRevision: 'A',
    revisionDate: '2026-10-01',
    sourceGeneratedDate: '2026-10-01',
  });
  await db.insert(schema.dmAcquisition).values({
    id: randomUUID(),
    acquisitionId: 'acquisition',
    documentVersionId: binding.documentVersionId,
    sourceArtifactId: 'artifact',
    status: 'COMMITTED_CANONICAL',
    acquiredBy: binding.actorUserId,
    selectionBucketId: 'bucket',
    selectionFilePath: 'path',
    providerObjectId: 'object',
    providerVersionId: 'v1',
    sourceDescriptorJson: JSON.stringify(descriptor),
  });
  await db.insert(schema.dmIngressPreflight).values({
    id: randomUUID(),
    preflightId: 'preflight',
    acquisitionId: 'acquisition',
    documentVersionId: binding.documentVersionId,
    status: 'COMMITTED',
    committedAt: new Date(),
    commitIdempotencyKey: 'catalog:acquisition',
    normalizedDescriptorJson: JSON.stringify(descriptor),
  });
  const capture = {
    scope,
    packageHash: 'payload',
    dailyMetadata: {
      applicationScopeId: APP,
      nativeRetention: {
        records: [
          {
            snapshotId: 'source-snapshot',
            sourceRecordId: 'source',
            nativeKind: 'MANUFACTURER_FILE',
            sourceRevisionRef: 'source',
          },
        ],
        artifacts: [
          {
            bindingId: source.bindingId,
            ownerSnapshotId: source.ownerSnapshotId,
            sourceAttachmentId: source.sourceAttachmentId,
            sourceAttachmentVersion: null,
            sha256: source.sha256,
            byteLength: 42,
            ownerSourceVersion: source.sourceVersion,
          },
        ],
      },
    },
  };
  await admin`INSERT INTO tdms_capture(tenant_id,source_key,source_instance_id,scope_id,capture_ref,package_id,data)
  VALUES(${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},'capture-source','capture-package',${JSON.stringify(capture)}::jsonb)`;
  const permittedMembers = {
    records: [...f.revisions.values()].map((v) => ({
      recordKind: v.record.recordKind,
      sourceRecordId: v.record.sourceRecordId,
    })),
    artifacts: [
      {
        memberId: source.bindingId,
        sourceAttachmentId: source.sourceAttachmentId,
        sourceAttachmentVersion: null,
        owners: [{ recordKind: 'MANUFACTURER_FILE', sourceRecordId: 'source' }],
      },
    ],
    relationIds: [...f.assertions.values()].map(
      (v) => v.assertion.sourceRelationId,
    ),
    relatedDocumentVersionIds: [],
  };
  const decision = {
    allowed: true,
    authorityRef: 'authority',
    authorityRevision: 'r1',
    authorityEvidenceRef: 'proof',
    approvedBySubject: 'approver',
    validFrom: new Date(Date.now() - 86400000).toISOString(),
    validUntil: new Date(Date.now() + 86400000).toISOString(),
    purpose: 'read',
    retainedCaptureReadAllowed: true,
    permittedMembers,
  };
  await admin`INSERT INTO tdms_source_receiver_grant VALUES('receiver',${binding.actorUserId},'TDMS_USER','source-user','permission','proof','approver',
  now()-interval '1 day',now()-interval '1 day',now()+interval '1 day','ACTIVE',NULL,1,${JSON.stringify({ READ_RECORD: decision })}::jsonb)`;
}
