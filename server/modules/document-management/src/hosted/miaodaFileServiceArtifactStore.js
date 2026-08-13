import { sha256Hex } from '../runtime/valueTools.js';

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, details });
}
function required(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized) fail('HOSTED_FILE_REFERENCE_INVALID', `${fieldName} is required.`);
  return normalized;
}

// @lark-apaas/file-service removes leading slashes before provider I/O. Keep the
// caller-facing path for Catalog lineage, but compare the provider's canonical
// path so `/123.pdf` and `123.pdf` identify the same exact FileService object.
function providerFilePath(value, fieldName) {
  const normalized = required(value, fieldName).replace(/^\/+/, '');
  if (!normalized) fail('HOSTED_FILE_REFERENCE_INVALID', `${fieldName} is required.`);
  return normalized;
}

async function streamToBuffer(stream, maxBytes) {
  const chunks = [];
  let byteLength = 0;
  if (typeof stream?.getReader === 'function') {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        byteLength += chunk.byteLength;
        if (byteLength > maxBytes) {
          fail('SOURCE_BYTES_TOO_LARGE', `Source exceeds ${maxBytes} bytes.`);
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks);
  }
  if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
    for await (const value of stream) {
      const chunk = Buffer.from(value);
      byteLength += chunk.byteLength;
      if (byteLength > maxBytes) {
        fail('SOURCE_BYTES_TOO_LARGE', `Source exceeds ${maxBytes} bytes.`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  fail('FILESERVICE_DOWNLOAD_UNSUPPORTED', 'FileService returned an unsupported stream body.');
}

async function bodyToBuffer(body, maxBytes) {
  let bytes;
  if (Buffer.isBuffer(body)) {
    bytes = Buffer.from(body);
  } else if (body instanceof ArrayBuffer) {
    bytes = Buffer.from(body);
  } else if (ArrayBuffer.isView(body)) {
    bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  } else if (typeof body?.arrayBuffer === 'function') {
    bytes = Buffer.from(await body.arrayBuffer());
  } else if (typeof body === 'string') {
    bytes = Buffer.from(body);
  } else {
    bytes = await streamToBuffer(body, maxBytes);
  }
  if (bytes.byteLength > maxBytes) {
    fail('SOURCE_BYTES_TOO_LARGE', `Source exceeds ${maxBytes} bytes.`);
  }
  return bytes;
}

function metadataIdentity(metadata, expectedBucketId, expectedFilePath) {
  if (!metadata) fail('FILESERVICE_OBJECT_NOT_FOUND', `File not found: ${expectedFilePath}`);
  const bucketId = required(metadata.bucketID, 'metadata.bucketID');
  const filePath = required(metadata.filePath, 'metadata.filePath');
  const expectedProviderFilePath = providerFilePath(expectedFilePath, 'expectedFilePath');
  const actualProviderFilePath = providerFilePath(filePath, 'metadata.filePath');
  if (bucketId !== expectedBucketId || actualProviderFilePath !== expectedProviderFilePath) {
    fail('FILESERVICE_LOCATOR_DRIFT', 'FileService returned a different bucket or path.', {
      expectedBucketId,
      expectedFilePath,
      expectedProviderFilePath,
      actualBucketId: bucketId,
      actualFilePath: filePath,
      actualProviderFilePath,
    });
  }
  return {
    bucketId,
    filePath: expectedFilePath,
    providerObjectId: required(metadata.id, 'metadata.id'),
    providerVersionId: required(metadata.updatedAt, 'metadata.updatedAt'),
    fileName: required(metadata.name, 'metadata.name'),
    mediaType: String(metadata.metadata?.mimeType || 'application/octet-stream').trim(),
    providerByteLength: Number(metadata.metadata?.contentLength || 0),
  };
}

async function downloadActualBytes(service, locator, maxBytes) {
  const builder = service.download(locator.filePath);
  const result = typeof builder?.asStream === 'function'
    ? await builder.asStream()
    : await builder;
  const downloadMetadata = result?.metadata
    ? metadataIdentity(result.metadata, locator.bucketId, locator.filePath)
    : locator;
  if (
    downloadMetadata.providerObjectId !== locator.providerObjectId
    || downloadMetadata.providerVersionId !== locator.providerVersionId
  ) {
    fail('FILESERVICE_OBJECT_VERSION_DRIFT', 'FileService download resolved another object version.', {
      expectedProviderObjectId: locator.providerObjectId,
      expectedProviderVersionId: locator.providerVersionId,
      actualProviderObjectId: downloadMetadata.providerObjectId,
      actualProviderVersionId: downloadMetadata.providerVersionId,
    });
  }
  const bytes = await bodyToBuffer(result?.content, maxBytes);
  if (
    downloadMetadata.providerByteLength > 0
    && downloadMetadata.providerByteLength !== bytes.byteLength
  ) {
    fail('FILESERVICE_METADATA_LENGTH_MISMATCH', 'FileService metadata does not match actual bytes.', {
      metadataByteLength: downloadMetadata.providerByteLength,
      actualByteLength: bytes.byteLength,
    });
  }
  return { bytes, metadata: downloadMetadata };
}

export class MiaodaFileServiceArtifactStore {
  constructor(fileService, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
    if (!fileService || typeof fileService.from !== 'function') {
      fail('FILESERVICE_NOT_CONFIGURED', 'A host FileService instance is required.');
    }
    this.fileService = fileService;
    this.maxBytes = Number(maxBytes);
  }

  async readSelection(selection = {}) {
    const bucketId = required(selection.bucketId || selection.bucket_id, 'selection.bucketId');
    const filePath = required(selection.filePath || selection.file_path, 'selection.filePath');
    const scoped = this.fileService.from(bucketId);
    const metadata = metadataIdentity(
      await scoped.getFileMetadata(filePath),
      bucketId,
      filePath,
    );
    const readback = await downloadActualBytes(scoped, metadata, this.maxBytes);
    return {
      ...metadata,
      bytes: readback.bytes,
      byteLength: readback.bytes.byteLength,
      sha256: sha256Hex(readback.bytes),
      readbackVerified: true,
    };
  }

  async persistImmutableSource({ bytes, sha256, byteLength, mediaType = 'application/pdf' } = {}) {
    const sourceBytes = await bodyToBuffer(bytes, this.maxBytes);
    const actualSha256 = sha256Hex(sourceBytes);
    if (actualSha256 !== sha256 || sourceBytes.byteLength !== Number(byteLength)) {
      fail('SOURCE_IDENTITY_MISMATCH', 'Requested source identity does not match actual bytes.');
    }
    const bucketId = required(await this.fileService.getDefaultBucket(), 'defaultBucketId');
    const filePath = `/document-management/source/sha256/${sha256.slice(0, 2)}/${sha256}.pdf`;
    const scoped = this.fileService.from(bucketId);
    let metadata = await scoped.getFileMetadata(filePath);
    let reusedExisting = Boolean(metadata);
    if (!metadata) {
      metadata = await scoped.upload(sourceBytes, {
        filePath,
        fileName: `${sha256}.pdf`,
        contentType: mediaType,
        upsert: false,
      });
      reusedExisting = false;
    }
    const identity = metadataIdentity(metadata, bucketId, filePath);
    const readback = await downloadActualBytes(scoped, identity, this.maxBytes);
    const readbackSha256 = sha256Hex(readback.bytes);
    if (
      readbackSha256 !== sha256
      || readback.bytes.byteLength !== sourceBytes.byteLength
      || !readback.bytes.equals(sourceBytes)
    ) {
      fail('ACTUAL_BYTE_READBACK_MISMATCH', 'Immutable FileService readback differs from source bytes.', {
        expectedSha256: sha256,
        actualSha256: readbackSha256,
        expectedByteLength: sourceBytes.byteLength,
        actualByteLength: readback.bytes.byteLength,
      });
    }
    return {
      artifactStoreRole: 'CanonicalArtifactStore',
      storageProvider: 'MIAODA_FILE_SERVICE',
      bucketId,
      filePath,
      providerObjectId: identity.providerObjectId,
      providerVersionId: identity.providerVersionId,
      sha256,
      byteLength: sourceBytes.byteLength,
      mediaType,
      readbackVerified: true,
      reusedExisting,
    };
  }
}
