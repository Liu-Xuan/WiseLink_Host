import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getTableConfig } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import {
  dmAcquisition,
  dmCurrentnessDecision,
  dmDocument,
  dmDocumentVersion,
  dmDocumentVersionMetadata,
  dmIngressPreflight,
  dmPublicationFamily,
  dmSourceArtifact,
} from '@server/database/schema';
import { DocumentManagementHostedCore } from '../../server/modules/document-management/src/hosted/documentManagementHostedCore.js';
import { MiaodaHostedDocumentCatalog } from '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { normalizeUploadDescriptor } from '../../server/modules/document-management/src/migrated/ingress/uploadDescriptor.js';
import { deterministicId } from '../../server/modules/document-management/src/runtime/valueTools.js';

const bytes = Buffer.from('%PDF-1.7 historical publication fixture');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const context = {
  tenantId: 'tenant-history',
  actorUserId: 'owner',
  roles: ['role'],
};
const request = {
  confirmed: true,
  expectedCurrentGeneration: 7,
  expectedCurrentDocumentVersionId: 'current-version',
};
const sourceDescriptor = {
  documentCode: '737-34-3830',
  issuer: 'BOEING',
  documentFamily: 'SB',
  sourceType: 'boeing_sb',
  businessRevision: 'R1',
  revisionDate: '2026-01-01',
  sourceGeneratedDate: '',
  identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
  sha256,
  sizeBytes: bytes.length,
  pageCount: 1,
  originalFilename: 'publication.pdf',
  mediaType: 'application/pdf',
  documentCodeProvenance: {
    schemaVersion: 'wiselink.document_code_provenance.v1',
    source: 'pdf_text_first_three_pages',
    candidates: ['737-34-3830'],
    inspectedSha256: sha256,
    conflict: false,
  },
  extractedMetadata: {
    schemaVersion: 'test-metadata',
    title: { observations: [{ value: 'Historical source title' }] },
  },
};
const normalizedDescriptor = normalizeUploadDescriptor(sourceDescriptor);
const identityKey = `tenant:${encodeURIComponent(context.tenantId)}:family:${encodeURIComponent('BOEING|SB|737-34-3830')}`;
const familyId = deterministicId('family', identityKey);
const documentId = deterministicId('document', familyId);
function candidate() {
  return {
    preflight: {
      preflightId: 'old-preflight',
      status: 'READY',
      observedCurrentGeneration: 7,
      observedCurrentDocumentVersionId: 'current-version',
    },
    acquisition: {
      acquisitionId: 'old-acquisition',
      selectionBucketId: 'bucket',
      selectionFilePath: '/source.pdf',
      providerObjectId: 'provider-object',
      providerVersionId: 'provider-version',
    },
    artifact: {
      sourceArtifactId: 'old-source',
      bucketId: 'bucket',
      filePath: '/immutable.pdf',
      sha256,
      byteLength: bytes.length,
    },
    normalizedDescriptor,
    sourceDescriptor,
    family: { familyId },
  };
}
function selected() {
  return {
    bytes,
    providerObjectId: 'provider-object',
    providerVersionId: 'provider-version',
  };
}
function coreFixture() {
  const catalog = {
    readHistoricalImportCandidate: jest.fn(async () => candidate()),
    listIngressDocuments: jest.fn(async () => [
      {
        documentVersionId: 'current-version',
        upload: {
          descriptorSummary: { ...sourceDescriptor, sha256: 'b'.repeat(64) },
        },
        detail: {
          ...sourceDescriptor,
          businessRevision: 'R2',
          revisionDate: '2026-02-01',
          sha256: 'b'.repeat(64),
          canonicalDocumentFamily: 'SB',
          issuerAuthority: 'BOEING',
        },
      },
    ]),
    commitHistoricalVersion: jest.fn(async () => ({
      version: { documentId, documentVersionId: 'old-version' },
      family: {
        currentGeneration: 7,
        currentDocumentVersionId: 'current-version',
      },
      replayed: false,
    })),
  };
  const authorizer = { assertCanIngest: jest.fn(async () => {}) };
  const artifactStore = {
    readSelection: jest.fn(async () => selected()),
    persistImmutableSource: jest.fn(),
  };
  const core = new DocumentManagementHostedCore({
    catalog: catalog as never,
    authorizer,
    artifactStore,
    pdfLayoutExtractor: { extractLayout: () => ({}) },
  });
  return { core, catalog, authorizer, artifactStore };
}
describe('historical import explicit confirmation', () => {
  it.each([
    {},
    { ...request, confirmed: false },
    { ...request, expectedCurrentGeneration: 0 },
  ])(
    'does not access or write data without a complete confirmation',
    async (body) => {
      const f = coreFixture();
      await expect(
        f.core.confirmHistoricalImport('old-preflight', body, context),
      ).rejects.toMatchObject({
        code: 'HISTORICAL_IMPORT_CONFIRMATION_REQUIRED',
      });
      expect(f.catalog.readHistoricalImportCandidate).not.toHaveBeenCalled();
      expect(f.catalog.commitHistoricalVersion).not.toHaveBeenCalled();
    },
  );
  it('rejects another displayed head before FileService reads', async () => {
    const f = coreFixture();
    await expect(
      f.core.confirmHistoricalImport(
        'old-preflight',
        { ...request, expectedCurrentGeneration: 8 },
        context,
      ),
    ).rejects.toMatchObject({ code: 'HISTORICAL_IMPORT_CONFIRMATION_STALE' });
    expect(f.artifactStore.readSelection).not.toHaveBeenCalled();
  });
  it('rechecks actor authorization before reading source bytes', async () => {
    const f = coreFixture();
    f.authorizer.assertCanIngest.mockRejectedValue(new Error('denied'));
    await expect(
      f.core.confirmHistoricalImport('old-preflight', request, context),
    ).rejects.toThrow('denied');
    expect(f.artifactStore.readSelection).not.toHaveBeenCalled();
    expect(f.catalog.commitHistoricalVersion).not.toHaveBeenCalled();
  });
  it('refuses a replaced source even when the user confirms it', async () => {
    const f = coreFixture();
    f.artifactStore.readSelection.mockResolvedValue({
      ...selected(),
      bytes: Buffer.from('%PDF-1.7 changed'),
    });
    await expect(
      f.core.confirmHistoricalImport('old-preflight', request, context),
    ).rejects.toMatchObject({ code: 'HISTORICAL_IMPORT_SOURCE_CHANGED' });
    expect(f.catalog.commitHistoricalVersion).not.toHaveBeenCalled();
  });
  it('refuses a corrupted immutable copy even when the original selection is intact', async () => {
    const f = coreFixture();
    f.artifactStore.readSelection
      .mockResolvedValueOnce(selected())
      .mockResolvedValueOnce({
        ...selected(),
        bytes: Buffer.from('%PDF-1.7 changed immutable'),
      });
    await expect(
      f.core.confirmHistoricalImport('old-preflight', request, context),
    ).rejects.toMatchObject({ code: 'HISTORICAL_IMPORT_SOURCE_CHANGED' });
    expect(f.catalog.commitHistoricalVersion).not.toHaveBeenCalled();
  });
  it('commits only the older candidate and reports unchanged currentness', async () => {
    const f = coreFixture();
    await expect(
      f.core.confirmHistoricalImport('old-preflight', request, context),
    ).resolves.toMatchObject({
      disposition: 'IMPORTED_HISTORICAL_REVISION',
      currentnessChanged: false,
      currentGeneration: 7,
    });
    expect(f.catalog.commitHistoricalVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'owner',
        tenantId: 'tenant-history',
        canonicalRevisionIdentity: 'REV:00000001',
        sha256,
      }),
    );
    expect(f.artifactStore.persistImmutableSource).not.toHaveBeenCalled();
  });
});

