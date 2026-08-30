import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const {
  classifyImmutableSourceReuseState,
  classifyReviewAttachmentResidualReuseState,
} = require('../../dist/server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.js');

const VERIFIED_DM_IDENTITY_AUTHORITIES = new Set([
  'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
  'DM_ACTUAL_PDF_LAYOUT_AND_SERVER_REVIEW_SCOPE',
]);

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function tenantFamilyIdentityPrefix(tenantId) {
  const normalized = String(tenantId || '').trim();
  if (!normalized) {
    fail('TENANT_SCOPE_REQUIRED', 'Catalog family reads require tenant scope.');
  }
  return `tenant:${encodeURIComponent(normalized)}:family:`;
}

/**
 * Canonical-owned local Catalog support for exercising the production hosted
 * Document Management core without Postgres. This module is test/script-only;
 * it is never registered in the production Nest composition root.
 */
export class InMemoryHostedDocumentCatalog {
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
        value.status === 'ACQUIRED_READBACK_VERIFIED' &&
        value.documentVersionId === null,
    ).length;
  }

  get preflightDecisions() {
    return [...this.#preflights.values()].map((value) => value.decision);
  }

  get firstIncomingIdentity() {
    return [...this.#preflights.values()][0]?.decisionPayload?.incoming ?? null;
  }

  snapshot() {
    return structuredClone({
      sourceArtifacts: [...this.#sourceArtifacts.values()],
      acquisitions: [...this.#acquisitions.values()],
      preflights: [...this.#preflights.values()],
      publicationFamilies: [...this.#families.values()],
      documents: [...this.#documents.values()],
      documentVersions: [...this.#versions.values()],
      currentnessDecisions: [...this.#currentness],
      downstreamWorkItems: [...this.#downstreamWorkItems],
      actionAttempts: [...this.#actionAttempts],
      scopeConversations: [...this.#scopeConversations.values()],
      scopeWorkItems: [...this.#scopeWorkItems.values()],
    });
  }

  async findIngestionByIdempotency(input) {
    const acquisitionId = this.#acquisitionsByIdempotency.get(
      input.idempotencyKey,
    );
    if (!acquisitionId) return null;
    if (
      input.expectedAcquisitionId &&
      acquisitionId !== input.expectedAcquisitionId
    ) {
      return null;
    }
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
    const family = version ? this.#families.get(version.familyId) : null;
    const artifact = this.#sourceArtifacts.get(acquisition.sourceArtifactId);
    if (!preflight || !version || !family || !artifact) {
      fail(
        'CATALOG_REPLAY_READ_FAILED',
        'Completed replay lacks one fresh exact Catalog lineage.',
      );
    }
    const normalizedDescriptor = JSON.parse(preflight.normalizedDescriptorJson);
    const identityAuthority = String(
      normalizedDescriptor.identityAuthority || '',
    );
    const pageCount = Number(normalizedDescriptor.pageCount || 0);
    if (
      !VERIFIED_DM_IDENTITY_AUTHORITIES.has(identityAuthority) ||
      !Number.isSafeInteger(pageCount) ||
      pageCount < 1 ||
      normalizedDescriptor.sha256 !== artifact.sha256 ||
      Number(normalizedDescriptor.sizeBytes) !== Number(artifact.byteLength) ||
      normalizedDescriptor.documentCode !== family.canonicalDocumentNumber ||
      normalizedDescriptor.canonicalDocumentFamily !== family.documentFamily ||
      normalizedDescriptor.issuer !== family.issuerAuthority ||
      String(normalizedDescriptor.businessRevision || '') !==
        String(version.businessRevision || '') ||
      String(normalizedDescriptor.revisionDate || '') !==
        String(version.revisionDate || '') ||
      String(normalizedDescriptor.sourceGeneratedDate || '') !==
        String(version.sourceGeneratedDate || '') ||
      acquisition.sourceArtifactId !== artifact.sourceArtifactId ||
      version.sourceArtifactId !== artifact.sourceArtifactId ||
      version.acquisitionId !== acquisition.acquisitionId ||
      preflight.acquisitionId !== acquisition.acquisitionId ||
      preflight.documentVersionId !== version.documentVersionId
    ) {
      fail(
        'CATALOG_REPLAY_IDENTITY_UNVERIFIED',
        'Completed replay lacks verified DM actual-PDF identity readback.',
      );
    }
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
      catalogFreshReadVerified: true,
      identityReadback: {
        identityAuthority,
        canonicalIdentityKey: family.canonicalIdentityKey,
        issuerAuthority: family.issuerAuthority,
        documentFamily: family.documentFamily,
        documentNumber: family.canonicalDocumentNumber,
        businessRevision: version.businessRevision,
        revisionDate: version.revisionDate,
        sourceGeneratedDate: version.sourceGeneratedDate,
        pageCount,
        sourceArtifactId: artifact.sourceArtifactId,
      },
    };
  }

  async assertImmutableSourceReuseSafe(input) {
    const state = this.residualClassificationState(input);
    const hasIncompleteState =
      state.acquisitions.some(
        (row) =>
          !row.documentVersionId ||
          !['COMMITTED_CANONICAL', 'LINKED_EXACT_DOCUMENT_VERSION'].includes(
            row.status,
          ),
      ) ||
      state.preflights.some(
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
    sourceArtifactId,
    documentId,
    documentVersionId,
  }) {
    this.#scopeConversations.set(reviewConversationId, {
      reviewConversationId,
      tenantId,
      actorId: actorUserId,
      workItemId,
      status: 'ACTIVE',
    });
    const scopedWorkItem = {
      workItemId,
      tenantId,
      requestedByUserId: actorUserId,
      revision,
      sourceArtifactId,
      documentId,
      documentVersionId,
    };
    this.#scopeWorkItems.set(workItemId, scopedWorkItem);
    if (sourceArtifactId && documentId && documentVersionId) {
      this.#downstreamWorkItems.push(scopedWorkItem);
    }
  }

  seedActionAttempt({ attemptId, workItemId }) {
    this.#actionAttempts.push({ attemptId, workItemId });
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
      normalizedDescriptorJson: JSON.stringify(preflight.normalizedDescriptor),
      decisionPayloadJson: JSON.stringify(preflight.decisionPayload),
    });
  }

  seedCompletedCanonicalLineage({
    sourceArtifact,
    acquisition,
    preflight,
    family,
    document,
    version,
    currentnessDecision,
  }) {
    assert.equal(acquisition.sourceArtifactId, sourceArtifact.sourceArtifactId);
    assert.equal(version.sourceArtifactId, sourceArtifact.sourceArtifactId);
    assert.equal(version.acquisitionId, acquisition.acquisitionId);
    assert.equal(version.familyId, family.familyId);
    assert.equal(version.documentId, document.documentId);
    this.#sourceArtifacts.set(sourceArtifact.sourceArtifactId, {
      ...sourceArtifact,
    });
    this.#acquisitions.set(acquisition.acquisitionId, {
      ...acquisition,
      documentVersionId: version.documentVersionId,
      sourceDescriptorJson: JSON.stringify(acquisition.sourceDescriptor),
      status: 'COMMITTED_CANONICAL',
    });
    this.#acquisitionsByIdempotency.set(
      acquisition.idempotencyKey,
      acquisition.acquisitionId,
    );
    this.#preflights.set(preflight.preflightId, {
      ...preflight,
      documentVersionId: version.documentVersionId,
      normalizedDescriptorJson: JSON.stringify(preflight.normalizedDescriptor),
      decisionPayloadJson: JSON.stringify(preflight.decisionPayload),
      status: 'COMMITTED',
    });
    this.#families.set(family.familyId, { ...family });
    this.#documents.set(document.documentId, { ...document });
    this.#versions.set(version.documentVersionId, { ...version });
    this.#currentness.push({ ...currentnessDecision });
    this.#commitCount += 1;
  }

  residualClassificationState(input = {}) {
    const acquisitions = [...this.#acquisitions.values()].filter(
      (row) =>
        row.sourceArtifactId === input.sourceArtifactId ||
        row.acquisitionId === input.acquisitionId ||
        row.idempotencyKey === input.idempotencyKey ||
        !input.sourceArtifactId,
    );
    const acquisitionIds = new Set(
      acquisitions.map((row) => row.acquisitionId),
    );
    const scope = input.serverBoundReviewAttachmentScope;
    return {
      artifacts: [...this.#sourceArtifacts.values()].filter(
        (row) =>
          row.sourceArtifactId === input.sourceArtifactId ||
          !input.sourceArtifactId,
      ),
      acquisitions,
      preflights: [...this.#preflights.values()].filter((row) =>
        acquisitionIds.has(row.acquisitionId),
      ),
      versions: [...this.#versions.values()].filter(
        (row) =>
          row.sourceArtifactId === input.sourceArtifactId ||
          acquisitionIds.has(row.acquisitionId) ||
          !input.sourceArtifactId,
      ),
      currentness: [...this.#currentness],
      downstreamWorkItems: [...this.#downstreamWorkItems],
      actionAttempts: [...this.#actionAttempts],
      scopeConversations: scope
        ? [this.#scopeConversations.get(scope.reviewConversationId)].filter(
            Boolean,
          )
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
      assert.equal(existingArtifact.bucketId, sourceArtifact.bucketId);
      assert.equal(existingArtifact.filePath, sourceArtifact.filePath);
    } else {
      this.#sourceArtifacts.set(sourceArtifact.sourceArtifactId, {
        ...sourceArtifact,
      });
    }
    const stored = {
      ...acquisition,
      documentVersionId: null,
      sourceDescriptorJson: JSON.stringify(acquisition.sourceDescriptor),
      status: 'ACQUIRED_READBACK_VERIFIED',
    };
    this.#acquisitions.set(acquisition.acquisitionId, stored);
    this.#acquisitionsByIdempotency.set(
      acquisition.idempotencyKey,
      acquisition.acquisitionId,
    );
    return { ...stored };
  }

  async listIngressDocuments({ tenantId } = {}) {
    const tenantPrefix = tenantFamilyIdentityPrefix(tenantId);
    return [...this.#versions.values()].flatMap((version) => {
      const family = this.#families.get(version.familyId);
      if (!family.canonicalIdentityKey.startsWith(tenantPrefix)) return [];
      return {
        documentId: version.documentId,
        documentVersionId: version.documentVersionId,
        familyId: version.familyId,
        versionStatus:
          family.currentDocumentVersionId === version.documentVersionId
            ? 'CANONICAL_CURRENT'
            : 'CANONICAL_HISTORICAL',
        detail: {
          sha256: version.pdfSha256,
          sizeBytes: version.byteLength,
          documentCode: family.canonicalDocumentNumber,
          originalFilename: version.originalFilename,
          documentFamily: family.documentFamily,
          canonicalDocumentFamily: family.documentFamily,
          issuerAuthority: family.issuerAuthority,
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
            issuerAuthority: family.issuerAuthority,
            businessRevision: version.businessRevision,
            revisionDate: version.revisionDate,
            sourceGeneratedDate: version.sourceGeneratedDate,
          },
        },
        report: { status: 'not_available' },
        ownerActionState: {
          pipeline: { selectedReplacementRevisionId: '' },
        },
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
    const stored = {
      ...preflight,
      documentVersionId: null,
      commitIdempotencyKey: null,
      normalizedDescriptorJson: JSON.stringify(preflight.normalizedDescriptor),
      decisionPayloadJson: JSON.stringify(preflight.decisionPayload),
    };
    this.#preflights.set(preflight.preflightId, stored);
    return { ...stored };
  }

  async findExactDocumentVersion({ sha256, byteLength, tenantId }) {
    const tenantPrefix = tenantFamilyIdentityPrefix(tenantId);
    const matches = [...this.#versions.values()].filter((version) => {
      const family = this.#families.get(version.familyId);
      return (
        family?.canonicalIdentityKey.startsWith(tenantPrefix) &&
        version.pdfSha256 === sha256 &&
        Number(version.byteLength) === Number(byteLength)
      );
    });
    if (matches.length > 1) throw new Error('MULTIPLE_EXACT_MATCHES');
    return matches[0] || null;
  }

  async linkAcquisitionToVersion({
    acquisitionId,
    documentVersionId,
    preflightId,
    idempotencyKey,
  }) {
    this.#exactLinkCount += 1;
    const acquisition = this.#acquisitions.get(acquisitionId);
    assert.ok(acquisition);
    assert.ok(
      acquisition.documentVersionId === null ||
        acquisition.documentVersionId === documentVersionId,
    );
    acquisition.documentVersionId = documentVersionId;
    acquisition.status = 'LINKED_EXACT_DOCUMENT_VERSION';
    const preflight = this.#preflights.get(preflightId);
    assert.ok(preflight);
    preflight.documentVersionId = documentVersionId;
    preflight.status = 'COMMITTED';
    preflight.commitIdempotencyKey = idempotencyKey;
    return { ...acquisition };
  }

  async commitNewVersion(command) {
    const storedPreflight = this.#preflights.get(command.preflightId);
    assert.ok(storedPreflight);
    assert.equal(storedPreflight.decision, command.preflightDecision);
    assert.equal(
      storedPreflight.observedCurrentGeneration,
      command.observedCurrentGeneration,
    );
    assert.equal(
      storedPreflight.observedCurrentDocumentVersionId || null,
      command.observedCurrentDocumentVersionId || null,
    );
    this.#commitCount += 1;
    const family = {
      ...command.family,
      currentDocumentVersionId: command.documentVersion.documentVersionId,
      currentGeneration: command.observedCurrentGeneration + 1,
      updatedAt: command.documentVersion.committedAt,
    };
    const version = {
      ...command.documentVersion,
      lifecycleStatus: 'COMMITTED_IMMUTABLE',
    };
    this.#families.set(family.familyId, family);
    this.#documents.set(command.document.documentId, { ...command.document });
    this.#versions.set(version.documentVersionId, version);
    this.#currentness.push({
      ...command.currentnessDecision,
      previousDocumentVersionId:
        command.observedCurrentDocumentVersionId || null,
      nextDocumentVersionId: version.documentVersionId,
      previousGeneration: command.observedCurrentGeneration,
      nextGeneration: command.observedCurrentGeneration + 1,
    });
    const acquisition = this.#acquisitions.get(version.acquisitionId);
    assert.ok(acquisition);
    acquisition.documentVersionId = version.documentVersionId;
    acquisition.status = 'COMMITTED_CANONICAL';
    const preflight = this.#preflights.get(command.preflightId);
    preflight.documentVersionId = version.documentVersionId;
    preflight.status = 'COMMITTED';
    preflight.commitIdempotencyKey = command.idempotencyKey;
    return {
      disposition: command.preflightDecision,
      familyId: family.familyId,
      documentId: command.document.documentId,
      documentVersionId: version.documentVersionId,
      currentGeneration: family.currentGeneration,
      currentnessChanged: true,
    };
  }

  async readDocumentVersion(documentVersionId) {
    const value = this.#versions.get(documentVersionId);
    return value ? structuredClone(value) : null;
  }

  async readFamily(familyId) {
    const value = this.#families.get(familyId);
    return value ? structuredClone(value) : null;
  }

  async resolveDocumentVersionSource(documentVersionId, options = {}) {
    const version = this.#versions.get(documentVersionId);
    if (!version) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
    const acquisition = this.#acquisitions.get(version.acquisitionId);
    const artifact = this.#sourceArtifacts.get(version.sourceArtifactId);
    const family = this.#families.get(version.familyId);
    const preflight = [...this.#preflights.values()].find(
      (value) =>
        value.acquisitionId === acquisition?.acquisitionId &&
        value.documentVersionId === documentVersionId &&
        value.status === 'COMMITTED',
    );
    const currentness = this.#currentness.find(
      (value) =>
        value.familyId === family?.familyId &&
        value.nextDocumentVersionId === documentVersionId &&
        value.nextGeneration === family?.currentGeneration,
    );
    if (!acquisition || !artifact || !family || !preflight) {
      throw new Error('DOCUMENT_VERSION_SOURCE_NOT_FOUND');
    }
    if (
      options.expectedCreatorUserId &&
      (options.expectedCreatorUserId !== version.committedBy ||
        options.expectedCreatorUserId !== acquisition.acquiredBy)
    ) {
      throw new Error('DOCUMENT_VERSION_NOT_FOUND');
    }
    if (
      options.requireCurrent === true &&
      family.currentDocumentVersionId !== documentVersionId
    ) {
      throw new Error('DOCUMENT_VERSION_NOT_CURRENT');
    }
    if (options.requireCurrent === true && !currentness) {
      throw new Error('DOCUMENT_VERSION_CURRENTNESS_UNVERIFIED');
    }
    assert.equal(version.pdfSha256, artifact.sha256);
    assert.equal(version.byteLength, artifact.byteLength);
    return structuredClone({
      version,
      acquisition,
      artifact,
      family,
      preflight,
      currentness: currentness ?? null,
    });
  }
}

