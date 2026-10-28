import { createHash } from 'node:crypto';
import { OrdinaryDocumentManagementAuthorizer } from '../../server/modules/document-management-runtime/ordinary-document-management-authorizer';
import { PgDialect } from 'drizzle-orm/pg-core';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';
import { SessionResolver } from '../../server/modules/identity/session-resolver.service';
import type { VerifiedIdentity } from '../../server/modules/identity/identity.types';
import { CANONICAL_MIAODA_APP_ID } from '../../server/modules/canonical-host/canonical-host.constants';

import {
  dmAcquisition,
  dmDocument,
  dmDocumentVersion,
  dmIngressPreflight,
  dmPublicationFamily,
  dmSourceArtifact,
} from '@server/database/schema';

import { MiaodaHostedDocumentCatalog, classifyImmutableSourceReuseState } from '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { deterministicId } from '../../server/modules/document-management/src/runtime/valueTools.js';
import { mintTdmsDocumentUploadAuthority } from '../../server/modules/document-management/src/hosted/nest/document-upload-authority';

interface CatalogState {
  artifacts: Array<Record<string, unknown>>;
  acquisitions: Array<Record<string, unknown>>;
  operations: string[];
}

interface RecordAcquisitionInput {
  sourceArtifact: {
    sourceArtifactId: string;
    sha256: string;
    byteLength: number;
    mediaType: string;
    bucketId: string;
    filePath: string;
    providerObjectId: string;
    providerVersionId: string;
    readbackVerified: boolean;
    createdAt: string;
  };
  acquisition: {
    acquisitionId: string;
    sourceArtifactId: string;
    sourceChannel: string;
    sourceRef: string;
    selectionBucketId: string;
    selectionFilePath: string;
    providerObjectId: string;
    providerVersionId: string;
    acquiredBy: string;
    acquiredAt: string;
    idempotencyKey: string;
    sourceDescriptor: Record<string, unknown>;
  };
}

describe('independent TDMS candidate and ordinary canonical intake reuse', () => {
  function candidate() {
    const sha256 = 'a'.repeat(64);
    const sourceArtifactId = deterministicId('source_artifact', sha256, 123);
    const input = { sourceArtifactId, acquisitionId: 'ordinary-acquisition', idempotencyKey: 'ordinary-request',
      sha256, byteLength: 123, mediaType: 'application/pdf', bucketId: 'bucket',
      filePath: `/document-management/source/sha256/aa/${sha256}.pdf`, providerObjectId: 'original', providerVersionId: 'version' };
    const artifact = { ...input, readbackVerified: true };
    const descriptor = { tenantId: 'tenant', sourceKey: 'TDMS', sourceInstanceId: 'instance', scopeId: 'SL',
      packageId: 'package', sourceAttachmentId: 'primary', sourceAttachmentVersion: null, candidateOnly: true, sha256, byteLength: 123,
      mediaType: 'application/pdf', uploadSelectionPin: { bucketId: 'bucket', filePath: 'uploads/primary',
        providerObjectId: 'selection', sha256, byteLength: 123 } };
    const acquisition = { acquisitionId: 'TDMS-ACQ-existing', sourceArtifactId, idempotencyKey: 'tdms:existing',
      sourceChannel: 'wiselink_tdms_candidate', sourceRef: 'TDMS:instance:primary',
      acquiredBy: 'engineer', selectionBucketId: 'bucket', selectionFilePath: 'uploads/primary',
      providerObjectId: 'selection', providerVersionId: 'selection-version', status: 'ACQUIRED_READBACK_VERIFIED',
      documentVersionId: null, sourceDescriptorJson: JSON.stringify(descriptor) };
    const state = { artifacts: [artifact], acquisitions: [acquisition], preflights: [], versions: [] };
    return { input, state, descriptor, acquisition };
  }
  it('permits a separate ordinary intake while leaving the exact candidate unchanged and unpromoted', () => {
    const f = candidate();
    const before = JSON.stringify(f.state);
    expect(classifyImmutableSourceReuseState(f.input, f.state as never))
      .toEqual({ disposition: 'INDEPENDENT_TDMS_CANDIDATE_REUSE_ALLOWED' });
    expect(JSON.stringify(f.state)).toBe(before);
    expect(f.acquisition.documentVersionId).toBeNull();
  });
  it.each(['candidateOnly', 'sha256', 'sourceAttachmentId', 'uploadSelectionPin'])(
    'refuses a candidate with damaged %s lineage rather than ignoring partial state', (key: string) => {
      const f = candidate();
      const descriptor: Record<string, unknown> = { ...f.descriptor };
      delete descriptor[key]; f.acquisition.sourceDescriptorJson = JSON.stringify(descriptor);
      expect(() => classifyImmutableSourceReuseState(f.input, f.state as never))
        .toThrow(expect.objectContaining({ code: 'IMMUTABLE_SOURCE_REUSE_DB_PARTIAL' }));
    },
  );
  it('retains refusal for ordinary incomplete intake and legacy conflicting content identity', () => {
    const f = candidate(); f.acquisition.sourceChannel = 'document_library_upload';
    expect(() => classifyImmutableSourceReuseState(f.input, f.state as never))
      .toThrow(expect.objectContaining({ code: 'IMMUTABLE_SOURCE_REUSE_DB_PARTIAL' }));
    const legacy = candidate(); legacy.state.artifacts[0].sourceArtifactId = 'TDMS-SA-legacy';
    expect(() => classifyImmutableSourceReuseState(legacy.input, legacy.state as never))
      .toThrow(expect.objectContaining({ code: 'IMMUTABLE_SOURCE_REUSE_DB_CONFLICT' }));
  });
  it('refuses candidate state missing its canonical artifact instead of calling it orphan recovery', () => {
    const f = candidate(); f.state.artifacts = [];
    expect(() => classifyImmutableSourceReuseState(f.input, f.state as never))
      .toThrow(expect.objectContaining({ code: 'IMMUTABLE_SOURCE_REUSE_DB_PARTIAL' }));
  });
});

