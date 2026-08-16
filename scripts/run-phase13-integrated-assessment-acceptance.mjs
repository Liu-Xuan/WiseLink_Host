#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { CanonicalHostIntegratedAssessmentService } from '../dist/server/modules/canonical-host/canonical-host-integrated-assessment.service.js';
import { consumeBaseOneShotAssessmentResult } from '../dist/server/modules/assessment-workbench/base-one-shot-assessment.processor.js';

async function main() {
  const [baseResultPath, overallResultPath, receiptPath] =
    process.argv.slice(2);
  if (!baseResultPath || !overallResultPath) {
    throw new Error(
      'usage: run-phase13-integrated-assessment-acceptance.mjs ' +
        '<base-results.json> <openclaw-results.json> [receipt.json]',
    );
  }

  const baseInput = readResults(baseResultPath, 'BASE', [1, 2]);
  const overallInput = readResults(overallResultPath, 'OPENCLAW', [2]);
  const baseResults = baseInput.values.map((value, index) =>
    readBaseResult(value, index),
  );
  const overallResults = overallInput.values.map((value, index) =>
    readOverallResult(value, index),
  );

  assertSameIdentity(baseResults, overallResults);
  if (baseResults[1]) {
    assert.notEqual(
      baseResults[0].sourceResultId,
      baseResults[1].sourceResultId,
      'PHASE13_BASE_CHANGE_SOURCE_RESULT_REQUIRED',
    );
    assert.notEqual(
      sha256(baseResults[0].artifactBytes),
      sha256(baseResults[1].artifactBytes),
      'PHASE13_BASE_CHANGE_ACTUAL_BYTES_REQUIRED',
    );
  }
  assert.notEqual(
    overallResults[0].sourceResultId,
    overallResults[1].sourceResultId,
    'PHASE13_OPENCLAW_A_B_SOURCE_RESULT_REQUIRED',
  );
  assertNoDiscovery(overallResults[0]);
  assertRealOemStatuses(overallResults[1]);

  const registrar = new MemoryRegistrar(workItem(baseResults[0]));
  const artifactStore = new MemoryArtifactStore();
  const repository = new MemoryActionAttemptRepository();
  const baseProvider = new ExternalResultProvider(baseResults);
  const overallProvider = new ExternalOverallProvider(overallResults);
  const service = new CanonicalHostIntegratedAssessmentService(
    registrar,
    authorization(),
    permissionSnapshots(),
    baseProvider,
    overallProvider,
    artifactStore,
    repository,
  );
  const actor = {
    userId: 'phase13-local-acceptance-runner',
    tenantId: 'phase13-local-acceptance',
    appId: 'app_17bzc551rsg',
    roles: ['authenticated'],
    env: 'local-acceptance',
  };

  const initialBase = await service.persistBaseRuleCandidate(
    baseResults[0].workItemId,
    actor,
  );
  const overallA = await service.persistOpenClawOverall(
    baseResults[0].workItemId,
    actor,
  );
  const overallB = await service.persistOpenClawOverall(
    baseResults[0].workItemId,
    actor,
  );
  const changedBase = baseResults[1]
    ? await service.persistBaseRuleCandidate(baseResults[0].workItemId, actor)
    : null;

  const initialBaseProjection = required(
    initialBase.integratedAssessment?.baseRules,
  );
  const overallAProjection = required(
    overallA.integratedAssessment?.overallSynthesis,
  );
  const overallBProjection = required(
    overallB.integratedAssessment?.overallSynthesis,
  );
  const changedBaseProjection = changedBase
    ? required(changedBase.integratedAssessment?.baseRules)
    : null;
  const staleOverallProjection = changedBase
    ? required(changedBase.integratedAssessment?.overallSynthesis)
    : null;

  assert.equal(initialBaseProjection.revision, 1);
  assert.equal(overallAProjection.revision, 1);
  assert.equal(overallBProjection.revision, 2);
  assert.equal(overallB.integratedAssessment?.baseRules.revision, 1);
  assert.equal(
    overallB.integratedAssessment?.baseRules.artifact.sha256,
    initialBaseProjection.artifact.sha256,
  );
  assert.equal(overallAProjection.basedOnBaseRuleRevision, 1);
  assert.equal(overallBProjection.basedOnBaseRuleRevision, 1);
  assert.equal(
    overallAProjection.basedOnBaseRuleArtifactSha256,
    initialBaseProjection.artifact.sha256,
  );
  assert.equal(
    overallBProjection.basedOnBaseRuleArtifactSha256,
    initialBaseProjection.artifact.sha256,
  );
  if (changedBaseProjection && staleOverallProjection) {
    assert.equal(changedBaseProjection.revision, 2);
    assert.equal(staleOverallProjection.status, 'STALE');
    assert.equal(staleOverallProjection.revision, 2);
    assert.equal(
      staleOverallProjection.staleReason,
      'BASE_RULE_RESULT_CHANGED',
    );
    assert.equal(
      staleOverallProjection.artifact.sha256,
      overallBProjection.artifact.sha256,
    );
  }
  assert.equal(repository.completed.length, baseResults.length + 2);
  assert.equal(repository.failed.length, 0);
  assert.equal(artifactStore.writes.length, baseResults.length + 2);

  const expectedArtifacts = [
    baseResults[0].artifactBytes,
    overallResults[0].artifactBytes,
    overallResults[1].artifactBytes,
    ...(baseResults[1] ? [baseResults[1].artifactBytes] : []),
  ];
  for (const [index, write] of artifactStore.writes.entries()) {
    assert.deepEqual(
      write.bytes,
      expectedArtifacts[index],
      `PHASE13_ACTUAL_BYTE_READBACK_MISMATCH:${index}`,
    );
    const readback = await artifactStore.readActualBytes(write.artifact);
    assert.deepEqual(
      readback,
      expectedArtifacts[index],
      `PHASE13_SECOND_ACTUAL_BYTE_READBACK_MISMATCH:${index}`,
    );
  }

  const receipt = {
    status: 'PHASE13_EXTERNAL_OUTPUT_SAME_WORKITEM_ACCEPTANCE_PASS',
    evidenceClass: 'EXTERNAL_FILES_VALIDATED_ORIGIN_NOT_ATTESTED_BY_RUNNER',
    onlineMutationPerformed: false,
    inputFiles: {
      base: fileSummary(baseInput),
      openClaw: fileSummary(overallInput),
    },
    identity: {
      workItemId: baseResults[0].workItemId,
      documentVersionId: baseResults[0].documentVersionId,
      packageId: baseResults[0].packageId,
      packageArtifactSha256: baseResults[0].packageArtifactSha256,
    },
    base: {
      initial: projectionSummary(initialBaseProjection),
      changed: changedBaseProjection
        ? projectionSummary(changedBaseProjection)
        : null,
      oldOverallAfterChange: staleOverallProjection
        ? {
            revision: staleOverallProjection.revision,
            status: staleOverallProjection.status,
            staleReason: staleOverallProjection.staleReason,
            artifactSha256: staleOverallProjection.artifact.sha256,
          }
        : null,
      baseChangeStaleReplay: changedBaseProjection
        ? 'PASS'
        : 'NOT_RUN_EXISTING_UNIT_PROOF_ONLY',
    },
    openClaw: {
      noDiscovery: overallSummary(overallAProjection),
      realOemStatuses: overallSummary(overallBProjection),
      baseRevisionUnchangedAcrossAAndB: true,
    },
    actualByteReadback: {
      persistedArtifactCount: artifactStore.writes.length,
      verifiedArtifactCount: expectedArtifacts.length,
      allExact: true,
    },
    attempts: {
      reserved: repository.reserved.length,
      completed: repository.completed.length,
      failed: repository.failed.length,
    },
    boundaries: {
      authorityLevel: 'candidate_only',
      externalDiscoveryIsEvidence: false,
      engineeringConclusionProduced: false,
      queueOrWorkerCreated: false,
      secondLedgerCreated: false,
    },
  };

  const serializedReceipt = JSON.stringify(receipt, null, 2) + '\n';
  if (receiptPath) writeFileSync(receiptPath, serializedReceipt, 'utf8');
  process.stdout.write(serializedReceipt);
}

