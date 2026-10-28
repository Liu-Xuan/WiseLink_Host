import type { TdmsArtifactSelection } from '@shared/tdms-file-service-import.interface';
import {
  TDMS_ARTIFACT_READ_MAX_BYTES,
  tdmsUploadPath,
} from './tdms-file-service-import.validation';
import type { TdmsSourceScope, TdmsPublicActor } from './tdms-source.types';
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { MiaodaFileServiceArtifactStore } from '../document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import { MiaodaHostedDocumentCatalog } from '../document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { deterministicId } from '../document-management/src/runtime/valueTools.js';
import { controlledPdfByteView } from '../document-management/src/migrated/ingress/pdfDocumentIdentityOwner.js';
import type { TdmsPackageArtifact } from '@shared/tdms-source.interface';
import type { HostedFileServiceSelection } from '../document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import type { TdmsArtifactStore } from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import { hash, TDMS_SMALL_PACKAGE_MAX_BYTES } from './tdms-source.validation';

type CanonicalArtifact = Pick<
  NonNullable<
    Awaited<
      ReturnType<MiaodaHostedDocumentCatalog['readSourceArtifactByContent']>
    >
  >,
  | 'sourceArtifactId'
  | 'sha256'
  | 'byteLength'
  | 'mediaType'
  | 'bucketId'
  | 'filePath'
  | 'providerObjectId'
  | 'providerVersionId'
  | 'readbackVerified'
  | 'createdAt'
>;

