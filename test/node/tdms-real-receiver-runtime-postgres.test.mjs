import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  postgresCapability,
  startOwnedPostgres,
} from '../pg/owned-postgres-cluster.mjs';

process.env.TS_NODE_PROJECT = fileURLToPath(
  new URL('../../tsconfig.node.json', import.meta.url),
);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const {
  TdmsReceiverRepository,
} = require('../../server/modules/tdms-source/tdms-receiver.repository.ts');
const {
  MiaodaTdmsSourceAuthorization,
} = require('../../server/modules/tdms-source/miaoda-tdms-source-authorization.ts');
const {
  MiaodaTdmsDailyArtifactStore,
} = require('../../server/modules/tdms-source/miaoda-tdms-daily-artifact-store.ts');
const {
  TdmsReceiverService,
} = require('../../server/modules/tdms-source/tdms-receiver.service.ts');
const {
  TdmsReceiverController,
} = require('../../server/modules/tdms-source/tdms-receiver.controller.ts');
const {
  TdmsDailyMetadataController,
} = require('../../server/modules/tdms-source/tdms-daily-metadata.controller.ts');
const {
  TdmsSourceService,
} = require('../../server/modules/tdms-source/tdms-source.service.ts');
const {
  MiaodaTdmsSourceRepository,
} = require('../../server/modules/tdms-source/tdms-source.repository.ts');
const {
  IdentityRepository,
} = require('../../server/modules/identity/identity.repository.ts');
const {
  SessionStore,
} = require('../../server/modules/identity/session.store.ts');
const {
  SessionResolver,
} = require('../../server/modules/identity/session-resolver.service.ts');
const {
  syntheticReceiverFixture,
} = require('../unit/tdms-source/tdms-real-receiver.fixture.ts');
const { actor } = require('../unit/tdms-source/tdms-fixtures.ts');
const { seal } = require('../unit/tdms-source/tdms-daily-source.fixture.ts');

