import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Injectable } from '@nestjs/common';

import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import { UNIFIED_READER } from './unified-reader.constants';
import type {
  ImmutableArtifactPersistResult,
  StagedCandidateArtifactPersistResult,
  UnifiedArtifactStorePort,
  UnifiedCandidateArtifactStagingPort,
} from './unified-reader.types';
import { rawHashValue, sha256Raw } from './unified-reader.utils';

const JSON_MEDIA_TYPE = 'application/json' as const;

/**
 * Ordinary authenticated business storage for parsed packages and failure
 * reports. Authorization happens in the host action before this adapter is
 * invoked; this class only owns immutable FileService bytes and readback.
 */
@Injectable()
export class MiaodaOrdinaryArtifactStoreAdapter
  implements UnifiedArtifactStorePort, UnifiedCandidateArtifactStagingPort
{
  private defaultBucketLookup: Promise<string> | null = null;

  constructor(private readonly fileService: FileService) {}

  async persistAndReadback(
    input: Uint8Array,
  ): Promise<ImmutableArtifactPersistResult> {
    if (input.byteLength < 1) throw new Error('ARTIFACT_BYTES_REQUIRED');
    const bytes = Uint8Array.from(input);
    const digest = sha256Raw(bytes);
    const filePath = this.filePath(digest);
    const bucketId = await this.getDefaultBucket();
    const scoped = this.fileService.from(bucketId);
    const existing = await providerCall(
      'ARTIFACT_STORE_METADATA_READ_FAILED',
      () => getOptionalMetadata(() => scoped.getFileMetadata(filePath)),
    );
    let reused = true;
    if (existing === null) {
      const uploaded = await providerCall('ARTIFACT_STORE_UPLOAD_FAILED', () =>
        scoped.upload(bytes, {
          filePath,
          fileName: `${digest}.json`,
          contentType: JSON_MEDIA_TYPE,
          upsert: false,
        }),
      );
      if (canonicalPath(uploaded.filePath) !== canonicalPath(filePath)) {
        throw new Error('ARTIFACT_UPLOAD_PATH_MISMATCH');
      }
      reused = false;
    }
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: UNIFIED_READER.artifactStoreRole,
      ref: `${this.artifactRefPrefix()}${digest}`,
      sha256: digest,
      byteLength: bytes.byteLength,
      mediaType: JSON_MEDIA_TYPE,
    };
    const actual = await this.readActualBytes(artifact);
    if (!sameBytes(bytes, actual)) {
      throw new Error('ARTIFACT_ACTUAL_BYTE_MISMATCH');
    }
    return { artifact, bytes: actual, reused };
  }

  async stageCandidateAndReadback(input: {
    bytes: Uint8Array;
    ownerRef: string;
  }): Promise<StagedCandidateArtifactPersistResult> {
    if (input.bytes.byteLength < 1) throw new Error('ARTIFACT_BYTES_REQUIRED');
    if (!input.ownerRef.trim())
      throw new Error('ARTIFACT_STAGE_OWNER_REQUIRED');
    const bytes = Uint8Array.from(input.bytes);
    const digest = sha256Raw(bytes);
    const ownerRefHash = sha256Raw(new TextEncoder().encode(input.ownerRef));
    const filePath = this.stagedFilePath(ownerRefHash, digest);
    const bucketId = await this.getDefaultBucket();
    const scoped = this.fileService.from(bucketId);
    const existing = await providerCall(
      'ARTIFACT_STORE_METADATA_READ_FAILED',
      () => getOptionalMetadata(() => scoped.getFileMetadata(filePath)),
    );
    let reused = true;
    if (existing === null) {
      const uploaded = await providerCall(
        'ARTIFACT_STORE_STAGE_UPLOAD_FAILED',
        () =>
          scoped.upload(bytes, {
            filePath,
            fileName: `${digest}.json`,
            contentType: JSON_MEDIA_TYPE,
            upsert: false,
          }),
      );
      if (canonicalPath(uploaded.filePath) !== canonicalPath(filePath)) {
        throw new Error('ARTIFACT_STAGE_UPLOAD_PATH_MISMATCH');
      }
      reused = false;
    }
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: UNIFIED_READER.artifactStoreRole,
      ref: `${this.artifactRefPrefix()}_staging/applicability-attempt/${ownerRefHash}/${digest}`,
      sha256: digest,
      byteLength: bytes.byteLength,
      mediaType: JSON_MEDIA_TYPE,
    };
    const actual = await this.readActualBytes(artifact);
    if (!sameBytes(bytes, actual)) {
      throw new Error('ARTIFACT_ACTUAL_BYTE_MISMATCH');
    }
    return {
      schemaVersion: 'wiselink.3_1.staged_candidate_artifact.v1',
      ownerRefHash,
      artifact,
      bytes: actual,
      reused,
    };
  }

  async finalizeStagedCandidate(
    staged: StagedCandidateArtifactPersistResult,
  ): Promise<ImmutableArtifactPersistResult> {
    this.assertStagedDescriptor(staged);
    const bytes = await this.readActualBytes(staged.artifact);
    if (!sameBytes(staged.bytes, bytes)) {
      throw new Error('ARTIFACT_STAGE_FINALIZE_READBACK_MISMATCH');
    }
    // The WorkItem CAS is the publication boundary. FileService has no rename;
    // finalization is therefore an exact post-CAS durability/readback check.
    return { artifact: staged.artifact, bytes, reused: staged.reused };
  }

  async discardStagedCandidate(
    staged: StagedCandidateArtifactPersistResult,
  ): Promise<void> {
    this.assertStagedDescriptor(staged);
    const filePath = this.descriptorFilePath(staged.artifact);
    const bucketId = await this.getDefaultBucket();
    const scoped = this.fileService.from(bucketId);
    await providerCall('ARTIFACT_STORE_STAGE_DISCARD_FAILED', () =>
      scoped.remove([filePath]),
    );
    const remaining = await providerCall(
      'ARTIFACT_STORE_STAGE_DISCARD_VERIFY_FAILED',
      () => getOptionalMetadata(() => scoped.getFileMetadata(filePath)),
    );
    if (remaining !== null) {
      throw new Error('ARTIFACT_STAGE_DISCARD_NOT_ABSENT');
    }
  }

  async readActualBytes(
    artifact: UnifiedPackageArtifactDescriptor,
  ): Promise<Uint8Array> {
    const filePath = this.descriptorFilePath(artifact);
    const bucketId = await this.getDefaultBucket();
    const scoped = this.fileService.from(bucketId);
    const metadata = await providerCallWithTransportRetry(
      'ARTIFACT_STORE_METADATA_READ_FAILED',
      () => scoped.getFileMetadata(filePath),
    );
    if (
      metadata === null ||
      metadata.bucketID !== bucketId ||
      canonicalPath(metadata.filePath) !== canonicalPath(filePath) ||
      Number(metadata.metadata?.contentLength) !== artifact.byteLength ||
      metadata.metadata?.mimeType !== artifact.mediaType
    ) {
      throw new Error('ARTIFACT_READBACK_MISMATCH:METADATA');
    }
    const downloaded = await providerCallWithTransportRetry(
      'ARTIFACT_STORE_DOWNLOAD_FAILED',
      () => scoped.download(filePath),
    );
    const actual = await providerCall(
      'ARTIFACT_STORE_DOWNLOAD_BODY_READ_FAILED',
      () => bodyBytes(downloaded.content),
    );
    if (
      downloaded.metadata === null ||
      downloaded.metadata.id !== metadata.id ||
      actual.byteLength !== artifact.byteLength ||
      sha256Raw(actual) !== artifact.sha256
    ) {
      throw new Error('ARTIFACT_READBACK_MISMATCH:BYTES');
    }
    return actual;
  }

  /**
   * The SDK caches a successful bucket lookup, but does not deduplicate
   * concurrent misses. Build-packet reads can arrive together, so share only
   * the in-flight read. A rejected lookup is cleared and is never retried by
   * this adapter; a later business action may make its own explicit attempt.
   */
  private getDefaultBucket(): Promise<string> {
    if (this.defaultBucketLookup) return this.defaultBucketLookup;
    const lookup = providerCall(
      'ARTIFACT_STORE_DEFAULT_BUCKET_READ_FAILED',
      () => this.fileService.getDefaultBucket(),
    );
    this.defaultBucketLookup = lookup;
    void lookup.then(
      () => {
        if (this.defaultBucketLookup === lookup) {
          this.defaultBucketLookup = null;
        }
      },
      () => {
        if (this.defaultBucketLookup === lookup) {
          this.defaultBucketLookup = null;
        }
      },
    );
    return lookup;
  }

  private filePath(digest: string): string {
    return `${UNIFIED_READER.artifactDirectory}/${rawHashValue(
      digest,
      'artifact.sha256',
    )}.json`;
  }

  private stagedFilePath(ownerRefHash: string, digest: string): string {
    return `${UNIFIED_READER.artifactDirectory}/_staging/applicability-attempt/${rawHashValue(
      ownerRefHash,
      'staged.ownerRefHash',
    )}/${rawHashValue(digest, 'artifact.sha256')}.json`;
  }

  private descriptorFilePath(
    artifact: UnifiedPackageArtifactDescriptor,
  ): string {
    assertDescriptorBasics(artifact);
    const prefix = this.artifactRefPrefix();
    if (!artifact.ref.startsWith(prefix)) {
      throw new Error('ARTIFACT_READBACK_MISMATCH:DESCRIPTOR');
    }
    const suffix = artifact.ref.slice(prefix.length);
    if (suffix === artifact.sha256) return this.filePath(artifact.sha256);
    const staged =
      /^_staging\/applicability-attempt\/([0-9a-f]{64})\/([0-9a-f]{64})$/u.exec(
        suffix,
      );
    if (!staged || staged[2] !== artifact.sha256) {
      throw new Error('ARTIFACT_READBACK_MISMATCH:DESCRIPTOR');
    }
    return this.stagedFilePath(staged[1]!, staged[2]!);
  }

  private assertStagedDescriptor(
    staged: StagedCandidateArtifactPersistResult,
  ): void {
    if (
      staged.schemaVersion !== 'wiselink.3_1.staged_candidate_artifact.v1' ||
      staged.bytes.byteLength !== staged.artifact.byteLength ||
      sha256Raw(staged.bytes) !== staged.artifact.sha256 ||
      !staged.artifact.ref.includes(
        `/_staging/applicability-attempt/${rawHashValue(
          staged.ownerRefHash,
          'staged.ownerRefHash',
        )}/`,
      )
    ) {
      throw new Error('ARTIFACT_STAGE_DESCRIPTOR_INVALID');
    }
    this.descriptorFilePath(staged.artifact);
  }

  private artifactRefPrefix(): string {
    return `artifact://${UNIFIED_READER.artifactStoreRole}/${UNIFIED_READER.artifactDirectory}/`;
  }
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return Uint8Array.from(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (
    body &&
    typeof body === 'object' &&
    'arrayBuffer' in body &&
    typeof body.arrayBuffer === 'function'
  ) {
    return new Uint8Array(await body.arrayBuffer());
  }
  if (
    body &&
    typeof body === 'object' &&
    'getReader' in body &&
    typeof body.getReader === 'function'
  ) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = Uint8Array.from(result.value as Uint8Array);
        chunks.push(chunk);
        byteLength += chunk.byteLength;
      }
    } finally {
      reader.releaseLock?.();
    }
    const output = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
  throw new Error('ARTIFACT_READBACK_MISMATCH:BODY');
}

