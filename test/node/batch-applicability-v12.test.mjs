import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const {
  BatchApplicabilityService,
} = require('../../server/modules/batch-applicability/batch-applicability.service.ts');
const {
  FLEET_MASTER_DATA_SCHEMA_VERSION,
} = require('../../server/modules/assessment-workbench/applicability-fleet/fleetMasterData.ts');

const FLEET_ROOT = resolve(
  process.cwd(),
  'config/fleet-master-data/ameco-fleet-20260605',
);
const REAL_737_PACKAGE_PATH = resolve(
  process.cwd(),
  'server/runtime-assets/assessment-host/real-sb/737-34-3830-original-issue/unified-package.frozen-2.json',
);
const EFFECTIVITY_SOURCE_REF =
  'urn:techpub:source-ref:v1:sha256:cd1c913756f9d5929b35525db55d05d0e882a44e45d39747a918176fa40ea777';
const PART_SOURCE_REF =
  'urn:techpub:source-ref:v1:sha256:cf3ca1693927f761fdb02a6d566ef77e692346be7cca8a243340523a1986076c';
const EXPECTED_PACKAGE_ID =
  'urn:techpub:package:v1:sha256:60c1b8548bf24a19d7d9f9cd3bc9fdafe252b034384aabcbba6d79517dc2972d';

const [manifest, assets, aliases, baseConfigurationFacts, real737Package] =
  await Promise.all([
    readJson(resolve(FLEET_ROOT, 'manifest.json')),
    readNdjson(resolve(FLEET_ROOT, 'assets.ndjson')),
    readNdjson(resolve(FLEET_ROOT, 'aliases.ndjson')),
    readNdjson(resolve(FLEET_ROOT, 'configuration-facts.ndjson')),
    readJson(REAL_737_PACKAGE_PATH),
  ]);

const fleetMasterData = buildFleetMasterData({
  manifest,
  assets,
  aliases,
  controlledFacts: buildControlledConfigurationFacts(),
});
const workItem = buildWorkItem(real737Package.packageId);
const sourceCondition = buildSourceCondition();
const service = new BatchApplicabilityService();

test('uses the actual 587/2579 Fleet asset and alias snapshot plus frozen 737 SourceRefs', () => {
  assert.deepEqual(manifest.counts, {
    aircraftAssets: 587,
    aircraftIdentityAliases: 2579,
    configurationFacts: 0,
  });
  assert.equal(assets.length, 587);
  assert.equal(aliases.length, 2579);
  assert.equal(baseConfigurationFacts.length, 0);
  assert.equal(fleetMasterData.assets.length, 587);
  assert.equal(real737Package.packageId, EXPECTED_PACKAGE_ID);
  assert.deepEqual(real737Package.applicability, {
    assignments: [],
    normalizedCandidates: [],
    sourceExpressions: [],
  });

  const effectivity = real737Package.sourceRefs.find(
    (sourceRef) => sourceRef.sourceRefId === EFFECTIVITY_SOURCE_REF,
  );
  const part = real737Package.sourceRefs.find(
    (sourceRef) => sourceRef.sourceRefId === PART_SOURCE_REF,
  );
  assert.equal(effectivity.pageStart, 9);
  assert.match(effectivity.quote, /737-8, 737-9, 737-8200/u);
  assert.match(effectivity.quote, /6490/u);
  assert.match(effectivity.quote, /6555/u);
  assert.match(effectivity.quote, /6722/u);
  assert.equal(part.pageStart, 17);
  assert.match(part.quote, /10-62225-004/u);

  const b1397 = fleetMasterData.assets.find(
    (asset) => asset.aircraftNumber === 'B-1397',
  );
  const b2035 = fleetMasterData.assets.find(
    (asset) => asset.aircraftNumber === 'B-2035',
  );
  assert.deepEqual(
    {
      assetId: b1397.assetId,
      model: b1397.aircraftModel,
      lineNumber: b1397.lineNumber,
    },
    {
      assetId: 'AIRCRAFT:MODEL_MSN:B737_8_60872',
      model: 'B737-8',
      lineNumber: 6490,
    },
  );
  assert.deepEqual(
    {
      assetId: b2035.assetId,
      model: b2035.aircraftModel,
      lineNumber: b2035.lineNumber,
    },
    {
      assetId: 'AIRCRAFT:MODEL_MSN:B777_39L_38674',
      model: 'B777-39L',
      lineNumber: 1051,
    },
  );
  assert.ok(
    b2035.aliases.some((alias) => alias.aliasValue === 'WE160'),
    'the real B-2035 customer-number alias must be in the resolver input',
  );
});

