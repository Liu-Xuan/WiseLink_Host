import {
  normalizeBoeingBulletinDocumentIdentity,
  normalizeDescriptorDocumentFamily,
  normalizeDocumentIngressRevisionDate,
  normalizeUploadDescriptor,
} from './uploadDescriptor.js';

// Migrated from apps/api/src/productSurfaceRuntime.js at WiseLink codex/0-11
// HEAD 77615d745eb999e89caf0a0c4bcd29d8712d33e8. The decision order and
// persisted-document projection are retained. The old actor visibility accessor
// is deliberately replaced by an explicit documents input owned by this module.

const CONTROLLED_CODE_PROVENANCE_SOURCES = new Set([
  'pdf_text_first_three_pages',
  'controlled_metadata',
]);

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asDocumentMap(documents) {
  if (documents instanceof Map) return documents;
  if (Array.isArray(documents)) {
    return new Map(documents.map((document) => [
      normalizeString(document?.documentId || document?.id),
      document,
    ]));
  }
  return new Map();
}

export function contentIdentityFromDescriptor(descriptor = {}) {
  const sha256 = normalizeString(descriptor.sha256).toLowerCase();
  const sizeBytes = Number(descriptor.sizeBytes || 0);
  return {
    sha256: /^[a-f0-9]{64}$/u.test(sha256) ? sha256 : '',
    sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
  };
}

export function contentIdentityFromDocument(document = {}) {
  return contentIdentityFromDescriptor({
    sha256: document?.detail?.sha256 || document?.upload?.descriptorSummary?.sha256,
    sizeBytes: document?.detail?.sizeBytes || document?.upload?.descriptorSummary?.sizeBytes,
  });
}

export function findExactDocumentsByContentIdentity(documents, descriptor = {}) {
  const documentMap = asDocumentMap(documents);
  const descriptorIdentity = contentIdentityFromDescriptor(descriptor);
  if (!descriptorIdentity.sha256 || descriptorIdentity.sizeBytes <= 0) return [];
  return Array.from(documentMap.values()).filter((document) => {
    const documentIdentity = contentIdentityFromDocument(document);
    return documentIdentity.sha256 === descriptorIdentity.sha256
      && documentIdentity.sizeBytes === descriptorIdentity.sizeBytes;
  });
}

export function normalizeDocumentIngressCode(value = '') {
  const candidate = normalizeString(value).toUpperCase();
  if (!candidate || candidate.length < 3 || candidate.length > 160) return '';
  if (!/^[A-Z0-9][A-Z0-9._/ -]*[A-Z0-9]$/u.test(candidate)) return '';
  if (candidate.includes('..') || /\s{2,}/u.test(candidate)) return '';
  return candidate;
}

export function documentIngressCodeFromFilename(filename = '') {
  const upperFilename = normalizeString(filename).toUpperCase();
  return normalizeDocumentIngressCode(
    upperFilename.match(/(?:^|[^A-Z0-9])([A-Z0-9]+-FTD-\d{2}-\d{5})(?=[^A-Z0-9]|$)/u)?.[1]
      || upperFilename.match(/(?:^|[^A-Z0-9])((?:AD|CAD|EAD)[-_ ]?\d{4}[-_ ]\d{2}[-_ ]\d{2})(?=[^A-Z0-9]|$)/u)?.[1]?.replace(/[ _]+/gu, '-')
      || '',
  );
}

