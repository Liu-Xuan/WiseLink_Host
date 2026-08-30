import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  InMemoryHostedDocumentCatalog,
  LocalMiaodaFileServiceDouble,
} from '../support/document-management-hosted-test-support.mjs';

const require = createRequire(import.meta.url);
const {
  ReviewAttachmentService,
} = require('../../dist/server/modules/review-persistence/review-attachment.service.js');
const {
  DocumentManagementHostedService,
} = require('../../dist/server/modules/document-management/src/hosted/nest/document-management-hosted.service.js');
const {
  OrdinaryDocumentManagementAuthorizer,
} = require('../../dist/server/modules/document-management-runtime/ordinary-document-management-authorizer.js');
const {
  parseReviewAttachmentParsedArtifact,
} = require('../../dist/server/modules/review-persistence/review-attachment-artifact.js');
const {
  MiaodaFileServiceArtifactStore,
} = require('../../dist/server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js');
const {
  classifyImmutableSourceReuseState,
  classifyReviewAttachmentResidualReuseState,
} = require('../../dist/server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.js');
const {
  buildGovernedDocumentIngressPreflightDecision,
} = require('../../dist/server/modules/document-management/src/migrated/ingress/documentIngressPreflight.js');
const {
  normalizeUploadDescriptor,
} = require('../../dist/server/modules/document-management/src/migrated/ingress/uploadDescriptor.js');
const {
  deterministicId,
  sha256Hex,
} = require('../../dist/server/modules/document-management/src/runtime/valueTools.js');

const REVIEW_ATTACHMENT_SOURCE_CHANNEL =
  'canonical_review_attachment_selection';

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
  const fileService = new LocalMiaodaFileServiceDouble({
    defaultBucketId: bucketId,
    defaultCreatedBy: 'actor-C7',
  });
  fileService.seed({
    bucketId,
    filePath: selectionPath,
    bytes: pdfBytes,
    fileName: 'engineering-note.pdf',
    contentType: 'application/pdf',
  });
  const catalog = new InMemoryHostedDocumentCatalog();
  const documentManagement = new DocumentManagementHostedService(
    fileService,
    catalog,
    new OrdinaryDocumentManagementAuthorizer({}, fileService),
  );
  const documentVersions = {
    resolve: (documentVersionId, options) =>
      catalog.resolveDocumentVersionSource(documentVersionId, options),
  };
  const service = new ReviewAttachmentService(
    fileService,
    documentManagement,
    documentVersions,
  );

  const previousSandboxId = process.env.SANDBOX_ID;
  const previousLocalDev = process.env.MIAODA_LOCAL_DEV;
  process.env.SANDBOX_ID = 'review-attachment-c7-core-catalog';
  delete process.env.MIAODA_LOCAL_DEV;
  let binding;
  let exactReuseBinding;
  let replayBinding;
  try {
    binding = await service.ingest(ingestInput('request-C7'));
    exactReuseBinding = await service.ingest(ingestInput('request-C7-2'));
    replayBinding = await service.ingest(ingestInput('request-C7'));
  } finally {
    restoreProcessEnv('SANDBOX_ID', previousSandboxId);
    restoreProcessEnv('MIAODA_LOCAL_DEV', previousLocalDev);
  }

  assert.equal(binding.documentVersionId, exactReuseBinding.documentVersionId);
  assert.equal(binding.documentVersionId, replayBinding.documentVersionId);
  assert.equal(catalog.versionCount, 1);
  assert.equal(catalog.acquisitionCount, 2);
  assert.equal(catalog.commitCount, 1);
  assert.equal(catalog.exactLinkCount, 1);
  assert.deepEqual(catalog.preflightDecisions, [
    'INGEST_NEW_FAMILY',
    'RESUME_EXISTING_PROCESS',
  ]);
  assert.equal(catalog.firstIncomingIdentity.identityResolved, true);
  assert.equal(
    catalog.firstIncomingIdentity.documentCodeProvenance.source,
    'controlled_metadata',
  );
  assert.equal(
    catalog.firstIncomingIdentity.documentCodeProvenance
      .inspectedContentIdentityMatches,
    true,
  );
  assert.equal(
    catalog.firstIncomingIdentity.originalFilename,
    'engineering-note.pdf',
  );
  assert.equal(binding.byteLength, pdfBytes.byteLength);
  assert.equal(binding.selectionKey, `${bucketId}\n${selectionPath}`);
  const parsed = parseReviewAttachmentParsedArtifact(
    fileService.jsonArtifactBytes(),
  );
  assert.equal(parsed.attachmentRef, binding.attachmentRef);
  assert.equal(parsed.workItemId, 'WI-C7');
  assert.equal(parsed.reviewConversationId, 'RC-C7');
  assert.equal(parsed.pageCount, 1);
  assert.ok(parsed.pages.some((page) => page.text.trim().length > 0));

  function ingestInput(requestId) {
    return {
      selection: { bucketId, filePath: selectionPath },
      requestId,
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
    };
  }
});

