import { createHash } from 'node:crypto';

const PACKAGE_SCHEMA = 'techpub.parsed-package.v1';
const CONTRACT_REVISION = 'frozen.2';
const PACKAGE_SCHEMA_ID = 'urn:techpub:schema:v1:parsed-package:frozen-2';
const ARTIFACT_SCHEMA = 'techpub.artifact-record.v1';
const ARTIFACT_SCHEMA_ID = 'urn:techpub:schema:v1:artifact-record:frozen-2';
const HASH = /^sha256:[0-9a-f]{64}$/u;
const PACKAGE_ID = /^urn:techpub:package:v1:sha256:[0-9a-f]{64}$/u;
const CLASSIFICATION_SCHEMA =
  'wiselink.v3_1.document_classification_envelope.v1';

export interface UnifiedParsedPackageArtifactRecord {
  $schema: string;
  schemaVersion: string;
  contractRevision: string;
  artifactRef: string;
  mediaType: string;
  byteLength: number;
  artifactHash: string;
  packageId: string;
  contentHash: string;
}

export interface SbClassificationBinding {
  schemaVersion: string;
  classificationId: string;
  classificationHash: string;
  status:
    | 'CONFIRMED'
    | 'AMBIGUOUS'
    | 'UNKNOWN'
    | 'OCR_REQUIRED'
    | 'IDENTITY_INCOMPLETE'
    | 'CATALOG_ONLY';
  normalizedFamily: string | null;
  issuer: string | null;
  subtype: string | null;
  profileId: string | null;
  nativeParseProfileId: string | null;
}

export interface DocumentVersionUnifiedArtifactBinding {
  documentId: string;
  documentVersionId: string;
  artifactRecord: UnifiedParsedPackageArtifactRecord;
  lifecycleStatus: 'FROZEN';
  selectionStatus: 'SELECTED';
  isCurrent: true;
  classification: SbClassificationBinding;
}

export interface UnifiedParsedPackageReadback {
  schemaVersion: 'wiselink.v3_1.sb_assessment.unified_parsed_package_readback.v1';
  status: 'READY';
  documentId: string;
  documentVersionId: string;
  packageId: string;
  packageContentHash: string;
  packageSemanticHash: string;
  packageProvenanceHash: string;
  packageCoverageHash: string;
  artifactRef: string;
  artifactHash: string;
  artifactVersionStatus: 'PENDING_DM_VERSIONED_REF_ENVELOPE';
  ownerDocumentIdentityBindingStatus:
    | 'VERIFIED_FROM_PACKAGE_LEGACY_IDENTIFIERS'
    | 'DELEGATED_TO_ACCEPTED_ARTIFACT_ENVELOPE';
  sourceKind: 'pdf' | 'native_s1000d';
  sourcePackageId: string;
  sourceArtifactHash: string;
  documentCode: string;
  title: string;
  revisionLabel: string | null;
  resultStatus: 'complete' | 'partial';
  contentUnitCount: number;
  sourceRefCount: number;
  applicabilitySourceExpressions: Array<{
    expressionId: string;
    text: string;
    sourceRefIds: string[];
  }>;
  classification: SbClassificationBinding;
  authorityBoundary: {
    candidateOnly: true;
    documentApplicabilityProvesFleetApplicability: false;
    createsFleetFact: false;
    createsEvidenceRef: false;
    createsEngineerDecision: false;
    createsClosureDecision: false;
  };
}

/**
 * Assessment-side anti-corruption reader for the already frozen public U0
 * package. The canonical U0 repository remains the only full Schema/semantic
 * validator. This reader rechecks the exact stored bytes, immutable package
 * identities, SB routing, SourceRef closure and no-authority boundary at the
 * consumer seam. It never imports PDF/S1000D producer-private models.
 */