export function documentIngressIdentityFromDescriptor(
  descriptor = {},
  normalizedDescriptor = {},
  { storedDocument = false } = {},
) {
  const filename = normalizeString(
    descriptor.originalFilename || descriptor.fileName || normalizedDescriptor.originalFilename,
  );
  const upperFilename = filename.toUpperCase();
  const normalizedBoeingBulletinIdentity = normalizeBoeingBulletinDocumentIdentity({
    documentCode: descriptor.documentCode,
    canonicalDocumentFamily:
      normalizedDescriptor.canonicalDocumentFamily || normalizedDescriptor.documentFamily,
    sourceType: normalizedDescriptor.sourceType,
  });
  const rawExplicitCode = normalizeString(normalizedBoeingBulletinIdentity.documentCode).toUpperCase();
  const explicitCode = normalizeDocumentIngressCode(rawExplicitCode);
  const filenameCode = documentIngressCodeFromFilename(filename);
  const provenance = asPlainObject(descriptor.documentCodeProvenance);
  const provenanceSource = normalizeString(
    provenance.source || descriptor.documentCodeSource,
  ).toLowerCase();
  const provenanceInspectedSha256 = normalizeString(provenance.inspectedSha256).toLowerCase();
  const rawProvenanceCandidates = Array.isArray(provenance.candidates) ? provenance.candidates : [];
  const provenanceCandidates = [...new Set(
    rawProvenanceCandidates
      .map((value) => normalizeDocumentIngressCode(
        normalizeBoeingBulletinDocumentIdentity({
          documentCode: value,
          canonicalDocumentFamily:
            normalizedDescriptor.canonicalDocumentFamily || normalizedDescriptor.documentFamily,
          sourceType: normalizedDescriptor.sourceType,
        }).documentCode,
      ))
      .filter(Boolean),
  )];
  const identityIssues = [];
  const identityConflicts = [];
  if (rawExplicitCode && !explicitCode) identityConflicts.push('DOCUMENT_CODE_FORMAT_INVALID');
  if (rawProvenanceCandidates.length !== provenanceCandidates.length) {
    identityConflicts.push('DOCUMENT_CODE_PROVENANCE_FORMAT_INVALID');
  }
  if (provenance.conflict === true || provenanceCandidates.length > 1) {
    identityConflicts.push('DOCUMENT_CODE_CANDIDATES_CONFLICT');
  }
  if (explicitCode && filenameCode && explicitCode !== filenameCode) {
    identityConflicts.push('DOCUMENT_CODE_FILENAME_CONFLICT');
  }
  if (explicitCode && provenanceCandidates.length === 1 && provenanceCandidates[0] !== explicitCode) {
    identityConflicts.push('DOCUMENT_CODE_PROVENANCE_CONFLICT');
  }

  let documentCode = explicitCode || filenameCode;
  let resolvedProvenanceSource = '';
  if (storedDocument && explicitCode && provenanceSource === 'stored_document') {
    resolvedProvenanceSource = 'stored_document';
  } else if (explicitCode && filenameCode === explicitCode) {
    resolvedProvenanceSource = 'filename_pattern';
  } else if (
    explicitCode
    && provenance.schemaVersion === 'wiselink.document_code_provenance.v1'
    && CONTROLLED_CODE_PROVENANCE_SOURCES.has(provenanceSource)
    && provenanceCandidates.length === 1
    && provenanceCandidates[0] === explicitCode
    && provenanceInspectedSha256 === normalizeString(descriptor.sha256).toLowerCase()
    && provenance.conflict !== true
  ) {
    resolvedProvenanceSource = provenanceSource;
  } else if (explicitCode) {
    identityIssues.push('DOCUMENT_CODE_PROVENANCE_UNVERIFIED');
  } else if (!rawExplicitCode && filenameCode) {
    resolvedProvenanceSource = 'filename_pattern';
  } else {
    documentCode = '';
    identityIssues.push('DOCUMENT_CODE_UNRESOLVED');
  }

  const filenameGeneratedDate =
    upperFilename.match(/(?:^|[_-])DOC[_-]?(\d{8})(?:\.[A-Z0-9]+)?$/u)?.[1] || '';
  const revisionDate = normalizeDocumentIngressRevisionDate(
    descriptor.revisionDate
      || descriptor.lastRevisedDate
      || descriptor.metadata?.revisionDate
      || descriptor.metadata?.lastRevisedDate
      || normalizedDescriptor.revisionDate,
  );
  const rawExplicitSourceGeneratedDate = normalizeString(
    descriptor.sourceGeneratedDate
      || descriptor.generatedDate
      || descriptor.metadata?.sourceGeneratedDate
      || descriptor.metadata?.generatedDate
      || normalizedDescriptor.sourceGeneratedDate,
  );
  const explicitSourceGeneratedDate =
    normalizeDocumentIngressRevisionDate(rawExplicitSourceGeneratedDate);
  const filenameSourceGeneratedDate =
    normalizeDocumentIngressRevisionDate(filenameGeneratedDate);
  const sourceGeneratedDateConflict = Boolean(
    explicitSourceGeneratedDate
      && filenameSourceGeneratedDate
      && explicitSourceGeneratedDate !== filenameSourceGeneratedDate,
  );
  const sourceGeneratedDateExplicitInvalid = Boolean(
    rawExplicitSourceGeneratedDate && !explicitSourceGeneratedDate,
  );
  const sourceGeneratedDate = explicitSourceGeneratedDate || filenameSourceGeneratedDate;
  const sourceGeneratedDateControlled = Boolean(sourceGeneratedDate)
    && !sourceGeneratedDateConflict
    && !sourceGeneratedDateExplicitInvalid
    && Boolean(filenameSourceGeneratedDate);
  const filenameRevision =
    upperFilename.match(/(?:^|[_\s-])R(?:EV)?[_\s-]?(\d{1,4})(?:[^A-Z0-9]|$)/u)?.[1] || '';
  const businessRevision = normalizeString(
    descriptor.businessRevision
      || descriptor.revisionLabel
      || descriptor.metadata?.businessRevision
      || descriptor.metadata?.revisionLabel
      || normalizedDescriptor.businessRevision
      || normalizedBoeingBulletinIdentity.businessRevision
      || (filenameRevision ? `R${Number(filenameRevision)}` : ''),
  ).toUpperCase();
  const canonicalDocumentFamily = normalizeDescriptorDocumentFamily(
    normalizedDescriptor.canonicalDocumentFamily || normalizedDescriptor.documentFamily,
  ) || 'GENERIC';
  const comparableVersion = revisionDate
    ? `DATE:${revisionDate}`
    : /^R\d{1,4}$/u.test(businessRevision)
      ? `REV:${String(Number(businessRevision.slice(1))).padStart(8, '0')}`
      : sourceGeneratedDateControlled
        ? `GENERATED:${sourceGeneratedDate}`
        : '';

  return {
    schemaVersion: 'wiselink.0_10.document_ingress_identity.v1',
    documentCode,
    revisionFamilyKey: documentCode,
    documentTypeFamily: canonicalDocumentFamily,
    businessRevision,
    revisionDate,
    sourceGeneratedDate,
    sourceGeneratedDateProvenance: {
      schemaVersion: 'wiselink.source_generated_date_provenance.v1',
      source: sourceGeneratedDateConflict
        ? 'conflict'
        : sourceGeneratedDateExplicitInvalid
          ? 'invalid_explicit_value'
          : explicitSourceGeneratedDate && filenameSourceGeneratedDate
            ? 'descriptor_and_filename'
            : filenameSourceGeneratedDate
              ? 'filename_pattern'
              : explicitSourceGeneratedDate
                ? 'descriptor_only'
                : 'unresolved',
      controlled: sourceGeneratedDateControlled,
      explicitValue: explicitSourceGeneratedDate,
      filenameValue: filenameSourceGeneratedDate,
      conflict: sourceGeneratedDateConflict,
      explicitValueInvalid: sourceGeneratedDateExplicitInvalid,
    },
    comparableVersion,
    documentCodeProvenance: {
      schemaVersion: 'wiselink.document_code_provenance.v1',
      source: resolvedProvenanceSource || provenanceSource || 'unresolved',
      sourceVerified: Boolean(resolvedProvenanceSource),
      explicitProvided: Boolean(rawExplicitCode),
      filenameCandidate: filenameCode,
      candidates: provenanceCandidates,
      inspectedContentIdentityMatches:
        provenanceInspectedSha256 === normalizeString(descriptor.sha256).toLowerCase(),
    },
    identityIssues: [...new Set(identityIssues)],
    identityConflicts: [...new Set(identityConflicts)],
    identityConflict: identityConflicts.length > 0,
    identityResolved: Boolean(documentCode)
      && Boolean(resolvedProvenanceSource)
      && identityConflicts.length === 0,
    versionOrderResolved: Boolean(comparableVersion),
  };
}

