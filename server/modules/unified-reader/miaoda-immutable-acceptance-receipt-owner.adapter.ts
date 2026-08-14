import type { FileService } from '@lark-apaas/fullstack-nestjs-core';

import type { ImmutableReceiptArtifactDescriptor } from '@shared/api.interface';

import type {
  ImmutableAcceptanceReceiptOwnerPort,
  UnifiedHostActivationExactBinding,
} from './unified-reader.types';
import {
  PREFIXED_SHA256,
  rawHashValue,
  sha256Raw,
} from './unified-reader.utils';

const RECEIPT_STORE_ROLE = 'ImmutableAcceptanceReceiptStoreCandidate';
const RECEIPT_PATH_PREFIX = 'immutable-acceptance-receipts/sha256';
const JSON_MEDIA_TYPE = 'application/json';

export const IMMUTABLE_RECEIPT_OWNER_ENV = {
  canonicalMiaodaHostId: 'WL_RECEIPT_OWNER_CANONICAL_MIAODA_HOST_ID',
  tenantId: 'WL_RECEIPT_OWNER_TENANT_ID',
  environment: 'WL_RECEIPT_OWNER_ENVIRONMENT',
  roleResolutionRevision: 'WL_RECEIPT_OWNER_ROLE_RESOLUTION_REVISION',
  roleResolutionFingerprint: 'WL_RECEIPT_OWNER_ROLE_RESOLUTION_FINGERPRINT',
  canonicalArtifactStoreId: 'WL_RECEIPT_OWNER_CANONICAL_ARTIFACT_STORE_ID',
  soleRegistrarServicePrincipal:
    'WL_RECEIPT_OWNER_SOLE_REGISTRAR_SERVICE_PRINCIPAL',
  immutableReceiptOwnerId: 'WL_RECEIPT_OWNER_ID',
  immutableReceiptOwnerAdapterRevision: 'WL_RECEIPT_OWNER_ADAPTER_REVISION',
  immutableReceiptStoreId: 'WL_RECEIPT_OWNER_STORE_ID',
  bucketId: 'WL_RECEIPT_OWNER_BUCKET_ID',
} as const;

interface ReceiptFileMetadata {
  id: string;
  filePath: string;
  bucketID: string;
  updatedAt?: string;
  metadata?: {
    contentLength: string;
    mimeType: string;
  };
}

interface ReceiptFileDownload {
  content: Blob;
  metadata: ReceiptFileMetadata | null;
}

interface ReceiptBucketFileService {
  getFileMetadata(filePath: string): Promise<ReceiptFileMetadata | null>;
  upload(
    bytes: Uint8Array,
    options: {
      filePath: string;
      fileName: string;
      contentType: typeof JSON_MEDIA_TYPE;
      upsert: false;
    },
  ): Promise<ReceiptFileMetadata>;
  download(filePath: string): PromiseLike<ReceiptFileDownload>;
}

interface ReceiptFileService {
  from(bucketId: string): ReceiptBucketFileService;
}

export interface MiaodaImmutableAcceptanceReceiptOwnerOptions {
  activationBinding: UnifiedHostActivationExactBinding;
  bucketId: string;
}

export interface MiaodaImmutableReceiptOwnerPreparation {
  status: 'CONFIGURED' | 'BLOCKED';
  blockerCodes: string[];
  owner: ImmutableAcceptanceReceiptOwnerPort | null;
}

export class MiaodaImmutableAcceptanceReceiptOwnerAdapter implements ImmutableAcceptanceReceiptOwnerPort {
  readonly activationBinding: UnifiedHostActivationExactBinding;
  private readonly bucketId: string;

  constructor(
    private readonly fileService: ReceiptFileService,
    options: MiaodaImmutableAcceptanceReceiptOwnerOptions,
  ) {
    this.activationBinding = validateActivationBinding(
      options.activationBinding,
    );
    this.bucketId = configuredIdentity(options.bucketId, 'bucketId');
  }

