import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePayload } from '../scripts/validate-payload.mjs';
import { record, packet } from './fixtures/source-statement-v2-wire.fixture.mjs';
import { invokeHostedInitialModel } from '../scripts/invoke-hosted-initial-model.mjs';
import { SOURCE_CONTENT_SYNTHESIS_GUIDANCE } from '../scripts/jobaid-problem-guidance.mjs';

// Synthetic synthesis DTO mirrors the actual Host producer; no external calls.
const time = '2026-08-31T23:30:00-08:00';
const common = { title: 'Saved source context', versionLabel: null, excerpt: 'A condition remains unknown.', locator: null };
function sourceRows() {
  return [
    { ...common, evidenceRef: 'query', kind: 'QUERY_RECEIPT',
      queryProvenance: { origin: 'AILY_RETRIEVAL', queryText: 'controlled scope', status: 'COMPLETED', originalDocumentsVerified: false },
      sourceContext: { receiptRef: 'receipt-1', checkedScope: 'selected material', queriedAt: time, coverage: 'PARTIAL' } },
    { ...common, evidenceRef: 'conversation', kind: 'ENGINEER_STATEMENT', sourceContext: { origin: 'REVIEW_CONVERSATION', recordedAt: time } },
    { ...common, evidenceRef: 'ledger', kind: 'ENGINEER_STATEMENT', sourceContext: { origin: 'ENGINEER_REVIEW_LEDGER', recordedAt: time, reviewRevision: 3, sequence: 2 } },
    { ...common, evidenceRef: 'host', kind: 'HOST_FACT', sourceContext: { factRef: 'fact-1', workItemRevision: 7, recordedAt: time } },
    { ...common, evidenceRef: 'prior', kind: 'PRIOR_RESULT', originalEvidenceRefs: ['source-1'],
      sourceWork: { subjectKind: 'ENGINEERING_MATTER', subjectId: 'matter-1', workRef: 'work-1', issueKey: 'issue-1' },
      sourceContext: { resultRef: 'result-1', resultRevision: 4 } },
  ];
}
function input(version = 'SOURCE_CONTEXT_V1') {
  return { ...synthesisInput(), evidenceProjectionVersion: version, evidenceRegistry: sourceRows() };
}
const validate = value => validatePayload('synthesis-input', value);

test('actual Overall request carries shared synthesis rules and every exact source carrier unchanged', async () => {
  const value = input();
  const original = structuredClone(value);
  let requests = 0;
  await assert.rejects(invokeHostedInitialModel({ operation: 'SYNTHESIZE_OVERALL', modelInput: value }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://fixture.invalid', gatewayToken: 'fixture-only',
    configuredModelVersion: 'fixture-model', sessionDiscriminator: 'overall-content-once',
  }, { requestGateway: async (_url, request) => {
    requests++;
    const body = JSON.parse(request.body);
    assert.ok(body.messages[0].content.includes(SOURCE_CONTENT_SYNTHESIS_GUIDANCE));
    assert.deepEqual(JSON.parse(body.messages[1].content), original);
    throw new Error('FIXTURE_CAPTURED_OVERALL_REQUEST');
  } }), /FIXTURE_CAPTURED_OVERALL_REQUEST/u);
  assert.equal(requests, 1);
  assert.deepEqual(value, original);
});

test('actual synthesis consumer accepts Host-shaped V1 after JSON recovery without fabricating dates', () => {
  const value = JSON.parse(JSON.stringify(input()));
  const before = JSON.stringify(value);
  assert.doesNotThrow(() => validate(value));
  assert.equal(value.evidenceRegistry[0].sourceContext.queriedAt, time);
  assert.equal(value.evidenceRegistry[0].queryProvenance.originalDocumentsVerified, false);
  assert.equal(JSON.stringify(value), before);
});

test('legacy synthesis and its unversioned registry retain their original shape', () => {
  const value = synthesisInput(); assert.doesNotThrow(() => validate(value));
  value.evidenceRegistry = sourceRows().map(({ sourceContext, ...row }) => row);
  const before = JSON.stringify(value); assert.doesNotThrow(() => validate(value));
  assert.equal(JSON.stringify(value), before);
});

test('unknown projection and explicit projection without registry reject instead of fallback', () => {
  const unknown = input('SOURCE_CONTEXT_V3'); assert.throws(() => validate(unknown), /PROJECTION_VERSION_INVALID/);
  const missing = input(); delete missing.evidenceRegistry;
  assert.throws(() => validate(missing), /REGISTRY_REQUIRED/);
  const noContext = input(); delete noContext.evidenceRegistry[0].sourceContext;
  assert.throws(() => validate(noContext));
});