export function documentIngressIdentityFromDocument(document = {}) {
  const descriptor = {
    ...asPlainObject(document.upload?.descriptorSummary),
    documentCode: document.detail?.documentCode,
    originalFilename: document.detail?.originalFilename,
    documentFamily:
      document.detail?.canonicalDocumentFamily || document.detail?.documentFamily,
    businessRevision:
      document.detail?.businessRevision || document.upload?.descriptorSummary?.businessRevision,
    revisionDate:
      document.detail?.revisionDate || document.upload?.descriptorSummary?.revisionDate,
    sourceGeneratedDate:
      document.detail?.sourceGeneratedDate
        || document.upload?.descriptorSummary?.sourceGeneratedDate,
    documentCodeProvenance: {
      schemaVersion: 'wiselink.document_code_provenance.v1',
      source: 'stored_document',
      candidates: [document.detail?.documentCode].filter(Boolean),
      conflict: false,
    },
  };
  return documentIngressIdentityFromDescriptor(
    descriptor,
    normalizeUploadDescriptor(descriptor),
    { storedDocument: true },
  );
}

export function documentIngressAnalysisReusable(document = {}) {
  const revisionId = normalizeString(document.detail?.revisionId);
  const selectedRevisionId = normalizeString(
    document.ownerActionState?.pipeline?.selectedReplacementRevisionId,
  );
  return document.report?.status === 'visible'
    && document.detail?.status === 'report_ready'
    && document.documentAnalysisWorkbenchView?.status === 'summary_only_ready'
    && Boolean(revisionId)
    && selectedRevisionId === revisionId;
}