test('runs one source condition across AircraftAsset/asOf targets with trace and lossless UNKNOWN/CONFLICT exclusion', () => {
  const candidateSet = evaluateRealMatrix();

  assert.deepEqual(candidateSet.counts, {
    total: 6,
    true: 2,
    false: 2,
    unknown: 2,
    evaluated: 4,
    waitingInput: 1,
    conflict: 1,
    stale: 0,
    clustered: 4,
    excludedFromClustering: 2,
  });
  assert.equal(
    candidateSet.source.sourceConditionAuthority,
    'NORMALIZED_CANDIDATE',
  );
  assert.deepEqual(candidateSet.source.sourceRefIds, [
    EFFECTIVITY_SOURCE_REF,
    PART_SOURCE_REF,
  ]);
  assert.deepEqual(candidateSet.authority, {
    outputAuthority: 'CANDIDATE_ONLY',
    modelCanSetFinalApplicability: false,
    humanConfirmationIsEngineeringApproval: false,
    engineeringApprovalChanged: false,
    workItemChanged: false,
    createsEvidenceRef: false,
    createsClosureDecision: false,
    createsActionReadiness: false,
  });

  const earlyB1397 = row(candidateSet, 'B-1397', '2025-12-31');
  const currentB1397 = row(candidateSet, 'B-1397', '2026-08-30');
  const b1392 = row(candidateSet, 'B-1392', '2026-08-30');
  const b5043 = row(candidateSet, 'B-5043', '2026-08-30');
  const b2035Alias = row(candidateSet, 'WE160', '2026-08-30');
  const conflictB1398 = row(candidateSet, 'B-1398', '2026-08-30');

  assertMatrixResult(earlyB1397, {
    truth: 'UNKNOWN',
    status: 'WAITING_INPUT',
    eligibility: 'EXCLUDED_UNKNOWN',
    clusterId: null,
  });
  assert.ok(
    earlyB1397.trace.blockingUnknowns.some(
      (unknown) =>
        unknown.kind === 'fact_unknown' &&
        unknown.property === 'pnInstalled' &&
        unknown.qualifier === '1062225004',
    ),
  );
  assertMatrixResult(currentB1397, {
    truth: 'TRUE',
    status: 'EVALUATED',
    eligibility: 'ELIGIBLE_EVALUATED_TRUE',
  });
  assertMatrixResult(b1392, {
    truth: 'TRUE',
    status: 'EVALUATED',
    eligibility: 'ELIGIBLE_EVALUATED_TRUE',
  });
  assertMatrixResult(b5043, {
    truth: 'FALSE',
    status: 'EVALUATED',
    eligibility: 'ELIGIBLE_EVALUATED_FALSE',
  });
  assert.equal(b5043.assetId, 'AIRCRAFT:MODEL_MSN:B737_79L_33408');
  assertMatrixResult(b2035Alias, {
    truth: 'FALSE',
    status: 'EVALUATED',
    eligibility: 'ELIGIBLE_EVALUATED_FALSE',
  });
  assert.equal(b2035Alias.resolvedAircraftNumber, 'B-2035');
  assert.equal(b2035Alias.assetId, 'AIRCRAFT:MODEL_MSN:B777_39L_38674');
  assertMatrixResult(conflictB1398, {
    truth: 'UNKNOWN',
    status: 'CONFLICT',
    eligibility: 'EXCLUDED_CONFLICT',
    clusterId: null,
  });
  assert.ok(
    conflictB1398.trace.blockingUnknowns.some(
      (unknown) => unknown.kind === 'conflicting_fleet_fact',
    ),
  );

  assert.deepEqual(
    candidateSet.candidateClusters.map((cluster) => ({
      truth: cluster.truth,
      memberCount: cluster.memberMatrixItemIds.length,
    })),
    [
      { truth: 'TRUE', memberCount: 2 },
      { truth: 'FALSE', memberCount: 2 },
    ],
  );
  const clusteredIds = new Set(
    candidateSet.candidateClusters.flatMap(
      (cluster) => cluster.memberMatrixItemIds,
    ),
  );
  assert.equal(clusteredIds.has(earlyB1397.matrixItemId), false);
  assert.equal(clusteredIds.has(conflictB1398.matrixItemId), false);
  for (const matrixItem of candidateSet.matrix) {
    assert.equal(matrixItem.trace.evaluator, 'CANONICAL_HOST_KLEENE_EVALUATOR');
    assert.equal(
      matrixItem.trace.fleetResolver,
      'CANONICAL_FLEET_MASTER_DATA_RESOLVER',
    );
    assert.equal(matrixItem.trace.sourceCurrentness.status, 'CURRENT');
    if (matrixItem.status !== 'CONFLICT') {
      assert.deepEqual(
        matrixItem.trace.predicateNodes.map((node) => node.path),
        ['root', 'root.children[0]', 'root.children[1]', 'root.children[2]'],
      );
    }
  }
});