  async persistAndReadback(
    input: Parameters<
      ImmutableAcceptanceReceiptOwnerPort['persistAndReadback']
    >[0],
  ): ReturnType<ImmutableAcceptanceReceiptOwnerPort['persistAndReadback']> {
    if (input.bytes.byteLength < 1) {
      throw new Error('IMMUTABLE_RECEIPT_BYTES_REQUIRED');
    }
    const expectedBytes: Uint8Array = Uint8Array.from(input.bytes);
    const digest: string = sha256Raw(expectedBytes);
    const filePath: string = receiptFilePath(digest);
    const scoped: ReceiptBucketFileService = this.fileService.from(
      this.bucketId,
    );
    const existing: ReceiptFileMetadata | null =
      await scoped.getFileMetadata(filePath);
    let uploadMetadata: ReceiptFileMetadata | null = null;
    let reused = true;

    if (existing === null) {
      uploadMetadata = await scoped.upload(expectedBytes, {
        filePath,
        fileName: `${digest}.json`,
        contentType: JSON_MEDIA_TYPE,
        upsert: false,
      });
      assertMetadata(uploadMetadata, this.bucketId, filePath, expectedBytes);
      reused = false;
    }

    const metadata: ReceiptFileMetadata | null =
      await scoped.getFileMetadata(filePath);
    assertMetadata(metadata, this.bucketId, filePath, expectedBytes);
    if (uploadMetadata !== null && uploadMetadata.id !== metadata.id) {
      throw new Error('IMMUTABLE_RECEIPT_PROVIDER_OBJECT_DRIFT');
    }

    const downloaded: ReceiptFileDownload = await scoped.download(filePath);
    assertMetadata(downloaded.metadata, this.bucketId, filePath, expectedBytes);
    if (downloaded.metadata.id !== metadata.id) {
      throw new Error('IMMUTABLE_RECEIPT_PROVIDER_OBJECT_DRIFT');
    }
    const actualBytes: Uint8Array = new Uint8Array(
      await downloaded.content.arrayBuffer(),
    );
    if (
      actualBytes.byteLength !== expectedBytes.byteLength ||
      sha256Raw(actualBytes) !== digest ||
      !sameBytes(actualBytes, expectedBytes)
    ) {
      throw new Error('IMMUTABLE_RECEIPT_ACTUAL_BYTE_MISMATCH');
    }

    const artifact: ImmutableReceiptArtifactDescriptor = {
      storeRole: RECEIPT_STORE_ROLE,
      ref: receiptArtifactRef(digest),
      sha256: digest,
      byteLength: actualBytes.byteLength,
      mediaType: JSON_MEDIA_TYPE,
    };
    return { artifact, bytes: actualBytes, reused };
  }
}

