import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Injectable } from '@nestjs/common';

import { MiaodaFileServiceArtifactStore } from '../document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import type {
  ResolvedS1000dDocumentSource,
  S1000dAuthorizedSourceArtifact,
  S1000dDocumentSourcePort,
} from './s1000d-ingress.types';

/**
 * Read-only adapter over the existing DM Catalog resolver and FileService.
 * It cannot create an XML DocumentVersion; that remains the DM owner's seam.
 */
@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided -- CanonicalHostModule.forRoot registers this dynamic production provider.
export class MiaodaS1000dDocumentSourceAdapter implements S1000dDocumentSourcePort {
  readonly available = true;
  private readonly sourceStore: MiaodaFileServiceArtifactStore;

  constructor(
    fileService: FileService,
    private readonly resolver: MiaodaDocumentVersionSourceResolver,
  ) {
    this.sourceStore = new MiaodaFileServiceArtifactStore(fileService);
  }

  async resolveCurrent(
    documentVersionId: string,
  ): Promise<ResolvedS1000dDocumentSource> {
    const resolved = await this.resolver.resolve(documentVersionId, {
      requireCurrent: true,
    });
    const mediaType = normalizedXmlMediaType(resolved.artifact.mediaType);
    if (resolved.version.mediaType !== mediaType) {
      throw sourceIdentityInvalid();
    }
    return {
      familyId: resolved.family.familyId,
      currentGeneration: Number(resolved.family.currentGeneration),
      documentId: resolved.version.documentId,
      documentVersionId: resolved.version.documentVersionId,
      revisionId: resolved.version.revisionId,
      canonicalRevisionIdentity: resolved.version.canonicalRevisionIdentity,
      committedAt: new Date(resolved.version.committedAt).toISOString(),
      sourceArtifactId: resolved.artifact.sourceArtifactId,
      originalFilename: resolved.version.originalFilename,
      mediaType,
      sha256: resolved.artifact.sha256,
      byteLength: Number(resolved.artifact.byteLength),
      providerObjectId: resolved.artifact.providerObjectId,
      providerVersionId: resolved.artifact.providerVersionId,
      fileServiceLocator: {
        bucketId: resolved.artifact.bucketId,
        filePath: resolved.artifact.filePath,
      },
    };
  }

  async readActualBytes(
    source: ResolvedS1000dDocumentSource,
  ): Promise<Uint8Array> {
    const selected = await this.sourceStore.readSelection(
      source.fileServiceLocator,
    );
    if (
      selected.readbackVerified !== true ||
      selected.providerObjectId !== source.providerObjectId ||
      selected.providerVersionId !== source.providerVersionId ||
      selected.sha256 !== source.sha256 ||
      selected.byteLength !== source.byteLength ||
      normalizedXmlMediaType(selected.mediaType) !== source.mediaType
    ) {
      throw sourceIdentityInvalid();
    }
    return Uint8Array.from(selected.bytes);
  }

  async readAuthorizedActualBytes(
    artifact: S1000dAuthorizedSourceArtifact,
  ): Promise<Uint8Array> {
    const selected = await this.sourceStore.readSelection(
      artifact.fileServiceLocator,
    );
    if (
      selected.readbackVerified !== true ||
      selected.providerObjectId !== artifact.providerObjectId ||
      selected.providerVersionId !== artifact.providerVersionId ||
      selected.sha256 !== artifact.sha256 ||
      selected.byteLength !== artifact.byteLength ||
      normalizedMediaType(selected.mediaType) !==
        normalizedMediaType(artifact.mediaType)
    ) {
      throw sourceIdentityInvalid();
    }
    return Uint8Array.from(selected.bytes);
  }
}

function normalizedXmlMediaType(
  value: unknown,
): ResolvedS1000dDocumentSource['mediaType'] {
  const normalized = String(value ?? '')
    .split(';', 1)[0]
    .trim()
    .toLocaleLowerCase();
  if (normalized !== 'application/xml' && normalized !== 'text/xml') {
    throw Object.assign(
      new Error('DocumentVersion is not an XML S1000D source.'),
      {
        code: 'S1000D_DOCUMENT_VERSION_MEDIA_TYPE_UNSUPPORTED',
        statusCode: 409,
      },
    );
  }
  return normalized;
}

function normalizedMediaType(value: unknown): string {
  return String(value ?? '')
    .split(';', 1)[0]
    .trim()
    .toLocaleLowerCase();
}

function sourceIdentityInvalid(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(
    new Error('S1000D DocumentVersion actual-byte identity is invalid.'),
    {
      code: 'S1000D_DOCUMENT_VERSION_SOURCE_INVALID',
      statusCode: 409,
    },
  );
}
