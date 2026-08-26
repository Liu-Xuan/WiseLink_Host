import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root = process.cwd();
const importBuilt = (relativePath) =>
  import(pathToFileURL(resolve(root, 'dist/server', relativePath)));

test('APP-003 routes the actual 737-34-3830 FMC work to existing applicability owners', async () => {
  const { assessmentPackage, input } = await actualAssessment();
  const item = assessmentPackage.evaluationItems.find(
    (candidate) => candidate.criterion_id === 'APP-003',
  );

  assert.ok(item);
  assert.equal(item.predicate_result, 'TRUE');
  assert.equal(item.status, '需补证据');
  assert.notEqual(item.decision, '符合');
  assert.equal(
    item.extracted_facts.workObjectRoute,
    'COMPONENT_APPLICABILITY_OWNER_REQUIRED',
  );
  assert.deepEqual(item.extracted_facts.requiredOwnerCriterionIds, [
    'APP-001',
    'APP-002',
  ]);
  assert.equal(
    item.extracted_facts.requiredOwner,
    'FLEET_MASTER_DATA_APPLICABILITY',
  );
  assert.equal(item.extracted_facts.existingOwnerResultBound, false);
  assert.equal(
    item.missing_inputs[0].reasonCategory,
    'DATA_SOURCE_NOT_CONNECTED',
  );
  assert.equal(
    item.method_execution.state,
    'COMPLETED_WAITING_FOR_EXISTING_OWNER',
  );
  assert.equal(item.method_execution.outputAuthorityLevel, 'candidate_only');
  assert.deepEqual(Object.keys(item.method_execution.engineerPresentation), [
    'evaluationProblem',
    'lifecycle',
    'requiredEvidence',
    'sourceFacts',
    'specializedMethod',
    'authorityBoundary',
  ]);
  assert.deepEqual(
    item.method_execution.engineerPresentation.sourceFacts.map(
      (fact) => fact.fieldPath,
    ),
    [
      'coreFields.applicabilityRaw.value',
      'familyFields.workInstructionSteps.value[0]',
    ],
  );
  assert.match(
    item.method_execution.engineerPresentation.sourceFacts[0].fact,
    /737-9|Spares Affected/u,
  );
  assert.match(
    item.method_execution.engineerPresentation.sourceFacts[1].fact,
    /Flight Management Computers/u,
  );
  assert.equal(
    item.method_execution.engineerPresentation.sourceFacts.every(
      (fact) => fact.sourceBounded && fact.sourceRefIds.length > 0,
    ),
    true,
  );
  assert.deepEqual(item.source_evidence_candidates, []);
  assert.equal(
    input.structuredAssessmentContext.authorityBoundary
      .documentApplicabilityProvesFleetApplicability,
    false,
  );
});

test('APP-003 distinguishes missing data, engineer decision, and not-applicable without PASS', async () => {
  const { buildPackage, input } = await actualAssessment();

  const missingWork = structuredClone(input);
  missingWork.upstreamBinding.sourceBindings =
    missingWork.upstreamBinding.sourceBindings.filter(
      (binding) =>
        binding.fieldPath !== 'familyFields.workInstructionSteps.value[0]',
    );
  const missingItem = app003(buildPackage(missingWork));
  assert.equal(missingItem.status, '需补证据');
  assert.equal(
    missingItem.missing_inputs[0].reasonCategory,
    'DATA_SOURCE_NOT_CONNECTED',
  );

  const engineerReview = structuredClone(input);
  engineerReview.upstreamBinding.sourceBindings.find(
    (binding) =>
      binding.fieldPath === 'familyFields.workInstructionSteps.value[0]',
  ).structuredValue = {
    instructionText:
      'Perform the operational test in accordance with the approved procedure.',
  };
  const engineerItem = app003(buildPackage(engineerReview));
  assert.equal(engineerItem.status, '需补证据');
  assert.equal(
    engineerItem.missing_inputs[0].reasonCategory,
    'ENGINEER_DECISION_REQUIRED',
  );

  const notApplicable = structuredClone(input);
  notApplicable.upstreamBinding.sourceBindings =
    notApplicable.upstreamBinding.sourceBindings.filter(
      (binding) =>
        ![
          'coreFields.applicabilityRaw.value',
          'familyFields.workInstructionSteps.value[0]',
        ].includes(binding.fieldPath),
    );
  notApplicable.controlledContext = {
    work_scope: { object_level_unknown: false },
  };
  const notApplicableItem = app003(buildPackage(notApplicable));
  assert.equal(notApplicableItem.predicate_result, 'FALSE');
  assert.equal(notApplicableItem.status, '不适用');
  assert.equal(notApplicableItem.decision, '不适用');
  assert.notEqual(notApplicableItem.decision, '符合');
  assert.equal(
    notApplicableItem.method_execution.availability,
    'NOT_APPLICABLE',
  );
});

