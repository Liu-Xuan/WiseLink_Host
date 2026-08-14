import { collectPredicatePaths } from './predicateDsl.js';
import { sha256 } from './rulePack.js';

export const WISELINK_V3_1_SB_JOB_AID_SOURCE_EVIDENCE_CANDIDATE_SCHEMA =
  'wiselink.v3_1.sb_job_aid.source_evidence_candidate.v1';

export const WISELINK_V3_1_SB_JOB_AID_SOURCE_EVIDENCE_ROUTER_VERSION =
  'sb-job-aid-source-evidence-router@1';

// These are explicit Job Aid-to-structured-field bindings. They complement
// predicate lineage where the predicate itself intentionally references a
// controlled assessment value (for example assessment.applicability) rather
// than the manufacturer's source paragraph.
const REQUIRED_DOCUMENT_FIELD_ROUTES = Object.freeze({
  'GOV-003': Object.freeze([
    'coreFields.documentCode.value',
    'coreFields.title.value',
    'coreFields.revisionLabel.value',
    'coreFields.issuedAt.value',
    'coreFields.publishedAt.value',
    'coreFields.issuer.value',
    'coreFields.aircraftModels.value',
    'coreFields.ataChapters.value',
    'coreFields.ataSystems.value',
  ]),
  'CLS-001': Object.freeze([
    'coreFields.documentFamily.value',
    'coreFields.documentCode.value',
    'coreFields.title.value',
    'coreFields.issuer.value',
  ]),
  'APP-001': Object.freeze(['coreFields.applicabilityRaw.value']),
  'APP-002': Object.freeze(['coreFields.applicabilityRaw.value']),
});

/**
 * Build non-authoritative, source-bounded candidates for one Job Aid item.
 *
 * A candidate is included only when it can be tied to a validated structured
 * object and its exact SourceUnit refs. It never satisfies an evidence
 * requirement, creates an EvidenceRef, or changes the item's tri-state result.
 */
export function buildJobAidSourceEvidenceCandidates({ criterion, input } = {}) {
  if (!criterion || typeof criterion !== 'object') {
    throw new TypeError('criterion must be an object.');
  }
  const sourceBindings = input?.upstreamBinding?.sourceBindings;
  const sourceFacts = input?.sourceDerivation?.facts;
  if (!Array.isArray(sourceBindings) || !Array.isArray(sourceFacts)) return [];

  const criterionId = requiredText(criterion.criterion_id, 'criterion.criterion_id');
  const predicatePaths = collectPredicatePaths(criterion.applicability_predicate);
  const requiredFieldPaths = REQUIRED_DOCUMENT_FIELD_ROUTES[criterionId] ?? [];
  const bindingsByIdentity = new Map();

  const addBinding = ({
    binding,
    bindingRole,
    predicatePath = null,
    requiredFieldPath = null,
    derivation = null,
  }) => {
    assertSourceBinding(binding);
    const key = `${binding.unitId}:${binding.unitHash}`;
    const existing = bindingsByIdentity.get(key) ?? {
      binding,
      bindingRoles: new Set(),
      predicatePaths: new Set(),
      requiredDocumentFieldPaths: new Set(),
      derivations: new Map(),
    };
    existing.bindingRoles.add(bindingRole);
    if (predicatePath) existing.predicatePaths.add(predicatePath);
    if (requiredFieldPath) existing.requiredDocumentFieldPaths.add(requiredFieldPath);
    if (derivation) existing.derivations.set(derivation.path, derivation);
    bindingsByIdentity.set(key, existing);
  };

  const factsByPath = new Map(sourceFacts.map((fact) => [fact.path, fact]));
  for (const predicatePath of predicatePaths) {
    const fact = factsByPath.get(predicatePath);
    if (!fact || !Array.isArray(fact.sourceUnits)) continue;
    for (const sourceUnit of fact.sourceUnits) {
      addBinding({
        binding: sourceUnit,
        bindingRole: 'PREDICATE_INPUT_SOURCE',
        predicatePath,
        derivation: {
          path: predicatePath,
          status: requiredText(fact.status, `${predicatePath}.status`),
          reasonCode: requiredText(fact.reasonCode, `${predicatePath}.reasonCode`),
          ruleId: fact.derivation?.ruleId ?? null,
          ruleVersion: fact.derivation?.ruleVersion ?? null,
        },
      });
    }
  }

  const sourceBindingsByPath = new Map(
    sourceBindings.map((binding) => [binding.fieldPath, binding]),
  );
  for (const requiredFieldPath of requiredFieldPaths) {
    const binding = sourceBindingsByPath.get(requiredFieldPath);
    if (!binding) continue;
    addBinding({
      binding,
      bindingRole: 'REQUIRED_DOCUMENT_EVIDENCE_SOURCE',
      requiredFieldPath,
    });
  }

  return [...bindingsByIdentity.values()]
    .sort((left, right) => left.binding.fieldPath.localeCompare(right.binding.fieldPath)
      || left.binding.unitId.localeCompare(right.binding.unitId))
    .map((entry) => buildCandidate({ criterionId, ...entry }));
}

function buildCandidate({
  criterionId,
  binding,
  bindingRoles,
  predicatePaths,
  requiredDocumentFieldPaths,
  derivations,
}) {
  const identity = {
    schemaVersion: WISELINK_V3_1_SB_JOB_AID_SOURCE_EVIDENCE_CANDIDATE_SCHEMA,
    routerVersion: WISELINK_V3_1_SB_JOB_AID_SOURCE_EVIDENCE_ROUTER_VERSION,
    criterionId,
    bindingRoles: [...bindingRoles].sort(),
    predicatePaths: [...predicatePaths].sort(),
    requiredDocumentFieldPaths: [...requiredDocumentFieldPaths].sort(),
    structuredObjectId: binding.unitId,
    structuredObjectHash: binding.unitHash,
    fieldPath: binding.fieldPath,
    unitType: binding.unitType,
    parentStructuredObjectId: binding.parentUnitId ?? null,
    pageRange: structuredClone(binding.pageRange),
    sourceRefs: structuredClone(binding.sourceRefs),
    sourceBounded: true,
    derivations: [...derivations.values()].sort((left, right) => (
      left.path.localeCompare(right.path)
    )),
    authorityLevel: 'candidate_only',
    createsEvidenceRef: false,
  };
  const digest = sha256(canonicalJson(identity));
  return {
    ...identity,
    candidateId: `SEC-${digest.slice(0, 24).toUpperCase()}`,
  };
}

function assertSourceBinding(binding) {
  if (!binding || typeof binding !== 'object') {
    throw new TypeError('source evidence binding must be an object.');
  }
  requiredText(binding.unitId, 'source evidence structuredObjectId');
  if (!/^sha256:[a-f0-9]{64}$/u.test(binding.unitHash)) {
    throw new Error('source evidence structuredObjectHash must be sha256-prefixed.');
  }
  requiredText(binding.fieldPath, 'source evidence fieldPath');
  if (binding.sourceBounded !== true
    || !Array.isArray(binding.sourceRefs)
    || binding.sourceRefs.length === 0) {
    throw new Error('source evidence candidate requires source-bounded refs.');
  }
}

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
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