const changeCode = 'TDMS_SOURCE_PERMISSION_CHANGED';
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function bounded(promise, label, ms = 4000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test(
  'actual TDMS receiver provider, physical RLS, session and unchanged source consumers (synthetic local only)',
  { timeout: 90000 },
  async (t) => {
    const capability = await postgresCapability();
    assert.equal(capability.available, true, capability.reason);
    const owned = await startOwnedPostgres(capability);
    const previousSandbox = process.env.SANDBOX_ID;
    try {
      const admin = owned.admin,
        f = syntheticReceiverFixture(),
        a = actor();
      const authLogin =
        'tdms_fixture_app_' + randomUUID().replaceAll('-', '').slice(0, 16);
      const serviceLogin =
        'tdms_fixture_app_' + randomUUID().replaceAll('-', '').slice(0, 16);
      await admin.unsafe(`CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
        CREATE ROLE service_role NOLOGIN NOSUPERUSER NOBYPASSRLS;
        CREATE ROLE ${authLogin} LOGIN NOSUPERUSER NOBYPASSRLS;
        CREATE ROLE ${serviceLogin} LOGIN NOSUPERUSER NOBYPASSRLS;
        GRANT authenticated TO ${authLogin}; GRANT service_role TO ${serviceLogin};
        CREATE SCHEMA receiver_fixture; SET search_path TO receiver_fixture,pg_catalog;`);
      for (const file of [
        'tdms-source-rebuild-v1.draft.sql',
        'tdms-receiver-runtime.draft.sql',
      ])
        await admin.unsafe(
          await readFile(
            new URL('../../server/database/' + file, import.meta.url),
            'utf8',
          ),
        );
      // Existing identity tables, reduced to columns the real SessionStore/Repository actually consume.
      // Tokens/mappings are local synthetic fixtures, never a Source authority.
      await admin.unsafe(`CREATE TABLE identity_subject_mapping(id uuid PRIMARY KEY,feishu_open_id text,
        feishu_tenant_key text,feishu_user_id text,miaoda_user_id text,miaoda_tenant_id text,
        expected_client_id text,status text,revision integer);
        CREATE TABLE identity_session(id uuid PRIMARY KEY,session_token_hash text,subject_mapping_id uuid,
        feishu_user_id text,revision integer,expires_at timestamptz(3),revoked_at timestamptz(3),
        last_seen_at timestamptz(3),_updated_at timestamptz(3));
        GRANT USAGE ON SCHEMA receiver_fixture TO authenticated,service_role;
        GRANT SELECT ON tdms_source_receiver,tdms_source_receiver_grant TO authenticated,service_role;
        GRANT SELECT,INSERT ON tdms_upload_selection_association TO authenticated,service_role;
        GRANT SELECT,UPDATE ON identity_session TO authenticated,service_role;
        GRANT SELECT ON identity_subject_mapping TO authenticated,service_role;`);
      // Grant UPDATE deliberately to prove that no Source UPDATE RLS policy means zero mutations.
      await admin.unsafe(
        'GRANT UPDATE ON tdms_source_receiver,tdms_source_receiver_grant TO authenticated,service_role',
      );
      for (const table of [
        'tdms_capture',
        'tdms_record',
        'tdms_record_revision',
        'tdms_relation',
        'tdms_relation_assertion',
        'tdms_read_receipt',
      ]) {
        // Base draft name is checked below; no production policy is installed here.
        const [exists] = await admin`SELECT to_regclass(${table}) AS name`;
        if (!exists.name) continue;
        await admin.unsafe(`GRANT SELECT,INSERT,UPDATE ON ${table} TO authenticated,service_role;
          CREATE POLICY local_native_scope ON ${table} TO authenticated,service_role
          USING (tenant_id='tenant-a' AND source_key='TDMS' AND source_instance_id='synthetic-instance'
            AND scope_id='synthetic-scope' AND current_setting('app.user_id',true)='123')
          WITH CHECK (tenant_id='tenant-a' AND source_key='TDMS' AND source_instance_id='synthetic-instance'
            AND scope_id='synthetic-scope' AND current_setting('app.user_id',true)='123');`);
      }
      async function seed(row, writer = admin) {
        await writer`INSERT INTO tdms_source_receiver(receiver_id,tenant_id,application_scope_id,source_key,
          source_instance_id,scope_id,source_subject_namespace,source_subject_id,authority_ref,authority_revision,
          authority_evidence_ref,approved_by_subject,approved_at,valid_from,valid_until,status,revoked_at,revision)
          VALUES(${row.receiverId},${row.tenantId},${row.applicationScopeId},${row.sourceKey},${row.sourceInstanceId},
          ${row.scopeId},${row.sourceSubjectNamespace},${row.sourceSubjectId},${row.authorityRef},${row.authorityRevision},
          ${row.authorityEvidenceRef},${row.approvedBySubject},${row.approvedAt},${row.validFrom},${row.validUntil},
          ${row.status},${row.revokedAt},${row.revision})`;
        await writer`INSERT INTO tdms_source_receiver_grant(receiver_id,actor_subject_id,source_subject_namespace,
          source_subject_id,permission_revision,authority_evidence_ref,approved_by_subject,approved_at,
          valid_from,valid_until,status,revoked_at,revision,actions_json) VALUES(${row.receiverId},${row.actorSubjectId},
          ${row.grantSourceSubjectNamespace},${row.grantSourceSubjectId},${row.permissionRevision},
          ${row.grantAuthorityEvidenceRef},${row.grantApprovedBySubject},${row.grantApprovedAt},${row.grantValidFrom},
          ${row.grantValidUntil},${row.grantStatus},${row.grantRevokedAt},${row.grantRevision},${writer.json(row.actions)})`;
      }
      await seed(f.row);
      const mappingId = randomUUID(),
        sessionId = randomUUID(),
        token = randomUUID() + randomUUID();
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await admin`INSERT INTO identity_subject_mapping VALUES(${mappingId},'synthetic-open-id','synthetic-feishu-tenant',
        NULL,${a.canonicalSubject.id},${a.tenantId},'synthetic-client','ACTIVE',1)`;
      await admin`INSERT INTO identity_session VALUES(${sessionId},${tokenHash},${mappingId},NULL,1,
        now()+interval '1 hour',NULL,now(),now())`;
      const authClient = await owned.connect(authLogin),
        serviceClient = await owned.connect(serviceLogin);
      for (const c of [authClient, serviceClient]) {
        await c.unsafe('SET search_path TO receiver_fixture,pg_catalog');
        await c`SELECT set_config('app.user_id',${a.canonicalSubject.id},false)`;
        const [id] =
          await c`SELECT current_user AS role,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user`;
        assert.equal(id.rolsuper, false);
        assert.equal(id.rolbypassrls, false);
      }
      const authDb = drizzle(authClient),
        serviceDb = drizzle(serviceClient),
        sqlScope = new AsyncLocalStorage();
      const sqlCalls = [];
      // Transport middleware double selects actual NOBYPASS SQL roles. The real SessionResolver
      // verifies the opaque session+gateway actor and owns every service scope decision.
      const db = new Proxy(
        {},
        {
          get(_target, key) {
            const target =
              sqlScope.getStore()?.isSystemAccount === true
                ? serviceDb
                : authDb;
            const v = target[key];
            return typeof v === 'function' ? v.bind(target) : v;
          },
        },
      );
      const sqlMiddleware = {
        use(request, _response, next) {
          sqlCalls.push({
            actorId: request.userContext.userId,
            service: request.userContext.isSystemAccount === true,
          });
          sqlScope.run(request.userContext, next);
        },
      };
      const sessions = new SessionResolver(
        new SessionStore(new IdentityRepository(db)),
        {
          applicationScopeId: a.applicationScopeId,
          sessionEnvironment: 'preview',
          clientId: 'synthetic-client',
        },
        sqlMiddleware,
      );
      const receivers = new TdmsReceiverRepository(db),
        authorization = new MiaodaTdmsSourceAuthorization(receivers);
      const artifacts = new MiaodaTdmsDailyArtifactStore(
        f.files,
        f.catalog,
        authorization,
        receivers,
      );
      const runtime = new TdmsReceiverService(
        receivers,
        authorization,
        artifacts,
        sessions,
      );
      const controller = new TdmsReceiverController(runtime);
      const sourceRepository = new MiaodaTdmsSourceRepository(db);
      const sources = new TdmsSourceService(
        sourceRepository,
        authorization,
        artifacts,
        {
          assertRead: async () => {
            throw new Error('unexpected formal DVI');
          },
        },
      );
      const ingress = new TdmsDailyMetadataController(sources, runtime);
      const request = {
        headers: { cookie: 'wl_session=' + token },
        userContext: {
          userId: a.canonicalSubject.id,
          tenantId: a.tenantId,
          appId: a.applicationScopeId,
          env: 'preview',
          isSystemAccount: false,
          roles: [],
        },
      };
      const scope = {
        tenantId: a.tenantId,
        sourceKey: 'TDMS',
        sourceInstanceId: f.row.sourceInstanceId,
        scopeId: f.row.scopeId,
      };
      const stage = (envelope = f.envelope, selection = f.selection) =>
        controller.stage(
          request,
          envelope.requestId,
          f.binding.bindingId,
          { package: envelope.package, selection },
          {},
        );
      const count = async () =>
        (
          await admin`SELECT count(*)::int AS n FROM tdms_upload_selection_association`
        )[0].n;
      const setActions = (
        actions,
      ) => admin`UPDATE tdms_source_receiver_grant SET actions_json=${admin.json(actions)}
        WHERE receiver_id=${f.row.receiverId} AND actor_subject_id=${a.canonicalSubject.id}`;
      const freshEnvelope = (suffix) => {
        const e = structuredClone(f.envelope);
        e.package.packageId += '-' + suffix;
        return seal(e);
      };

      await t.test(
        'unprovisioned actual authority storage is explicit503, with no login/package fallback',
        async () => {
          await admin.unsafe(
            'CREATE SCHEMA receiver_unconfigured; GRANT USAGE ON SCHEMA receiver_unconfigured TO authenticated',
          );
          await authClient.unsafe(
            'SET search_path TO receiver_unconfigured,pg_catalog',
          );
          try {
            await assert.rejects(authorization.catalogue(a, {}), {
              code: 'TDMS_RECEIVER_AUTHORITY_STORAGE_UNCONFIGURED',
              statusCode: 503,
            });
          } finally {
            await authClient.unsafe(
              'SET search_path TO receiver_fixture,pg_catalog',
            );
          }
          assert.equal(await count(), 0);
        },
      );
      await t.test(
        'binding is exact11, persistent and current-session-backed, not a grant from login',
        async () => {
          const first = await controller.binding(request, {}),
            second = await controller.binding(request, {});
          assert.equal(Object.keys(first).length, 11);
          assert.equal(first.receiverId, f.row.receiverId);
          assert.equal(
            first.sessionEvidenceRef,
            `wiselink-session:${sessionId}:1`,
          );
          const withoutTime = (v) =>
            Object.fromEntries(
              Object.entries(v).filter(([k]) => k !== 'observedAt'),
            );
          assert.deepEqual(withoutTime(first), withoutTime(second));
          await assert.rejects(
            controller.binding({ ...request, headers: {} }, {}),
            { code: 'OFFICIAL_OAUTH_SESSION_REQUIRED' },
          );
          await assert.rejects(
            controller.binding(
              {
                ...request,
                userContext: { ...request.userContext, userId: '999' },
              },
              {},
            ),
            (error) => error.message === 'DIALOGUE_BROWSER_IDENTITY_MISMATCH',
          );
        },
      );
      await t.test(
        'preflight authorizes the exact package before upload; an absent association is unavailable in both read and resolve',
        async () => {
          const before = { ...f.activity };
          assert.deepEqual(
            await controller.preflight(
              request,
              f.envelope.requestId,
              f.binding.bindingId,
              { package: f.envelope.package },
              {},
            ),
            {
              requestId: f.envelope.requestId,
              bindingId: f.binding.bindingId,
              receiverId: f.row.receiverId,
              payloadDigest: f.prepared.payloadDigest,
              status: 'AUTHORIZED_UPLOAD',
            },
          );
          assert.equal(f.activity.downloads, before.downloads);
          assert.equal(f.activity.uploads, before.uploads);
          assert.equal(await count(), 0);
          await assert.rejects(
            controller.read(
              request,
              f.envelope.requestId,
              f.binding.bindingId,
              {},
            ),
            {
              code: 'TDMS_UPLOAD_SELECTION_UNAVAILABLE',
              statusCode: 404,
            },
          );
          await assert.rejects(
            artifacts.resolveDailySelection({
              actor: a,
              scope,
              packageId: f.envelope.requestId,
              payloadDigest: f.prepared.payloadDigest,
              observation: f.binding,
            }),
            { code: 'TDMS_UPLOAD_SELECTION_UNAVAILABLE', statusCode: 404 },
          );
          assert.deepEqual(f.activity, before);
          await assert.rejects(
            async () =>
              controller.preflight(
                request,
                f.envelope.requestId,
                'wrong-binding',
                { package: f.envelope.package },
                {},
              ),
            { code: 'TDMS_UPLOAD_SELECTION_BINDING_NOT_FOUND' },
          );
          const denied = structuredClone(f.actions);
          denied.IMPORT.permittedMembers.artifacts = [];
          await setActions(denied);
          await assert.rejects(
            controller.preflight(
              request,
              f.envelope.requestId,
              f.binding.bindingId,
              { package: f.envelope.package },
              {},
            ),
            { code: 'TDMS_RECEIVER_EXACT_MEMBER_DENIED' },
          );
          assert.equal(f.activity.downloads, before.downloads);
          await setActions(f.actions);
        },
      );
      let staged;
      await t.test(
        'real provider persists stage; lost-response GET and same replay keep one row; no DVI adoption',
        async () => {
          staged = await stage();
          assert.equal(staged.status, 'STAGED_CANDIDATE');
          assert.equal(staged.documentVersionId, null);
          assert.equal(staged.readbackVerified, true);
          assert.equal(await count(), 1);
          // Simulate discarding the successful POST response, then reconcile original exact key.
          assert.deepEqual(
            await controller.read(
              request,
              f.envelope.requestId,
              f.binding.bindingId,
              {},
            ),
            staged,
          );
          assert.deepEqual(await stage(), staged);
          assert.equal(await count(), 1);
          assert.equal(
            sqlCalls.some((call) => call.service),
            true,
          );
          assert.equal(
            sqlCalls.every((call) => call.actorId === a.canonicalSubject.id),
            true,
          );
        },
      );
      await t.test(
        'authenticated SQL cannot forge server readback facts or grant itself Source access',
        async () => {
          const [stored] =
            await admin`SELECT * FROM tdms_upload_selection_association`;
          const fake = structuredClone(stored.data_json);
          fake.receipt.requestId = 'TDMSIMPORT-' + 'b'.repeat(64);
          await assert.rejects(
            authClient`INSERT INTO tdms_upload_selection_association
          (tenant_id,application_scope_id,actor_subject_id,source_key,source_instance_id,scope_id,request_id,binding_id,
          receiver_id,receiver_revision,grant_revision,permission_revision,package_id,payload_digest,member_claims_json,data_json)
          VALUES(${stored.tenant_id},${stored.application_scope_id},${stored.actor_subject_id},${stored.source_key},
          ${stored.source_instance_id},${stored.scope_id},${fake.receipt.requestId},${stored.binding_id},${stored.receiver_id},
          ${stored.receiver_revision},${stored.grant_revision},${stored.permission_revision},${stored.package_id},
          ${stored.payload_digest},${JSON.stringify(stored.member_claims_json)}::jsonb,${JSON.stringify(fake)}::jsonb)`,
            { code: '42501' },
          );
          const denied =
            await authClient`UPDATE tdms_source_receiver_grant SET status='REVOKED',revoked_at=now()
          WHERE receiver_id=${f.row.receiverId} RETURNING receiver_id`;
          assert.equal(denied.length, 0);
          const deniedService =
            await serviceClient`UPDATE tdms_source_receiver_grant SET status='REVOKED',revoked_at=now()
          WHERE receiver_id=${f.row.receiverId} RETURNING receiver_id`;
          assert.equal(deniedService.length, 0);
          assert.equal(await count(), 1);
        },
      );
      await t.test(
        'actual unchanged POST→GET→SourceRef retains exact artifact and REVIEW_REQUIRED/null',
        async () => {
          const receipt = await ingress.submit(request, f.envelope, {});
          assert.equal(receipt.artifactCount, 1);
          assert.equal(
            receipt.documentVersionMappings[0].status,
            'REVIEW_REQUIRED',
          );
          assert.equal(
            receipt.documentVersionMappings[0].documentVersionId,
            null,
          );
          const read = await ingress.read(request, f.envelope.requestId, {});
          assert.deepEqual(read.receipt, receipt);
          assert.deepEqual(read.package, f.envelope.package);
          const ref = await ingress.sourceRef(request, {
            sourceRef: receipt.sourceRefs[0],
          });
          assert.equal(
            ref.snapshot.snapshotId,
            f.envelope.package.records[0].snapshotId,
          );
          assert.deepEqual(
            await ingress.submit(request, f.envelope, {}),
            receipt,
          );
        },
      );
      await t.test(
        'conditional expected binding compares every identity field, excluding observedAt, before receiver work',
        async () => {
          const baseline = await controller.binding(request, {});
          const pinned = (value, req = request) => ({
            ...req,
            headers: {
              ...req.headers,
              'x-wiselink-tdms-expected-receiver': Buffer.from(
                JSON.stringify(value),
              ).toString('base64url'),
            },
          });
          const before = {
            downloads: f.activity.downloads,
            uploads: f.activity.uploads,
            rows: await count(),
          };
          const same = pinned({
            ...baseline,
            observedAt: '2000-01-01T00:00:00.000Z',
          });
          assert.equal(
            (
              await controller.preflight(
                same,
                f.envelope.requestId,
                f.binding.bindingId,
                { package: f.envelope.package },
                {},
              )
            ).status,
            'AUTHORIZED_UPLOAD',
          );
          for (const key of [
            'receiverId',
            'tenantRef',
            'applicationRef',
            'principalRef',
            'sourceInstanceRef',
            'authorityRevision',
            'authorityEvidenceRef',
            'sessionEvidenceRef',
          ]) {
            const changed = pinned({
              ...baseline,
              [key]: 'changed-synthetic-binding',
            });
            await assert.rejects(
              controller.stage(
                changed,
                f.envelope.requestId,
                f.binding.bindingId,
                { package: f.envelope.package, selection: f.selection },
                {},
              ),
              { code: 'TDMS_RECEIVER_IDENTITY_CHANGED', statusCode: 409 },
            );
          }
          const mismatch = pinned({
            ...baseline,
            sessionEvidenceRef: 'different-session',
          });
          await assert.rejects(ingress.submit(mismatch, f.envelope, {}), {
            code: 'TDMS_RECEIVER_IDENTITY_CHANGED',
          });
          await assert.rejects(
            ingress.read(mismatch, f.envelope.requestId, {}),
            { code: 'TDMS_RECEIVER_IDENTITY_CHANGED' },
          );
          const ref = (await admin`SELECT data FROM tdms_capture`)[0].data
            .dailyMetadata.receipt.sourceRefs[0];
          await assert.rejects(
            ingress.sourceRef(mismatch, { sourceRef: ref }),
            { code: 'TDMS_RECEIVER_IDENTITY_CHANGED' },
          );
          assert.equal(f.activity.downloads, before.downloads);
          assert.equal(f.activity.uploads, before.uploads);
          assert.equal(await count(), before.rows);
        },
      );
      await t.test(
        'a real replacement opaque session or another fully authorized actor cannot consume the old binding pin',
        async () => {
          const baseline = await controller.binding(request, {});
          const pin = Buffer.from(JSON.stringify(baseline)).toString(
            'base64url',
          );
          const nextToken = randomUUID() + randomUUID(),
            nextSessionId = randomUUID();
          const nextHash = createHash('sha256').update(nextToken).digest('hex');
          await admin`INSERT INTO identity_session VALUES(${nextSessionId},${nextHash},${mappingId},NULL,1,
          now()+interval '1 hour',NULL,now(),now())`;
          const nextRequest = {
            ...request,
            headers: {
              cookie: 'wl_session=' + nextToken,
              'x-wiselink-tdms-expected-receiver': pin,
            },
          };
          const before = f.activity.downloads;
          await assert.rejects(
            controller.preflight(
              nextRequest,
              f.envelope.requestId,
              f.binding.bindingId,
              { package: f.envelope.package },
              {},
            ),
            { code: 'TDMS_RECEIVER_IDENTITY_CHANGED', statusCode: 409 },
          );
          const otherMapping = randomUUID();
          await admin`INSERT INTO identity_subject_mapping VALUES(${otherMapping},'synthetic-other-open',
          'synthetic-feishu-tenant',NULL,'999','tenant-a','synthetic-client','ACTIVE',1)`;
          await admin`UPDATE identity_session SET subject_mapping_id=${otherMapping} WHERE id=${nextSessionId}`;
          await admin`INSERT INTO tdms_source_receiver_grant SELECT receiver_id,'999',source_subject_namespace,
          source_subject_id,permission_revision,authority_evidence_ref,approved_by_subject,approved_at,
          valid_from,valid_until,status,revoked_at,revision,actions_json FROM tdms_source_receiver_grant
          WHERE receiver_id=${f.row.receiverId} AND actor_subject_id='123'`;
          const otherRequest = {
            ...nextRequest,
            userContext: { ...request.userContext, userId: '999' },
          };
          try {
            for (const c of [authClient, serviceClient])
              await c`SELECT set_config('app.user_id','999',false)`;
            // The replacement actor has a real matching synthetic DB session and Source approval.
            // The old expected principal/session must still reject before FileService.
            await assert.rejects(
              controller.stage(
                otherRequest,
                f.envelope.requestId,
                f.binding.bindingId,
                { package: f.envelope.package, selection: f.selection },
                {},
              ),
              { code: 'TDMS_RECEIVER_IDENTITY_CHANGED', statusCode: 409 },
            );
            assert.equal(f.activity.downloads, before);
          } finally {
            for (const c of [authClient, serviceClient])
              await c`SELECT set_config('app.user_id','123',false)`;
            await admin`DELETE FROM identity_session WHERE id=${nextSessionId}`;
            await admin`DELETE FROM identity_subject_mapping WHERE id=${otherMapping}`;
            await admin`DELETE FROM tdms_source_receiver_grant WHERE receiver_id=${f.row.receiverId} AND actor_subject_id='999'`;
          }
        },
      );
      await t.test(
        'changed selection cannot overwrite the same request/binding association',
        async () => {
          const original = f.objects.get(f.selection.filePath);
          const otherPath = 'tdms-source/uploads/synthetic-second-object';
          f.objects.set(otherPath, {
            bytes: Buffer.from(f.bytes),
            metadata: {
              ...original.metadata,
              filePath: otherPath,
              id: 'synthetic-object-2',
            },
          });
          await assert.rejects(
            stage(f.envelope, {
              ...f.selection,
              filePath: otherPath,
              expectedProviderObjectId: 'synthetic-object-2',
            }),
            { code: 'TDMS_UPLOAD_ASSOCIATION_CONFLICT', statusCode: 409 },
          );
          assert.equal(await count(), 1);
          assert.deepEqual(
            await controller.read(
              request,
              f.envelope.requestId,
              f.binding.bindingId,
              {},
            ),
            staged,
          );
        },
      );
      await t.test(
        'resolve rejects another package digest or observation instead of trusting stored verified flag',
        async () => {
          for (const altered of [
            { payloadDigest: 'f'.repeat(64) },
            {
              observation: {
                ...f.binding,
                sourceVersion: { ...f.binding.sourceVersion, rawRevision: 'B' },
              },
            },
          ])
            await assert.rejects(
              artifacts.resolveDailySelection({
                actor: a,
                scope,
                packageId: f.envelope.requestId,
                payloadDigest: f.prepared.payloadDigest,
                observation: f.binding,
                ...altered,
              }),
              { code: 'TDMS_UPLOAD_ASSOCIATION_PACKAGE_CONFLICT' },
            );
        },
      );
      for (const field of ['bucket', 'owner', 'object', 'length', 'bytes'])
        await t.test(
          'current FileService ' +
            field +
            ' mismatch is denied before association',
          async () => {
            const envelope = freshEnvelope(field),
              object = f.objects.get(f.selection.filePath);
            const previous = {
              bytes: Buffer.from(object.bytes),
              metadata: structuredClone(object.metadata),
            };
            const before = await count();
            let selection = f.selection;
            if (field === 'bucket')
              selection = { ...f.selection, bucketId: 'other-bucket' };
            if (field === 'owner') object.metadata.createdBy.userID = '999';
            if (field === 'object')
              object.metadata.id = 'replacement-version-object';
            if (field === 'length') object.metadata.metadata.contentLength++;
            if (field === 'bytes') object.bytes[0] ^= 1;
            try {
              await assert.rejects(stage(envelope, selection), {
                code:
                  field === 'bytes'
                    ? 'TDMS_UPLOAD_SELECTION_READBACK_MISMATCH'
                    : 'TDMS_UPLOAD_SELECTION_FORBIDDEN',
              });
              assert.equal(await count(), before);
            } finally {
              f.objects.set(f.selection.filePath, previous);
            }
          },
        );
      await t.test(
        'current object/version is rechecked when resolving an already persisted association',
        async () => {
          const object = f.objects.get(f.selection.filePath),
            old = object.metadata.id;
          object.metadata.id = 'replacement-version-object';
          try {
            await assert.rejects(
              artifacts.resolveDailySelection({
                actor: a,
                scope,
                packageId: f.envelope.requestId,
                payloadDigest: f.prepared.payloadDigest,
                observation: f.binding,
              }),
              { code: 'TDMS_UPLOAD_SELECTION_FORBIDDEN' },
            );
          } finally {
            object.metadata.id = old;
          }
        },
      );
      await t.test(
        'generic catalogue/record/history/relations cannot bypass a same-scope exact record revocation',
        async () => {
          const nativeRows = await admin`SELECT data FROM tdms_record_revision`;
          const allowed = nativeRows.find(
            (row) =>
              row.data.record.sourceRecordId ===
              f.envelope.package.records[0].sourceRecordId,
          ).data;
          const denied = nativeRows.find(
            (row) =>
              row.data.record.sourceRecordId ===
              f.envelope.package.records[1].sourceRecordId,
          ).data;
          const narrowed = structuredClone(f.actions);
          for (const action of [
            'CATALOGUE',
            'READ_RECORD',
            'READ_HISTORY',
            'READ_RELATIONS',
          ])
            narrowed[action].permittedMembers.records = narrowed[
              action
            ].permittedMembers.records.filter(
              (record) =>
                record.sourceRecordId === allowed.record.sourceRecordId,
            );
          await setActions(narrowed);
          try {
            await assert.rejects(
              sources.readRecord(a, denied.record.sourceRevisionRef),
              { code: 'TDMS_RECEIVER_EXACT_MEMBER_DENIED', statusCode: 403 },
            );
            await assert.rejects(
              sources.history(a, denied.record.sourceRevisionRef),
              { code: 'TDMS_RECEIVER_EXACT_MEMBER_DENIED', statusCode: 403 },
            );
            await assert.rejects(
              sources.readRelations(a, denied.record.sourceRevisionRef),
              {
                code: 'TDMS_READ_MEMBER_SCOPE_ADMISSION_REQUIRED',
                statusCode: 403,
              },
            );
            const catalogue = await sources.catalogue(a);
            assert.deepEqual(
              catalogue.records.map((record) => record.sourceRecordId),
              [allowed.record.sourceRecordId],
            );
            assert.equal(
              (await sources.readRecord(a, allowed.record.sourceRevisionRef))
                .record.sourceRecordId,
              allowed.record.sourceRecordId,
            );
          } finally {
            await setActions(f.actions);
          }
        },
      );
      await t.test(
        'catalogue applies current exact records before the physical SQL page limit',
        async () => {
          const [template] =
            await admin`SELECT data FROM tdms_record_revision LIMIT 1`;
          for (let i = 0; i < 52; i++) {
            const stored = structuredClone(template.data),
              sourceId = 'OR:wt.doc.WTDocument:' + (80000 + i);
            Object.assign(stored.record, {
              recordRef: 'synthetic-denied-record-' + i,
              sourceRevisionRef: '000-synthetic-denied-revision-' + i,
              sourceRecordId: sourceId,
              artifacts: [],
            });
            stored.artifactIdentities = [];
            await admin`INSERT INTO tdms_record_revision VALUES(${scope.tenantId},${scope.sourceKey},
            ${scope.sourceInstanceId},${scope.scopeId},${stored.record.sourceRevisionRef},${stored.record.recordRef},${admin.json(stored)})`;
            const head = {
              scope,
              recordRef: stored.record.recordRef,
              sourceRecordId: sourceId,
              recordKind: stored.record.recordKind,
              sourceRevisionRef: stored.record.sourceRevisionRef,
              observedAt: stored.record.observedAt,
            };
            await admin`INSERT INTO tdms_record VALUES(${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},
            ${scope.scopeId},${head.recordKind},${sourceId},${head.recordRef},${head.sourceRevisionRef},${admin.json(head)})`;
          }
          const result = await sources.catalogue(a);
          assert.deepEqual(
            result.records.map((record) => record.sourceRecordId).sort(),
            f.envelope.package.records
              .map((record) => record.sourceRecordId)
              .sort(),
          );
          assert.equal(result.hasMore, false);
          assert.equal(result.nextAfter, null);
        },
      );
      await t.test(
        'an original conditional pin still rejects a valid revision change after the initial verification transaction',
        async () => {
          const baseline = await controller.binding(request, {}),
            before = await count(),
            downloads = f.activity.downloads;
          const pinned = {
            ...request,
            headers: {
              ...request.headers,
              'x-wiselink-tdms-expected-receiver': Buffer.from(
                JSON.stringify(baseline),
              ).toString('base64url'),
            },
          };
          const original = receivers.transaction.bind(receivers);
          let changed = false;
          receivers.transaction = async (operation) => {
            const result = await original(operation);
            if (!changed) {
              changed = true;
              await admin`UPDATE tdms_source_receiver_grant SET permission_revision='synthetic-still-approved-after-pin'
              WHERE receiver_id=${f.row.receiverId}`;
            }
            return result;
          };
          try {
            await assert.rejects(
              controller.stage(
                pinned,
                f.envelope.requestId,
                f.binding.bindingId,
                { package: f.envelope.package, selection: f.selection },
                {},
              ),
              { code: 'TDMS_RECEIVER_IDENTITY_CHANGED', statusCode: 409 },
            );
          } finally {
            receivers.transaction = original;
          }
          assert.equal(changed, true);
          assert.equal(await count(), before);
          assert.equal(f.activity.downloads, downloads);
        },
      );
      for (const operation of ['capture', 'receipt-read'])
        await t.test(
          'original daily ' +
            operation +
            ' carries its conditional pin into the actual consumer transaction',
          async () => {
            const baseline = await controller.binding(request, {});
            const pinned = {
              ...request,
              headers: {
                ...request.headers,
                'x-wiselink-tdms-expected-receiver': Buffer.from(
                  JSON.stringify(baseline),
                ).toString('base64url'),
              },
            };
            const envelope = freshEnvelope('conditional-' + operation);
            envelope.package.artifactBindings = [];
            seal(envelope);
            const before = (
              await admin`SELECT count(*)::int AS n FROM tdms_capture`
            )[0].n;
            const original = receivers.transaction.bind(receivers);
            let changed = false;
            receivers.transaction = async (op) => {
              const result = await original(op);
              if (!changed) {
                changed = true;
                await admin`UPDATE tdms_source_receiver_grant SET permission_revision=${'synthetic-conditional-' + operation}
              WHERE receiver_id=${f.row.receiverId}`;
              }
              return result;
            };
            try {
              await assert.rejects(
                operation === 'capture'
                  ? ingress.submit(pinned, envelope, {})
                  : ingress.read(pinned, f.envelope.requestId, {}),
                { code: 'TDMS_RECEIVER_IDENTITY_CHANGED', statusCode: 409 },
              );
            } finally {
              receivers.transaction = original;
            }
            assert.equal(changed, true);
            assert.equal(
              (await admin`SELECT count(*)::int AS n FROM tdms_capture`)[0].n,
              before,
            );
          },
        );
      await t.test(
        'independent READ_RECORD and READ_HISTORY revocation do not become missing uploads or IMPORT rights',
        async () => {
          const denied = structuredClone(f.actions);
          denied.READ_RECORD.allowed = false;
          await setActions(denied);
          await assert.rejects(
            controller.read(
              request,
              f.envelope.requestId,
              f.binding.bindingId,
              {},
            ),
            (error) =>
              error.code === 'TDMS_SOURCE_NOT_FOUND' &&
              error.code !== 'TDMS_UPLOAD_SELECTION_UNAVAILABLE',
          );
          await authorization.authorizeImport(
            a,
            scope,
            f.prepared.memberClaims,
          );
          await ingress.read(request, f.envelope.requestId, {});
          denied.READ_RECORD.allowed = true;
          denied.READ_HISTORY.allowed = false;
          await setActions(denied);
          await assert.rejects(
            ingress.read(request, f.envelope.requestId, {}),
            { code: 'TDMS_SOURCE_NOT_FOUND' },
          );
          await ingress.sourceRef(request, {
            sourceRef: (await admin`SELECT data FROM tdms_capture`)[0].data
              .dailyMetadata.receipt.sourceRefs[0],
          });
          await setActions(f.actions);
        },
      );
      await t.test(
        'actual DB scope remains closed to another tenant/application/user, and multiple scopes are explicit',
        async () => {
          for (const input of [
            {
              ...a,
              tenantId: 'other',
              subjectDecision: { ...a.subjectDecision, tenantId: 'other' },
            },
            {
              ...a,
              applicationScopeId: 'other',
              subjectDecision: {
                ...a.subjectDecision,
                applicationScopeId: 'other',
              },
            },
            { ...a, canonicalSubject: { ...a.canonicalSubject, id: '999' } },
          ])
            await assert.rejects(
              authorization.authorizeImport(
                input,
                { ...scope, tenantId: input.tenantId },
                f.prepared.memberClaims,
              ),
            );
          await seed({
            ...f.row,
            receiverId: 'synthetic-second-receiver',
            scopeId: 'synthetic-second-scope',
          });
          try {
            await assert.rejects(
              controller.preflight(
                request,
                f.envelope.requestId,
                f.binding.bindingId,
                { package: f.envelope.package },
                {},
              ),
              { code: 'TDMS_DAILY_SOURCE_SCOPE_AMBIGUOUS' },
            );
          } finally {
            await admin`DELETE FROM tdms_source_receiver_grant WHERE receiver_id='synthetic-second-receiver'`;
            await admin`DELETE FROM tdms_source_receiver WHERE receiver_id='synthetic-second-receiver'`;
          }
        },
      );
      await t.test(
        'the original receiver pin selects only its actual authorized Source scope across daily and selection consumers',
        async () => {
          const envelope = freshEnvelope('v3-pinned-selection');
          const baseline = await controller.binding(request, {
            receiverId: f.row.receiverId,
          });
          const pinned = (value) => ({
            ...request,
            headers: {
              ...request.headers,
              'x-wiselink-tdms-expected-receiver': Buffer.from(
                JSON.stringify(value),
              ).toString('base64url'),
            },
          });
          const matching = pinned(baseline);
          const receipt = await controller.stage(
            matching,
            envelope.requestId,
            f.binding.bindingId,
            { package: envelope.package, selection: f.selection },
            {},
          );
          const stored = await receivers.selection(
            a,
            scope,
            envelope.requestId,
            f.binding.bindingId,
          );
          assert.ok(stored);
          const originalReceipt = await ingress.read(
            request,
            f.envelope.requestId,
            {},
          );
          for (const [suffix, instance] of [
            ['other-instance', 'synthetic-other-instance'],
            ['same-instance', scope.sourceInstanceId],
          ]) {
            const other = {
              ...f.row,
              receiverId: 'synthetic-pin-' + suffix,
              sourceInstanceId: instance,
              scopeId: 'synthetic-pin-' + suffix,
            };
            await seed(other);
            try {
              const foreign = pinned(
                await controller.binding(request, {
                  receiverId: other.receiverId,
                }),
              );
              const activity = { ...f.activity };
              await assert.rejects(
                ingress.read(foreign, f.envelope.requestId, {}),
                { code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 },
              );
              await assert.rejects(
                ingress.sourceRef(foreign, {
                  sourceRef: originalReceipt.receipt.sourceRefs[0],
                }),
                { code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 },
              );
              await assert.rejects(
                controller.read(
                  foreign,
                  envelope.requestId,
                  f.binding.bindingId,
                  {},
                ),
                {
                  code: 'TDMS_UPLOAD_SELECTION_UNAVAILABLE',
                  statusCode: 404,
                },
              );
              await assert.rejects(
                controller.binding(foreign, {
                  receiverId: f.row.receiverId,
                }),
                { code: 'TDMS_RECEIVER_IDENTITY_CHANGED', statusCode: 409 },
              );
              await assert.rejects(
                runtime.withExpected(foreign, () =>
                  artifacts.resolveDailySelection({
                    actor: a,
                    scope,
                    packageId: envelope.requestId,
                    payloadDigest: stored.payloadDigest,
                    observation: stored.observation,
                  }),
                ),
                { code: 'TDMS_RECEIVER_IDENTITY_CHANGED', statusCode: 409 },
              );
              await assert.rejects(
                runtime.withExpected(foreign, () =>
                  artifacts.acquireSelection({
                    actor: a,
                    scope,
                    packageId: envelope.requestId,
                    artifact: stored.artifact,
                  }),
                ),
                { code: 'TDMS_RECEIVER_IDENTITY_CHANGED', statusCode: 409 },
              );
              assert.deepEqual(f.activity, activity);
              assert.deepEqual(
                await ingress.read(matching, f.envelope.requestId, {}),
                originalReceipt,
              );
              assert.equal(
                (
                  await ingress.sourceRef(matching, {
                    sourceRef: originalReceipt.receipt.sourceRefs[0],
                  })
                ).sourceRef,
                originalReceipt.receipt.sourceRefs[0],
              );
              assert.deepEqual(
                await controller.read(
                  matching,
                  envelope.requestId,
                  f.binding.bindingId,
                  {},
                ),
                receipt,
              );
              assert.deepEqual(
                await controller.stage(
                  matching,
                  envelope.requestId,
                  f.binding.bindingId,
                  { package: envelope.package, selection: f.selection },
                  {},
                ),
                receipt,
              );
              assert.equal(
                (
                  await controller.preflight(
                    matching,
                    envelope.requestId,
                    f.binding.bindingId,
                    { package: envelope.package },
                    {},
                  )
                ).receiverId,
                f.row.receiverId,
              );
              assert.deepEqual(
                await ingress.read(request, f.envelope.requestId, {}),
                originalReceipt,
              );
              await assert.rejects(
                controller.preflight(
                  request,
                  envelope.requestId,
                  f.binding.bindingId,
                  { package: envelope.package },
                  {},
                ),
                { code: 'TDMS_DAILY_SOURCE_SCOPE_AMBIGUOUS' },
              );
              if (suffix === 'same-instance') {
                const captured = freshEnvelope('v3-pin-capture-' + suffix);
                captured.package.artifactBindings = [];
                seal(captured);
                await ingress.submit(matching, captured, {});
                assert.deepEqual(
                  (
                    await admin`SELECT data FROM tdms_capture WHERE package_id=${captured.requestId}`
                  )[0].data.scope,
                  scope,
                );
                // A pin resolves the receiver, never two captures sharing one SourceRef.
                await assert.rejects(
                  ingress.sourceRef(matching, {
                    sourceRef: originalReceipt.receipt.sourceRefs[0],
                  }),
                  { code: 'TDMS_DAILY_REFERENCE_AMBIGUOUS', statusCode: 409 },
                );
              }
            } finally {
              await admin`DELETE FROM tdms_source_receiver_grant WHERE receiver_id=${other.receiverId}`;
              await admin`DELETE FROM tdms_source_receiver WHERE receiver_id=${other.receiverId}`;
            }
          }
        },
      );
      await t.test(
        'RLS-hidden associations share unavailable404 with absence in GET and resolve; exact preflight still rejects with zero file I/O',
        async () => {
          const visible = async () =>
            (
              await authClient`SELECT count(*)::int AS n FROM tdms_upload_selection_association`
            )[0].n;
          const before = await visible();
          assert.ok(before > 0);
          assert.equal(before, await count());
          try {
            const denied = structuredClone(f.actions);
            denied.READ_RECORD.permittedMembers = {
              records: [],
              relationIds: [],
              artifacts: [],
            };
            await setActions(denied);
            assert.equal(await visible(), 0);
            assert.ok((await count()) > 0);
            const activity = { ...f.activity };
            await assert.rejects(
              controller.read(
                request,
                f.envelope.requestId,
                f.binding.bindingId,
                {},
              ),
              { code: 'TDMS_UPLOAD_SELECTION_UNAVAILABLE', statusCode: 404 },
            );
            await assert.rejects(
              artifacts.resolveDailySelection({
                actor: a,
                scope,
                packageId: f.envelope.requestId,
                payloadDigest: f.prepared.payloadDigest,
                observation: f.binding,
              }),
              { code: 'TDMS_UPLOAD_SELECTION_UNAVAILABLE', statusCode: 404 },
            );
            await assert.rejects(
              controller.preflight(
                request,
                f.envelope.requestId,
                f.binding.bindingId,
                { package: f.envelope.package },
                {},
              ),
              { code: 'TDMS_RECEIVER_EXACT_MEMBER_DENIED', statusCode: 403 },
            );
            assert.deepEqual(f.activity, activity);

            const metadata = structuredClone(f.actions);
            assert.ok(metadata.READ_RECORD.permittedMembers.artifacts.length);
            for (const artifact of metadata.READ_RECORD.permittedMembers
              .artifacts) {
              assert.notEqual(artifact.metadataOnly, true);
              artifact.metadataOnly = true;
            }
            await setActions(metadata);
            assert.equal(await visible(), 0);

            const wider = structuredClone(f.actions);
            const members = wider.READ_RECORD.permittedMembers;
            for (const artifact of members.artifacts) {
              const owner = {
                ...artifact.owners[0],
                sourceRecordId: artifact.owners[0].sourceRecordId + '0',
              };
              members.records.push(owner);
              artifact.owners.push(owner);
            }
            await setActions(wider);
            assert.equal(await visible(), before);
          } finally {
            await setActions(f.actions);
          }
        },
      );
      await t.test(
        'Source revoke during remote FileService I/O does not wait on a SQL lock and prevents commit',
        async () => {
          const before = await count();
          let revoked = false;
          f.activity.onDownload = async () => {
            f.activity.onDownload = undefined;
            await bounded(
              admin`UPDATE tdms_source_receiver_grant SET status='REVOKED',revoked_at=now()
            WHERE receiver_id=${f.row.receiverId}`,
              'Source revoke blocked over remote I/O',
            );
            revoked = true;
          };
          await assert.rejects(
            stage(freshEnvelope('revoke-during-io')),
            (error) =>
              ['TDMS_SOURCE_NOT_FOUND', changeCode].includes(error.code),
          );
          assert.equal(revoked, true);
          assert.equal(await count(), before);
          await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE',revoked_at=NULL WHERE receiver_id=${f.row.receiverId}`;
        },
      );
      await t.test(
        'short transaction shared Source fence makes the actual revoke wait, without any UPDATE policy',
        async () => {
          const locked = deferred(),
            release = deferred();
          const active = receivers.transaction(async () => {
            await authorization.current(a, scope, 'IMPORT');
            locked.resolve();
            await release.promise;
          });
          await bounded(locked.promise, 'Source shared lock not acquired');
          const observer = await owned.connect();
          const [backend] = await admin`SELECT pg_backend_pid() AS pid`;
          const revoke =
            admin`UPDATE tdms_source_receiver_grant SET status='REVOKED',revoked_at=now()
          WHERE receiver_id=${f.row.receiverId}`.execute();
          let waiting = false;
          try {
            const stop = Date.now() + 4000;
            while (Date.now() < stop) {
              const [row] =
                await observer`SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=${backend.pid}`;
              if (
                row?.wait_event_type === 'Lock' &&
                row.wait_event === 'advisory'
              ) {
                waiting = true;
                break;
              }
              await new Promise((r) => setTimeout(r, 15));
            }
            assert.equal(
              waiting,
              true,
              'must observe a real PG advisory wait, not a timing mock',
            );
          } finally {
            release.resolve();
            await active;
            await revoke;
          }
          t.diagnostic('LOCAL_SOURCE_REVOKE_REAL_ADVISORY_WAIT=1');
          await assert.rejects(
            authorization.authorizeImport(a, scope, f.prepared.memberClaims),
            { code: 'TDMS_SOURCE_NOT_FOUND' },
          );
          await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE',revoked_at=NULL WHERE receiver_id=${f.row.receiverId}`;
        },
      );
      await t.test(
        'a scope replaced while waiting cannot admit a newly discovered receiver without its lock',
        async () => {
          const ownedLock = deferred(),
            change = deferred(),
            replacementId = 'synthetic-replacement-receiver';
          const replacement = admin.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtextextended('wiselink:tdms-receiver:' || ${f.row.receiverId},0))`;
            ownedLock.resolve();
            await change.promise;
            await tx`UPDATE tdms_source_receiver SET scope_id='synthetic-old-scope' WHERE receiver_id=${f.row.receiverId}`;
            await seed({ ...f.row, receiverId: replacementId }, tx);
          });
          await bounded(ownedLock.promise, 'controlled Source lock missing');
          const [backend] = await authClient`SELECT pg_backend_pid() AS pid`;
          const observer = await owned.connect();
          const reading = assert.rejects(
            receivers.transaction(() =>
              authorization.current(a, scope, 'IMPORT'),
            ),
            { code: 'TDMS_SOURCE_PERMISSION_CHANGED', statusCode: 409 },
          );
          let waiting = false;
          try {
            const until = Date.now() + 4000;
            while (Date.now() < until) {
              const [row] =
                await observer`SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=${backend.pid}`;
              if (
                row?.wait_event_type === 'Lock' &&
                row.wait_event === 'advisory'
              ) {
                waiting = true;
                break;
              }
              await new Promise((r) => setTimeout(r, 15));
            }
            assert.equal(waiting, true);
          } finally {
            change.resolve();
            await replacement;
          }
          try {
            await bounded(reading, 'replacement Source read did not finish');
          } finally {
            await admin`DELETE FROM tdms_source_receiver_grant WHERE receiver_id=${replacementId}`;
            await admin`DELETE FROM tdms_source_receiver WHERE receiver_id=${replacementId}`;
            await admin`UPDATE tdms_source_receiver SET scope_id=${f.row.scopeId} WHERE receiver_id=${f.row.receiverId}`;
          }
          t.diagnostic('LOCAL_SOURCE_SCOPE_REPLACEMENT_REAL_ADVISORY_WAIT=1');
        },
      );
      await t.test(
        'session revoked while I/O is in flight is revalidated by real SessionStore at commit',
        async () => {
          const before = await count();
          let revoked = false;
          f.activity.onDownload = async () => {
            f.activity.onDownload = undefined;
            await bounded(
              admin`UPDATE identity_session SET revoked_at=now() WHERE id=${sessionId}`,
              'Session held over remote I/O',
            );
            revoked = true;
          };
          await assert.rejects(stage(freshEnvelope('session-revoked')), {
            code: 'OFFICIAL_OAUTH_SESSION_REQUIRED',
          });
          assert.equal(revoked, true);
          assert.equal(await count(), before);
        },
      );
      const [policies] =
        await admin`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='receiver_fixture'
        AND tablename IN ('tdms_source_receiver','tdms_source_receiver_grant') AND cmd IN ('UPDATE','INSERT','DELETE','ALL')`;
      assert.equal(policies.n, 0);
      t.diagnostic(
        'NO_EXTERNAL_ACTIONS; actual Source grants/Native/platform proof are not configured by these synthetic tests',
      );
    } finally {
      await owned.stop();
      if (previousSandbox === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = previousSandbox;
    }
  },
);
