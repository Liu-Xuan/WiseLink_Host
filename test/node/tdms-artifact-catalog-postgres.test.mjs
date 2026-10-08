import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  postgresCapability,
  startOwnedPostgres,
} from '../pg/owned-postgres-cluster.mjs';
const capability = await postgresCapability();

function fileServiceFixture() {
  const objects = new Map();
  const normalize = (path) => path.replace(/^\/+/, '');
  return {
    objects,
    files: {
      getDefaultBucket: async () => 'fixture-bucket',
      from: (bucket) => ({
        getFileMetadata: async (path) =>
          objects.get(normalize(path))?.metadata ?? null,
        upload: async (bytes, opts) => {
          const metadata = {
            bucketID: bucket,
            filePath: opts.filePath,
            id: 'fixture-object-' + randomUUID(),
            name: opts.fileName,
            createdBy: { userID: '123' },
            metadata: {
              mimeType: opts.contentType,
              contentLength: bytes.length,
            },
          };
          objects.set(normalize(opts.filePath), {
            metadata,
            bytes: Buffer.from(bytes),
          });
          return metadata;
        },
        download: (path) => ({
          asStream: async () => {
            const value = objects.get(normalize(path));
            return { metadata: value.metadata, content: value.bytes };
          },
        }),
      }),
    },
  };
}

