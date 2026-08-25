import {
  TRI_STATE,
  collectPredicatePaths,
  evaluateApplicabilityPredicate,
} from './predicateDsl.js';
import { sha256, validateJobAidRulePack } from './rulePack.js';
import {
  assertCriterionSetEvaluationCoverage,
  buildJobAidCriterionSetVersion,
  criterionMemberMap,
} from './criterionSet.js';
import {
  WISELINK_V3_1_SOURCE_UNIT_SCHEMA,
  WISELINK_V3_1_SOURCE_UNIT_SET_SCHEMA,
  WISELINK_V3_1_STRUCTURED_PARSE_SEMANTIC_IDENTITY_SCHEMA,
} from './runtimeConstants.js';
import {
  WISELINK_V3_1_FEISHU_NATIVE_SOURCE_UNIT_CONSUMPTION_SCHEMA,
  WISELINK_V3_1_FEISHU_NATIVE_SOURCE_UNIT_READBACK_SCHEMA,
} from './feishuNativeSourceUnitAdapter.js';
import { normalizeJobAidDocumentType } from './documentType.js';
import {
  WISELINK_V3_1_SB_JOB_AID_SOURCE_EVIDENCE_ROUTER_VERSION,
  buildJobAidSourceEvidenceCandidates,
} from './sourceEvidenceCandidates.js';
import { applySourceEvidenceAdoptions } from './sourceEvidenceAdoptions.js';

export const WISELINK_V3_1_SB_JOB_AID_ASSESSMENT_INPUT_SCHEMA =
  'wiselink.v3_1.sb_job_aid_assessment_input.v2';
export const WISELINK_V3_1_SB_JOB_AID_ASSESSMENT_PACKAGE_SCHEMA =
  'wiselink.v3_1.sb_job_aid_assessment_package.v2';
export const WISELINK_V3_1_FEISHU_NATIVE_SB_JOB_AID_ASSESSMENT_INPUT_SCHEMA =
  'wiselink.v3_1.sb_job_aid_assessment_input.v3';
export const WISELINK_V3_1_FEISHU_NATIVE_SB_JOB_AID_ASSESSMENT_PACKAGE_SCHEMA =
  'wiselink.v3_1.sb_job_aid_assessment_package.v3';
export const WISELINK_V3_1_UNIFIED_SB_JOB_AID_ASSESSMENT_INPUT_SCHEMA =
  'wiselink.v3_1.sb_job_aid_assessment_input.v4';
export const WISELINK_V3_1_UNIFIED_SB_JOB_AID_ASSESSMENT_PACKAGE_SCHEMA =
  'wiselink.v3_1.sb_job_aid_assessment_package.v4';
export const WISELINK_V3_1_FEISHU_NATIVE_STRUCTURED_PARSE_PACKAGE_SCHEMA =
  'wiselink.v3_1.feishu_native.structured_parse_package.v1';
export const WISELINK_0_10_STRUCTURED_PARSE_CONTENT_IDENTITY_SCHEMA =
  'wiselink.0_10.structured_parse_package.content_identity.v1';
export const WISELINK_0_10_STRUCTURED_PARSE_RUNTIME_BUNDLE_SCHEMA =
  'wiselink.0_10.structured_parse_runtime_artifact_bundle.v1';
export const WISELINK_0_10_MINERU_CANONICAL_DOCUMENT_SCHEMA =
  'mineru_canonical_document.v1';

const ACTIVE_PACKAGE_STATUSES = new Set(['available', 'needs_review']);
const TERMINAL_ITEM_STATUSES = new Set(['已确认', '不适用']);
const ALLOWED_DOCUMENT_TYPES = new Set(['SB', 'SL', 'AOT', 'VSB', 'SIL', 'OIC', 'FTD', 'TFU', 'FTAR']);

