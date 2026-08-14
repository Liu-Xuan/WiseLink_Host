import { Injectable, Logger } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { createHash } from 'node:crypto';

import type { FileServiceP0ProbeResponse } from '@shared/api.interface';

const PROBE_BYTES = Buffer.from(
  '{"probe":"WISELINK_V31_FILESERVICE_P0","schemaVersion":"wiselink.3_1.fileservice_p0_probe.v1"}\n',
  'utf8',
);
const PROBE_SHA256 = createHash('sha256').update(PROBE_BYTES).digest('hex');
const PROBE_PROVIDER_PATH = `validation/fileservice/p0/${PROBE_SHA256}.json`;
const PROBE_CATALOG_PATH = `/${PROBE_PROVIDER_PATH}`;

interface FileMetadata {
  id?: unknown;
  bucketID?: unknown;
  filePath?: unknown;
  metadata?: {
    contentLength?: unknown;
    mimeType?: unknown;
  };
}

interface ProbeErrorDetails {
  stage: string;
  sdkErrorName: string;
  sdkErrorMessage: string;
  responseObserved: boolean;
  httpStatus: number | null;
}

@Injectable()
export class FileServiceP0ProbeService {
  private readonly logger = new Logger(FileServiceP0ProbeService.name);

  constructor(private readonly fileService: FileService) {}

  async run(): Promise<FileServiceP0ProbeResponse> {
    let stage = 'GET_DEFAULT_BUCKET';
    try {
      const bucketId = required(await this.fileService.getDefaultBucket(), 'bucketId');
      const scoped = this.fileService.from(bucketId);
      stage = 'PRECHECK_METADATA';
      const existing = await scoped.getFileMetadata(PROBE_PROVIDER_PATH);
      if (existing) {
        throw statusError(
          'FILESERVICE_P0_PROBE_ALREADY_EXISTS',
          'The fixed P0 validation artifact already exists; the write-once probe is closed.',
          409,
          { filePath: PROBE_CATALOG_PATH },
        );
      }

      stage = 'UPLOAD';
      await scoped.upload(PROBE_BYTES, {
        filePath: PROBE_PROVIDER_PATH,
        fileName: `${PROBE_SHA256}.json`,
        contentType: 'application/json',
        upsert: false,
      });

      stage = 'READBACK_METADATA';
      const metadata = asMetadata(
        await scoped.getFileMetadata(PROBE_PROVIDER_PATH),
        bucketId,
      );
      stage = 'READBACK_BYTES';
      const download = await scoped.download(PROBE_PROVIDER_PATH).asStream();
      const bytes = await readBytes(download.content);
      verifyReadback(metadata, bytes, bucketId);

      return {
        schemaVersion: 'wiselink.3_1.fileservice_p0_probe.v1',
        status: 'PASS',
        stage: 'ACTUAL_BYTE_READBACK_VERIFIED',
        artifact: {
          bucketId,
          filePath: PROBE_CATALOG_PATH,
          providerFilePath: PROBE_PROVIDER_PATH,
          providerObjectId: metadata.providerObjectId,
          sha256: PROBE_SHA256,
          byteLength: bytes.byteLength,
          mediaType: 'application/json',
          readbackVerified: true,
          reusedExisting: false,
        },
        authority: {
          authenticatedActorRequired: true,
          businessWritePerformed: false,
          databaseWritePerformed: false,
          workItemCreated: false,
        },
      };
    } catch (cause: unknown) {
      if (isStatusError(cause)) throw cause;
      const details = errorDetails(cause, stage);
      this.logger.error(
        `FileService P0 probe failed: ${JSON.stringify(details)}\n${errorStack(cause)}`,
      );
      throw statusError(
        'FILESERVICE_P0_PROBE_PROVIDER_FAILED',
        'The hosted FileService P0 probe failed before verified readback.',
        502,
        details,
      );
    }
  }
}

