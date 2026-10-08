import { createHash } from 'node:crypto';
import {
  fileServiceImport,
  tdmsUploadPath,
  TDMS_ARTIFACT_READ_MAX_BYTES,
} from '../../../server/modules/tdms-source/tdms-file-service-import.validation';
import { MiaodaTdmsArtifactStore } from '../../../server/modules/tdms-source/miaoda-tdms-artifact-store';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import {
  HostDecisionTdmsSourceAuthorization,
  UnconfiguredTdmsSourceAuthorization,
} from '../../../server/modules/tdms-source/tdms-source.authorization';
import { TdmsSourceController } from '../../../server/modules/tdms-source/tdms-source.controller';
import { actor, fixture } from './tdms-fixtures';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';

function setup(
  options: {
    deniedOwner?: boolean;
    corrupt?: boolean;
    drift?: boolean;
    deniedMembers?: boolean;
    revokedAfterAcquisition?: boolean;
    lateCas?: boolean;
    canonicalDenied?: boolean;
    existing?: boolean;
    promoted?: boolean;
    afterOwner?: boolean;
    afterLength?: boolean;
  } = {},
) {
  const bytes = Buffer.alloc(600 * 1024, 0x42);
  const artifact = {
    memberId: 'member',
    sourceAttachmentId: 'source-attachment',
    sourceAttachmentVersion: '1',
    fileName: 'original.eb',
    mediaType: 'application/octet-stream',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    ownerItemIds: ['a'],
    selection: {
      bucketId: 'bucket',
      filePath: 'tdms-source/uploads/owned-object.bin',
      expectedProviderObjectId: 'uploaded-object',
    },
  };
  const objects = new Map<string, any>();
  const metadata = (path: string, id: string) => ({
    bucketID: 'bucket',
    filePath: path,
    id,
    name: 'stored.bin',
    createdBy: { userID: options.deniedOwner ? 'other' : '123' },
    metadata: {
      mimeType: 'application/octet-stream',
      contentLength: bytes.length,
    },
  });
  objects.set(artifact.selection.filePath, {
    bytes,
    metadata: metadata(artifact.selection.filePath, 'uploaded-object'),
  });
  const canonical = {
    sourceArtifactId: 'CANONICAL-EXISTING',
    sha256: artifact.sha256,
    byteLength: bytes.length,
    mediaType: artifact.mediaType,
    bucketId: 'bucket',
    filePath: '/document-management/source/canonical.bin',
    providerObjectId: 'canonical-object',
    providerVersionId: 'canonical-object',
    readbackVerified: true,
    createdAt: new Date(),
  };
  if (options.existing)
    objects.set(canonical.filePath.replace(/^\//u, ''), {
      bytes,
      metadata: metadata(canonical.filePath, 'canonical-object'),
    });
  let reads = 0;
  const uploads: any[] = [];
  const files = {
    getDefaultBucket: jest.fn(async () => 'bucket'),
    from: jest.fn(() => ({
      getFileMetadata: jest.fn(async (path: string) => {
        reads++;
        if (options.canonicalDenied && path === canonical.filePath)
          throw Object.assign(new Error('DENIED'), { statusCode: 403 });
        const value = objects.get(path.replace(/^\//u, ''))?.metadata;
        if (options.drift && reads === 3 && value)
          return { ...value, id: 'changed-object' };
        if (options.afterOwner && reads === 3 && value)
          return { ...value, createdBy: { userID: 'other' } };
        if (options.afterLength && reads === 3 && value)
          return {
            ...value,
            metadata: { ...value.metadata, contentLength: bytes.length + 1 },
          };
        return value ?? null;
      }),
      download: jest.fn((path: string) => ({
        asStream: async () => {
          const o = objects.get(path.replace(/^\//u, ''));
          return {
            metadata: o.metadata,
            content: options.corrupt ? Buffer.from('corrupt') : o.bytes,
          };
        },
      })),
      upload: jest.fn(async (buffer: Buffer, opts: any) => {
        uploads.push(opts);
        const m = {
          ...metadata(opts.filePath, 'new-canonical'),
          name: opts.fileName,
        };
        objects.set(opts.filePath, { bytes: Buffer.from(buffer), metadata: m });
        return m;
      }),
    })),
  };
  const db = new MemoryTdmsRepository();
  let revision = '1';
  const acquisitions: any[] = [];
  const catalog = {
    readSourceArtifactByContent: jest.fn(async () =>
      options.existing ? canonical : null,
    ),
    recordAcquisition: jest.fn(async (input: any) => {
      acquisitions.push(input);
      if (options.revokedAfterAcquisition) revision = '2';
      if (options.lateCas)
        db.state.heads.push({
          scope: nativeScope,
          recordRef: 'other-record',
          sourceRecordId: 'AEO-1',
          recordKind: 'ENGINEERING_FILE',
          sourceRevisionRef: 'OTHER-HEAD',
          observedAt: '2026-10-05T10:00:00Z',
        });
      return {
        ...input.acquisition,
        status: options.promoted
          ? 'COMMITTED_CANONICAL'
          : 'ACQUIRED_READBACK_VERIFIED',
        documentVersionId: options.promoted ? 'DV-illegal' : null,
      };
    }),
  };
  const store = new MiaodaTdmsArtifactStore(files as any, catalog as any);
  const authorization = new HostDecisionTdmsSourceAuthorization(
    async () => [{ scope: nativeScope, permissionRevision: revision }],
    async ({ claims, grant }) => ({
      ...grant,
      authorityRef: 'fixture-only',
      captureRetentionAllowed: true,
      nativeProjectionAllowed: true,
      permittedMembers: {
        ...claims,
        artifacts: options.deniedMembers ? [] : claims.artifacts,
      },
    }),
  );
  const service = new TdmsSourceService(db, authorization, store, {
    assertRead: jest.fn(),
  });
  const input = {
    sourceKey: nativeScope.sourceKey,
    sourceInstanceId: nativeScope.sourceInstanceId,
    scopeId: nativeScope.scopeId,
    package: fixture(),
    artifactSelections: [artifact],
  };
  return {
    input,
    artifact,
    bytes,
    files,
    db,
    service,
    store,
    catalog,
    canonical,
    objects,
    uploads,
    acquisitions,
  };
}

describe('small metadata selection transport, actual service/store with explicit FileService/Catalog/SQL doubles', () => {
  it('large original bytes remain outside the512KiB original DTO while exact owner revisions gain controlled binding', async () => {
    const s = setup();
    expect(Buffer.byteLength(JSON.stringify(s.input))).toBeLessThan(512 * 1024);
    expect(s.bytes.length).toBeGreaterThan(512 * 1024);
    const result = await s.service.importFileServicePackage(actor(), s.input);
    expect(result.artifactBindings[0]).toMatchObject({
      byteLength: s.bytes.length,
      documentVersionId: null,
      immutableReadbackVerified: true,
    });
    expect(s.db.state.revisions[0]!.record.artifacts).toEqual(
      result.artifactBindings,
    );
    expect(s.db.state.revisions[0]!.artifactIdentities![0]).toMatchObject({
      sourceAttachmentId: 'source-attachment',
      sourceAttachmentVersion: '1',
      sha256: s.artifact.sha256,
    });
    expect(s.input.package.artifacts).toEqual([]);
    expect(s.input.package.records[0]!.artifactMemberIds).toEqual([]);
    expect(s.acquisitions[0].acquisition).toMatchObject({
      selectionFilePath: s.artifact.selection.filePath,
      providerObjectId: 'uploaded-object',
      sourceDescriptor: {
        candidateOnly: true,
        uploadSelectionPin: { providerObjectId: 'uploaded-object' },
      },
    });
    expect(s.uploads[0]).toMatchObject({ upsert: false });
    expect(s.uploads[0].filePath).toMatch(/\.bin$/u);
  });
  it('replays exact envelope without extra candidate acquisition or native history', async () => {
    const s = setup();
    const first = await s.service.importFileServicePackage(actor(), s.input);
    const second = await s.service.importFileServicePackage(actor(), s.input);
    expect(second).toEqual({ ...first, created: false });
    expect(s.acquisitions).toHaveLength(1);
    expect(s.db.state.revisions).toHaveLength(1);
  });
  it('changed object pin or owner relation in samepackage is an idempotency conflict', async () => {
    const s = setup();
    await s.service.importFileServicePackage(actor(), s.input);
    s.input.artifactSelections[0]!.selection.expectedProviderObjectId =
      'another';
    await expect(
      s.service.importFileServicePackage(actor(), s.input),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it.each([
    'deniedOwner',
    'corrupt',
    'drift',
    'deniedMembers',
    'promoted',
  ] as const)(
    'rejects %s without any native capture/revision success',
    async (flag) => {
      const s = setup({ [flag]: true });
      await expect(
        s.service.importFileServicePackage(actor(), s.input),
      ).rejects.toBeDefined();
      expect(s.db.state.captures).toHaveLength(0);
      expect(s.db.state.revisions).toHaveLength(0);
      if (flag === 'deniedMembers') expect(s.files.from).not.toHaveBeenCalled();
    },
  );
  it.each(['afterOwner', 'afterLength'] as const)(
    'same object with %s change is rejected',
    async (flag) => {
      const s = setup({ [flag]: true });
      await expect(
        s.service.importFileServicePackage(actor(), s.input),
      ).rejects.toBeDefined();
      expect(s.acquisitions).toHaveLength(0);
    },
  );
  it.each(['missing', 'path', 'bucket'] as const)(
    'initial %s metadata mismatch is denied',
    async (variant) => {
      const s = setup();
      const m = s.objects.get(s.artifact.selection.filePath).metadata;
      if (variant === 'missing')
        s.objects.delete(s.artifact.selection.filePath);
      if (variant === 'path') m.filePath = 'tdms-source/uploads/other.bin';
      if (variant === 'bucket') m.bucketID = 'other';
      await expect(
        s.service.importFileServicePackage(actor(), s.input),
      ).rejects.toBeDefined();
      expect(s.acquisitions).toHaveLength(0);
    },
  );
  it('unsafe numeric owner cannot masquerade as an exact large user identifier', async () => {
    const s = setup();
    const id = String(Number.MAX_SAFE_INTEGER + 1);
    s.objects.get(s.artifact.selection.filePath).metadata.createdBy.userID =
      Number(id);
    const a = actor();
    await expect(
      s.service.importFileServicePackage(
        { ...a, canonicalSubject: { ...a.canonicalSubject, id } },
        s.input,
      ),
    ).rejects.toMatchObject({ code: 'TDMS_UPLOAD_SELECTION_FORBIDDEN' });
    expect(s.acquisitions).toHaveLength(0);
  });
  it('provider object pin requires the actual string object identifier', async () => {
    const s = setup();
    s.objects.get(s.artifact.selection.filePath).metadata.id = 1;
    s.artifact.selection.expectedProviderObjectId = '1';
    await expect(
      s.service.importFileServicePackage(actor(), s.input),
    ).rejects.toMatchObject({ code: 'TDMS_UPLOAD_SELECTION_FORBIDDEN' });
    expect(s.acquisitions).toHaveLength(0);
  });
  it('forbidden bucket is rejected before metadata lookup', async () => {
    const s = setup();
    s.artifact.selection.bucketId = 'foreign';
    await expect(
      s.service.importFileServicePackage(actor(), s.input),
    ).rejects.toMatchObject({ code: 'TDMS_UPLOAD_SELECTION_FORBIDDEN' });
    expect(s.files.from).not.toHaveBeenCalled();
  });
  it('late source permission change preserves only candidate residual and no native receipt', async () => {
    const s = setup({ revokedAfterAcquisition: true });
    await expect(
      s.service.importFileServicePackage(actor(), s.input),
    ).rejects.toThrow('PERMISSION_CHANGED');
    expect(s.acquisitions).toHaveLength(1);
    expect(s.db.state.captures).toHaveLength(0);
    expect(s.db.state.receipts).toHaveLength(0);
  });
  it('late head CAS change after acquisition preserves only candidate residual', async () => {
    const s = setup({ lateCas: true });
    await expect(
      s.service.importFileServicePackage(actor(), s.input),
    ).rejects.toThrow('CAS_CONFLICT');
    expect(s.acquisitions).toHaveLength(1);
    expect(s.db.state.captures).toHaveLength(0);
    expect(s.db.state.revisions).toHaveLength(0);
  });
  it('existing canonical bytes reuse one exact identity while preserving current owned upload lineage and independent DV-null acquisition', async () => {
    const s = setup({ existing: true });
    const r = await s.service.importFileServicePackage(actor(), s.input);
    expect(r.artifactBindings[0]!.sourceArtifactId).toBe(
      s.canonical.sourceArtifactId,
    );
    expect(s.uploads).toHaveLength(0);
    expect(s.acquisitions[0].sourceArtifact.sourceArtifactId).toBe(
      s.canonical.sourceArtifactId,
    );
    expect(s.acquisitions[0].acquisition.providerObjectId).toBe(
      'uploaded-object',
    );
    expect(r.artifactBindings[0]!.documentVersionId).toBeNull();
  });
  it('current FileService denial of canonical object cannot be bypassed by content hash', async () => {
    const s = setup({ existing: true, canonicalDenied: true });
    await expect(
      s.service.importFileServicePackage(actor(), s.input),
    ).rejects.toBeDefined();
    expect(s.acquisitions).toHaveLength(0);
    expect(s.db.state.captures).toHaveLength(0);
  });
  it.each(['verified', 'object', 'version', 'hash', 'length', 'bytes'] as const)(
    'existing canonical %s drift cannot grant a candidate acquisition', async variant => {
      const s = setup({ existing: true });
      if (variant === 'verified') s.canonical.readbackVerified = false;
      if (variant === 'object') s.canonical.providerObjectId = 'changed-object';
      if (variant === 'version') s.canonical.providerVersionId = 'changed-version';
      if (variant === 'hash') s.canonical.sha256 = 'd'.repeat(64);
      if (variant === 'length') s.canonical.byteLength += 1;
      if (variant === 'bytes') s.objects.get(s.canonical.filePath.replace(/^\//u, '')).bytes = Buffer.alloc(s.bytes.length, 0x43);
      await expect(s.service.importFileServicePackage(actor(), s.input)).rejects.toBeDefined();
      expect(s.catalog.recordAcquisition).not.toHaveBeenCalled();
      expect(s.acquisitions).toHaveLength(0); expect(s.db.state.captures).toHaveLength(0);
    },
  );
  it('exact content race retries accessible winner only', async () => {
    const s = setup({ existing: true });
    s.catalog.readSourceArtifactByContent.mockResolvedValueOnce(null);
    s.catalog.recordAcquisition.mockRejectedValueOnce(
      Object.assign(new Error('wrapped'), {
        cause: {
          code: '23505',
          constraint_name: 'uk_dm_source_artifact_content',
        },
      }),
    );
    const r = await s.service.importFileServicePackage(actor(), s.input);
    expect(r.artifactBindings[0]!.sourceArtifactId).toBe(
      s.canonical.sourceArtifactId,
    );
    expect(s.catalog.recordAcquisition).toHaveBeenCalledTimes(2);
    expect(s.acquisitions).toHaveLength(1);
  });
  it.each([
    { code: '23505', constraint_name: 'other' },
    { code: '42501', constraint_name: 'uk_dm_source_artifact_content' },
  ])('does not retry $code/$constraint_name', async (cause) => {
    const s = setup();
    const error = Object.assign(new Error('wrapped'), { cause });
    s.catalog.recordAcquisition.mockRejectedValueOnce(error);
    await expect(
      s.service.importFileServicePackage(actor(), s.input),
    ).rejects.toBe(error);
    expect(s.catalog.recordAcquisition).toHaveBeenCalledTimes(1);
    expect(s.catalog.readSourceArtifactByContent).toHaveBeenCalledTimes(1);
  });
  it.each(['missing', 'denied', 'object', 'bytes', 'verified', 'version', 'hash', 'length'] as const)(
    'race winner %s cannot grant acquisition',
    async (variant) => {
      const s = setup({
        existing: true,
        canonicalDenied: variant === 'denied',
      });
      s.catalog.readSourceArtifactByContent.mockResolvedValueOnce(null);
      if (variant === 'missing')
        s.catalog.readSourceArtifactByContent.mockResolvedValue(null);
      if (variant === 'object') s.canonical.providerObjectId = 'changed';
      if (variant === 'version') s.canonical.providerVersionId = 'changed-version';
      if (variant === 'verified') s.canonical.readbackVerified = false;
      if (variant === 'hash') s.canonical.sha256 = 'd'.repeat(64);
      if (variant === 'length') s.canonical.byteLength += 1;
      if (variant === 'bytes')
        s.objects.get(s.canonical.filePath.replace(/^\//u, '')).bytes =
          Buffer.alloc(s.bytes.length, 0x43);
      s.catalog.recordAcquisition.mockRejectedValueOnce(
        Object.assign(new Error('wrapped'), {
          cause: {
            code: '23505',
            constraint_name: 'uk_dm_source_artifact_content',
          },
        }),
      );
      await expect(
        s.service.importFileServicePackage(actor(), s.input),
      ).rejects.toBeDefined();
      expect(s.catalog.recordAcquisition).toHaveBeenCalledTimes(1);
      expect(s.acquisitions).toHaveLength(0);
      expect(s.db.state.captures).toHaveLength(0);
    },
  );
  it('metadata-first historical NOT_READ survives while later exact bytes get an independent Host fact', async () => {
    const s = setup();
    const old = fixture();
    old.records[0]!.unreadAttachments = [
      {
        sourceAttachmentId: s.artifact.sourceAttachmentId,
        sourceAttachmentVersion: '1',
        fileName: 'original.eb',
        mediaType: s.artifact.mediaType,
        byteLength: s.bytes.length,
        readStatus: 'NOT_READ',
        gap: 'metadata only',
        selector: 'attachment.row',
      },
    ];
    const previous = await s.service.importPackage(
      actor(),
      {
        sourceKey: s.input.sourceKey,
        sourceInstanceId: s.input.sourceInstanceId,
        scopeId: s.input.scopeId,
      },
      old,
    );
    s.input.package.packageId = 'later';
    s.input.package.records[0]!.expectedHeadRevisionRef =
      previous.recordRevisionRefs[0]!;
    const current = await s.service.importFileServicePackage(actor(), s.input);
    const historical = await s.service.readRecord(
      actor(),
      previous.recordRevisionRefs[0]!,
    );
    expect(historical.record.unreadAttachments[0]!.readStatus).toBe('NOT_READ');
    expect(historical.record.artifacts).toHaveLength(0);
    const read = await s.service.readRecord(
      actor(),
      current.recordRevisionRefs[0]!,
    );
    expect(read.attachmentAcquisitions![0]).toMatchObject({
      sourceReadStatusAtObservation: 'NOT_READ',
      sourceObservationRevisionRef: previous.recordRevisionRefs[0],
      currentSourcePermissionChecked: true,
      semanticReadPerformed: false,
      engineeringExecutionVerified: false,
    });
    expect(read.record.rawFields.checkbox).toBe(false);
    expect(current.gaps).not.toContain('SAME_ATTACHMENT_VERSION_BYTES_CHANGED');
  });
  it('source observation NOT_READ and later verified Host bytes retain separate times and raw status', async () => {
    const s = setup();
    s.input.package.records[0]!.unreadAttachments = [
      {
        sourceAttachmentId: s.artifact.sourceAttachmentId,
        sourceAttachmentVersion: '1',
        fileName: 'original.eb',
        mediaType: s.artifact.mediaType,
        byteLength: s.bytes.length,
        readStatus: 'NOT_READ',
        gap: 'source metadata only',
        selector: 'attachment.row',
      },
    ];
    const r = await s.service.importFileServicePackage(actor(), s.input);
    const read = await s.service.readRecord(actor(), r.recordRevisionRefs[0]!);
    expect(read.record.unreadAttachments[0]!.readStatus).toBe('NOT_READ');
    expect(read.attachmentAcquisitions![0]!.sourceReadStatusAtObservation).toBe(
      'NOT_READ',
    );
    expect(
      Date.parse(read.attachmentAcquisitions![0]!.hostBytesVerifiedAt),
    ).toBeGreaterThan(
      Date.parse(read.attachmentAcquisitions![0]!.sourceObservedAtDeclared),
    );
    expect(r.gaps).not.toContain('ATTACHMENTS_NOT_READ');
  });
  it('same-version NOT_READ observation at/after acquisition has explicit temporal input conflict', async () => {
    const s = setup();
    s.input.package.records[0]!.observedAt = '2100-01-01T00:00:00Z';
    s.input.package.records[0]!.unreadAttachments = [
      {
        sourceAttachmentId: s.artifact.sourceAttachmentId,
        sourceAttachmentVersion: '1',
        fileName: 'original.eb',
        mediaType: s.artifact.mediaType,
        byteLength: s.bytes.length,
        readStatus: 'NOT_READ',
        gap: 'same observation',
        selector: 'attachment.row',
      },
    ];
    await expect(
      s.service.importFileServicePackage(actor(), s.input),
    ).rejects.toMatchObject({
      code: 'TDMS_ATTACHMENT_OBSERVATION_TIME_UNDISTINGUISHED',
    });
    expect(s.db.state.captures).toHaveLength(0);
    expect(s.acquisitions).toHaveLength(1);
  });
  it('default source provider remains closed before selected FileService I/O', async () => {
    const s = setup();
    const service = new TdmsSourceService(
      s.db,
      new UnconfiguredTdmsSourceAuthorization(),
      s.store,
      { assertRead: jest.fn() },
    );
    await expect(
      service.importFileServicePackage(actor(), s.input),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED' });
    expect(s.files.from).not.toHaveBeenCalled();
  });
  it('public controller constructs actor from verified ingress, never envelope identities', () => {
    const s = setup();
    const mock = { importFileServicePackage: jest.fn() };
    const controller = new TdmsSourceController(mock as any);
    const a = actor();
    controller.importFileServicePackage(
      {
        userContext: {
          userId: a.canonicalSubject.id,
          tenantId: a.tenantId,
          appId: a.applicationScopeId,
          env: 'preview',
          isSystemAccount: false,
        },
      } as any,
      s.input,
    );
    expect(mock.importFileServicePackage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        canonicalSubject: { namespace: 'MIAODA_USER_ID', id: '123' },
      }),
      s.input,
    );
  });
  it.each(['tenantId', 'actorId', 'roles', 'acl', 'downloadUrl'])(
    'rejects untrusted envelope %s field',
    (key) => {
      const s = setup();
      expect(() => fileServiceImport({ ...s.input, [key]: 'evil' })).toThrow(
        'UNKNOWN_FIELD',
      );
    },
  );
  it.each([
    '../outside',
    'tdms-source/uploads/../x.bin',
    'tdms-source/uploads/a/b.bin',
    'tdms-source/uploads/a\\b.bin',
    'tdms-source/uploads/%2e%2e.bin',
    'tdms-source/candidate/hash.bin',
    'https://example.com/x',
  ])('rejects locator %s', (path) => {
    expect(() => tdmsUploadPath(path)).toThrow();
  });
  it.each(['missing', 'duplicate', 'empty'] as const)(
    'rejects %s owner mapping before admission',
    (which) => {
      const s = setup();
      s.artifact.ownerItemIds =
        which === 'missing'
          ? ['unknown']
          : which === 'duplicate'
            ? ['a', 'a']
            : [];
      expect(() => fileServiceImport(s.input)).toThrow('OWNER_INVALID');
    },
  );
  it('rejects inline-artifact mixing, arbitrary locator keys and oversized structural JSON', () => {
    const s = setup();
    s.input.package.records[0]!.artifactMemberIds = ['member'];
    expect(() => fileServiceImport(s.input)).toThrow();
    s.input.package.records[0]!.artifactMemberIds = [];
    expect(() =>
      fileServiceImport({
        ...s.input,
        artifactSelections: [
          {
            ...s.artifact,
            selection: { ...s.artifact.selection, url: 'evil' },
          },
        ],
      }),
    ).toThrow('UNKNOWN_FIELD');
    s.input.package.records[0]!.rawFields.large = 'x'.repeat(512 * 1024);
    expect(() => fileServiceImport(s.input)).toThrow('SMALL_PACKAGE_LIMIT');
  });
  it('enforces aggregate read budget separately from small-envelope bytes', () => {
    const s = setup();
    s.artifact.byteLength = TDMS_ARTIFACT_READ_MAX_BYTES;
    s.input.artifactSelections.push({
      ...s.artifact,
      memberId: 'second',
      byteLength: 1,
    });
    expect(() => fileServiceImport(s.input)).toThrow('READ_BUDGET');
  });
});