export function buildSbJobAidAssessmentPackage({
  input,
  rulePack,
  rulePackHash,
  criterionSet = null,
  criterionSetSelection = null,
  criterionAnswers = {},
  sourceEvidenceAdoptions = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  assertSbJobAidAssessmentInput(input);
  const ruleValidation = validateJobAidRulePack(rulePack);
  assertSha256(rulePackHash, 'rulePackHash');
  const selectedCriterionSet = criterionSet ?? buildJobAidCriterionSetVersion({
    rulePack,
    artifactRef: `inline://job-aid-rule-pack/${ruleValidation.rulePackVersion}`,
    artifactDigest: rulePackHash,
    artifactVersion: ruleValidation.rulePackVersion,
    sourceJobAidDocumentVersionStatus: 'VERSION_UNCONFIRMED',
    lifecycleStatus: 'DRAFT',
  });
  const criterionMembers = criterionMemberMap(selectedCriterionSet);

  const evaluationContext = buildEvaluationContext(input);
  const upstreamFingerprint = buildAssessmentUpstreamFingerprint(input);
  const baselineEvaluationItems = rulePack.criteria.map((criterion) => buildEvaluationItem({
    criterion,
    criterionMember: criterionMembers.get(criterion.criterion_id),
    context: evaluationContext,
    input,
    answer: criterionAnswers[criterion.criterion_id],
  }));
  assertCriterionSetEvaluationCoverage({
    criterionSet: selectedCriterionSet,
    evaluationItems: baselineEvaluationItems,
  });
  const rulePackBinding = {
    schemaVersion: ruleValidation.rulePackVersion,
    sourceHash: rulePackHash,
    criteriaCount: selectedCriterionSet.criteriaCount,
    attachment5ItemCount: ruleValidation.attachment5ItemCount,
    criterionSetSchemaVersion: selectedCriterionSet.schemaVersion,
    criterionSetId: selectedCriterionSet.criterionSetId,
    criterionSetHash: selectedCriterionSet.criterionSetHash,
    criterionSetMemberIdentityHash: selectedCriterionSet.memberIdentityHash,
    criterionSetLifecycleStatus: selectedCriterionSet.lifecycleStatus,
    ruleArtifactRef: selectedCriterionSet.ruleArtifact.artifactRef,
    ruleArtifactDigest: selectedCriterionSet.ruleArtifact.artifactDigest,
    ruleArtifactVersion: selectedCriterionSet.ruleArtifact.artifactVersion,
    sourceJobAidDocumentVersion:
      selectedCriterionSet.sourceJobAidDocumentVersion,
    ...(criterionSetSelection
      ? { criterionSetSelection: structuredClone(criterionSetSelection) }
      : {}),
  };
  const processingConfiguration = {
    sourceEvidenceRouterVersion:
      WISELINK_V3_1_SB_JOB_AID_SOURCE_EVIDENCE_ROUTER_VERSION,
  };
  const baselineAttachment5 = buildAttachment5Candidate(
    rulePack,
    evaluationContext,
    baselineEvaluationItems,
  );
  const baselineGates = aggregateGates(baselineEvaluationItems, baselineAttachment5);
  const baselineStatus = derivePackageStatus(input, baselineGates);
  const baselineContentHash = sha256(canonicalJson({
    upstreamFingerprint,
    rulePackHash,
    rulePackBinding,
    processingConfiguration,
    status: baselineStatus,
    evaluationItems: baselineEvaluationItems,
    formalAttachment5: baselineAttachment5,
    gates: baselineGates,
  }));
  const baselinePackageId = `SBJA-${baselineContentHash.slice(0, 24).toUpperCase()}`;
  const appliedEvidence = applySourceEvidenceAdoptions({
    evaluationItems: baselineEvaluationItems,
    baselinePackageId,
    baselineContentHash: `sha256:${baselineContentHash}`,
    evidencePatches: sourceEvidenceAdoptions,
  });
  const evaluationItems = appliedEvidence.evaluationItems;
  const attachment5 = appliedEvidence.evidencePatchBinding
    ? buildAttachment5Candidate(rulePack, evaluationContext, evaluationItems)
    : baselineAttachment5;
  const gates = appliedEvidence.evidencePatchBinding
    ? aggregateGates(evaluationItems, attachment5)
    : baselineGates;
  const status = appliedEvidence.evidencePatchBinding
    ? derivePackageStatus(input, gates)
    : baselineStatus;
  const contentIdentity = canonicalJson({
    upstreamFingerprint,
    rulePackHash,
    rulePackBinding,
    processingConfiguration,
    status,
    evaluationItems,
    formalAttachment5: attachment5,
    gates,
    ...(appliedEvidence.evidencePatchBinding
      ? { evidencePatchBinding: appliedEvidence.evidencePatchBinding }
      : {}),
  });
  const contentHash = sha256(contentIdentity);
  const packageId = `SBJA-${contentHash.slice(0, 24).toUpperCase()}`;

  const assessmentPayload = buildV02CompatiblePayload({
    input,
    rulePack,
    rulePackHash,
    evaluationContext,
    evaluationItems,
    attachment5,
    gates,
    assessmentId: packageId,
    generatedAt,
  });
  const nativeInput = isFeishuNativeAssessmentInput(input);
  const unifiedInput = isUnifiedAssessmentInput(input);

  return {
    schemaVersion: unifiedInput
      ? WISELINK_V3_1_UNIFIED_SB_JOB_AID_ASSESSMENT_PACKAGE_SCHEMA
      : nativeInput
        ? WISELINK_V3_1_FEISHU_NATIVE_SB_JOB_AID_ASSESSMENT_PACKAGE_SCHEMA
        : WISELINK_V3_1_SB_JOB_AID_ASSESSMENT_PACKAGE_SCHEMA,
    packageKind: 'SbJobAidAssessmentPackage',
    packageId,
    contentHash: `sha256:${contentHash}`,
    parentPackageId: appliedEvidence.evidencePatchBinding
      ? baselinePackageId
      : null,
    evidencePatchBinding: appliedEvidence.evidencePatchBinding,
    status,
    outputAuthorityLevel: 'candidate_only',
    generatedAt,
    assessmentAsOf: input.assessmentAsOf,
    documentIdentity: { ...input.documentIdentity },
    upstreamBinding: structuredClone(input.upstreamBinding),
    upstreamFingerprint,
    rulePackBinding,
    processingConfiguration,
    evaluationSummary: summarizeEvaluationItems(evaluationItems),
    gates,
    evaluationItems,
    formalAttachment5: attachment5,
    assessmentPayload,
    sourceUnitSetBinding: unifiedInput ? null : buildSourceUnitSetBinding(input),
    unifiedParsedPackageBinding: unifiedInput
      ? buildUnifiedParsedPackageBinding(input)
      : null,
    parsedSourceContext: unifiedInput
      ? buildUnifiedParsedSourceContext(input)
      : null,
    structuredAssessmentContext: unifiedInput
      ? structuredClone(input.structuredAssessmentContext)
      : null,
    authorityBoundary: buildAuthorityBoundary(),
    nonClaims: [
      'This package is an engineering assessment candidate and cannot approve, publish, complete, or release work.',
      'Predicate applicability does not itself prove that a Job Aid decision rule is satisfied.',
      'Unadopted evidence candidates and source locators are not authority EvidenceRef objects.',
      appliedEvidence.evidencePatchBinding
        ? 'EvidenceRefs in this package exist only because exact validated engineer adoption patches were consumed.'
        : 'No engineer evidence adoption patch was consumed by this package.',
      unifiedInput
        ? 'The frozen Unified Parsed Package is a source binding, not an engineering approval or FleetFact authority.'
        : nativeInput
        ? 'The Feishu-native SourceUnitSet and StructuredParsePackage are source bindings, not engineering approval.'
        : 'The frozen SourceUnitSet v1 binding comes from the parser-owner contract, not the temporary Base SourceUnits table.',
    ],
  };
}

export function assertSbJobAidAssessmentInput(input) {
  if (isUnifiedAssessmentInput(input)) return assertUnifiedAssessmentInput(input);
  if (isFeishuNativeAssessmentInput(input)) return assertFeishuNativeAssessmentInput(input);
  if (input?.schemaVersion !== WISELINK_V3_1_SB_JOB_AID_ASSESSMENT_INPUT_SCHEMA) {
    throw new Error(`Unexpected assessment input schema: ${input?.schemaVersion ?? 'missing'}.`);
  }
  for (const field of ['documentId', 'revisionId', 'documentFamily']) {
    assertNonEmpty(input.documentIdentity?.[field], `documentIdentity.${field}`);
  }
  assertNonEmpty(input.assessmentAsOf, 'assessmentAsOf');
  if (!Number.isFinite(Date.parse(input.assessmentAsOf))) {
    throw new TypeError('assessmentAsOf must be an ISO date or date-time.');
  }
  const packageBinding = input.upstreamBinding?.structuredParsePackage;
  if (packageBinding?.contentIdentitySchema !== WISELINK_0_10_STRUCTURED_PARSE_CONTENT_IDENTITY_SCHEMA) {
    throw new Error('StructuredParsePackage content identity schema mismatch.');
  }
  for (const field of ['packageId', 'contentHash', 'status', 'currentness']) {
    assertNonEmpty(packageBinding?.[field], `upstreamBinding.structuredParsePackage.${field}`);
  }
  assertContentHash(packageBinding.contentHash, 'upstreamBinding.structuredParsePackage.contentHash');
  if (typeof packageBinding.currentConsumptionAllowed !== 'boolean') {
    throw new TypeError('StructuredParsePackage currentConsumptionAllowed must be boolean.');
  }

  const parserArtifact = input.upstreamBinding?.parserArtifact;
  if (parserArtifact?.bundleSchemaVersion !== WISELINK_0_10_STRUCTURED_PARSE_RUNTIME_BUNDLE_SCHEMA) {
    throw new Error('Structured parse runtime bundle schema mismatch.');
  }
  if (parserArtifact?.artifactKind !== 'parse.agent_result_json') {
    throw new Error('Assessment input must bind parse.agent_result_json.');
  }
  if (parserArtifact?.sourceContractVersion !== WISELINK_0_10_MINERU_CANONICAL_DOCUMENT_SCHEMA) {
    throw new Error('MinerU source contract version mismatch.');
  }
  for (const field of [
    'parserArtifactSchemaVersion',
    'parserArtifactOutputHash',
    'semanticOutputHash',
    'semanticOutputHashPolicySchemaVersion',
    'specManifestId',
  ]) {
    assertNonEmpty(parserArtifact?.[field], `upstreamBinding.parserArtifact.${field}`);
  }
  assertSha256(
    parserArtifact.parserArtifactOutputHash,
    'upstreamBinding.parserArtifact.parserArtifactOutputHash',
  );
  assertSha256(
    parserArtifact.semanticOutputHash,
    'upstreamBinding.parserArtifact.semanticOutputHash',
  );
  if (parserArtifact.semanticOutputHashPolicySchemaVersion
    !== WISELINK_V3_1_STRUCTURED_PARSE_SEMANTIC_IDENTITY_SCHEMA) {
    throw new Error('Structured parse semantic identity policy mismatch.');
  }
  const sourceArtifactHashes = parserArtifact.sourceArtifactHashes;
  if (!sourceArtifactHashes || typeof sourceArtifactHashes !== 'object') {
    throw new TypeError('parserArtifact.sourceArtifactHashes must be an object.');
  }
  for (const requiredSource of ['pdf', 'markdown', 'middleJson', 'contentListV2']) {
    assertSha256(sourceArtifactHashes[requiredSource], `parserArtifact.sourceArtifactHashes.${requiredSource}`);
  }
  if (!Array.isArray(parserArtifact.fieldSourceRefs)) {
    throw new TypeError('parserArtifact.fieldSourceRefs must be an array.');
  }
  for (const [index, binding] of parserArtifact.fieldSourceRefs.entries()) {
    assertNonEmpty(binding?.fieldPath, `parserArtifact.fieldSourceRefs[${index}].fieldPath`);
    if (!Array.isArray(binding?.sourceRefs)) {
      throw new TypeError(`parserArtifact.fieldSourceRefs[${index}].sourceRefs must be an array.`);
    }
  }
  assertFrozenSourceUnitSetBinding({
    sourceUnitSet: input.upstreamBinding?.sourceUnitSet,
    packageBinding,
    parserArtifact,
    documentIdentity: input.documentIdentity,
  });
  if (!input.parsedResult || typeof input.parsedResult !== 'object') {
    throw new TypeError('parsedResult must contain the parse.agent_result_json content.');
  }
  if (input.parsedResult.documentId !== input.documentIdentity.documentId
    || input.parsedResult.revisionId !== input.documentIdentity.revisionId
    || input.parsedResult.docFamily !== input.documentIdentity.documentFamily) {
    throw new Error('Parsed result identity does not match assessment document identity.');
  }
  return true;
}

function assertUnifiedAssessmentInput(input) {
  for (const field of ['documentId', 'revisionId', 'documentFamily']) {
    assertNonEmpty(input.documentIdentity?.[field], `documentIdentity.${field}`);
  }
  if (input.documentIdentity.documentFamily !== 'SB') {
    throw new Error('Unified assessment input is not an SB document.');
  }
  assertNonEmpty(input.assessmentAsOf, 'assessmentAsOf');
  if (!Number.isFinite(Date.parse(input.assessmentAsOf))) {
    throw new TypeError('assessmentAsOf must be an ISO date or date-time.');
  }
  const binding = input.upstreamBinding?.unifiedParsedPackage;
  if (binding?.readerSchemaVersion
      !== 'wiselink.v3_1.sb_assessment.unified_parsed_package_readback.v1'
    || binding?.contractRevision !== 'frozen.2'
    || binding?.lifecycleStatus !== 'FROZEN'
    || binding?.selectionStatus !== 'SELECTED'
    || binding?.currentness !== 'current'
    || binding?.currentConsumptionAllowed !== true
    || binding?.resultStatus !== 'partial' && binding?.resultStatus !== 'complete') {
    throw new Error('Unified Parsed Package is not a consumable frozen.2 input.');
  }
  for (const field of [
    'packageId', 'packageContentHash', 'packageSemanticHash',
    'packageProvenanceHash', 'packageCoverageHash', 'artifactRef',
    'artifactHash', 'sourcePackageId', 'sourceArtifactHash',
    'readerReceiptHash',
  ]) assertNonEmpty(binding?.[field], `upstreamBinding.unifiedParsedPackage.${field}`);
  if (!/^urn:techpub:package:v1:sha256:[a-f0-9]{64}$/u.test(binding.packageId)) {
    throw new Error('Unified Parsed Package ID is malformed.');
  }
  for (const field of [
    'packageContentHash', 'packageSemanticHash', 'packageProvenanceHash',
    'packageCoverageHash', 'artifactHash', 'sourceArtifactHash',
    'readerReceiptHash',
  ]) assertContentHash(binding[field], `upstreamBinding.unifiedParsedPackage.${field}`);
  if (binding.packageId !== `urn:techpub:package:v1:${binding.packageContentHash}`
    || binding.documentId !== input.documentIdentity.documentId
    || binding.documentVersionId !== input.documentIdentity.revisionId
    || binding.classification?.status !== 'CONFIRMED'
    || binding.classification?.normalizedFamily !== 'SB') {
    throw new Error('Unified Parsed Package identity does not match assessment input.');
  }
  const receiptView = structuredClone(binding.readerReceipt);
  if (!receiptView || typeof receiptView !== 'object'
    || receiptView.packageId !== binding.packageId
    || receiptView.documentId !== binding.documentId
    || receiptView.documentVersionId !== binding.documentVersionId
    || `sha256:${sha256(canonicalJson(receiptView))}` !== binding.readerReceiptHash) {
    throw new Error('Unified Parsed Package Reader receipt identity mismatch.');
  }
  if (!input.parsedResult || typeof input.parsedResult !== 'object'
    || input.parsedResult.documentId !== input.documentIdentity.documentId
    || input.parsedResult.revisionId !== input.documentIdentity.revisionId
    || input.parsedResult.docFamily !== 'SB'
    || fieldValue(input.parsedResult.coreFields?.documentCode)
      !== binding.readerReceipt.documentCode
    || fieldValue(input.parsedResult.coreFields?.title)
      !== binding.readerReceipt.title) {
    throw new Error('Unified parsed result projection does not match Reader receipt.');
  }
  const sourceBindings = input.upstreamBinding?.sourceBindings;
  if (!Array.isArray(sourceBindings)) {
    throw new Error('Unified assessment input sourceBindings must be an array.');
  }
  for (const [index, sourceBinding] of sourceBindings.entries()) {
    assertNonEmpty(sourceBinding?.unitId, `sourceBindings[${index}].unitId`);
    assertContentHash(sourceBinding?.unitHash, `sourceBindings[${index}].unitHash`);
    assertNonEmpty(sourceBinding?.fieldPath, `sourceBindings[${index}].fieldPath`);
    if (sourceBinding.sourceBounded !== true
      || !Array.isArray(sourceBinding.sourceRefs)
      || sourceBinding.sourceRefs.length === 0) {
      throw new Error(`sourceBindings[${index}] is not source-bounded.`);
    }
  }
  assertUnifiedStructuredAssessmentContext(input.structuredAssessmentContext);
  buildUnifiedParsedSourceContext(input);
  return true;
}

function assertUnifiedStructuredAssessmentContext(context) {
  if (context?.schemaVersion
      !== 'wiselink.v3_1.sb_job_aid.structured_assessment_context.v1'
    || !['AVAILABLE_CANDIDATE', 'MISSING'].includes(
      context.applicability?.availability,
    )
    || !Array.isArray(context.concurrentRequirements?.entries)
    || !Array.isArray(context.workInstructions?.stepIds)
    || !Array.isArray(context.workInstructions?.steps)
    || context.workInstructions.stepCount
      !== context.workInstructions.stepIds.length
    || context.workInstructions.stepCount
      !== context.workInstructions.steps.length
    || new Set(context.workInstructions.stepIds).size
      !== context.workInstructions.stepIds.length
    || context.authorityBoundary?.sourceBoundParserCandidateOnly !== true
    || context.authorityBoundary?.documentApplicabilityProvesFleetApplicability
      !== false
    || context.authorityBoundary?.createsFleetFact !== false
    || context.authorityBoundary?.createsEvidenceRef !== false
    || context.authorityBoundary?.createsEngineerDecision !== false) {
    throw new Error('Unified structured assessment context is invalid.');
  }
}

function assertFeishuNativeAssessmentInput(input) {
  for (const field of ['documentId', 'revisionId', 'documentFamily']) {
    assertNonEmpty(input.documentIdentity?.[field], `documentIdentity.${field}`);
  }
  assertNonEmpty(input.assessmentAsOf, 'assessmentAsOf');
  if (!Number.isFinite(Date.parse(input.assessmentAsOf))) {
    throw new TypeError('assessmentAsOf must be an ISO date or date-time.');
  }
  const packageBinding = input.upstreamBinding?.structuredParsePackage;
  if (packageBinding?.schemaVersion
    !== WISELINK_V3_1_FEISHU_NATIVE_STRUCTURED_PARSE_PACKAGE_SCHEMA) {
    throw new Error('Feishu-native StructuredParsePackage schema mismatch.');
  }
  for (const field of [
    'packageId',
    'contentHash',
    'semanticOutputHash',
    'lifecycleStatus',
    'qualityGateStatus',
    'currentness',
    'sourceUnitSetId',
    'sourceUnitSetHash',
    'structuredSpecManifestId',
    'structuredSpecManifestHash',
    'inputManifestHash',
    'runMode',
    'datasetSplit',
  ]) assertNonEmpty(packageBinding?.[field], `upstreamBinding.structuredParsePackage.${field}`);
  for (const field of [
    'contentHash',
    'semanticOutputHash',
    'sourceUnitSetHash',
    'structuredSpecManifestHash',
    'inputManifestHash',
  ]) assertContentHash(packageBinding[field], `upstreamBinding.structuredParsePackage.${field}`);
  if (!/^SPP-[A-F0-9]{24}$/u.test(packageBinding.packageId)
    || packageBinding.packageId
      !== `SPP-${packageBinding.semanticOutputHash.slice('sha256:'.length, 'sha256:'.length + 24).toUpperCase()}`
    || packageBinding.contentHash !== packageBinding.semanticOutputHash) {
    throw new Error('Feishu-native StructuredParsePackage identity mismatch.');
  }
  if (packageBinding.lifecycleStatus !== 'FROZEN'
    || packageBinding.qualityGateStatus !== 'PASS'
    || packageBinding.currentness !== 'current'
    || packageBinding.currentConsumptionAllowed !== true) {
    throw new Error('Feishu-native StructuredParsePackage is not consumable.');
  }

  const set = input.upstreamBinding?.sourceUnitSet;
  if (!set
    || set.schemaVersion !== WISELINK_V3_1_FEISHU_NATIVE_SOURCE_UNIT_READBACK_SCHEMA
    || set.consumptionContractVersion
      !== WISELINK_V3_1_FEISHU_NATIVE_SOURCE_UNIT_CONSUMPTION_SCHEMA
    || set.status !== 'READY' || set.productionConsumptionAllowed !== true
    || set.lifecycleStatus !== 'FROZEN'
    || set.isCurrent !== true || set.frozen !== true
    || set.packageCurrentAtFreeze !== true
    || !Array.isArray(set.units) || set.units.length === 0
    || set.units.length !== set.unitCount
    || set.sourceBoundUnitCount !== set.unitCount) {
    throw new Error('Feishu-native SourceUnitSet is not complete, frozen, and current.');
  }
  for (const field of [
    'hashContractVersion',
    'sourceUnitSetId',
    'sourceUnitSetHash',
    'documentId',
    'documentVersionId',
    'pdfFileToken',
    'pdfSha256',
    'driveSourceVersion',
    'layoutArtifactRef',
    'layoutArtifactSha256',
    'layoutHash',
    'layoutSchemaVersion',
    'sourceContractVersion',
    'specManifestId',
    'specManifestHash',
  ]) assertNonEmpty(set[field], `upstreamBinding.sourceUnitSet.${field}`);
  for (const field of [
    'sourceUnitSetHash',
    'pdfSha256',
    'layoutArtifactSha256',
    'layoutHash',
    'specManifestHash',
  ]) assertContentHash(set[field], `upstreamBinding.sourceUnitSet.${field}`);
  if (!/^SUS-[A-F0-9]{24}$/u.test(set.sourceUnitSetId)
    || set.sourceUnitSetId
      !== `SUS-${set.sourceUnitSetHash.slice('sha256:'.length, 'sha256:'.length + 24).toUpperCase()}`) {
    throw new Error('Feishu-native SourceUnitSet identity mismatch.');
  }
  if (set.documentId !== input.documentIdentity.documentId
    || set.documentVersionId !== input.documentIdentity.revisionId
    || set.sourceUnitSetId !== packageBinding.sourceUnitSetId
    || set.sourceUnitSetHash !== packageBinding.sourceUnitSetHash) {
    throw new Error('Feishu-native SourceUnitSet identity does not match assessment input.');
  }
  const sourceUnits = new Map();
  for (const [index, unit] of set.units.entries()) {
    assertNonEmpty(unit?.unitId, `sourceUnitSet.units[${index}].unitId`);
    assertContentHash(unit?.unitHash, `sourceUnitSet.units[${index}].unitHash`);
    if (!/^SU-[A-F0-9]{24}$/u.test(unit.unitId)
      || unit.unitId
        !== `SU-${unit.unitHash.slice('sha256:'.length, 'sha256:'.length + 24).toUpperCase()}`
      || unit.sourceBounded !== true
      || unit.frozen !== true
      || !Array.isArray(unit.sourceRefs)
      || unit.sourceRefs.length === 0) {
      throw new Error(`sourceUnitSet.units[${index}] is not a frozen source-bounded unit.`);
    }
    if (sourceUnits.has(unit.unitId)) {
      throw new Error(`sourceUnitSet contains duplicate unitId ${unit.unitId}.`);
    }
    sourceUnits.set(unit.unitId, unit);
  }
  const sourceBindings = input.upstreamBinding?.sourceBindings;
  if (!Array.isArray(sourceBindings) || sourceBindings.length === 0) {
    throw new Error('Feishu-native assessment input requires field-level sourceBindings.');
  }
  const seenBindingIds = new Set();
  const seenFieldPaths = new Set();
  for (const [index, binding] of sourceBindings.entries()) {
    assertNonEmpty(binding?.unitId, `sourceBindings[${index}].unitId`);
    assertContentHash(binding?.unitHash, `sourceBindings[${index}].unitHash`);
    assertNonEmpty(binding?.fieldPath, `sourceBindings[${index}].fieldPath`);
    if (!/^SO-[A-F0-9]{24}$/u.test(binding.unitId)
      || binding.unitId
        !== `SO-${binding.unitHash.slice('sha256:'.length, 'sha256:'.length + 24).toUpperCase()}`
      || binding.sourceBounded !== true || !Array.isArray(binding.sourceRefs)
      || binding.sourceRefs.length === 0) {
      throw new Error(`sourceBindings[${index}] is not source-bounded.`);
    }
    if (seenBindingIds.has(binding.unitId) || seenFieldPaths.has(binding.fieldPath)) {
      throw new Error(`sourceBindings[${index}] duplicates an object identity or field path.`);
    }
    seenBindingIds.add(binding.unitId);
    seenFieldPaths.add(binding.fieldPath);
    for (const [refIndex, ref] of binding.sourceRefs.entries()) {
      const sourceUnit = sourceUnits.get(ref?.sourceUnitId);
      if (!sourceUnit || sourceUnit.unitHash !== ref?.sourceUnitHash) {
        throw new Error(`sourceBindings[${index}].sourceRefs[${refIndex}] is not in SourceUnitSet.`);
      }
    }
  }
  if (!input.parsedResult || typeof input.parsedResult !== 'object'
    || input.parsedResult.documentId !== input.documentIdentity.documentId
    || input.parsedResult.revisionId !== input.documentIdentity.revisionId
    || (input.parsedResult.docFamily
      ?? input.parsedResult.coreFields?.documentFamily?.value)
      !== input.documentIdentity.documentFamily) {
    throw new Error('Feishu-native parsed result identity does not match assessment input.');
  }
  return true;
}

function assertFrozenSourceUnitSetBinding({
  sourceUnitSet,
  packageBinding,
  parserArtifact,
  documentIdentity,
}) {
  if (sourceUnitSet?.schemaVersion !== WISELINK_V3_1_SOURCE_UNIT_SET_SCHEMA) {
    throw new Error('SourceUnitSet schema mismatch.');
  }
  if (sourceUnitSet.unitSchemaVersion !== WISELINK_V3_1_SOURCE_UNIT_SCHEMA) {
    throw new Error('SourceUnit schema mismatch.');
  }
  for (const field of [
    'sourceUnitSetId',
    'sourceUnitSetHash',
    'lifecycleStatus',
    'structuredParsePackageId',
    'structuredParsePackageHash',
    'parserArtifactSchemaVersion',
    'semanticOutputHash',
    'semanticOutputHashPolicySchemaVersion',
    'specManifestId',
    'sourceContractVersion',
  ]) {
    assertNonEmpty(sourceUnitSet[field], `upstreamBinding.sourceUnitSet.${field}`);
  }
  if (!/^SUS-[A-F0-9]{32}$/u.test(sourceUnitSet.sourceUnitSetId)) {
    throw new TypeError('sourceUnitSet.sourceUnitSetId must use the frozen SUS identity format.');
  }
  assertSha256(sourceUnitSet.sourceUnitSetHash, 'sourceUnitSet.sourceUnitSetHash');
  if (sourceUnitSet.sourceUnitSetId
    !== `SUS-${sourceUnitSet.sourceUnitSetHash.slice(0, 32).toUpperCase()}`) {
    throw new Error('SourceUnitSet ID does not match sourceUnitSetHash.');
  }
  if (sourceUnitSet.lifecycleStatus !== 'FROZEN'
    || sourceUnitSet.frozen !== true
    || sourceUnitSet.packageCurrentAtFreeze !== true) {
    throw new Error('SourceUnitSet must be frozen from a current package.');
  }
  if (!Number.isInteger(sourceUnitSet.unitCount) || sourceUnitSet.unitCount <= 0
    || sourceUnitSet.sourceBoundUnitCount !== sourceUnitSet.unitCount) {
    throw new Error('SourceUnitSet must contain one or more fully source-bounded units.');
  }
  if (sourceUnitSet.structuredParsePackageId !== packageBinding.packageId
    || sourceUnitSet.structuredParsePackageHash !== packageBinding.contentHash) {
    throw new Error('SourceUnitSet package identity does not match StructuredParsePackage.');
  }
  if (sourceUnitSet.documentId !== documentIdentity.documentId
    || sourceUnitSet.revisionId !== documentIdentity.revisionId
    || sourceUnitSet.documentFamily !== documentIdentity.documentFamily) {
    throw new Error('SourceUnitSet document identity does not match assessment input.');
  }
  if (sourceUnitSet.semanticOutputHash !== parserArtifact.semanticOutputHash
    || sourceUnitSet.semanticOutputHashPolicySchemaVersion
      !== parserArtifact.semanticOutputHashPolicySchemaVersion) {
    throw new Error('SourceUnitSet semantic output identity does not match parser artifact.');
  }
  if (sourceUnitSet.parserArtifactSchemaVersion
    !== parserArtifact.parserArtifactSchemaVersion) {
    throw new Error('SourceUnitSet parser artifact schema does not match parser artifact.');
  }
  if (sourceUnitSet.specManifestId !== parserArtifact.specManifestId
    || sourceUnitSet.sourceContractVersion !== parserArtifact.sourceContractVersion) {
    throw new Error('SourceUnitSet parser specification or source contract does not match.');
  }
  if (canonicalJson(sourceUnitSet.sourceArtifactHashes)
    !== canonicalJson(parserArtifact.sourceArtifactHashes)) {
    throw new Error('SourceUnitSet source artifact hashes do not match parser artifact.');
  }
  if (!Array.isArray(sourceUnitSet.units)
    || sourceUnitSet.units.length !== sourceUnitSet.unitCount) {
    throw new Error('SourceUnitSet unit bindings do not match unitCount.');
  }
  const seenUnitIds = new Set();
  for (const [index, unit] of sourceUnitSet.units.entries()) {
    if (unit?.schemaVersion !== WISELINK_V3_1_SOURCE_UNIT_SCHEMA) {
      throw new Error(`SourceUnitSet unit schema mismatch at index ${index}.`);
    }
    for (const field of ['unitId', 'unitHash', 'unitType', 'fieldPath', 'identityKey']) {
      assertNonEmpty(unit[field], `sourceUnitSet.units[${index}].${field}`);
    }
    if (!/^SU-[A-F0-9]{32}$/u.test(unit.unitId)) {
      throw new TypeError(`sourceUnitSet.units[${index}].unitId is malformed.`);
    }
    if (seenUnitIds.has(unit.unitId)) {
      throw new Error(`SourceUnitSet contains duplicate unitId ${unit.unitId}.`);
    }
    seenUnitIds.add(unit.unitId);
    assertSha256(unit.unitHash, `sourceUnitSet.units[${index}].unitHash`);
    if (unit.sourceBounded !== true || !Array.isArray(unit.sourceRefs)
      || unit.sourceRefs.length === 0) {
      throw new Error(`SourceUnitSet unit ${unit.unitId} is not source-bounded.`);
    }
    for (const [refIndex, sourceRef] of unit.sourceRefs.entries()) {
      assertSha256(
        sourceRef?.sha256,
        `sourceUnitSet.units[${index}].sourceRefs[${refIndex}].sha256`,
      );
    }
  }
}

export function buildAssessmentUpstreamFingerprint(input) {
  assertSbJobAidAssessmentInput(input);
  const binding = input.upstreamBinding;
  if (isUnifiedAssessmentInput(input)) {
    return sha256(canonicalJson({
      documentIdentity: input.documentIdentity,
      assessmentAsOf: input.assessmentAsOf,
      controlledContext: input.controlledContext ?? {},
      unifiedParsedPackage: buildUnifiedParsedPackageBinding(input),
      sourceBindings: binding.sourceBindings,
    }));
  }
  if (isFeishuNativeAssessmentInput(input)) {
    return sha256(canonicalJson({
      documentIdentity: input.documentIdentity,
      assessmentAsOf: input.assessmentAsOf,
      controlledContext: input.controlledContext ?? {},
      structuredParsePackage: {
        schemaVersion: binding.structuredParsePackage.schemaVersion,
        packageId: binding.structuredParsePackage.packageId,
        contentHash: binding.structuredParsePackage.contentHash,
        semanticOutputHash: binding.structuredParsePackage.semanticOutputHash,
        lifecycleStatus: binding.structuredParsePackage.lifecycleStatus,
        qualityGateStatus: binding.structuredParsePackage.qualityGateStatus,
        currentness: binding.structuredParsePackage.currentness,
        currentConsumptionAllowed:
          binding.structuredParsePackage.currentConsumptionAllowed,
        sourceUnitSetId: binding.structuredParsePackage.sourceUnitSetId,
        sourceUnitSetHash: binding.structuredParsePackage.sourceUnitSetHash,
        structuredSpecManifestId:
          binding.structuredParsePackage.structuredSpecManifestId,
        structuredSpecManifestHash:
          binding.structuredParsePackage.structuredSpecManifestHash,
        inputManifestHash: binding.structuredParsePackage.inputManifestHash,
        runMode: binding.structuredParsePackage.runMode,
        datasetSplit: binding.structuredParsePackage.datasetSplit,
      },
      sourceUnitSet: buildSourceUnitSetBinding(input),
      sourceBindings: binding.sourceBindings,
    }));
  }
  return sha256(canonicalJson({
    documentIdentity: input.documentIdentity,
    assessmentAsOf: input.assessmentAsOf,
    controlledContext: input.controlledContext ?? {},
    structuredParsePackage: {
      contentIdentitySchema: binding.structuredParsePackage.contentIdentitySchema,
      packageId: binding.structuredParsePackage.packageId,
      contentHash: binding.structuredParsePackage.contentHash,
      status: binding.structuredParsePackage.status,
      currentness: binding.structuredParsePackage.currentness,
      currentConsumptionAllowed: binding.structuredParsePackage.currentConsumptionAllowed,
    },
    parserArtifact: {
      bundleSchemaVersion: binding.parserArtifact.bundleSchemaVersion,
      artifactKind: binding.parserArtifact.artifactKind,
      parserArtifactSchemaVersion: binding.parserArtifact.parserArtifactSchemaVersion,
      semanticOutputHash: binding.parserArtifact.semanticOutputHash,
      semanticOutputHashPolicySchemaVersion:
        binding.parserArtifact.semanticOutputHashPolicySchemaVersion,
      specManifestId: binding.parserArtifact.specManifestId,
      sourceContractVersion: binding.parserArtifact.sourceContractVersion,
      sourceArtifactHashes: binding.parserArtifact.sourceArtifactHashes,
      fieldSourceRefs: binding.parserArtifact.fieldSourceRefs,
    },
    sourceUnitSet: binding.sourceUnitSet,
  }));
}

export function isSbJobAidAssessmentPackageStale(assessmentPackage, currentInput) {
  const expectedSchema = isUnifiedAssessmentInput(currentInput)
    ? WISELINK_V3_1_UNIFIED_SB_JOB_AID_ASSESSMENT_PACKAGE_SCHEMA
    : isFeishuNativeAssessmentInput(currentInput)
      ? WISELINK_V3_1_FEISHU_NATIVE_SB_JOB_AID_ASSESSMENT_PACKAGE_SCHEMA
      : WISELINK_V3_1_SB_JOB_AID_ASSESSMENT_PACKAGE_SCHEMA;
  if (assessmentPackage?.schemaVersion !== expectedSchema) {
    throw new Error('Cannot compare an unknown assessment package schema.');
  }
  return assessmentPackage.upstreamFingerprint !== buildAssessmentUpstreamFingerprint(currentInput);
}

function buildEvaluationContext(input) {
  const core = input.parsedResult.coreFields ?? {};
  const rawDocumentType = fieldValue(core.documentFamily) || input.documentIdentity.documentFamily;
  const documentType = normalizeJobAidDocumentType(rawDocumentType);
  const applicabilityRaw = fieldValue(core.applicabilityRaw);
  const revisionLabel = normalizeString(fieldValue(core.revisionLabel));
  const sourceExists = Boolean(input.parsedResult && (isUnifiedAssessmentInput(input)
    ? input.upstreamBinding.unifiedParsedPackage.packageContentHash
    : isFeishuNativeAssessmentInput(input)
      ? input.upstreamBinding.structuredParsePackage.semanticOutputHash
      : input.upstreamBinding.parserArtifact.semanticOutputHash));
  const assessmentApplicability = normalizeString(input.controlledContext?.assessment?.applicability)
    || (normalizeString(applicabilityRaw) ? '待核实' : '待核实');
  return deepMerge({
    assessment: {
      exists: true,
      applicability: assessmentApplicability,
    },
    source_document: { exists: sourceExists },
    document: {
      ...(documentType ? { type: documentType } : {}),
      ...(revisionLabel ? { is_revision: revisionLabel !== 'R00' } : {}),
    },
    applicability: {
      overall: assessmentApplicability,
      ...(assessmentApplicability === '确认适用'
        ? { confirmed: true }
        : assessmentApplicability === '确认不适用'
          ? { confirmed: false }
          : {}),
    },
    attachment5: { voluntarily_enabled: false },
  }, input.controlledContext ?? {});
}

function buildEvaluationItem({ criterion, criterionMember, context, input, answer }) {
  if (!criterionMember) {
    throw new Error(`Criterion ${criterion.criterion_id} is not a member of the selected CriterionSet.`);
  }
  const applicabilityState = evaluateApplicabilityPredicate(
    criterion.applicability_predicate,
    context,
  );
  const missingPredicateInputs = collectPredicatePaths(criterion.applicability_predicate)
    .filter((path) => !hasPath(context, path));
  const base = {
    criterion_id: criterion.criterion_id,
    criterion_version_id: criterionMember.criterionVersionId,
    criterion_hash: criterionMember.criterionHash,
    global_sequence: criterion.global_sequence,
    stage_code: criterion.stage_code,
    stage_name: criterion.stage_name,
    criterion_name: criterion.criterion_name,
    evaluation_question: criterion.evaluation_question,
    applicability_predicate: criterion.applicability_predicate,
    predicate_result: applicabilityState,
    applies: applicabilityState === TRI_STATE.TRUE
      ? true
      : applicabilityState === TRI_STATE.FALSE
        ? false
        : null,
    applicability_rationale: applicabilityState === TRI_STATE.UNKNOWN
      ? `缺少谓词输入：${missingPredicateInputs.join('、') || '组合表达式仍有未知值'}`
      : `受控谓词结果：${applicabilityState}`,
    missing_predicate_inputs: missingPredicateInputs,
    automation_mode: criterion.automation_mode,
    source_provenance: criterion.source_provenance,
    normative_force: criterion.normative_force,
    blocker: criterion.blocker_level,
    evidence_requirements: compact([
      evidenceRequirement('DOCUMENT', criterion.required_doc_evidence),
      evidenceRequirement('EXTERNAL', criterion.required_external_evidence),
    ]),
    source_locator_candidates: compact([
      criterion.source_document || null,
      criterion.source_section || null,
      criterion.source_page || null,
    ]),
    source_evidence_candidates: buildJobAidSourceEvidenceCandidates({ criterion, input }),
    evidence_refs: [],
    extracted_facts: null,
    confidence: null,
    rationale: null,
    reviewer_comment: null,
    blocking_condition_met: null,
  };

  if (applicabilityState === TRI_STATE.FALSE) {
    return {
      ...base,
      status: '不适用',
      decision: '不适用',
      blocking_condition_met: false,
    };
  }
  if (applicabilityState === TRI_STATE.UNKNOWN) {
    return {
      ...base,
      status: '需补证据',
      decision: '信息不足',
      blocking_condition_met: ['HARD_BLOCK', 'ACTION_BLOCK'].includes(criterion.blocker_level),
    };
  }

  const deterministic = executeDeterministicCriterion(criterion, input, context);
  const applicableBase = deterministic ?? {
    status: criterion.automation_mode === 'HUMAN_REQUIRED' ? '需人工复核' : '待评估',
    decision: criterion.automation_mode === 'HUMAN_REQUIRED' ? '需人工判断' : null,
    rationale: criterion.automation_mode === 'HUMAN_REQUIRED'
      ? '该规则明确要求工程师或授权角色作出判断。'
      : '谓词已成立；决策规则尚未获得充分证据或执行结果。',
    blocking_condition_met: ['HARD_BLOCK', 'ACTION_BLOCK'].includes(criterion.blocker_level),
  };
  const withBase = { ...base, ...applicableBase };
  return answer ? applyCriterionAnswer(withBase, answer) : withBase;
}

function executeDeterministicCriterion(criterion, input, context) {
  if (criterion.criterion_id === 'GOV-003') {
    const core = input.parsedResult.coreFields ?? {};
    const identity = {
      document_number: fieldValue(core.documentCode),
      title: fieldValue(core.title),
      revision: fieldValue(core.revisionLabel),
      issue_date: fieldValue(core.issuedAt) || fieldValue(core.publishedAt),
      issuer: fieldValue(core.issuer),
      document_type: context.document?.type,
      aircraft_models: fieldValue(core.aircraftModels),
      ata: fieldValue(core.ataChapters) || fieldValue(core.ataSystems),
      file_hash: sourcePdfHash(input),
    };
    const missing = Object.entries(identity)
      .filter(([, value]) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0))
      .map(([key]) => key);
    return {
      status: missing.length === 0 ? '候选符合' : '需补证据',
      decision: missing.length === 0 ? '符合' : '信息不足',
      extracted_facts: identity,
      rationale: missing.length === 0
        ? '受控解析结果包含完整的核心文档身份字段。'
        : `核心文档身份仍缺少：${missing.join('、')}。`,
      confidence: missing.length === 0 ? 1 : 0,
      blocking_condition_met: missing.length > 0,
    };
  }
  if (criterion.criterion_id === 'CLS-001') {
    const documentType = context.document?.type;
    const parserFamily = normalizeJobAidDocumentType(
      fieldValue(input.parsedResult.coreFields?.documentFamily),
    );
    const recognized = ALLOWED_DOCUMENT_TYPES.has(documentType) && parserFamily === documentType;
    return {
      status: recognized ? '候选符合' : '需补证据',
      decision: recognized ? '符合' : '信息不足',
      extracted_facts: {
        document_type: documentType ?? null,
        parser_document_family: parserFamily ?? null,
      },
      rationale: recognized
        ? `文档身份与解析模板一致识别为 ${documentType}。`
        : '文件类型无法由源文件身份与解析模板一致确认。',
      confidence: recognized ? 1 : 0,
      blocking_condition_met: !recognized,
    };
  }
  return null;
}

