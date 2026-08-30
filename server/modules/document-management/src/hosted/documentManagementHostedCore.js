import { getDocumentFamilyAdapter } from '../migrated/adapters/documentFamilyAdapterRegistry.js';
import {
  buildGovernedDocumentIngressPreflightDecision,
  documentIngressCodeFromFilename,
} from '../migrated/ingress/documentIngressPreflight.js';
import {
  controlledPdfByteView,
  readActualPdfPageCount,
  resolveActualPdfDocumentIdentity,
} from '../migrated/ingress/pdfDocumentIdentityOwner.js';
import { normalizeUploadDescriptor } from '../migrated/ingress/uploadDescriptor.js';
import { deterministicId, sha256Hex } from '../runtime/valueTools.js';
import { PdfjsDistLayoutExtractor } from '../../../professional-input/parser/pdfjs-dist-layout-extractor.adapter';

const NEW_VERSION_DECISIONS = new Set([
  'INGEST_NEW_FAMILY',
  'INGEST_NEW_REVISION',
]);
const EXACT_LINK_DECISIONS = new Set([
  'REUSE_EXACT',
  'RESUME_EXISTING_PROCESS',
]);
const REVIEW_ATTACHMENT_SOURCE_CHANNEL =
  'canonical_review_attachment_selection';
const EXTERNAL_DISCOVERY_SOURCE_CHANNELS = new Set([
  'openclaw_external_discovery_review',
  'openclaw_external_monitor_review',
]);
const CALLER_IDENTITY_FIELDS = Object.freeze([
  'adapterId',
  'airplaneModel',
  'businessRevision',
  'documentCategory',
  'documentCode',
  'documentCodeProvenance',
  'documentFamily',
  'documentFamilyAdapterId',
  'documentTitle',
  'fileName',
  'generatedDate',
  'identityAuthority',
  'issuer',
  'lastRevisedDate',
  'metadata',
  'originalFilename',
  'pageCount',
  'revisionDate',
  'revisionLabel',
  'sha256',
  'sizeBytes',
  'sourceGeneratedDate',
  'sourceGeneratedDateProvenance',
  'sourceType',
]);

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, details });
}

function required(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized)
    fail('HOSTED_INGEST_INPUT_INVALID', `${fieldName} is required.`);
  return normalized;
}

function tenantScopedValue(kind, tenantId, value, maxLength) {
  let encodedTenantId;
  let encodedValue;
  try {
    encodedTenantId = encodeURIComponent(tenantId);
    encodedValue = encodeURIComponent(value);
  } catch {
    fail(
      'HOSTED_INGEST_INPUT_INVALID',
      `Tenant and ${kind} must contain valid Unicode.`,
    );
  }
  const scoped = `tenant:${encodedTenantId}:${kind}:${encodedValue}`;
  if (scoped.length > maxLength) {
    fail(
      'HOSTED_INGEST_INPUT_INVALID',
      `Tenant-scoped ${kind} exceeds the Catalog limit.`,
    );
  }
  return scoped;
}

function tenantScopedIdempotencyKey(tenantId, requestIdempotencyKey) {
  return tenantScopedValue('request', tenantId, requestIdempotencyKey, 255);
}

function tenantScopedFamilyIdentityKey(tenantId, businessIdentityKey) {
  return tenantScopedValue('family', tenantId, businessIdentityKey, 512);
}