/**
 * Multi-bucket FileService boundary double used only by local tests/scripts.
 * Production FileService adapters still perform all locator and byte checks.
 */
export class LocalMiaodaFileServiceDouble {
  #files = new Map();
  #downloadMetadataOverrides = new Map();
  #nextObjectId = 1;
  #operationCount = 0;

  constructor({
    defaultBucketId = 'local-hosted-default',
    defaultCreatedBy = 'local-file-service-user',
  } = {}) {
    this.defaultBucketId = defaultBucketId;
    this.defaultCreatedBy = defaultCreatedBy;
    this.uploadCalls = [];
    this.removeCalls = [];
  }

  get operationCount() {
    return this.#operationCount;
  }

  async getDefaultBucket() {
    this.#operationCount += 1;
    return this.defaultBucketId;
  }

  from(bucketId) {
    return {
      getFileMetadata: async (filePath) => {
        this.#operationCount += 1;
        const stored = this.#files.get(storageKey(bucketId, filePath));
        return stored ? structuredClone(stored.metadata) : null;
      },
      upload: async (bytes, options) => {
        this.#operationCount += 1;
        const key = storageKey(bucketId, options.filePath);
        if (this.#files.has(key) && options.upsert !== true) {
          throw new Error('LOCAL_FILESERVICE_OBJECT_EXISTS');
        }
        const stored = this.#storedValue({
          bucketId,
          filePath: options.filePath,
          bytes,
          fileName: options.fileName,
          contentType: options.contentType,
          createdBy: this.defaultCreatedBy,
        });
        this.#files.set(key, stored);
        this.uploadCalls.push({
          bucketId,
          options: structuredClone(options),
          byteLength: stored.bytes.byteLength,
          providerObjectId: stored.metadata.id,
        });
        return structuredClone(stored.metadata);
      },
      download: async (filePath) => {
        this.#operationCount += 1;
        const key = storageKey(bucketId, filePath);
        const stored = this.#files.get(key);
        if (!stored) throw new Error('LOCAL_FILESERVICE_OBJECT_NOT_FOUND');
        return {
          content: Uint8Array.from(stored.bytes),
          metadata: {
            ...structuredClone(stored.metadata),
            ...structuredClone(this.#downloadMetadataOverrides.get(key) || {}),
          },
        };
      },
      remove: async (filePaths) => {
        this.#operationCount += 1;
        for (const filePath of filePaths) {
          const key = storageKey(bucketId, filePath);
          this.#files.delete(key);
          this.#downloadMetadataOverrides.delete(key);
        }
        this.removeCalls.push({ bucketId, filePaths: [...filePaths] });
      },
    };
  }

  seed({
    bucketId = this.defaultBucketId,
    filePath,
    bytes,
    fileName,
    contentType = 'application/pdf',
    mediaType,
    createdBy = this.defaultCreatedBy,
    metadataOverrides = {},
  }) {
    const stored = this.#storedValue({
      bucketId,
      filePath,
      bytes,
      fileName,
      contentType: mediaType || contentType,
      createdBy,
      metadataOverrides,
    });
    this.#files.set(storageKey(bucketId, filePath), stored);
    return structuredClone(stored.metadata);
  }

  overrideDownloadMetadata(bucketId, filePath, overrides) {
    const key = storageKey(bucketId, filePath);
    assert.ok(this.#files.has(key));
    this.#downloadMetadataOverrides.set(key, structuredClone(overrides));
  }

  jsonArtifactBytes() {
    const stored = [...this.#files.values()].find(
      (value) => value.metadata.metadata.mimeType === 'application/json',
    );
    if (!stored) throw new Error('PARSED_ARTIFACT_NOT_FOUND');
    return Uint8Array.from(stored.bytes);
  }

  listFiles() {
    return [...this.#files.values()].map((value) => ({
      metadata: structuredClone(value.metadata),
      bytes: Uint8Array.from(value.bytes),
    }));
  }

  #storedValue({
    bucketId,
    filePath,
    bytes,
    fileName,
    contentType,
    createdBy,
    metadataOverrides = {},
  }) {
    const normalizedBytes = Uint8Array.from(bytes);
    const providerObjectId =
      metadataOverrides.id || `local-object-${this.#nextObjectId++}`;
    return {
      bytes: normalizedBytes,
      metadata: {
        id: providerObjectId,
        bucketID: bucketId,
        filePath: `/${canonicalPath(filePath)}`,
        name: fileName,
        createdBy: { userID: createdBy },
        updatedAt: '2026-08-27T00:00:00.000Z',
        metadata: {
          contentLength: String(normalizedBytes.byteLength),
          mimeType: contentType,
        },
        ...structuredClone(metadataOverrides),
      },
    };
  }
}