test('availability reasons keep method and lifecycle gaps distinct', async () => {
  const { classifyJobAidEvaluationAvailability } = await importBuilt(
    'modules/assessment-workbench/job-aid-runtime/evaluationAvailability.js',
  );
  assert.equal(
    classifyJobAidEvaluationAvailability({ dataSourceConnected: false }),
    'DATA_SOURCE_NOT_CONNECTED',
  );
  assert.equal(
    classifyJobAidEvaluationAvailability({ methodImplemented: false }),
    'METHOD_NOT_IMPLEMENTED',
  );
  assert.equal(
    classifyJobAidEvaluationAvailability({ engineerDecisionRequired: true }),
    'ENGINEER_DECISION_REQUIRED',
  );
  assert.equal(
    classifyJobAidEvaluationAvailability({ lifecycleReached: false }),
    'LIFECYCLE_NOT_REACHED',
  );
});

async function actualAssessment() {
  const [
    { buildSbJobAidAssessmentPackage },
    { buildJobAidCriterionSetVersion },
    { buildUnifiedSbJobAidAssessmentInput },
  ] = await Promise.all([
    importBuilt(
      'modules/assessment-workbench/job-aid-runtime/assessmentPackage.js',
    ),
    importBuilt('modules/assessment-workbench/job-aid-runtime/criterionSet.js'),
    importBuilt('modules/assessment-workbench/unified-assessment-input.js'),
  ]);
  const assetDirectory = resolve(
    root,
    'server/runtime-assets/assessment-host/real-sb/737-34-3830-original-issue',
  );
  const artifactBytes = new Uint8Array(
    readFileSync(resolve(assetDirectory, 'unified-package.frozen-2.json')),
  );
  const artifactRecord = JSON.parse(
    readFileSync(
      resolve(assetDirectory, 'artifact-record.frozen-2.json'),
      'utf8',
    ),
  );
  const input = buildUnifiedSbJobAidAssessmentInput({
    documentVersionBinding: documentVersionBinding(artifactRecord),
    artifactBytes,
    assessmentAsOf: '2026-08-26T00:00:00.000Z',
  });
  const rulePackBytes = readFileSync(
    resolve(
      root,
      'server/runtime-assets/assessment-host/job-aid/rule-pack-0.2.json',
    ),
  );
  const rulePack = JSON.parse(rulePackBytes.toString('utf8'));
  const rulePackHash = createHash('sha256').update(rulePackBytes).digest('hex');
  const criterionSet = buildJobAidCriterionSetVersion({
    rulePack,
    artifactRef: 'runtime-asset://assessment-host/job-aid/rule-pack-0.2.json',
    artifactDigest: `sha256:${rulePackHash}`,
    artifactVersion: '0.2',
    lifecycleStatus: 'ACTIVE',
  });
  const buildPackage = (assessmentInput) =>
    buildSbJobAidAssessmentPackage({
      input: assessmentInput,
      rulePack,
      rulePackHash,
      criterionSet,
      generatedAt: '2026-08-26T00:00:00.000Z',
    });
  return {
    input,
    buildPackage,
    assessmentPackage: buildPackage(input),
  };
}

function app003(assessmentPackage) {
  const item = assessmentPackage.evaluationItems.find(
    (candidate) => candidate.criterion_id === 'APP-003',
  );
  assert.ok(item);
  return item;
}

function documentVersionBinding(artifactRecord) {
  return {
    documentId: 'document_10085d27e5c05266403bb74c',
    documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
    artifactRecord,
    lifecycleStatus: 'FROZEN',
    selectionStatus: 'SELECTED',
    isCurrent: true,
    classification: {
      schemaVersion: 'wiselink.v3_1.document_classification_envelope.v1',
      classificationId: 'CLS-F87850CDDC741F2969280DB0',
      classificationHash:
        'sha256:f87850cddc741f2969280db07d775125315d0f1b61ae2beb7bb14584176a2663',
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      issuer: 'BOEING',
      subtype: 'service_bulletin',
      profileId: 'document-family-profile:issuer.boeing.service_bulletin@1.0.0',
      nativeParseProfileId: 'boeing.sb',
    },
  };
}