function readResults(path, label, allowedCounts) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new Error(`${label}_ACTUAL_OUTPUT_FILE_READ_FAILED:${error.message}`);
  }
  let values;
  try {
    values = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label}_ACTUAL_OUTPUT_FILE_JSON_INVALID`);
  }
  if (!Array.isArray(values) || !allowedCounts.includes(values.length)) {
    throw new Error(
      `${label}_ACTUAL_OUTPUT_RESULT_COUNT_INVALID:` +
        `${Array.isArray(values) ? values.length : 'NOT_ARRAY'}:` +
        allowedCounts.join(','),
    );
  }
  return { bytes: Uint8Array.from(bytes), values };
}

function readBaseResult(value, index) {
  const result = object(value, `BASE_RESULT_${index}`);
  const artifactBytes = actualBytes(
    result.artifactBytes,
    `BASE_RESULT_${index}`,
  );
  const packet = object(result.packet, `BASE_RESULT_${index}_PACKET`);
  const output = Buffer.from(artifactBytes).toString('utf8');
  const consumed = consumeBaseOneShotAssessmentResult(packet, output);
  const criterionCount = positiveInteger(
    result.criterionCount,
    'criterionCount',
  );
  assert.equal(result.evaluationItemCount, criterionCount);
  assert.equal(consumed.criterionCount, criterionCount);
  assert.equal(consumed.ruleResults.length, criterionCount);
  assert.equal(consumed.authorityLevel, 'candidate_only');
  assert.equal(consumed.engineeringConclusion, null);
  assert.equal(consumed.correlation.workItemId, result.workItemId);
  assert.equal(
    consumed.correlation.documentVersionId,
    result.documentVersionId,
  );
  assert.equal(packet.expectedSelfCheck?.criterionSetId, result.criterionSetId);
  return {
    sourceResultId: nonempty(result.sourceResultId, 'sourceResultId'),
    workItemId: nonempty(result.workItemId, 'workItemId'),
    documentVersionId: nonempty(result.documentVersionId, 'documentVersionId'),
    packageId: nonempty(result.packageId, 'packageId'),
    packageArtifactSha256: digest(result.packageArtifactSha256),
    criterionSetId: nonempty(result.criterionSetId, 'criterionSetId'),
    criterionCount,
    evaluationItemCount: criterionCount,
    unresolvedCount: count(result.unresolvedCount, criterionCount),
    sourceBoundCandidateCount: count(
      result.sourceBoundCandidateCount,
      criterionCount,
    ),
    artifactBytes,
    normalizedRuleResultCount: consumed.ruleResults.length,
  };
}

function readOverallResult(value, index) {
  const result = object(value, `OPENCLAW_RESULT_${index}`);
  const artifactBytes = actualBytes(
    result.artifactBytes,
    `OPENCLAW_RESULT_${index}`,
  );
  parsedArtifact(artifactBytes, `OPENCLAW_RESULT_${index}`);
  assert.equal(result.authorityLevel, 'candidate_only');
  assert.equal(result.externalDiscoveryIsEvidence, false);
  return {
    sourceResultId: nonempty(result.sourceResultId, 'sourceResultId'),
    workItemId: nonempty(result.workItemId, 'workItemId'),
    documentVersionId: nonempty(result.documentVersionId, 'documentVersionId'),
    packageId: nonempty(result.packageId, 'packageId'),
    baseRuleRevision: positiveInteger(
      result.baseRuleRevision,
      'baseRuleRevision',
    ),
    baseRuleArtifactSha256: digest(result.baseRuleArtifactSha256),
    discoveryStatus: nonempty(result.discoveryStatus, 'discoveryStatus'),
    gap:
      result.gap === null ? null : nonempty(result.gap, 'openClawResult.gap'),
    candidateRefCount: count(result.candidateRefCount),
    findingCount: count(result.findingCount),
    unresolvedCount: count(result.unresolvedCount),
    authorityLevel: 'candidate_only',
    externalDiscoveryIsEvidence: false,
    artifactBytes,
  };
}

function assertSameIdentity(baseResults, overallResults) {
  const expected = baseResults[0];
  for (const result of [...baseResults.slice(1), ...overallResults]) {
    assert.equal(result.workItemId, expected.workItemId);
    assert.equal(result.documentVersionId, expected.documentVersionId);
    assert.equal(result.packageId, expected.packageId);
    if ('packageArtifactSha256' in result) {
      assert.equal(
        result.packageArtifactSha256,
        expected.packageArtifactSha256,
      );
    }
  }
  const initialBaseSha = sha256(expected.artifactBytes);
  for (const result of overallResults) {
    assert.equal(result.baseRuleRevision, 1);
    assert.equal(result.baseRuleArtifactSha256, initialBaseSha);
  }
}

function assertNoDiscovery(result) {
  assert.equal(result.discoveryStatus, 'NO_DISCOVERY');
  assert.equal(result.candidateRefCount, 0);
  const artifact = parsedArtifact(
    result.artifactBytes,
    'OPENCLAW_NO_DISCOVERY',
  );
  assert.equal(artifact.adopted, false);
  assert.equal(artifact.usableAsEvidence, false);
}

function assertRealOemStatuses(result) {
  assert.notEqual(result.discoveryStatus, 'NO_DISCOVERY');
  const artifact = parsedArtifact(result.artifactBytes, 'OPENCLAW_REAL_OEM');
  assert.equal(artifact.adopted, false);
  assert.equal(artifact.usableAsEvidence, false);
  const providers = object(artifact.providers, 'OPENCLAW_REAL_OEM_PROVIDERS');
  const airbus = object(providers.airbus, 'OPENCLAW_REAL_OEM_AIRBUS');
  const boeing = object(providers.boeing, 'OPENCLAW_REAL_OEM_BOEING');
  const comac = object(providers.comac, 'OPENCLAW_REAL_OEM_COMAC');
  assert.equal(airbus.status, 'COMPLETE');
  assert.equal(airbus.match, 'DIRECT_OFFICIAL_SOURCE_MATCH');
  assert.equal(boeing.status, 'ACCESS_DENIED');
  assert.equal(boeing.accessRestricted, true);
  assert.equal(boeing.candidateCount, 0);
  assert.equal(boeing.error ?? boeing.failureCode, 'UPSTREAM_CONNECT_TIMEOUT');
  assert.ok(['PARTIAL_RESULTS', 'TRUNCATED'].includes(comac.status));
  assert.notEqual(comac.source, 'BAIDU');
  if ('baiduAcceptedAsOfficial' in comac) {
    assert.equal(comac.baiduAcceptedAsOfficial, false);
  }
}

class ExternalResultProvider {
  configured = true;
  index = 0;

  constructor(results) {
    this.results = results;
  }

  async readResult(input) {
    const result = this.results[this.index++];
    if (!result) throw new Error('BASE_EXTERNAL_RESULT_EXHAUSTED');
    assert.ok(input.actionAttemptId.startsWith('ATT-PHASE13-'));
    assert.equal(input.expectedRevision, input.workItem.revision);
    return cloneResult(result);
  }
}

class ExternalOverallProvider {
  configured = true;
  index = 0;

  constructor(results) {
    this.results = results;
  }

  async synthesize(input) {
    const result = this.results[this.index++];
    if (!result) throw new Error('OPENCLAW_EXTERNAL_RESULT_EXHAUSTED');
    assert.ok(input.actionAttemptId.startsWith('ATT-PHASE13-'));
    assert.equal(input.expectedRevision, input.workItem.revision);
    return cloneResult(result);
  }
}

class MemoryRegistrar {
  constructor(value) {
    this.value = structuredClone(value);
  }

  async getByWorkItemId(workItemId) {
    assert.equal(workItemId, this.value.workItemId);
    return structuredClone(this.value);
  }

  async compareAndSet(input) {
    assert.equal(input.workItemId, this.value.workItemId);
    assert.equal(input.expectedRevision, this.value.revision);
    this.value = {
      ...structuredClone(input.next),
      revision: input.expectedRevision + 1,
    };
    return structuredClone(this.value);
  }
}

class MemoryArtifactStore {
  values = new Map();
  writes = [];

  async persistAndReadback(value) {
    const bytes = Uint8Array.from(value);
    const digest = sha256(bytes);
    const artifact = {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: `artifact://phase13-integrated-assessment/sha256/${digest}`,
      sha256: digest,
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    };
    const reused = this.values.has(artifact.ref);
    const previous = this.values.get(artifact.ref);
    if (previous) assert.deepEqual(previous, bytes);
    this.values.set(artifact.ref, Uint8Array.from(bytes));
    const readback = Uint8Array.from(this.values.get(artifact.ref));
    assert.deepEqual(readback, bytes);
    this.writes.push({ artifact, bytes: readback });
    return { artifact, bytes: readback, reused };
  }

  async readActualBytes(artifact) {
    const bytes = this.values.get(artifact.ref);
    if (!bytes) throw new Error('PHASE13_ARTIFACT_NOT_FOUND');
    assert.equal(sha256(bytes), artifact.sha256);
    assert.equal(bytes.byteLength, artifact.byteLength);
    return Uint8Array.from(bytes);
  }
}

