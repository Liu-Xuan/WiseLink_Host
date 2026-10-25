import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
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
  tdmsRuntimeDocumentBindings,
  tdmsRuntimeDocumentHasMarker,
} = require('../../server/modules/tdms-source/tdms-runtime-document-roots.ts');
const { CanonicalJobAidProblemService } = require(
  '../../server/modules/canonical-host/canonical-jobaid-problem.service.ts',
);

const binding = {
  tenantId: 'tenant-document-roots',
  documentVersionId: 'dv-document-roots',
};
const actor = 'actor-document-roots';
const canary = 'DESCRIPTOR_BODY_MUST_STAY_IN_DATABASE';
const source = {
  schemaVersion: 'wiselink.tdms-formal-document-binding.v1',
  requestId: 'capture-document-roots',
  bindingId: 'attachment-document-roots',
  payloadDigest: 'payload-document-roots',
  scope: {
    tenantId: binding.tenantId,
    sourceKey: 'TDMS',
    sourceInstanceId: 'instance-document-roots',
    scopeId: 'scope-document-roots',
  },
  receiverId: 'receiver-document-roots',
  receiverRevision: 1,
  grantRevision: 1,
  permissionRevision: 'permission-document-roots',
  applicationScopeId: 'app_17bzc551rsg',
  actorSubjectId: actor,
  ownerSnapshotId: 'snapshot-document-roots',
  sourceRecordId: 'record-document-roots',
  number: 'SB-DOCUMENT-ROOTS',
  sourceVersion: { rawRevision: 'A', rawIteration: '1', confirmation: 'SOURCE_DECLARED' },
  businessVersion: null,
  sourceAttachmentId: 'native-attachment-document-roots',
  sourceAttachmentVersion: null,
  filename: 'document-roots.pdf',
  mediaType: 'application/pdf',
  sha256: 'a'.repeat(64),
  byteLength: 42,
  selection: {
    bucketId: 'bucket-document-roots',
    filePath: 'path-document-roots',
    expectedProviderObjectId: 'object-document-roots',
  },
};
const ordinaryDescriptor = {
  identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
  pageCount: 1,
  sha256: source.sha256,
  sizeBytes: source.byteLength,
  sourceStorageKey: `${source.selection.bucketId}:${source.selection.filePath}`,
  documentCode: source.number,
  canonicalDocumentFamily: 'SB',
  issuer: 'DOCUMENT-ROOTS-TEST',
  businessRevision: 'A',
  revisionDate: '2026-10-01',
  sourceGeneratedDate: '2026-10-01',
  privateBody: canary,
};

