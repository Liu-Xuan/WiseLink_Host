import type { FileService, FileMeta } from '@lark-apaas/fullstack-nestjs-core';
import { Logger } from '@nestjs/common';
import type { CanonicalMiaodaFinalUserActorContext as Actor } from '../work-item/canonical-object-access.port';
import type { LcmExcelImportRequest } from '@shared/lcm-personal-import.interface';
import { MiaodaFileServiceArtifactStore } from '../document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import type { LcmOriginalReference } from './lcm-original-reference';
import { lcmReadingError } from './lcm-source-reading.port';

export interface LcmOriginalBytes {
  bytes: Buffer; sha256: string; byteLength: number; reference: LcmOriginalReference;
}

/** Same exact namespace/safe-integer handling as the existing Host upload ownership check. */
function sameOwner(value: unknown, actorId: string): boolean {
  return typeof value === 'string' ? value === actorId
    : typeof value === 'number' && Number.isSafeInteger(value) && String(value) === actorId;
}

export class LcmFileOriginalStore {
  private readonly logger: Logger = new Logger(LcmFileOriginalStore.name);
  private readonly reader: MiaodaFileServiceArtifactStore;
  constructor(private readonly files: Pick<FileService, 'from' | 'getDefaultBucket'>) {
    this.reader = new MiaodaFileServiceArtifactStore(files, { maxBytes: 50 * 1024 * 1024 });
  }

  private uploadPath(value: string): string {
    const filePath: string = value.replace(/^\/+/, '');
    if (!filePath.startsWith('wiselink/lcm/uploads/') || /(?:^|\/)\.\.?(?:\/|$)/u.test(filePath) ||
        /[\\\u0000-\u001f]/u.test(filePath)) throw lcmReadingError('LCM_UPLOAD_SELECTION_FORBIDDEN', 403);
    return filePath;
  }

  async resolveUpload(actor: Actor, path: string): Promise<LcmExcelImportRequest['selection'] | null> {
    const filePath: string = this.uploadPath(path);
    const bucketId: string = await this.files.getDefaultBucket();
    const metadata: FileMeta | null = await this.files.from(bucketId).getFileMetadata(filePath);
    if (!metadata) return null;
    if (metadata.bucketID !== bucketId || metadata.filePath.replace(/^\/+/, '') !== filePath ||
        !sameOwner(metadata.createdBy?.userID, actor.canonicalSubject.id))
      throw lcmReadingError('LCM_UPLOAD_SELECTION_FORBIDDEN', 403);
    if (!/\.xlsx?$/iu.test(metadata.name)) throw lcmReadingError('LCM_EXCEL_FORMAT_REQUIRED', 400);
    return { bucketId, filePath, expectedProviderObjectId: metadata.id };
  }

  async acquireUpload(actor: Actor, selection: LcmExcelImportRequest['selection']): Promise<LcmOriginalBytes> {
    const filePath: string = this.uploadPath(selection.filePath);
    const bucketId: string = await this.files.getDefaultBucket();
    if (bucketId !== selection.bucketId) throw lcmReadingError('LCM_UPLOAD_SELECTION_FORBIDDEN', 403);
    const bucket = this.files.from(bucketId);
    const verify = (metadata: FileMeta | null): FileMeta => {
      if (!metadata) throw lcmReadingError('LCM_UPLOAD_NOT_FOUND', 404);
      if (metadata.id !== selection.expectedProviderObjectId || metadata.bucketID !== bucketId ||
          metadata.filePath.replace(/^\/+/, '') !== filePath ||
          !sameOwner(metadata.createdBy?.userID, actor.canonicalSubject.id))
        throw lcmReadingError('LCM_UPLOAD_SELECTION_FORBIDDEN', 403);
      if (!/\.xlsx?$/iu.test(metadata.name)) throw lcmReadingError('LCM_EXCEL_FORMAT_REQUIRED', 400);
      return metadata;
    };
    const metadata: FileMeta = verify(await bucket.getFileMetadata(filePath));
    const read = await this.reader.readSelection({ bucketId, filePath });
    verify(await bucket.getFileMetadata(filePath));
    if (read.providerObjectId !== selection.expectedProviderObjectId || read.byteLength < 1)
      throw lcmReadingError('LCM_ORIGINAL_IDENTITY_CHANGED', 409);
    return { bytes: read.bytes, sha256: read.sha256, byteLength: read.byteLength,
      reference: { kind: 'LCM_HOST_ORIGINAL', bucketId, filePath,
        providerObjectId: read.providerObjectId, originalFileName: metadata.name } };
  }

  async retain(actor: Actor, input: LcmOriginalBytes): Promise<LcmOriginalBytes> {
    const bucketId: string = await this.files.getDefaultBucket();
    const ownerPath: string = [actor.tenantId, actor.canonicalSubject.id].map(encodeURIComponent).join('/');
    const filePath: string = `wiselink/lcm/originals/${ownerPath}/${input.sha256}.bin`;
    const bucket = this.files.from(bucketId);
    let metadata: FileMeta | null = await bucket.getFileMetadata(filePath);
    if (!metadata) {
      try {
        metadata = await bucket.upload(input.bytes, { filePath,
          fileName: input.reference.originalFileName, contentType: 'application/octet-stream', upsert: false });
      } catch (cause: unknown) {
        // A definite conflict can be another identical import winning the create. Network-unknown
        // results and denied writes retain their original error and are never relabelled success.
        const error = cause as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
        if (![error?.status, error?.statusCode, error?.response?.status].includes(409)) throw cause;
        metadata = await bucket.getFileMetadata(filePath);
        if (!metadata) throw cause;
        this.logger.log({ event: 'LCM_ORIGINAL_CONCURRENT_CREATE_READBACK', providerObjectId: metadata.id });
      }
    }
    const reference: LcmOriginalReference = { kind: 'LCM_HOST_ORIGINAL', bucketId, filePath,
      providerObjectId: metadata.id, originalFileName: metadata.name };
    const retained: LcmOriginalBytes = await this.read(reference, input.sha256, input.byteLength);
    if (!retained.bytes.equals(input.bytes)) throw lcmReadingError('LCM_ORIGINAL_IDENTITY_CHANGED', 409);
    return retained;
  }

  async read(reference: LcmOriginalReference, sha256: string, byteLength: number): Promise<LcmOriginalBytes> {
    const read = await this.reader.readSelection(reference);
    if (read.providerObjectId !== reference.providerObjectId || read.sha256 !== sha256 ||
        read.byteLength !== byteLength) throw lcmReadingError('LCM_ORIGINAL_IDENTITY_CHANGED', 409);
    return { bytes: read.bytes, sha256: read.sha256, byteLength: read.byteLength, reference };
  }
}