export function readFrozenUnifiedParsedPackageForSbAssessment(
  binding: DocumentVersionUnifiedArtifactBinding,
  artifactBytes: Uint8Array,
): UnifiedParsedPackageReadback {
  assertDocumentVersionBinding(binding);
  const record = binding.artifactRecord;
  if (record.$schema !== ARTIFACT_SCHEMA_ID
    || record.schemaVersion !== ARTIFACT_SCHEMA
    || record.contractRevision !== CONTRACT_REVISION
    || record.mediaType !== 'application/json') {
    throw new Error('UNIFIED_ARTIFACT_RECORD_CONTRACT_MISMATCH');
  }
  if (record.byteLength !== artifactBytes.byteLength) {
    throw new Error('UNIFIED_ARTIFACT_BYTE_LENGTH_MISMATCH');
  }
  const artifactHash = sha256(artifactBytes);
  if (record.artifactHash !== artifactHash) {
    throw new Error('UNIFIED_ARTIFACT_BYTES_HASH_MISMATCH');
  }
  const rawText = new TextDecoder('utf-8', { fatal: true }).decode(artifactBytes);
  assertNoDuplicateJsonKeys(rawText);
  const parsed: unknown = JSON.parse(rawText);
  const pkg = recordValue(parsed, 'package');
  if (pkg.$schema !== PACKAGE_SCHEMA_ID
    || pkg.schemaVersion !== PACKAGE_SCHEMA
    || pkg.contractRevision !== CONTRACT_REVISION) {
    throw new Error('UNIFIED_PACKAGE_CONTRACT_MISMATCH');
  }
  const packageId = packageIdValue(pkg.packageId, 'packageId');
  const integrity = recordValue(pkg.integrity, 'integrity');
  const contentHash = hashValue(integrity.contentHash, 'integrity.contentHash');
  const recomputedContentHash = sha256(
    new TextEncoder().encode(canonicalJson(contentView(pkg))),
  );
  if (packageId !== `urn:techpub:package:v1:${contentHash}`
    || record.packageId !== packageId
    || record.contentHash !== contentHash
    || recomputedContentHash !== contentHash) {
    throw new Error('UNIFIED_PACKAGE_ARTIFACT_IDENTITY_MISMATCH');
  }
  const semanticHash = hashValue(
    integrity.semanticHash,
    'integrity.semanticHash',
  );
  const provenanceHash = hashValue(
    integrity.provenanceHash,
    'integrity.provenanceHash',
  );
  const coverageHash = hashValue(
    integrity.coverageHash,
    'integrity.coverageHash',
  );
  const result = recordValue(pkg.result, 'result');
  const resultStatus = enumValue(
    result.status,
    ['complete', 'partial'] as const,
    'result.status',
  );
  if (resultStatus === 'complete'
    && (result.accountingComplete !== true
      || result.contentPreserved !== true
      || result.structuredCoverageComplete !== true)) {
    throw new Error('UNIFIED_PACKAGE_FALSE_COMPLETE');
  }
  const source = recordValue(pkg.source, 'source');
  const sourceKind = enumValue(
    source.kind,
    ['pdf', 'native_s1000d'] as const,
    'source.kind',
  );
  const sourceArtifactHash = hashValue(
    source.sourcePackageHash,
    'source.sourcePackageHash',
  );
  const ownerDocumentIdentityBindingStatus = bindOwnerDocumentIdentity(
    source,
    binding,
  );
  const sourceRefs = recordArray(pkg.sourceRefs, 'sourceRefs');
  const sourceRefIds = new Set<string>();
  for (const [index, value] of sourceRefs.entries()) {
    const ref = recordValue(value, `sourceRefs[${index}]`);
    const refId = requiredText(ref.sourceRefId, `sourceRefs[${index}].sourceRefId`);
    if (sourceRefIds.has(refId)) throw new Error('UNIFIED_SOURCE_REF_DUPLICATE');
    sourceRefIds.add(refId);
  }
  const document = recordValue(pkg.document, 'document');
  const documentType = sourcedString(
    recordValue(document.documentType, 'document.documentType'),
    sourceRefIds,
    'document.documentType',
  );
  if (documentType !== 'service_bulletin') {
    throw new Error('NOT_APPLICABLE_FOR_SB_ASSESSMENT');
  }
  const contentUnits = recordArray(pkg.contentUnits, 'contentUnits');
  if (contentUnits.length === 0) throw new Error('UNIFIED_CONTENT_UNITS_EMPTY');
  for (const [index, value] of contentUnits.entries()) {
    const unit = recordValue(value, `contentUnits[${index}]`);
    const refs = stringArray(unit.sourceRefIds, `contentUnits[${index}].sourceRefIds`);
    if (refs.length === 0 || refs.some((ref) => !sourceRefIds.has(ref))) {
      throw new Error(`UNIFIED_CONTENT_UNIT_SOURCE_REF_INVALID:${index}`);
    }
    hashValue(unit.unitHash, `contentUnits[${index}].unitHash`);
  }
  const applicability = recordValue(pkg.applicability, 'applicability');
  const applicabilitySourceExpressions = recordArray(
    applicability.sourceExpressions,
    'applicability.sourceExpressions',
  ).map((value, index) => {
    const expression = recordValue(
      value,
      `applicability.sourceExpressions[${index}]`,
    );
    const refs = stringArray(
      expression.sourceRefIds,
      `applicability.sourceExpressions[${index}].sourceRefIds`,
    );
    if (refs.length === 0 || refs.some((ref) => !sourceRefIds.has(ref))) {
      throw new Error(`UNIFIED_APPLICABILITY_SOURCE_REF_INVALID:${index}`);
    }
    return {
      expressionId: requiredText(
        expression.expressionId,
        `applicability.sourceExpressions[${index}].expressionId`,
      ),
      text: requiredText(
        expression.text,
        `applicability.sourceExpressions[${index}].text`,
      ),
      sourceRefIds: refs,
    };
  });
  const documentCode = selectDocumentCode(document, sourceRefIds);
  const revision = optionalRecord(document.revision, 'document.revision');
  const revisionLabel = revision
    ? sourcedString(
        recordValue(revision.label, 'document.revision.label'),
        sourceRefIds,
        'document.revision.label',
      )
    : null;
  return deepFreeze({
    schemaVersion:
      'wiselink.v3_1.sb_assessment.unified_parsed_package_readback.v1',
    status: 'READY',
    documentId: binding.documentId,
    documentVersionId: binding.documentVersionId,
    packageId,
    packageContentHash: contentHash,
    packageSemanticHash: semanticHash,
    packageProvenanceHash: provenanceHash,
    packageCoverageHash: coverageHash,
    artifactRef: requiredText(record.artifactRef, 'artifactRecord.artifactRef'),
    artifactHash,
    artifactVersionStatus: 'PENDING_DM_VERSIONED_REF_ENVELOPE',
    ownerDocumentIdentityBindingStatus,
    sourceKind,
    sourcePackageId: requiredText(source.sourcePackageId, 'source.sourcePackageId'),
    sourceArtifactHash,
    documentCode,
    title: sourcedString(
      recordValue(document.title, 'document.title'),
      sourceRefIds,
      'document.title',
    ),
    revisionLabel,
    resultStatus,
    contentUnitCount: contentUnits.length,
    sourceRefCount: sourceRefs.length,
    applicabilitySourceExpressions,
    classification: structuredClone(binding.classification),
    authorityBoundary: {
      candidateOnly: true,
      documentApplicabilityProvesFleetApplicability: false,
      createsFleetFact: false,
      createsEvidenceRef: false,
      createsEngineerDecision: false,
      createsClosureDecision: false,
    },
  });
}