test('human confirmation is revision/source-bound candidate output, never engineering approval', () => {
  const candidateSet = evaluateRealMatrix();
  const trueCluster = candidateSet.candidateClusters.find(
    (cluster) => cluster.truth === 'TRUE',
  );
  const confirmation = service.confirmCluster({
    currentWorkItem: workItem,
    candidateSet,
    expectedWorkItemRevision: workItem.revision,
    candidateClusterId: trueCluster.candidateClusterId,
    decision: 'CONFIRM_CLUSTER_CANDIDATE',
    confirmedByActorId: 'actor-engineer-001',
    reason: 'Trace and source binding reviewed for this candidate cluster.',
    confirmedAt: '2026-08-30T10:00:00.000Z',
    validUntil: '2026-09-30T10:00:00.000Z',
  });

  assert.equal(confirmation.status, 'HUMAN_CLUSTER_REVIEW_CANDIDATE_READY');
  assert.deepEqual(confirmation.authority, {
    outputAuthority: 'CANDIDATE_ONLY',
    clusterAuthority: 'ENGINEER_CONFIRMED_CANDIDATE_CLUSTER',
    persistedByThisDomain: false,
    finalApplicabilityCreated: false,
    reviewActionCreated: false,
    engineeringApprovalChanged: false,
    workItemChanged: false,
  });
  assert.equal(Object.hasOwn(confirmation, 'engineeringApproval'), false);

  const falseCluster = candidateSet.candidateClusters.find(
    (cluster) => cluster.truth === 'FALSE',
  );
  const rejection = service.confirmCluster({
    currentWorkItem: workItem,
    candidateSet,
    expectedWorkItemRevision: workItem.revision,
    candidateClusterId: falseCluster.candidateClusterId,
    decision: 'REJECT_CLUSTER_CANDIDATE',
    confirmedByActorId: 'actor-engineer-001',
    reason: 'This candidate grouping requires individual handling.',
    confirmedAt: '2026-08-30T10:00:00.000Z',
    validUntil: '2026-09-30T10:00:00.000Z',
  });
  assert.equal(
    rejection.authority.clusterAuthority,
    'ENGINEER_REJECTED_CANDIDATE_CLUSTER',
  );
  assert.equal(rejection.authority.engineeringApprovalChanged, false);

  const staleWorkItem = structuredClone(workItem);
  staleWorkItem.revision += 1;
  assert.throws(
    () =>
      service.confirmCluster({
        currentWorkItem: staleWorkItem,
        candidateSet,
        expectedWorkItemRevision: staleWorkItem.revision,
        candidateClusterId: trueCluster.candidateClusterId,
        decision: 'CONFIRM_CLUSTER_CANDIDATE',
        confirmedByActorId: 'actor-engineer-001',
        reason: 'Must not confirm against a stale WorkItem revision.',
        confirmedAt: '2026-08-30T10:00:00.000Z',
        validUntil: '2026-09-30T10:00:00.000Z',
      }),
    errorWithCode('BATCH_CONFIRMATION_WORK_ITEM_REVISION_CONFLICT'),
  );

  const unknownRow = row(candidateSet, 'B-1397', '2025-12-31');
  assert.throws(
    () =>
      service.confirmCluster({
        currentWorkItem: workItem,
        candidateSet,
        expectedWorkItemRevision: workItem.revision,
        candidateClusterId: unknownRow.matrixItemId,
        decision: 'CONFIRM_CLUSTER_CANDIDATE',
        confirmedByActorId: 'actor-engineer-001',
        reason: 'UNKNOWN must remain outside a confirmable cluster.',
        confirmedAt: '2026-08-30T10:00:00.000Z',
        validUntil: '2026-09-30T10:00:00.000Z',
      }),
    errorWithCode('BATCH_CLUSTER_NOT_CONFIRMABLE'),
  );

  const tamperedSet = structuredClone(candidateSet);
  const tamperedTrueCluster = tamperedSet.candidateClusters.find(
    (cluster) => cluster.truth === 'TRUE',
  );
  tamperedTrueCluster.memberMatrixItemIds.pop();
  assert.throws(
    () =>
      service.confirmCluster({
        currentWorkItem: workItem,
        candidateSet: tamperedSet,
        expectedWorkItemRevision: workItem.revision,
        candidateClusterId: tamperedTrueCluster.candidateClusterId,
        decision: 'CONFIRM_CLUSTER_CANDIDATE',
        confirmedByActorId: 'actor-engineer-001',
        reason: 'Tampered cluster membership must be rejected.',
        confirmedAt: '2026-08-30T10:00:00.000Z',
        validUntil: '2026-09-30T10:00:00.000Z',
      }),
    errorWithCode('BATCH_CLUSTER_MEMBERSHIP_DRIFT'),
  );
});

