import type { DocumentParsedReading } from '@shared/document-parsing.interface';
import type { DocumentOriginalChange } from './document-original-change';
import { createHash } from 'node:crypto';
import type { FileService } from '@lark-apaas/fullstack-nestjs-core';
import type { FileMeta } from '@lark-apaas/file-service';
import type { DocumentOriginalArtifact, DocumentOriginalBinding, DocumentOriginalResult } from '@shared/document-original.interface';
import { documentOriginalStructuredSource } from './document-original-adapter';
import { isFileServiceTransportFailure, withFileReadTransportRetry } from '../../../../unified-reader/file-service-read-transport';

export interface DocumentOriginalStoreScope { documentVersionId: string; parseRunId: string; bucketId: string }
export interface DocumentOriginalBundle {
  schemaVersion: 'wiselink.document.bundle.v1';
  original: DocumentOriginalResult;
  rawPdfArtifacts: DocumentOriginalArtifact[];
  change?: DocumentOriginalChange;
  rawMarkdown: DocumentOriginalArtifact;
  rawMineruCandidate?: DocumentOriginalArtifact;
  titleEnhancement?: DocumentParsedReading['titleEnhancement'];
}
const entries = {
  RAW_MARKDOWN: { relativePath: 'raw/document.md', mediaType: 'text/markdown' },
  MANIFEST: { relativePath: 'original/manifest.json', mediaType: 'application/json' },
};
const UPLOAD_RECOVERY_DELAYS_MS = [250, 1000] as const;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

/** FileService recovery uses the exact deterministic object path and verified bytes.
 * Publication and lease checks remain in the parseRun repository, never this store. */
export class DocumentOriginalStore {
  constructor(private readonly files: Pick<FileService, 'from'>) {}