function storageKey(bucketId, filePath) {
  return `${bucketId}:${canonicalPath(filePath)}`;
}

function canonicalPath(value) {
  return String(value).replace(/^\/+/, '');
}

/**
 * Reusable corpus-runner bridge: actual selection bytes enter the production
 * hosted DM core, then the committed SourceArtifact/DocumentVersion is fresh
 * resolved from the same local Catalog. The caller remains responsible for
 * composing the production core and all downstream producer/U0/Reader owners.
 */
export async function ingestActualPdfThroughHostedCore({
  core,
  catalog,
  fileService,
  bytes,
  selection,
  fileName,
  sourceChannel,
  sourceRef,
  idempotencyKey,
  descriptor = {},
  serverContext,
  requireCurrent = true,
}) {
  const actualBytes = Uint8Array.from(bytes);
  const sourceSha256 = createHash('sha256').update(actualBytes).digest('hex');
  fileService.seed({
    bucketId: selection.bucketId,
    filePath: selection.filePath,
    bytes: actualBytes,
    fileName,
    contentType: 'application/pdf',
    createdBy: serverContext.actorUserId,
  });
  const ingested = await core.ingestFileServiceSelection(
    {
      sourceChannel,
      sourceRef,
      selection: {
        bucketId: selection.bucketId,
        filePath: selection.filePath,
      },
      idempotencyKey,
      descriptor,
    },
    serverContext,
  );
  if (!ingested.documentVersionId || !ingested.sourceArtifactId) {
    throw new Error('LOCAL_HOSTED_DM_COMMIT_REQUIRED');
  }
  const resolved = await catalog.resolveDocumentVersionSource(
    ingested.documentVersionId,
    { requireCurrent },
  );
  if (
    resolved.version.documentVersionId !== ingested.documentVersionId ||
    resolved.version.sourceArtifactId !== ingested.sourceArtifactId ||
    resolved.artifact.sourceArtifactId !== ingested.sourceArtifactId ||
    resolved.artifact.sha256 !== sourceSha256 ||
    Number(resolved.artifact.byteLength) !== actualBytes.byteLength
  ) {
    throw new Error('LOCAL_HOSTED_DM_SOURCE_BINDING_MISMATCH');
  }
  return {
    ingested,
    resolved,
    sourceSha256,
    sourceByteLength: actualBytes.byteLength,
  };
}

export async function resolveRealFtdFixturePath({
  repoRoot,
  filename = '777-FTD-31-21002_Doc_09262025.pdf',
  explicitFile = process.env.WL31_REAL_FTD_FIXTURE?.trim(),
  explicitDirectory = process.env.WL31_REAL_FTD_FIXTURE_DIR?.trim() ||
    process.env.WL31_REAL_FTD_UPLOAD_ROOT?.trim(),
} = {}) {
  if (explicitFile) {
    const candidate = resolve(explicitFile);
    await access(candidate);
    return candidate;
  }
  const candidates = [
    ...(explicitDirectory ? [resolve(explicitDirectory, filename)] : []),
    resolve(repoRoot, '../../../..', 'Docs/uploads/FTD', filename),
    resolve(repoRoot, 'Docs/uploads/FTD', filename),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through repository-placement candidates before failing loudly.
    }
  }
  throw new Error(
    `WL31_REAL_FTD_FIXTURE_REQUIRED: set WL31_REAL_FTD_FIXTURE to ${filename} or WL31_REAL_FTD_FIXTURE_DIR to its FTD directory`,
  );
}