function applyCriterionAnswer(item, answer) {
  if (!answer || typeof answer !== 'object') throw new TypeError(`Invalid answer for ${item.criterion_id}.`);
  if (!['符合', '不符合', '不适用', '信息不足', '冲突', '需人工判断'].includes(answer.decision)) {
    throw new Error(`Invalid decision for ${item.criterion_id}.`);
  }
  if (!['待评估', '候选符合', '已确认', '需补证据', '需人工复核', '被阻断', '不适用'].includes(answer.status)) {
    throw new Error(`Invalid status for ${item.criterion_id}.`);
  }
  return {
    ...item,
    status: answer.status,
    decision: answer.decision,
    rationale: normalizeString(answer.rationale) || item.rationale,
    reviewer_comment: normalizeString(answer.reviewerComment) || null,
    evidence_refs: Array.isArray(answer.evidenceCandidateRefs) ? [...answer.evidenceCandidateRefs] : [],
    blocking_condition_met: answer.blockingConditionMet ?? !TERMINAL_ITEM_STATUSES.has(answer.status),
    answer_authority: 'human_or_controlled_workflow_candidate_only',
  };
}

function buildAttachment5Candidate(rulePack, context, evaluationItems) {
  const gov008 = evaluationItems.find((item) => item.criterion_id === 'GOV-008');
  const importantSystem = context.system?.is_important;
  const voluntary = context.attachment5?.voluntarily_enabled === true;
  const required = importantSystem === true || voluntary
    ? true
    : importantSystem === false && !voluntary
      ? false
      : null;
  return {
    required,
    triggerReason: voluntary
      ? '工程师主动启用附件5'
      : importantSystem === true
        ? '受控事实确认涉及重要系统'
        : importantSystem === false
          ? '受控事实确认不涉及重要系统且未主动启用'
          : 'GOV-008 仍需人工确认重要系统属性',
    attachedToTdms: false,
    activationGateCriterionId: 'GOV-008',
    completionGateCriterionId: 'GOV-009',
    activationStatus: gov008?.status ?? '需人工复核',
    items: required === true
      ? rulePack.formal_attachment5.items.map((item) => ({
        item_id: item.item_id,
        item_name: item.item_name,
        applies: null,
        disposition: null,
        rationale: null,
        evidence_refs: [],
        mapped_criteria_ids: [...(item.mapped_criteria_ids ?? [])],
      }))
      : [],
  };
}

