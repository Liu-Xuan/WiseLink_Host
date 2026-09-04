import 'reflect-metadata';

jest.mock(
  '../../server/modules/unified-reader/unified-reader.controller',
  () => ({ UnifiedReaderController: class UnifiedReaderController {} }),
);

import type { Provider } from '@nestjs/common';

import type {
  UnifiedAcceptanceCandidateReceipt,
  UnifiedAcceptanceCorrelation,
} from '@shared/api.interface';

import { createImmutableAcceptanceReceiptOwnerProvider } from '../../server/modules/unified-reader/public-api';
import {
  MiaodaImmutableAcceptanceReceiptOwnerAdapter,
  prepareMiaodaImmutableAcceptanceReceiptOwner,
} from '../../server/modules/unified-reader/miaoda-immutable-acceptance-receipt-owner.adapter';
import { IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER } from '../../server/modules/unified-reader/unified-reader.constants';
import type { UnifiedHostActivationExactBinding } from '../../server/modules/unified-reader/unified-reader.types';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

const binding: UnifiedHostActivationExactBinding = {
  canonicalMiaodaHostId: 'app_host_local_test',
  tenantId: 'tenant-local-test',
  environment: 'local-test',
  roleResolutionRevision: 'role-resolution-local-1',
  roleResolutionFingerprint:
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  canonicalArtifactStoreId: 'artifact-store-local-test',
  soleRegistrarServicePrincipal: 'registrar-service-local-test',
  immutableReceiptOwnerId: 'receipt-owner-local-test',
  immutableReceiptOwnerAdapterRevision: 'receipt-owner-fileservice-local-1',
  immutableReceiptStoreId: 'receipt-store-local-test',
};

const bucketId = 'bucket-receipts-local-test';

