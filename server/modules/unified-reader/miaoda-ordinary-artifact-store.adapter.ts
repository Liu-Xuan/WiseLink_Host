import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Inject, Injectable } from '@nestjs/common';

import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import { UNIFIED_READER } from './unified-reader.constants';
import type {
  CandidateArtifactPersistResult,
  FinalizedCandidateArtifactPersistResult,
  ImmutableArtifactPersistResult,
  StagedCandidateArtifactPersistResult,
  StagedResultEnvelopePart,
  UnifiedArtifactStorePort,
  UnifiedCandidateArtifactStagingPort,
  UnifiedResultEnvelopePartStagingPort,
} from './unified-reader.types';
import { rawHashValue, sha256Raw } from './unified-reader.utils';
import { withFileReadTransportRetry } from './file-service-read-transport';
import {
  MiaodaOrdinaryArtifactLocatorRegistry,
  type OrdinaryArtifactLocator,
  type OrdinaryArtifactLocatorRegistryPort,
} from './miaoda-ordinary-artifact-locator.registry';

const JSON_MEDIA_TYPE = 'application/json' as const;
const BINARY_MEDIA_TYPE = 'application/octet-stream' as const;

/**
 * Ordinary authenticated business storage for parsed packages and failure
 * reports. Authorization happens in the host action before this adapter is
 * invoked; this class only owns immutable FileService bytes and readback.
 */
