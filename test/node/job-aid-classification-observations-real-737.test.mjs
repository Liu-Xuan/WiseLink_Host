import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root = process.cwd();
const importBuilt = (relativePath) =>
  import(pathToFileURL(resolve(root, 'dist/server', relativePath)));

test('CLS-005 reports three bounded negative observations only with complete actual coverage', async () => {
  const { assessmentPackage } = await actualAssessment();
  const item = criterion(assessmentPackage, 'CLS-005');

  assert.equal(item.predicate_result, 'TRUE');
  assert.equal(item.status, '需人工复核');
  assert.equal(item.decision, '需人工判断');
  assert.notEqual(item.decision, '符合');
  assert.deepEqual(item.extracted_facts.observedFlagIds, []);
  assert.deepEqual(
    item.extracted_facts.flags.map((flag) => flag.observationState),
    Array(3).fill('NOT_OBSERVED_WITH_COMPLETE_PRESERVED_TEXT'),
  );
  assert.equal(
    item.extracted_facts.flags.every(
      (flag) =>
        flag.sourceRefIds.length === 0 && flag.quoteExcerpts.length === 0,
    ),
    true,
  );
  assert.equal(item.extracted_facts.coverage.accountingComplete, true);
  assert.equal(item.extracted_facts.coverage.contentPreserved, true);
  assert.equal(item.extracted_facts.coverage.pageSourceRefCount, 22);
  assert.equal(item.extracted_facts.coverage.inspectionSourceRefIds.length, 22);
  assert.match(item.rationale, /受限负观察/u);
  assert.equal(
    item.method_execution.availability,
    'ENGINEER_DECISION_REQUIRED',
  );
  assert.deepEqual(Object.keys(item.method_execution.engineerPresentation), [
    'evaluationProblem',
    'lifecycle',
    'requiredEvidence',
    'sourceFacts',
    'specializedMethod',
    'authorityBoundary',
  ]);
  assert.equal(
    item.method_execution.engineerPresentation.sourceFacts[0]
      .negativeObservationAnchorOnly,
    true,
  );
  assert.equal(
    item.method_execution.engineerPresentation.authorityBoundary
      .createsCompanyExecutionDecision,
    false,
  );
});

test('CLS-006 extracts actual Boeing wording without making a company decision', async () => {
  const { assessmentPackage } = await actualAssessment();
  const item = criterion(assessmentPackage, 'CLS-006');

  assert.equal(item.predicate_result, 'TRUE');
  assert.equal(item.status, '需人工复核');
  assert.equal(item.decision, '需人工判断');
  assert.equal(item.extracted_facts.companyExecutionDecision, null);
  assert.equal(
    item.extracted_facts.normalizedObservation.noComplianceTimeGiven,
    true,
  );
  assert.equal(
    item.extracted_facts.normalizedObservation.boeingRecommendationObserved,
    true,
  );
  assert.equal(item.method_execution.sourceRefs.length, 2);
  assert.equal(
    item.method_execution.engineerPresentation.sourceFacts.every(
      (fact) => fact.sourceBounded && fact.sourceRefIds.length === 1,
    ),
    true,
  );
  assert.equal(
    item.method_execution.engineerPresentation.sourceFacts.every((fact) =>
      /No compliance time is given|Boeing recommends this service bulletin/iu.test(
        fact.value,
      ),
    ),
    true,
  );
  assert.equal(
    item.method_execution.engineerPresentation.sourceFacts.some((fact) =>
      /No compliance time is given/iu.test(fact.value),
    ),
    true,
  );
  assert.equal(
    item.method_execution.engineerPresentation.sourceFacts.some((fact) =>
      /Boeing recommends this service bulletin/iu.test(fact.value),
    ),
    true,
  );
  assert.equal(
    item.method_execution.engineerPresentation.authorityBoundary
      .createsCompanyExecutionDecision,
    false,
  );
  assert.match(item.rationale, /不是公司执行或不执行结论/u);
});

test('classification methods fail closed on missing coverage/source and predicate false', async () => {
  const { buildPackage, input } = await actualAssessment();

  const incompleteCoverage = structuredClone(input);
  incompleteCoverage.publicPackageObservation.sourceCoverage.contentPreserved = false;
  const cls005 = criterion(buildPackage(incompleteCoverage), 'CLS-005');
  assert.equal(cls005.status, '需补证据');
  assert.equal(
    cls005.missing_inputs[0].reasonCategory,
    'DATA_SOURCE_NOT_CONNECTED',
  );
  assert.equal(
    cls005.extracted_facts.observations[0].state,
    'COVERAGE_INCOMPLETE',
  );

  const noManufacturerStatement = structuredClone(input);
  noManufacturerStatement.publicPackageObservation.pageSourceRefs =
    noManufacturerStatement.publicPackageObservation.pageSourceRefs.filter(
      (sourceRef) => {
        const quote = sourceRef.quote;
        const exactStatement =
          /\bno compliance time is given\b|\bboeing recommends this service bulletin\b/iu.test(
            quote,
          );
        const complianceClassification =
          /\bcompliance\b/iu.test(quote) &&
          /\brecommended\b|\bdesirable\b|\boptional\b/iu.test(quote);
        return !exactStatement && !complianceClassification;
      },
    );
  const cls006 = criterion(buildPackage(noManufacturerStatement), 'CLS-006');
  assert.equal(cls006.status, '需补证据');
  assert.equal(
    cls006.missing_inputs[0].reasonCategory,
    'DATA_SOURCE_NOT_CONNECTED',
  );

  const notApplicable = structuredClone(input);
  notApplicable.controlledContext = { document: { type: 'FTD' } };
  for (const criterionId of ['CLS-005', 'CLS-006']) {
    const item = criterion(buildPackage(notApplicable), criterionId);
    assert.equal(item.predicate_result, 'FALSE');
    assert.equal(item.status, '不适用');
    assert.equal(item.decision, '不适用');
    assert.notEqual(item.decision, '符合');
    assert.equal(item.method_execution.availability, 'NOT_APPLICABLE');
  }
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

function criterion(assessmentPackage, criterionId) {
  const item = assessmentPackage.evaluationItems.find(
    (candidate) => candidate.criterion_id === criterionId,
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
