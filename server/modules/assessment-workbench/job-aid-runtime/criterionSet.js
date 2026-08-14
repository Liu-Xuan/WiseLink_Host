import { createHash } from 'node:crypto';

import { validateJobAidRulePack } from './rulePack.js';

export const WISELINK_V3_1_JOB_AID_CRITERION_SET_SCHEMA =
  'wiselink.v3_1.job_aid.criterion_set_version.v1';
export const WISELINK_V3_1_JOB_AID_CRITERION_VERSION_SCHEMA =
  'wiselink.v3_1.job_aid.criterion_version.v1';
export const WISELINK_V3_1_ACTIVE_CRITERION_SET_0_2 = Object.freeze({
  criterionSetId: 'JACS-72D0484B6F1C17A38F671F46',
  criterionSetHash:
    'sha256:72d0484b6f1c17a38f671f465abe87ddb5cf93f49f64442ea9623cd251346061',
  memberIdentityHash:
    'sha256:dd794f498068e925e706089641a5809c6f831991b9c5b00a7b3777a2dd68a95c',
  criteriaCount: 150,
});

const SOURCE_VERSION_STATUSES = new Set([
  'CONFIRMED',
  'VERSION_UNCONFIRMED',
]);
const LIFECYCLE_STATUSES = new Set(['DRAFT', 'ACTIVE', 'SUPERSEDED']);
const EXECUTABLE_CRITERION_FIELDS = Object.freeze([
  'criterion_id', 'global_sequence', 'stage_code', 'stage_name',
  'criterion_name', 'atom_type', 'evaluation_question', 'applies_when',
  'output_field', 'value_type', 'allowed_values', 'required_doc_evidence',
  'required_external_evidence', 'evidence_order', 'interpretation_method',
  'decision_rule', 'automation_mode', 'blocker_level', 'downstream_action',
  'source_authority', 'source_document', 'source_section', 'source_page',
  'source_basis', 'reviewer_role', 'tags', 'applicability_predicate',
  'attachment5_item_ids', 'source_provenance', 'normative_force',
  'source_directness', 'source_rule_boundary', 'blocking_condition',
  'implementation_notes',
]);

/**
 * @param {{
 *   rulePack: any,
 *   artifactRef: string,
 *   artifactDigest: string,
 *   artifactVersion: string,
 *   canonicalCriteriaHash?: string | null,
 *   sourceJobAidDocumentVersionId?: string | null,
 *   sourceJobAidDocumentVersionStatus?: 'CONFIRMED' | 'VERSION_UNCONFIRMED',
 *   lifecycleStatus?: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED'
 * }} options
 */
export function buildJobAidCriterionSetVersion({
  rulePack,
  artifactRef,
  artifactDigest,
  artifactVersion,
  canonicalCriteriaHash = null,
  sourceJobAidDocumentVersionId = null,
  sourceJobAidDocumentVersionStatus = 'VERSION_UNCONFIRMED',
  lifecycleStatus = 'DRAFT',
} = {}) {
  const validation = validateJobAidRulePack(rulePack);
  const normalizedArtifactDigest = normalizeHash(artifactDigest, 'artifactDigest');
  const normalizedArtifactRef = requiredText(artifactRef, 'artifactRef');
  const normalizedArtifactVersion = requiredText(artifactVersion, 'artifactVersion');
  if (!SOURCE_VERSION_STATUSES.has(sourceJobAidDocumentVersionStatus)) {
    throw new Error(`Unsupported source Job Aid version status: ${sourceJobAidDocumentVersionStatus}.`);
  }
  if (!LIFECYCLE_STATUSES.has(lifecycleStatus)) {
    throw new Error(`Unsupported CriterionSet lifecycle: ${lifecycleStatus}.`);
  }
  if (sourceJobAidDocumentVersionStatus === 'CONFIRMED') {
    requiredText(sourceJobAidDocumentVersionId, 'sourceJobAidDocumentVersionId');
  } else if (sourceJobAidDocumentVersionId !== null) {
    throw new Error('Unconfirmed source Job Aid version must not claim a documentVersionId.');
  }

  const members = rulePack.criteria.map((criterion, index) => {
    const criterionHash = hashCanonical({
      schemaVersion: WISELINK_V3_1_JOB_AID_CRITERION_VERSION_SCHEMA,
      artifactDigest: normalizedArtifactDigest,
      rulePackSchemaVersion: validation.rulePackVersion,
      criterion,
    });
    return Object.freeze({
      criterionId: String(criterion.criterion_id),
      criterionVersionId: `JACV-${digest(criterionHash).slice(0, 24).toUpperCase()}`,
      criterionHash,
      displayOrder: index + 1,
    });
  });
  const memberIdentityHash = hashCanonical(members.map((member) => ({
    criterionId: member.criterionId,
    criterionVersionId: member.criterionVersionId,
    criterionHash: member.criterionHash,
    displayOrder: member.displayOrder,
  })));
  const identity = {
    schemaVersion: WISELINK_V3_1_JOB_AID_CRITERION_SET_SCHEMA,
    ruleArtifact: {
      artifactRef: normalizedArtifactRef,
      artifactDigest: normalizedArtifactDigest,
      artifactVersion: normalizedArtifactVersion,
    },
    rulePackSchemaVersion: validation.rulePackVersion,
    canonicalCriteriaHash: canonicalCriteriaHash === null
      ? hashCanonical(rulePack.criteria)
      : normalizeHash(canonicalCriteriaHash, 'canonicalCriteriaHash'),
    sourceJobAidDocumentVersion: {
      documentVersionId: sourceJobAidDocumentVersionId,
      status: sourceJobAidDocumentVersionStatus,
    },
    criteriaCount: members.length,
    memberIdentityHash,
    members,
  };
  const setHash = hashCanonical(identity);
  return deepFreeze({
    ...identity,
    criterionSetId: `JACS-${digest(setHash).slice(0, 24).toUpperCase()}`,
    criterionSetHash: setHash,
    lifecycleStatus,
  });
}