describe('actual Catalog Source checkpoint inside the formal commit transaction', () => {
  it.each(['new', 'exact'] as const)('blocks revoked Source authority before %s registration writes', async (kind) => {
    const priorSandbox = process.env.SANDBOX_ID;
    process.env.SANDBOX_ID = 'unit-tdms-commit';
    try {
      const select = jest.fn(() => { throw new Error('SQL must not start after revocation'); });
      const transaction = { select };
      const database = { transaction: jest.fn(async (op: (db: unknown) => Promise<unknown>) => op(transaction)) };
      const sessions = { withVerifiedServiceSql: async (op: () => Promise<unknown>) => op() };
      const context = { actorUserId: 'engineer', tenantId: 'tenant', appId: CANONICAL_MIAODA_APP_ID, env: 'runtime' };
      const checkpoint = jest.fn(async (db: unknown) => {
        expect(db).toBe(transaction);
        throw Object.assign(new Error('Source changed'), { code: 'TDMS_SOURCE_PERMISSION_CHANGED', statusCode: 409 });
      });
      const binding = {
        schemaVersion: 'wiselink.tdms-formal-document-binding.v1' as const,
        requestId: 'request', bindingId: 'binding', payloadDigest: 'a'.repeat(64),
        scope: { tenantId: 'tenant', sourceKey: 'TDMS', sourceInstanceId: 'instance', scopeId: 'SL' },
        receiverId: 'receiver', receiverRevision: 1, grantRevision: 1, permissionRevision: 'permission',
        applicationScopeId: CANONICAL_MIAODA_APP_ID, actorSubjectId: 'engineer', ownerSnapshotId: 'snapshot',
        sourceRecordId: 'owner', number: 'SL-99-9999-R00',
        sourceVersion: { rawRevision: 'A', rawIteration: '1', confirmation: 'SOURCE_DECLARED' as const },
        businessVersion: { rawRevision: '00', rawIteration: null, confirmation: 'SOURCE_DECLARED' as const },
        sourceAttachmentId: 'primary', sourceAttachmentVersion: null, filename: 'publication.pdf',
        mediaType: 'application/pdf', sha256: 'a'.repeat(64), byteLength: 123,
        selection: { bucketId: 'bucket', filePath: 'original', expectedProviderObjectId: 'selection' },
      };
      const authority = mintTdmsDocumentUploadAuthority(context, binding, checkpoint);
      const catalog = new MiaodaHostedDocumentCatalog(database as never, sessions as never);
      const uploadCommit = { authority, actorUserId: context.actorUserId, tenantId: context.tenantId };
      const operation = kind === 'new'
        ? catalog.commitNewVersion({ uploadCommit })
        : catalog.linkAcquisitionToVersion({ acquisitionId: 'acquisition', documentVersionId: 'version',
            preflightId: 'preflight', idempotencyKey: 'idempotency', uploadCommit });
      await expect(operation).rejects.toMatchObject({ code: 'TDMS_SOURCE_PERMISSION_CHANGED', statusCode: 409 });
      expect(checkpoint).toHaveBeenCalledTimes(1);
      expect(select).not.toHaveBeenCalled();
      expect(database.transaction).toHaveBeenCalledTimes(1);
    } finally {
      if (priorSandbox === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = priorSandbox;
    }
  });
});

describe('MiaodaHostedDocumentCatalog acquisition boundary', () => {
  it('enters the existing verified upload SQL scope before the source/acquisition transaction', async () => {
    const fixture = verifiedUploadCatalog();
    await expect(fixture.run()).resolves.toMatchObject({ acquisitionId: 'ACQUISITION-1', acquiredBy: 'engineer-1' });
    expect(fixture.scopes).toEqual([{ userId: 'engineer-1', isSystemAccount: true, roles: [] }]);
    expect(fixture.database.state.operations).toEqual([
      'insert-source-artifact', 'read-source-artifact', 'insert-acquisition', 'read-acquisition',
    ]);
    expect(fixture.database.state.artifacts[0]).toMatchObject({ ...fixture.input.sourceArtifact,
      createdAt: new Date(fixture.input.sourceArtifact.createdAt) });
  });

  it.each([
    ['missing OAuth session', { missingSession: true }, 'OFFICIAL_OAUTH_SESSION_REQUIRED'],
    ['expired OAuth session', { expired: true }, 'OFFICIAL_OAUTH_SESSION_REQUIRED'],
    ['different native actor', { nativeActor: 'engineer-other' }, 'DIALOGUE_BROWSER_IDENTITY_MISMATCH'],
    ['different native tenant', { nativeTenant: 'tenant-other' }, 'DIALOGUE_BROWSER_IDENTITY_MISMATCH'],
    ['different acquisition owner', { acquiredBy: 'engineer-other' }, 'DIALOGUE_BROWSER_IDENTITY_MISMATCH'],
  ] as const)('rejects %s before entering a source registration transaction', async (_label, options, error) => {
    const fixture = verifiedUploadCatalog(options);
    await expect(fixture.run()).rejects.toThrow(error);
    expect(fixture.database.db.transaction).not.toHaveBeenCalled();
    expect(fixture.scopes).toEqual([]);
  });

  it('fails closed when upload registration has no verified SQL provider or acquisition actor', async () => {
    const database = catalogDatabase();
    const input = recordAcquisitionInput(); input.acquisition.sourceChannel = 'document_library_upload';
    await expect(new MiaodaHostedDocumentCatalog(database.db as never).recordAcquisition(input))
      .rejects.toMatchObject({ code: 'VERIFIED_SQL_CONTEXT_UNAVAILABLE' });
    input.acquisition.acquiredBy = '';
    await expect(new MiaodaHostedDocumentCatalog(database.db as never).recordAcquisition(input))
      .rejects.toMatchObject({ code: 'ACQUISITION_ACTOR_REQUIRED' });
    expect(database.db.transaction).not.toHaveBeenCalled();
  });

  it('keeps the same upload request idempotent and preserves source/acquisition rollback', async () => {
    const fixture = verifiedUploadCatalog();
    await fixture.run(); await fixture.run();
    expect(fixture.database.state.artifacts).toHaveLength(1);
    expect(fixture.database.state.acquisitions).toHaveLength(1);
    expect(fixture.database.state.acquisitions[0]).toMatchObject({
      idempotencyKey: fixture.input.acquisition.idempotencyKey, sourceRef: fixture.input.acquisition.sourceRef,
    });
    const failing = verifiedUploadCatalog({ failAcquisitionInsert: true });
    await expect(failing.run()).rejects.toThrow('ACQUISITION_INSERT_FAILED');
    expect(failing.database.state.artifacts).toHaveLength(0);
    expect(failing.database.state.acquisitions).toHaveLength(0);
  });

  it('registers and reads back source plus acquisition in one short transaction', async () => {
    const fixture = catalogDatabase();
    const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);

    await expect(
      catalog.recordAcquisition(recordAcquisitionInput()),
    ).resolves.toMatchObject({
      acquisitionId: 'ACQUISITION-1',
      sourceArtifactId: 'SOURCE-1',
      sourceDescriptor: { originalFilename: 'source.pdf' },
    });

    expect(fixture.db.transaction).toHaveBeenCalledTimes(1);
    expect(fixture.state.operations).toEqual([
      'insert-source-artifact',
      'read-source-artifact',
      'insert-acquisition',
      'read-acquisition',
    ]);
    expect(fixture.state.artifacts).toHaveLength(1);
    expect(fixture.state.acquisitions).toHaveLength(1);
  });

  it('rolls back source registration when acquisition registration fails', async () => {
    const fixture = catalogDatabase({ failAcquisitionInsert: true });
    const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);

    await expect(
      catalog.recordAcquisition(recordAcquisitionInput()),
    ).rejects.toThrow('ACQUISITION_INSERT_FAILED');

    expect(fixture.db.transaction).toHaveBeenCalledTimes(1);
    expect(fixture.state.artifacts).toHaveLength(0);
    expect(fixture.state.acquisitions).toHaveLength(0);
  });

  it('rejects a replay when the acquisition route identity drifted', async () => {
    const fixture = catalogDatabase();
    const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);
    const original = recordAcquisitionInput();
    await catalog.recordAcquisition(original);

    const conflicting = recordAcquisitionInput();
    conflicting.acquisition.sourceRef = 'upload:different-source.pdf';
    conflicting.acquisition.sourceDescriptor = {
      originalFilename: 'different-source.pdf',
    };

    await expect(catalog.recordAcquisition(conflicting)).rejects.toMatchObject({
      code: 'ACQUISITION_IDEMPOTENCY_CONFLICT',
    });
    expect(fixture.state.artifacts).toHaveLength(1);
    expect(fixture.state.acquisitions).toHaveLength(1);
    expect(fixture.state.acquisitions[0]).toMatchObject({
      sourceRef: 'upload:source.pdf',
    });
  });

  it('returns an identical concurrently linked acquisition for complete-lineage replay', async () => {
    const fixture = catalogDatabase();
    const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);
    const input = recordAcquisitionInput();
    await catalog.recordAcquisition(input);
    Object.assign(fixture.state.acquisitions[0]!, {
      status: 'COMMITTED_CANONICAL',
      documentVersionId: 'DV-COMMITTED-1',
    });
    await expect(catalog.recordAcquisition(input)).resolves.toMatchObject({
      status: 'COMMITTED_CANONICAL',
      documentVersionId: 'DV-COMMITTED-1',
    });
    expect(fixture.state.acquisitions).toHaveLength(1);
    expect(fixture.state.artifacts).toHaveLength(1);
  });
});

