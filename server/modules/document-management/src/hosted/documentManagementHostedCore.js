import { getDocumentFamilyAdapter } from '../migrated/adapters/documentFamilyAdapterRegistry.js';
import {
  buildGovernedDocumentIngressPreflightDecision,
} from '../migrated/ingress/documentIngressPreflight.js';
import { normalizeUploadDescriptor } from '../migrated/ingress/uploadDescriptor.js';
import { deterministicId, sha256Hex } from '../runtime/valueTools.js';

const NEW_VERSION_DECISIONS = new Set(['INGEST_NEW_FAMILY', 'INGEST_NEW_REVISION']);
const EXACT_LINK_DECISIONS = new Set(['REUSE_EXACT', 'RESUME_EXISTING_PROCESS']);

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, details });
}

function required(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized) fail('HOSTED_INGEST_INPUT_INVALID', `${fieldName} is required.`);
  return normalized;
}

function assertPdf(bytes, mediaType) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < 8 || bytes.subarray(0, 5).toString() !== '%PDF-') {
    fail('INVALID_PDF_INPUT', 'Selected FileService object is not a PDF byte stream.');
  }
  if (mediaType && mediaType !== 'application/pdf' && mediaType !== 'application/octet-stream') {
    fail('INVALID_PDF_MEDIA_TYPE', `Unsupported selected media type: ${mediaType}`);
  }
}

function rejectSelfReportedAuthority(request) {
  const forbidden = [
    'actor',
    'actorUserId',
    'authority',
    'permission',
    'roles',
    'tenantId',
    'userContext',
  ];
  const matched = forbidden.filter((key) => Object.hasOwn(request || {}, key));
  if (matched.length > 0) {
    fail(
      'REQUEST_AUTHORITY_FORBIDDEN',
      `Request body cannot report server authority fields: ${matched.join(', ')}.`,
    );
  }
}

