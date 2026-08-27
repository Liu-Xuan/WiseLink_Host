import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  ReviewAttachmentService,
} = require('../../dist/server/modules/review-persistence/review-attachment.service.js');
const {
  parseReviewAttachmentParsedArtifact,
} = require('../../dist/server/modules/review-persistence/review-attachment-artifact.js');

test('R09 C7 official FileService actual PDF bytes -> DM binding -> parsed artifact readback', async () => {
  const bucketId = 'bucket-review-c7';
  const selectionPath = 'official-selection/engineering-note.pdf';
  const pdfBytes = Uint8Array.from(
    readFileSync(
      resolve(
        process.cwd(),
        'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2/fixtures/source/minimal-pdf.pdf',
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
  const fileService = {
    getDefaultBucket: async () => bucketId,
    from: (requestedBucketId) => {
      assert.equal(requestedBucketId, bucketId);
      return scoped;
    },
  };
  const documentManagement = {
    ingestReviewAttachmentSelection: async (_request, context) => {
      assert.equal(
        context.runtimeIngestAuthority.mode,
        'HOSTED_OAUTH_SESSION_REVIEW_ATTACHMENT',
      );
      assert.equal(context.runtimeIngestAuthority.expectedRevision, 7);
      return { documentVersionId: 'DV-ATTACHMENT-C7' };
    },
  };
  const documentVersions = {
    resolve: async (documentVersionId, options) => {
      assert.equal(documentVersionId, 'DV-ATTACHMENT-C7');
      assert.equal(options.expectedCreatorUserId, 'actor-C7');
      return {
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
      };
    },
  };
  const service = new ReviewAttachmentService(
    fileService,
    documentManagement,
    documentVersions,
  );

  const binding = await service.ingest({
    selection: { bucketId, filePath: selectionPath },
    requestId: 'request-C7',
    conversation: {
      reviewConversationId: 'RC-C7',
      tenantId: 'tenant-C7',
      actorId: 'actor-C7',
      workItemId: 'WI-C7',
    },
    session: {
      actor: {
        canonicalSubject: { id: 'actor-C7' },
        tenantId: 'tenant-C7',
        applicationScopeId: 'app_17bzc551rsg',
        platformRoles: [],
        env: 'preview',
        identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
        sessionProvenance: 'SERVER_OPAQUE_SESSION',
      },
    },
    grant: {
      allowed: true,
      action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
      workItemId: 'WI-C7',
      workItemRevision: 7,
      tenantId: 'tenant-C7',
      actorUserId: 'actor-C7',
      authorizationFingerprint: `sha256:${'a'.repeat(64)}`,
    },
  });

  assert.equal(binding.documentVersionId, 'DV-ATTACHMENT-C7');
  assert.equal(binding.byteLength, pdfBytes.byteLength);
  assert.equal(binding.selectionKey, `${bucketId}\n${selectionPath}`);
  const parsed = parseReviewAttachmentParsedArtifact(
    scoped.jsonArtifactBytes(),
  );
  assert.equal(parsed.attachmentRef, binding.attachmentRef);
  assert.equal(parsed.workItemId, 'WI-C7');
  assert.equal(parsed.reviewConversationId, 'RC-C7');
  assert.equal(parsed.pageCount, 1);
  assert.ok(parsed.pages.some((page) => page.text.trim().length > 0));
});

class LocalScopedFileService {
  #files = new Map();
  #uploadCount = 0;

  constructor(bucketId) {
    this.bucketId = bucketId;
  }

  seed(path, bytes, name, mimeType) {
    this.#files.set(canonicalPath(path), {
      id: `seed-${this.#files.size + 1}`,
      bytes: Uint8Array.from(bytes),
      name,
      mimeType,
      createdBy: 'actor-C7',
    });
  }

  async getFileMetadata(path) {
    const stored = this.#files.get(canonicalPath(path));
    return stored ? metadata(this.bucketId, path, stored) : null;
  }

  async upload(bytes, options) {
    assert.equal(options.upsert, false);
    this.#uploadCount += 1;
    const stored = {
      id: `uploaded-${this.#uploadCount}`,
      bytes: Uint8Array.from(bytes),
      name: options.fileName,
      mimeType: options.contentType,
      createdBy: 'actor-C7',
    };
    this.#files.set(canonicalPath(options.filePath), stored);
    return metadata(this.bucketId, options.filePath, stored);
  }

  async download(path) {
    const stored = this.#files.get(canonicalPath(path));
    if (!stored) throw new Error('FILE_NOT_FOUND');
    return {
      content: Uint8Array.from(stored.bytes),
      metadata: metadata(this.bucketId, path, stored),
    };
  }

  jsonArtifactBytes() {
    const stored = [...this.#files.values()].find(
      (value) => value.mimeType === 'application/json',
    );
    if (!stored) throw new Error('PARSED_ARTIFACT_NOT_FOUND');
    return Uint8Array.from(stored.bytes);
  }
}

function metadata(bucketId, path, stored) {
  return {
    id: stored.id,
    bucketID: bucketId,
    filePath: `/${canonicalPath(path)}`,
    name: stored.name,
    createdBy: { userID: stored.createdBy },
    updatedAt: '2026-08-27T00:00:00.000Z',
    metadata: {
      contentLength: String(stored.bytes.byteLength),
      mimeType: stored.mimeType,
    },
  };
}

function canonicalPath(value) {
  return value.replace(/^\/+/, '');
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