  async save(scope: DocumentOriginalStoreScope, role: DocumentOriginalArtifact['role'], bytes: Uint8Array,
    onProgress: (artifact: DocumentOriginalArtifact) => Promise<void>, relativePath?: string,
    assertActive?: () => Promise<void>): Promise<DocumentOriginalArtifact> {
    const snapshot = new Uint8Array(bytes);
    if (!snapshot.length || snapshot.length > MAX_ARTIFACT_BYTES) throw new Error('DOCUMENT_ORIGINAL_ARTIFACT_SIZE_INVALID');
    const rule = entry(role, relativePath);
    const filePath = prefix(scope) + rule.relativePath;
    const scoped = this.files.from(scope.bucketId);
    let metadata = await optionalMetadata(() => scoped.getFileMetadata(filePath));
    for (let attempt = 0; !metadata; attempt += 1) {
      // A lost response can mean the immutable object was committed. Only a
      // fresh, authoritative absence permits another guarded write.
      if (assertActive) await assertActive();
      try {
        metadata = await scoped.upload(snapshot, { filePath,
          fileName: rule.relativePath.split('/').at(-1), contentType: rule.mediaType, upsert: false });
      } catch (cause) {
        if (!assertActive || !isFileServiceTransportFailure(cause)) throw cause;
        metadata = await optionalMetadata(() => scoped.getFileMetadata(filePath));
        if (metadata) break; // Normal descriptor and exact snapshot readback below.
        const delayMs = UPLOAD_RECOVERY_DELAYS_MS[attempt];
        if (delayMs === undefined) throw cause; // Three total uploads, including the first.
        await new Promise<void>(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      if (!metadata) throw new Error('DOCUMENT_ORIGINAL_METADATA_MISMATCH');
    }
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
    // Download returns the object's metadata alongside its bytes. Validate that
    // receipt rather than issuing a second, earlier metadata request per read.
    return withFileReadTransportRetry(async () => {
      const result = await scoped.download(artifact.filePath).asStream();
      const bytes = await consumeDownload(result.content, artifact.byteLength,
        () => assertMetadata(result.metadata, artifact));
      if (digest(bytes) !== artifact.sha256) throw new Error('DOCUMENT_ORIGINAL_READBACK_DIGEST_MISMATCH');
      return bytes;
    });
  }

  /** Recover a write whose response or DB progress was lost without re-invoking a model. */
  async recover(scope: DocumentOriginalStoreScope, role: DocumentOriginalArtifact['role'], relativePath?: string) {
    const rule = entry(role, relativePath);
    const filePath = prefix(scope) + rule.relativePath;
    const scoped = this.files.from(scope.bucketId);
    const metadata = await optionalMetadata(() => scoped.getFileMetadata(filePath));
    if (!metadata) return null;
    const byteLength = Number(metadata.metadata?.contentLength);
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_ARTIFACT_BYTES)
      throw new Error('DOCUMENT_ORIGINAL_DESCRIPTOR_INVALID');
    const identity = { bucketId: scope.bucketId, filePath, providerObjectId: metadata.id,
      byteLength, mediaType: rule.mediaType };
    if (!identity.providerObjectId) throw new Error('DOCUMENT_ORIGINAL_DESCRIPTOR_INVALID');
    assertMetadata(metadata, identity);
    return withFileReadTransportRetry(async () => {
      const result = await scoped.download(filePath).asStream();
      const bytes = await consumeDownload(result.content, byteLength,
        () => assertMetadata(result.metadata, identity));
      const artifact: DocumentOriginalArtifact = { role, ...rule, bucketId: scope.bucketId, filePath,
        providerObjectId: metadata.id, byteLength, sha256: digest(bytes), readback: 'VERIFIED' };
      assertDescriptor(scope, artifact); assertMetadata(metadata, artifact); assertMetadata(result.metadata, artifact);
      return { artifact, bytes };
    });
  }

  async load(scope: DocumentOriginalStoreScope, artifact: DocumentOriginalArtifact, expected: DocumentOriginalBinding) {
    const bundle = await this.loadForReading(scope, artifact, expected);
    await this.read(scope, bundle.rawMarkdown);
    for (const descriptor of bundle.rawPdfArtifacts) await this.read(scope, descriptor);
    if (bundle.rawMineruCandidate) await this.read(scope, bundle.rawMineruCandidate);
    return bundle;
  }

  /** Read the self-contained, verified manifest after the caller checks publication
   * and authorization. Raw extraction artifacts are audited by load on publication
   * and recovery; they are not consumed to display this saved reading. */
  async loadForReading(scope: DocumentOriginalStoreScope, artifact: DocumentOriginalArtifact, expected: DocumentOriginalBinding) {
    if (artifact.role !== 'MANIFEST' || artifact.readback !== 'VERIFIED') throw new Error('DOCUMENT_ORIGINAL_MANIFEST_REQUIRED');
    const bundle: DocumentOriginalBundle = JSON.parse(Buffer.from(await this.read(scope, artifact)).toString('utf8'));
    if (bundle.schemaVersion !== 'wiselink.document.bundle.v1') throw new Error('DOCUMENT_ORIGINAL_BUNDLE_INVALID');
    documentOriginalStructuredSource(bundle.original, expected);
    if (bundle.rawMarkdown.role !== 'RAW_MARKDOWN' || bundle.rawMarkdown.readback !== 'VERIFIED')
      throw new Error('DOCUMENT_ORIGINAL_RAW_REQUIRED');
    assertDescriptor(scope, bundle.rawMarkdown);
    if (!Array.isArray(bundle.rawPdfArtifacts) || (!bundle.rawPdfArtifacts.length && bundle.original.producer.kind !== 'MINERU_LOCAL')) throw new Error('DOCUMENT_ORIGINAL_RAW_PAGES_REQUIRED');
    for (const descriptor of bundle.rawPdfArtifacts) {
      if (descriptor.role !== 'MANIFEST' || !/^original\/pages-[0-9]+\.json$/.test(descriptor.relativePath) || descriptor.readback !== 'VERIFIED')
        throw new Error('DOCUMENT_ORIGINAL_RAW_PAGES_INVALID');
      assertDescriptor(scope, descriptor);
    }
    if (bundle.original.producer.kind === 'MINERU_LOCAL' || bundle.original.producer.kind === 'MINERU_LOCAL_PDFJS') {
      const candidate = bundle.rawMineruCandidate;
      if (!candidate || candidate.role !== 'MANIFEST' || candidate.relativePath !== 'raw/mineru-candidate.json' || candidate.readback !== 'VERIFIED')
        throw new Error('DOCUMENT_ORIGINAL_MINERU_CANDIDATE_REQUIRED');
      assertDescriptor(scope, candidate);
    } else if (bundle.rawMineruCandidate) throw new Error('DOCUMENT_ORIGINAL_PRODUCER_MISMATCH');
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
      artifact.byteLength > MAX_ARTIFACT_BYTES || !/^[a-f0-9]{64}$/.test(artifact.sha256))
    throw new Error('DOCUMENT_ORIGINAL_DESCRIPTOR_INVALID');
}

/** The SDK Blob builder stops at 50MiB; streaming still retains our exact 64MiB bound. */
async function consumeDownload(content: ReadableStream<Uint8Array>, byteLength: number,
  assertReceipt: () => void): Promise<Uint8Array> {
  const reader = content.getReader();
  try {
    // Hold the reader before receipt checks so every rejection cancels this network stream.
    assertReceipt();
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_ARTIFACT_BYTES)
      throw new Error('DOCUMENT_ORIGINAL_READBACK_SIZE_MISMATCH');
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('DOCUMENT_ORIGINAL_READBACK_BODY_INVALID');
      if (value.byteLength > byteLength - offset) throw new Error('DOCUMENT_ORIGINAL_READBACK_SIZE_MISMATCH');
      bytes.set(value, offset); offset += value.byteLength;
    }
    if (offset !== byteLength) throw new Error('DOCUMENT_ORIGINAL_READBACK_SIZE_MISMATCH');
    return bytes;
  } catch (error) {
    // Cleanup failure must not replace the original transport or guard failure.
    try { await reader.cancel(); } catch { /* preserve the original error */ }
    throw error;
  } finally { reader.releaseLock(); }
}
function assertMetadata(metadata: FileMeta | null, artifact: Pick<DocumentOriginalArtifact,
  'providerObjectId' | 'bucketId' | 'filePath' | 'byteLength' | 'mediaType'>) {
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
      !(role === 'MANIFEST' && (relativePath === 'original/raw-provenance.json' ||
        relativePath === 'raw/mineru-candidate.json' || /^original\/pages-[0-9]+\.json$/.test(relativePath)))))
    throw new Error('DOCUMENT_ORIGINAL_ARTIFACT_PATH_INVALID');
  return { ...rule, relativePath: relativePath ?? rule.relativePath };
}
