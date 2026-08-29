import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

jest.mock(
  '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  () => ({ MiaodaFileServiceArtifactStore: jest.fn() }),
);

import type { CanonicalWorkItemProjection } from '@shared/api.interface';

import { createCanonicalPdfPreviewLocatorCodec } from '../../server/modules/canonical-host/canonical-pdf-preview-locator.codec';
import { CanonicalPdfPreviewService } from '../../server/modules/canonical-host/canonical-pdf-preview.service';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import { MiaodaFileServiceArtifactStore } from '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js';

const PDF_BYTES = readFileSync(
  resolve(
    process.cwd(),
    'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2/fixtures/source/minimal-pdf.pdf',
  ),
);
const PDF_SHA256 = createHash('sha256').update(PDF_BYTES).digest('hex');
const LOCATOR_KEY = Buffer.alloc(32, 0x31).toString('base64url');
const OTHER_LOCATOR_KEY = Buffer.alloc(32, 0x72).toString('base64url');
const ACTOR: CanonicalHostActor = {
  userId: 'engineer-1001',
  tenantId: 'tenant-2001',
  appId: 'app_17bzc551rsg',
  roles: ['authenticated'],
  env: 'preview',
};

interface TestTarget {
  service: CanonicalPdfPreviewService;
  projection: CanonicalWorkItemProjection;
  authorization: { authorize: jest.Mock };
  permissionSnapshots: { freshRead: jest.Mock };
  registrar: { getTenantScopedByWorkItemId: jest.Mock };
  resolver: { resolve: jest.Mock };
  sourceStore: { readSelection: jest.Mock };
}

function projection(
  revision = 7,
  requestId = 'REQ-PDF-1001',
): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-PDF-1001',
    requestId,
    revision,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission:test',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'sha256:actor',
      decisionId: 'decision-parse',
      decisionHash: 'sha256:decision',
      permissionSnapshotVersion: 'permission:test',
    },
    source: {
      documentId: 'DOC-INTERNAL-1001',
      documentVersionId: 'DV-INTERNAL-1001',
      parserRequestId: 'PARSER-REQUEST-1001',
      sourceArtifactId: 'SOURCE-INTERNAL-1001',
      sourceFileSha256: `sha256:${PDF_SHA256}`,
      sourceByteLength: PDF_BYTES.byteLength,
      driveFileToken: 'DRIVE-TOKEN-INTERNAL',
      driveSourceVersion: 'DRIVE-VERSION-INTERNAL',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'FTD',
      classifierReleaseId: 'classifier@test',
      classifierReleaseHash: 'sha256:classifier',
      parserProfileId: 'parser@test',
      parserProfileHash: 'sha256:parser',
      fingerprint: 'sha256:fingerprint',
    },
    package: null,
    failure: null,
    recordingFailure: null,
  };
}

function resolvedSource(value: CanonicalWorkItemProjection) {
  return {
    version: {
      documentVersionId: value.source.documentVersionId,
      sourceArtifactId: value.source.sourceArtifactId,
      pdfSha256: PDF_SHA256,
      byteLength: value.source.sourceByteLength,
      mediaType: 'application/pdf',
      lifecycleStatus: 'COMMITTED_IMMUTABLE',
      committedBy: ACTOR.userId,
    },
    artifact: {
      sourceArtifactId: value.source.sourceArtifactId,
      sha256: PDF_SHA256,
      byteLength: value.source.sourceByteLength,
      mediaType: 'application/pdf',
      bucketId: 'BUCKET-INTERNAL-1001',
      filePath: '/controlled/internal/source.pdf',
      providerObjectId: 'PROVIDER-INTERNAL-1001',
      providerVersionId: 'PROVIDER-INTERNAL-1001',
      readbackVerified: true,
    },
    acquisition: { acquiredBy: ACTOR.userId },
    family: { currentDocumentVersionId: value.source.documentVersionId },
    currentness: { nextDocumentVersionId: value.source.documentVersionId },
  };
}