describe('MiaodaImmutableAcceptanceReceiptOwnerAdapter', () => {
  it('uploads once with upsert=false, then reads metadata and exact bytes', async () => {
    const bytes: Uint8Array = receiptBytes();
    const fixture = fileServiceFixture();
    const adapter = new MiaodaImmutableAcceptanceReceiptOwnerAdapter(
      fixture.fileService,
      { activationBinding: binding, bucketId },
    );

    const result = await adapter.persistAndReadback(ownerInput(bytes));
    const digest: string = sha256Raw(bytes);
    const expectedPath = `immutable-acceptance-receipts/sha256/${digest}.json`;

    expect(result).toEqual({
      artifact: {
        storeRole: 'ImmutableAcceptanceReceiptStoreCandidate',
        ref:
          'artifact://ImmutableAcceptanceReceiptStoreCandidate/' +
          `immutable-acceptance-receipts/sha256/${digest}`,
        sha256: digest,
        byteLength: bytes.byteLength,
        mediaType: 'application/json',
      },
      bytes,
      reused: false,
    });
    expect(fixture.bucket.upload).toHaveBeenCalledWith(bytes, {
      filePath: expectedPath,
      fileName: `${digest}.json`,
      contentType: 'application/json',
      upsert: false,
    });
    expect(fixture.bucket.getFileMetadata).toHaveBeenCalledTimes(2);
    expect(fixture.bucket.download).toHaveBeenCalledWith(expectedPath);
    expect(adapter.activationBinding).toEqual(binding);
  });

  it('reuses same bytes without upload and verifies an exact download', async () => {
    const bytes: Uint8Array = receiptBytes();
    const fixture = fileServiceFixture({ initialBytes: bytes });
    const adapter = new MiaodaImmutableAcceptanceReceiptOwnerAdapter(
      fixture.fileService,
      { activationBinding: binding, bucketId },
    );

    await expect(
      adapter.persistAndReadback(ownerInput(bytes)),
    ).resolves.toMatchObject({ bytes, reused: true });
    expect(fixture.bucket.upload).not.toHaveBeenCalled();
    expect(fixture.bucket.getFileMetadata).toHaveBeenCalledTimes(2);
    expect(fixture.bucket.download).toHaveBeenCalledTimes(1);
  });

  it('rejects same content path containing different actual bytes', async () => {
    const bytes: Uint8Array = receiptBytes();
    const wrongBytes: Uint8Array = Uint8Array.from(bytes);
    wrongBytes[0] = wrongBytes[0] === 123 ? 91 : 123;
    const fixture = fileServiceFixture({
      initialBytes: bytes,
      downloadBytes: wrongBytes,
    });
    const adapter = new MiaodaImmutableAcceptanceReceiptOwnerAdapter(
      fixture.fileService,
      { activationBinding: binding, bucketId },
    );

    await expect(adapter.persistAndReadback(ownerInput(bytes))).rejects.toThrow(
      'IMMUTABLE_RECEIPT_ACTUAL_BYTE_MISMATCH',
    );
    expect(fixture.bucket.upload).not.toHaveBeenCalled();
  });

  it.each([
    ['path', 'IMMUTABLE_RECEIPT_LOCATOR_DRIFT'],
    ['length', 'IMMUTABLE_RECEIPT_BYTE_LENGTH_DRIFT'],
    ['mime', 'IMMUTABLE_RECEIPT_MEDIA_TYPE_DRIFT'],
  ])('rejects metadata %s drift', async (drift, code) => {
    const bytes: Uint8Array = receiptBytes();
    const fixture = fileServiceFixture({ initialBytes: bytes, drift });
    const adapter = new MiaodaImmutableAcceptanceReceiptOwnerAdapter(
      fixture.fileService,
      { activationBinding: binding, bucketId },
    );

    await expect(adapter.persistAndReadback(ownerInput(bytes))).rejects.toThrow(
      code,
    );
    expect(fixture.bucket.upload).not.toHaveBeenCalled();
  });

  it('keeps provider timestamp audit-only', async () => {
    const bytes: Uint8Array = receiptBytes();
    const fixture = fileServiceFixture({
      initialBytes: bytes,
      metadataUpdatedAt: '2026-08-14T10:00:00.000Z',
      downloadUpdatedAt: '2026-08-14T10:01:00.000Z',
    });
    const adapter = new MiaodaImmutableAcceptanceReceiptOwnerAdapter(
      fixture.fileService,
      { activationBinding: binding, bucketId },
    );

    await expect(
      adapter.persistAndReadback(ownerInput(bytes)),
    ).resolves.toMatchObject({ reused: true, bytes });
  });

  it('fails closed before FileService I/O when exact identity is not configured', () => {
    const fixture = fileServiceFixture();
    const result = prepareMiaodaImmutableAcceptanceReceiptOwner({
      fileService: fixture.fileService,
      environment: {},
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.owner).toBeNull();
    expect(result.blockerCodes).toEqual(
      expect.arrayContaining([
        'IMMUTABLE_RECEIPT_OWNER_CONFIG_MISSING:canonicalMiaodaHostId',
        'IMMUTABLE_RECEIPT_OWNER_CONFIG_MISSING:immutableReceiptOwnerId',
        'IMMUTABLE_RECEIPT_OWNER_CONFIG_MISSING:bucketId',
      ]),
    );
    expect(fixture.fileService.from).not.toHaveBeenCalled();
    expect(fixture.bucket.getFileMetadata).not.toHaveBeenCalled();
    expect(fixture.bucket.upload).not.toHaveBeenCalled();
    expect(fixture.bucket.download).not.toHaveBeenCalled();
  });

  it('forbids the receipt owner from aliasing CanonicalHubRegistrar', () => {
    const fixture = fileServiceFixture();

    expect(
      () =>
        new MiaodaImmutableAcceptanceReceiptOwnerAdapter(fixture.fileService, {
          activationBinding: {
            ...binding,
            immutableReceiptOwnerId: 'CanonicalHubRegistrar',
          },
          bucketId,
        }),
    ).toThrow('IMMUTABLE_RECEIPT_OWNER_REGISTRAR_ALIAS_FORBIDDEN');
    expect(fixture.fileService.from).not.toHaveBeenCalled();
  });

  it('uses the existing Unified DI provider wrapper without changing authority', () => {
    const fixture = fileServiceFixture();
    const owner = new MiaodaImmutableAcceptanceReceiptOwnerAdapter(
      fixture.fileService,
      { activationBinding: binding, bucketId },
    );

    const provider: Provider =
      createImmutableAcceptanceReceiptOwnerProvider(owner);

    expect(provider).toEqual({
      provide: IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER,
      useValue: owner,
    });
    expect(fixture.fileService.from).not.toHaveBeenCalled();
  });
});

function ownerInput(bytes: Uint8Array): {
  bytes: Uint8Array;
  correlation: UnifiedAcceptanceCorrelation;
  candidateReceipt: UnifiedAcceptanceCandidateReceipt;
} {
  const correlation: UnifiedAcceptanceCorrelation = {
    workItemId: 'WI-RECEIPT-1',
    requestId: 'REQ-RECEIPT-1',
    documentVersionId: 'DV-RECEIPT-1',
    permissionSnapshotVersion: 'permission-1',
    classificationFingerprint: `sha256:${'f'.repeat(64)}`,
  };
  const candidateReceipt: UnifiedAcceptanceCandidateReceipt = {
    schemaVersion: 'wiselink.3_1.unified_acceptance_receipt.v0.candidate.2',
    receiptId: 'unified_acceptance_candidate_local',
    receiptCanonicalSha256:
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    acceptanceFacade: {
      role: 'UnifiedAcceptanceFacadeCandidate',
      registryRevision: 'unified-acceptance-registry.candidate.1',
      implementationRevision: 'unified-acceptance-facade.candidate.2',
    },
    correlation,
    package: {
      packageId: 'urn:techpub:package:v1:sha256:' + 'c'.repeat(64),
      contract: {
        contractId: 'techpub.parsed-package.v1',
        contractRevision: 'frozen.2',
      },
      artifactStoreRole: 'UnifiedArtifactStoreCandidate',
      artifactRef:
        'artifact://UnifiedArtifactStoreCandidate/' +
        'unified-parsed-packages/sha256/' +
        'd'.repeat(64),
      artifactSha256: 'd'.repeat(64),
      artifactByteLength: 10,
      artifactMediaType: 'application/json',
    },
    dispatch: {
      route: 'UNIFIED_FROZEN_2',
      handlerId: 'Frozen2CandidateReaderService',
      handlerRevision: 'frozen.2-bounded.candidate.1',
      fallbackUsed: false,
    },
    validationStatus: 'CANDIDATE_ACCEPTED',
    validatedSummaryHash:
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    sourceBoundUnitCount: 1,
    authority: {
      canonicalReaderActivated: false,
      createsWorkItemState: false,
      createsEngineeringConclusion: false,
      grantsPublication: false,
      selectsCurrent: false,
    },
  };
  return { bytes, correlation, candidateReceipt };
}

function receiptBytes(): Uint8Array {
  return new TextEncoder().encode('{"receipt":"local-test"}\n');
}

interface FileServiceFixtureOptions {
  initialBytes?: Uint8Array;
  downloadBytes?: Uint8Array;
  drift?: string;
  metadataUpdatedAt?: string;
  downloadUpdatedAt?: string;
}

function fileServiceFixture(options: FileServiceFixtureOptions = {}) {
  let storedBytes: Uint8Array | null = options.initialBytes
    ? Uint8Array.from(options.initialBytes)
    : null;
  let storedPath: string | null = storedBytes
    ? `immutable-acceptance-receipts/sha256/${sha256Raw(storedBytes)}.json`
    : null;
  const metadata = (
    filePath: string,
    bytes: Uint8Array,
    updatedAt: string,
  ) => ({
    id: 'provider-receipt-object-1',
    filePath: options.drift === 'path' ? `${filePath}.wrong` : filePath,
    bucketID: bucketId,
    updatedAt,
    metadata: {
      contentLength:
        options.drift === 'length'
          ? String(bytes.byteLength + 1)
          : String(bytes.byteLength),
      mimeType: options.drift === 'mime' ? 'text/plain' : 'application/json',
    },
  });
  const bucket = {
    getFileMetadata: jest.fn(async (filePath: string) => {
      if (storedBytes === null || storedPath !== filePath) return null;
      return metadata(
        filePath,
        storedBytes,
        options.metadataUpdatedAt ?? '2026-08-14T10:00:00.000Z',
      );
    }),
    upload: jest.fn(
      async (
        bytes: Uint8Array,
        uploadOptions: {
          filePath: string;
          fileName: string;
          contentType: string;
          upsert: false;
        },
      ) => {
        storedBytes = Uint8Array.from(bytes);
        storedPath = uploadOptions.filePath;
        return metadata(
          uploadOptions.filePath,
          storedBytes,
          options.metadataUpdatedAt ?? '2026-08-14T10:00:00.000Z',
        );
      },
    ),
    download: jest.fn(async (filePath: string) => {
      if (storedBytes === null || storedPath !== filePath) {
        throw new Error('FIXTURE_FILE_NOT_FOUND');
      }
      const bytes: Uint8Array = options.downloadBytes ?? storedBytes;
      return {
        content: new Blob([Uint8Array.from(bytes)], {
          type: 'application/json',
        }),
        metadata: metadata(
          filePath,
          storedBytes,
          options.downloadUpdatedAt ?? '2026-08-14T10:00:00.000Z',
        ),
      };
    }),
  };
  return {
    bucket,
    fileService: {
      from: jest.fn((requestedBucketId: string) => {
        if (requestedBucketId !== bucketId) {
          throw new Error('FIXTURE_BUCKET_MISMATCH');
        }
        return bucket;
      }),
    },
  };
}
