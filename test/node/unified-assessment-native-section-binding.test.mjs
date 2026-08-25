import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root = process.cwd();
const importBuilt = (relativePath) =>
  import(pathToFileURL(resolve(root, 'dist/server', relativePath)));

test('passes parser-native sections into the real Job-Aid model packet', async () => {
  const [
    { buildControlledAilyHolisticDynamicInput },
    { buildBaseOneShotAssessmentPacket },
    { buildEvaluationContextPackage },
    { buildSbJobAidAssessmentPackage },
    { buildJobAidCriterionSetVersion },
    { buildUnifiedSbJobAidAssessmentInput },
    { buildUnifiedAssessmentSnapshot },
  ] = await Promise.all([
    importBuilt('modules/assessment-workbench/aily-holistic-assessment.js'),
    importBuilt('modules/assessment-workbench/base-one-shot-assessment.processor.js'),
    importBuilt('modules/assessment-workbench/evaluation-context.service.js'),
    importBuilt('modules/assessment-workbench/job-aid-runtime/assessmentPackage.js'),
    importBuilt('modules/assessment-workbench/job-aid-runtime/criterionSet.js'),
    importBuilt('modules/assessment-workbench/unified-assessment-input.js'),
    importBuilt('modules/assessment-workbench/unified-assessment-snapshot.js'),
  ]);
  const assetDirectory = resolve(
    root,
    'server/runtime-assets/assessment-host/real-sb/737-34-3830-original-issue',
  );
  const artifactBytes = new Uint8Array(readFileSync(resolve(
    assetDirectory,
    'unified-package.frozen-2.json',
  )));
  const artifactRecord = JSON.parse(readFileSync(resolve(
    assetDirectory,
    'artifact-record.frozen-2.json',
  ), 'utf8'));
  const input = buildUnifiedSbJobAidAssessmentInput({
    documentVersionBinding: binding(artifactRecord),
    artifactBytes,
    assessmentAsOf: '2026-08-24T00:00:00.000Z',
  });

  assert.equal(
    input.structuredAssessmentContext.applicability.availability,
    'AVAILABLE_CANDIDATE',
  );
  assert.equal(
    input.structuredAssessmentContext.concurrentRequirements.availability,
    'AVAILABLE_CANDIDATE',
  );
  assert.equal(
    input.structuredAssessmentContext.workInstructions.availability,
    'AVAILABLE_CANDIDATE',
  );
  assert.deepEqual(
    input.structuredAssessmentContext.workInstructions.stepIds,
    ['WP3.1'],
  );
  assert.equal(
    input.structuredAssessmentContext.authorityBoundary
      .documentApplicabilityProvesFleetApplicability,
    false,
  );
  assert.match(
    input.structuredAssessmentContext.applicability.rawText,
    /737-8, 737-8200 without Extended Range Twin Engine Operations/u,
  );
  assert.match(
    input.structuredAssessmentContext.concurrentRequirements.entries[0]
      .rawText,
    /Onboard Network System \(ONS\) Operating System \(OS\) 9\.1/u,
  );
  assert.match(
    input.structuredAssessmentContext.workInstructions.steps[0]
      .instructionText,
    /Replace the Flight Management Computers/u,
  );
  assert.equal(
    input.structuredAssessmentContext.applicability.source.sourceRefs[0]
      .locator.pageStart,
    6,
  );
  assert.equal(
    input.structuredAssessmentContext.concurrentRequirements.entries[0]
      .source.sourceRefs[0].locator.pageStart,
    13,
  );
  assert.deepEqual(
    input.structuredAssessmentContext.workInstructions.steps[0]
      .source.sourceRefs.map((ref) => ref.locator.pageStart),
    [20],
  );

  const rulePackBytes = readFileSync(resolve(
    root,
    'server/runtime-assets/assessment-host/job-aid/rule-pack-0.2.json',
  ));
  const rulePack = JSON.parse(rulePackBytes.toString('utf8'));
  const rulePackHash = createHash('sha256').update(rulePackBytes).digest('hex');
  const criterionSet = buildJobAidCriterionSetVersion({
    rulePack,
    artifactRef: 'runtime-asset://assessment-host/job-aid/rule-pack-0.2.json',
    artifactDigest: `sha256:${rulePackHash}`,
    artifactVersion: '0.2',
    lifecycleStatus: 'ACTIVE',
  });
  const assessmentPackage = buildSbJobAidAssessmentPackage({
    input,
    rulePack,
    rulePackHash,
    criterionSet,
    generatedAt: '2026-08-24T00:00:00.000Z',
  });
  const snapshot = buildUnifiedAssessmentSnapshot(assessmentPackage);

  assert.deepEqual(
    snapshot.structuredAssessmentContext.workInstructions.stepIds,
    ['WP3.1'],
  );
  assert.equal(
    sourceCandidate(snapshot, 'APP-001').fieldPath,
    'coreFields.applicabilityRaw.value',
  );
  assert.equal(
    sourceCandidate(snapshot, 'IMP-001').fieldPath,
    'familyFields.workInstructionSteps.value[0]',
  );
  assert.equal(
    sourceCandidate(snapshot, 'IMP-005').fieldPath,
    'familyFields.groupSpecificConcurrentRequirements.value[0]',
  );
  assert.deepEqual(
    snapshot.items
      .filter((item) => item.analysis.sourceEvidenceCandidates.length > 0)
      .map((item) => item.criterionId)
      .sort(),
    ['APP-001', 'APP-002', 'CLS-001', 'GOV-003', 'IMP-001', 'IMP-005'],
  );

  const context = buildEvaluationContextPackage(snapshot);
  const dynamicInput = buildControlledAilyHolisticDynamicInput(context);
  const packet = buildBaseOneShotAssessmentPacket(input, dynamicInput, {
    transportId: 'TRANSPORT-REAL-SB-NATIVE-SECTIONS',
    workItemId: 'WI-REAL-SB-NATIVE-SECTIONS',
    actionAttemptId: 'ATT-REAL-SB-NATIVE-SECTIONS',
    expectedRevision: 1,
    documentVersionId: input.documentIdentity.revisionId,
  });
  const packetContext = packet.jobAidContext.structuredAssessmentContext;
  assert.equal(packet.responseInstruction.ruleResultsEncoding.maxRowUtf8Bytes, 400);
  assert.match(packetContext.applicability.rawText, /737-8/u);
  assert.match(
    packetContext.concurrentRequirements.entries[0].rawText,
    /ONS/u,
  );
  assert.match(
    packetContext.workInstructions.steps[0].instructionText,
    /Flight Management Computer System - Operational Test/u,
  );
  assert.doesNotMatch(
    packetContext.workInstructions.steps[0].instructionText,
    /Export Controlled ECCN:/u,
  );
  const packetBytes = Buffer.byteLength(JSON.stringify(packet), 'utf8');
  assert.ok(packetBytes <= 45_000, `model packet too large: ${packetBytes}`);
});

function binding(artifactRecord) {
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
      profileId:
        'document-family-profile:issuer.boeing.service_bulletin@1.0.0',
      nativeParseProfileId: 'boeing.sb',
    },
  };
}

function sourceCandidate(snapshot, criterionId) {
  const item = snapshot.items.find((candidate) =>
    candidate.criterionId === criterionId);
  assert.ok(item);
  assert.equal(item.analysis.sourceEvidenceCandidates.length, 1);
  return item.analysis.sourceEvidenceCandidates[0];
}
