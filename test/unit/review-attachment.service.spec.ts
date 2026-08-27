import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

jest.mock(
  '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  () => ({ MiaodaFileServiceArtifactStore: jest.fn() }),
);

import { ReviewAttachmentService } from '../../server/modules/review-persistence/review-attachment.service';
import { parseReviewAttachmentParsedArtifact } from '../../server/modules/review-persistence/review-attachment-artifact';
import { MiaodaFileServiceArtifactStore } from '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js';

interface StoredFile {
  id: string;
  bytes: Uint8Array;
  name: string;
  mimeType: string;
}

describe('ReviewAttachmentService official FileService path', () => {
  it('ingests through DM, rereads the immutable source actual bytes, parses the PDF and persists parsed readback', async () => {
    const bucketId = 'bucket-review';
    const selectionPath = 'official-selection/engineering-note.pdf';
    const pdfBytes = Uint8Array.from(
      readFileSync(
        resolve(
          __dirname,
          '../../server/runtime-assets/technical-publication-parsed-package/v1-frozen-2/fixtures/source/minimal-pdf.pdf',
        ),
      ),
    );
    const scoped = new LocalScopedFileService(bucketId);
    scoped.seed(
      selectionPath,
      pdfBytes,
      'engineering-note.pdf',
      'application/pdf',
    );
    jest.mocked(MiaodaFileServiceArtifactStore).mockImplementationOnce(
      () =>
        ({
          readSelection: async () => ({
            bytes: pdfBytes,
            byteLength: pdfBytes.byteLength,
            sha256: digest(pdfBytes),
          }),
        }) as never,
    );
    const fileService = {
      getDefaultBucket: async () => bucketId,
      from: (requestedBucketId: string) => {
        if (requestedBucketId !== bucketId) throw new Error('BUCKET_DRIFT');
        return scoped;
      },
    };
    const documentManagement = {
      ingestReviewAttachmentSelection: jest.fn(async () => ({
        documentVersionId: 'DV-ATTACHMENT-1',
      })),
    };
    const documentVersions = {
      resolve: jest.fn(async () => ({
        artifact: {
          bucketId,
          filePath: selectionPath,
          sha256: digest(pdfBytes),
          byteLength: pdfBytes.byteLength,
        },
        version: {
          byteLength: pdfBytes.byteLength,
          originalFilename: 'engineering-note.pdf',
        },
      })),
    };
    const service = new ReviewAttachmentService(
      fileService as never,
      documentManagement as never,
      documentVersions as never,
      {
        extractLayout: () => ({
          pageCount: 1,
          textRuns: [
            { page: 1, text: 'Actual selected PDF engineering text.' },
          ],
        }),
      } as never,
    );
    const sessionActor = {
      canonicalSubject: { id: 'actor-1' },
      tenantId: 'tenant-1',
      applicationScopeId: 'app_17bzc551rsg',
      platformRoles: [],
      env: 'preview',
      identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      sessionProvenance: 'SERVER_OPAQUE_SESSION',
    };
    const conversation = {
      reviewConversationId: 'RC-1',
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      workItemId: 'WI-1',
    };
    const grant = {
      allowed: true,
      action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
      workItemId: 'WI-1',
      workItemRevision: 7,
      tenantId: 'tenant-1',
      actorUserId: 'actor-1',
      authorizationFingerprint: `sha256:${'a'.repeat(64)}`,
    };

    const binding = await service.ingest({
      selection: { bucketId, filePath: selectionPath },
      requestId: 'request-1',
      conversation: conversation as never,
      session: { actor: sessionActor } as never,
      grant: grant as never,
    });

    expect(
      documentManagement.ingestReviewAttachmentSelection,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { bucketId, filePath: selectionPath },
        sourceChannel: 'canonical_review_attachment_selection',
      }),
      expect.objectContaining({
        runtimeIngestAuthority: expect.objectContaining({
          mode: 'HOSTED_OAUTH_SESSION_REVIEW_ATTACHMENT',
          workItemId: 'WI-1',
          expectedRevision: 7,
        }),
      }),
    );
    expect(documentVersions.resolve).toHaveBeenCalledWith('DV-ATTACHMENT-1', {
      expectedCreatorUserId: 'actor-1',
    });
    expect(binding).toMatchObject({
      documentVersionId: 'DV-ATTACHMENT-1',
      fileName: 'engineering-note.pdf',
      mediaType: 'application/pdf',
      byteLength: pdfBytes.byteLength,
      selectionKey: `${bucketId}\n${selectionPath}`,
    });
    const parsedBytes = scoped.latestJsonBytes();
    const parsed = parseReviewAttachmentParsedArtifact(parsedBytes);
    expect(parsed).toMatchObject({
      attachmentRef: binding.attachmentRef,
      workItemId: 'WI-1',
      reviewConversationId: 'RC-1',
      documentVersionId: 'DV-ATTACHMENT-1',
      fileName: 'engineering-note.pdf',
    });
    expect(parsed.pageCount).toBeGreaterThan(0);
  });
});

class LocalScopedFileService {
  private readonly files = new Map<string, StoredFile>();
  private uploadCount = 0;

  constructor(private readonly bucketId: string) {}

  seed(path: string, bytes: Uint8Array, name: string, mimeType: string): void {
    this.files.set(canonicalPath(path), {
      id: `seed-${this.files.size + 1}`,
      bytes: Uint8Array.from(bytes),
      name,
      mimeType,
    });
  }

  async getFileMetadata(path: string) {
    const stored = this.files.get(canonicalPath(path));
    if (!stored) return null;
    return metadata(this.bucketId, path, stored);
  }

  async upload(
    bytes: Uint8Array,
    options: {
      filePath: string;
      fileName: string;
      contentType: string;
      upsert: boolean;
    },
  ) {
    if (options.upsert) throw new Error('UPSERT_NOT_ALLOWED');
    this.uploadCount += 1;
    const stored: StoredFile = {
      id: `uploaded-${this.uploadCount}`,
      bytes: Uint8Array.from(bytes),
      name: options.fileName,
      mimeType: options.contentType,
    };
    this.files.set(canonicalPath(options.filePath), stored);
    return metadata(this.bucketId, options.filePath, stored);
  }

  async download(path: string) {
    const stored = this.files.get(canonicalPath(path));
    if (!stored) throw new Error('FILE_NOT_FOUND');
    return {
      content: Uint8Array.from(stored.bytes),
      metadata: metadata(this.bucketId, path, stored),
    };
  }

  latestJsonBytes(): Uint8Array {
    const selected = [...this.files.values()].find(
      (stored) => stored.mimeType === 'application/json',
    );
    if (!selected) throw new Error('PARSED_ARTIFACT_NOT_FOUND');
    return Uint8Array.from(selected.bytes);
  }
}

function metadata(bucketId: string, path: string, stored: StoredFile) {
  return {
    id: stored.id,
    bucketID: bucketId,
    filePath: `/${canonicalPath(path)}`,
    name: stored.name,
    updatedAt: '2026-08-27T00:00:00.000Z',
    metadata: {
      contentLength: String(stored.bytes.byteLength),
      mimeType: stored.mimeType,
    },
  };
}

function canonicalPath(value: string): string {
  return value.replace(/^\/+/, '');
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