export function prepareMiaodaImmutableAcceptanceReceiptOwner(input: {
  fileService: ReceiptFileService;
  environment?: Readonly<Record<string, string | undefined>>;
}): MiaodaImmutableReceiptOwnerPreparation {
  const environment: Readonly<Record<string, string | undefined>> =
    input.environment ?? process.env;
  const values = {
    canonicalMiaodaHostId: envValue(
      environment,
      IMMUTABLE_RECEIPT_OWNER_ENV.canonicalMiaodaHostId,
    ),
    tenantId: envValue(environment, IMMUTABLE_RECEIPT_OWNER_ENV.tenantId),
    environment: envValue(environment, IMMUTABLE_RECEIPT_OWNER_ENV.environment),
    roleResolutionRevision: envValue(
      environment,
      IMMUTABLE_RECEIPT_OWNER_ENV.roleResolutionRevision,
    ),
    roleResolutionFingerprint: envValue(
      environment,
      IMMUTABLE_RECEIPT_OWNER_ENV.roleResolutionFingerprint,
    ),
    canonicalArtifactStoreId: envValue(
      environment,
      IMMUTABLE_RECEIPT_OWNER_ENV.canonicalArtifactStoreId,
    ),
    soleRegistrarServicePrincipal: envValue(
      environment,
      IMMUTABLE_RECEIPT_OWNER_ENV.soleRegistrarServicePrincipal,
    ),
    immutableReceiptOwnerId: envValue(
      environment,
      IMMUTABLE_RECEIPT_OWNER_ENV.immutableReceiptOwnerId,
    ),
    immutableReceiptOwnerAdapterRevision: envValue(
      environment,
      IMMUTABLE_RECEIPT_OWNER_ENV.immutableReceiptOwnerAdapterRevision,
    ),
    immutableReceiptStoreId: envValue(
      environment,
      IMMUTABLE_RECEIPT_OWNER_ENV.immutableReceiptStoreId,
    ),
    bucketId: envValue(environment, IMMUTABLE_RECEIPT_OWNER_ENV.bucketId),
  };
  const blockerCodes: string[] = Object.entries(values)
    .filter((entry: [string, string | null]) => entry[1] === null)
    .map(
      (entry: [string, string | null]) =>
        `IMMUTABLE_RECEIPT_OWNER_CONFIG_MISSING:${entry[0]}`,
    );
  if (blockerCodes.length > 0) {
    return { status: 'BLOCKED', blockerCodes, owner: null };
  }

  const owner: ImmutableAcceptanceReceiptOwnerPort =
    new MiaodaImmutableAcceptanceReceiptOwnerAdapter(input.fileService, {
      activationBinding: {
        canonicalMiaodaHostId: configuredValue(
          values.canonicalMiaodaHostId,
          'canonicalMiaodaHostId',
        ),
        tenantId: configuredValue(values.tenantId, 'tenantId'),
        environment: configuredValue(values.environment, 'environment'),
        roleResolutionRevision: configuredValue(
          values.roleResolutionRevision,
          'roleResolutionRevision',
        ),
        roleResolutionFingerprint: configuredValue(
          values.roleResolutionFingerprint,
          'roleResolutionFingerprint',
        ),
        canonicalArtifactStoreId: configuredValue(
          values.canonicalArtifactStoreId,
          'canonicalArtifactStoreId',
        ),
        soleRegistrarServicePrincipal: configuredValue(
          values.soleRegistrarServicePrincipal,
          'soleRegistrarServicePrincipal',
        ),
        immutableReceiptOwnerId: configuredValue(
          values.immutableReceiptOwnerId,
          'immutableReceiptOwnerId',
        ),
        immutableReceiptOwnerAdapterRevision: configuredValue(
          values.immutableReceiptOwnerAdapterRevision,
          'immutableReceiptOwnerAdapterRevision',
        ),
        immutableReceiptStoreId: configuredValue(
          values.immutableReceiptStoreId,
          'immutableReceiptStoreId',
        ),
      },
      bucketId: configuredValue(values.bucketId, 'bucketId'),
    });
  return { status: 'CONFIGURED', blockerCodes: [], owner };
}

/** The hosted FileService structurally satisfies this dedicated bucket view. */
export function createMiaodaImmutableAcceptanceReceiptOwner(
  fileService: FileService,
  options: MiaodaImmutableAcceptanceReceiptOwnerOptions,
): ImmutableAcceptanceReceiptOwnerPort {
  return new MiaodaImmutableAcceptanceReceiptOwnerAdapter(fileService, options);
}