export function compareDocumentIngressVersions(incomingIdentity = {}, existingIdentity = {}) {
  const incoming = normalizeString(incomingIdentity.comparableVersion);
  const existing = normalizeString(existingIdentity.comparableVersion);
  const sameControlledSourceGeneratedDate = Boolean(
    incomingIdentity.sourceGeneratedDateProvenance?.controlled === true
      && existingIdentity.sourceGeneratedDateProvenance?.controlled === true
      && normalizeString(incomingIdentity.sourceGeneratedDate)
      && normalizeString(incomingIdentity.sourceGeneratedDate)
        === normalizeString(existingIdentity.sourceGeneratedDate),
  );
  if (!incoming || !existing) return sameControlledSourceGeneratedDate ? 0 : null;
  const incomingKind = incoming.split(':', 1)[0];
  const existingKind = existing.split(':', 1)[0];
  if (incomingKind !== existingKind) return sameControlledSourceGeneratedDate ? 0 : null;
  return incoming === existing ? 0 : (incoming > existing ? 1 : -1);
}

export function buildDocumentIngressExistingSummary(document = {}, identity = {}) {
  return {
    documentId: normalizeString(document.documentId),
    documentCode: normalizeString(document.detail?.documentCode),
    documentTypeFamily: normalizeString(identity.documentTypeFamily),
    revisionFamilyKey: normalizeString(identity.revisionFamilyKey),
    businessRevision: normalizeString(identity.businessRevision),
    revisionDate: normalizeString(identity.revisionDate),
    sourceGeneratedDate: normalizeString(identity.sourceGeneratedDate),
    processingRevisionId: normalizeString(
      document.ownerActionState?.pipeline?.selectedReplacementRevisionId
        || document.detail?.revisionId,
    ),
    status: normalizeString(document.detail?.status),
    analysisReusable: documentIngressAnalysisReusable(document),
    workbenchPath: `/documents/${encodeURIComponent(document.documentId)}/analysis`,
  };
}

