import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  postgresCapability,
  startOwnedPostgres,
} from '../pg/owned-postgres-cluster.mjs';

// Physical SQL/Catalog/native integration only. Source authorization and FileService
// are explicit doubles; the owned-postgres helper never accepts an external URL.
const capability = await postgresCapability();
const scope = {
  tenantId: 'tenant-a',
  sourceKey: 'TDMS',
  sourceInstanceId: 'fixture-instance',
  scopeId: 'fixture-scope',
};
const uploadPath = 'tdms-source/uploads/owned-object.bin';
const bytes = Buffer.alloc(600 * 1024, 0x42);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const normalize = (path) => path.replace(/^\/+/, '');

function fileServiceDouble(options = {}) {
  const objects = new Map();
  let metadataReads = 0;
  let uploads = 0;
  const metadata = (path, id, owner = '123') => ({
    bucketID: 'fixture-bucket',
    filePath: path,
    id,
    name: 'source.bin',
    createdBy: { userID: owner },
    metadata: {
      mimeType: 'application/octet-stream',
      contentLength: bytes.length,
    },
  });
  objects.set(uploadPath, {
    bytes,
    metadata: metadata(uploadPath, 'uploaded-object', options.deniedOwner ? 'other' : '123'),
  });
  return {
    objects,
    metadata,
    stats: () => ({ metadataReads, uploads }),
    files: {
      getDefaultBucket: async () => 'fixture-bucket',
      from: (bucket) => ({
        getFileMetadata: async (path) => {
          metadataReads++;
          const value = objects.get(normalize(path))?.metadata ?? null;
          if (options.drift && metadataReads === 3 && normalize(path) === uploadPath && value)
            return { ...value, id: 'changed-object' };
          return value;
        },
        download: (path) => ({
          asStream: async () => {
            const value = objects.get(normalize(path));
            if (!value) throw new Error('FIXTURE_FILE_MISSING');
            return { metadata: value.metadata, content: value.bytes };
          },
        }),
        upload: async (body, opts) => {
          uploads++;
          assert.equal(opts.upsert, false);
          const value = metadata(opts.filePath, 'new-canonical');
          objects.set(normalize(opts.filePath), {
            metadata: value,
            bytes: Buffer.from(body),
          });
          return value;
        },
      }),
    },
  };
}