function bindOwnerDocumentIdentity(
  source: Record<string, unknown>,
  binding: DocumentVersionUnifiedArtifactBinding,
): UnifiedParsedPackageReadback['ownerDocumentIdentityBindingStatus'] {
  const identifiers = recordArray(
    source.legacyIdentifiers,
    'source.legacyIdentifiers',
  ).map((value, index) => {
    const identifier = recordValue(
      value,
      `source.legacyIdentifiers[${index}]`,
    );
    return {
      namespace: requiredText(
        identifier.namespace,
        `source.legacyIdentifiers[${index}].namespace`,
      ),
      value: requiredText(
        identifier.value,
        `source.legacyIdentifiers[${index}].value`,
      ),
    };
  });
  const relevant = identifiers.filter((identifier) => [
    'wiselink_document_id',
    'wiselink_document_version_id',
  ].includes(identifier.namespace));
  if (relevant.length === 0) {
    return 'DELEGATED_TO_ACCEPTED_ARTIFACT_ENVELOPE';
  }
  const byNamespace = new Map(relevant.map((identifier) => [
    identifier.namespace,
    identifier.value,
  ]));
  if (byNamespace.size !== relevant.length
    || byNamespace.get('wiselink_document_id') !== binding.documentId
    || byNamespace.get('wiselink_document_version_id')
      !== binding.documentVersionId) {
    throw new Error('UNIFIED_PACKAGE_OWNER_DOCUMENT_IDENTITY_MISMATCH');
  }
  return 'VERIFIED_FROM_PACKAGE_LEGACY_IDENTIFIERS';
}