function target(options: { locatorKey?: string | null } = {}): TestTarget {
  const value: CanonicalWorkItemProjection = projection();
  const authorization = {
    authorize: jest.fn().mockResolvedValue({
      action: 'READ_DOCUMENT_PARSING',
      allowed: true,
      actorFingerprint: 'sha256:actor',
      decisionId: 'decision-read',
      decisionHash: 'sha256:decision',
      permissionSnapshotVersion: 'permission:test',
    }),
  };
  const permissionSnapshots = {
    freshRead: jest.fn().mockResolvedValue({
      permissionSnapshotVersion: 'permission:test',
    }),
  };
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn().mockResolvedValue(value),
  };
  const resolver = {
    resolve: jest.fn().mockResolvedValue(resolvedSource(value)),
  };
  const sourceStore = {
    readSelection: jest.fn().mockResolvedValue({
      providerObjectId: 'PROVIDER-INTERNAL-1001',
      sha256: PDF_SHA256,
      byteLength: PDF_BYTES.byteLength,
      mediaType: 'application/pdf',
      bytes: PDF_BYTES,
    }),
  };
  jest
    .mocked(MiaodaFileServiceArtifactStore)
    .mockImplementationOnce(() => sourceStore as never);
  return {
    projection: value,
    authorization,
    permissionSnapshots,
    registrar,
    resolver,
    sourceStore,
    service: new CanonicalPdfPreviewService(
      registrar as never,
      authorization as never,
      permissionSnapshots as never,
      resolver as never,
      createCanonicalPdfPreviewLocatorCodec(
        options.locatorKey === null
          ? undefined
          : (options.locatorKey ?? LOCATOR_KEY),
      ),
      {} as never,
    ),
  };
}

async function availablePreview(testTarget: TestTarget) {
  const preview = await testTarget.service.issue(testTarget.projection, ACTOR);
  if (preview.status !== 'AVAILABLE') {
    throw new Error(`EXPECTED_AVAILABLE:${preview.reason}`);
  }
  return preview;
}