describe('MiaodaHostedDocumentCatalog tenant-scoped listing', () => {
  it('pushes the exact encoded tenant prefix into the database query', async () => {
    let condition: unknown = null;
    const where = jest.fn(async (value: unknown) => {
      condition = value;
      return [];
    });
    const db = {
      select: jest.fn(() => ({
        from: () => ({
          innerJoin: () => ({ where }),
        }),
      })),
    };
    const catalog = new MiaodaHostedDocumentCatalog(db as never);

    await expect(
      catalog.listIngressDocuments({ tenantId: '租户_1' }),
    ).resolves.toEqual([]);

    expect(where).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(condition as never);
    expect(query.sql).toContain('starts_with');
    expect(query.sql).toContain(dmPublicationFamily.canonicalIdentityKey.name);
    expect(query.params).toEqual(['tenant:%E7%A7%9F%E6%88%B7_1:family:']);
  });
});

describe('MiaodaHostedDocumentCatalog exact-version acquisition replay', () => {
  it('replays a TFU only with the source-owned adapter and matching header/footer byte evidence', async () => {
    const fixture = tfuReplayCatalogFixture();
    const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);
    await expect(catalog.findIngestionByIdempotency(fixture.input)).resolves.toMatchObject({
      documentVersionId: 'DV-1', identityReadback: { documentFamily: 'TFU', issuerAuthority: 'AIRBUS',
        identityAuthority: 'DM_ACTUAL_PDF_HEADER_AND_PUBLISHER_FOOTER', businessRevision: '', revisionDate: '2042-01-22' },
    });
  });

  it.each(['no evidence', 'different adapter', 'different footer page', 'different source evidence', 'other family'])(
    'rejects TFU footer authority replay with %s', async failure => {
      const fixture = tfuReplayCatalogFixture();
      const descriptor = JSON.parse(fixture.row.preflight.normalizedDescriptorJson);
      if (failure === 'no evidence') delete descriptor.publicationIdentityEvidence;
      if (failure === 'different adapter') descriptor.adapterRelease.adapterId = 'issuer.airbus.support_document.v1';
      if (failure === 'different footer page') descriptor.publicationIdentityEvidence.publisher.sourceLocator.pageIndex = 0;
      if (failure === 'other family') descriptor.canonicalDocumentFamily = 'OEM_REFERENCE';
      if (failure === 'different source evidence') fixture.acquisition.sourceDescriptorJson = JSON.stringify({
        ...descriptor, publicationIdentityEvidence: undefined,
      });
      fixture.row.preflight.normalizedDescriptorJson = JSON.stringify(descriptor);
      const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);
      await expect(catalog.findIngestionByIdempotency(fixture.input)).rejects.toMatchObject({ code: 'CATALOG_REPLAY_IDENTITY_UNVERIFIED' });
    },
  );

  it('binds an explicit delivery choice to the original upload request', async () => {
    const fixture = replayCatalogFixture();
    const choice = { reading: true, translation: 'ZH_FULL' };
    fixture.acquisition.sourceDescriptorJson = JSON.stringify({
      ...fixture.acquisition.sourceDescriptor,
      documentDeliveryIntent: choice,
    });
    const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);
    await expect(catalog.findIngestionByIdempotency({
      ...fixture.input,
      documentDeliveryIntent: choice,
    })).resolves.toMatchObject({ documentVersionId: 'DV-1' });
    await expect(catalog.findIngestionByIdempotency({
      ...fixture.input,
      documentDeliveryIntent: { reading: false, translation: 'NONE' },
    })).rejects.toMatchObject({ code: 'ACQUISITION_IDEMPOTENCY_CONFLICT' });
    await expect(catalog.findIngestionByIdempotency(fixture.input))
      .rejects.toMatchObject({ code: 'ACQUISITION_IDEMPOTENCY_CONFLICT' });
  });
  it.each(['REUSE_EXACT', 'RESUME_EXISTING_PROCESS'])(
    'reads an already linked %s acquisition while preserving the original version',
    async (decision) => {
      const fixture = replayCatalogFixture();
      fixture.row.preflight.decision = decision;
      const before = structuredClone(fixture.row);
      const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);

      await expect(catalog.findIngestionByIdempotency(fixture.input)).resolves.toMatchObject({
        status: 'COMMITTED',
        acquisitionId: 'ACQUISITION-1',
        documentVersionId: 'DV-1',
        sourceArtifactId: 'SOURCE-1',
        immutableReadbackVerified: true,
        catalogFreshReadVerified: true,
      });
      expect(fixture.row).toEqual(before);
      expect(fixture.row.version.acquisitionId).toBe('ACQUISITION-ORIGINAL');
    },
  );

  it('still accepts a replay of the original version-creating acquisition', async () => {
    const fixture = replayCatalogFixture();
    fixture.row.version.acquisitionId = fixture.acquisition.acquisitionId;
    fixture.acquisition.status = 'COMMITTED_CANONICAL';
    fixture.row.preflight.decision = 'INGEST_NEW_FAMILY';
    const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);

    await expect(catalog.findIngestionByIdempotency(fixture.input)).resolves.toMatchObject({
      status: 'COMMITTED', documentVersionId: 'DV-1',
    });
  });

  it.each<[string, (fixture: ReturnType<typeof replayCatalogFixture>) => void]>([
    ['unfinished acquisition', (fixture) => { fixture.acquisition.status = 'ACQUIRED_READBACK_VERIFIED'; }],
    ['different preflight decision', (fixture) => { fixture.row.preflight.decision = 'INGEST_NEW_FAMILY'; }],
    ['different commit identity', (fixture) => { fixture.row.preflight.commitIdempotencyKey = 'catalog:OTHER'; }],
    ['different document version', (fixture) => { fixture.row.preflight.documentVersionId = 'DV-OTHER'; }],
    ['different source bytes', (fixture) => { fixture.row.artifact.sha256 = 'b'.repeat(64); }],
    ['different source artifact', (fixture) => { fixture.row.version.sourceArtifactId = 'SOURCE-OTHER'; }],
    ['different publication identity', (fixture) => { fixture.row.family.canonicalDocumentNumber = 'SB-OTHER'; }],
  ])('rejects %s instead of accepting an unrelated version origin', async (_name, corrupt) => {
    const fixture = replayCatalogFixture();
    corrupt(fixture);
    const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);

    await expect(catalog.findIngestionByIdempotency(fixture.input)).rejects.toMatchObject({
      code: 'CATALOG_REPLAY_IDENTITY_UNVERIFIED',
    });
  });
});