function aggregateGates(evaluationItems, attachment5) {
  const hardBlockItems = evaluationItems.filter((item) => item.blocker === 'HARD_BLOCK'
    && item.applies !== false
    && item.blocking_condition_met !== false);
  const actionBlockItems = evaluationItems.filter((item) => item.blocker === 'ACTION_BLOCK'
    && item.applies !== false
    && item.blocking_condition_met !== false);
  const warningItems = evaluationItems.filter((item) => item.blocker === 'WARNING'
    && item.applies !== false
    && item.status !== '已确认');
  const attachment5Block = attachment5.required === true
    && (!attachment5.attachedToTdms || attachment5.items.some((item) => !item.disposition));
  return {
    formalConclusionBlocked: hardBlockItems.length > 0 || attachment5Block,
    downstreamActionBlocked: actionBlockItems.length > 0,
    attachment5Blocked: attachment5Block,
    hardBlockCriterionIds: hardBlockItems.map((item) => item.criterion_id),
    actionBlockCriterionIds: actionBlockItems.map((item) => item.criterion_id),
    warningCriterionIds: warningItems.map((item) => item.criterion_id),
    precedence: ['HARD_BLOCK', 'ACTION_BLOCK', 'WARNING', 'NONE'],
  };
}

function derivePackageStatus(input, gates) {
  if (isUnifiedAssessmentInput(input)) {
    const source = input.upstreamBinding.unifiedParsedPackage;
    const available = source.lifecycleStatus === 'FROZEN'
      && source.selectionStatus === 'SELECTED'
      && source.currentness === 'current'
      && source.currentConsumptionAllowed === true;
    if (!available) return source.currentness === 'stale' ? 'STALE' : 'BLOCKED_MISSING_INPUT';
    if (gates.formalConclusionBlocked || gates.downstreamActionBlocked) {
      return 'BLOCKED_MISSING_INPUT';
    }
    return 'NEEDS_REVIEW';
  }
  const source = input.upstreamBinding.structuredParsePackage;
  const sourceAvailable = isFeishuNativeAssessmentInput(input)
    ? source.lifecycleStatus === 'FROZEN'
      && source.qualityGateStatus === 'PASS'
      && source.currentness === 'current'
      && source.currentConsumptionAllowed === true
    : ACTIVE_PACKAGE_STATUSES.has(source.status)
      && source.currentness === 'current'
      && source.currentConsumptionAllowed === true;
  if (!sourceAvailable) {
    return source.currentness === 'stale' ? 'STALE' : 'BLOCKED_MISSING_INPUT';
  }
  if (gates.formalConclusionBlocked || gates.downstreamActionBlocked) return 'BLOCKED_MISSING_INPUT';
  return 'NEEDS_REVIEW';
}