class MemoryActionAttemptRepository {
  reserved = [];
  completed = [];
  failed = [];

  async reserveAssessmentAction(input) {
    const attemptId = `ATT-PHASE13-${input.actionType}-${input.attemptNo}`;
    this.reserved.push({ ...input, attemptId });
    return { attemptId, created: true };
  }

  async completeAssessmentAction(attemptId) {
    this.completed.push(attemptId);
  }

  async failAssessmentAction(input) {
    this.failed.push({ ...input });
  }
}

function workItem(result) {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: result.workItemId,
    requestId: `PHASE13-LOCAL-${result.workItemId}`,
    revision: 1,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'phase13-local-permission',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'phase13-local-actor',
      decisionId: 'phase13-local-parse-decision',
      decisionHash: 'phase13-local-decision',
      permissionSnapshotVersion: 'phase13-local-permission',
    },
    source: {
      documentId: `PHASE13-DOCUMENT-${result.documentVersionId}`,
      documentVersionId: result.documentVersionId,
      parserRequestId: `PHASE13-PARSER-${result.workItemId}`,
      sourceArtifactId: `PHASE13-SOURCE-${result.documentVersionId}`,
      sourceFileSha256: `sha256:${'0'.repeat(64)}`,
      sourceByteLength: 1,
      driveFileToken: 'phase13-local-external-input',
      driveSourceVersion: 'phase13-local-external-input',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      classifierReleaseId: 'phase13-local-external-input',
      classifierReleaseHash: `sha256:${'1'.repeat(64)}`,
      parserProfileId: 'parser-profile:boeing.sb@1.0.0',
      parserProfileHash: `sha256:${'2'.repeat(64)}`,
      fingerprint: `sha256:${'3'.repeat(64)}`,
    },
    package: {
      packageId: result.packageId,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: `artifact://external-package/${result.packageArtifactSha256}`,
        sha256: result.packageArtifactSha256,
        byteLength: 1,
        mediaType: 'application/json',
      },
      contentHash: `sha256:${'4'.repeat(64)}`,
      semanticHash: `sha256:${'5'.repeat(64)}`,
      provenanceHash: `sha256:${'6'.repeat(64)}`,
      coverageHash: `sha256:${'7'.repeat(64)}`,
      resultStatus: 'partial',
      title: 'External Phase13 same-WorkItem acceptance input',
      contentUnitCount: 1,
      sourceRefCount: 1,
      readerReceiptId: 'phase13-local-external-reader',
      fullValidatorProof: {
        validatorId: 'U0Frozen2SchemaSemanticValidator',
        validatorRevision: 'external-actual-output-input',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        artifactSha256: result.packageArtifactSha256,
      },
    },
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  };
}