export function classifySbAssessmentDisposition(
  classification: SbClassificationBinding,
):
  | 'ELIGIBLE_AFTER_SELECTED_CURRENT_PACKAGE'
  | 'NOT_APPLICABLE_FOR_SB_ASSESSMENT'
  | 'BLOCKED_CLASSIFICATION'
  | 'WAITING_CLASSIFICATION'
  | 'UNSUPPORTED_FAMILY' {
  if (classification.schemaVersion !== CLASSIFICATION_SCHEMA) {
    return 'WAITING_CLASSIFICATION';
  }
  if (classification.status === 'CONFIRMED') {
    return classification.normalizedFamily === 'SB'
      ? 'ELIGIBLE_AFTER_SELECTED_CURRENT_PACKAGE'
      : 'NOT_APPLICABLE_FOR_SB_ASSESSMENT';
  }
  if (classification.status === 'AMBIGUOUS') return 'BLOCKED_CLASSIFICATION';
  if (classification.status === 'CATALOG_ONLY') return 'UNSUPPORTED_FAMILY';
  return 'WAITING_CLASSIFICATION';
}

function assertDocumentVersionBinding(
  binding: DocumentVersionUnifiedArtifactBinding,
): void {
  requiredText(binding.documentId, 'documentId');
  requiredText(binding.documentVersionId, 'documentVersionId');
  if (binding.lifecycleStatus !== 'FROZEN'
    || binding.selectionStatus !== 'SELECTED'
    || binding.isCurrent !== true) {
    throw new Error('UNIFIED_PACKAGE_NOT_FROZEN_SELECTED_CURRENT');
  }
  const disposition = classifySbAssessmentDisposition(binding.classification);
  if (disposition !== 'ELIGIBLE_AFTER_SELECTED_CURRENT_PACKAGE') {
    throw new Error(disposition);
  }
  requiredText(binding.classification.classificationId, 'classificationId');
  hashValue(binding.classification.classificationHash, 'classificationHash');
}

function selectDocumentCode(
  document: Record<string, unknown>,
  sourceRefIds: Set<string>,
): string {
  const identifiers = recordArray(document.identifiers, 'document.identifiers');
  const supportedSchemes = ['oem_document_code', 's1000d_dmc'];
  for (const scheme of supportedSchemes) {
    const match = identifiers
      .map((value, index) => recordValue(value, `document.identifiers[${index}]`))
      .find((identifier) => identifier.scheme === scheme);
    if (match) {
      assertClosedSourceRefs(
        match.sourceRefIds,
        sourceRefIds,
        `document.identifier.${scheme}.sourceRefIds`,
      );
      return requiredText(match.value, `document.identifier.${scheme}`);
    }
  }
  throw new Error('UNIFIED_SB_DOCUMENT_CODE_MISSING');
}

function sourcedString(
  value: Record<string, unknown>,
  knownSourceRefIds: Set<string>,
  field: string,
): string {
  assertClosedSourceRefs(
    value.sourceRefIds,
    knownSourceRefIds,
    `${field}.sourceRefIds`,
  );
  return requiredText(value.value, `${field}.value`);
}

function assertClosedSourceRefs(
  value: unknown,
  knownSourceRefIds: Set<string>,
  field: string,
): void {
  const sourceRefIds = stringArray(value, field);
  if (sourceRefIds.length === 0
    || sourceRefIds.some((sourceRefId) => !knownSourceRefIds.has(sourceRefId))) {
    throw new Error(`UNIFIED_SOURCED_VALUE_REFS_INVALID:${field}`);
  }
}

