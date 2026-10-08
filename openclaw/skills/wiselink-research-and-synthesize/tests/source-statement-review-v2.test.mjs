import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { validateReviewTask } from '../scripts/validate-payload.mjs';
import { projectJobAidUpdateInput } from '../scripts/run-hosted-review-turn.mjs';
import { record, packet } from './fixtures/source-statement-v2-wire.fixture.mjs';

// The actual Review validator receives a complete synthetic sealed-context DTO.
// There are no model, platform, database or business calls in these regressions.
async function reviewFixture() {
  const v2 = record(0);
  const v1 = record(1);
  v1.sourceSchemaVersion = 'wiselink.document.activity-candidate.v1';
  v1.semanticFieldsAvailability = 'LEGACY_PARTIAL';
  v1.scopeBasis = 'LEGACY_RUN_SCOPE';
  v1.statement = {
    statementId: v1.reference.statementId, statementKey: 'legacy', label: v1.statement.label,
    quotes: v1.statement.quotes, time: null, statusRaw: 'TBD', limitations: v1.statement.limitations,
  };
  const receipt = packet([v2, v1]);
  const review = JSON.parse(await readFile(new URL('./fixtures/review-turn-task.c2.json', import.meta.url), 'utf8'));
  review.schemaVersion = 'wiselink.3_1.review_turn_task.v1.c5';
  review.selectedEvaluationItemId = null;
  review.allowedEvaluationItemIds = [];
  review.allowedAdoptedInputRefs = [];
  review.context.purpose = 'UPDATE_ASSESSMENT';
  const artifactRef = 'artifact://synthetic-review-v2';
  const artifactSha256 = 'a'.repeat(64);
  const sourceCatalog = receipt.evidence.map(item => item.kind === 'DOCUMENT_PASSAGE'
    ? { ...item, workItemId: review.context.workItem.workItemId,
      documentVersionId: v2.sourceBinding.original.documentVersionId,
      sourceRefId: item.evidenceRef.split(':').at(-1) }
    : { ...item, resultRef: item.sourceStatement.reference.runRef,
      resultRevision: item.sourceStatement.reference.candidateRevision });
  const modelInput = {
    schemaVersion: 'wiselink.jobaid-problem-task.v2', purpose: 'PROBLEM_REVIEW',
    evidenceProjectionVersion: 'SOURCE_CONTEXT_V2',
    sourceStatements: receipt.sourceStatements, activityContexts: receipt.activityContexts,
    availableSources: receipt.evidence.map(item => ({ ref: item.evidenceRef, kind: item.kind,
      title: item.title, versionLabel: item.versionLabel, locator: item.locator })),
    deliveredEvidence: receipt.evidence, previousWork: { content: { issues: [] } },
  };
  review.context.problemAssessment = modelInput;
  review.jobAidContext = {
    schemaVersion: 'wiselink.jobaid-problem-task.v2', sourceCatalog,
    sourceBindings: [{ workItemId: review.context.workItem.workItemId, artifactRef, artifactSha256 }],
    initiallyDeliveredRefs: receipt.sourceRefs,
    sourceActivityProjections: [{ records: receipt.sourceStatements, activityContexts: receipt.activityContexts }],
    modelInput, previousWork: { content: { issues: [] } },
  };
  review.resourceRefs = receipt.evidence.filter(item => item.kind === 'DOCUMENT_PASSAGE').map(item => ({
    sourceRefId: item.evidenceRef, resourceArtifactRef: artifactRef, resourceArtifactSha256: artifactSha256,
    value: { ...item, sourceRefId: item.evidenceRef },
  }));
  review.executionPolicy.toolPolicyRef = 'wiselink-openclaw-engineering-assessment@1.2.0#interactive-jobaid-review-c5';
  return JSON.parse(JSON.stringify(review));
}

function alterRecord(review, index, mutation) {
  mutation(review.jobAidContext.sourceActivityProjections[0].records[index]);
  review.jobAidContext.modelInput.sourceStatements = structuredClone(review.jobAidContext.sourceActivityProjections[0].records);
  review.context.problemAssessment = structuredClone(review.jobAidContext.modelInput);
}

test('actual Review accepts JSON-restored mixed v1/v2 records with their exact distinct scope bases', async () => {
  const review = await reviewFixture();
  const before = JSON.stringify(review);
  assert.doesNotThrow(() => validateReviewTask(review));
  const projected = projectJobAidUpdateInput({ context: review.context }).context.problemAssessment;
  assert.deepEqual(projected.sourceStatements, review.jobAidContext.modelInput.sourceStatements);
  assert.equal(projected.sourceStatements[0].scopeBasis, 'ACTUAL_DELIVERED_RUN_SCOPE');
  assert.equal(projected.sourceStatements[1].scopeBasis, 'LEGACY_RUN_SCOPE');
  assert.equal(projected.sourceStatements[0].statement.times.length, 3);
  assert.equal(projected.sourceStatements[0].statement.status.meaning, 'SOURCE_REPORTED_COMPLETED');
  assert.equal(JSON.stringify(review), before);
});

for (const [index, wrongBasis] of [[0, 'LEGACY_RUN_SCOPE'], [1, 'ACTUAL_DELIVERED_RUN_SCOPE']]) {
  test(`actual Review rejects record ${index} with ${wrongBasis}`, async () => {
    const review = await reviewFixture();
    alterRecord(review, index, item => { item.scopeBasis = wrongBasis; });
    assert.throws(() => validateReviewTask(review), /ASSESSMENT_SOURCE_STATEMENT_RECORD_INVALID/);
  });
}

test('actual Review rejects a carrier whose prior-result revision differs from its exact source reference', async () => {
  const review = await reviewFixture();
  const carrier = review.jobAidContext.sourceCatalog.find(item => item.kind === 'PRIOR_RESULT');
  carrier.resultRevision++;
  assert.throws(() => validateReviewTask(review), /REVIEW_SOURCE_STATEMENT_BINDING_INVALID/);
});

test('actual Review rejects missing necessary root delivery and record/context drift', async () => {
  const rootMissing = await reviewFixture();
  rootMissing.jobAidContext.initiallyDeliveredRefs.pop();
  assert.throws(() => validateReviewTask(rootMissing), /REVIEW_SOURCE_STATEMENT_NOT_DELIVERED/);
  const contextDrift = await reviewFixture();
  contextDrift.jobAidContext.sourceActivityProjections[0].activityContexts[0].sourceContext.sourceBinding.semanticRevision++;
  assert.throws(() => validateReviewTask(contextDrift), /REVIEW_SOURCE_STATEMENT_CONTEXT_DRIFT/);
});