function summarizeEvaluationItems(items) {
  const countsByPredicate = countBy(items, 'predicate_result');
  const countsByStatus = countBy(items, 'status');
  return {
    total: items.length,
    countsByPredicate,
    countsByStatus,
    candidatePassCount: countsByStatus['候选符合'] ?? 0,
    confirmedCount: countsByStatus['已确认'] ?? 0,
    unresolvedCount: items.filter((item) => !TERMINAL_ITEM_STATUSES.has(item.status)).length,
    humanRequiredCount: items.filter((item) => item.automation_mode === 'HUMAN_REQUIRED' && item.applies !== false).length,
  };
}

function buildV02CompatiblePayload({
  input,
  rulePack,
  rulePackHash,
  evaluationContext,
  evaluationItems,
  attachment5,
  gates,
  assessmentId,
  generatedAt,
}) {
  const template = structuredClone(rulePack.assessment_package_template ?? {});
  const core = input.parsedResult.coreFields ?? {};
  return {
    ...template,
    schema_version: '0.2',
    assessment_id: assessmentId,
    source_document: {
      ...(template.source_document ?? {}),
      document_number: fieldValue(core.documentCode),
      title: fieldValue(core.title),
      revision: fieldValue(core.revisionLabel),
      issue_date: fieldValue(core.issuedAt) || fieldValue(core.publishedAt),
      issuer: fieldValue(core.issuer),
      document_type: evaluationContext.document?.type ?? null,
      ata: fieldValue(core.ataChapters) || fieldValue(core.ataSystems) || null,
      file_hash: sourcePdfHash(input),
    },
    classification: {
      ...(template.classification ?? {}),
      document_class: null,
    },
    applicability: {
      ...(template.applicability ?? {}),
      overall: evaluationContext.applicability?.overall ?? '待核实',
      predicates: [],
      fleet_matrix: [],
      affected_assets: [],
      unresolved_assets: [{
        reason: normalizeString(fieldValue(core.applicabilityRaw))
          ? '存在源文件适用性原文，但尚未绑定受控机队事实并完成确定性矩阵计算。'
          : '上游解析未提供适用性原文；禁止由空值推断确认不适用。',
      }],
    },
    evaluation_items: evaluationItems,
    engineering_plan: {
      ...(template.engineering_plan ?? {}),
      overall_decision: '信息不足_待补充',
    },
    overall_opinion: {
      ...(template.overall_opinion ?? {}),
      summary: '候选评估已实例化；当前存在未决证据或人工判断，不形成正式工程结论。',
      applicability_statement: '待核实：尚未完成受控机队事实绑定与确定性适用性矩阵计算。',
      unresolved_questions: [
        ...gates.hardBlockCriterionIds.map((id) => `${id} 硬阻断尚未解除`),
        ...gates.actionBlockCriterionIds.map((id) => `${id} 动作阻断尚未解除`),
      ],
    },
    review: {
      state: 'AI_CANDIDATE',
      engineer: null,
      reviewer: null,
      approved_at: null,
    },
    trace: {
      ...(template.trace ?? {}),
      created_at: generatedAt,
      updated_at: generatedAt,
      assessment_as_of: input.assessmentAsOf,
      rule_versions: [{ schema_version: '0.2', source_hash: rulePackHash }],
      source_provenance_summary: buildSourceProvenanceSummary(input),
      dependency_status: [buildSourceDependencyStatus(input)],
    },
    formal_attachment5: {
      required: attachment5.required,
      trigger_reason: attachment5.triggerReason,
      attached_to_tdms: attachment5.attachedToTdms,
      items: attachment5.items,
    },
    _wiselink_control: {
      candidate_only: true,
      upstream_fingerprint: buildAssessmentUpstreamFingerprint(input),
      formal_conclusion_blocked: gates.formalConclusionBlocked,
      source_unit_set_bound: !isUnifiedAssessmentInput(input),
      unified_parsed_package_bound: isUnifiedAssessmentInput(input),
    },
  };
}