function evaluateRealMatrix() {
  return service.evaluateCandidate({
    actionAttemptId: 'ATTEMPT-R09-V12-BATCH-001',
    workItem,
    sourceCondition,
    targets: [
      {
        aircraftIdentifier: 'B-1397',
        asOf: '2025-12-31',
        fleetMasterData,
      },
      {
        aircraftIdentifier: 'B-1397',
        asOf: '2026-08-30',
        fleetMasterData,
      },
      {
        aircraftIdentifier: 'B-1392',
        asOf: '2026-08-30',
        fleetMasterData,
      },
      {
        aircraftIdentifier: 'B-5043',
        asOf: '2026-08-30',
        fleetMasterData,
      },
      {
        aircraftIdentifier: 'WE160',
        asOf: '2026-08-30',
        fleetMasterData,
      },
      {
        aircraftIdentifier: 'B-1398',
        asOf: '2026-08-30',
        fleetMasterData,
      },
    ],
  });
}

function buildSourceCondition() {
  return {
    sourceConditionId: 'SC-737-34-3830-EFFECTIVITY-AND-EXISTING-FMC',
    sourceExpressionId: 'SE-NORMALIZED-CANDIDATE-737-34-3830-001',
    authority: 'NORMALIZED_CANDIDATE',
    sourceRefIds: [EFFECTIVITY_SOURCE_REF, PART_SOURCE_REF],
    target: {
      kind: 'source_element',
      targetId: EFFECTIVITY_SOURCE_REF,
    },
    applicabilityAst: {
      type: 'and',
      children: [
        {
          type: 'assert',
          property: 'model',
          operator: 'in',
          value: ['737-8', '737-9', '737-8200'],
        },
        {
          type: 'assert',
          property: 'lineNumber',
          operator: 'in',
          value: [6490, 6555, 6722],
        },
        {
          type: 'assert',
          property: 'pnInstalled',
          operator: 'eq',
          value: true,
          qualifier: '10-62225-004',
        },
      ],
    },
  };
}