test('legacy unresolved Review residual recovers only under exact new-request scope and actual bytes', async () => {
  const bucketId = 'bucket-review-c7-residual';
  const selectionPath = [
    'wiselink/dev-intake',
    '00000000-0000-4000-8000-000000000001',
    'residual-note.pdf',
  ].join('/');
  const pdfBytes = Uint8Array.from(
    readFileSync(
      resolve(
        process.cwd(),
        'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2/fixtures/source/minimal-pdf.pdf',
      ),
    ),
  );
  const fileService = new LocalMiaodaFileServiceDouble({
    defaultBucketId: bucketId,
    defaultCreatedBy: 'actor-C7',
  });
  fileService.seed({
    bucketId,
    filePath: selectionPath,
    bytes: pdfBytes,
    fileName: 'residual-note.pdf',
    contentType: 'application/pdf',
  });
  const artifactStore = new MiaodaFileServiceArtifactStore(fileService);
  const selected = await artifactStore.readSelection({
    bucketId,
    filePath: selectionPath,
  });
  const actualSha256 = sha256Hex(selected.bytes);
  const immutable = await artifactStore.persistImmutableSource({
    bytes: selected.bytes,
    sha256: actualSha256,
    byteLength: selected.byteLength,
    mediaType: 'application/pdf',
  });
  assert.equal(immutable.reusedExisting, false);
  assert.equal(immutable.readbackVerified, true);

  const catalog = new InMemoryHostedDocumentCatalog();
  const documentManagement = new DocumentManagementHostedService(
    fileService,
    catalog,
    new OrdinaryDocumentManagementAuthorizer({}, fileService),
  );
  const previousOrdinarySandboxId = process.env.SANDBOX_ID;
  const previousOrdinaryLocalDev = process.env.MIAODA_LOCAL_DEV;
  process.env.SANDBOX_ID = 'review-attachment-ordinary-companion';
  delete process.env.MIAODA_LOCAL_DEV;
  let ordinaryBinding;
  try {
    ordinaryBinding = await documentManagement.ingestFileServiceSelection(
      {
        selection: { bucketId, filePath: selectionPath },
        sourceChannel: 'canonical_miaoda_document_selection',
        sourceRef: 'ordinary:completed-lineage',
        idempotencyKey: 'ordinary:completed-lineage',
        descriptor: {
          documentCode: 'ORDINARY-RESIDUAL-COMPANION',
          documentFamily: 'OEM_REFERENCE',
          issuer: 'BOEING',
          businessRevision: '1',
          revisionDate: '2026-08-27',
          sourceGeneratedDate: '2026-08-27',
          documentCodeProvenance: {
            schemaVersion: 'wiselink.document_code_provenance.v1',
            source: 'controlled_metadata',
            candidates: ['ORDINARY-RESIDUAL-COMPANION'],
            inspectedSha256: actualSha256,
            conflict: false,
          },
        },
      },
      {
        actorUserId: 'actor-C7',
        tenantId: 'tenant-C7',
        roles: ['wiselink_development'],
        appId: 'app_17bzc551rsg',
        env: 'preview',
      },
    );
  } finally {
    restoreProcessEnv('SANDBOX_ID', previousOrdinarySandboxId);
    restoreProcessEnv('MIAODA_LOCAL_DEV', previousOrdinaryLocalDev);
  }
  assert.equal(catalog.versionCount, 1);
  assert.equal(catalog.acquisitionCount, 1);
  assert.equal(catalog.commitCount, 1);

  const legacyRequestRef = 'legacy-request-C7';
  const legacySourceRef = `ATTACHMENT:RC-C7:${legacyRequestRef}`;
  const legacyIdempotencyKey =
    `review-attachment:RC-C7:${legacyRequestRef}`;
  const sourceArtifactId = deterministicId(
    'source_artifact',
    actualSha256,
    selected.byteLength,
  );
  const legacyAcquisitionId = deterministicId(
    'acquisition',
    'tenant-C7',
    legacyIdempotencyKey,
  );
  const legacyDocumentCode =
    `REVIEW-RC-C7-${legacyRequestRef}`.toUpperCase();
  const legacyDescriptor = {
    documentCode: legacyDocumentCode,
    documentFamily: 'OEM_REFERENCE',
    businessRevision: '1',
    revisionDate: '2026-08-27',
    sourceGeneratedDate: '2026-08-27',
    sourceKind: REVIEW_ATTACHMENT_SOURCE_CHANNEL,
    originalFilename: selected.fileName,
    mediaType: 'application/pdf',
    sha256: actualSha256,
    sizeBytes: selected.byteLength,
    sourceStorageKey: `${immutable.bucketId}:${immutable.filePath}`,
    providerUpdatedAt: selected.providerUpdatedAt,
  };
  const legacyNormalizedDescriptor =
    normalizeUploadDescriptor(legacyDescriptor);
  const legacyDecision = buildGovernedDocumentIngressPreflightDecision({
    generatedAt: '2026-08-27T00:00:00.000Z',
    documents: [],
    rawDescriptor: legacyDescriptor,
    normalizedDescriptor: legacyNormalizedDescriptor,
  });
  assert.equal(legacyDecision.decision, 'DOCUMENT_IDENTITY_UNRESOLVED');
  assert.equal(legacyDecision.branch, 'REVIEW');
  assert.equal(legacyDecision.requiresUserConfirmation, true);
  assert.equal(legacyDecision.incoming.identityResolved, false);
  assert.ok(
    legacyDecision.incoming.identityIssues.includes(
      'DOCUMENT_CODE_PROVENANCE_UNVERIFIED',
    ),
  );
  const legacyPreflightId = deterministicId(
    'preflight',
    legacyAcquisitionId,
    legacyDecision.decision,
    0,
    'none',
  );
  catalog.seedReviewScope({
    reviewConversationId: 'RC-C7',
    tenantId: 'tenant-C7',
    actorUserId: 'actor-C7',
    workItemId: 'WI-C7',
    revision: 7,
    sourceArtifactId,
    documentId: ordinaryBinding.documentId,
    documentVersionId: ordinaryBinding.documentVersionId,
  });
  catalog.seedActionAttempt({
    attemptId: 'ATTEMPT-ORDINARY-C7',
    workItemId: 'WI-C7',
  });
  catalog.seedLegacyReviewResidual({
    sourceArtifact: {
      sourceArtifactId,
      sha256: actualSha256,
      byteLength: selected.byteLength,
      mediaType: 'application/pdf',
      bucketId: immutable.bucketId,
      filePath: immutable.filePath,
      providerObjectId: immutable.providerObjectId,
      providerVersionId: immutable.providerVersionId,
      readbackVerified: true,
      createdAt: '2026-08-27T00:00:00.000Z',
    },
    acquisition: {
      acquisitionId: legacyAcquisitionId,
      sourceArtifactId,
      documentVersionId: null,
      sourceChannel: REVIEW_ATTACHMENT_SOURCE_CHANNEL,
      sourceRef: legacySourceRef,
      selectionBucketId: selected.bucketId,
      selectionFilePath: selected.filePath,
      providerObjectId: selected.providerObjectId,
      providerVersionId: selected.providerVersionId,
      acquiredBy: 'actor-C7',
      acquiredAt: '2026-08-27T00:00:00.000Z',
      idempotencyKey: legacyIdempotencyKey,
      sourceDescriptor: legacyDescriptor,
      status: 'ACQUIRED_READBACK_VERIFIED',
    },
    preflight: {
      preflightId: legacyPreflightId,
      acquisitionId: legacyAcquisitionId,
      decision: legacyDecision.decision,
      branch: legacyDecision.branch,
      executionAuthorized: false,
      observedCurrentGeneration: 0,
      observedCurrentDocumentVersionId: null,
      normalizedDescriptor: legacyNormalizedDescriptor,
      decisionPayload: legacyDecision,
      status: 'READY',
      documentVersionId: null,
      commitIdempotencyKey: null,
      createdAt: '2026-08-27T00:00:00.000Z',
    },
  });

  const newRequestRef = 'new-request-C7';
  const newIdempotencyKey = `review-attachment:RC-C7:${newRequestRef}`;
  const reuseInput = {
    sourceArtifactId,
    acquisitionId: deterministicId(
      'acquisition',
      'tenant-C7',
      newIdempotencyKey,
    ),
    idempotencyKey: newIdempotencyKey,
    sha256: actualSha256,
    byteLength: selected.byteLength,
    mediaType: 'application/pdf',
    bucketId: immutable.bucketId,
    filePath: immutable.filePath,
    providerObjectId: immutable.providerObjectId,
    providerVersionId: immutable.providerVersionId,
  };
  const residualState = catalog.residualClassificationState();
  assert.throws(
    () => classifyImmutableSourceReuseState(reuseInput, residualState),
    (error) => error?.code === 'IMMUTABLE_SOURCE_REUSE_DB_PARTIAL',
  );
  const serverBoundReviewAttachmentScope = {
    sourceChannel: REVIEW_ATTACHMENT_SOURCE_CHANNEL,
    reviewConversationId: 'RC-C7',
    requestRef: newRequestRef,
    actorUserId: 'actor-C7',
    tenantId: 'tenant-C7',
    workItemId: 'WI-C7',
    expectedRevision: 7,
  };
  assert.equal(
    classifyReviewAttachmentResidualReuseState(
      { ...reuseInput, serverBoundReviewAttachmentScope },
      residualState,
    ).disposition,
    'REVIEW_ATTACHMENT_RESIDUAL_RECOVERY_ALLOWED',
  );
  assert.throws(
    () => classifyReviewAttachmentResidualReuseState(
      {
        ...reuseInput,
        serverBoundReviewAttachmentScope: {
          ...serverBoundReviewAttachmentScope,
          tenantId: 'tenant-other',
        },
      },
      residualState,
    ),
    (error) => error?.code === 'REVIEW_ATTACHMENT_RESIDUAL_SCOPE_CONFLICT',
  );
  assert.throws(
    () => classifyReviewAttachmentResidualReuseState(
      {
        ...reuseInput,
        serverBoundReviewAttachmentScope: {
          ...serverBoundReviewAttachmentScope,
          workItemId: 'WI-OTHER',
        },
      },
      residualState,
    ),
    (error) => error?.code === 'REVIEW_ATTACHMENT_RESIDUAL_SCOPE_CONFLICT',
  );
  assert.throws(
    () => classifyReviewAttachmentResidualReuseState(
      { ...reuseInput, serverBoundReviewAttachmentScope },
      {
        ...residualState,
        versions: [
          ...residualState.versions,
          {
            sourceArtifactId,
            acquisitionId: legacyAcquisitionId,
            documentVersionId: 'DV-RESIDUAL-C7',
          },
        ],
      },
    ),
    (error) =>
      error?.code === 'REVIEW_ATTACHMENT_RESIDUAL_DOWNSTREAM_PRESENT',
  );
  assert.throws(
    () => classifyReviewAttachmentResidualReuseState(
      { ...reuseInput, serverBoundReviewAttachmentScope },
      {
        ...residualState,
        currentness: [{ preflightId: legacyPreflightId }],
      },
    ),
    (error) =>
      error?.code === 'REVIEW_ATTACHMENT_RESIDUAL_DOWNSTREAM_PRESENT',
  );
  assert.throws(
    () => classifyReviewAttachmentResidualReuseState(
      { ...reuseInput, serverBoundReviewAttachmentScope },
      {
        ...residualState,
        downstreamWorkItems: [
          ...residualState.downstreamWorkItems,
          {
            workItemId: 'WI-DOWNSTREAM',
            sourceArtifactId,
            documentId: 'DOCUMENT-DOWNSTREAM',
            documentVersionId: 'DV-DOWNSTREAM',
          },
        ],
      },
    ),
    (error) =>
      error?.code === 'REVIEW_ATTACHMENT_RESIDUAL_DOWNSTREAM_PRESENT',
  );
  assert.throws(
    () => classifyReviewAttachmentResidualReuseState(
      { ...reuseInput, serverBoundReviewAttachmentScope },
      {
        ...residualState,
        actionAttempts: [
          ...residualState.actionAttempts,
          {
            attemptId: 'ATTEMPT-UNPROVEN-C7',
            workItemId: 'WI-DOWNSTREAM',
            documentVersionId: ordinaryBinding.documentVersionId,
          },
        ],
      },
    ),
    (error) =>
      error?.code === 'REVIEW_ATTACHMENT_RESIDUAL_DOWNSTREAM_PRESENT',
  );
  const ordinaryAcquisition = residualState.acquisitions.find(
    (row) => row.acquisitionId !== legacyAcquisitionId,
  );
  assert.ok(ordinaryAcquisition);
  assert.throws(
    () => classifyReviewAttachmentResidualReuseState(
      { ...reuseInput, serverBoundReviewAttachmentScope },
      {
        ...residualState,
        acquisitions: residualState.acquisitions.map((row) =>
          row.acquisitionId === ordinaryAcquisition.acquisitionId
            ? {
                ...row,
                documentVersionId: null,
                status: 'ACQUIRED_READBACK_VERIFIED',
              }
            : row,
        ),
        preflights: residualState.preflights.map((row) =>
          row.acquisitionId === ordinaryAcquisition.acquisitionId
            ? { ...row, documentVersionId: null, status: 'READY' }
            : row,
        ),
        versions: [],
      },
    ),
    (error) => error?.code === 'IMMUTABLE_SOURCE_REUSE_DB_PARTIAL',
  );

  const service = new ReviewAttachmentService(
    fileService,
    documentManagement,
    {
      resolve: (documentVersionId, options) =>
        catalog.resolveDocumentVersionSource(documentVersionId, options),
    },
  );
  const previousSandboxId = process.env.SANDBOX_ID;
  const previousLocalDev = process.env.MIAODA_LOCAL_DEV;
  process.env.SANDBOX_ID = 'review-attachment-c7-residual-core-catalog';
  delete process.env.MIAODA_LOCAL_DEV;
  let binding;
  let safeReuseBinding;
  try {
    binding = await service.ingest({
      selection: { bucketId, filePath: selectionPath },
      requestId: newRequestRef,
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
        authorizationFingerprint: `sha256:${'b'.repeat(64)}`,
      },
    });
    safeReuseBinding = await service.ingest({
      selection: { bucketId, filePath: selectionPath },
      requestId: 'safe-reuse-request-C7',
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
        authorizationFingerprint: `sha256:${'c'.repeat(64)}`,
      },
    });
  } finally {
    restoreProcessEnv('SANDBOX_ID', previousSandboxId);
    restoreProcessEnv('MIAODA_LOCAL_DEV', previousLocalDev);
  }

  assert.equal(catalog.versionCount, 1);
  assert.equal(binding.documentVersionId, ordinaryBinding.documentVersionId);
  assert.equal(binding.documentVersionId, safeReuseBinding.documentVersionId);
  assert.equal(catalog.acquisitionCount, 4);
  assert.equal(catalog.legacyResidualCount, 1);
  assert.equal(catalog.commitCount, 1);
  assert.equal(catalog.exactLinkCount, 2);
  const source = await catalog.resolveDocumentVersionSource(
    binding.documentVersionId,
    { expectedCreatorUserId: 'actor-C7' },
  );
  const actualReadback = await artifactStore.readSelection({
    bucketId: source.artifact.bucketId,
    filePath: source.artifact.filePath,
  });
  assert.equal(actualReadback.sha256, actualSha256);
  assert.equal(actualReadback.byteLength, pdfBytes.byteLength);
  assert.deepEqual(actualReadback.bytes, Buffer.from(pdfBytes));
});


function restoreProcessEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
