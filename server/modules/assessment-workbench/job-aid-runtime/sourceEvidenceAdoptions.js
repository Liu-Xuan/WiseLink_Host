import { sha256 } from './rulePack.js';

export const WISELINK_V3_1_SB_JOB_AID_EVIDENCE_PATCH_CONSUMPTION_SCHEMA =
  'wiselink.v3_1.sb_job_aid.evidence_patch_consumption.v1';
export const WISELINK_V3_1_SB_JOB_AID_EVIDENCE_REF_SCHEMA =
  'wiselink.v3_1.sb_job_aid.evidence_ref.v1';

const STORED_ADOPTION_SCHEMA =
  'wiselink.v3_1.sb_job_aid.source_evidence_adoption.v1';
const ENGINEER_ADOPTED_AUTHORITY = 'engineer_adopted_candidate';

export function consumeFeishuEvidencePatchRecords({
  records,
  assessmentPackage,
} = {}) {
  if (!Array.isArray(records)) throw new TypeError('Evidence Patch records must be an array.');
  assertBaselinePackage(assessmentPackage);
  const normalized = records.map((record, index) => normalizePatchRecord({
    record,
    index,
    assessmentPackage,
  }));
  normalized.sort((left, right) => left.patchId.localeCompare(right.patchId));
  const patchIds = new Set();
  const candidateKeys = new Set();
  for (const patch of normalized) {
    if (patchIds.has(patch.patchId)) {
      throw new Error(`EVIDENCE_PATCH_ID_DUPLICATE:${patch.patchId}`);
    }
    patchIds.add(patch.patchId);
    for (const entry of patch.entries) {
      const key = `${entry.evaluationItemId}:${entry.sourceEvidenceCandidate.candidateId}`;
      if (candidateKeys.has(key)) {
        throw new Error(`EVIDENCE_PATCH_CANDIDATE_DUPLICATE:${key}`);
      }
      candidateKeys.add(key);
    }
  }
  return normalized;
}

export function applySourceEvidenceAdoptions({
  evaluationItems,
  baselinePackageId,
  baselineContentHash,
  evidencePatches = [],
} = {}) {
  if (!Array.isArray(evaluationItems)) throw new TypeError('evaluationItems must be an array.');
  if (!Array.isArray(evidencePatches)) throw new TypeError('evidencePatches must be an array.');
  if (evidencePatches.length === 0) {
    return {
      evaluationItems,
      evidencePatchBinding: null,
    };
  }
  requiredText(baselinePackageId, 'baselinePackageId');
  assertSha256Identity(baselineContentHash, 'baselineContentHash');
  const itemByCriterion = new Map(
    evaluationItems.map((item) => [item.criterion_id, structuredClone(item)]),
  );
  const refsByCriterion = new Map();
  const patchIds = [];
  for (const patch of evidencePatches) {
    assertNormalizedPatch(patch, baselinePackageId, baselineContentHash);
    patchIds.push(patch.patchId);
    for (const entry of patch.entries) {
      const item = itemByCriterion.get(entry.criterionId);
      if (!item) throw new Error(`EVIDENCE_PATCH_CRITERION_NOT_FOUND:${entry.criterionId}`);
      const expectedItemId = `${baselinePackageId}:${entry.criterionId}`;
      if (entry.evaluationItemId !== expectedItemId) {
        throw new Error(`EVIDENCE_PATCH_EVALUATION_ITEM_ID_MISMATCH:${entry.evaluationItemId}`);
      }
      const candidate = item.source_evidence_candidates.find(
        (value) => value.candidateId === entry.sourceEvidenceCandidate.candidateId,
      );
      if (!candidate || candidateCoreIdentity(candidate) !== candidateCoreIdentity(
        entry.sourceEvidenceCandidate,
      )) {
        throw new Error(
          `EVIDENCE_PATCH_CANDIDATE_IDENTITY_MISMATCH:${entry.sourceEvidenceCandidate.candidateId}`,
        );
      }
      const evidenceRef = buildEvidenceRef({ patch, entry, candidate });
      const refs = refsByCriterion.get(entry.criterionId) ?? [];
      refsByCriterion.set(entry.criterionId, [...refs, evidenceRef]);
    }
  }

  for (const [criterionId, refs] of refsByCriterion) {
    const item = itemByCriterion.get(criterionId);
    const sortedRefs = [...refs].sort((left, right) => (
      left.evidenceRefId.localeCompare(right.evidenceRefId)
    ));
    item.evidence_refs = sortedRefs;
    if (criterionId === 'CLS-001' && allCurrentCandidatesAdopted(item, sortedRefs)) {
      item.evidence_requirements = item.evidence_requirements.map((requirement) => ({
        ...requirement,
        status: 'RESOLVED',
        resolution: 'ENGINEER_ADOPTED_SOURCE_EVIDENCE',
        evidence_ref_ids: sortedRefs.map((ref) => ref.evidenceRefId),
      }));
      item.rationale = `${item.rationale} 工程师已显式采纳当前全部来源候选；仍需独立工程师最终确认。`;
    }
  }

  return {
    evaluationItems: evaluationItems.map((item) => itemByCriterion.get(item.criterion_id)),
    evidencePatchBinding: {
      schemaVersion: WISELINK_V3_1_SB_JOB_AID_EVIDENCE_PATCH_CONSUMPTION_SCHEMA,
      sourceAssessmentPackageId: baselinePackageId,
      sourceAssessmentContentHash: baselineContentHash,
      patchIds: [...new Set(patchIds)].sort(),
      evidenceRefCount: [...refsByCriterion.values()].reduce(
        (count, refs) => count + refs.length,
        0,
      ),
    },
  };
}

