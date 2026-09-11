import { createHash } from 'node:crypto';
import type { FileService } from '@lark-apaas/fullstack-nestjs-core';
import type { FileMeta } from '@lark-apaas/file-service';
import { withFileReadTransportRetry } from '../../unified-reader/file-service-read-transport';
import { readMineruArtifacts, safeMineruAssetPath } from './mineru-artifacts';
import type { MineruRunner } from './mineru-runner';

export type MineruParseResult = Awaited<ReturnType<MineruRunner['parse']>>;
export type MineruArtifactRole =
  | 'RAW_MARKDOWN'
  | 'RAW_CONTENT_LIST_V2'
  | 'RAW_MIDDLE'
  | 'READING_MARKDOWN'
  | 'READING_CONTENT_LIST_V2'
  | 'READING_MIDDLE'
  | 'IMAGE'
  | 'MANIFEST';

/** Trusted Host scope. The caller checks ownership and pins the bucket in its parse-run record. */
export interface MineruStorageScope {
  documentVersionId: string;
  parseRunId: string;
  bucketId: string;
}
/** Fields from the existing dm_document_version record, resolved and authorized by Host. */
export interface MineruDocumentVersionBinding {
  documentVersionId: string;
  documentId: string;
  familyId: string;
  sourceArtifactId: string;
  pdfSha256: string;
  byteLength: number;
}
export interface MineruStoredArtifact {
  role: MineruArtifactRole;
  relativePath: string;
  bucketId: string;
  filePath: string;
  providerObjectId: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  readback: 'UPLOADED' | 'VERIFIED';
}
export interface MineruStoredManifest {
  schemaVersion: 'wiselink.mineru.bundle.v1';
  documentVersionId: string;
  parseRunId: string;
  documentId: string;
  familyId: string;
  sourceArtifactId: string;
  sourceSha256: string;
  sourceByteLength: number;
  parser: { name: 'MinerU'; version: string; backend: string };
  titleEnhancement: MineruParseResult['titleEnhancement'];
  artifacts: MineruStoredArtifact[];
  /** The source Markdown image path maps to an immutable descriptor, never a public URL. */
  images: Record<string, MineruStoredArtifact>;
}
interface PlannedArtifact {
  role: MineruArtifactRole;
  relativePath: string;
  mediaType: string;
  bytes: Uint8Array;
}
export class MineruPersistenceError extends Error {
  constructor(
    readonly progress: MineruStoredArtifact[],
    /** An upload may have succeeded without returning. Reconcile this exact object before retrying. */
    readonly pendingObject: { bucketId: string; filePath: string } | null,
    readonly cause: unknown,
  ) {
    super('MINERU_ARTIFACT_PERSIST_FAILED');
  }
}

/** FileService bytes only: no business authorization, database publication or file deletion. */
export class MineruArtifactStore {
  constructor(private readonly files: Pick<FileService, 'from'>) {}

