import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Injectable } from '@nestjs/common';

import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import { UNIFIED_READER } from './unified-reader.constants';
import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
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
  implements UnifiedArtifactStorePort
{
  constructor(private readonly fileService: FileService) {}

  async persistAndReadback(
    input: Uint8Array,
  ): Promise<ImmutableArtifactPersistResult> {
    if (input.byteLength < 1) throw new Error('ARTIFACT_BYTES_REQUIRED');
    const bytes = Uint8Array.from(input);
    const digest = sha256Raw(bytes);
    const filePath = this.filePath(digest);
    const bucketId = await providerCall(
      'ARTIFACT_STORE_DEFAULT_BUCKET_READ_FAILED',
      () => this.fileService.getDefaultBucket(),
    );
    const scoped = this.fileService.from(bucketId);
    const existing = await providerCall(
      'ARTIFACT_STORE_METADATA_READ_FAILED',
      () => scoped.getFileMetadata(filePath),
    );
    let reused = true;
    if (existing === null) {
      const uploaded = await providerCall(
        'ARTIFACT_STORE_UPLOAD_FAILED',
        () =>
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

  async readActualBytes(
    artifact: UnifiedPackageArtifactDescriptor,
  ): Promise<Uint8Array> {
    assertDescriptor(artifact, this.artifactRefPrefix());
    const filePath = this.filePath(artifact.sha256);
    const bucketId = await providerCall(
      'ARTIFACT_STORE_DEFAULT_BUCKET_READ_FAILED',
      () => this.fileService.getDefaultBucket(),
    );
    const scoped = this.fileService.from(bucketId);
    const metadata = await providerCall(
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
    const downloaded = await providerCall(
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

  private filePath(digest: string): string {
    return `${UNIFIED_READER.artifactDirectory}/${rawHashValue(
      digest,
      'artifact.sha256',
    )}.json`;
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

function assertDescriptor(
  artifact: UnifiedPackageArtifactDescriptor,
  prefix: string,
): void {
  if (
    artifact.storeRole !== UNIFIED_READER.artifactStoreRole ||
    artifact.mediaType !== JSON_MEDIA_TYPE ||
    artifact.ref !== `${prefix}${artifact.sha256}` ||
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
    const message = cause instanceof Error ? cause.message : String(cause);
    const error = new Error(`${code}:${message}`);
    (error as Error & { cause?: unknown }).cause = cause;
    throw error;
  }
}