@Injectable()
export class MiaodaOrdinaryArtifactStoreAdapter
  implements
    UnifiedArtifactStorePort,
    UnifiedCandidateArtifactStagingPort,
    UnifiedResultEnvelopePartStagingPort
{
  private defaultBucketLookup: Promise<string> | null = null;

  constructor(
    private readonly fileService: FileService,
    @Inject(MiaodaOrdinaryArtifactLocatorRegistry)
    private readonly locators: OrdinaryArtifactLocatorRegistryPort,
  ) {}

  async persistAndReadback(
    input: Uint8Array,
  ): Promise<ImmutableArtifactPersistResult> {
    if (input.byteLength < 1) throw new Error('ARTIFACT_BYTES_REQUIRED');
    const bytes = Uint8Array.from(input);
    const digest = sha256Raw(bytes);
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: UNIFIED_READER.artifactStoreRole,
      ref: `${this.artifactRefPrefix()}${digest}`,
      sha256: digest,
      byteLength: bytes.byteLength,
      mediaType: JSON_MEDIA_TYPE,
    };
    const reused = await this.ensureRegistered({
      artifactRef: artifact.ref,
      sha256: digest,
      bytes,
      filePath: this.filePath(digest),
      fileName: `${digest}.json`,
      mediaType: JSON_MEDIA_TYPE,
      uploadFailureCode: 'ARTIFACT_STORE_UPLOAD_FAILED',
    });
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
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: UNIFIED_READER.artifactStoreRole,
      ref: `${this.artifactRefPrefix()}applicability-candidate/${ownerRefHash}/${digest}`,
      sha256: digest,
      byteLength: bytes.byteLength,
      mediaType: JSON_MEDIA_TYPE,
    };
    const reused = await this.ensureRegistered({
      artifactRef: artifact.ref,
      sha256: digest,
      bytes,
      filePath: this.candidateFilePath(ownerRefHash, digest),
      fileName: `${digest}.json`,
      mediaType: JSON_MEDIA_TYPE,
      uploadFailureCode: 'ARTIFACT_STORE_STAGE_UPLOAD_FAILED',
    });
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
  ): Promise<FinalizedCandidateArtifactPersistResult> {
    this.assertCandidateDescriptor(staged);
    const bytes = await this.readActualBytes(staged.artifact);
    if (!sameBytes(staged.bytes, bytes)) {
      throw new Error('ARTIFACT_STAGE_FINALIZE_READBACK_MISMATCH');
    }
    return {
      schemaVersion: 'wiselink.3_1.finalized_candidate_artifact.v1',
      ownerRefHash: staged.ownerRefHash,
      artifact: staged.artifact,
      bytes,
      reused: staged.reused,
    };
  }

  async discardCandidateArtifact(
    candidate: CandidateArtifactPersistResult,
  ): Promise<void> {
    this.assertCandidateDescriptor(candidate);
    const { filePath, bucketId, providerObjectId } = await this.resolveLocator(
      candidate.artifact.ref,
      this.descriptorFilePath(candidate.artifact),
      candidate.artifact,
    );
    const scoped = this.fileService.from(bucketId);
    const metadata = await scoped.getFileMetadata(filePath);
    if (
      metadata === null ||
      (providerObjectId && metadata.id !== providerObjectId)
    ) {
      throw new Error('ARTIFACT_STAGE_DISCARD_IDENTITY_MISMATCH');
    }
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

  async stageResultEnvelopePartAndReadback(input: {
    bytes: Uint8Array;
    ownerRef: string;
    partIndex: number;
  }): Promise<StagedResultEnvelopePart> {
    assertResultEnvelopePartInput(input);
    const bytes = Uint8Array.from(input.bytes);
    const ownerRefHash = sha256Raw(new TextEncoder().encode(input.ownerRef));
    const part: Omit<StagedResultEnvelopePart, 'reused'> = {
      schemaVersion: 'wiselink.3_1.staged_result_envelope_part.v1',
      ownerRefHash,
      partIndex: input.partIndex,
      sha256: sha256Raw(bytes),
      byteLength: bytes.byteLength,
    };
    const reused = await this.ensureRegistered({
      artifactRef: this.resultEnvelopePartRef(ownerRefHash, input.partIndex),
      sha256: part.sha256,
      bytes,
      filePath: this.resultEnvelopePartFilePath(ownerRefHash, input.partIndex),
      fileName: `part-${input.partIndex}.bin`,
      mediaType: BINARY_MEDIA_TYPE,
      uploadFailureCode: 'RESULT_ENVELOPE_PART_UPLOAD_FAILED',
    });
    const actual = await this.readStagedResultEnvelopePart({
      ownerRef: input.ownerRef,
      part,
    });
    if (!sameBytes(bytes, actual)) {
      throw new Error('RESULT_ENVELOPE_PART_REPLAY_MISMATCH');
    }
    return { ...part, reused };
  }

  async readStagedResultEnvelopePart(input: {
    ownerRef: string;
    part: Omit<StagedResultEnvelopePart, 'reused'>;
  }): Promise<Uint8Array> {
    assertResultEnvelopePartDescriptor(input.ownerRef, input.part);
    const { filePath, bucketId, providerObjectId } = await this.resolveLocator(
      this.resultEnvelopePartRef(input.part.ownerRefHash, input.part.partIndex),
      this.resultEnvelopePartFilePath(
        input.part.ownerRefHash,
        input.part.partIndex,
      ),
      { ...input.part, mediaType: BINARY_MEDIA_TYPE },
    );
    const scoped = this.fileService.from(bucketId);
    const metadata = await providerCallWithTransportRetry(
      'RESULT_ENVELOPE_PART_METADATA_READ_FAILED',
      () => scoped.getFileMetadata(filePath),
    );
    if (
      metadata === null ||
      (providerObjectId !== undefined && metadata.id !== providerObjectId) ||
      metadata.bucketID !== bucketId ||
      canonicalPath(metadata.filePath) !== canonicalPath(filePath) ||
      Number(metadata.metadata?.contentLength) !== input.part.byteLength ||
      metadata.metadata?.mimeType !== BINARY_MEDIA_TYPE
    ) {
      throw new Error('RESULT_ENVELOPE_PART_READBACK_MISMATCH:METADATA');
    }
    const downloaded = await providerCallWithTransportRetry(
      'RESULT_ENVELOPE_PART_DOWNLOAD_FAILED',
      () => scoped.download(filePath),
    );
    const actual = await providerCall(
      'RESULT_ENVELOPE_PART_BODY_READ_FAILED',
      () => bodyBytes(downloaded.content),
    );
    if (
      downloaded.metadata === null ||
      downloaded.metadata.id !== metadata.id ||
      actual.byteLength !== input.part.byteLength ||
      sha256Raw(actual) !== input.part.sha256
    ) {
      throw new Error('RESULT_ENVELOPE_PART_READBACK_MISMATCH:BYTES');
    }
    return actual;
  }

  async readActualBytes(
    artifact: UnifiedPackageArtifactDescriptor,
  ): Promise<Uint8Array> {
    const { filePath, bucketId, providerObjectId } = await this.resolveLocator(
      artifact.ref,
      this.descriptorFilePath(artifact),
      artifact,
    );
    const scoped = this.fileService.from(bucketId);
    const metadata = await providerCallWithTransportRetry(
      'ARTIFACT_STORE_METADATA_READ_FAILED',
      () => scoped.getFileMetadata(filePath),
    );
    if (metadata === null) {
      throw new Error(
        'ARTIFACT_READBACK_MISMATCH:METADATA:NOT_FOUND_OR_INACCESSIBLE',
      );
    }
    if (metadata.bucketID !== bucketId) {
      throw new Error('ARTIFACT_READBACK_MISMATCH:METADATA:BUCKET');
    }
    if (providerObjectId !== undefined && metadata.id !== providerObjectId) {
      throw new Error('ARTIFACT_READBACK_MISMATCH:METADATA:OBJECT_ID');
    }
    if (canonicalPath(metadata.filePath) !== canonicalPath(filePath)) {
      throw new Error('ARTIFACT_READBACK_MISMATCH:METADATA:PATH');
    }
    if (Number(metadata.metadata?.contentLength) !== artifact.byteLength) {
      throw new Error('ARTIFACT_READBACK_MISMATCH:METADATA:LENGTH');
    }
    if (metadata.metadata?.mimeType !== artifact.mediaType) {
      throw new Error('ARTIFACT_READBACK_MISMATCH:METADATA:MEDIA_TYPE');
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

  private async ensureRegistered(input: {
    artifactRef: string;
    sha256: string;
    bytes: Uint8Array;
    filePath: string;
    fileName: string;
    mediaType: string;
    uploadFailureCode: string;
  }): Promise<boolean> {
    const registered = await this.locators.find(input.artifactRef);
    if (registered) {
      assertLocatorBinding(registered, {
        ...input,
        byteLength: input.bytes.byteLength,
      });
      // A registered but missing object is a read failure, never permission to
      // upload a replacement or try the application's new default bucket.
      return true;
    }
    const bucketId = await this.getDefaultBucket();
    const scoped = this.fileService.from(bucketId);
    const existing = await providerCallWithTransportRetry(
      'ARTIFACT_STORE_METADATA_READ_FAILED',
      () => getOptionalMetadata(() => scoped.getFileMetadata(input.filePath)),
    );
    const metadata =
      existing ??
      (await providerCall(input.uploadFailureCode, () =>
        scoped.upload(input.bytes, {
          filePath: input.filePath,
          fileName: input.fileName,
          contentType: input.mediaType,
          upsert: false,
        }),
      ));
    if (
      !metadata.id?.trim() ||
      metadata.bucketID !== bucketId ||
      canonicalPath(metadata.filePath) !== canonicalPath(input.filePath) ||
      Number(metadata.metadata?.contentLength) !== input.bytes.byteLength ||
      metadata.metadata?.mimeType !== input.mediaType
    ) {
      throw new Error('ARTIFACT_LOCATOR_PROVIDER_METADATA_MISMATCH');
    }
    await this.locators.record({
      artifactRef: input.artifactRef,
      sha256: input.sha256,
      byteLength: input.bytes.byteLength,
      mediaType: input.mediaType,
      bucketId: metadata.bucketID,
      filePath: canonicalPath(metadata.filePath),
      providerObjectId: metadata.id,
    });
    return existing !== null;
  }

  private async resolveLocator(
    artifactRef: string,
    legacyFilePath: string,
    descriptor: { sha256: string; byteLength: number; mediaType: string },
  ): Promise<{
    bucketId: string;
    filePath: string;
    providerObjectId?: string;
  }> {
    const registered = await this.locators.find(artifactRef);
    if (registered) {
      assertLocatorBinding(registered, descriptor);
      return registered;
    }
    // Explicit compatibility for pre-registry refs only. A DB lookup failure
    // propagates; a registered locator never falls back. No write/backfill or
    // bucket search is performed by a read of a historical artifact.
    return {
      bucketId: await this.getDefaultBucket(),
      filePath: legacyFilePath,
    };
  }

  private resultEnvelopePartRef(
    ownerRefHash: string,
    partIndex: number,
  ): string {
    return `artifact://${UNIFIED_READER.artifactStoreRole}/${this.resultEnvelopePartFilePath(ownerRefHash, partIndex)}`;
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

  private candidateFilePath(ownerRefHash: string, digest: string): string {
    return `${UNIFIED_READER.artifactDirectory}/applicability-candidate/${rawHashValue(
      ownerRefHash,
      'candidate.ownerRefHash',
    )}/${rawHashValue(digest, 'artifact.sha256')}.json`;
  }

  private resultEnvelopePartFilePath(
    ownerRefHash: string,
    partIndex: number,
  ): string {
    return `${UNIFIED_READER.artifactDirectory}/action-attempt-result/${rawHashValue(
      ownerRefHash,
      'resultPart.ownerRefHash',
    )}/part-${String(partIndex).padStart(4, '0')}.bin`;
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
    const candidate =
      /^applicability-candidate\/([0-9a-f]{64})\/([0-9a-f]{64})$/u.exec(suffix);
    if (!candidate || candidate[2] !== artifact.sha256) {
      throw new Error('ARTIFACT_READBACK_MISMATCH:DESCRIPTOR');
    }
    return this.candidateFilePath(candidate[1]!, candidate[2]!);
  }

  private assertCandidateDescriptor(
    candidate: CandidateArtifactPersistResult,
  ): void {
    if (
      ![
        'wiselink.3_1.staged_candidate_artifact.v1',
        'wiselink.3_1.finalized_candidate_artifact.v1',
      ].includes(candidate.schemaVersion) ||
      candidate.bytes.byteLength !== candidate.artifact.byteLength ||
      sha256Raw(candidate.bytes) !== candidate.artifact.sha256 ||
      !candidate.artifact.ref.includes(
        `/applicability-candidate/${rawHashValue(
          candidate.ownerRefHash,
          'candidate.ownerRefHash',
        )}/`,
      )
    ) {
      throw new Error('ARTIFACT_STAGE_DESCRIPTOR_INVALID');
    }
    this.descriptorFilePath(candidate.artifact);
  }

  private artifactRefPrefix(): string {
    return `artifact://${UNIFIED_READER.artifactStoreRole}/${UNIFIED_READER.artifactDirectory}/`;
  }
}

function assertLocatorBinding(
  locator: OrdinaryArtifactLocator,
  descriptor: { sha256: string; byteLength: number; mediaType: string },
): void {
  if (
    locator.sha256 !== descriptor.sha256 ||
    locator.byteLength !== descriptor.byteLength ||
    locator.mediaType !== descriptor.mediaType ||
    !locator.bucketId ||
    !locator.filePath ||
    !locator.providerObjectId
  ) {
    throw new Error('ARTIFACT_LOCATOR_BINDING_MISMATCH');
  }
}

function assertResultEnvelopePartInput(input: {
  bytes: Uint8Array;
  ownerRef: string;
  partIndex: number;
}): void {
  if (
    !input.ownerRef.trim() ||
    input.bytes.byteLength < 1 ||
    !Number.isSafeInteger(input.partIndex) ||
    input.partIndex < 0 ||
    input.partIndex > 63
  ) {
    throw new Error('RESULT_ENVELOPE_PART_INPUT_INVALID');
  }
}

function assertResultEnvelopePartDescriptor(
  ownerRef: string,
  part: Omit<StagedResultEnvelopePart, 'reused'>,
): void {
  const ownerRefHash = sha256Raw(new TextEncoder().encode(ownerRef));
  if (
    !ownerRef.trim() ||
    part.schemaVersion !== 'wiselink.3_1.staged_result_envelope_part.v1' ||
    part.ownerRefHash !== ownerRefHash ||
    !Number.isSafeInteger(part.partIndex) ||
    part.partIndex < 0 ||
    part.partIndex > 63 ||
    !Number.isSafeInteger(part.byteLength) ||
    part.byteLength < 1 ||
    !/^[0-9a-f]{64}$/u.test(part.sha256)
  ) {
    throw new Error('RESULT_ENVELOPE_PART_DESCRIPTOR_INVALID');
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
  return providerCall(code, () => withFileReadTransportRetry(operation));
}

function providerError(code: string, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(`${code}:${message}`);
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
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