  async persist(input: {
    scope: MineruStorageScope;
    result: MineruParseResult;
    documentVersion: MineruDocumentVersionBinding;
    /** Host may durably record each upload/readback; callback failures stop further writes. */
    onProgress?: (artifact: MineruStoredArtifact) => Promise<void>;
  }): Promise<{
    manifest: MineruStoredManifest;
    manifestArtifact: MineruStoredArtifact;
  }> {
    const scope = { ...input.scope };
    const prefix = scopePrefix(scope);
    const documentVersion = { ...input.documentVersion };
    if (
      documentVersion.documentVersionId !== scope.documentVersionId ||
      documentVersion.pdfSha256 !== input.result.sourceSha256 ||
      documentVersion.byteLength !== input.result.sourceByteLength ||
      ![
        documentVersion.documentId,
        documentVersion.familyId,
        documentVersion.sourceArtifactId,
      ].every((id) => /^[A-Za-z0-9_-]{1,96}$/.test(id))
    )
      throw new Error('MINERU_DOCUMENT_VERSION_BINDING_MISMATCH');
    // Snapshot every byte before the first await; caller mutation cannot change an in-flight run.
    const plan = planArtifacts(input.result);
    const source = {
      documentId: documentVersion.documentId,
      familyId: documentVersion.familyId,
      sourceArtifactId: documentVersion.sourceArtifactId,
      sourceSha256: input.result.sourceSha256,
      sourceByteLength: input.result.sourceByteLength,
      parser: {
        name: 'MinerU' as const,
        version: input.result.document.version,
        backend: input.result.document.backend,
      },
      titleEnhancement: structuredClone(input.result.titleEnhancement),
    };
    const progress: MineruStoredArtifact[] = [];
    let pendingObject: MineruPersistenceError['pendingObject'] = null;
    const scoped = this.files.from(scope.bucketId);
    const save = async (artifact: PlannedArtifact) => {
      const filePath = `${prefix}${artifact.relativePath}`;
      pendingObject = { bucketId: scope.bucketId, filePath };
      // Reads may retry transport failures; uploads never automatically retry or overwrite.
      const existing = await withFileReadTransportRetry(() =>
        optionalMetadata(() => scoped.getFileMetadata(filePath)),
      );
      const metadata =
        existing ??
        (await scoped.upload(artifact.bytes, {
          filePath,
          fileName: artifact.relativePath.split('/').at(-1),
          contentType: artifact.mediaType,
          upsert: false,
        }));
      // Record the actual object identity even if validation/readback subsequently fails.
      const descriptor: MineruStoredArtifact = {
        role: artifact.role,
        relativePath: artifact.relativePath,
        bucketId: metadata.bucketID,
        filePath: canonicalPath(metadata.filePath),
        providerObjectId: metadata.id,
        mediaType: artifact.mediaType,
        byteLength: artifact.bytes.byteLength,
        sha256: digest(artifact.bytes),
        readback: 'UPLOADED',
      };
      progress.push(descriptor);
      assertDescriptor(scope, descriptor);
      assertMetadata(metadata, descriptor);
      await input.onProgress?.({ ...descriptor });
      const actual = await this.read(scope, descriptor);
      if (!Buffer.from(actual).equals(Buffer.from(artifact.bytes)))
        throw new Error('MINERU_READBACK_BYTES_MISMATCH');
      descriptor.readback = 'VERIFIED';
      await input.onProgress?.({ ...descriptor });
      pendingObject = null;
      return descriptor;
    };
    try {
      for (const artifact of plan) await save(artifact);
      const artifacts = progress.map((artifact) => ({ ...artifact }));
      const manifest: MineruStoredManifest = {
        schemaVersion: 'wiselink.mineru.bundle.v1',
        documentVersionId: scope.documentVersionId,
        parseRunId: scope.parseRunId,
        ...source,
        artifacts,
        images: Object.fromEntries(
          artifacts
            .filter((a) => a.role === 'IMAGE')
            .map((a) => [a.relativePath, a]),
        ),
      };
      const manifestArtifact = await save(
        jsonArtifact('MANIFEST', 'manifest.json', manifest),
      );
      return { manifest, manifestArtifact };
    } catch (cause) {
      throw new MineruPersistenceError(
        progress.map((a) => ({ ...a })),
        pendingObject,
        cause,
      );
    }
  }