function assertPdfMediaType(mediaType) {
  if (
    mediaType &&
    mediaType !== 'application/pdf' &&
    mediaType !== 'application/octet-stream'
  ) {
    fail(
      'INVALID_PDF_MEDIA_TYPE',
      `Unsupported selected media type: ${mediaType}`,
    );
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

function serverBoundReviewAttachmentScope(request, serverContext) {
  if (request.sourceChannel !== REVIEW_ATTACHMENT_SOURCE_CHANNEL) return null;
  const reviewAuthority = serverContext.runtimeIngestAuthority;
  if (
    reviewAuthority?.mode !== 'HOSTED_OAUTH_SESSION_REVIEW_ATTACHMENT' ||
    reviewAuthority.actorUserId !== serverContext.actorUserId ||
    reviewAuthority.tenantId !== serverContext.tenantId ||
    reviewAuthority.identityProvenance !== 'FEISHU_OAUTH_USER_ACCESS_TOKEN' ||
    reviewAuthority.sessionProvenance !== 'SERVER_OPAQUE_SESSION'
  ) {
    fail(
      'REVIEW_ATTACHMENT_INGEST_AUTHORITY_REQUIRED',
      'The reserved Review attachment source channel requires server-bound authority.',
    );
  }
  const sourceRef = required(request.sourceRef, 'request.sourceRef');
  const prefix = 'ATTACHMENT:';
  const refBody = sourceRef.startsWith(prefix)
    ? sourceRef.slice(prefix.length)
    : '';
  const separatorIndex = refBody.indexOf(':');
  const reviewConversationId =
    separatorIndex > 0 ? refBody.slice(0, separatorIndex).trim() : '';
  const requestRef =
    separatorIndex > 0 ? refBody.slice(separatorIndex + 1).trim() : '';
  if (
    !reviewConversationId ||
    !requestRef ||
    !String(reviewAuthority.workItemId || '').trim() ||
    !Number.isSafeInteger(reviewAuthority.expectedRevision) ||
    Number(reviewAuthority.expectedRevision) < 0
  ) {
    fail(
      'REVIEW_ATTACHMENT_SOURCE_SCOPE_INVALID',
      'Review attachment source scope is incomplete or malformed.',
    );
  }
  return {
    sourceChannel: REVIEW_ATTACHMENT_SOURCE_CHANNEL,
    reviewConversationId,
    requestRef,
    actorUserId: serverContext.actorUserId,
    tenantId: serverContext.tenantId,
    workItemId: reviewAuthority.workItemId.trim(),
    expectedRevision: Number(reviewAuthority.expectedRevision),
  };
}

function issuerFor(normalizedDescriptor) {
  const explicit = String(normalizedDescriptor.issuer || '').trim();
  if (explicit) return explicit.toUpperCase();
  const adapter = getDocumentFamilyAdapter(
    normalizedDescriptor.adapterRelease?.adapterId,
  );
  return (
    String(adapter?.issuerPolicy?.issuer || 'UNKNOWN')
      .trim()
      .toUpperCase() || 'UNKNOWN'
  );
}

function operationalCallerDescriptor(descriptor = {}, sourceChannel = '') {
  if (descriptor.sourceRuntimeJsonCopiedAsAuthority === true) {
    fail(
      'SOURCE_RUNTIME_JSON_FORBIDDEN',
      'Source runtime JSON authority import is forbidden.',
    );
  }
  if (descriptor.copiedIntoTargetRepository === true) {
    fail(
      'DOCS_UPLOADS_COPY_FORBIDDEN',
      'The request cannot claim that controlled source files were copied into the repository.',
    );
  }
  const operational = {};
  for (const key of ['accessControl', 'runtimeTraceContext']) {
    if (Object.hasOwn(descriptor, key)) {
      operational[key] = structuredClone(descriptor[key]);
    }
  }
  if (Object.hasOwn(descriptor, 'externalDiscovery')) {
    if (!EXTERNAL_DISCOVERY_SOURCE_CHANNELS.has(sourceChannel)) {
      fail(
        'EXTERNAL_DISCOVERY_SOURCE_CHANNEL_INVALID',
        'External discovery provenance requires a server-reserved source channel.',
      );
    }
    operational.externalDiscovery = structuredClone(
      descriptor.externalDiscovery,
    );
    operational.authorityClass = 'OEM_REFERENCE_ONLY';
    operational.engineeringConclusionAllowed = false;
    operational.applicabilityConclusionAllowed = false;
  }
  const ignoredCallerIdentityFields = CALLER_IDENTITY_FIELDS.filter((key) =>
    Object.hasOwn(descriptor, key),
  );
  return {
    ...operational,
    ...(ignoredCallerIdentityFields.length > 0
      ? { ignoredCallerIdentityFields }
      : {}),
  };
}

function parsedJsonField(row, materializedKey, jsonKey) {
  if (row?.[materializedKey] && typeof row[materializedKey] === 'object') {
    return row[materializedKey];
  }
  try {
    return JSON.parse(String(row?.[jsonKey] || ''));
  } catch {
    return null;
  }
}

function assertDescriptorIdentityReadback({
  acquisition,
  storedPreflight,
  normalizedDescriptor,
}) {
  const acquiredDescriptor = parsedJsonField(
    acquisition,
    'sourceDescriptor',
    'sourceDescriptorJson',
  );
  const storedNormalizedDescriptor = parsedJsonField(
    storedPreflight,
    'normalizedDescriptor',
    'normalizedDescriptorJson',
  );
  const expected = normalizedDescriptor;
  if (
    !acquiredDescriptor ||
    !storedNormalizedDescriptor ||
    acquiredDescriptor.documentCode !== expected.documentCode ||
    acquiredDescriptor.issuer !== expected.issuer ||
    Number(acquiredDescriptor.pageCount) !== expected.pageCount ||
    storedNormalizedDescriptor.documentCode !== expected.documentCode ||
    storedNormalizedDescriptor.canonicalDocumentFamily !==
      expected.canonicalDocumentFamily ||
    storedNormalizedDescriptor.issuer !== expected.issuer ||
    Number(storedNormalizedDescriptor.pageCount) !== expected.pageCount
  ) {
    fail(
      'DM_IDENTITY_READBACK_MISMATCH',
      'Acquisition/preflight readback did not preserve the DM-owned PDF identity.',
    );
  }
  return storedNormalizedDescriptor;
}

function identityReadback({
  family,
  version,
  normalizedDescriptor,
  sourceArtifactId,
}) {
  return {
    identityAuthority:
      normalizedDescriptor.identityAuthority ||
      'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
    canonicalIdentityKey: family?.canonicalIdentityKey || '',
    issuerAuthority: family?.issuerAuthority || normalizedDescriptor.issuer,
    documentFamily:
      family?.documentFamily || normalizedDescriptor.canonicalDocumentFamily,
    documentNumber:
      family?.canonicalDocumentNumber || normalizedDescriptor.documentCode,
    businessRevision:
      version?.businessRevision || normalizedDescriptor.businessRevision,
    revisionDate: version?.revisionDate || normalizedDescriptor.revisionDate,
    sourceGeneratedDate:
      version?.sourceGeneratedDate || normalizedDescriptor.sourceGeneratedDate,
    pageCount: normalizedDescriptor.pageCount,
    sourceArtifactId,
  };
}

function assertExactDocumentIdentity({
  family,
  version,
  familyIdentityKey,
  incoming,
}) {
  const expected = {
    canonicalIdentityKey: familyIdentityKey,
    issuerAuthority: incoming.issuerAuthority,
    documentFamily: incoming.documentTypeFamily,
    documentNumber: incoming.documentCode,
    canonicalRevisionIdentity: incoming.comparableVersion,
    businessRevision: incoming.businessRevision,
    revisionDate: incoming.revisionDate,
    sourceGeneratedDate: incoming.sourceGeneratedDate,
  };
  const actual = {
    canonicalIdentityKey: family?.canonicalIdentityKey || '',
    issuerAuthority: family?.issuerAuthority || '',
    documentFamily: family?.documentFamily || '',
    documentNumber: family?.canonicalDocumentNumber || '',
    canonicalRevisionIdentity: version?.canonicalRevisionIdentity || '',
    businessRevision: version?.businessRevision || '',
    revisionDate: version?.revisionDate || '',
    sourceGeneratedDate: version?.sourceGeneratedDate || '',
  };
  if (
    !family ||
    Object.keys(expected).some((key) => actual[key] !== expected[key])
  ) {
    fail(
      'CATALOG_EXACT_DOCUMENT_IDENTITY_CONFLICT',
      'Exact bytes already belong to Catalog identity that conflicts with the DM-owned actual PDF identity.',
      { expected, actual },
    );
  }
}

function sourceDescriptorForSelection({
  request,
  selected,
  immutable,
  actualSha256,
  pdfObservation,
}) {
  const sourceDescriptor = {
    ...operationalCallerDescriptor(
      request.descriptor || {},
      request.sourceChannel,
    ),
    ...pdfObservation,
    originalFilename: selected.fileName,
    mediaType: 'application/pdf',
    sha256: actualSha256,
    sizeBytes: selected.bytes.byteLength,
    sourceKind: request.sourceChannel || 'miaoda_file_service_selection',
    sourceStorageKey: `${immutable.bucketId}:${immutable.filePath}`,
    providerUpdatedAt: selected.providerUpdatedAt || null,
  };
  if (request.sourceChannel !== REVIEW_ATTACHMENT_SOURCE_CHANNEL) {
    return sourceDescriptor;
  }

  const filenameDocumentCode = documentIngressCodeFromFilename(
    selected.fileName,
  );
  // Review attachments have no caller-authoritative publication identity. Bind
  // their fallback identity to the FileService bytes after actual-byte
  // verification; retain a recognized controlled filename code when present.
  const documentCode =
    filenameDocumentCode || `REVIEW-ATTACHMENT-${actualSha256}`.toUpperCase();
  return {
    ...sourceDescriptor,
    originalFilename: selected.fileName,
    documentCode,
    documentFamily: 'OEM_REFERENCE',
    sourceType: 'oem_reference',
    issuer: 'UNKNOWN',
    businessRevision: 'R1',
    revisionDate: undefined,
    sourceGeneratedDate: undefined,
    documentCodeProvenance: {
      schemaVersion: 'wiselink.document_code_provenance.v1',
      source: 'controlled_metadata',
      candidates: [documentCode],
      inspectedSha256: actualSha256,
      conflict: false,
    },
    identityAuthority: 'DM_ACTUAL_PDF_LAYOUT_AND_SERVER_REVIEW_SCOPE',
  };
}

export class DocumentManagementHostedCore {
  constructor({
    artifactStore,
    catalog,
    authorizer,
    pdfLayoutExtractor = new PdfjsDistLayoutExtractor(),
    now = () => new Date().toISOString(),
  } = {}) {
    if (
      !artifactStore ||
      !catalog ||
      !authorizer ||
      typeof pdfLayoutExtractor?.extractLayout !== 'function'
    ) {
      fail(
        'HOSTED_DOCUMENT_MANAGEMENT_NOT_CONFIGURED',
        'ArtifactStore, DocumentCatalog, PDF layout extractor, and server-bound authorizer are required.',
      );
    }
    this.artifactStore = artifactStore;
    this.catalog = catalog;
    this.authorizer = authorizer;
    this.pdfLayoutExtractor = pdfLayoutExtractor;
    this.now = now;
  }

  async ingestFileServiceSelection(request = {}, serverContext = {}) {
    rejectSelfReportedAuthority(request);
    const actorUserId = required(
      serverContext.actorUserId,
      'serverContext.actorUserId',
    );
    const tenantId = required(serverContext.tenantId, 'serverContext.tenantId');
    const requestIdempotencyKey = required(
      request.idempotencyKey,
      'request.idempotencyKey',
    );
    const scopedIdempotencyKey = tenantScopedIdempotencyKey(
      tenantId,
      requestIdempotencyKey,
    );
    const scopedAcquisitionId = deterministicId(
      'acquisition',
      scopedIdempotencyKey,
    );
    const legacyAcquisitionId = deterministicId(
      'acquisition',
      tenantId,
      requestIdempotencyKey,
    );
    let idempotencyKey = scopedIdempotencyKey;
    let acquisitionId = scopedAcquisitionId;
    const selection = {
      bucketId: required(
        request.selection?.bucketId,
        'request.selection.bucketId',
      ),
      filePath: required(
        request.selection?.filePath,
        'request.selection.filePath',
      ),
    };
    const reviewAttachmentScope = serverBoundReviewAttachmentScope(
      request,
      serverContext,
    );
    await this.authorizer.assertCanIngest({
      actorUserId,
      tenantId,
      roles: Array.isArray(serverContext.roles) ? [...serverContext.roles] : [],
      action: 'DOCUMENT_INGEST',
      selection,
      ...(serverContext.runtimeIngestAuthority
        ? {
            runtimeIngestAuthority: structuredClone(
              serverContext.runtimeIngestAuthority,
            ),
          }
        : {}),
    });

    let existingIngestion = await this.catalog.findIngestionByIdempotency({
      idempotencyKey,
      expectedAcquisitionId: scopedAcquisitionId,
      tenantId,
      sourceChannel: request.sourceChannel,
      sourceRef: request.sourceRef,
      selection: request.selection,
    });
    if (!existingIngestion) {
      const legacyIngestion = await this.catalog.findIngestionByIdempotency({
        idempotencyKey: requestIdempotencyKey,
        expectedAcquisitionId: legacyAcquisitionId,
        tenantId,
        sourceChannel: request.sourceChannel,
        sourceRef: request.sourceRef,
        selection: request.selection,
      });
      if (legacyIngestion?.acquisitionId === legacyAcquisitionId) {
        existingIngestion = legacyIngestion;
        idempotencyKey = requestIdempotencyKey;
        acquisitionId = legacyAcquisitionId;
      }
    }
    const commitIdempotencyKey = `catalog:${acquisitionId}`;
    let incompleteIngestion = null;
    if (existingIngestion) {
      if (existingIngestion.status === 'INCOMPLETE') {
        incompleteIngestion = existingIngestion;
      } else if (existingIngestion.status !== 'COMMITTED') {
        fail(
          'INGESTION_REPLAY_STATE_INVALID',
          'Idempotent replay returned an unsupported state.',
        );
      } else {
        return {
          ...existingIngestion,
          disposition: 'IDEMPOTENT_REPLAY',
          newDocumentVersionCreated: false,
          currentnessChanged: false,
          catalogFreshReadVerified: true,
        };
      }
    }

    const selected = await this.artifactStore.readSelection(request.selection);
    assertPdfMediaType(selected.mediaType);
    const pdfByteView = controlledPdfByteView(selected.bytes);
    const actualSha256 = sha256Hex(selected.bytes);
    if (
      actualSha256 !== selected.sha256 ||
      selected.bytes.byteLength !== selected.byteLength
    ) {
      fail(
        'SELECTION_ACTUAL_BYTE_MISMATCH',
        'Selection receipt does not match actual bytes.',
      );
    }
    const inspectionSha256 = sha256Hex(pdfByteView.bytes);
    let pdfLayout;
    try {
      const inspectLayout =
        typeof this.pdfLayoutExtractor.extractLayoutWithDiagnostics ===
        'function'
          ? this.pdfLayoutExtractor.extractLayoutWithDiagnostics.bind(
              this.pdfLayoutExtractor,
            )
          : this.pdfLayoutExtractor.extractLayout.bind(this.pdfLayoutExtractor);
      pdfLayout = inspectLayout(pdfByteView.bytes);
    } catch (error) {
      fail(
        'DM_PDF_LAYOUT_INSPECTION_FAILED',
        'The existing production PDF layout extractor could not inspect the selected actual bytes.',
        {
          causeCode: error?.code || error?.name || 'UNKNOWN',
          causeMessage: String(error?.message || error),
        },
      );
    }
    const actualByteLength = selected.bytes.byteLength;
    const inspectionByteLength = pdfByteView.bytes.byteLength;
    const pageCount = readActualPdfPageCount({
      layout: pdfLayout,
      actualSha256,
      actualByteLength,
      inspectionSha256,
      inspectionByteLength,
    });
    const pdfObservation = reviewAttachmentScope
      ? {
          pageCount,
          pdfByteView: {
            normalization: pdfByteView.normalization,
            offset: pdfByteView.offset,
            inspectionSha256,
            inspectionByteLength,
            actualSha256,
            actualByteLength,
          },
        }
      : resolveActualPdfDocumentIdentity({
          layout: pdfLayout,
          actualSha256,
          actualByteLength,
          inspectionSha256,
          inspectionByteLength,
          byteViewOffset: pdfByteView.offset,
          byteViewNormalization: pdfByteView.normalization,
          originalFilename: selected.fileName,
        });
    const sourceArtifactId = deterministicId(
      'source_artifact',
      actualSha256,
      selected.bytes.byteLength,
    );
    const immutable = await this.artifactStore.persistImmutableSource({
      bytes: selected.bytes,
      sha256: actualSha256,
      byteLength: selected.bytes.byteLength,
      mediaType: 'application/pdf',
    });
    if (!immutable.readbackVerified) {
      fail(
        'IMMUTABLE_READBACK_REQUIRED',
        'Canonical FileService source lacks actual-byte readback.',
      );
    }
    if (immutable.reusedExisting === true && !incompleteIngestion) {
      if (typeof this.catalog.assertImmutableSourceReuseSafe !== 'function') {
        fail(
          'IMMUTABLE_SOURCE_REUSE_CATALOG_CHECK_REQUIRED',
          'Reusing an existing immutable source requires a fresh Catalog state check.',
        );
      }
      const reuse = await this.catalog.assertImmutableSourceReuseSafe({
        sourceArtifactId,
        acquisitionId,
        idempotencyKey,
        sha256: actualSha256,
        byteLength: selected.bytes.byteLength,
        mediaType: 'application/pdf',
        bucketId: immutable.bucketId,
        filePath: immutable.filePath,
        providerObjectId: immutable.providerObjectId,
        providerVersionId: immutable.providerVersionId,
        ...(reviewAttachmentScope
          ? { serverBoundReviewAttachmentScope: reviewAttachmentScope }
          : {}),
      });
      if (
        reuse?.disposition !== 'ORPHAN_RECOVERY_ALLOWED' &&
        reuse?.disposition !== 'CATALOGED_SOURCE_REUSE_ALLOWED' &&
        reuse?.disposition !== 'REVIEW_ATTACHMENT_RESIDUAL_RECOVERY_ALLOWED'
      ) {
        fail(
          'IMMUTABLE_SOURCE_REUSE_STATE_INVALID',
          'Catalog did not return one supported immutable-source reuse disposition.',
        );
      }
    }

    const acquiredAt = this.now();
    const sourceDescriptor = sourceDescriptorForSelection({
      request,
      selected,
      immutable,
      actualSha256,
      pdfObservation,
    });
    const sourceArtifactRecord = {
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
    };
    const acquisitionRecord = {
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
    };
    let acquisition = acquisitionRecord;
    if (!incompleteIngestion) {
      acquisition = await this.catalog.recordAcquisition({
        sourceArtifact: sourceArtifactRecord,
        acquisition: acquisitionRecord,
      });
    }

    const normalizedDescriptor = normalizeUploadDescriptor(sourceDescriptor);
    if (
      normalizedDescriptor.sha256 !== actualSha256 ||
      normalizedDescriptor.sizeBytes !== selected.bytes.byteLength ||
      normalizedDescriptor.pageCount !== pageCount ||
      (!reviewAttachmentScope &&
        (normalizedDescriptor.documentCode !== pdfObservation.documentCode ||
          normalizedDescriptor.canonicalDocumentFamily !==
            pdfObservation.documentFamily ||
          normalizedDescriptor.issuer !== pdfObservation.issuer ||
          normalizedDescriptor.adapterRelease?.adapterId !==
            pdfObservation.documentFamilyAdapterId))
    ) {
      fail(
        'DM_PDF_IDENTITY_NORMALIZATION_MISMATCH',
        'Legacy descriptor normalization did not preserve the DM-owned actual PDF observation.',
      );
    }
    const documents = await this.catalog.listIngressDocuments({ tenantId });
    const decision = buildGovernedDocumentIngressPreflightDecision({
      generatedAt: this.now(),
      documents,
      rawDescriptor: sourceDescriptor,
      normalizedDescriptor,
    });
    const issuerAuthority = issuerFor(normalizedDescriptor);
    const businessFamilyIdentityKey = decision.incoming.identityResolved
      ? `${issuerAuthority}|${decision.incoming.documentTypeFamily}|${decision.incoming.documentCode}`
      : '';
    const familyIdentityKey = businessFamilyIdentityKey
      ? tenantScopedFamilyIdentityKey(tenantId, businessFamilyIdentityKey)
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
    const preflightRecord = {
      preflightId,
      acquisitionId: acquisition.acquisitionId,
      decision: decision.decision,
      branch: decision.branch,
      executionAuthorized: false,
      observedCurrentGeneration: observedFamily?.currentGeneration || 0,
      observedCurrentDocumentVersionId:
        observedFamily?.currentDocumentVersionId || null,
      normalizedDescriptor,
      decisionPayload: decision,
      status: 'READY',
      createdAt: this.now(),
    };
    let storedPreflight = preflightRecord;
    if (!incompleteIngestion) {
      storedPreflight = await this.catalog.recordPreflight(preflightRecord);
      assertDescriptorIdentityReadback({
        acquisition,
        storedPreflight,
        normalizedDescriptor,
      });
    } else if (decision.decision !== 'INGEST_NEW_FAMILY') {
      fail(
        'INCOMPLETE_INGESTION_RECOVERY_DECISION_UNSUPPORTED',
        'Narrow residual recovery only supports the original new-family commit path.',
      );
    }

    if (EXACT_LINK_DECISIONS.has(decision.decision)) {
      const exactVersion = await this.catalog.findExactDocumentVersion({
        sha256: actualSha256,
        byteLength: selected.bytes.byteLength,
        tenantId,
      });
      if (!exactVersion) {
        fail(
          'EXACT_DOCUMENT_VERSION_NOT_FOUND',
          `${decision.decision} requires one exact DocumentVersion.`,
        );
      }
      const exactFamily = await this.catalog.readFamily(exactVersion.familyId);
      if (!reviewAttachmentScope) {
        assertExactDocumentIdentity({
          family: exactFamily,
          version: exactVersion,
          familyIdentityKey,
          incoming: {
            ...decision.incoming,
            issuerAuthority,
          },
        });
      }
      await this.catalog.linkAcquisitionToVersion({
        acquisitionId: acquisition.acquisitionId,
        documentVersionId: exactVersion.documentVersionId,
        preflightId,
        idempotencyKey: commitIdempotencyKey,
      });
      const linkedVersion = await this.catalog.readDocumentVersion(
        exactVersion.documentVersionId,
      );
      const linkedFamily = linkedVersion
        ? await this.catalog.readFamily(linkedVersion.familyId)
        : null;
      if (
        !linkedVersion ||
        !linkedFamily ||
        linkedVersion.sourceArtifactId !== sourceArtifactId ||
        linkedVersion.pdfSha256 !== actualSha256 ||
        Number(linkedVersion.byteLength) !== selected.bytes.byteLength ||
        (!reviewAttachmentScope &&
          linkedFamily.canonicalIdentityKey !== familyIdentityKey)
      ) {
        fail(
          'CATALOG_FRESH_READ_MISMATCH',
          'Exact-link Catalog fresh read does not prove the source bytes and DM identity.',
        );
      }
      return {
        acquisitionId: acquisition.acquisitionId,
        sourceArtifactId,
        preflightId,
        decision: decision.decision,
        disposition: decision.decision,
        familyId: linkedFamily.familyId,
        documentVersionId: linkedVersion.documentVersionId,
        newDocumentVersionCreated: false,
        currentnessChanged: false,
        immutableReadbackVerified: true,
        catalogFreshReadVerified: true,
        identityReadback: identityReadback({
          family: linkedFamily,
          version: linkedVersion,
          normalizedDescriptor,
          sourceArtifactId,
        }),
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
        identityReadback: {
          identityAuthority: normalizedDescriptor.identityAuthority || '',
          documentFamily: normalizedDescriptor.canonicalDocumentFamily,
          documentNumber: normalizedDescriptor.documentCode,
          businessRevision: normalizedDescriptor.businessRevision,
          revisionDate: normalizedDescriptor.revisionDate,
          sourceGeneratedDate: normalizedDescriptor.sourceGeneratedDate,
          pageCount: normalizedDescriptor.pageCount,
          sourceArtifactId,
        },
      };
    }
    if (
      normalizedDescriptor.canonicalDocumentFamily === 'GENERIC' ||
      !decision.incoming.identityResolved ||
      !decision.incoming.versionOrderResolved
    ) {
      fail(
        'IDENTITY_NOT_COMMITTABLE',
        'Canonical commit requires non-GENERIC resolved identity and version.',
      );
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
    if (incompleteIngestion) {
      if (immutable.reusedExisting !== true) {
        fail(
          'INCOMPLETE_INGESTION_RECOVERY_IMMUTABLE_REQUIRED',
          'Residual recovery requires the exact pre-existing immutable FileService object.',
        );
      }
      if (
        typeof this.catalog.assertIncompleteIngestionRecoverySafe !== 'function'
      ) {
        fail(
          'INCOMPLETE_INGESTION_RECOVERY_CHECK_REQUIRED',
          'Residual recovery requires a fresh Catalog and WorkItem state check.',
        );
      }
      const recovery = await this.catalog.assertIncompleteIngestionRecoverySafe(
        {
          sourceArtifact: sourceArtifactRecord,
          acquisition: acquisitionRecord,
          preflight: preflightRecord,
          downstream: {
            familyId,
            canonicalIdentityKey: familyIdentityKey,
            documentId,
            documentVersionId,
          },
        },
      );
      if (recovery?.disposition !== 'INCOMPLETE_INGESTION_RECOVERY_ALLOWED') {
        fail(
          'INCOMPLETE_INGESTION_RECOVERY_STATE_INVALID',
          'Catalog did not return the supported residual recovery disposition.',
        );
      }
      acquisition = recovery.acquisition;
    }
    const committedAt = this.now();
    const commit = await this.catalog.commitNewVersion({
      idempotencyKey: commitIdempotencyKey,
      preflightId,
      preflightDecision: decision.decision,
      observedCurrentGeneration: observedFamily?.currentGeneration || 0,
      observedCurrentDocumentVersionId:
        observedFamily?.currentDocumentVersionId || null,
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
    const freshVersion = await this.catalog.readDocumentVersion(
      commit.documentVersionId,
    );
    const freshFamily = await this.catalog.readFamily(commit.familyId);
    if (
      !freshVersion ||
      freshVersion.pdfSha256 !== actualSha256 ||
      freshVersion.byteLength !== selected.bytes.byteLength ||
      freshVersion.sourceArtifactId !== sourceArtifactId ||
      freshFamily?.canonicalIdentityKey !== familyIdentityKey ||
      freshFamily?.issuerAuthority !== issuerAuthority ||
      freshFamily?.documentFamily !== decision.incoming.documentTypeFamily ||
      freshFamily?.canonicalDocumentNumber !== decision.incoming.documentCode ||
      freshFamily?.currentDocumentVersionId !== freshVersion.documentVersionId
    ) {
      fail(
        'CATALOG_FRESH_READ_MISMATCH',
        'Hosted Catalog fresh read does not prove exact version/currentness.',
      );
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
      identityReadback: identityReadback({
        family: freshFamily,
        version: freshVersion,
        normalizedDescriptor,
        sourceArtifactId,
      }),
    };
  }
}