function buildSourceUnitSetBinding(input) {
  const set = input.upstreamBinding.sourceUnitSet;
  if (!isFeishuNativeAssessmentInput(input)) return structuredClone(set);
  return {
    schemaVersion: set.schemaVersion,
    consumptionContractVersion: set.consumptionContractVersion,
    hashContractVersion: set.hashContractVersion,
    sourceUnitSetId: set.sourceUnitSetId,
    sourceUnitSetHash: set.sourceUnitSetHash,
    documentId: set.documentId,
    documentVersionId: set.documentVersionId,
    pdfFileToken: set.pdfFileToken,
    pdfSha256: set.pdfSha256,
    driveSourceVersion: set.driveSourceVersion,
    layoutArtifactRef: set.layoutArtifactRef,
    layoutArtifactSha256: set.layoutArtifactSha256,
    layoutHash: set.layoutHash,
    layoutSchemaVersion: set.layoutSchemaVersion,
    sourceContractVersion: set.sourceContractVersion,
    specManifestId: set.specManifestId,
    specManifestHash: set.specManifestHash,
    lifecycleStatus: set.lifecycleStatus,
    isCurrent: set.isCurrent,
    frozen: set.frozen,
    unitCount: set.unitCount,
    sourceBoundUnitCount: set.sourceBoundUnitCount,
  };
}