function issuerFor(normalizedDescriptor) {
  const explicit = String(normalizedDescriptor.issuer || '').trim();
  if (explicit) return explicit.toUpperCase();
  const adapter = getDocumentFamilyAdapter(normalizedDescriptor.adapterRelease?.adapterId);
  return String(adapter?.issuerPolicy?.issuer || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
}

export class DocumentManagementHostedCore {
  constructor({ artifactStore, catalog, authorizer, now = () => new Date().toISOString() } = {}) {
    if (!artifactStore || !catalog || !authorizer) {
      fail(
        'HOSTED_DOCUMENT_MANAGEMENT_NOT_CONFIGURED',
        'ArtifactStore, DocumentCatalog, and server-bound authorizer are required.',
      );
    }
    this.artifactStore = artifactStore;
    this.catalog = catalog;
    this.authorizer = authorizer;
    this.now = now;
  }

  async ingestFileServiceSelection(request = {}, serverContext = {}) {
    rejectSelfReportedAuthority(request);
    const actorUserId = required(serverContext.actorUserId, 'serverContext.actorUserId');
    const tenantId = required(serverContext.tenantId, 'serverContext.tenantId');
    const idempotencyKey = required(request.idempotencyKey, 'request.idempotencyKey');
    await this.authorizer.assertCanIngest({
      actorUserId,
      tenantId,
      roles: Array.isArray(serverContext.roles) ? [...serverContext.roles] : [],
      action: 'DOCUMENT_INGEST',
    });

    const existingIngestion = await this.catalog.findIngestionByIdempotency({
      idempotencyKey,
      sourceChannel: request.sourceChannel,
      sourceRef: request.sourceRef,
      selection: request.selection,
    });
    if (existingIngestion) {
      if (existingIngestion.status !== 'COMMITTED') {
        fail(
          'INGESTION_REPLAY_INCOMPLETE',
          'Idempotent replay found an incomplete prior ingestion; no additional I/O was performed.',
          { acquisitionId: existingIngestion.acquisitionId },
        );
      }
      return {
        ...existingIngestion,
        disposition: 'IDEMPOTENT_REPLAY',
        newDocumentVersionCreated: false,
        currentnessChanged: false,
        catalogFreshReadVerified: true,
      };
    }

    const selected = await this.artifactStore.readSelection(request.selection);
    assertPdf(selected.bytes, selected.mediaType);
    const actualSha256 = sha256Hex(selected.bytes);
    if (actualSha256 !== selected.sha256 || selected.bytes.byteLength !== selected.byteLength) {
      fail('SELECTION_ACTUAL_BYTE_MISMATCH', 'Selection receipt does not match actual bytes.');
    }
    const immutable = await this.artifactStore.persistImmutableSource({
      bytes: selected.bytes,
      sha256: actualSha256,
      byteLength: selected.bytes.byteLength,
      mediaType: 'application/pdf',
    });
    if (!immutable.readbackVerified) {
      fail('IMMUTABLE_READBACK_REQUIRED', 'Canonical FileService source lacks actual-byte readback.');
    }

    const acquiredAt = this.now();
    const sourceArtifactId = deterministicId(
      'source_artifact',
      actualSha256,
      selected.bytes.byteLength,
    );
    const acquisitionId = deterministicId('acquisition', tenantId, idempotencyKey);
    const sourceDescriptor = {
      ...(request.descriptor || {}),
      originalFilename: request.descriptor?.originalFilename || selected.fileName,
      mediaType: 'application/pdf',
      sha256: actualSha256,
      sizeBytes: selected.bytes.byteLength,
      sourceKind: request.sourceChannel || 'miaoda_file_service_selection',
      sourceStorageKey: `${immutable.bucketId}:${immutable.filePath}`,
      providerUpdatedAt: selected.providerUpdatedAt || null,
    };
    const acquisition = await this.catalog.recordAcquisition({
      sourceArtifact: {
        sourceArtifactId,
        sha256: actualSha256,
        byteLength: selected.bytes.byteLength,
        mediaType: 'application/pdf',
        bucketId: immutable.bucketId,
        filePath: immutable.filePath,
        providerObjectId: immutable.providerObjectId,
        providerVersionId: immutable.providerVersionId,
        readbackVerified: true,
        createdAt: acquiredAt,
      },
      acquisition: {
        acquisitionId,
        sourceArtifactId,
        sourceChannel: required(request.sourceChannel, 'request.sourceChannel'),
        sourceRef: required(request.sourceRef, 'request.sourceRef'),
        selectionBucketId: selected.bucketId,
        selectionFilePath: selected.filePath,
        providerObjectId: selected.providerObjectId,
        providerVersionId: selected.providerVersionId,
        acquiredBy: actorUserId,
        acquiredAt,
        idempotencyKey,
        sourceDescriptor,
      },
    });

    const normalizedDescriptor = normalizeUploadDescriptor(sourceDescriptor);
    const documents = await this.catalog.listIngressDocuments();
    const decision = buildGovernedDocumentIngressPreflightDecision({
      generatedAt: this.now(),
      documents,
      rawDescriptor: sourceDescriptor,
      normalizedDescriptor,
    });
    const issuerAuthority = issuerFor(normalizedDescriptor);
    const familyIdentityKey = decision.incoming.identityResolved
      ? `${issuerAuthority}|${decision.incoming.documentTypeFamily}|${decision.incoming.documentCode}`
      : '';
    const observedFamily = familyIdentityKey
      ? await this.catalog.observeFamily(familyIdentityKey)
      : null;
    const preflightId = deterministicId(
      'preflight',
      acquisition.acquisitionId,
      decision.decision,
      observedFamily?.currentGeneration || 0,
      observedFamily?.currentDocumentVersionId || 'none',
    );
    await this.catalog.recordPreflight({
      preflightId,
      acquisitionId: acquisition.acquisitionId,
      decision: decision.decision,
      branch: decision.branch,
      executionAuthorized: false,
      observedCurrentGeneration: observedFamily?.currentGeneration || 0,
      observedCurrentDocumentVersionId: observedFamily?.currentDocumentVersionId || null,
      normalizedDescriptor,
      decisionPayload: decision,
      status: 'READY',
      createdAt: this.now(),
    });

    if (EXACT_LINK_DECISIONS.has(decision.decision)) {
      const exactVersion = await this.catalog.findExactDocumentVersion({
        sha256: actualSha256,
        byteLength: selected.bytes.byteLength,
      });
      if (!exactVersion) {
        fail('EXACT_DOCUMENT_VERSION_NOT_FOUND', `${decision.decision} requires one exact DocumentVersion.`);
      }
      await this.catalog.linkAcquisitionToVersion({
        acquisitionId: acquisition.acquisitionId,
        documentVersionId: exactVersion.documentVersionId,
        preflightId,
        idempotencyKey: `catalog:${tenantId}:${idempotencyKey}`,
      });
      return {
        acquisitionId: acquisition.acquisitionId,
        sourceArtifactId,
        preflightId,
        decision: decision.decision,
        disposition: decision.decision,
        familyId: exactVersion.familyId,
        documentVersionId: exactVersion.documentVersionId,
        newDocumentVersionCreated: false,
        currentnessChanged: false,
        immutableReadbackVerified: true,
      };
    }

    if (!NEW_VERSION_DECISIONS.has(decision.decision)) {
      return {
        acquisitionId: acquisition.acquisitionId,
        sourceArtifactId,
        preflightId,
        decision: decision.decision,
        disposition: 'REVIEW_REQUIRED',
        newDocumentVersionCreated: false,
        currentnessChanged: false,
        immutableReadbackVerified: true,
        reason: decision.reason,
      };
    }
    if (
      normalizedDescriptor.canonicalDocumentFamily === 'GENERIC'
      || !decision.incoming.identityResolved
      || !decision.incoming.versionOrderResolved
    ) {
      fail('IDENTITY_NOT_COMMITTABLE', 'Canonical commit requires non-GENERIC resolved identity and version.');
    }

    const familyId = deterministicId('family', familyIdentityKey);
    const documentId = deterministicId('document', familyId);
    const revisionId = deterministicId(
      'revision',
      familyId,
      decision.incoming.comparableVersion,
    );
    const documentVersionId = deterministicId(
      'document_version',
      familyId,
      decision.incoming.comparableVersion,
    );
    const committedAt = this.now();
    const commit = await this.catalog.commitNewVersion({
      idempotencyKey: `catalog:${tenantId}:${idempotencyKey}`,
      preflightId,
      preflightDecision: decision.decision,
      observedCurrentGeneration: observedFamily?.currentGeneration || 0,
      observedCurrentDocumentVersionId: observedFamily?.currentDocumentVersionId || null,
      family: {
        familyId,
        canonicalIdentityKey: familyIdentityKey,
        documentFamily: decision.incoming.documentTypeFamily,
        issuerAuthority,
        canonicalDocumentNumber: decision.incoming.documentCode,
        status: 'ACTIVE',
        createdAt: committedAt,
      },
      document: {
        documentId,
        familyId,
        documentFamily: decision.incoming.documentTypeFamily,
        status: 'ACTIVE',
        createdAt: committedAt,
      },
      documentVersion: {
        documentVersionId,
        documentId,
        familyId,
        revisionId,
        canonicalRevisionIdentity: decision.incoming.comparableVersion,
        businessRevision: decision.incoming.businessRevision,
        revisionDate: decision.incoming.revisionDate,
        sourceGeneratedDate: decision.incoming.sourceGeneratedDate,
        originalFilename: normalizedDescriptor.originalFilename,
        sourceArtifactId,
        acquisitionId: acquisition.acquisitionId,
        pdfSha256: actualSha256,
        byteLength: selected.bytes.byteLength,
        mediaType: 'application/pdf',
        committedAt,
        committedBy: actorUserId,
      },
      currentnessDecision: {
        currentnessDecisionId: deterministicId(
          'currentness',
          familyId,
          documentVersionId,
        ),
        familyId,
        reason: decision.decision,
        decidedAt: committedAt,
        decidedBy: actorUserId,
        preflightId,
      },
    });
    const freshVersion = await this.catalog.readDocumentVersion(commit.documentVersionId);
    const freshFamily = await this.catalog.readFamily(commit.familyId);
    if (
      !freshVersion
      || freshVersion.pdfSha256 !== actualSha256
      || freshVersion.byteLength !== selected.bytes.byteLength
      || freshFamily?.currentDocumentVersionId !== freshVersion.documentVersionId
    ) {
      fail('CATALOG_FRESH_READ_MISMATCH', 'Hosted Catalog fresh read does not prove exact version/currentness.');
    }
    return {
      acquisitionId: acquisition.acquisitionId,
      sourceArtifactId,
      preflightId,
      decision: decision.decision,
      disposition: commit.disposition,
      familyId: commit.familyId,
      documentId: commit.documentId,
      documentVersionId: commit.documentVersionId,
      currentGeneration: commit.currentGeneration,
      newDocumentVersionCreated: true,
      currentnessChanged: commit.currentnessChanged,
      immutableReadbackVerified: true,
      catalogFreshReadVerified: true,
    };
  }
}