describe('MiaodaHostedDocumentCatalog TFU historical evidence', () => {
  it('reads a pending historical TFU with exact source evidence and actor/tenant SQL scope', async () => {
    const fixture = tfuHistoricalCatalogFixture();
    const before = structuredClone(fixture.row);
    const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);
    await expect(catalog.readHistoricalImportCandidate({ preflightId: 'PREFLIGHT-1', actorUserId: 'engineer-1', tenantId: 'tenant-1' }))
      .resolves.toMatchObject({ normalizedDescriptor: { canonicalDocumentFamily: 'TFU', revisionDate: '2042-01-22', businessRevision: '' } });
    expect(fixture.conditions[0].params).toEqual(['PREFLIGHT-1', 'engineer-1', 'tenant:tenant-1:request:']);
    expect(fixture.conditions[1].params).toEqual(['tenant:tenant-1:family:AIRBUS%7CTFU%7C00.00.10000']);
    expect(fixture.row).toEqual(before);
  });

  it.each(['missing source proof', 'conflicting source proof', 'generic support family'])(
    'refuses historical footer authority with %s', async failure => {
      const fixture = tfuHistoricalCatalogFixture();
      const source = JSON.parse(fixture.row.acquisition.sourceDescriptorJson);
      const normalized = JSON.parse(fixture.row.preflight.normalizedDescriptorJson);
      if (failure === 'missing source proof') delete source.publicationIdentityEvidence;
      if (failure === 'conflicting source proof') source.publicationIdentityEvidence.publisher.text = 'COPYRIGHT Airbus SAS, 2042';
      if (failure === 'generic support family') normalized.canonicalDocumentFamily = 'GENERIC';
      fixture.row.acquisition.sourceDescriptorJson = JSON.stringify(source);
      fixture.row.preflight.normalizedDescriptorJson = JSON.stringify(normalized);
      const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);
      await expect(catalog.readHistoricalImportCandidate({ preflightId: 'PREFLIGHT-1', actorUserId: 'engineer-1', tenantId: 'tenant-1' }))
        .rejects.toMatchObject({ code: 'HISTORICAL_IMPORT_LINEAGE_INVALID' });
      expect(fixture.conditions).toHaveLength(1);
    },
  );
});

function tfuHistoricalCatalogFixture() {
  const replay = tfuReplayCatalogFixture();
  const row = { preflight: { ...replay.row.preflight, decision: 'ASK_IMPORT_OLDER_REVISION', executionAuthorized: false, status: 'READY' },
    acquisition: replay.acquisition, artifact: replay.row.artifact };
  const conditions: Array<{ params: unknown[] }> = [];
  const db = { select: jest.fn(() => ({ from: (table: unknown) => {
    const query = { innerJoin: (..._args: unknown[]) => query,
      where: (condition: unknown) => { conditions.push(new PgDialect().sqlToQuery(condition as never)); return query; },
      limit: async () => table === dmIngressPreflight ? [row]
        : table === dmPublicationFamily ? [replay.row.family]
          : table === dmDocument ? [{ documentId: 'DOC-1', familyId: 'FAMILY-1' }] : [],
    };
    return query;
  } })) };
  return { db, row, conditions };
}

function tfuReplayCatalogFixture() {
  const fixture = replayCatalogFixture();
  const descriptor = {
    identityAuthority: 'DM_ACTUAL_PDF_HEADER_AND_PUBLISHER_FOOTER', pageCount: 4,
    sha256: fixture.row.artifact.sha256, sizeBytes: fixture.row.artifact.byteLength,
    documentCode: '00.00.10000', canonicalDocumentFamily: 'TFU', issuer: 'AIRBUS',
    businessRevision: '', revisionDate: '2042-01-22', sourceGeneratedDate: '',
    adapterRelease: { adapterId: 'issuer.airbus.technical_follow_up.v1' },
    publicationIdentityEvidence: {
      schemaVersion: 'wiselink.pdf_publication_identity_evidence.v1', adapterId: 'issuer.airbus.technical_follow_up.v1',
      sourceSha256: fixture.row.artifact.sha256, sourceByteLength: fixture.row.artifact.byteLength,
      documentCode: '00.00.10000', issueDate: '2042-01-22', primaryHeaderLocator: { kind: 'PDF_PAGE', pageIndex: 0 },
      publisher: { source: 'PUBLISHER_FOOTER', page: 4, text: '© Airbus SAS, 2042', sourceLocator: { kind: 'PDF_PAGE', pageIndex: 3 } },
    },
  };
  Object.assign(fixture.row.family, { documentFamily: 'TFU', issuerAuthority: 'AIRBUS', canonicalDocumentNumber: '00.00.10000' });
  Object.assign(fixture.row.version, { businessRevision: '', revisionDate: '2042-01-22' });
  fixture.row.preflight.normalizedDescriptorJson = JSON.stringify(descriptor);
  fixture.acquisition.sourceDescriptorJson = JSON.stringify(descriptor);
  return fixture;
}