function contentView(value: Record<string, unknown>): Record<string, unknown> {
  const copy = stripArtifactLocations(value) as Record<string, unknown>;
  delete copy.packageId;
  delete copy.integrity;
  const lineage = copy.lineage;
  if (lineage && typeof lineage === 'object' && !Array.isArray(lineage)) {
    delete (lineage as Record<string, unknown>).generatedAt;
  }
  return copy;
}

function stripArtifactLocations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripArtifactLocations);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, item]) =>
          key !== 'artifactRef' && key !== 'originalPath' && item !== undefined,
        )
        .map(([key, item]) => [key, stripArtifactLocations(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown, path = '$'): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    assertValidUnicode(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`UNIFIED_JCS_NUMBER_INVALID:${path}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalJson(item, `${path}[${index}]`)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => {
      assertValidUnicode(key, `${path}.key`);
      return `${JSON.stringify(key)}:${canonicalJson(item, `${path}.${key}`)}`;
    }).join(',')}}`;
  }
  throw new Error(`UNIFIED_JCS_VALUE_INVALID:${path}`);
}

function assertValidUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`UNIFIED_JCS_UNICODE_INVALID:${path}`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`UNIFIED_JCS_UNICODE_INVALID:${path}`);
    }
  }
}

function assertNoDuplicateJsonKeys(text: string): void {
  // JSON.parse silently accepts duplicate keys. Rejecting them is part of the
  // frozen contract; use a compact lexical scan before parsing.
  const stack: Array<Set<string> | null> = [];
  let index = 0;
  let expectingKey = false;
  let pendingKey: string | null = null;
  while (index < text.length) {
    const char = text[index];
    if (/\s/u.test(char)) { index += 1; continue; }
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue; }
        if (text[index] === '"') break;
        index += 1;
      }
      if (index >= text.length) throw new Error('UNIFIED_PACKAGE_JSON_INVALID');
      const literal = text.slice(start, index + 1);
      index += 1;
      if (expectingKey) pendingKey = JSON.parse(literal) as string;
      continue;
    }
    if (char === '{') {
      stack.push(new Set());
      expectingKey = true;
      pendingKey = null;
      index += 1;
      continue;
    }
    if (char === '[') {
      stack.push(null);
      expectingKey = false;
      pendingKey = null;
      index += 1;
      continue;
    }
    if (char === ':') {
      const keys = stack.at(-1);
      if (!(keys instanceof Set) || pendingKey === null) {
        throw new Error('UNIFIED_PACKAGE_JSON_INVALID');
      }
      if (keys.has(pendingKey)) throw new Error(`UNIFIED_PACKAGE_DUPLICATE_KEY:${pendingKey}`);
      keys.add(pendingKey);
      expectingKey = false;
      pendingKey = null;
      index += 1;
      continue;
    }
    if (char === ',') {
      expectingKey = stack.at(-1) instanceof Set;
      pendingKey = null;
      index += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      stack.pop();
      expectingKey = false;
      pendingKey = null;
      index += 1;
      continue;
    }
    index += 1;
  }
}

function sha256(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function hashValue(value: unknown, field: string): string {
  const text = requiredText(value, field);
  if (!HASH.test(text)) throw new Error(`UNIFIED_HASH_INVALID:${field}`);
  return text;
}

function packageIdValue(value: unknown, field: string): string {
  const text = requiredText(value, field);
  if (!PACKAGE_ID.test(text)) throw new Error(`UNIFIED_PACKAGE_ID_INVALID:${field}`);
  return text;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`UNIFIED_TEXT_REQUIRED:${field}`);
  }
  return value;
}

function recordValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`UNIFIED_OBJECT_REQUIRED:${field}`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(
  value: unknown,
  field: string,
): Record<string, unknown> | null {
  return value === undefined ? null : recordValue(value, field);
}

function recordArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`UNIFIED_ARRAY_REQUIRED:${field}`);
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`UNIFIED_STRING_ARRAY_REQUIRED:${field}`);
  }
  return value as string[];
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`UNIFIED_ENUM_INVALID:${field}`);
  }
  return value as T[number];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