function authorization() {
  return {
    async authorize(input) {
      return {
        action: input.action,
        allowed: true,
        actorFingerprint: 'phase13-local-actor',
        decisionId: `phase13-local-${input.action}`,
        decisionHash: 'phase13-local-decision',
        permissionSnapshotVersion: 'phase13-local-permission',
      };
    },
  };
}

function permissionSnapshots() {
  return {
    async freshRead() {
      return { permissionSnapshotVersion: 'phase13-local-permission' };
    },
  };
}

function actualBytes(value, label) {
  if (typeof value === 'string' && value.length > 0) {
    return new TextEncoder().encode(value);
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
  ) {
    return Uint8Array.from(value);
  }
  throw new Error(`${label}_ARTIFACT_BYTES_REQUIRED`);
}

function parsedArtifact(bytes, label) {
  try {
    return object(JSON.parse(Buffer.from(bytes).toString('utf8')), label);
  } catch (error) {
    throw new Error(`${label}_ARTIFACT_JSON_INVALID:${error.message}`);
  }
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}_OBJECT_REQUIRED`);
  }
  return value;
}

function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}_NONEMPTY_STRING_REQUIRED`);
  }
  return value;
}

function digest(value) {
  const candidate = nonempty(value, 'SHA256').replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(candidate)) {
    throw new Error('SHA256_HEX_INVALID');
  }
  return candidate;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label}_POSITIVE_INTEGER_REQUIRED`);
  }
  return value;
}

function count(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error('COUNT_INVALID');
  }
  return value;
}

function required(value) {
  assert.ok(value, 'PHASE13_REQUIRED_PROJECTION_MISSING');
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function cloneResult(value) {
  return {
    ...structuredClone(value),
    artifactBytes: Uint8Array.from(value.artifactBytes),
  };
}

function fileSummary(input) {
  return {
    byteLength: input.bytes.byteLength,
    sha256: sha256(input.bytes),
    resultCount: input.values.length,
  };
}

function projectionSummary(value) {
  return {
    revision: value.revision,
    sourceResultId: value.sourceResultId,
    criterionSetId: value.criterionSetId,
    criterionCount: value.criterionCount,
    evaluationItemCount: value.evaluationItemCount,
    unresolvedCount: value.unresolvedCount,
    sourceBoundCandidateCount: value.sourceBoundCandidateCount,
    artifactSha256: value.artifact.sha256,
    artifactByteLength: value.artifact.byteLength,
  };
}

function overallSummary(value) {
  return {
    revision: value.revision,
    sourceResultId: value.sourceResultId,
    basedOnBaseRuleRevision: value.basedOnBaseRuleRevision,
    basedOnBaseRuleArtifactSha256: value.basedOnBaseRuleArtifactSha256,
    discoveryStatus: value.discoveryStatus,
    gap: value.gap,
    candidateRefCount: value.candidateRefCount,
    authorityLevel: value.authorityLevel,
    externalDiscoveryIsEvidence: value.externalDiscoveryIsEvidence,
    artifactSha256: value.artifact.sha256,
    artifactByteLength: value.artifact.byteLength,
  };
}

await main();