function replayCatalogFixture() {
  const recorded = recordAcquisitionInput();
  const acquisition = {
    ...recorded.acquisition,
    sourceDescriptorJson: JSON.stringify(recorded.acquisition.sourceDescriptor),
    documentVersionId: 'DV-1',
    status: 'LINKED_EXACT_DOCUMENT_VERSION',
  };
  const row = {
    artifact: { ...recorded.sourceArtifact },
    version: {
      documentVersionId: 'DV-1', documentId: 'DOC-1', familyId: 'FAMILY-1',
      acquisitionId: 'ACQUISITION-ORIGINAL', sourceArtifactId: 'SOURCE-1',
      businessRevision: 'R1', revisionDate: '2020-09-24', sourceGeneratedDate: '',
    },
    family: {
      familyId: 'FAMILY-1', canonicalIdentityKey: 'tenant:tenant-1:family:BOEING%7CSB%7CSB-1',
      canonicalDocumentNumber: 'SB-1', documentFamily: 'SB', issuerAuthority: 'BOEING', currentGeneration: 1,
    },
    preflight: {
      preflightId: 'PREFLIGHT-1', acquisitionId: 'ACQUISITION-1', documentVersionId: 'DV-1',
      decision: 'RESUME_EXISTING_PROCESS', status: 'COMMITTED',
      commitIdempotencyKey: 'catalog:ACQUISITION-1',
      normalizedDescriptorJson: JSON.stringify({
        identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES', pageCount: 13,
        sha256: recorded.sourceArtifact.sha256, sizeBytes: recorded.sourceArtifact.byteLength,
        documentCode: 'SB-1', canonicalDocumentFamily: 'SB', issuer: 'BOEING',
        businessRevision: 'R1', revisionDate: '2020-09-24', sourceGeneratedDate: '',
      }),
    },
  };
  const db = {
    select: jest.fn(() => ({
      from: (table: unknown) => {
        const query = {
          innerJoin: (..._args: unknown[]) => query,
          where: (..._args: unknown[]) => query,
          limit: async () => {
            if (table === dmAcquisition) return [acquisition];
            expect(table).toBe(dmDocumentVersion);
            return [row];
          },
        };
        return query;
      },
    })),
  };
  return {
    db, row, acquisition,
    input: {
      idempotencyKey: acquisition.idempotencyKey,
      expectedAcquisitionId: acquisition.acquisitionId,
      sourceChannel: acquisition.sourceChannel, sourceRef: acquisition.sourceRef,
      selection: { bucketId: acquisition.selectionBucketId, filePath: acquisition.selectionFilePath },
    },
  };
}

function recordAcquisitionInput(): RecordAcquisitionInput {
  return {
    sourceArtifact: {
      sourceArtifactId: 'SOURCE-1',
      sha256: 'a'.repeat(64),
      byteLength: 1024,
      mediaType: 'application/pdf',
      bucketId: 'bucket-1',
      filePath: 'immutable/source.pdf',
      providerObjectId: 'provider-object-1',
      providerVersionId: 'provider-version-1',
      readbackVerified: true,
      createdAt: '2026-09-06T00:00:00.000Z',
    },
    acquisition: {
      acquisitionId: 'ACQUISITION-1',
      sourceArtifactId: 'SOURCE-1',
      sourceChannel: 'upload',
      sourceRef: 'upload:source.pdf',
      selectionBucketId: 'selection-bucket-1',
      selectionFilePath: 'source.pdf',
      providerObjectId: 'selection-object-1',
      providerVersionId: 'selection-version-1',
      acquiredBy: 'engineer-1',
      acquiredAt: '2026-09-06T00:00:00.000Z',
      idempotencyKey: 'ACQUISITION-IDEMPOTENCY-1',
      sourceDescriptor: { originalFilename: 'source.pdf' },
    },
  };
}

function verifiedUploadCatalog(options: {
  missingSession?: boolean; expired?: boolean; nativeActor?: string; nativeTenant?: string;
  acquiredBy?: string; failAcquisitionInsert?: boolean;
} = {}) {
  const priorSandbox = process.env.SANDBOX_ID, priorLocal = process.env.MIAODA_LOCAL_DEV;
  const identity: VerifiedIdentity = {
    subjectMappingId: '11111111-1111-4111-8111-111111111111', provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
    miaodaUserId: 'engineer-1', tenantId: 'tenant-1', feishuUserId: null, feishuOpenId: 'ou_fixture',
    namespacedSubject: { namespace: 'FEISHU_OPEN_ID', subject: 'ou_fixture', tenantKey: 'tenant-key-fixture' },
    verifiedAt: '2026-10-15T00:00:00.000Z',
  };
  const request = { headers: { cookie: 'wl_session=constructed-source-session' }, userContext: {
    userId: options.nativeActor ?? 'engineer-1', tenantId: options.nativeTenant ?? 'tenant-1',
    appId: CANONICAL_MIAODA_APP_ID, env: 'runtime', roles: [],
  } } as unknown as Request;
  const sql = new AsyncLocalStorage<Request['userContext']>();
  const scopes: Array<Request['userContext']> = [];
  const database = catalogDatabase({ failAcquisitionInsert: options.failAcquisitionInsert,
    assertSqlContext: () => {
      if (!sql.getStore()?.isSystemAccount || sql.getStore()?.userId !== 'engineer-1')
        throw Object.assign(new Error('Source registration requires its verified Host SQL context.'), { code: '42501' });
    } });
  const sessions = new SessionResolver({ validate: jest.fn(async () => options.missingSession ? null : {
    identity, sessionId: 'session-fixture', revision: 1, expiresAt: new Date(Date.now() + (options.expired ? -1 : 60_000)),
  }) } as never, { applicationScopeId: CANONICAL_MIAODA_APP_ID, sessionEnvironment: 'runtime' } as never,
  { use: (scoped: Request, _response: unknown, next: () => void) => {
    scopes.push(scoped.userContext); sql.run(scoped.userContext, next);
  } } as never);
  const catalog = new MiaodaHostedDocumentCatalog(database.db as never, sessions);
  const input = recordAcquisitionInput();
  input.acquisition.sourceChannel = 'document_library_upload';
  input.acquisition.acquiredBy = options.acquiredBy ?? 'engineer-1';
  input.acquisition.sourceRef = 'DOCUMENT_UPLOAD:engineer-1:request-fixture';
  input.acquisition.idempotencyKey = 'tenant:tenant-1:request:document-upload:engineer-1:request-fixture';
  return { database, scopes, input, async run() {
    process.env.SANDBOX_ID = 'unit-source-registration'; delete process.env.MIAODA_LOCAL_DEV;
    try { return await sessions.withRequestSession(request, () => catalog.recordAcquisition(input)); }
    finally {
      if (priorSandbox === undefined) delete process.env.SANDBOX_ID; else process.env.SANDBOX_ID = priorSandbox;
      if (priorLocal === undefined) delete process.env.MIAODA_LOCAL_DEV; else process.env.MIAODA_LOCAL_DEV = priorLocal;
    }
  } };
}

