import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

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
    scoped.jsonArtifactBytes(),
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
  const selectionPath = 'official-selection/residual-note.pdf';
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
    'residual-note.pdf',
    'application/pdf',
  );
  const fileService = {
    getDefaultBucket: async () => bucketId,
    from: (requestedBucketId) => {
      assert.equal(requestedBucketId, bucketId);
      return scoped;
    },
  };
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
        downstreamWorkItems: [{ workItemId: 'WI-DOWNSTREAM' }],
      },
    ),
    (error) =>
      error?.code === 'REVIEW_ATTACHMENT_RESIDUAL_DOWNSTREAM_PRESENT',
  );

  const documentManagement = new DocumentManagementHostedService(
    fileService,
    catalog,
    new OrdinaryDocumentManagementAuthorizer({}, fileService),
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
  assert.equal(binding.documentVersionId, safeReuseBinding.documentVersionId);
  assert.equal(catalog.acquisitionCount, 3);
  assert.equal(catalog.legacyResidualCount, 1);
  assert.equal(catalog.commitCount, 1);
  assert.equal(catalog.exactLinkCount, 1);
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

class InMemoryHostedDocumentCatalog {
  #sourceArtifacts = new Map();
  #acquisitions = new Map();
  #acquisitionsByIdempotency = new Map();
  #preflights = new Map();
  #families = new Map();
  #documents = new Map();
  #versions = new Map();
  #currentness = [];
  #downstreamWorkItems = [];
  #actionAttempts = [];
  #scopeConversations = new Map();
  #scopeWorkItems = new Map();
  #commitCount = 0;
  #exactLinkCount = 0;

  get versionCount() {
    return this.#versions.size;
  }

  get acquisitionCount() {
    return this.#acquisitions.size;
  }

  get commitCount() {
    return this.#commitCount;
  }

  get exactLinkCount() {
    return this.#exactLinkCount;
  }

  get legacyResidualCount() {
    return [...this.#acquisitions.values()].filter(
      (value) =>
        value.status === 'ACQUIRED_READBACK_VERIFIED'
        && value.documentVersionId === null,
    ).length;
  }

  get preflightDecisions() {
    return [...this.#preflights.values()].map((value) => value.decision);
  }

  get firstIncomingIdentity() {
    return [...this.#preflights.values()][0].decisionPayload.incoming;
  }

  async findIngestionByIdempotency(input) {
    const acquisitionId = this.#acquisitionsByIdempotency.get(
      input.idempotencyKey,
    );
    if (!acquisitionId) return null;
    const acquisition = this.#acquisitions.get(acquisitionId);
    assert.equal(acquisition.sourceChannel, input.sourceChannel);
    assert.equal(acquisition.sourceRef, input.sourceRef);
    assert.equal(acquisition.selectionBucketId, input.selection.bucketId);
    assert.equal(acquisition.selectionFilePath, input.selection.filePath);
    if (!acquisition.documentVersionId) {
      return { status: 'INCOMPLETE', acquisitionId };
    }
    const preflight = [...this.#preflights.values()].find(
      (value) => value.acquisitionId === acquisitionId,
    );
    const version = this.#versions.get(acquisition.documentVersionId);
    const family = this.#families.get(version.familyId);
    return {
      status: 'COMMITTED',
      acquisitionId,
      sourceArtifactId: acquisition.sourceArtifactId,
      preflightId: preflight.preflightId,
      decision: preflight.decision,
      familyId: family.familyId,
      documentId: version.documentId,
      documentVersionId: version.documentVersionId,
      currentGeneration: family.currentGeneration,
      immutableReadbackVerified: true,
    };
  }

  async assertImmutableSourceReuseSafe(input) {
    const state = this.residualClassificationState(input);
    const hasIncompleteState = state.acquisitions.some(
      (row) =>
        !row.documentVersionId
        || ![
          'COMMITTED_CANONICAL',
          'LINKED_EXACT_DOCUMENT_VERSION',
        ].includes(row.status),
    ) || state.preflights.some(
      (row) => row.status !== 'COMMITTED' || !row.documentVersionId,
    );
    if (input.serverBoundReviewAttachmentScope && hasIncompleteState) {
      return classifyReviewAttachmentResidualReuseState(input, state);
    }
    return classifyImmutableSourceReuseState(input, state);
  }

  seedReviewScope({
    reviewConversationId,
    tenantId,
    actorUserId,
    workItemId,
    revision,
  }) {
    this.#scopeConversations.set(reviewConversationId, {
      reviewConversationId,
      tenantId,
      actorId: actorUserId,
      workItemId,
      status: 'ACTIVE',
    });
    this.#scopeWorkItems.set(workItemId, {
      workItemId,
      tenantId,
      requestedByUserId: actorUserId,
      revision,
    });
  }

  seedLegacyReviewResidual({ sourceArtifact, acquisition, preflight }) {
    this.#sourceArtifacts.set(sourceArtifact.sourceArtifactId, sourceArtifact);
    this.#acquisitions.set(acquisition.acquisitionId, {
      ...acquisition,
      sourceDescriptorJson: JSON.stringify(acquisition.sourceDescriptor),
    });
    this.#acquisitionsByIdempotency.set(
      acquisition.idempotencyKey,
      acquisition.acquisitionId,
    );
    this.#preflights.set(preflight.preflightId, {
      ...preflight,
      normalizedDescriptorJson: JSON.stringify(
        preflight.normalizedDescriptor,
      ),
      decisionPayloadJson: JSON.stringify(preflight.decisionPayload),
    });
  }

  residualClassificationState(input = {}) {
    const acquisitions = [...this.#acquisitions.values()].filter(
      (row) =>
        row.sourceArtifactId === input.sourceArtifactId
        || row.acquisitionId === input.acquisitionId
        || row.idempotencyKey === input.idempotencyKey
        || !input.sourceArtifactId,
    );
    const acquisitionIds = new Set(
      acquisitions.map((row) => row.acquisitionId),
    );
    const scope = input.serverBoundReviewAttachmentScope;
    return {
      artifacts: [...this.#sourceArtifacts.values()].filter(
        (row) =>
          row.sourceArtifactId === input.sourceArtifactId
          || !input.sourceArtifactId,
      ),
      acquisitions,
      preflights: [...this.#preflights.values()].filter(
        (row) => acquisitionIds.has(row.acquisitionId),
      ),
      versions: [...this.#versions.values()].filter(
        (row) =>
          row.sourceArtifactId === input.sourceArtifactId
          || acquisitionIds.has(row.acquisitionId)
          || !input.sourceArtifactId,
      ),
      currentness: [...this.#currentness],
      downstreamWorkItems: [...this.#downstreamWorkItems],
      actionAttempts: [...this.#actionAttempts],
      scopeConversations: scope
        ? [this.#scopeConversations.get(scope.reviewConversationId)]
          .filter(Boolean)
        : [...this.#scopeConversations.values()],
      scopeWorkItems: scope
        ? [this.#scopeWorkItems.get(scope.workItemId)].filter(Boolean)
        : [...this.#scopeWorkItems.values()],
    };
  }

  async recordAcquisition({ sourceArtifact, acquisition }) {
    const existingArtifact = this.#sourceArtifacts.get(
      sourceArtifact.sourceArtifactId,
    );
    if (existingArtifact) {
      assert.equal(existingArtifact.sha256, sourceArtifact.sha256);
      assert.equal(existingArtifact.byteLength, sourceArtifact.byteLength);
    } else {
      this.#sourceArtifacts.set(sourceArtifact.sourceArtifactId, sourceArtifact);
    }
    this.#acquisitions.set(acquisition.acquisitionId, {
      ...acquisition,
      documentVersionId: null,
      sourceDescriptorJson: JSON.stringify(acquisition.sourceDescriptor),
      status: 'ACQUIRED_READBACK_VERIFIED',
    });
    this.#acquisitionsByIdempotency.set(
      acquisition.idempotencyKey,
      acquisition.acquisitionId,
    );
    return acquisition;
  }

  async listIngressDocuments() {
    return [...this.#versions.values()].map((version) => {
      const family = this.#families.get(version.familyId);
      return {
        documentId: version.documentId,
        documentVersionId: version.documentVersionId,
        familyId: version.familyId,
        detail: {
          sha256: version.pdfSha256,
          sizeBytes: version.byteLength,
          documentCode: family.canonicalDocumentNumber,
          originalFilename: version.originalFilename,
          documentFamily: family.documentFamily,
          canonicalDocumentFamily: family.documentFamily,
          businessRevision: version.businessRevision,
          revisionDate: version.revisionDate,
          sourceGeneratedDate: version.sourceGeneratedDate,
          revisionId: version.revisionId,
          status: 'catalog_committed',
        },
        upload: {
          descriptorSummary: {
            sha256: version.pdfSha256,
            sizeBytes: version.byteLength,
            documentCode: family.canonicalDocumentNumber,
            documentFamily: family.documentFamily,
            businessRevision: version.businessRevision,
            revisionDate: version.revisionDate,
            sourceGeneratedDate: version.sourceGeneratedDate,
          },
        },
        report: { status: 'not_available' },
        ownerActionState: { pipeline: { selectedReplacementRevisionId: '' } },
        documentAnalysisWorkbenchView: { status: 'not_available' },
      };
    });
  }

  async observeFamily(identityKey) {
    return (
      [...this.#families.values()].find(
        (family) => family.canonicalIdentityKey === identityKey,
      ) || null
    );
  }

  async recordPreflight(preflight) {
    this.#preflights.set(preflight.preflightId, {
      ...preflight,
      documentVersionId: null,
      commitIdempotencyKey: null,
      normalizedDescriptorJson: JSON.stringify(
        preflight.normalizedDescriptor,
      ),
      decisionPayloadJson: JSON.stringify(preflight.decisionPayload),
    });
    return preflight;
  }

  async findExactDocumentVersion({ sha256, byteLength }) {
    return (
      [...this.#versions.values()].find(
        (version) =>
          version.pdfSha256 === sha256 &&
          Number(version.byteLength) === Number(byteLength),
      ) || null
    );
  }

  async linkAcquisitionToVersion({
    acquisitionId,
    documentVersionId,
    preflightId,
  }) {
    this.#exactLinkCount += 1;
    const acquisition = this.#acquisitions.get(acquisitionId);
    acquisition.documentVersionId = documentVersionId;
    acquisition.status = 'LINKED_EXACT_DOCUMENT_VERSION';
    const preflight = this.#preflights.get(preflightId);
    preflight.documentVersionId = documentVersionId;
    preflight.status = 'COMMITTED';
    return acquisition;
  }

  async commitNewVersion(command) {
    this.#commitCount += 1;
    const family = {
      ...command.family,
      currentDocumentVersionId: command.documentVersion.documentVersionId,
      currentGeneration: command.observedCurrentGeneration + 1,
    };
    this.#families.set(family.familyId, family);
    this.#documents.set(command.document.documentId, command.document);
    this.#versions.set(
      command.documentVersion.documentVersionId,
      command.documentVersion,
    );
    const acquisition = this.#acquisitions.get(
      command.documentVersion.acquisitionId,
    );
    acquisition.documentVersionId = command.documentVersion.documentVersionId;
    acquisition.status = 'COMMITTED_CANONICAL';
    const preflight = this.#preflights.get(command.preflightId);
    preflight.documentVersionId = command.documentVersion.documentVersionId;
    preflight.status = 'COMMITTED';
    return {
      disposition: 'CREATED',
      familyId: family.familyId,
      documentId: command.document.documentId,
      documentVersionId: command.documentVersion.documentVersionId,
      currentGeneration: family.currentGeneration,
      currentnessChanged: true,
    };
  }

  async readDocumentVersion(documentVersionId) {
    return this.#versions.get(documentVersionId) || null;
  }

  async readFamily(familyId) {
    return this.#families.get(familyId) || null;
  }

  async resolveDocumentVersionSource(documentVersionId, options) {
    const version = this.#versions.get(documentVersionId);
    if (!version) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
    const acquisition = this.#acquisitions.get(version.acquisitionId);
    const artifact = this.#sourceArtifacts.get(version.sourceArtifactId);
    if (
      options.expectedCreatorUserId !== version.committedBy ||
      options.expectedCreatorUserId !== acquisition.acquiredBy
    ) {
      throw new Error('DOCUMENT_VERSION_NOT_FOUND');
    }
    assert.equal(version.pdfSha256, artifact.sha256);
    assert.equal(version.byteLength, artifact.byteLength);
    return { version, acquisition, artifact };
  }
}

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

function restoreProcessEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