function normalizePatchRecord({ record, index, assessmentPackage }) {
  const fields = record?.fields ?? record?.record;
  if (!fields || typeof fields !== 'object') {
    throw new TypeError(`Evidence Patch record ${index} has no fields.`);
  }
  const recordId = requiredText(record.record_id ?? record.id, `records[${index}].record_id`);
  const patchId = requiredText(cell(fields.patch_id), `${recordId}.patch_id`);
  if (requiredText(cell(fields.package_id), `${recordId}.package_id`) !== assessmentPackage.packageId) {
    throw new Error(`EVIDENCE_PATCH_PACKAGE_ID_MISMATCH:${patchId}`);
  }
  if (requiredText(cell(fields.patch_type), `${recordId}.patch_type`) !== 'new_evidence') {
    throw new Error(`EVIDENCE_PATCH_TYPE_NOT_CONSUMABLE:${patchId}`);
  }
  if (requiredText(cell(fields.validation_status), `${recordId}.validation_status`) !== 'validated') {
    throw new Error(`EVIDENCE_PATCH_NOT_VALIDATED:${patchId}`);
  }
  if (cell(fields.applied_to_package) !== false) {
    throw new Error(`EVIDENCE_PATCH_ALREADY_APPLIED_OR_INVALID:${patchId}`);
  }
  if (requiredText(cell(fields.source_type), `${recordId}.source_type`) !== 'manual'
    || requiredText(cell(fields.source_agent), `${recordId}.source_agent`)
      !== 'MIAODA_ENGINEER_REVIEW') {
    throw new Error(`EVIDENCE_PATCH_PRODUCER_NOT_AUTHORIZED:${patchId}`);
  }
  const affectedCriteria = parseJsonArray(
    fields.affected_criteria_ids,
    `${recordId}.affected_criteria_ids`,
  );
  if (affectedCriteria.length !== 1 || typeof affectedCriteria[0] !== 'string') {
    throw new Error(`EVIDENCE_PATCH_CRITERION_CARDINALITY_INVALID:${patchId}`);
  }
  const entries = parseJsonArray(fields.evidence_refs_json, `${recordId}.evidence_refs_json`);
  if (entries.length === 0) throw new Error(`EVIDENCE_PATCH_ENTRIES_EMPTY:${patchId}`);
  const criterionId = affectedCriteria[0];
  const item = assessmentPackage.evaluationItems.find(
    (value) => value.criterion_id === criterionId,
  );
  if (!item) throw new Error(`EVIDENCE_PATCH_CRITERION_NOT_FOUND:${criterionId}`);
  const normalizedEntries = entries.map((entry, entryIndex) => normalizeStoredEntry({
    entry,
    entryIndex,
    patchId,
    criterionId,
    item,
    assessmentPackage,
  }));
  const candidateIds = normalizedEntries.map(
    (entry) => entry.sourceEvidenceCandidate.candidateId,
  );
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error(`EVIDENCE_PATCH_CANDIDATE_DUPLICATE:${patchId}`);
  }
  return {
    schemaVersion: WISELINK_V3_1_SB_JOB_AID_EVIDENCE_PATCH_CONSUMPTION_SCHEMA,
    patchId,
    baseRecordId: recordId,
    sourceAssessmentPackageId: assessmentPackage.packageId,
    sourceAssessmentContentHash: assessmentPackage.contentHash,
    criterionId,
    evaluationItemId: `${assessmentPackage.packageId}:${criterionId}`,
    validationNote: requiredText(cell(fields.validation_note), `${recordId}.validation_note`),
    validatedBy: normalizeActorRefs(fields.validated_by, `${recordId}.validated_by`),
    createdAt: normalizeTimestamp(fields.created_at, `${recordId}.created_at`),
    entries: normalizedEntries,
  };
}

