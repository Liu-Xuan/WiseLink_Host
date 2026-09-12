import type { DocumentOriginalChange } from './document-original-change';
import { createHash } from 'node:crypto';
import type { FileService } from '@lark-apaas/fullstack-nestjs-core';
import type { FileMeta } from '@lark-apaas/file-service';
import type { DocumentOriginalArtifact, DocumentOriginalBinding, DocumentOriginalResult } from '@shared/document-original.interface';
import { documentOriginalStructuredSource } from './document-original-adapter';
import { withFileReadTransportRetry } from '../../../../unified-reader/file-service-read-transport';

export interface DocumentOriginalStoreScope { documentVersionId: string; parseRunId: string; bucketId: string }
export interface DocumentOriginalBundle {
  schemaVersion: 'wiselink.document.bundle.v1';
  original: DocumentOriginalResult;
  rawPdfArtifacts: DocumentOriginalArtifact[];
  change?: DocumentOriginalChange;
  rawMarkdown: DocumentOriginalArtifact;
}
const entries = {
  RAW_MARKDOWN: { relativePath: 'raw/document.md', mediaType: 'text/markdown' },
  MANIFEST: { relativePath: 'original/manifest.json', mediaType: 'application/json' },
};

/** FileService recovery uses the exact deterministic object path and verified bytes.
 * Publication and lease checks remain in the parseRun repository, never this store. */
export class DocumentOriginalStore {
  constructor(private readonly files: Pick<FileService, 'from'>) {}

  async save(scope: DocumentOriginalStoreScope, role: DocumentOriginalArtifact['role'], bytes: Uint8Array,
    onProgress: (artifact: DocumentOriginalArtifact) => Promise<void>, relativePath?: string): Promise<DocumentOriginalArtifact> {
    const snapshot = new Uint8Array(bytes);
    if (!snapshot.length || snapshot.length > 64 * 1024 * 1024) throw new Error('DOCUMENT_ORIGINAL_ARTIFACT_SIZE_INVALID');
    const rule = entry(role, relativePath);
    const filePath = prefix(scope) + rule.relativePath;
    const scoped = this.files.from(scope.bucketId);
    const existing = await optionalMetadata(() => scoped.getFileMetadata(filePath));
    // No overwrite or speculative retry after a lost upload response. Reentry reads
    // this same path before deciding whether another upload is needed.
    const metadata = existing ?? await scoped.upload(snapshot, { filePath,
      fileName: rule.relativePath.split('/').at(-1), contentType: rule.mediaType, upsert: false });
    const artifact: DocumentOriginalArtifact = { role, ...rule, bucketId: metadata.bucketID,
      filePath: metadata.filePath.replace(/^\/+/, ''), providerObjectId: metadata.id,
      byteLength: snapshot.length, sha256: digest(snapshot), readback: 'UPLOADED' };
    assertDescriptor(scope, artifact);
    assertMetadata(metadata, artifact);
    await onProgress({ ...artifact });
    const readback = await this.read(scope, artifact);
    if (!Buffer.from(readback).equals(Buffer.from(snapshot))) throw new Error('DOCUMENT_ORIGINAL_READBACK_MISMATCH');
    artifact.readback = 'VERIFIED';
    await onProgress({ ...artifact });
    return artifact;
  }

  async read(scope: DocumentOriginalStoreScope, artifact: DocumentOriginalArtifact): Promise<Uint8Array> {
    assertDescriptor(scope, artifact);
    const scoped = this.files.from(scope.bucketId);
    assertMetadata(await withFileReadTransportRetry(() => scoped.getFileMetadata(artifact.filePath)), artifact);
    const result = await withFileReadTransportRetry(() => scoped.download(artifact.filePath));
    assertMetadata(result.metadata, artifact);
    if (result.content.size !== artifact.byteLength) throw new Error('DOCUMENT_ORIGINAL_READBACK_SIZE_MISMATCH');
    const bytes = new Uint8Array(await result.content.arrayBuffer());
    if (bytes.length !== artifact.byteLength || digest(bytes) !== artifact.sha256)
      throw new Error('DOCUMENT_ORIGINAL_READBACK_DIGEST_MISMATCH');
    return bytes;
  }