(process.env.WL_DM_HISTORY_LOCAL_PG === '1' ? describe : describe.skip)(
  'historical import isolated PostgreSQL transaction',
  () => {
    const client = postgres({
      host: '127.0.0.1',
      port: 55439,
      database: 'postgres',
      max: 1,
    });
    const db = drizzle(client);
    const catalog = new MiaodaHostedDocumentCatalog(db as never);
    const core = new DocumentManagementHostedCore({
      catalog,
      authorizer: { assertCanIngest: async () => {} },
      artifactStore: {
        readSelection: async () => selected(),
        persistImmutableSource: async () => ({}),
      },
      pdfLayoutExtractor: { extractLayout: () => ({}) },
    });
    const tables = [
      dmAcquisition,
      dmCurrentnessDecision,
      dmDocument,
      dmDocumentVersion,
      dmDocumentVersionMetadata,
      dmIngressPreflight,
      dmPublicationFamily,
      dmSourceArtifact,
    ];
    beforeAll(async () => {
      for (const table of tables) {
        const config = getTableConfig(table);
        const columns = config.columns.map(
          (column) =>
            `"${column.name}" ${column.name === '_created_by' || column.name === '_updated_by' ? 'text' : column.getSQLType()}${column.name === 'id' ? ' default gen_random_uuid()' : ''}`,
        );
        await client.unsafe(
          `create temporary table "${config.name}" (${columns.join(',')})`,
        );
      }
      await client.unsafe(
        'create unique index historical_preflight_id on dm_ingress_preflight(preflight_id); create unique index historical_version_id on dm_document_version(document_version_id); create unique index historical_revision on dm_document_version(family_id,canonical_revision_identity); create unique index historical_commit on dm_ingress_preflight(commit_idempotency_key);',
      );
    });
    afterAll(async () => {
      await client.end();
    });
    beforeEach(async () => {
      for (const table of tables)
        await client.unsafe(`truncate "${getTableConfig(table).name}"`);
      await db.insert(dmPublicationFamily).values({
        familyId,
        canonicalIdentityKey: identityKey,
        documentFamily: 'SB',
        issuerAuthority: 'BOEING',
        canonicalDocumentNumber: '737-34-3830',
        currentGeneration: 7,
        currentDocumentVersionId: 'current-version',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.insert(dmDocument).values({
        documentId,
        familyId,
        documentFamily: 'SB',
        status: 'ACTIVE',
        createdAt: new Date(),
      });
      await db.insert(dmDocumentVersion).values({
        documentVersionId: 'current-version',
        documentId,
        familyId,
        revisionId: 'current-revision',
        canonicalRevisionIdentity: 'DATE:2026-02-01',
        businessRevision: 'R2',
        revisionDate: '2026-02-01',
        sourceGeneratedDate: '',
        originalFilename: 'current.pdf',
        sourceArtifactId: 'current-source',
        acquisitionId: 'current-acquisition',
        pdfSha256: 'b'.repeat(64),
        byteLength: 50,
        mediaType: 'application/pdf',
        lifecycleStatus: 'COMMITTED_IMMUTABLE',
        committedAt: new Date(),
        committedBy: 'owner',
      });
      await db.insert(dmSourceArtifact).values({
        sourceArtifactId: 'old-source',
        sha256,
        byteLength: bytes.length,
        mediaType: 'application/pdf',
        bucketId: 'bucket',
        filePath: '/immutable.pdf',
        providerObjectId: 'immutable-object',
        providerVersionId: 'immutable-version',
        readbackVerified: true,
        createdAt: new Date(),
      });
      await db.insert(dmAcquisition).values({
        acquisitionId: 'old-acquisition',
        sourceArtifactId: 'old-source',
        documentVersionId: null,
        sourceChannel: 'miaoda_file_service_selection',
        sourceRef: 'selection',
        selectionBucketId: 'bucket',
        selectionFilePath: '/source.pdf',
        providerObjectId: 'provider-object',
        providerVersionId: 'provider-version',
        acquiredBy: 'owner',
        acquiredAt: new Date(),
        idempotencyKey: `tenant:${context.tenantId}:request:old`,
        sourceDescriptorJson: JSON.stringify(sourceDescriptor),
        status: 'ACQUIRED_READBACK_VERIFIED',
      });
      await db.insert(dmIngressPreflight).values({
        preflightId: 'old-preflight',
        acquisitionId: 'old-acquisition',
        decision: 'ASK_IMPORT_OLDER_REVISION',
        branch: 'REVIEW',
        executionAuthorized: false,
        observedCurrentGeneration: 7,
        observedCurrentDocumentVersionId: 'current-version',
        normalizedDescriptorJson: JSON.stringify(normalizedDescriptor),
        decisionPayloadJson: JSON.stringify({
          decision: 'ASK_IMPORT_OLDER_REVISION',
        }),
        status: 'READY',
        createdAt: new Date(),
      });
    });
    it('recovers an interrupted upload response as the existing pending confirmation', async () => {
      await expect(
        catalog.findIngestionByIdempotency({
          idempotencyKey: `tenant:${context.tenantId}:request:old`,
          expectedAcquisitionId: 'old-acquisition',
          sourceChannel: 'miaoda_file_service_selection',
          sourceRef: 'selection',
          selection: { bucketId: 'bucket', filePath: '/source.pdf' },
          tenantId: context.tenantId,
          actorUserId: context.actorUserId,
        }),
      ).resolves.toMatchObject({
        status: 'PENDING_HISTORICAL_IMPORT',
        historicalImport: {
          preflightId: 'old-preflight',
          expectedCurrentGeneration: 7,
        },
      });
      expect(await client`select * from dm_document_version`).toHaveLength(1);
      expect(await client`select * from dm_ingress_preflight`).toHaveLength(1);
    });
    it('atomically inserts historical version, metadata, acquisition link and confirmation without changing current or legacy identity', async () => {
      const result = await core.confirmHistoricalImport(
        'old-preflight',
        request,
        context,
      );
      expect(result).toMatchObject({
        currentnessChanged: false,
        currentGeneration: 7,
        newDocumentVersionCreated: true,
      });
      const [family] = await client`select * from dm_publication_family`;
      expect(family).toMatchObject({
        current_generation: 7,
        current_document_version_id: 'current-version',
      });
      const rows =
        await client`select * from dm_document_version order by business_revision`;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        business_revision: 'R1',
        canonical_revision_identity: 'REV:00000001',
      });
      expect(rows[1]).toMatchObject({
        business_revision: 'R2',
        canonical_revision_identity: 'DATE:2026-02-01',
      });
      expect(await client`select * from dm_currentness_decision`).toHaveLength(
        0,
      );
      expect(
        await client`select * from dm_document_version_metadata`,
      ).toHaveLength(1);
      const [preflight] = await client`select * from dm_ingress_preflight`;
      expect(
        JSON.parse(preflight.decision_payload_json).historicalImportConfirmation
          .confirmedBy,
      ).toBe('owner');
    });
    it('replays the same confirmation without a second insert, even after a later current generation', async () => {
      const first = await core.confirmHistoricalImport(
        'old-preflight',
        request,
        context,
      );
      await client`update dm_publication_family set current_generation=8`;
      const replay = await core.confirmHistoricalImport(
        'old-preflight',
        request,
        context,
      );
      expect(replay).toMatchObject({
        disposition: 'IDEMPOTENT_REPLAY',
        documentVersionId: first.documentVersionId,
        newDocumentVersionCreated: false,
        currentnessChanged: false,
      });
      expect(await client`select * from dm_document_version`).toHaveLength(2);
    });
    it('rejects cross-user and cross-tenant preflight lookup identically', async () => {
      for (const scope of [
        { ...context, actorUserId: 'other' },
        { ...context, tenantId: 'other' },
      ]) {
        await expect(
          core.confirmHistoricalImport('old-preflight', request, scope),
        ).rejects.toMatchObject({
          code: 'HISTORICAL_IMPORT_NOT_FOUND',
          statusCode: 404,
        });
      }
      expect(await client`select * from dm_document_version`).toHaveLength(1);
    });
    it('rejects a changed current generation with no historical write', async () => {
      await client`update dm_publication_family set current_generation=8`;
      await expect(
        core.confirmHistoricalImport('old-preflight', request, context),
      ).rejects.toMatchObject({ code: 'CURRENTNESS_CAS_CONFLICT' });
      expect(await client`select * from dm_document_version`).toHaveLength(1);
    });
    it('refreshes a stale observation without canonical writes, then imports after a new explicit confirmation and permits future source reuse', async () => {
      await client`update dm_publication_family set current_generation=8`;
      await expect(
        core.confirmHistoricalImport('old-preflight', request, context),
      ).rejects.toMatchObject({ code: 'CURRENTNESS_CAS_CONFLICT' });
      const refreshed = await core.refreshHistoricalImport(
        'old-preflight',
        context,
      );
      expect(refreshed).toMatchObject({
        disposition: 'REVIEW_REQUIRED',
        newDocumentVersionCreated: false,
        currentnessChanged: false,
      });
      expect(await client`select * from dm_document_version`).toHaveLength(1);
      expect(await client`select * from dm_ingress_preflight`).toHaveLength(2);
      const next = refreshed.historicalImport as {
        preflightId: string;
        expectedCurrentGeneration: number;
        expectedCurrentDocumentVersionId: string;
      };
      expect(next.expectedCurrentGeneration).toBe(8);
      const again = await core.refreshHistoricalImport(
        'old-preflight',
        context,
      );
      expect(again.preflightId).toBe(next.preflightId);
      expect(await client`select * from dm_ingress_preflight`).toHaveLength(2);
      await core.confirmHistoricalImport(
        next.preflightId,
        { ...next, confirmed: true },
        context,
      );
      const [old] =
        await client`select * from dm_ingress_preflight where preflight_id='old-preflight'`;
      expect(old).toMatchObject({
        status: 'SUPERSEDED',
        observed_current_generation: 7,
      });
      expect(
        JSON.parse(old.decision_payload_json).supersededByPreflightId,
      ).toBe(next.preflightId);
      const [family] = await client`select * from dm_publication_family`;
      expect(family).toMatchObject({
        current_generation: 8,
        current_document_version_id: 'current-version',
      });
      await expect(
        catalog.assertImmutableSourceReuseSafe({
          sourceArtifactId: 'old-source',
          acquisitionId: 'future-acquisition',
          idempotencyKey: 'future-request',
          sha256,
          byteLength: bytes.length,
          mediaType: 'application/pdf',
          bucketId: 'bucket',
          filePath: '/immutable.pdf',
          providerObjectId: 'immutable-object',
          providerVersionId: 'immutable-version',
        }),
      ).resolves.toMatchObject({
        disposition: 'CATALOGED_SOURCE_REUSE_ALLOWED',
      });
      await client`update dm_ingress_preflight set decision_payload_json='{}' where preflight_id='old-preflight'`;
      await expect(
        catalog.assertImmutableSourceReuseSafe({
          sourceArtifactId: 'old-source',
          acquisitionId: 'future-acquisition',
          idempotencyKey: 'future-request',
          sha256,
          byteLength: bytes.length,
          mediaType: 'application/pdf',
          bucketId: 'bucket',
          filePath: '/immutable.pdf',
          providerObjectId: 'immutable-object',
          providerVersionId: 'immutable-version',
        }),
      ).rejects.toMatchObject({ code: 'IMMUTABLE_SOURCE_REUSE_DB_PARTIAL' });
    });
    it('rolls back the inserted version and metadata when the final confirmation update fails', async () => {
      await client.unsafe(
        "alter table dm_ingress_preflight add constraint historical_test_reject_commit check (status <> 'COMMITTED')",
      );
      try {
        await expect(
          core.confirmHistoricalImport('old-preflight', request, context),
        ).rejects.toThrow();
        expect(await client`select * from dm_document_version`).toHaveLength(1);
        expect(
          await client`select * from dm_document_version_metadata`,
        ).toHaveLength(0);
        const [acquisition] = await client`select * from dm_acquisition`;
        expect(acquisition.document_version_id).toBeNull();
        const [family] = await client`select * from dm_publication_family`;
        expect(family.current_generation).toBe(7);
      } finally {
        await client.unsafe(
          'alter table dm_ingress_preflight drop constraint historical_test_reject_commit',
        );
      }
    });
  },
);