test(
  'physical actual Catalog/native artifact integration: same-content identity and single-pool progress',
  { skip: capability.available ? false : capability.reason, timeout: 60000 },
  async (t) => {
    const owned = await startOwnedPostgres(capability);
    try {
      t.diagnostic(
        `TDMS_OWNED_PG_IDENTITY ${JSON.stringify({ expected: owned.expected, instance: owned.instance, identity: owned.identity })}`,
      );
      process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
      process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
        module: 'CommonJS',
        moduleResolution: 'node',
      });
      const require = createRequire(import.meta.url);
      require('ts-node/register/transpile-only');
      require('tsconfig-paths/register');
      const { drizzle } = require('drizzle-orm/postgres-js');
      const {
        MiaodaHostedDocumentCatalog,
      } = require('../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.ts');
      const {
        MiaodaTdmsArtifactStore,
      } = require('../../server/modules/tdms-source/miaoda-tdms-artifact-store.ts');
      const {
        MiaodaTdmsSourceRepository,
      } = require('../../server/modules/tdms-source/tdms-source.repository.ts');
      const {
        TdmsSourceService,
      } = require('../../server/modules/tdms-source/tdms-source.service.ts');
      const {
        HostDecisionTdmsSourceAuthorization,
      } = require('../../server/modules/tdms-source/tdms-source.authorization.ts');
      const {
        fixture,
        actor,
      } = require('../unit/tdms-source/tdms-fixtures.ts');
      const nativeDdl = await readFile(
        new URL(
          '../../server/database/tdms-source-rebuild-v1.draft.sql',
          import.meta.url,
        ),
        'utf8',
      );
      const catalogDdl = await readFile(
        new URL(
          '../../migrations/0001_document_management_hosted_catalog.sql',
          import.meta.url,
        ),
        'utf8',
      );
      const scope = {
        tenantId: 'tenant-a',
        sourceKey: 'TDMS',
        sourceInstanceId: 'fixture-instance',
        scopeId: 'fixture-scope',
      };
      const target = {
        sourceKey: scope.sourceKey,
        sourceInstanceId: scope.sourceInstanceId,
        scopeId: scope.scopeId,
      };
      // Server-source authorizer double and FileService byte fixture. Repository, Catalog, driver and SQL are actual.
      const authorization = new HostDecisionTdmsSourceAuthorization(
        async () => [{ scope, permissionRevision: 'fixture-1' }],
        async ({ claims, grant }) => ({
          ...grant,
          authorityRef: 'fixture-only-rights',
          captureRetentionAllowed: true,
          nativeProjectionAllowed: true,
          permittedMembers: claims,
        }),
      );
      const bytes = Buffer.from(
        'Native TDMS arbitrary attachment bytes; not a fake PDF',
      );
      const artifact = {
        memberId: 'member',
        sourceAttachmentId: 'attachment',
        sourceAttachmentVersion: '1',
        fileName: 'source.bin',
        mediaType: 'application/octet-stream',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.length,
        bytesBase64: bytes.toString('base64'),
      };
      async function setup(label, sharedPool = false) {
        const schema =
          'tdms_ac_' + randomUUID().replaceAll('-', '').slice(0, 16);
        await owned.admin.unsafe(
          `CREATE SCHEMA ${schema}; SET search_path TO ${schema},pg_catalog; CREATE TYPE user_profile AS (uid text)`,
        );
        for (const name of ['dm_source_artifact', 'dm_acquisition']) {
          const statement = catalogDdl.match(
            new RegExp(`CREATE TABLE ${name} \\([\\s\\S]*?\\n\\);`),
          )?.[0];
          assert.ok(statement, `exact existing catalog CREATE TABLE ${name}`);
          await owned.admin.unsafe(statement);
        }
        await owned.admin.unsafe(nativeDdl);
        const sql = await owned.connect();
        await sql.unsafe(`SET search_path TO ${schema},pg_catalog`);
        await sql`SELECT set_config('app.user_id','123',false)`;
        const catalogSql = sharedPool ? sql : await owned.connect();
        if (!sharedPool) {
          await catalogSql.unsafe(`SET search_path TO ${schema},pg_catalog`);
          await catalogSql`SELECT set_config('app.user_id','123',false)`;
        }
        const catalog = new MiaodaHostedDocumentCatalog(drizzle(catalogSql));
        const storage = fileServiceFixture();
        const store = new MiaodaTdmsArtifactStore(storage.files, catalog);
        const service = new TdmsSourceService(
          new MiaodaTdmsSourceRepository(drizzle(sql)),
          authorization,
          store,
          {
            assertRead: async () => {
              throw new Error('NO_DV_IN_THIS_FIXTURE');
            },
          },
        );
        const packet = fixture();
        packet.packageId = label;
        packet.records[0].artifactMemberIds = ['member'];
        packet.artifacts = [artifact];
        return { schema, sql, catalogSql, catalog, storage, service, packet };
      }
      await t.test(
        'control: actual Catalog + native service persist fresh candidate without formal DV',
        async () => {
          const s = await setup('CONTROL');
          const result = await s.service.importPackage(
            actor(),
            target,
            s.packet,
          );
          assert.equal(result.created, true);
          assert.equal(result.artifactBindings[0].documentVersionId, null);
          const [row] = await owned.admin.unsafe(
            `SELECT count(*)::int AS n FROM ${s.schema}.dm_source_artifact`,
          );
          assert.equal(row.n, 1);
          const [acq] = await owned.admin.unsafe(
            `SELECT status,document_version_id FROM ${s.schema}.dm_acquisition`,
          );
          assert.equal(acq.status, 'ACQUIRED_READBACK_VERIFIED');
          assert.equal(acq.document_version_id, null);
        },
      );
      await t.test(
        'same bytes already registered by ordinary DM reuse canonical artifact identity, with independent unlinked TDMS acquisition',
        async () => {
          const s = await setup('SAME-BYTES');
          const oldPath = '/document-management/source/fixture-existing.bin';
          // Green-only completion: keep the red assertions, add the exact old canonical object readback fixture.
          s.storage.objects.set(oldPath.replace(/^\/+/, ''), {
            bytes: Buffer.from(bytes),
            metadata: {
              bucketID: 'fixture-bucket',
              filePath: oldPath,
              id: 'dm-object',
              name: 'fixture-existing.bin',
              createdBy: { userID: '123' },
              metadata: {
                mimeType: artifact.mediaType,
                contentLength: bytes.length,
              },
            },
          });
          await s.catalog.recordAcquisition({
            sourceArtifact: {
              sourceArtifactId: 'DM-EXISTING',
              sha256: artifact.sha256,
              byteLength: artifact.byteLength,
              mediaType: artifact.mediaType,
              bucketId: 'fixture-bucket',
              filePath: oldPath,
              providerObjectId: 'dm-object',
              providerVersionId: 'dm-object',
              readbackVerified: true,
              createdAt: new Date(),
            },
            acquisition: {
              acquisitionId: 'DM-ACQUISITION',
              sourceArtifactId: 'DM-EXISTING',
              sourceChannel: 'ordinary_fixture',
              sourceRef: 'ordinary-fixture',
              selectionBucketId: 'fixture-bucket',
              selectionFilePath: oldPath,
              providerObjectId: 'dm-object',
              providerVersionId: 'dm-object',
              acquiredBy: '123',
              acquiredAt: new Date(),
              idempotencyKey: 'ordinary-fixture',
              sourceDescriptor: { fixture: true },
            },
          });
          const result = await s.service.importPackage(
            actor(),
            target,
            s.packet,
          );
          assert.equal(
            result.artifactBindings[0].sourceArtifactId,
            'DM-EXISTING',
          );
          assert.equal(result.artifactBindings[0].documentVersionId, null);
          const [row] = await owned.admin.unsafe(
            `SELECT count(*)::int AS n FROM ${s.schema}.dm_source_artifact`,
          );
          assert.equal(row.n, 1);
          const acquisitions = await owned.admin.unsafe(
            `SELECT source_channel,status,document_version_id FROM ${s.schema}.dm_acquisition ORDER BY source_channel`,
          );
          assert.equal(acquisitions.length, 2);
          assert.ok(acquisitions.every((a) => a.document_version_id === null));
        },
      );
      await t.test(
        'single existing max=1 pool completes candidate registration outside held native transaction',
        async () => {
          const s = await setup('SINGLE-POOL', true);
          let timer;
          let timeoutObserved = false;
          const operation = s.service.importPackage(actor(), target, s.packet);
          operation.catch(() => {});
          const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
              timeoutObserved = true;
              reject(new Error('TDMS_SINGLE_POOL_PROGRESS_TIMEOUT'));
            }, 3000);
          });
          try {
            const result = await Promise.race([operation, timeout]);
            assert.equal(result.created, true);
            assert.equal(result.artifactBindings[0].documentVersionId, null);
            assert.equal(timeoutObserved, false);
          } catch (error) {
            if (timeoutObserved) {
              const state =
                await owned.admin`SELECT state,query FROM pg_stat_activity WHERE datname=${owned.expected.database} AND state='idle in transaction'`;
              t.diagnostic(
                `SINGLE_POOL_TIMEOUT_STATE ${JSON.stringify(state)}`,
              );
            }
            throw error;
          } finally {
            clearTimeout(timer);
            await s.sql.end({ timeout: 1 }).catch(() => {});
          }
        },
      );
    } finally {
      await owned.stop();
    }
  },
);