describe('CanonicalPdfPreviewService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('issues only an opaque short-lived locator and full-reads real PDF bytes', async () => {
    const testTarget: TestTarget = target();
    const preview = await availablePreview(testTarget);
    const serialized: string = JSON.stringify(preview);

    expect(preview).toMatchObject({
      status: 'AVAILABLE',
      mediaType: 'application/pdf',
      byteLength: PDF_BYTES.byteLength,
      supportsRange: false,
      navigation: 'PAGE_START',
    });
    expect(preview.opaqueLocator).toMatch(/^v1\.[A-Za-z0-9_-]+$/u);
    for (const secret of [
      'DOC-INTERNAL-1001',
      'REQ-PDF-1001',
      'DV-INTERNAL-1001',
      'SOURCE-INTERNAL-1001',
      'DRIVE-TOKEN-INTERNAL',
      'BUCKET-INTERNAL-1001',
      '/controlled/internal/source.pdf',
      'PROVIDER-INTERNAL-1001',
      PDF_SHA256,
      LOCATOR_KEY,
    ]) {
      expect(serialized).not.toContain(secret);
    }

    await expect(
      testTarget.service.read({
        actor: ACTOR,
        workItemId: testTarget.projection.workItemId,
        opaqueLocator: preview.opaqueLocator,
        method: 'GET',
        range: null,
      }),
    ).resolves.toEqual({
      kind: 'FULL',
      byteLength: PDF_BYTES.byteLength,
      bytes: PDF_BYTES,
    });
    expect(testTarget.authorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'READ_DOCUMENT_PARSING',
        requestId: 'REQ-PDF-1001',
        documentVersionId: 'DV-INTERNAL-1001',
      }),
    );
    expect(testTarget.permissionSnapshots.freshRead).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'REQ-PDF-1001',
        documentVersionId: 'DV-INTERNAL-1001',
      }),
    );
  });

  it('fails closed when the projection source SHA is not canonical', async () => {
    const testTarget: TestTarget = target();
    testTarget.projection.source.sourceFileSha256 =
      `sha256:${PDF_SHA256.toUpperCase()}`;

    await expect(
      testTarget.service.issue(testTarget.projection, ACTOR),
    ).resolves.toEqual({
      status: 'UNAVAILABLE',
      reason: 'PDF_PREVIEW_SOURCE_IDENTITY_INVALID',
      retryable: false,
    });
  });

  it('reads a locator issued by another service instance configured with the same key', async () => {
    const issuer: TestTarget = target();
    const reader: TestTarget = target();
    const preview = await availablePreview(issuer);

    await expect(
      reader.service.read({
        actor: ACTOR,
        workItemId: reader.projection.workItemId,
        opaqueLocator: preview.opaqueLocator,
        method: 'GET',
        range: null,
      }),
    ).resolves.toEqual({
      kind: 'FULL',
      byteLength: PDF_BYTES.byteLength,
      bytes: PDF_BYTES,
    });
    expect(reader.authorization.authorize).toHaveBeenCalledTimes(1);
    expect(reader.sourceStore.readSelection).toHaveBeenCalledTimes(1);
  });

  it('uniformly returns 404 for another key, a tampered locator, and an unknown version', async () => {
    const issuer: TestTarget = target();
    const preview = await availablePreview(issuer);
    const readers: Array<{ target: TestTarget; locator: string }> = [
      {
        target: target({ locatorKey: OTHER_LOCATOR_KEY }),
        locator: preview.opaqueLocator,
      },
      {
        target: target(),
        locator: `${preview.opaqueLocator.slice(0, -1)}${
          preview.opaqueLocator.endsWith('A') ? 'B' : 'A'
        }`,
      },
      {
        target: target(),
        locator: preview.opaqueLocator.replace(/^v1\./u, 'v2.'),
      },
    ];

    for (const reader of readers) {
      await expect(
        reader.target.service.read({
          actor: ACTOR,
          workItemId: reader.target.projection.workItemId,
          opaqueLocator: reader.locator,
          method: 'GET',
          range: null,
        }),
      ).rejects.toMatchObject({
        code: 'PDF_PREVIEW_NOT_FOUND',
        message: 'PDF_PREVIEW_NOT_FOUND',
        statusCode: 404,
      });
      expect(reader.target.authorization.authorize).not.toHaveBeenCalled();
      expect(reader.target.sourceStore.readSelection).not.toHaveBeenCalled();
    }
  });

  it('keeps preview unavailable when the dedicated key is missing or invalid', async () => {
    for (const testTarget of [
      target({ locatorKey: null }),
      target({ locatorKey: 'not-a-32-byte-key' }),
      target({ locatorKey: ` ${LOCATOR_KEY}` }),
    ]) {
      await expect(
        testTarget.service.issue(testTarget.projection, ACTOR),
      ).resolves.toEqual({
        status: 'UNAVAILABLE',
        reason: 'PDF_PREVIEW_NOT_CONFIGURED',
        retryable: false,
      });
      expect(testTarget.resolver.resolve).not.toHaveBeenCalled();
    }
  });

  it('returns 404 before authorization when any actor scope binding differs', async () => {
    const testTarget: TestTarget = target();
    const preview = await availablePreview(testTarget);
    const mismatchedActors: CanonicalHostActor[] = [
      { ...ACTOR, userId: 'engineer-2002' },
      { ...ACTOR, tenantId: 'tenant-2002' },
      { ...ACTOR, appId: 'app_wrong' },
      { ...ACTOR, env: 'runtime' },
    ];

    for (const actor of mismatchedActors) {
      await expect(
        testTarget.service.read({
          actor,
          workItemId: testTarget.projection.workItemId,
          opaqueLocator: preview.opaqueLocator,
          method: 'GET',
          range: null,
        }),
      ).rejects.toMatchObject({
        code: 'PDF_PREVIEW_NOT_FOUND',
        statusCode: 404,
      });
    }
    expect(testTarget.authorization.authorize).not.toHaveBeenCalled();
  });

  it('returns 410 after the short-lived locator expires', async () => {
    const now = 1_787_900_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const testTarget: TestTarget = target();
    const preview = await availablePreview(testTarget);
    jest.spyOn(Date, 'now').mockReturnValue(now + 13 * 60 * 1000);

    await expect(
      testTarget.service.read({
        actor: ACTOR,
        workItemId: testTarget.projection.workItemId,
        opaqueLocator: preview.opaqueLocator,
        method: 'GET',
        range: null,
      }),
    ).rejects.toMatchObject({
      code: 'PDF_PREVIEW_LOCATOR_EXPIRED',
      statusCode: 410,
    });
  });

  it('returns 409 when the fresh WorkItem revision drifts', async () => {
    const testTarget: TestTarget = target();
    const preview = await availablePreview(testTarget);
    testTarget.registrar.getTenantScopedByWorkItemId.mockResolvedValue(
      projection(testTarget.projection.revision + 1),
    );

    await expect(
      testTarget.service.read({
        actor: ACTOR,
        workItemId: testTarget.projection.workItemId,
        opaqueLocator: preview.opaqueLocator,
        method: 'GET',
        range: null,
      }),
    ).rejects.toMatchObject({
      code: 'PDF_PREVIEW_SOURCE_DRIFT',
      statusCode: 409,
    });
  });

  it('returns 409 when the fresh WorkItem requestId drifts', async () => {
    const testTarget: TestTarget = target();
    const preview = await availablePreview(testTarget);
    testTarget.registrar.getTenantScopedByWorkItemId.mockResolvedValue(
      projection(testTarget.projection.revision, 'REQ-PDF-DRIFTED'),
    );

    await expect(
      testTarget.service.read({
        actor: ACTOR,
        workItemId: testTarget.projection.workItemId,
        opaqueLocator: preview.opaqueLocator,
        method: 'GET',
        range: null,
      }),
    ).rejects.toMatchObject({
      code: 'PDF_PREVIEW_SOURCE_DRIFT',
      statusCode: 409,
    });
    expect(testTarget.resolver.resolve).toHaveBeenCalledTimes(1);
    expect(testTarget.sourceStore.readSelection).not.toHaveBeenCalled();
  });

  it('sanitizes fresh authorization and registrar failures', async () => {
    const authorizationTarget: TestTarget = target();
    const authorizationPreview = await availablePreview(authorizationTarget);
    authorizationTarget.authorization.authorize.mockRejectedValue(
      Object.assign(new Error('private authorization detail'), {
        statusCode: 503,
      }),
    );

    await expect(
      authorizationTarget.service.read({
        actor: ACTOR,
        workItemId: authorizationTarget.projection.workItemId,
        opaqueLocator: authorizationPreview.opaqueLocator,
        method: 'GET',
        range: null,
      }),
    ).rejects.toMatchObject({
      code: 'PDF_PREVIEW_SERVICE_UNAVAILABLE',
      message: 'PDF_PREVIEW_SERVICE_UNAVAILABLE',
      statusCode: 503,
    });

    const registrarTarget: TestTarget = target();
    const registrarPreview = await availablePreview(registrarTarget);
    registrarTarget.registrar.getTenantScopedByWorkItemId.mockRejectedValue(
      Object.assign(new Error('private tenant locator detail'), {
        statusCode: 404,
      }),
    );
    await expect(
      registrarTarget.service.read({
        actor: ACTOR,
        workItemId: registrarTarget.projection.workItemId,
        opaqueLocator: registrarPreview.opaqueLocator,
        method: 'GET',
        range: null,
      }),
    ).rejects.toMatchObject({
      code: 'PDF_PREVIEW_NOT_FOUND',
      message: 'PDF_PREVIEW_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('rejects Range honestly without downloading or returning a fake 206 body', async () => {
    const testTarget: TestTarget = target();
    const preview = await availablePreview(testTarget);

    await expect(
      testTarget.service.read({
        actor: ACTOR,
        workItemId: testTarget.projection.workItemId,
        opaqueLocator: preview.opaqueLocator,
        method: 'GET',
        range: 'bytes=0-1023',
      }),
    ).resolves.toEqual({
      kind: 'RANGE_UNSUPPORTED',
      byteLength: PDF_BYTES.byteLength,
    });
    expect(testTarget.sourceStore.readSelection).not.toHaveBeenCalled();
  });

  it('keeps non-PDF and oversized sources explicitly unavailable', async () => {
    const nonPdfTarget: TestTarget = target();
    nonPdfTarget.resolver.resolve.mockResolvedValue({
      ...resolvedSource(nonPdfTarget.projection),
      version: {
        ...resolvedSource(nonPdfTarget.projection).version,
        mediaType: 'text/plain',
      },
    });
    await expect(
      nonPdfTarget.service.issue(nonPdfTarget.projection, ACTOR),
    ).resolves.toEqual({
      status: 'UNAVAILABLE',
      reason: 'PDF_PREVIEW_SOURCE_NOT_PDF',
      retryable: false,
    });

    const oversizedTarget: TestTarget = target();
    oversizedTarget.projection.source.sourceByteLength = 26 * 1024 * 1024;
    await expect(
      oversizedTarget.service.issue(oversizedTarget.projection, ACTOR),
    ).resolves.toEqual({
      status: 'UNAVAILABLE',
      reason: 'PDF_PREVIEW_SOURCE_TOO_LARGE',
      retryable: false,
    });
  });

  it('distinguishes exact source identity failures from retryable service failures', async () => {
    const identityTarget: TestTarget = target();
    identityTarget.resolver.resolve.mockRejectedValue(
      new Error('DOCUMENT_VERSION_NOT_CURRENT'),
    );
    await expect(
      identityTarget.service.issue(identityTarget.projection, ACTOR),
    ).resolves.toEqual({
      status: 'UNAVAILABLE',
      reason: 'PDF_PREVIEW_SOURCE_IDENTITY_INVALID',
      retryable: false,
    });

    const serviceTarget: TestTarget = target();
    serviceTarget.resolver.resolve.mockRejectedValue(
      new Error('FILESERVICE_TEMPORARY_FAILURE'),
    );
    await expect(
      serviceTarget.service.issue(serviceTarget.projection, ACTOR),
    ).resolves.toEqual({
      status: 'UNAVAILABLE',
      reason: 'PDF_PREVIEW_SERVICE_UNAVAILABLE',
      retryable: true,
    });
  });
});
