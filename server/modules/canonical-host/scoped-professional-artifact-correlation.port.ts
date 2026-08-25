import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Injectable } from '@nestjs/common';

import type {
  CanonicalClassificationSelection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';
import { MiaodaFileServiceArtifactStore } from '../document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import { sha256Raw } from '../unified-reader/unified-reader.utils';

export interface ScopedProfessionalArtifactCorrelationRequest {
  workItemId: string;
  documentId: string;
  documentVersionId: string;
  sourceArtifactId: string;
  sourceSha256: string;
  sourceByteLength: number;
  sourceProviderObjectId: string;
  classification: CanonicalClassificationSelection;
}

export interface ScopedProfessionalArtifactCorrelation {
  schemaVersion: 'wiselink.3_1.scoped_professional_artifact_correlation.v1';
  status: 'HOST_SCOPE_BOUND_IMMUTABLE';
  scope: {
    workItemId: string;
    documentVersionId: string;
  };
  source: {
    documentId: string;
    sourceArtifactId: string;
    sha256: string;
    byteLength: number;
    providerObjectId: string;
  };
  profile: CanonicalClassificationSelection;
  professionalArtifact: {
    professionalArtifactId: string;
    ownerWorkItemId: string;
    ownerDocumentVersionId: string;
    packageId: string;
    artifact: UnifiedPackageArtifactDescriptor;
    fileServiceLocator: {
      bucketId: string;
      filePath: string;
      providerObjectId: string;
    };
  };
  lineage: {
    producerDocumentId: string;
    producerDocumentVersionId: string;
    documentCode: string;
    businessRevision: string | null;
    packageRevisionLabel: string | null;
  };
}

export interface ScopedProfessionalArtifactActualReadback {
  verified: true;
  bytes: Uint8Array;
  providerObjectId: string;
  sha256: string;
  byteLength: number;
}

export interface ScopedProfessionalArtifactProducedPackage {
  packageId: string;
  artifact: UnifiedPackageArtifactDescriptor;
  bytes: Uint8Array;
  lineage: {
    producerDocumentId: string;
    producerDocumentVersionId: string;
    documentCode: string;
    businessRevision: string | null;
    packageRevisionLabel: string | null;
  };
}

/**
 * Receives only bytes already produced by the Host-native PDF pipeline and
 * accepted by strict U0. It persists/registers those exact bytes under the
 * exact WorkItem + DocumentVersion scope and returns only the correlation and
 * FileService locator. The producer then performs a separate actual-byte
 * readback. Lineage never owns or authorizes the returned artifact.
 */
export interface ScopedProfessionalArtifactCorrelationPort {
  readonly available: boolean;
  persistAndCorrelate(
    request: ScopedProfessionalArtifactCorrelationRequest,
    produced: ScopedProfessionalArtifactProducedPackage,
  ): Promise<ScopedProfessionalArtifactCorrelation | null>;
}

@Injectable()
export class UnavailableScopedProfessionalArtifactCorrelationAdapter implements ScopedProfessionalArtifactCorrelationPort {
  readonly available = false;

  async persistAndCorrelate(): Promise<null> {
    return null;
  }
}

/**
 * Hosted implementation for the Host-native PDF producer. It writes only the
 * already U0-accepted package bytes, at a WorkItem + DocumentVersion scoped
 * immutable path, and verifies the provider object and actual bytes before it
 * returns a correlation. The caller performs an independent readback again.
 */
@Injectable()
export class MiaodaScopedProfessionalArtifactCorrelationAdapter implements ScopedProfessionalArtifactCorrelationPort {
  readonly available = true;

  constructor(private readonly fileService: FileService) {}

  async persistAndCorrelate(
    request: ScopedProfessionalArtifactCorrelationRequest,
    produced: ScopedProfessionalArtifactProducedPackage,
  ): Promise<ScopedProfessionalArtifactCorrelation> {
    assertProducedPackage(produced);
    const professionalArtifactId = produced.packageId;
    const bucketId = String(await this.fileService.getDefaultBucket()).trim();
    if (!bucketId) {
      throw new Error('PDF_PRODUCER_CORRELATION_DEFAULT_BUCKET_INVALID');
    }
    const filePath = scopedProfessionalArtifactPath(
      request,
      produced.artifact.sha256,
    );
    const scoped = this.fileService.from(bucketId);
    const existing = await scoped.getFileMetadata(filePath);
    if (!existing) {
      await scoped.upload(Uint8Array.from(produced.bytes), {
        filePath,
        fileName: `${produced.artifact.sha256}.json`,
        contentType: 'application/json',
        upsert: false,
      });
    }
    const readback = await new MiaodaFileServiceArtifactStore(
      this.fileService,
    ).readSelection({ bucketId, filePath });
    if (
      readback.readbackVerified !== true ||
      readback.sha256 !== produced.artifact.sha256 ||
      readback.byteLength !== produced.artifact.byteLength ||
      !sameBytes(readback.bytes, produced.bytes)
    ) {
      throw new Error('PDF_PRODUCER_PROFESSIONAL_ACTUAL_BYTE_MISMATCH');
    }
    return {
      schemaVersion:
        'wiselink.3_1.scoped_professional_artifact_correlation.v1',
      status: 'HOST_SCOPE_BOUND_IMMUTABLE',
      scope: {
        workItemId: request.workItemId,
        documentVersionId: request.documentVersionId,
      },
      source: {
        documentId: request.documentId,
        sourceArtifactId: request.sourceArtifactId,
        sha256: request.sourceSha256,
        byteLength: request.sourceByteLength,
        providerObjectId: request.sourceProviderObjectId,
      },
      profile: { ...request.classification },
      professionalArtifact: {
        professionalArtifactId,
        ownerWorkItemId: request.workItemId,
        ownerDocumentVersionId: request.documentVersionId,
        packageId: produced.packageId,
        artifact: {
          storeRole: 'UnifiedArtifactStoreCandidate',
          ref: scopedProfessionalArtifactRef(
            request,
            professionalArtifactId,
          ),
          sha256: produced.artifact.sha256,
          byteLength: produced.artifact.byteLength,
          mediaType: 'application/json',
        },
        fileServiceLocator: {
          bucketId,
          filePath,
          providerObjectId: readback.providerObjectId,
        },
      },
      lineage: { ...produced.lineage },
    };
  }
}

export function assertScopedProfessionalArtifactCorrelation(
  request: ScopedProfessionalArtifactCorrelationRequest,
  value: ScopedProfessionalArtifactCorrelation,
  readback: ScopedProfessionalArtifactActualReadback,
): ScopedProfessionalArtifactCorrelation {
  const artifact: UnifiedPackageArtifactDescriptor =
    value.professionalArtifact.artifact;
  const actualSha256: string = sha256Raw(readback.bytes);
  const expectedArtifactRef: string = scopedProfessionalArtifactRef(
    request,
    value.professionalArtifact.professionalArtifactId,
  );
  if (
    value.schemaVersion !==
      'wiselink.3_1.scoped_professional_artifact_correlation.v1' ||
    value.status !== 'HOST_SCOPE_BOUND_IMMUTABLE' ||
    value.scope.workItemId !== request.workItemId ||
    value.scope.documentVersionId !== request.documentVersionId ||
    value.source.documentId !== request.documentId ||
    value.source.sourceArtifactId !== request.sourceArtifactId ||
    value.source.sha256 !== request.sourceSha256 ||
    value.source.byteLength !== request.sourceByteLength ||
    value.source.providerObjectId !== request.sourceProviderObjectId ||
    value.profile.normalizedFamily !==
      request.classification.normalizedFamily ||
    value.profile.status !== request.classification.status ||
    value.profile.classifierReleaseId !==
      request.classification.classifierReleaseId ||
    value.profile.classifierReleaseHash !==
      request.classification.classifierReleaseHash ||
    value.profile.parserProfileId !== request.classification.parserProfileId ||
    value.profile.parserProfileHash !==
      request.classification.parserProfileHash ||
    value.profile.fingerprint !== request.classification.fingerprint ||
    value.professionalArtifact.ownerWorkItemId !== request.workItemId ||
    value.professionalArtifact.ownerDocumentVersionId !==
      request.documentVersionId ||
    !value.professionalArtifact.professionalArtifactId.trim() ||
    value.professionalArtifact.professionalArtifactId ===
      value.lineage.producerDocumentVersionId ||
    !value.professionalArtifact.fileServiceLocator.bucketId.trim() ||
    !value.professionalArtifact.fileServiceLocator.filePath.trim() ||
    !value.professionalArtifact.fileServiceLocator.providerObjectId.trim() ||
    readback.providerObjectId !==
      value.professionalArtifact.fileServiceLocator.providerObjectId ||
    readback.verified !== true ||
    readback.sha256 !== artifact.sha256 ||
    readback.byteLength !== artifact.byteLength ||
    artifact.storeRole !== 'UnifiedArtifactStoreCandidate' ||
    artifact.ref !== expectedArtifactRef ||
    artifact.mediaType !== 'application/json' ||
    readback.bytes.byteLength !== artifact.byteLength ||
    actualSha256 !== artifact.sha256
  ) {
    throw new Error('PDF_PRODUCER_CORRELATION_SCOPE_OR_READBACK_INVALID');
  }
  return value;
}

export function scopedProfessionalArtifactRef(
  request: Pick<
    ScopedProfessionalArtifactCorrelationRequest,
    'workItemId' | 'documentVersionId'
  >,
  professionalArtifactId: string,
): string {
  return [
    'artifact://HostScopedProfessionalArtifact',
    encodeURIComponent(request.workItemId),
    encodeURIComponent(request.documentVersionId),
    encodeURIComponent(professionalArtifactId),
  ].join('/');
}

function scopedProfessionalArtifactPath(
  request: Pick<
    ScopedProfessionalArtifactCorrelationRequest,
    'workItemId' | 'documentVersionId'
  >,
  sha256: string,
): string {
  return [
    'canonical-host',
    'professional-artifacts',
    encodeURIComponent(request.workItemId),
    encodeURIComponent(request.documentVersionId),
    `${sha256}.json`,
  ].join('/');
}

function assertProducedPackage(
  produced: ScopedProfessionalArtifactProducedPackage,
): void {
  let packageId: unknown;
  try {
    packageId = (
      JSON.parse(Buffer.from(produced.bytes).toString('utf8')) as {
        packageId?: unknown;
      }
    ).packageId;
  } catch {
    throw new Error('PDF_PRODUCER_GENERATED_PACKAGE_INVALID');
  }
  const actualSha256 = sha256Raw(produced.bytes);
  if (
    !produced.packageId.trim() ||
    packageId !== produced.packageId ||
    produced.artifact.storeRole !== 'UnifiedArtifactStoreCandidate' ||
    produced.artifact.mediaType !== 'application/json' ||
    produced.artifact.ref !==
      `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${actualSha256}` ||
    produced.artifact.sha256 !== actualSha256 ||
    produced.artifact.byteLength !== produced.bytes.byteLength
  ) {
    throw new Error('PDF_PRODUCER_GENERATED_PACKAGE_INVALID');
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}