function buildUnifiedParsedPackageBinding(input) {
  const source = input.upstreamBinding.unifiedParsedPackage;
  return {
    readerSchemaVersion: source.readerSchemaVersion,
    contractRevision: source.contractRevision,
    documentId: source.documentId,
    documentVersionId: source.documentVersionId,
    packageId: source.packageId,
    packageContentHash: source.packageContentHash,
    packageSemanticHash: source.packageSemanticHash,
    packageProvenanceHash: source.packageProvenanceHash,
    packageCoverageHash: source.packageCoverageHash,
    artifactRef: source.artifactRef,
    artifactHash: source.artifactHash,
    sourceKind: source.sourceKind,
    sourcePackageId: source.sourcePackageId,
    sourceArtifactHash: source.sourceArtifactHash,
    resultStatus: source.resultStatus,
    lifecycleStatus: source.lifecycleStatus,
    selectionStatus: source.selectionStatus,
    currentness: source.currentness,
    currentConsumptionAllowed: source.currentConsumptionAllowed,
    classification: structuredClone(source.classification),
    readerReceiptHash: source.readerReceiptHash,
  };
}

function buildUnifiedParsedSourceContext(input) {
  const observation = input.publicPackageObservation;
  const pageSourceRefs = observation?.pageSourceRefs;
  if (!Array.isArray(pageSourceRefs) || pageSourceRefs.length === 0) {
    throw new Error('Unified assessment input requires pageSourceRefs.');
  }
  const seenPages = new Set();
  const sourcePages = pageSourceRefs.map((ref, index) => {
    for (const field of [
      'sourceRefId', 'artifactRef', 'quote', 'anchorTextHash',
    ]) assertNonEmpty(ref?.[field], `pageSourceRefs[${index}].${field}`);
    assertContentHash(
      ref.anchorTextHash,
      `pageSourceRefs[${index}].anchorTextHash`,
    );
    if (!Number.isInteger(ref.pageStart) || ref.pageStart < 1
      || !Number.isInteger(ref.pageEnd) || ref.pageEnd !== ref.pageStart
      || seenPages.has(ref.pageStart)) {
      throw new Error(`pageSourceRefs[${index}] has an invalid page identity.`);
    }
    seenPages.add(ref.pageStart);
    if (`sha256:${sha256(ref.quote)}` !== ref.anchorTextHash) {
      throw new Error(`pageSourceRefs[${index}] quote hash mismatch.`);
    }
    return {
      sourceRefId: ref.sourceRefId,
      artifactRef: ref.artifactRef,
      pageStart: ref.pageStart,
      pageEnd: ref.pageEnd,
      quote: ref.quote,
      anchorTextHash: ref.anchorTextHash,
    };
  }).sort((left, right) => left.pageStart - right.pageStart);
  const identity = {
    resultStatus: observation.resultStatus,
    sourcePages,
  };
  return {
    schemaVersion: 'wiselink.v3_1.sb_job_aid.parsed_source_context.v1',
    contextHash: `sha256:${sha256(canonicalJson(identity))}`,
    status: 'AVAILABLE_CANDIDATE',
    resultStatus: observation.resultStatus,
    pageCount: sourcePages.length,
    sourcePages,
    authorityBoundary: {
      sourceTextCandidateOnly: true,
      createsFleetFact: false,
      createsEvidenceRef: false,
      createsEngineerDecision: false,
    },
  };
}