for (const [name, mutate] of [
  ['nonexistent local date', value => { value.evidenceRegistry[0].sourceContext.queriedAt = '2026-02-30T12:00:00Z'; }],
  ['invalid time syntax', value => { value.evidenceRegistry[1].sourceContext.recordedAt = '2026-08-31'; }],
  ['zero revision', value => { value.evidenceRegistry[2].sourceContext.reviewRevision = 0; }],
  ['invalid coverage', value => { value.evidenceRegistry[0].sourceContext.coverage = 'ALL'; }],
  ['forged authority', value => { value.evidenceRegistry[0].sourceContext.authority = 'VERIFIED'; }],
  ['forged query verification', value => { value.evidenceRegistry[0].queryProvenance.originalDocumentsVerified = true; }],
  ['forged source-work kind', value => { value.evidenceRegistry[4].sourceWork.subjectKind = 'DOCUMENT'; }],
  ['duplicate inherited roots', value => { value.evidenceRegistry[4].originalEvidenceRefs.push('source-1'); }],
]) test(`actual consumer rejects ${name}`, () => { const value = input(); mutate(value); assert.throws(() => validate(value)); });

test('S1 V2 requires only prior-result context and preserves exact source-statement binding', () => {
  const value = input('SOURCE_CONTEXT_V2');
  value.evidenceRegistry = [...sourceRows().slice(0, 4).map(({ sourceContext, ...row }) => row), ...packet([record(0)]).evidence];
  const before = JSON.stringify(value); assert.doesNotThrow(() => validate(value)); assert.equal(JSON.stringify(value), before);
  const wider = structuredClone(value); wider.evidenceRegistry[0].sourceContext = sourceRows()[0].sourceContext;
  assert.throws(() => validate(wider));
  for (const key of ['resultRef', 'resultRevision']) {
    const drift = structuredClone(value); const carrier = drift.evidenceRegistry.find(row => row.sourceStatement);
    carrier.sourceContext[key] = key === 'resultRef' ? 'other-result' : 8;
    assert.throws(() => validate(drift), /SOURCE_STATEMENT_INVALID/);
  }
  const forged = structuredClone(value); forged.evidenceRegistry.find(row => row.sourceStatement).evidenceRef = 'forged';
  assert.throws(() => validate(forged), /SOURCE_STATEMENT_INVALID/);
});

function synthesisInput() {
  const sourceRefId = `urn:techpub:source-ref:v1:sha256:${'c'.repeat(64)}`;
  const packageId = `urn:techpub:package:v1:sha256:${'d'.repeat(64)}`;
  return {
    operation: 'SYNTHESIZE_OVERALL_CANDIDATE',
    outputCorrelationRef: 'REQ-OVERALL-001',
    applicabilityResult: null,
    baseRuleResult: {
      sourceResultId: 'openclaw-dynamic://REQ-DYNAMIC',
      revision: 1,
      artifactSha256: `sha256:${'e'.repeat(64)}`,
      documentVersionId: 'DV-fixture-001',
      packageId,
      packageArtifactSha256: `sha256:${'f'.repeat(64)}`,
      criterionSetId: 'criterion-set-fixture',
      criterionCount: 1,
      evaluationItemCount: 1,
      unresolvedCount: 1,
      sourceBoundCandidateCount: 1,
      items: [
        {
          criterionId: 'criterion-001',
          status: 'UNKNOWN/WAITING_INPUT',
          sourceRefIds: [sourceRefId],
          fact: null,
          analysis: 'Controlled dynamic candidate.',
          candidateConclusion: 'UNKNOWN/WAITING_INPUT',
          missingInputs: ['Controlled FleetFacts'],
          humanReviewRequired: true,
          authorityLevel: 'candidate_only',
        },
      ],
    },
    unifiedSourceContext: {
      documentVersionId: 'DV-fixture-001',
      packageId,
      packageArtifactSha256: `sha256:${'f'.repeat(64)}`,
      contractRevision: 'frozen.2',
      contentUnitCount: 1,
      sourceRefCount: 1,
      currentDocumentSourceRefIds: [sourceRefId],
      sourceRefs: [
        {
          sourceRefId,
          locator: 'page 1',
          excerpt: null,
        },
      ],
    },
    adoptedDocumentVersions: [
      {
        documentVersionId: 'DV-fixture-001',
        publisher: 'BOEING',
        documentNumber: 'DOC-fixture',
        revisionLabel: 'REV-fixture',
        adoptionStatus: 'ADOPTED',
        currentness: 'CURRENT',
      },
    ],
    engineerReviewContext: {
      revision: null,
      artifactSha256: null,
      reviewCount: 0,
      history: [],
      effective: [],
    },
    externalDiscoveryResults: [],
    selectiveResynthesis: {
      mode: 'INITIAL',
      criterionSetId: 'criterion-set-fixture',
      baseRuleRevision: 1,
      baseRuleArtifactSha256: `sha256:${'e'.repeat(64)}`,
      staleOverallRevision: null,
      targetOverallRevision: 1,
      priorEngineerReviewRevision: null,
      currentEngineerReviewRevision: null,
      affectedCriterionIds: [],
      reusedCriterionIds: [],
      adoptedEvidenceSourceRefIds: [],
    },
  };
}