/** Controlled immutable candidate only, deliberately NOT the PDF identity owner's registration path. */
@Injectable()
// Explicit optional register({ artifactStoreProvider }) binding requires FileService/Catalog imports.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class MiaodaTdmsArtifactStore implements TdmsArtifactStore {
  private readonly reader: MiaodaFileServiceArtifactStore;
  constructor(
    private readonly files: FileService,
    private readonly catalog: MiaodaHostedDocumentCatalog,
  ) {
    this.reader = new MiaodaFileServiceArtifactStore(files, {
      maxBytes: TDMS_ARTIFACT_READ_MAX_BYTES,
    });
  }
  async acquire(input: Parameters<TdmsArtifactStore['acquire']>[0]) {
    const { artifact: a, scope, actor } = input;
    const bytes = Buffer.from(a.bytesBase64, 'base64');
    if (
      bytes.length === 0 ||
      bytes.length > TDMS_SMALL_PACKAGE_MAX_BYTES ||
      bytes.length !== a.byteLength ||
      createHash('sha256').update(bytes).digest('hex') !== a.sha256
    )
      throw tdmsError('TDMS_ARTIFACT_IDENTITY_MISMATCH');
    return this.acquireVerified(input, bytes);
  }
  async acquireSelection(input: {
    scope: TdmsSourceScope;
    actor: TdmsPublicActor;
    packageId: string;
    artifact: TdmsArtifactSelection;
  }) {
    const a = input.artifact;
    const selection = {
      ...a.selection,
      filePath: tdmsUploadPath(a.selection.filePath),
    };
    const bucketId = await this.files.getDefaultBucket();
    if (selection.bucketId !== bucketId)
      throw tdmsError('TDMS_UPLOAD_SELECTION_FORBIDDEN', 403);
    const builder = this.files.from(bucketId);
    const verifyMetadata = (metadata) => {
      if (!metadata) throw tdmsError('TDMS_UPLOAD_SELECTION_NOT_FOUND', 404);
      if (
        metadata.bucketID !== bucketId ||
        tdmsUploadPath(metadata.filePath) !== selection.filePath ||
        metadata.id !== selection.expectedProviderObjectId ||
        !sameExactUserId(
          metadata.createdBy?.userID,
          input.actor.canonicalSubject.id,
        ) ||
        Number(metadata.metadata?.contentLength) !== a.byteLength
      )
        throw tdmsError('TDMS_UPLOAD_SELECTION_FORBIDDEN', 403);
    };
    verifyMetadata(await builder.getFileMetadata(selection.filePath));
    const observed = await this.reader.readSelection(selection);
    if (
      observed.providerObjectId !== selection.expectedProviderObjectId ||
      observed.sha256 !== a.sha256 ||
      observed.byteLength !== a.byteLength
    )
      throw tdmsError('TDMS_UPLOAD_SELECTION_READBACK_MISMATCH');
    verifyMetadata(await builder.getFileMetadata(selection.filePath));
    return this.acquireVerified(input, observed.bytes, observed);
  }
  private async acquireVerified(
    input: {
      scope: TdmsSourceScope;
      actor: TdmsPublicActor;
      packageId: string;
      artifact: Omit<TdmsPackageArtifact, 'bytesBase64'>;
    },
    bytes: Buffer,
    upload?: HostedFileServiceSelection,
  ) {
    const { artifact: a, scope, actor } = input;
    const pdf = a.mediaType === 'application/pdf';
    if (pdf) {
      try {
        controlledPdfByteView(bytes);
      } catch {
        throw tdmsError('TDMS_PDF_ARTIFACT_FORMAT_INVALID', 422);
      }
    }
    let canonical: CanonicalArtifact | null =
      await this.catalog.readSourceArtifactByContent({
        sha256: a.sha256,
        byteLength: a.byteLength,
      });
    let verified: HostedFileServiceSelection;
    if (canonical) {
      verified = await this.verifyCanonical(canonical, a, bytes);
    } else {
      const bucketId = await this.files.getDefaultBucket();
      // Share canonical PDF bytes with ordinary intake, without granting a formal DVI.
      // Other attachment types retain their existing candidate storage and identity.
      const filePath = pdf
        ? `/document-management/source/sha256/${a.sha256.slice(0, 2)}/${a.sha256}.pdf`
        : `/tdms-source/candidate/sha256/${a.sha256.slice(0, 2)}/${a.sha256}.bin`;
      const builder = this.files.from(bucketId);
      let metadata = await builder.getFileMetadata(filePath);
      if (!metadata)
        metadata = await builder.upload(bytes, {
          filePath: filePath.replace(/^\//u, ''),
          fileName: `${a.sha256}.${pdf ? 'pdf' : 'bin'}`,
          contentType: a.mediaType,
          upsert: false,
        });
      verified = await this.reader.readSelection({ bucketId, filePath });
      if (
        verified.sha256 !== a.sha256 ||
        verified.byteLength !== a.byteLength ||
        !verified.bytes.equals(bytes)
      )
        throw tdmsError('TDMS_ARTIFACT_READBACK_MISMATCH');
      canonical = {
        sourceArtifactId: pdf
          ? deterministicId('source_artifact', a.sha256, a.byteLength)
          : 'TDMS-SA-' + hash([a.sha256, a.byteLength, a.mediaType]),
        sha256: a.sha256,
        byteLength: a.byteLength,
        mediaType: a.mediaType,
        bucketId,
        filePath,
        providerObjectId: verified.providerObjectId,
        providerVersionId: verified.providerVersionId,
        readbackVerified: true,
        createdAt: new Date(),
      };
    }
    let sourceArtifactId = canonical.sourceArtifactId;
    const id = hash([
      scope,
      actor.canonicalSubject.id,
      input.packageId,
      a.memberId,
      a.sourceAttachmentId,
      a.sourceAttachmentVersion,
      a.sha256,
      ...(upload
        ? [upload.bucketId, upload.filePath, upload.providerObjectId]
        : []),
    ]);
    const acquisitionId = 'TDMS-ACQ-' + id;
    const now = new Date();
    const acquisition = () => ({
      acquisitionId,
      sourceArtifactId,
      sourceChannel: 'wiselink_tdms_candidate',
      sourceRef: `TDMS:${scope.sourceInstanceId}:${a.sourceAttachmentId}`,
      selectionBucketId: upload?.bucketId ?? canonical.bucketId,
      selectionFilePath: upload?.filePath ?? canonical.filePath,
      providerObjectId: upload?.providerObjectId ?? verified.providerObjectId,
      providerVersionId:
        upload?.providerVersionId ?? verified.providerVersionId,
      acquiredBy: actor.canonicalSubject.id,
      acquiredAt: now,
      idempotencyKey: 'tdms:' + id,
      sourceDescriptor: {
        ...scope,
        packageId: input.packageId,
        sourceAttachmentId: a.sourceAttachmentId,
        sourceAttachmentVersion: a.sourceAttachmentVersion,
        sha256: a.sha256,
        byteLength: a.byteLength,
        fileName: a.fileName,
        mediaType: a.mediaType,
        candidateOnly: true,
        ...(upload
          ? {
              uploadSelectionPin: {
                bucketId: upload.bucketId,
                filePath: upload.filePath,
                providerObjectId: upload.providerObjectId,
                sha256: upload.sha256,
                byteLength: upload.byteLength,
              },
            }
          : {}),
      },
    });
    const sourceArtifact = () => ({
      sourceArtifactId: canonical.sourceArtifactId,
      sha256: canonical.sha256,
      byteLength: canonical.byteLength,
      mediaType: canonical.mediaType,
      bucketId: canonical.bucketId,
      filePath: canonical.filePath,
      providerObjectId: canonical.providerObjectId,
      providerVersionId: canonical.providerVersionId,
      readbackVerified: canonical.readbackVerified,
      createdAt: canonical.createdAt,
    });
    let receipt;
    try {
      receipt = await this.catalog.recordAcquisition({
        sourceArtifact: sourceArtifact(),
        acquisition: acquisition(),
      });
    } catch (error) {
      // A concurrent ordinary intake may win the one canonical content identity. Never bypass current SQL/FileService access.
      if (!contentIdentityRace(error)) throw error;
      const winner = await this.catalog.readSourceArtifactByContent({
        sha256: a.sha256,
        byteLength: a.byteLength,
      });
      if (!winner) throw error;
      verified = await this.verifyCanonical(winner, a, bytes);
      canonical = winner;
      sourceArtifactId = winner.sourceArtifactId;
      receipt = await this.catalog.recordAcquisition({
        sourceArtifact: sourceArtifact(),
        acquisition: acquisition(),
      });
    }
    if (
      receipt.documentVersionId !== null ||
      receipt.status !== 'ACQUIRED_READBACK_VERIFIED'
    )
      throw tdmsError('TDMS_CANDIDATE_PROMOTION_FORBIDDEN', 409);
    return {
      memberId: a.memberId,
      sourceArtifactId,
      acquisitionId,
      fileName: a.fileName,
      mediaType: a.mediaType,
      sha256: a.sha256,
      byteLength: a.byteLength,
      immutableReadbackVerified: true as const,
      documentVersionId: null,
      registrationGap:
        'FORMAL_REGISTRATION_REQUIRES_INDEPENDENT_RETENTION_AUTHORITY',
    };
  }
  private async verifyCanonical(
    canonical: CanonicalArtifact,
    artifact: Omit<TdmsPackageArtifact, 'bytesBase64'>,
    bytes: Buffer,
  ) {
    if (
      canonical.readbackVerified !== true ||
      canonical.sha256 !== artifact.sha256 ||
      Number(canonical.byteLength) !== artifact.byteLength
    )
      throw tdmsError('TDMS_CANONICAL_ARTIFACT_IDENTITY_MISMATCH');
    const verified = await this.reader.readSelection({
      bucketId: canonical.bucketId,
      filePath: canonical.filePath,
    });
    if (
      verified.providerObjectId !== canonical.providerObjectId ||
      verified.providerVersionId !== canonical.providerVersionId ||
      verified.sha256 !== artifact.sha256 ||
      verified.byteLength !== artifact.byteLength ||
      !verified.bytes.equals(bytes)
    )
      throw tdmsError('TDMS_CANONICAL_ARTIFACT_READBACK_MISMATCH');
    return verified;
  }
}

function contentIdentityRace(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (
    let cause = error;
    cause && typeof cause === 'object' && !seen.has(cause);
    cause = (cause as { cause?: unknown }).cause
  ) {
    seen.add(cause);
    const e = cause as {
      code?: unknown;
      constraint_name?: unknown;
      constraint?: unknown;
    };
    if (
      e.code === '23505' &&
      (e.constraint_name === 'uk_dm_source_artifact_content' ||
        e.constraint === 'uk_dm_source_artifact_content')
    )
      return true;
  }
  return false;
}

function sameExactUserId(value: unknown, actorUserId: string): boolean {
  if (typeof value === 'string') return value === actorUserId;
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    String(value) === actorUserId
  );
}