function buildSourceProvenanceSummary(input) {
  const upstreamFingerprint = buildAssessmentUpstreamFingerprint(input);
  if (isUnifiedAssessmentInput(input)) {
    const source = input.upstreamBinding.unifiedParsedPackage;
    return {
      upstream_fingerprint: upstreamFingerprint,
      unified_parsed_package_id: source.packageId,
      package_content_hash: source.packageContentHash,
      package_semantic_hash: source.packageSemanticHash,
      package_provenance_hash: source.packageProvenanceHash,
      package_coverage_hash: source.packageCoverageHash,
      artifact_hash: source.artifactHash,
      source_artifact_hash: source.sourceArtifactHash,
      reader_receipt_hash: source.readerReceiptHash,
      field_source_binding_count: input.upstreamBinding.sourceBindings.length,
    };
  }
  if (!isFeishuNativeAssessmentInput(input)) {
    return {
      upstream_fingerprint: upstreamFingerprint,
      parser_artifact_output_hash:
        input.upstreamBinding.parserArtifact.parserArtifactOutputHash,
      semantic_output_hash: input.upstreamBinding.parserArtifact.semanticOutputHash,
      semantic_output_hash_policy_schema_version:
        input.upstreamBinding.parserArtifact.semanticOutputHashPolicySchemaVersion,
      source_artifact_hashes: input.upstreamBinding.parserArtifact.sourceArtifactHashes,
      source_unit_set_id: input.upstreamBinding.sourceUnitSet.sourceUnitSetId,
      source_unit_set_hash: input.upstreamBinding.sourceUnitSet.sourceUnitSetHash,
    };
  }
  const packageBinding = input.upstreamBinding.structuredParsePackage;
  const set = input.upstreamBinding.sourceUnitSet;
  return {
    upstream_fingerprint: upstreamFingerprint,
    structured_parse_package_id: packageBinding.packageId,
    semantic_output_hash: packageBinding.semanticOutputHash,
    structured_spec_manifest_id: packageBinding.structuredSpecManifestId,
    structured_spec_manifest_hash: packageBinding.structuredSpecManifestHash,
    input_manifest_hash: packageBinding.inputManifestHash,
    source_artifact_hashes: {
      pdf: set.pdfSha256,
      layout_artifact: set.layoutArtifactSha256,
      layout_semantic: set.layoutHash,
    },
    source_unit_set_id: set.sourceUnitSetId,
    source_unit_set_hash: set.sourceUnitSetHash,
    field_source_binding_count: input.upstreamBinding.sourceBindings.length,
  };
}

function buildSourceDependencyStatus(input) {
  return isUnifiedAssessmentInput(input)
    ? {
      dependency: 'frozen.2 Unified Parsed Package bound to exact DocumentVersion',
      status: 'BOUND_CURRENT_PUBLIC_READER_CONTRACT',
    }
    : isFeishuNativeAssessmentInput(input)
    ? {
      dependency: 'Feishu-native FROZEN/current StructuredParsePackage and SourceUnitSet',
      status: 'BOUND_CURRENT_SOURCE_CONTRACT',
    }
    : {
      dependency: 'frozen SourceUnitSet v1',
      status: 'BOUND_BRANCH_CONTRACT_CANONICAL_RUNTIME_MERGE_PENDING',
    };
}

function sourcePdfHash(input) {
  return isUnifiedAssessmentInput(input)
    ? input.upstreamBinding.unifiedParsedPackage.sourceArtifactHash
    : isFeishuNativeAssessmentInput(input)
    ? input.upstreamBinding.sourceUnitSet.pdfSha256
    : input.upstreamBinding.parserArtifact.sourceArtifactHashes.pdf;
}

function isFeishuNativeAssessmentInput(input) {
  return input?.schemaVersion
    === WISELINK_V3_1_FEISHU_NATIVE_SB_JOB_AID_ASSESSMENT_INPUT_SCHEMA;
}

function isUnifiedAssessmentInput(input) {
  return input?.schemaVersion
    === WISELINK_V3_1_UNIFIED_SB_JOB_AID_ASSESSMENT_INPUT_SCHEMA;
}

function buildAuthorityBoundary() {
  return {
    canCreateEvidenceRef: false,
    canCreateClosureDecision: false,
    canCreateActionReadiness: false,
    canApproveOrPublish: false,
    canSignComplianceOrAirworthiness: false,
    canInferNotApplicableFromMissingData: false,
    humanConfirmationRequiredForFormalConclusion: true,
    silentFailureAllowed: false,
  };
}

function evidenceRequirement(kind, value) {
  const requirement = normalizeString(value);
  return requirement ? { kind, requirement, status: 'UNRESOLVED' } : null;
}

function fieldValue(field) {
  return field && typeof field === 'object' && Object.prototype.hasOwnProperty.call(field, 'value')
    ? field.value
    : field ?? null;
}

function hasPath(context, path) {
  let current = context;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object'
      || !Object.prototype.hasOwnProperty.call(current, segment)
      || current[segment] === undefined) return false;
    current = current[segment];
  }
  return true;
}

function countBy(items, key) {
  return items.reduce((accumulator, item) => {
    const value = String(item[key] ?? 'null');
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {});
}

function compact(values) {
  return values.filter(Boolean);
}

function deepMerge(base, overlay) {
  const output = structuredClone(base);
  for (const [key, value] of Object.entries(overlay ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = structuredClone(value);
    }
  }
  return output;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertNonEmpty(value, path) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${path} must be a non-empty string.`);
}

function assertSha256(value, path) {
  if (!/^[a-f0-9]{64}$/iu.test(String(value ?? ''))) throw new TypeError(`${path} must be a SHA-256 hex string.`);
}

function assertContentHash(value, path) {
  if (!/^(?:sha256:)?[a-f0-9]{64}$/iu.test(String(value ?? ''))) {
    throw new TypeError(`${path} must be a SHA-256 content hash.`);
  }
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}