test(
  'owned PostgreSQL: FileService metadata selection through actual TDMS service, Repository, Catalog and SQL',
  { skip: capability.available ? false : capability.reason, timeout: 120000 },
  async (t) => {
    const owned = await startOwnedPostgres(capability);
    try {
      t.diagnostic(`TDMS_OWNED_PG_IDENTITY ${JSON.stringify({
        expected: owned.expected,
        instance: owned.instance,
        identity: owned.identity,
      })}`);
      process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
      process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
        module: 'CommonJS', moduleResolution: 'node',
      });
      const require = createRequire(import.meta.url);
      require('ts-node/register/transpile-only');
      require('tsconfig-paths/register');
      const { drizzle } = require('drizzle-orm/postgres-js');
      const { MiaodaHostedDocumentCatalog } = require('../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.ts');
      const { MiaodaTdmsArtifactStore } = require('../../server/modules/tdms-source/miaoda-tdms-artifact-store.ts');
      const { MiaodaTdmsSourceRepository } = require('../../server/modules/tdms-source/tdms-source.repository.ts');
      const { TdmsSourceService } = require('../../server/modules/tdms-source/tdms-source.service.ts');
      const { HostDecisionTdmsSourceAuthorization } = require('../../server/modules/tdms-source/tdms-source.authorization.ts');
      const { fixture, actor } = require('../unit/tdms-source/tdms-fixtures.ts');
      const nativeDdl = await readFile(new URL('../../server/database/tdms-source-rebuild-v1.draft.sql', import.meta.url), 'utf8');
      const catalogDdl = await readFile(new URL('../../migrations/0001_document_management_hosted_catalog.sql', import.meta.url), 'utf8');

      async function setup(label, options = {}) {
        const schema = 'tdms_sel_' + randomUUID().replaceAll('-', '').slice(0, 16);
        await owned.admin.unsafe(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},pg_catalog; CREATE TYPE user_profile AS (uid text)`);
        for (const name of ['dm_source_artifact', 'dm_acquisition']) {
          const statement = catalogDdl.match(new RegExp(`CREATE TABLE ${name} \\([\\s\\S]*?\\n\\);`))?.[0];
          assert.ok(statement, `existing Catalog DDL for ${name}`);
          await owned.admin.unsafe(statement);
        }
        await owned.admin.unsafe(nativeDdl);
        const sql = await owned.connect();
        await sql.unsafe(`SET search_path TO ${schema},pg_catalog`);
        await sql`SELECT set_config('app.user_id','123',false)`;
        const catalogSql = options.sharedPool ? sql : await owned.connect();
        if (!options.sharedPool) {
          await catalogSql.unsafe(`SET search_path TO ${schema},pg_catalog`);
          await catalogSql`SELECT set_config('app.user_id','123',false)`;
        }
        const catalog = new MiaodaHostedDocumentCatalog(drizzle(catalogSql));
        const storage = fileServiceDouble(options);
        let permitted = !options.deniedMembers;
        const authorization = new HostDecisionTdmsSourceAuthorization(
          async () => [{ scope, permissionRevision: 'fixture-1' }],
          async ({ claims, grant }) => ({
            ...grant,
            authorityRef: 'fixture-only-rights',
            captureRetentionAllowed: true,
            nativeProjectionAllowed: true,
            permittedMembers: {
              ...claims,
              artifacts: permitted ? claims.artifacts : [],
            },
          }),
        );
        const service = new TdmsSourceService(
          new MiaodaTdmsSourceRepository(drizzle(sql)),
          authorization,
          new MiaodaTdmsArtifactStore(storage.files, catalog),
          { assertRead: async () => { throw new Error('NO_DV_IN_SELECTION_FIXTURE'); } },
        );
        const packet = fixture();
        packet.packageId = label;
        const input = {
          sourceKey: scope.sourceKey,
          sourceInstanceId: scope.sourceInstanceId,
          scopeId: scope.scopeId,
          package: packet,
          artifactSelections: [{
            memberId: 'member',
            sourceAttachmentId: 'source-attachment',
            sourceAttachmentVersion: '1',
            fileName: 'original.eb',
            mediaType: 'application/octet-stream',
            sha256,
            byteLength: bytes.length,
            ownerItemIds: ['a'],
            selection: {
              bucketId: 'fixture-bucket',
              filePath: uploadPath,
              expectedProviderObjectId: 'uploaded-object',
            },
          }],
        };
        assert.ok(Buffer.byteLength(JSON.stringify(input)) < 512 * 1024);
        return { schema, sql, catalogSql, catalog, storage, service, input,
          setPermitted: (value) => { permitted = value; } };
      }
      async function count(schema, table) {
        const [row] = await owned.admin.unsafe(`SELECT count(*)::int AS n FROM ${schema}.${table}`);
        return row.n;
      }

      await t.test('fresh candidate keeps source NOT_READ distinct from verified Host bytes and replays without duplication', async () => {
        const s = await setup('FRESH-SELECTION');
        s.input.package.records[0].unreadAttachments = [{
          sourceAttachmentId: 'source-attachment',
          sourceAttachmentVersion: '1',
          fileName: 'original.eb',
          mediaType: 'application/octet-stream',
          byteLength: bytes.length,
          readStatus: 'NOT_READ',
          gap: 'source metadata only',
          selector: 'attachment.row',
        }];
        const first = await s.service.importFileServicePackage(actor(), s.input);
        assert.equal(first.created, true);
        assert.equal(first.artifactBindings[0].documentVersionId, null);
        const read = await s.service.readRecord(actor(), first.recordRevisionRefs[0]);
        assert.equal(read.record.unreadAttachments[0].readStatus, 'NOT_READ');
        assert.equal(read.attachmentAcquisitions[0].sourceReadStatusAtObservation, 'NOT_READ');
        assert.equal(read.attachmentAcquisitions[0].currentSourcePermissionChecked, true);
        assert.equal(read.attachmentAcquisitions[0].semanticReadPerformed, false);
        assert.ok(Date.parse(read.attachmentAcquisitions[0].hostBytesVerifiedAt) > Date.parse(read.attachmentAcquisitions[0].sourceObservedAtDeclared));
        const [acq] = await owned.admin.unsafe(`SELECT status,document_version_id,selection_file_path,source_descriptor_json FROM ${s.schema}.dm_acquisition`);
        assert.equal(acq.status, 'ACQUIRED_READBACK_VERIFIED');
        assert.equal(acq.document_version_id, null);
        assert.equal(normalize(acq.selection_file_path), uploadPath);
        assert.equal(JSON.parse(acq.source_descriptor_json).uploadSelectionPin.providerObjectId, 'uploaded-object');
        assert.equal(await count(s.schema, 'dm_source_artifact'), 1);
        const second = await s.service.importFileServicePackage(actor(), s.input);
        assert.deepEqual(second, { ...first, created: false });
        assert.equal(await count(s.schema, 'dm_acquisition'), 1);
        assert.equal(await count(s.schema, 'tdms_capture'), 1);
        assert.equal(await count(s.schema, 'tdms_record_revision'), 1);
      });

      await t.test('same bytes reuse existing ordinary canonical identity and keep owned-upload lineage', async () => {
        const s = await setup('EXISTING-CANONICAL');
        const oldPath = '/document-management/source/fixture-existing.bin';
        s.storage.objects.set(normalize(oldPath), {
          bytes: Buffer.from(bytes),
          metadata: s.storage.metadata(oldPath, 'dm-object'),
        });
        await s.catalog.recordAcquisition({
          sourceArtifact: {
            sourceArtifactId: 'DM-EXISTING', sha256, byteLength: bytes.length,
            mediaType: 'application/octet-stream', bucketId: 'fixture-bucket',
            filePath: oldPath, providerObjectId: 'dm-object',
            providerVersionId: 'dm-object', readbackVerified: true,
            createdAt: new Date(),
          },
          acquisition: {
            acquisitionId: 'DM-ACQUISITION', sourceArtifactId: 'DM-EXISTING',
            sourceChannel: 'ordinary_fixture', sourceRef: 'ordinary-fixture',
            selectionBucketId: 'fixture-bucket', selectionFilePath: oldPath,
            providerObjectId: 'dm-object', providerVersionId: 'dm-object',
            acquiredBy: '123', acquiredAt: new Date(),
            idempotencyKey: 'ordinary-fixture', sourceDescriptor: { fixture: true },
          },
        });
        const result = await s.service.importFileServicePackage(actor(), s.input);
        assert.equal(result.artifactBindings[0].sourceArtifactId, 'DM-EXISTING');
        assert.equal(result.artifactBindings[0].documentVersionId, null);
        assert.equal(s.storage.stats().uploads, 0);
        assert.equal(await count(s.schema, 'dm_source_artifact'), 1);
        const rows = await owned.admin.unsafe(`SELECT source_channel,document_version_id,selection_file_path,provider_object_id FROM ${s.schema}.dm_acquisition ORDER BY source_channel`);
        assert.equal(rows.length, 2);
        assert.ok(rows.every((row) => row.document_version_id === null));
        const candidate = rows.find((row) => row.source_channel === 'wiselink_tdms_candidate');
        assert.equal(normalize(candidate.selection_file_path), uploadPath);
        assert.equal(candidate.provider_object_id, 'uploaded-object');
      });

      await t.test('existing max=1 SQL pool progresses through actual selection path', async () => {
        const s = await setup('SINGLE-POOL-SELECTION', { sharedPool: true });
        let timer;
        let timedOut = false;
        const operation = s.service.importFileServicePackage(actor(), s.input);
        operation.catch(() => {});
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error('TDMS_SELECTION_SINGLE_POOL_PROGRESS_TIMEOUT'));
          }, 3000);
        });
        try {
          const result = await Promise.race([operation, timeout]);
          assert.equal(result.created, true);
          assert.equal(result.artifactBindings[0].documentVersionId, null);
          assert.equal(timedOut, false);
        } catch (error) {
          if (timedOut) {
            const state = await owned.admin`SELECT state,query FROM pg_stat_activity WHERE datname=${owned.expected.database} AND state='idle in transaction'`;
            t.diagnostic(`SELECTION_SINGLE_POOL_TIMEOUT_STATE ${JSON.stringify(state)}`);
          }
          throw error;
        } finally {
          clearTimeout(timer);
          await s.sql.end({ timeout: 1 }).catch(() => {});
        }
      });

      await t.test('denied source member is rejected before FileService I/O or SQL candidate writes', async () => {
        const s = await setup('DENIED-MEMBER', { deniedMembers: true });
        await assert.rejects(s.service.importFileServicePackage(actor(), s.input));
        assert.equal(s.storage.stats().metadataReads, 0);
        assert.equal(await count(s.schema, 'dm_acquisition'), 0);
        assert.equal(await count(s.schema, 'tdms_capture'), 0);
      });

      await t.test('selection metadata object drift is rejected before Catalog/native writes', async () => {
        const s = await setup('OBJECT-DRIFT', { drift: true });
        await assert.rejects(s.service.importFileServicePackage(actor(), s.input));
        assert.equal(await count(s.schema, 'dm_acquisition'), 0);
        assert.equal(await count(s.schema, 'tdms_capture'), 0);
      });
    } finally {
      await owned.stop();
    }
  },
);