function buildWorkItem(packageId) {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-R09-V12-BATCH-001',
    requestId: 'REQ-R09-V12-BATCH-001',
    revision: 12,
    source: {
      documentVersionId: 'DV-737-34-3830-ORIGINAL-ISSUE',
    },
    package: { packageId },
  };
}

function buildFleetMasterData({
  manifest: fleetManifest,
  assets: fleetAssets,
  aliases: fleetAliases,
  controlledFacts,
}) {
  const aliasesByAsset = new Map();
  for (const alias of fleetAliases) {
    const values = aliasesByAsset.get(alias.assetId) ?? [];
    values.push({ aliasValue: alias.aliasValue });
    aliasesByAsset.set(alias.assetId, values);
  }
  return {
    schemaVersion: FLEET_MASTER_DATA_SCHEMA_VERSION,
    sourceSnapshotId: fleetManifest.sourceSnapshotId,
    sourceRevisionKey: fleetManifest.sourceRevisionKey,
    authorityRevision: '1',
    sourceAsOf: fleetManifest.sourceAsOf,
    assets: fleetAssets.map((asset) => ({
      assetId: asset.assetId,
      assetVersionId: asset.assetVersionId,
      aircraftNumber: asset.aircraftNumber,
      aliases: aliasesByAsset.get(asset.assetId) ?? [],
      fleetFamily: asset.fleetFamily,
      aircraftModel: asset.aircraftModel,
      series: asset.series,
      msn: asset.msn,
      lineNumber: asset.lineNumber,
      deliveryDate: asset.deliveryDate,
      sourceRef: {
        sourceTable: 'canonical_fleet_asset_version',
        sourceRecordId: asset.sourceRecordId,
      },
      recordHash: asset.recordHash,
    })),
    facts: controlledFacts,
  };
}

function buildControlledConfigurationFacts() {
  const sourceRef = (factId) => ({
    sourceTable: 'test_controlled_configuration_fact',
    sourceRecordId: factId,
    sourceField: 'pnInstalled[10-62225-004]',
  });
  const fact = ({ factId, assetId, value }) => ({
    factId,
    assetId,
    factType: 'fleet_configuration',
    property: 'pnInstalled',
    qualifier: '10-62225-004',
    value,
    validAsOf: '2026-01-01',
    sourceRef: sourceRef(factId),
    recordHash: `sha256:test-controlled-${factId}`,
  });
  return [
    fact({
      factId: 'FACT-B1397-PN-PRESENT',
      assetId: 'AIRCRAFT:MODEL_MSN:B737_8_60872',
      value: true,
    }),
    fact({
      factId: 'FACT-B1392-PN-PRESENT',
      assetId: 'AIRCRAFT:MODEL_MSN:B737_8_60877',
      value: true,
    }),
    fact({
      factId: 'FACT-B1398-PN-CONFLICT-TRUE',
      assetId: 'AIRCRAFT:MODEL_MSN:B737_8_60883',
      value: true,
    }),
    fact({
      factId: 'FACT-B1398-PN-CONFLICT-FALSE',
      assetId: 'AIRCRAFT:MODEL_MSN:B737_8_60883',
      value: false,
    }),
  ];
}

function row(candidateSet, aircraftIdentifier, asOf) {
  const matrixItem = candidateSet.matrix.find(
    (candidate) =>
      candidate.aircraftIdentifier === aircraftIdentifier &&
      candidate.asOf === asOf,
  );
  assert.ok(matrixItem, `matrix row ${aircraftIdentifier}@${asOf} must exist`);
  return matrixItem;
}

function assertMatrixResult(
  matrixItem,
  { truth, status, eligibility, clusterId = undefined },
) {
  assert.equal(matrixItem.truth, truth);
  assert.equal(matrixItem.status, status);
  assert.equal(matrixItem.clusterEligibility, eligibility);
  if (clusterId !== undefined) {
    assert.equal(matrixItem.candidateClusterId, clusterId);
  } else {
    assert.ok(matrixItem.candidateClusterId);
  }
}

function errorWithCode(code) {
  return (error) => error?.code === code && error?.statusCode === 409;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readNdjson(filePath) {
  const text = await readFile(filePath, 'utf8');
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}