export function assertCriterionSetEvaluationCoverage({
  criterionSet,
  evaluationItems,
} = {}) {
  if (!criterionSet || criterionSet.schemaVersion !== WISELINK_V3_1_JOB_AID_CRITERION_SET_SCHEMA) {
    throw new Error('A supported CriterionSetVersion is required.');
  }
  if (!Array.isArray(evaluationItems)) {
    throw new TypeError('evaluationItems must be an array.');
  }
  if (evaluationItems.length !== criterionSet.criteriaCount) {
    throw new Error(
      `Evaluation item count ${evaluationItems.length} does not match CriterionSet ${criterionSet.criteriaCount}.`,
    );
  }
  const expected = new Map(criterionSet.members.map((member) => [member.criterionId, member]));
  const seen = new Set();
  for (const item of evaluationItems) {
    const criterionId = String(item?.criterion_id ?? item?.criterionId ?? '');
    const criterionVersionId = String(
      item?.criterion_version_id ?? item?.criterionVersionId ?? '',
    );
    const member = expected.get(criterionId);
    if (!member) throw new Error(`Evaluation item is outside CriterionSet: ${criterionId || 'missing'}.`);
    if (seen.has(criterionId)) throw new Error(`Duplicate evaluation item: ${criterionId}.`);
    if (criterionVersionId !== member.criterionVersionId) {
      throw new Error(`Criterion version mismatch for ${criterionId}.`);
    }
    seen.add(criterionId);
  }
  const missing = [...expected.keys()].filter((criterionId) => !seen.has(criterionId));
  if (missing.length > 0) throw new Error(`Missing CriterionSet members: ${missing.join(',')}.`);
  return true;
}

export function criterionMemberMap(criterionSet) {
  return new Map(criterionSet.members.map((member) => [member.criterionId, member]));
}

export function canonicalJson(value) {
  return JSON.stringify(sortRecursively(value));
}

export function hashCanonical(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function hashExecutableCriterionList(criteria) {
  if (!Array.isArray(criteria)) {
    throw new TypeError('criteria must be an array.');
  }
  const ordered = criteria.map((criterion) => Object.fromEntries(
    EXECUTABLE_CRITERION_FIELDS.map((field) => [
      field,
      field === 'attachment5_item_ids'
        ? criterion?.[field] ?? []
        : criterion?.[field] ?? '',
    ]),
  ));
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(ordered))
    .digest('hex')}`;
}

function sortRecursively(value) {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortRecursively(value[key])]),
  );
}

function normalizeHash(value, field) {
  const text = requiredText(value, field).toLowerCase();
  const normalized = text.startsWith('sha256:') ? text : `sha256:${text}`;
  if (!/^sha256:[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error(`${field} must be a SHA-256 digest.`);
  }
  return normalized;
}

function digest(value) {
  return normalizeHash(value, 'hash').slice('sha256:'.length);
}

function requiredText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