function normalizeStoredEntry({
  entry,
  entryIndex,
  patchId,
  criterionId,
  item,
  assessmentPackage,
}) {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError(`Evidence Patch ${patchId} entry ${entryIndex} must be an object.`);
  }
  if (entry.schemaVersion !== STORED_ADOPTION_SCHEMA
    || entry.authorityLevel !== ENGINEER_ADOPTED_AUTHORITY
    || entry.createsEvidenceRef !== false
    || entry.assessmentPackageId !== assessmentPackage.packageId
    || entry.assessmentContentHash !== assessmentPackage.contentHash
    || entry.evaluationItemId !== `${assessmentPackage.packageId}:${criterionId}`
    || entry.criterionId !== criterionId) {
    throw new Error(`EVIDENCE_PATCH_ENTRY_IDENTITY_MISMATCH:${patchId}:${entryIndex}`);
  }
  const candidate = item.source_evidence_candidates.find(
    (value) => value.candidateId === entry.sourceEvidenceCandidate?.candidateId,
  );
  if (!candidate || candidateCoreIdentity(candidate)
    !== candidateCoreIdentity(entry.sourceEvidenceCandidate)) {
    throw new Error(`EVIDENCE_PATCH_ENTRY_SOURCE_DRIFT:${patchId}:${entryIndex}`);
  }
  return {
    schemaVersion: STORED_ADOPTION_SCHEMA,
    assessmentPackageId: assessmentPackage.packageId,
    assessmentContentHash: assessmentPackage.contentHash,
    evaluationItemId: `${assessmentPackage.packageId}:${criterionId}`,
    criterionId,
    sourceEvidenceCandidate: structuredClone(entry.sourceEvidenceCandidate),
    authorityLevel: ENGINEER_ADOPTED_AUTHORITY,
    createsEvidenceRef: false,
  };
}

function buildEvidenceRef({ patch, entry, candidate }) {
  const identity = {
    schemaVersion: WISELINK_V3_1_SB_JOB_AID_EVIDENCE_REF_SCHEMA,
    authorityLevel: 'engineer_adopted',
    provenanceType: 'structured_source_candidate',
    patchId: patch.patchId,
    sourceAssessmentPackageId: patch.sourceAssessmentPackageId,
    sourceAssessmentContentHash: patch.sourceAssessmentContentHash,
    criterionId: entry.criterionId,
    candidateId: candidate.candidateId,
    structuredObjectId: candidate.structuredObjectId,
    structuredObjectHash: candidate.structuredObjectHash,
    fieldPath: candidate.fieldPath,
    pageRange: structuredClone(candidate.pageRange),
    sourceRefs: structuredClone(candidate.sourceRefs),
  };
  const digest = sha256(canonicalJson(identity));
  return {
    ...identity,
    evidenceRefId: `EREF-${digest.slice(0, 24).toUpperCase()}`,
    validationNote: patch.validationNote,
    validatedBy: structuredClone(patch.validatedBy),
    adoptedAt: patch.createdAt,
  };
}

function allCurrentCandidatesAdopted(item, refs) {
  if (!Array.isArray(item.source_evidence_candidates)
    || item.source_evidence_candidates.length === 0) return false;
  const adopted = new Set(refs.map((ref) => ref.candidateId));
  return item.source_evidence_candidates.every((candidate) => adopted.has(candidate.candidateId));
}