function catalogDatabase(options: { failAcquisitionInsert?: boolean; assertSqlContext?: () => void } = {}): {
  db: { transaction: jest.Mock };
  state: CatalogState;
} {
  const state: CatalogState = {
    artifacts: [],
    acquisitions: [],
    operations: [],
  };
  const transaction = {
    insert: jest.fn((table: unknown) => ({
      values: (value: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          if (table === dmSourceArtifact) {
            state.operations.push('insert-source-artifact');
            const existing = state.artifacts.find(
              (row: Record<string, unknown>) =>
                row.sourceArtifactId === value.sourceArtifactId,
            );
            if (!existing) state.artifacts.push({ ...value });
            return;
          }
          if (table === dmAcquisition) {
            state.operations.push('insert-acquisition');
            if (options.failAcquisitionInsert) {
              throw new Error('ACQUISITION_INSERT_FAILED');
            }
            const existing = state.acquisitions.find(
              (row: Record<string, unknown>) =>
                row.idempotencyKey === value.idempotencyKey,
            );
            if (!existing) {
              state.acquisitions.push({
                ...value,
                documentVersionId: null,
              });
            }
          }
        },
      }),
    })),
    select: jest.fn(() => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async (limit: number) => {
            if (table === dmSourceArtifact) {
              state.operations.push('read-source-artifact');
              return state.artifacts.slice(0, limit);
            }
            state.operations.push('read-acquisition');
            return state.acquisitions.slice(0, limit);
          },
        }),
      }),
    })),
  };
  const db = {
    transaction: jest.fn(
      async (callback: (executor: typeof transaction) => Promise<unknown>) => {
        options.assertSqlContext?.();
        const artifactSnapshot = state.artifacts.map(
          (row: Record<string, unknown>) => ({ ...row }),
        );
        const acquisitionSnapshot = state.acquisitions.map(
          (row: Record<string, unknown>) => ({ ...row }),
        );
        try {
          return await callback(transaction);
        } catch (error) {
          state.artifacts.splice(
            0,
            state.artifacts.length,
            ...artifactSnapshot,
          );
          state.acquisitions.splice(
            0,
            state.acquisitions.length,
            ...acquisitionSnapshot,
          );
          throw error;
        }
      },
    ),
  };
  return { db, state };
}

/** Actual Catalog query builder and lineage classifier; explicit row/DB port, not physical SQL/RLS. */
function documentReadCatalogFixture(sourceBound = false) {
  const replay = replayCatalogFixture();
  const key = `tenant:tenant-1:request:${encodeURIComponent('document-upload:engineer-1:ordinary-request')}`;
  const acquisitionId = deterministicId('acquisition', key);
  const normalized = { identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES', pageCount: 2,
    sha256: replay.row.artifact.sha256, sizeBytes: replay.row.artifact.byteLength,
    documentCode: 'SB-1', canonicalDocumentFamily: 'SB', issuer: 'BOEING',
    businessRevision: 'R1', revisionDate: '2020-09-24', sourceGeneratedDate: '' };
  const artifact = { ...replay.row.artifact };
  const version = { ...replay.row.version, pdfSha256: artifact.sha256, byteLength: artifact.byteLength };
  const selectionPath = sourceBound ? 'tdms-source/uploads/selection.pdf' : 'ordinary-uploads/selection.pdf';
  const binding = { schemaVersion: 'wiselink.tdms-formal-document-binding.v1', requestId: 'TDMSIMPORT-' + 'a'.repeat(64),
    bindingId: 'TDMSBIND-' + 'b'.repeat(64), payloadDigest: 'a'.repeat(64),
    scope: { tenantId: 'tenant-1', sourceKey: 'TDMS', sourceInstanceId: 'synthetic-instance', scopeId: 'SB' },
    receiverId: 'synthetic-receiver', receiverRevision: 1, grantRevision: 1, permissionRevision: 'synthetic-old-permission',
    applicationScopeId: CANONICAL_MIAODA_APP_ID, actorSubjectId: 'engineer-1', ownerSnapshotId: 'synthetic-snapshot',
    sourceRecordId: 'synthetic-owner', number: 'SB-1', sourceVersion: { rawRevision: 'A', rawIteration: '1', confirmation: 'SOURCE_DECLARED' },
    businessVersion: { rawRevision: 'R1', rawIteration: null, confirmation: 'SOURCE_DECLARED' },
    sourceAttachmentId: 'synthetic-primary', sourceAttachmentVersion: null, filename: 'publication.pdf', mediaType: 'application/pdf',
    sha256: artifact.sha256, byteLength: artifact.byteLength,
    selection: { bucketId: replay.acquisition.selectionBucketId, filePath: selectionPath, expectedProviderObjectId: replay.acquisition.providerObjectId } };
  const descriptor = { ...normalized, sourceKind: 'document_library_upload',
    sourceStorageKey: `${artifact.bucketId}:${artifact.filePath}`, ...(sourceBound ? { tdmsRegistration: binding } : {}) };
  const acquisition = { ...replay.acquisition, acquisitionId, idempotencyKey: key,
    sourceChannel: 'document_library_upload', sourceRef: 'DOCUMENT_UPLOAD:engineer-1:ordinary-request',
    selectionFilePath: selectionPath, sourceDescriptorJson: JSON.stringify(descriptor) };
  const row = { version, artifact, family: replay.row.family, acquisition, preflight: { ...replay.row.preflight,
    acquisitionId, commitIdempotencyKey: `catalog:${acquisitionId}`, committedAt: new Date('2026-10-18T15:00:00.000Z'),
    normalizedDescriptorJson: JSON.stringify(normalized) } };
  const rows = [row];
  const conditions: Array<{ sql: string; params: unknown[] }> = [];
  const joins: Array<{ kind: string; table: unknown; condition: unknown }> = [];
  const db = { select: jest.fn(() => ({ from: (table: unknown) => {
    expect(table).toBe(dmDocumentVersion);
    const query = {
      innerJoin: (joined: unknown, condition: unknown) => { joins.push({ kind: 'inner', table: joined, condition }); return query; },
      leftJoin: (joined: unknown, condition: unknown) => { joins.push({ kind: 'left', table: joined, condition }); return query; },
      where: jest.fn(async (condition: unknown) => {
        const built = new PgDialect().sqlToQuery(condition as never);
        conditions.push(built);
        return rows.filter(item => item.version.documentVersionId === built.params[0] &&
          item.family.canonicalIdentityKey.startsWith(String(built.params[1])) &&
          item.acquisition.documentVersionId === item.version.documentVersionId &&
          item.acquisition.sourceArtifactId === item.version.sourceArtifactId);
      }),
    };
    return query;
  } })) };
  const catalog = new MiaodaHostedDocumentCatalog(db as never);
  const read = (documentVersionId = 'DV-1', tenantId = 'tenant-1') => catalog.readDocumentSourceReadProvenance({ documentVersionId, tenantId });
  return { row, rows, descriptor, binding, normalized, conditions, joins, db, catalog, read };
}