function assertDescriptorBasics(
  artifact: UnifiedPackageArtifactDescriptor,
): void {
  if (
    artifact.storeRole !== UNIFIED_READER.artifactStoreRole ||
    artifact.mediaType !== JSON_MEDIA_TYPE ||
    !Number.isSafeInteger(artifact.byteLength) ||
    artifact.byteLength < 1
  ) {
    throw new Error('ARTIFACT_READBACK_MISMATCH:DESCRIPTOR');
  }
  rawHashValue(artifact.sha256, 'artifact.sha256');
}

function canonicalPath(value: string): string {
  return value.replace(/^\/+/, '');
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

async function providerCall<T>(
  code: string,
  operation: () => T | PromiseLike<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    throw providerError(code, cause);
  }
}

/**
 * A FileService request can fail before receiving an HTTP response when the
 * hosted transport briefly loses its connection. Retry that request once;
 * status-bearing provider errors and all semantic readback checks stay
 * fail-closed and are never retried.
 */
async function providerCallWithTransportRetry<T>(
  code: string,
  operation: () => T | PromiseLike<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (firstCause) {
    if (!isTransportFailure(firstCause)) {
      throw providerError(code, firstCause);
    }
    try {
      return await operation();
    } catch (secondCause) {
      throw providerError(code, secondCause);
    }
  }
}