function validateActivationBinding(
  value: UnifiedHostActivationExactBinding,
): UnifiedHostActivationExactBinding {
  const binding: UnifiedHostActivationExactBinding = {
    canonicalMiaodaHostId: configuredIdentity(
      value.canonicalMiaodaHostId,
      'canonicalMiaodaHostId',
    ),
    tenantId: configuredIdentity(value.tenantId, 'tenantId'),
    environment: configuredIdentity(value.environment, 'environment'),
    roleResolutionRevision: configuredIdentity(
      value.roleResolutionRevision,
      'roleResolutionRevision',
    ),
    roleResolutionFingerprint: configuredIdentity(
      value.roleResolutionFingerprint,
      'roleResolutionFingerprint',
    ),
    canonicalArtifactStoreId: configuredIdentity(
      value.canonicalArtifactStoreId,
      'canonicalArtifactStoreId',
    ),
    soleRegistrarServicePrincipal: configuredIdentity(
      value.soleRegistrarServicePrincipal,
      'soleRegistrarServicePrincipal',
    ),
    immutableReceiptOwnerId: configuredIdentity(
      value.immutableReceiptOwnerId,
      'immutableReceiptOwnerId',
    ),
    immutableReceiptOwnerAdapterRevision: configuredIdentity(
      value.immutableReceiptOwnerAdapterRevision,
      'immutableReceiptOwnerAdapterRevision',
    ),
    immutableReceiptStoreId: configuredIdentity(
      value.immutableReceiptStoreId,
      'immutableReceiptStoreId',
    ),
  };
  if (!PREFIXED_SHA256.test(binding.roleResolutionFingerprint)) {
    throw new Error('IMMUTABLE_RECEIPT_OWNER_ROLE_FINGERPRINT_INVALID');
  }
  if (
    binding.immutableReceiptOwnerId.toLowerCase() ===
      'CanonicalHubRegistrar'.toLowerCase() ||
    binding.immutableReceiptOwnerId === binding.soleRegistrarServicePrincipal
  ) {
    throw new Error('IMMUTABLE_RECEIPT_OWNER_REGISTRAR_ALIAS_FORBIDDEN');
  }
  return binding;
}

function assertMetadata(
  metadata: ReceiptFileMetadata | null,
  expectedBucketId: string,
  expectedPath: string,
  expectedBytes: Uint8Array,
): asserts metadata is ReceiptFileMetadata {
  if (metadata === null) {
    throw new Error('IMMUTABLE_RECEIPT_METADATA_MISSING');
  }
  if (
    configuredIdentity(metadata.id, 'metadata.id').length < 1 ||
    metadata.bucketID !== expectedBucketId ||
    canonicalPath(metadata.filePath) !== expectedPath
  ) {
    throw new Error('IMMUTABLE_RECEIPT_LOCATOR_DRIFT');
  }
  const contentLength: number = Number(metadata.metadata?.contentLength);
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength !== expectedBytes.byteLength
  ) {
    throw new Error('IMMUTABLE_RECEIPT_BYTE_LENGTH_DRIFT');
  }
  if (metadata.metadata?.mimeType !== JSON_MEDIA_TYPE) {
    throw new Error('IMMUTABLE_RECEIPT_MEDIA_TYPE_DRIFT');
  }
}

function receiptFilePath(digest: string): string {
  return `${RECEIPT_PATH_PREFIX}/${rawDigest(digest)}.json`;
}

function receiptArtifactRef(digest: string): string {
  return `artifact://${RECEIPT_STORE_ROLE}/${RECEIPT_PATH_PREFIX}/${rawDigest(
    digest,
  )}`;
}

function rawDigest(value: string): string {
  return rawHashValue(value, 'immutableReceipt.sha256');
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value: number, index: number) => value === right[index]);
}

function canonicalPath(value: string): string {
  return configuredIdentity(value, 'metadata.filePath').replace(/^[/]+/u, '');
}

function configuredIdentity(value: string, field: string): string {
  const normalized: string = value.trim();
  if (
    !normalized ||
    normalized === 'UNCONFIGURED' ||
    normalized === 'VERIFICATION_PENDING'
  ) {
    throw new Error(`IMMUTABLE_RECEIPT_OWNER_IDENTITY_UNVERIFIED:${field}`);
  }
  return normalized;
}

function envValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string | null {
  const value: string | undefined = environment[key]?.trim();
  return value || null;
}

function configuredValue(value: string | null, field: string): string {
  if (value === null) {
    throw new Error(`IMMUTABLE_RECEIPT_OWNER_CONFIG_MISSING:${field}`);
  }
  return value;
}