describe('exact DVI persistent Source/ordinary read provenance', () => {
  it('recognizes a complete independent normal upload with actual PDF proof; query is exact DVI/tenant and joins linked acquisitions', async () => {
    const f = documentReadCatalogFixture();
    await expect(f.read()).resolves.toMatchObject({ documentVersionId: 'DV-1', sourceArtifactId: 'SOURCE-1',
      sha256: 'a'.repeat(64), byteLength: 1024, independentOrdinary: true, sourceBindings: [] });
    expect(f.conditions[0].params).toEqual(['DV-1', 'tenant:tenant-1:family:']);
    expect(f.joins.map(join => join.table)).toEqual([dmPublicationFamily, dmSourceArtifact, dmAcquisition, dmIngressPreflight]);
    expect(f.joins.at(-1)?.kind).toBe('left');
    const acquisitionJoin = new PgDialect().sqlToQuery(f.joins[2].condition as never).sql;
    expect(acquisitionJoin).toContain('"dm_acquisition"."document_version_id" = "dm_document_version"."document_version_id"');
    expect(acquisitionJoin).toContain('"dm_acquisition"."source_artifact_id" = "dm_document_version"."source_artifact_id"');
    // The linked acquisition differs from version.acquisitionId: provenance cannot inspect only the original origin.
    expect(f.row.version.acquisitionId).not.toBe(f.row.acquisition.acquisitionId);
  });
  it('returns a Source-only linked stamp and retains all exact immutable pins', async () => {
    const f = documentReadCatalogFixture(true);
    await expect(f.read()).resolves.toMatchObject({ independentOrdinary: false, sourceBindings: [f.binding] });
    expect(JSON.parse(f.row.acquisition.sourceDescriptorJson).tdmsRegistration).toEqual(f.binding);
  });
  it.each(['tdms-selection', 'canonical-selection', 'missing-source-kind', 'wrong-source-kind', 'wrong-request', 'wrong-acquisition',
    'missing-provider', 'unknown-channel', 'external-discovery', 'tdms-source-key'] as const)(
    'does not invent an independent ordinary acquisition from %s', async corruption => {
      const f = documentReadCatalogFixture();
      if (corruption === 'tdms-selection') f.row.acquisition.selectionFilePath = 'tdms-source/uploads/looks-ordinary.pdf';
      if (corruption === 'canonical-selection') f.row.acquisition.selectionFilePath = '/document-management/source/sha256/aa/looks-ordinary.pdf';
      if (corruption === 'missing-source-kind') Reflect.deleteProperty(f.descriptor, 'sourceKind');
      if (corruption === 'wrong-source-kind') f.descriptor.sourceKind = 'other';
      if (corruption === 'wrong-request') f.row.acquisition.sourceRef = 'DOCUMENT_UPLOAD:engineer-1:different-request';
      if (corruption === 'wrong-acquisition') f.row.acquisition.acquisitionId = 'forged-id';
      if (corruption === 'missing-provider') f.row.acquisition.providerObjectId = '';
      if (corruption === 'unknown-channel') f.row.acquisition.sourceChannel = 'unknown-channel';
      if (corruption === 'external-discovery') Object.assign(f.descriptor, { externalDiscovery: { source: 'candidate' } });
      if (corruption === 'tdms-source-key') Object.assign(f.descriptor, { sourceKey: 'TDMS' });
      f.row.acquisition.sourceDescriptorJson = JSON.stringify(f.descriptor);
      await expect(f.read()).resolves.toBeNull();
    },
  );
  it.each(['not-committed', 'no-commit-time', 'commit-key', 'wrong-decision', 'source-length', 'source-hash', 'identity-authority',
    'storage-key', 'business-revision', 'date', 'missing-preflight', 'duplicate-preflight', 'stamp-null', 'stamp-owner', 'stamp-bytes'] as const)(
    'partial or forged persistent %s cannot become read provenance', async corruption => {
      const f = documentReadCatalogFixture(true);
      if (corruption === 'not-committed') f.row.acquisition.status = 'ACQUIRED_READBACK_VERIFIED';
      if (corruption === 'no-commit-time') Reflect.set(f.row.preflight, 'committedAt', null);
      if (corruption === 'commit-key') f.row.preflight.commitIdempotencyKey = 'catalog:other';
      if (corruption === 'wrong-decision') f.row.preflight.decision = 'INGEST_NEW_FAMILY';
      if (corruption === 'source-length') f.row.version.byteLength++;
      if (corruption === 'source-hash') f.row.version.pdfSha256 = 'b'.repeat(64);
      if (corruption === 'identity-authority') Object.assign(f.normalized, { identityAuthority: 'CALLER_APPROVED' });
      if (corruption === 'storage-key') f.descriptor.sourceStorageKey = 'different:object';
      if (corruption === 'business-revision') f.normalized.businessRevision = 'R2';
      if (corruption === 'date') f.normalized.revisionDate = '2020-09-25';
      if (corruption === 'missing-preflight') Reflect.set(f.row, 'preflight', null);
      if (corruption === 'duplicate-preflight') f.rows.push(copyLineage(f.row));
      if (corruption === 'stamp-null') Reflect.set(f.descriptor, 'tdmsRegistration', null);
      if (corruption === 'stamp-owner') f.binding.actorSubjectId = 'different-importer';
      if (corruption === 'stamp-bytes') f.binding.sha256 = 'b'.repeat(64);
      f.row.acquisition.sourceDescriptorJson = JSON.stringify(f.descriptor);
      if (f.row.preflight) f.row.preflight.normalizedDescriptorJson = JSON.stringify(f.normalized);
      await expect(f.read()).resolves.toBeNull();
    },
  );
  it('neither equal content hash nor an incomplete ordinary acquisition confers independent rights', async () => {
    const f = documentReadCatalogFixture(true);
    const ordinary = documentReadCatalogFixture().row;
    ordinary.acquisition.acquisitionId = 'uncommitted-ordinary'; ordinary.acquisition.status = 'ACQUIRED_READBACK_VERIFIED';
    f.rows.push(ordinary);
    await expect(f.read()).resolves.toMatchObject({ independentOrdinary: false, sourceBindings: [f.binding] });
    await expect(f.read('DV-SAME-HASH-OTHER')).resolves.toBeNull();
    await expect(f.read('DV-1', 'tenant-other')).resolves.toBeNull();
  });
  it('a valid independent ordinary path survives a separate malformed Source row without rewriting history', async () => {
    const f = documentReadCatalogFixture();
    const damaged = documentReadCatalogFixture(true).row;
    damaged.acquisition.acquisitionId = 'damaged-source'; damaged.preflight.commitIdempotencyKey = 'invalid';
    f.rows.push(damaged);
    const before = JSON.stringify(f.rows);
    await expect(f.read()).resolves.toMatchObject({ independentOrdinary: true, sourceBindings: [] });
    expect(JSON.stringify(f.rows)).toBe(before);
  });
  it('propagates a registry query failure without treating it as unknown or an ordinary acquisition', async () => {
    const f = documentReadCatalogFixture();
    const failure = Object.assign(new Error('query failed'), { code: '42P01' });
    f.db.select.mockImplementationOnce(() => { throw failure; });
    await expect(f.read()).rejects.toBe(failure);
  });
});