export function buildDocumentIngressPreflightDecision({
  generatedAt,
  documents,
  normalizedDescriptor,
  rawDescriptor,
} = {}) {
  const documentMap = asDocumentMap(documents);
  const incomingIdentity =
    documentIngressIdentityFromDescriptor(rawDescriptor, normalizedDescriptor);
  const visibleDocuments = Array.from(documentMap.values());
  const exactDocuments =
    findExactDocumentsByContentIdentity(visibleDocuments, normalizedDescriptor);
  const exactDocument = exactDocuments.length === 1 ? exactDocuments[0] : null;
  const exactIdentity =
    exactDocument ? documentIngressIdentityFromDocument(exactDocument) : null;
  const familyDocuments = incomingIdentity.revisionFamilyKey
    ? visibleDocuments.filter((document) => (
      documentIngressIdentityFromDocument(document).revisionFamilyKey
        === incomingIdentity.revisionFamilyKey
    ))
    : [];
  const familyRows = familyDocuments.map((document) => {
    const identity = documentIngressIdentityFromDocument(document);
    return {
      document,
      identity,
      summary: buildDocumentIngressExistingSummary(document, identity),
    };
  });
  const comparableFamilyRows = familyRows
    .filter((row) => row.identity.comparableVersion)
    .sort((left, right) => (
      right.identity.comparableVersion.localeCompare(left.identity.comparableVersion)
    ));
  const unversionedFamilyRows = familyRows.filter((row) => !row.identity.comparableVersion);
  const leadingComparableVersion =
    normalizeString(comparableFamilyRows[0]?.identity?.comparableVersion);
  const currentHeadRows = leadingComparableVersion
    ? comparableFamilyRows.filter(
      (row) => row.identity.comparableVersion === leadingComparableVersion,
    )
    : familyRows;
  const currentFamilyRow = currentHeadRows.length === 1 ? currentHeadRows[0] : null;

  let decision;
  let reason;
  let requiresUserConfirmation = false;
  let shouldProcess = false;
  const conflicts = [];
  if (incomingIdentity.identityConflict) {
    decision = 'DOCUMENT_IDENTITY_CONFLICT';
    reason = 'The supplied document code is invalid or conflicts with its controlled provenance.';
    requiresUserConfirmation = true;
    conflicts.push(...incomingIdentity.identityConflicts);
  } else if (!incomingIdentity.identityResolved) {
    decision = 'DOCUMENT_IDENTITY_UNRESOLVED';
    reason = 'The document code and revision family could not be resolved from verified provenance before ingestion.';
    requiresUserConfirmation = true;
  } else if (exactDocuments.length > 1) {
    decision = 'MULTIPLE_EXACT_MATCHES';
    reason = 'More than one visible WiseLink document has the same content identity; automatic reuse is blocked.';
    requiresUserConfirmation = true;
    conflicts.push('CONTENT_IDENTITY_NOT_UNIQUE');
  } else if (exactDocument) {
    decision = documentIngressAnalysisReusable(exactDocument)
      ? 'REUSE_EXACT'
      : 'RESUME_EXISTING_PROCESS';
    reason = decision === 'REUSE_EXACT'
      ? 'The identical content identity already has a reusable WiseLink analysis; no upload or parse is required.'
      : 'The identical content identity already exists but its current processing result is not reusable; resume the existing process without creating another document.';
    requiresUserConfirmation = decision === 'RESUME_EXISTING_PROCESS';
  } else if (familyRows.length === 0) {
    decision = 'INGEST_NEW_FAMILY';
    reason = 'No visible WiseLink document exists for the resolved revision family.';
    shouldProcess = true;
  } else if (unversionedFamilyRows.length > 0) {
    decision = 'VERSION_ORDER_UNKNOWN';
    reason = 'At least one visible family document has no trusted comparable version; the current family head cannot be proven.';
    requiresUserConfirmation = true;
  } else if (currentHeadRows.length > 1) {
    decision = 'MULTIPLE_CURRENT_HEADS';
    reason = 'More than one visible family document has the same leading comparable version; automatic version ordering is blocked.';
    requiresUserConfirmation = true;
    conflicts.push('CURRENT_FAMILY_HEAD_NOT_UNIQUE');
  } else {
    const comparison =
      compareDocumentIngressVersions(incomingIdentity, currentFamilyRow?.identity);
    if (comparison === null) {
      decision = 'VERSION_ORDER_UNKNOWN';
      reason = 'The incoming and current family versions cannot be ordered deterministically.';
      requiresUserConfirmation = true;
    } else if (comparison > 0) {
      decision = 'INGEST_NEW_REVISION';
      reason = 'The incoming version is newer than the current visible family version.';
      shouldProcess = true;
    } else if (comparison < 0) {
      decision = 'ASK_IMPORT_OLDER_REVISION';
      reason = 'The incoming version is older than the current visible family version.';
      requiresUserConfirmation = true;
    } else {
      decision = 'SAME_REVISION_CONTENT_CONFLICT';
      reason = 'The same business version has a different content identity and requires explicit engineering review.';
      requiresUserConfirmation = true;
      conflicts.push('SAME_REVISION_DIFFERENT_CONTENT');
    }
  }

  const branch = decision === 'REUSE_EXACT'
    ? 'REUSE_EXACT'
    : ['INGEST_NEW_FAMILY', 'INGEST_NEW_REVISION'].includes(decision)
      ? 'INGEST'
      : [
        'SAME_REVISION_CONTENT_CONFLICT',
        'DOCUMENT_IDENTITY_CONFLICT',
        'MULTIPLE_EXACT_MATCHES',
        'MULTIPLE_CURRENT_HEADS',
      ].includes(decision)
        ? 'CONFLICT'
        : 'ASK';

  return {
    schemaVersion: 'wiselink.0_10.document_ingress_preflight_decision.v1',
    status: 'preflight_decision_ready',
    generatedAt,
    incoming: {
      ...incomingIdentity,
      sha256: normalizedDescriptor.sha256,
      sizeBytes: normalizedDescriptor.sizeBytes,
      originalFilename: normalizedDescriptor.originalFilename,
    },
    decision,
    branch,
    disposition: decision,
    reason,
    conflicts: [...new Set(conflicts)],
    exactMatch: exactDocument
      ? buildDocumentIngressExistingSummary(exactDocument, exactIdentity)
      : null,
    currentFamilyDocument: currentFamilyRow?.summary || null,
    relatedFamilyDocuments: familyRows.map((row) => row.summary),
    requiresUserConfirmation,
    shouldProcess,
    executionAuthorized: false,
    reuseExistingAnalysis: decision === 'REUSE_EXACT',
    resumeExistingProcess: decision === 'RESUME_EXISTING_PROCESS',
    noMutationProof: {
      documentCreated: false,
      ingestRunCreated: false,
      parsingTriggered: false,
      providerPublicationTriggered: false,
      rawPdfBytesPersisted: false,
    },
    authorityBoundary: {
      createsEvidenceRef: false,
      createsClosureDecision: false,
      createsActionReadiness: false,
      approvesRelease: false,
      signsCompliance: false,
    },
  };
}

