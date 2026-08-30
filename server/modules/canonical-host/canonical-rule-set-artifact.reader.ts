import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Injectable } from '@nestjs/common';

import { MiaodaFileServiceArtifactStore } from '../document-management/src/hosted/miaodaFileServiceArtifactStore.js';

const MAX_RULE_PACK_BYTES = 2 * 1024 * 1024;

export interface CanonicalRuleSetArtifactReadResult {
  bytes: Uint8Array;
  artifactRef: string;
  artifactDigest: string;
  artifactVersion: string;
}

@Injectable()
export class CanonicalRuleSetArtifactReader {
  private readonly store: MiaodaFileServiceArtifactStore;

  constructor(fileService: FileService) {
    this.store = new MiaodaFileServiceArtifactStore(fileService, {
      maxBytes: MAX_RULE_PACK_BYTES,
    });
  }

  async read(selection: {
    bucketId: string;
    filePath: string;
  }): Promise<CanonicalRuleSetArtifactReadResult> {
    const selected = await this.store.readSelection(selection);
    if (selected.byteLength < 1 || selected.byteLength > MAX_RULE_PACK_BYTES) {
      throw ruleSetArtifactError('RULE_SET_ARTIFACT_SIZE_INVALID', 400);
    }
    return {
      bytes: Uint8Array.from(selected.bytes),
      artifactRef: artifactRef(
        selected.bucketId,
        selected.filePath,
        selected.providerObjectId,
      ),
      artifactDigest: `sha256:${selected.sha256}`,
      artifactVersion: selected.providerVersionId,
    };
  }
}

function artifactRef(
  bucketId: string,
  filePath: string,
  providerObjectId: string,
): string {
  const encodedPath = filePath
    .split('/')
    .filter(Boolean)
    .map((part: string): string => encodeURIComponent(part))
    .join('/');
  return (
    `miaoda-fileservice://${encodeURIComponent(bucketId)}/${encodedPath}` +
    `?object=${encodeURIComponent(providerObjectId)}`
  );
}

function ruleSetArtifactError(
  code: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}