function copyLineage<T>(row: T): T { return structuredClone(row); }


describe('existing ordinary ingress consumers retain proven independent read lineage', () => {
  it.each(['tenant-scoped', 'legacy'] as const)('canonical_miaoda_document_selection actual request keeps %s acquisition rules', async mode => {
    const f = documentReadCatalogFixture();
    const selected = f.row.acquisition;
    const key = createHash('sha256').update(`tenant-1\n${selected.selectionBucketId}\n${selected.selectionFilePath}`).digest('hex');
    const requestKey = `ordinary-document-ingest:${key}`;
    selected.sourceChannel = 'canonical_miaoda_document_selection';
    selected.sourceRef = `miaoda-file-service:${selected.selectionBucketId}:${selected.selectionFilePath}`;
    selected.idempotencyKey = mode === 'tenant-scoped' ? `tenant:tenant-1:request:${encodeURIComponent(requestKey)}` : requestKey;
    selected.acquisitionId = mode === 'tenant-scoped' ? deterministicId('acquisition', selected.idempotencyKey)
      : deterministicId('acquisition', 'tenant-1', selected.idempotencyKey);
    f.row.preflight.acquisitionId = selected.acquisitionId;
    f.row.preflight.commitIdempotencyKey = `catalog:${selected.acquisitionId}`;
    f.descriptor.sourceKind = selected.sourceChannel;
    selected.sourceDescriptorJson = JSON.stringify(f.descriptor);
    await expect(f.read()).resolves.toMatchObject({ independentOrdinary: true, sourceBindings: [] });
    const workItems = { loadTenantDocumentAuthorizationBinding: jest.fn().mockResolvedValue({ workItemId: 'ordinary-current-right' }) };
    const authorizer = new OrdinaryDocumentManagementAuthorizer(workItems as never, {} as never, f.catalog);
    await expect(authorizer.assertCanRead({ actorUserId: 'engineer-1', tenantId: 'tenant-1', roles: [],
      action: 'DOCUMENT_READ', documentVersionId: 'DV-1' })).resolves.toBeUndefined();
    expect(workItems.loadTenantDocumentAuthorizationBinding).toHaveBeenCalledTimes(1);
  });
  it.each(['tenant-scoped', 'legacy'] as const)('canonical_review_attachment_selection opaque non-PDF provider path keeps %s acquisition rules', async mode => {
    const f = documentReadCatalogFixture();
    const selected = f.row.acquisition;
    selected.sourceChannel = 'canonical_review_attachment_selection';
    selected.sourceRef = 'ATTACHMENT:synthetic-conversation:synthetic-review-request';
    selected.selectionFilePath = '/1876604059672731'; // Existing review selector permits an opaque FileService object path.
    const requestKey = 'review-attachment:synthetic-conversation:synthetic-review-request';
    selected.idempotencyKey = mode === 'tenant-scoped' ? `tenant:tenant-1:request:${encodeURIComponent(requestKey)}` : requestKey;
    selected.acquisitionId = mode === 'tenant-scoped' ? deterministicId('acquisition', selected.idempotencyKey)
      : deterministicId('acquisition', 'tenant-1', selected.idempotencyKey);
    f.row.preflight.acquisitionId = selected.acquisitionId;
    f.row.preflight.commitIdempotencyKey = `catalog:${selected.acquisitionId}`;
    f.descriptor.sourceKind = selected.sourceChannel;
    selected.sourceDescriptorJson = JSON.stringify(f.descriptor);
    await expect(f.read()).resolves.toMatchObject({ independentOrdinary: true, sourceBindings: [] });
    const workItems = { loadTenantDocumentAuthorizationBinding: jest.fn().mockResolvedValue({ workItemId: 'review-current-right' }) };
    const authorizer = new OrdinaryDocumentManagementAuthorizer(workItems as never, {} as never, f.catalog);
    await expect(authorizer.assertCanRead({ actorUserId: 'engineer-1', tenantId: 'tenant-1', roles: [],
      action: 'DOCUMENT_READ', documentVersionId: 'DV-1' })).resolves.toBeUndefined();
    selected.selectionFilePath = '/tdms-source/uploads/opaque-selection';
    await expect(f.read()).resolves.toBeNull();
    await expect(authorizer.assertCanRead({ actorUserId: 'engineer-1', tenantId: 'tenant-1', roles: [],
      action: 'DOCUMENT_READ', documentVersionId: 'DV-1' })).rejects.toMatchObject({ code: 'DOCUMENT_VERSION_NOT_FOUND' });
  });
});


describe('Source provenance handed transaction', () => {
  it('uses the caller database for exact Source/ordinary lineage instead of opening the default database', async () => {
    const ordinary = documentReadCatalogFixture();
    const handed = documentReadCatalogFixture(true);
    const result = await ordinary.catalog.readDocumentSourceReadProvenance({
      documentVersionId: 'DV-1', tenantId: 'tenant-1',
    }, handed.db as never);
    expect(result).toMatchObject({ independentOrdinary: false, sourceBindings: [handed.binding] });
    expect(ordinary.db.select).not.toHaveBeenCalled();
    expect(handed.db.select).toHaveBeenCalledTimes(1);
  });
});