  /** Load persisted reading artifacts for DM/library/translation consumers, with no local-file dependency. */
  async loadReading(input: {
    scope: MineruStorageScope;
    documentVersion: MineruDocumentVersionBinding;
    manifestArtifact: MineruStoredArtifact;
  }) {
    const scope = { ...input.scope };
    const documentVersion = { ...input.documentVersion };
    const manifestArtifact = { ...input.manifestArtifact };
    if (
      manifestArtifact.role !== 'MANIFEST' ||
      manifestArtifact.readback !== 'VERIFIED'
    )
      throw new Error('MINERU_PUBLISHED_MANIFEST_REQUIRED');
    const manifest: MineruStoredManifest = JSON.parse(
      Buffer.from(await this.read(scope, manifestArtifact)).toString('utf8'),
    );
    if (
      manifest.schemaVersion !== 'wiselink.mineru.bundle.v1' ||
      manifest.documentVersionId !== scope.documentVersionId ||
      manifest.parseRunId !== scope.parseRunId ||
      documentVersion.documentVersionId !== scope.documentVersionId ||
      manifest.documentId !== documentVersion.documentId ||
      manifest.familyId !== documentVersion.familyId ||
      manifest.sourceArtifactId !== documentVersion.sourceArtifactId ||
      manifest.sourceSha256 !== documentVersion.pdfSha256 ||
      manifest.sourceByteLength !== documentVersion.byteLength ||
      !Array.isArray(manifest.artifacts)
    )
      throw new Error('MINERU_MANIFEST_SOURCE_MISMATCH');
    const paths = new Set<string>();
    for (const artifact of manifest.artifacts) {
      assertDescriptor(scope, artifact);
      if (
        artifact.readback !== 'VERIFIED' ||
        artifact.role === 'MANIFEST' ||
        paths.has(artifact.relativePath)
      )
        throw new Error('MINERU_MANIFEST_ARTIFACT_INVALID');
      paths.add(artifact.relativePath);
    }
    const descriptorFor = (role: MineruArtifactRole) => {
      const matches = manifest.artifacts.filter(
        (artifact) => artifact.role === role,
      );
      if (matches.length !== 1)
        throw new Error('MINERU_MANIFEST_READING_ARTIFACT_MISSING');
      return matches[0];
    };
    const [markdownBytes, v2Bytes, middleBytes] = await Promise.all([
      this.read(scope, descriptorFor('READING_MARKDOWN')),
      this.read(scope, descriptorFor('READING_CONTENT_LIST_V2')),
      this.read(scope, descriptorFor('READING_MIDDLE')),
    ]);
    const images = Object.fromEntries(
      manifest.artifacts
        .filter((a) => a.role === 'IMAGE')
        .map((a) => [a.relativePath, a]),
    );
    const document = readMineruArtifacts({
      markdown: Buffer.from(markdownBytes).toString('utf8'),
      contentListV2: JSON.parse(Buffer.from(v2Bytes).toString('utf8')),
      middle: JSON.parse(Buffer.from(middleBytes).toString('utf8')),
      assetPaths: Object.keys(images),
    });
    if (
      document.version !== manifest.parser.version ||
      document.backend !== manifest.parser.backend
    )
      throw new Error('MINERU_MANIFEST_PARSER_MISMATCH');
    return { manifest, document, images };
  }

  /** Read only a Host-loaded descriptor under its exact document/run/bucket. No fallback bucket lookup. */
  async read(
    scope: MineruStorageScope,
    descriptor: MineruStoredArtifact,
  ): Promise<Uint8Array> {
    scope = { ...scope };
    descriptor = { ...descriptor };
    assertDescriptor(scope, descriptor);
    const scoped = this.files.from(scope.bucketId);
    const metadata = await withFileReadTransportRetry(() =>
      scoped.getFileMetadata(descriptor.filePath),
    );
    assertMetadata(metadata, descriptor);
    const downloaded = await withFileReadTransportRetry(() =>
      scoped.download(descriptor.filePath),
    );
    assertMetadata(downloaded.metadata, descriptor);
    if (downloaded.content.size !== descriptor.byteLength)
      throw new Error('MINERU_READBACK_LENGTH_MISMATCH');
    const bytes = new Uint8Array(await downloaded.content.arrayBuffer());
    if (
      bytes.byteLength !== descriptor.byteLength ||
      digest(bytes) !== descriptor.sha256
    )
      throw new Error('MINERU_READBACK_DIGEST_MISMATCH');
    return bytes;
  }
}

