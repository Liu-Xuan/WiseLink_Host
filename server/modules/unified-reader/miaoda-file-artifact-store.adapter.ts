import { FileService } from '@lark-apaas/fullstack-nestjs-core';

import { UNIFIED_READER } from './unified-reader.constants';
import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
  UnifiedHostActivationExactBinding,
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
  constructor(
    private readonly fileService: FileService,
    readonly activationBinding: UnifiedHostActivationExactBinding,
  ) {}

  async persistAndReadback(
    _bytes: Uint8Array,
  ): Promise<ImmutableArtifactPersistResult> {
    throw new Error(
      'VALIDATION_WRITE_RECEIPT_REQUIRED:PACKAGE_ARTIFACT_PERSIST',
    );
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