// Governance delta over the migrated preflight: GENERIC is a restricted
// candidate and cannot silently create a canonical family or current head.
export function buildGovernedDocumentIngressPreflightDecision(input = {}) {
  const migratedDecision = buildDocumentIngressPreflightDecision(input);
  if (
    migratedDecision.incoming.documentTypeFamily !== 'GENERIC'
    && input.normalizedDescriptor?.canonicalDocumentFamily !== 'GENERIC'
  ) {
    const branch = migratedDecision.decision === 'REUSE_EXACT'
      ? 'REUSE'
      : ['INGEST_NEW_FAMILY', 'INGEST_NEW_REVISION'].includes(migratedDecision.decision)
        ? 'COMMIT_CANDIDATE'
        : ['SAME_REVISION_CONTENT_CONFLICT', 'DOCUMENT_IDENTITY_CONFLICT'].includes(
          migratedDecision.decision,
        )
          ? 'QUARANTINE'
          : ['MULTIPLE_EXACT_MATCHES', 'MULTIPLE_CURRENT_HEADS'].includes(
            migratedDecision.decision,
          )
            ? 'BLOCK'
            : migratedDecision.decision === 'RESUME_EXISTING_PROCESS'
              ? 'RESUME'
              : 'REVIEW';
    return {
      ...migratedDecision,
      branch,
      shouldProcess: migratedDecision.decision === 'RESUME_EXISTING_PROCESS'
        ? true
        : migratedDecision.shouldProcess,
      requiresUserConfirmation: [
        'DOCUMENT_IDENTITY_UNRESOLVED',
        'VERSION_ORDER_UNKNOWN',
        'ASK_IMPORT_OLDER_REVISION',
      ].includes(migratedDecision.decision),
    };
  }
  return {
    ...migratedDecision,
    decision: 'GENERIC_REVIEW_REQUIRED',
    disposition: 'GENERIC_REVIEW_REQUIRED',
    branch: 'REVIEW',
    reason: 'GENERIC classification is a restricted candidate and requires governed family promotion.',
    requiresUserConfirmation: true,
    shouldProcess: false,
    executionAuthorized: false,
    reuseExistingAnalysis: false,
    resumeExistingProcess: false,
  };
}