test(
  'runtime document marker and finite descriptor SQL preserve ordinary and fail-closed admission on owned PostgreSQL',
  { timeout: 30000 },
  async (t) => {
    const capability = await postgresCapability();
    assert.equal(capability.available, true, capability.reason);
    const owned = await startOwnedPostgres(capability);
    try {
      const admin = owned.admin;
      const login = `tdms_fixture_app_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const namespace = 'tdms_document_roots_fixture';
      await admin.unsafe(`CREATE SCHEMA ${namespace};
        SET search_path TO ${namespace},pg_catalog;
        CREATE TYPE user_profile AS(user_id text);
        CREATE ROLE ${login} LOGIN NOSUPERUSER NOBYPASSRLS;
        GRANT USAGE ON SCHEMA ${namespace} TO ${login}`);
      for (const table of [
        schema.dmDocumentVersion,
        schema.dmPublicationFamily,
        schema.dmSourceArtifact,
        schema.dmAcquisition,
        schema.dmIngressPreflight,
        schema.workItem,
        schema.assessmentWorkRevision,
      ]) {
        const config = getTableConfig(table);
        await admin.unsafe(`CREATE TABLE ${config.name}
          (${config.columns.map((column) => `"${column.name}" ${column.getSQLType()}`).join(',')});
          ALTER TABLE ${config.name} ENABLE ROW LEVEL SECURITY;
          CREATE POLICY fixture_actor ON ${config.name} FOR SELECT TO ${login}
            USING(current_setting('app.user_id',true)='${actor}');
          GRANT SELECT ON ${config.name} TO ${login}`);
      }
      await seed(drizzle(admin));
      const client = await owned.connect(login);
      await client.unsafe(`SET search_path TO ${namespace},pg_catalog`);
      await client`SELECT set_config('app.user_id',${actor},false)`;
      const statements = [], rawRows = [];
      const observed = new Proxy(client, {
        get(target, key) {
          if (key !== 'unsafe') return Reflect.get(target, key);
          return (statement, parameters) => {
            const query = target.unsafe(statement, parameters);
            const values = query.values.bind(query);
            query.values = async () => {
              const rows = await values();
              rawRows.push(rows);
              return rows;
            };
            return query;
          };
        },
      });
      const database = drizzle(observed, {
        logger: { logQuery(sql, params) { statements.push({ sql, params }); } },
      });
      const descriptor = async (value) => {
        const json = JSON.stringify(value);
        await admin`UPDATE dm_acquisition SET source_descriptor_json=${json}`;
        await admin`UPDATE dm_ingress_preflight SET normalized_descriptor_json=${json}`;
        statements.length = 0;
        rawRows.length = 0;
      };
      const checkStatements = (scopeRef = binding.documentVersionId) => {
        for (const statement of statements) {
          // This finite compatibility assertion complements actual PG execution.
          // Hosted question-mark parsing is remote; no local parser is imitated.
          assert.equal(statement.sql.includes('?'), false);
          assert.deepEqual(
            [...statement.sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1])),
            statement.params.map((_, index) => index + 1),
          );
          assert.ok(statement.params.includes(scopeRef));
          assert.equal(statement.sql.includes(scopeRef), false);
        }
      };
      await t.test('a tenant-matching joined ordinary row projects JSON and stays ordinary', async () => {
        await descriptor(ordinaryDescriptor);
        assert.deepEqual(await tdmsRuntimeDocumentBindings(database, binding), []);
        assert.equal(await tdmsRuntimeDocumentHasMarker(database, binding), false);
        assert.equal(rawRows.length, 1);
        assert.equal(rawRows[0].length, 1, 'the projection must execute for a joined ordinary row');
        const projected = rawRows[0][0].filter((value) =>
          typeof value === 'string' && value.startsWith('{'),
        ).map((value) => JSON.parse(value));
        assert.equal(projected.length, 2);
        for (const value of projected) {
          assert.equal(value.identityAuthority, ordinaryDescriptor.identityAuthority);
          assert.equal(Object.hasOwn(value, 'tdmsRegistration'), false);
        }
        assert.equal(JSON.stringify(rawRows).includes(canary), false);
        assert.equal(statements[0].params.length, 118);
        assert.equal(statements[0].params.at(-1), `tenant:${binding.tenantId}:family:`);
        checkStatements();
      });
      await t.test('an existing null marker is present and cannot become ordinary', async () => {
        await descriptor({ ...ordinaryDescriptor, tdmsRegistration: null });
        assert.equal(await tdmsRuntimeDocumentHasMarker(database, binding), true);
        await assert.rejects(tdmsRuntimeDocumentBindings(database, binding), {
          code: 'TDMS_RUNTIME_DOCUMENT_SOURCE_BINDING_INVALID',
        });
        checkStatements();
      });
      await t.test('a valid marker returns its exact binding through the finite projection', async () => {
        await descriptor({
          ...ordinaryDescriptor,
          tdmsRegistration: { ...source, privateNativeOpinion: canary },
        });
        assert.equal(await tdmsRuntimeDocumentHasMarker(database, binding), true);
        assert.deepEqual(await tdmsRuntimeDocumentBindings(database, binding), [source]);
        assert.equal(JSON.stringify(rawRows).includes(canary), false);
        checkStatements();
      });
      const workItemId = 'WI-document-roots';
      // This entry only uses the optional database and missing native verifier.
      // Execute its real SQL through the same restricted PG connection.
      const review = new CanonicalJobAidProblemService(
        ...Array(13).fill(undefined), database,
      );
      const ingress = { scope: { tenantId: binding.tenantId, workItemId } };
      await t.test('Review missing-verifier probe accepts ordinary sources but rejects any native marker', async () => {
        await descriptor(ordinaryDescriptor);
        assert.equal(await review.admitReviewSources(ingress), undefined);
        checkStatements(workItemId);
        for (const marker of [null, source]) {
          await descriptor({ ...ordinaryDescriptor, tdmsRegistration: marker });
          await assert.rejects(review.admitReviewSources(ingress),
            /TDMS_REVIEW_ADMISSION_NOT_CONNECTED/u);
          checkStatements(workItemId);
        }
      });
      await t.test('Review missing-verifier probe also rejects saved native evidence without a marker', async () => {
        await descriptor(ordinaryDescriptor);
        await admin`INSERT INTO assessment_work_revision(tenant_id,work_item_id,content_json)
          VALUES(${binding.tenantId},${workItemId},'{"evidence":[{"kind":"TDMS_NATIVE_RECORD"}]}')`;
        await assert.rejects(review.admitReviewSources(ingress),
          /TDMS_REVIEW_ADMISSION_NOT_CONNECTED/u);
        checkStatements(workItemId);
        await admin`DELETE FROM assessment_work_revision`;
      });
      await t.test('a retained marker fails closed when an inner lineage join is missing', async () => {
        await descriptor({ ...ordinaryDescriptor, tdmsRegistration: source });
        await admin`DELETE FROM dm_source_artifact`;
        assert.equal(await tdmsRuntimeDocumentHasMarker(database, binding), true);
        await assert.rejects(tdmsRuntimeDocumentBindings(database, binding), {
          code: 'TDMS_RUNTIME_DOCUMENT_SOURCE_BINDING_INVALID',
        });
        assert.equal(rawRows.at(-1).length, 0);
      });
      await t.test('the actor RLS policy still hides retained marker rows', async () => {
        await client`SELECT set_config('app.user_id','other-actor',false)`;
        assert.equal(await tdmsRuntimeDocumentHasMarker(database, binding), false);
        assert.deepEqual(await tdmsRuntimeDocumentBindings(database, binding), []);
      });
    } finally {
      await owned.stop();
    }
  },
);

async function seed(database) {
  await database.insert(schema.workItem).values({
    id: randomUUID(),
    tenantId: binding.tenantId,
    workItemId: 'WI-document-roots',
    documentVersionId: binding.documentVersionId,
  });
  await database.insert(schema.dmPublicationFamily).values({
    id: randomUUID(),
    familyId: 'family-document-roots',
    canonicalIdentityKey: `tenant:${binding.tenantId}:family:SB`,
    canonicalDocumentNumber: source.number,
    documentFamily: 'SB',
    issuerAuthority: ordinaryDescriptor.issuer,
  });
  await database.insert(schema.dmSourceArtifact).values({
    id: randomUUID(),
    sourceArtifactId: 'artifact-document-roots',
    sha256: source.sha256,
    byteLength: source.byteLength,
    mediaType: source.mediaType,
    bucketId: source.selection.bucketId,
    filePath: source.selection.filePath,
    readbackVerified: true,
  });
  await database.insert(schema.dmDocumentVersion).values({
    id: randomUUID(),
    documentVersionId: binding.documentVersionId,
    familyId: 'family-document-roots',
    sourceArtifactId: 'artifact-document-roots',
    acquisitionId: 'acquisition-document-roots',
    pdfSha256: source.sha256,
    byteLength: source.byteLength,
    businessRevision: ordinaryDescriptor.businessRevision,
    revisionDate: ordinaryDescriptor.revisionDate,
    sourceGeneratedDate: ordinaryDescriptor.sourceGeneratedDate,
  });
  await database.insert(schema.dmAcquisition).values({
    id: randomUUID(),
    acquisitionId: 'acquisition-document-roots',
    documentVersionId: binding.documentVersionId,
    sourceArtifactId: 'artifact-document-roots',
    status: 'COMMITTED_CANONICAL',
    acquiredBy: actor,
    selectionBucketId: source.selection.bucketId,
    selectionFilePath: source.selection.filePath,
    providerObjectId: source.selection.expectedProviderObjectId,
    providerVersionId: 'provider-version-document-roots',
    sourceDescriptorJson: JSON.stringify(ordinaryDescriptor),
  });
  await database.insert(schema.dmIngressPreflight).values({
    id: randomUUID(),
    preflightId: 'preflight-document-roots',
    acquisitionId: 'acquisition-document-roots',
    documentVersionId: binding.documentVersionId,
    status: 'COMMITTED',
    committedAt: new Date(),
    commitIdempotencyKey: 'catalog:acquisition-document-roots',
    normalizedDescriptorJson: JSON.stringify(ordinaryDescriptor),
  });
}