function providerError(code: string, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(`${code}:${message}`);
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

function isTransportFailure(cause: unknown): boolean {
  return !hasHttpStatus(cause) && hasTransportSignature(cause);
}

function hasHttpStatus(cause: unknown, seen = new Set<unknown>()): boolean {
  if (!cause || (typeof cause !== 'object' && typeof cause !== 'function')) {
    return false;
  }
  if (seen.has(cause)) return false;
  seen.add(cause);

  const value = cause as {
    message?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    cause?: unknown;
  };
  const statusValues = [value.status, value.statusCode, value.response?.status];
  if (statusValues.some((status) => status !== undefined && status !== null)) {
    return true;
  }
  return hasHttpStatus(value.cause, seen);
}

function hasTransportSignature(
  cause: unknown,
  seen = new Set<unknown>(),
): boolean {
  if (!cause || (typeof cause !== 'object' && typeof cause !== 'function')) {
    return false;
  }
  if (seen.has(cause)) return false;
  seen.add(cause);

  const value = cause as {
    message?: unknown;
    code?: unknown;
    cause?: unknown;
  };

  const message = String(value.message ?? '')
    .trim()
    .toLowerCase();
  const code = String(value.code ?? '')
    .trim()
    .toUpperCase();
  if (
    message === 'fetch failed' ||
    [
      'ECONNRESET',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENETUNREACH',
      'ECONNREFUSED',
      'UND_ERR_SOCKET',
      'UND_ERR_CONNECT_TIMEOUT',
    ].includes(code)
  ) {
    return true;
  }
  return hasTransportSignature(value.cause, seen);
}

/**
 * FileService implementations normally return null for an absent object, but
 * the hosted provider may surface the same condition as an HTTP 404/error
 * code. Only the pre-upload existence probe may normalize that response;
 * readback remains strict and still treats every provider error as fatal.
 */
async function getOptionalMetadata<T>(
  operation: () => T | PromiseLike<T>,
): Promise<T | null> {
  try {
    return await operation();
  } catch (cause) {
    if (isFileNotFoundError(cause)) return null;
    throw cause;
  }
}

function isFileNotFoundError(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  const value = cause as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
    response?: { status?: unknown; data?: { code?: unknown } };
    cause?: unknown;
  };
  const statuses = [value.status, value.statusCode, value.response?.status];
  if (statuses.some((status) => Number(status) === 404)) return true;

  const codes = [value.code, value.response?.data?.code]
    .map((code) =>
      String(code ?? '')
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  if (
    codes.some((code) => code === 'NOT_FOUND' || code.endsWith('_NOT_FOUND'))
  ) {
    return true;
  }

  const message = String(value.message ?? '').toLowerCase();
  if (/\b404\b/.test(message) && /not found|does not exist/.test(message)) {
    return true;
  }
  if (/(file|object|path|resource).*(not found|does not exist)/.test(message)) {
    return true;
  }
  return value.cause ? isFileNotFoundError(value.cause) : false;
}