function asMetadata(value: unknown, expectedBucketId: string): {
  providerObjectId: string;
  contentLength: number;
  mimeType: string;
} {
  if (!value || typeof value !== 'object') {
    throw new Error('FILESERVICE_P0_METADATA_MISSING');
  }
  const metadata = value as FileMetadata;
  const providerObjectId = required(metadata.id, 'metadata.id');
  const bucketId = required(metadata.bucketID, 'metadata.bucketID');
  const providerFilePath = canonicalPath(metadata.filePath, 'metadata.filePath');
  const contentLength = Number(metadata.metadata?.contentLength ?? 0);
  const mimeType = required(metadata.metadata?.mimeType, 'metadata.mimeType');
  if (bucketId !== expectedBucketId || providerFilePath !== PROBE_PROVIDER_PATH) {
    throw new Error('FILESERVICE_P0_LOCATOR_DRIFT');
  }
  return { providerObjectId, contentLength, mimeType };
}

function verifyReadback(
  metadata: { contentLength: number; mimeType: string },
  bytes: Buffer,
  bucketId: string,
): void {
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (
    metadata.contentLength !== PROBE_BYTES.byteLength ||
    metadata.mimeType !== 'application/json' ||
    bytes.byteLength !== PROBE_BYTES.byteLength ||
    actualSha256 !== PROBE_SHA256 ||
    !bytes.equals(PROBE_BYTES)
  ) {
    throw statusError(
      'FILESERVICE_P0_PROBE_READBACK_DRIFT',
      'The hosted FileService returned different bytes or metadata.',
      502,
      {
        bucketId,
        filePath: PROBE_CATALOG_PATH,
        expectedByteLength: PROBE_BYTES.byteLength,
        actualByteLength: bytes.byteLength,
        expectedSha256: PROBE_SHA256,
        actualSha256,
        expectedMediaType: 'application/json',
        actualMediaType: metadata.mimeType,
      },
    );
  }
}

async function readBytes(content: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(content)) return Buffer.from(content);
  if (content instanceof ArrayBuffer) return Buffer.from(content);
  if (ArrayBuffer.isView(content)) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  }
  if (content && typeof content === 'object' && 'getReader' in content) {
    const reader = (content as ReadableStream<Uint8Array>).getReader();
    const chunks: Buffer[] = [];
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        chunks.push(Buffer.from(result.value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }
  throw new Error('FILESERVICE_P0_DOWNLOAD_BODY_UNSUPPORTED');
}

function canonicalPath(value: unknown, fieldName: string): string {
  const normalized = required(value, fieldName).replace(/^\/+/, '');
  if (!normalized) throw new Error(`${fieldName} is required.`);
  return normalized;
}

function required(value: unknown, fieldName: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${fieldName} is required.`);
  return normalized;
}

function errorDetails(cause: unknown, stage: string): ProbeErrorDetails {
  const candidate = cause && typeof cause === 'object'
    ? cause as { name?: unknown; message?: unknown; response?: { status?: unknown } }
    : {};
  const status = Number(candidate.response?.status);
  return {
    stage,
    sdkErrorName: typeof candidate.name === 'string' ? candidate.name : 'UnknownError',
    sdkErrorMessage:
      typeof candidate.message === 'string' ? candidate.message : String(cause),
    responseObserved: Number.isInteger(status) && status > 0,
    httpStatus: Number.isInteger(status) && status > 0 ? status : null,
  };
}

function errorStack(value: unknown): string {
  return value instanceof Error ? value.stack ?? value.message : String(value);
}

interface StatusError extends Error {
  code: string;
  statusCode: number;
  details?: unknown;
}

function statusError(
  code: string,
  message: string,
  statusCode: number,
  details?: unknown,
): StatusError {
  return Object.assign(new Error(message), { code, statusCode, details });
}

function isStatusError(value: unknown): value is StatusError {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StatusError>;
  return (
    typeof candidate.code === 'string' &&
    Number.isInteger(candidate.statusCode) &&
    Number(candidate.statusCode) >= 400 &&
    Number(candidate.statusCode) <= 599
  );
}
