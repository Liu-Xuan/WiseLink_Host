import { Logger } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';

import { UNIFIED_READER } from './unified-reader.constants';
import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
} from './unified-reader.types';
import {
  rawHashValue,
  requiredText,
  sha256Raw,
} from './unified-reader.utils';
import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

export class MiaodaFileArtifactStoreAdapter
  implements UnifiedArtifactStorePort
{
  private readonly logger: Logger = new Logger(
    MiaodaFileArtifactStoreAdapter.name,
  );

  constructor(private readonly fileService: FileService) {}

  async persistAndReadback(
    bytes: Uint8Array,
  ): Promise<ImmutableArtifactPersistResult> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new Error('ARTIFACT_PERSIST_FAILED:EMPTY_BYTES');
    }
    const digest: string = sha256Raw(bytes);
    const filePath: string = this.filePath(digest);
    let metadata = await this.fileService.getFileMetadata(filePath);
    let reused: boolean = metadata !== null;
    if (metadata === null) {
      try {
        metadata = await this.fileService.upload(Buffer.from(bytes), {
          filePath,
          fileName: `${digest}.json`,
          contentType: 'application/json',
          upsert: false,
        });
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
        metadata = await this.fileService.getFileMetadata(filePath);
        reused = true;
      }
    }
    if (metadata === null || metadata.filePath !== filePath) {
      throw new Error('ARTIFACT_PERSIST_FAILED:PATH_MISMATCH');
    }
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: UNIFIED_READER.artifactStoreRole,
      ref: this.artifactRef(digest),
      sha256: digest,
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    };
    const actual: Uint8Array = await this.readActualBytes(artifact);
    assertSameBytes(bytes, actual);
    this.logger.log(
      `Immutable package ${reused ? 'reused' : 'stored'} and verified; ` +
        `sha256=${digest}; byteLength=${bytes.byteLength}`,
    );
    return { artifact, bytes: actual, reused };
  }

  async readActualBytes(
    artifact: UnifiedPackageArtifactDescriptor,
  ): Promise<Uint8Array> {
    assertArtifactDescriptor(artifact);
    const expectedPath: string = this.filePath(artifact.sha256);
    const actualPath: string = this.filePath(
      artifact.ref.slice(this.artifactRefPrefix().length),
    );
    if (actualPath !== expectedPath) {
      throw new Error('ARTIFACT_READBACK_MISMATCH:PATH');
    }
    const downloaded = await this.fileService.download(actualPath);
    const buffer: Uint8Array = new Uint8Array(
      await downloaded.content.arrayBuffer(),
    );
    if (
      downloaded.metadata === null ||
      downloaded.metadata.filePath !== actualPath ||
      Number(downloaded.metadata.metadata.contentLength) !==
        artifact.byteLength ||
      downloaded.metadata.metadata.mimeType !== artifact.mediaType ||
      buffer.byteLength !== artifact.byteLength ||
      sha256Raw(buffer) !== artifact.sha256
    ) {
      throw new Error('ARTIFACT_READBACK_MISMATCH:BYTES');
    }
    return buffer;
  }

  private filePath(digest: string): string {
    return `${UNIFIED_READER.artifactDirectory}/${rawHashValue(
      digest,
      'artifact.sha256',
    )}.json`;
  }

  private artifactRef(digest: string): string {
    return `${this.artifactRefPrefix()}${rawHashValue(
      digest,
      'artifact.sha256',
    )}`;
  }

  private artifactRefPrefix(): string {
    return `artifact://${UNIFIED_READER.artifactStoreRole}/${UNIFIED_READER.artifactDirectory}/`;
  }
}

function assertArtifactDescriptor(
  artifact: UnifiedPackageArtifactDescriptor,
): void {
  if (
    artifact.storeRole !== UNIFIED_READER.artifactStoreRole ||
    artifact.mediaType !== 'application/json'
  ) {
    throw new Error('ARTIFACT_READBACK_MISMATCH:DESCRIPTOR');
  }
  requiredText(artifact.ref, 'artifact.ref');
  rawHashValue(artifact.sha256, 'artifact.sha256');
  const expectedPrefix =
    `artifact://${UNIFIED_READER.artifactStoreRole}/${UNIFIED_READER.artifactDirectory}/`;
  if (!artifact.ref.startsWith(expectedPrefix)) {
    throw new Error('ARTIFACT_READBACK_MISMATCH:REF');
  }
  if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength <= 0) {
    throw new Error('ARTIFACT_READBACK_MISMATCH:BYTE_LENGTH');
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error) || error.message !== 'File already exists') {
    return false;
  }
  const status: unknown = (error as Error & { status?: unknown }).status;
  return status === undefined || status === 409;
}

function assertSameBytes(expected: Uint8Array, actual: Uint8Array): void {
  if (expected.byteLength !== actual.byteLength) {
    throw new Error('ARTIFACT_READBACK_MISMATCH:BYTE_LENGTH');
  }
  for (let index = 0; index < expected.byteLength; index += 1) {
    if (expected[index] !== actual[index]) {
      throw new Error('ARTIFACT_READBACK_MISMATCH:BYTES');
    }
  }
}