function candidateCoreIdentity(value) {
  if (!value || typeof value !== 'object'
    || value.authorityLevel !== 'candidate_only'
    || value.createsEvidenceRef !== false
    || value.sourceBounded !== true
    || !Array.isArray(value.sourceRefs)
    || value.sourceRefs.length === 0) {
    throw new Error('SOURCE_EVIDENCE_CANDIDATE_NOT_CONSUMABLE');
  }
  return canonicalJson({
    schemaVersion: value.schemaVersion,
    candidateId: value.candidateId,
    routerVersion: value.routerVersion,
    bindingRoles: value.bindingRoles,
    predicatePaths: value.predicatePaths,
    requiredDocumentFieldPaths: value.requiredDocumentFieldPaths,
    fieldPath: value.fieldPath,
    structuredObjectId: value.structuredObjectId,
    structuredObjectHash: value.structuredObjectHash,
    pageRange: value.pageRange,
    sourceRefs: value.sourceRefs.map((ref) => ({
      schemaVersion: ref.schemaVersion,
      sourceUnitId: ref.sourceUnitId,
      sourceUnitHash: ref.sourceUnitHash,
      artifactRef: ref.artifactRef,
      anchorTextHash: ref.anchorTextHash,
      locator: ref.locator,
    })),
    sourceBounded: value.sourceBounded,
    authorityLevel: value.authorityLevel,
    createsEvidenceRef: value.createsEvidenceRef,
  });
}

function assertBaselinePackage(value) {
  if (!value || typeof value !== 'object'
    || value.outputAuthorityLevel !== 'candidate_only'
    || !Array.isArray(value.evaluationItems)
    || !/^SBJA-[0-9A-F]{24}$/u.test(value.packageId ?? '')) {
    throw new Error('BASELINE_ASSESSMENT_PACKAGE_INVALID');
  }
  assertSha256Identity(value.contentHash, 'assessmentPackage.contentHash');
}

function assertNormalizedPatch(value, packageId, contentHash) {
  if (value?.schemaVersion !== WISELINK_V3_1_SB_JOB_AID_EVIDENCE_PATCH_CONSUMPTION_SCHEMA
    || value.sourceAssessmentPackageId !== packageId
    || value.sourceAssessmentContentHash !== contentHash
    || !Array.isArray(value.entries)
    || value.entries.length === 0) {
    throw new Error(`EVIDENCE_PATCH_NOT_BOUND_TO_BASELINE:${value?.patchId ?? 'missing'}`);
  }
}

function parseJsonArray(value, label) {
  const unwrapped = cell(value);
  let parsed = unwrapped;
  if (typeof unwrapped === 'string') {
    try {
      parsed = JSON.parse(unwrapped);
    } catch {
      throw new Error(`EVIDENCE_PATCH_JSON_INVALID:${label}`);
    }
  }
  if (!Array.isArray(parsed)) throw new Error(`EVIDENCE_PATCH_ARRAY_REQUIRED:${label}`);
  return parsed;
}

function cell(value) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function normalizeActorRefs(value, label) {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error(`EVIDENCE_PATCH_SINGLE_VALIDATOR_REQUIRED:${label}`);
  }
  const actor = value[0];
  if (typeof actor === 'number' && Number.isSafeInteger(actor) && actor > 0) {
    return [`user:${actor}`];
  }
  if (typeof actor === 'string' && actor.trim()) return [`user:${actor.trim()}`];
  if (actor && typeof actor === 'object') {
    const id = actor.id ?? actor.user_id ?? actor.open_id;
    if (typeof id === 'string' && id.trim()) return [`user:${id.trim()}`];
  }
  throw new Error(`EVIDENCE_PATCH_VALIDATOR_INVALID:${label}`);
}

function normalizeTimestamp(value, label) {
  const unwrapped = cell(value);
  const timestamp = typeof unwrapped === 'number'
    ? new Date(unwrapped).toISOString()
    : typeof unwrapped === 'string' && Number.isFinite(Date.parse(unwrapped))
      ? new Date(unwrapped).toISOString()
      : null;
  if (!timestamp) throw new Error(`EVIDENCE_PATCH_TIMESTAMP_INVALID:${label}`);
  return timestamp;
}

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim().normalize('NFC');
}

function assertSha256Identity(value, label) {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value ?? '')) {
    throw new Error(`${label} must be a sha256-prefixed identity.`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}
