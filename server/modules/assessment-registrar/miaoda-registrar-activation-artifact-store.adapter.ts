import { createHash } from 'node:crypto';

import type { FileService } from '@lark-apaas/fullstack-nestjs-core';

import type {
  RegistrarActivationArtifactStorePort,
  RegistrarArtifactReadback,
} from './work-item-registrar-activation';

interface RegistrarFileMetadata {
  id: string;
  filePath: string;
  bucketID: string;
  metadata: {
    contentLength: string;
    mimeType: string;
  };
}

interface RegistrarFileDownload {
  content: Blob;
  metadata: RegistrarFileMetadata | null;
}

interface RegistrarReadonlyBucket {
  getFileMetadata(filePath: string): Promise<RegistrarFileMetadata | null>;
  download(filePath: string): PromiseLike<RegistrarFileDownload>;
}

interface RegistrarReadonlyFileService {
  from(bucketId: string): RegistrarReadonlyBucket;
}

export interface MiaodaRegistrarActivationArtifactStoreOptions {
  storeId: string;
  bucketId: string;
  adapterRevision: string;
  artifactRefPrefix: string;
  filePathPrefix?: string;
}

/**
 * Read-only adapter for Registrar activation artifacts.
 *
 * This is intentionally separate from Unified's package-descriptor adapter:
 * Registrar supplies an exact artifact ref and requires the configured
 * store/bucket/adapter identity in its readback.  No upload, delete, signing or
 * authorization operation is available here.
 */
export class MiaodaRegistrarActivationArtifactStoreAdapter
  implements RegistrarActivationArtifactStorePort
{
  private readonly storeId: string;
  private readonly bucketId: string;
  private readonly adapterRevision: string;
  private readonly artifactRefPrefix: string;
  private readonly filePathPrefix: string;

  constructor(
    private readonly fileService: RegistrarReadonlyFileService,
    options: MiaodaRegistrarActivationArtifactStoreOptions,
  ) {
    this.storeId = requiredText(options.storeId, 'storeId');
    this.bucketId = requiredText(options.bucketId, 'bucketId');
    this.adapterRevision = requiredText(
      options.adapterRevision,
      'adapterRevision',
    );
    this.artifactRefPrefix = artifactPrefix(options.artifactRefPrefix);
    this.filePathPrefix = pathPrefix(options.filePathPrefix ?? '');
  }

  async readActualBytes(artifactRef: string): Promise<RegistrarArtifactReadback> {
    const filePath = this.filePath(artifactRef);
    const scoped = this.fileService.from(this.bucketId);
    const metadata = await scoped.getFileMetadata(filePath);
    assertFileMetadata(metadata, this.bucketId, filePath);

    const downloaded = await scoped.download(filePath);
    assertFileMetadata(downloaded.metadata, this.bucketId, filePath);
    if (downloaded.metadata.id !== metadata.id) {
      throw new Error('REGISTRAR_ARTIFACT_OBJECT_ID_DRIFT');
    }

    const bytes = new Uint8Array(await downloaded.content.arrayBuffer());
    const byteLength = Number(downloaded.metadata.metadata.contentLength);
    const mediaType = requiredText(
      downloaded.metadata.metadata.mimeType,
      'download.metadata.mimeType',
    );
    if (!Number.isSafeInteger(byteLength) || byteLength !== bytes.byteLength) {
      throw new Error('REGISTRAR_ARTIFACT_BYTE_LENGTH_MISMATCH');
    }
    if (mediaType !== 'application/json') {
      throw new Error('REGISTRAR_ARTIFACT_MEDIA_TYPE_MISMATCH');
    }

    return {
      artifactRef,
      artifactSha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
      mediaType,
      storeId: this.storeId,
      bucketId: this.bucketId,
      adapterRevision: this.adapterRevision,
      bytes,
    };
  }

  private filePath(artifactRef: string): string {
    const normalizedRef = requiredText(artifactRef, 'artifactRef');
    if (!normalizedRef.startsWith(this.artifactRefPrefix)) {
      throw new Error('REGISTRAR_ARTIFACT_REF_NOT_IN_CONFIGURED_STORE');
    }
    const suffix = normalizedRef.slice(this.artifactRefPrefix.length);
    if (
      !suffix ||
      suffix.startsWith('/') ||
      suffix.includes('\\') ||
      suffix.includes('?') ||
      suffix.includes('#') ||
      suffix.split('/').some((segment) => !segment || segment === '..')
    ) {
      throw new Error('REGISTRAR_ARTIFACT_REF_INVALID');
    }
    return `${this.filePathPrefix}${suffix}`;
  }
}

/** The official hosted FileService structurally satisfies this read-only view. */
export function createMiaodaRegistrarActivationArtifactStore(
  fileService: FileService,
  options: MiaodaRegistrarActivationArtifactStoreOptions,
): RegistrarActivationArtifactStorePort {
  return new MiaodaRegistrarActivationArtifactStoreAdapter(
    fileService,
    options,
  );
}

function assertFileMetadata(
  metadata: RegistrarFileMetadata | null,
  expectedBucketId: string,
  expectedFilePath: string,
): asserts metadata is RegistrarFileMetadata {
  if (!metadata) {
    throw new Error('REGISTRAR_ARTIFACT_NOT_FOUND');
  }
  const actualFilePath = canonicalProviderPath(metadata.filePath);
  if (
    requiredText(metadata.bucketID, 'metadata.bucketID') !== expectedBucketId ||
    actualFilePath !== canonicalProviderPath(expectedFilePath)
  ) {
    throw new Error('REGISTRAR_ARTIFACT_LOCATOR_DRIFT');
  }
  requiredText(metadata.id, 'metadata.id');
}

function artifactPrefix(value: string): string {
  const normalized = requiredText(value, 'artifactRefPrefix');
  if (!normalized.endsWith('/')) {
    throw new Error('REGISTRAR_ARTIFACT_REF_PREFIX_INVALID');
  }
  return normalized;
}

function pathPrefix(value: string): string {
  const normalized = canonicalProviderPath(value).replace(/\/+$/, '');
  if (!normalized) return '';
  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new Error('REGISTRAR_ARTIFACT_FILE_PATH_PREFIX_INVALID');
  }
  return `${normalized}/`;
}

function canonicalProviderPath(value: string): string {
  return value.trim().replace(/^\/+/, '');
}

function requiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`REGISTRAR_ARTIFACT_CONFIGURATION_INVALID:${fieldName}`);
  }
  return normalized;
}