  /** Recover a write whose response or DB progress was lost without re-invoking a model. */
  async recover(scope: DocumentOriginalStoreScope, role: DocumentOriginalArtifact['role'], relativePath?: string) {
    const rule = entry(role, relativePath);
    const filePath = prefix(scope) + rule.relativePath;
    const scoped = this.files.from(scope.bucketId);
    const metadata = await optionalMetadata(() => scoped.getFileMetadata(filePath));
    if (!metadata) return null;
    const result = await withFileReadTransportRetry(() => scoped.download(filePath));
    const bytes = new Uint8Array(await result.content.arrayBuffer());
    const artifact: DocumentOriginalArtifact = { role, ...rule, bucketId: scope.bucketId, filePath,
      providerObjectId: metadata.id, byteLength: bytes.length, sha256: digest(bytes), readback: 'VERIFIED' };
    assertDescriptor(scope, artifact); assertMetadata(metadata, artifact); assertMetadata(result.metadata, artifact);
    return { artifact, bytes };
  }

  async load(scope: DocumentOriginalStoreScope, artifact: DocumentOriginalArtifact, expected: DocumentOriginalBinding) {
    if (artifact.role !== 'MANIFEST' || artifact.readback !== 'VERIFIED') throw new Error('DOCUMENT_ORIGINAL_MANIFEST_REQUIRED');
    const bundle: DocumentOriginalBundle = JSON.parse(Buffer.from(await this.read(scope, artifact)).toString('utf8'));
    if (bundle.schemaVersion !== 'wiselink.document.bundle.v1') throw new Error('DOCUMENT_ORIGINAL_BUNDLE_INVALID');
    documentOriginalStructuredSource(bundle.original, expected);
    if (bundle.rawMarkdown.role !== 'RAW_MARKDOWN' || bundle.rawMarkdown.readback !== 'VERIFIED')
      throw new Error('DOCUMENT_ORIGINAL_RAW_REQUIRED');
    // The original manifest is version-bound and its raw descriptor remains immutable.
    await this.read(scope, bundle.rawMarkdown);
    if (!Array.isArray(bundle.rawPdfArtifacts) || !bundle.rawPdfArtifacts.length) throw new Error('DOCUMENT_ORIGINAL_RAW_PAGES_REQUIRED');
    for (const descriptor of bundle.rawPdfArtifacts) {
      if (descriptor.role !== 'MANIFEST' || !/^original\/pages-[0-9]+\.json$/.test(descriptor.relativePath) || descriptor.readback !== 'VERIFIED')
        throw new Error('DOCUMENT_ORIGINAL_RAW_PAGES_INVALID');
      await this.read(scope, descriptor);
    }
    return bundle;
  }
}
function prefix(scope: DocumentOriginalStoreScope) {
  if (![scope.documentVersionId, scope.parseRunId].every(value => /^[A-Za-z0-9_-]{1,160}$/.test(value)) || !scope.bucketId.trim())
    throw new Error('DOCUMENT_ORIGINAL_STORAGE_SCOPE_INVALID');
  return `wiselink/parsed/${scope.documentVersionId}/${scope.parseRunId}/`;
}
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function assertDescriptor(scope: DocumentOriginalStoreScope, artifact: DocumentOriginalArtifact) {
  const rule = entry(artifact.role, artifact.relativePath);
  if (!rule || artifact.relativePath !== rule.relativePath || artifact.mediaType !== rule.mediaType ||
      artifact.bucketId !== scope.bucketId || artifact.filePath !== prefix(scope) + rule.relativePath ||
      !artifact.providerObjectId || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 1 ||
      artifact.byteLength > 64 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(artifact.sha256))
    throw new Error('DOCUMENT_ORIGINAL_DESCRIPTOR_INVALID');
}
function assertMetadata(metadata: FileMeta | null, artifact: DocumentOriginalArtifact) {
  if (!metadata || metadata.id !== artifact.providerObjectId || metadata.bucketID !== artifact.bucketId ||
      metadata.filePath.replace(/^\/+/, '') !== artifact.filePath || Number(metadata.metadata?.contentLength) !== artifact.byteLength ||
      metadata.metadata?.mimeType !== artifact.mediaType) throw new Error('DOCUMENT_ORIGINAL_METADATA_MISMATCH');
}
async function optionalMetadata(read: () => Promise<FileMeta | null>) {
  try { return await withFileReadTransportRetry(read); }
  catch (error) {
    const reason = error as { status?: number; statusCode?: number; response?: { status?: number } };
    if ([reason?.status, reason?.statusCode, reason?.response?.status].includes(404)) return null;
    throw error;
  }
}

function entry(role: DocumentOriginalArtifact['role'], relativePath?: string) {
  const rule = entries[role];
  if (!rule || (relativePath && relativePath !== rule.relativePath &&
      !(role === 'MANIFEST' && /^original\/pages-[0-9]+\.json$/.test(relativePath))))
    throw new Error('DOCUMENT_ORIGINAL_ARTIFACT_PATH_INVALID');
  return { ...rule, relativePath: relativePath ?? rule.relativePath };
}