function planArtifacts(result: MineruParseResult): PlannedArtifact[] {
  if (
    !/^[a-f0-9]{64}$/.test(result.sourceSha256) ||
    !Number.isSafeInteger(result.sourceByteLength) ||
    result.sourceByteLength < 1
  )
    throw new Error('MINERU_SOURCE_BINDING_INVALID');
  const plan: PlannedArtifact[] = [
    {
      role: 'RAW_MARKDOWN',
      relativePath: 'raw/document.md',
      mediaType: 'text/markdown',
      bytes: Buffer.from(result.rawArtifacts.markdown),
    },
    jsonArtifact(
      'RAW_CONTENT_LIST_V2',
      'raw/content-list-v2.json',
      result.rawArtifacts.contentListV2,
    ),
    jsonArtifact('RAW_MIDDLE', 'raw/middle.json', result.rawArtifacts.middle),
    {
      role: 'READING_MARKDOWN',
      relativePath: 'reading/document.md',
      mediaType: 'text/markdown',
      bytes: Buffer.from(result.document.markdown),
    },
    jsonArtifact(
      'READING_CONTENT_LIST_V2',
      'reading/content-list-v2.json',
      result.contentListV2,
    ),
    jsonArtifact('READING_MIDDLE', 'reading/middle.json', result.middle),
  ];
  const paths = new Set<string>();
  for (const image of result.assets) {
    const path = safeMineruAssetPath(image.path);
    if (
      paths.has(path) ||
      digest(image.bytes) !== image.sha256 ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(image.mediaType)
    )
      throw new Error('MINERU_ASSET_DESCRIPTOR_INVALID');
    paths.add(path);
    plan.push({
      role: 'IMAGE',
      relativePath: path,
      mediaType: image.mediaType,
      bytes: Uint8Array.from(image.bytes),
    });
  }
  if (
    paths.size > 1024 ||
    plan.some((a) => !a.bytes.length || a.bytes.length > 64 * 1024 * 1024) ||
    plan.reduce((sum, a) => sum + a.bytes.length, 0) > 256 * 1024 * 1024
  )
    throw new Error('MINERU_STORAGE_BUNDLE_TOO_LARGE');
  return plan;
}
function jsonArtifact(
  role: MineruArtifactRole,
  relativePath: string,
  value: unknown,
): PlannedArtifact {
  return {
    role,
    relativePath,
    mediaType: 'application/json',
    bytes: Buffer.from(JSON.stringify(value)),
  };
}
function scopePrefix(scope: MineruStorageScope) {
  if (
    ![scope.documentVersionId, scope.parseRunId].every((id) =>
      /^[A-Za-z0-9_-]{1,160}$/.test(id),
    ) ||
    !scope.bucketId?.trim()
  )
    throw new Error('MINERU_STORAGE_SCOPE_INVALID');
  return `wiselink/parsed/${scope.documentVersionId}/${scope.parseRunId}/`;
}
const PATHS: Partial<Record<MineruArtifactRole, string>> = {
  RAW_MARKDOWN: 'raw/document.md',
  RAW_CONTENT_LIST_V2: 'raw/content-list-v2.json',
  RAW_MIDDLE: 'raw/middle.json',
  READING_MARKDOWN: 'reading/document.md',
  READING_CONTENT_LIST_V2: 'reading/content-list-v2.json',
  READING_MIDDLE: 'reading/middle.json',
  MANIFEST: 'manifest.json',
};
function assertDescriptor(
  scope: MineruStorageScope,
  descriptor: MineruStoredArtifact,
) {
  const path =
    descriptor.role === 'IMAGE'
      ? safeMineruAssetPath(descriptor.relativePath)
      : PATHS[descriptor.role];
  const expectedMedia =
    descriptor.role === 'IMAGE'
      ? ['image/png', 'image/jpeg', 'image/webp']
      : descriptor.role.endsWith('MARKDOWN')
        ? ['text/markdown']
        : ['application/json'];
  if (
    !path ||
    path !== descriptor.relativePath ||
    descriptor.filePath !== `${scopePrefix(scope)}${path}` ||
    descriptor.bucketId !== scope.bucketId ||
    !descriptor.providerObjectId?.trim() ||
    !Number.isSafeInteger(descriptor.byteLength) ||
    descriptor.byteLength < 1 ||
    descriptor.byteLength > 64 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
    !expectedMedia.includes(descriptor.mediaType)
  )
    throw new Error('MINERU_STORED_DESCRIPTOR_INVALID');
}
function assertMetadata(
  metadata: FileMeta | null,
  expected: MineruStoredArtifact,
): asserts metadata is FileMeta {
  if (
    !metadata ||
    metadata.id !== expected.providerObjectId ||
    metadata.bucketID !== expected.bucketId ||
    canonicalPath(metadata.filePath) !== expected.filePath ||
    Number(metadata.metadata?.contentLength) !== expected.byteLength ||
    metadata.metadata?.mimeType !== expected.mediaType
  )
    throw new Error('MINERU_READBACK_METADATA_MISMATCH');
}
function canonicalPath(path: string) {
  return path.replace(/^\/+/, '');
}
function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}
async function optionalMetadata(
  read: () => Promise<FileMeta | null>,
): Promise<FileMeta | null> {
  try {
    return await read();
  } catch (cause) {
    const error = cause as {
      status?: unknown;
      statusCode?: unknown;
      response?: { status?: unknown };
    } | null;
    if (
      [error?.status, error?.statusCode, error?.response?.status].some(
        (status) => Number(status) === 404,
      )
    )
      return null;
    throw cause;
  }
}
