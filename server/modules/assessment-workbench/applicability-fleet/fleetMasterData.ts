/**
 * WiseLink 3.1 applicability-fleet: FleetMasterData source layer.
 *
 * Migrated from the mature v8 fleetSnapshotLoader/applicabilityQueryRepository
 * source-level reference onto the WiseLink 3.1 Host DV/professional-package
 * + aircraftNumber + asOf + fleet facts input shape. This module is the single
 * fleet source seam for the applicability lane:
 *
 * - inputs are Host DV / professional-package records, never Host-recomputed
 *   applicability matrices;
 * - a resolved snapshot carries SourceRef, assetVersionId, recordHash and an
 *   explicit fleet source snapshot/revision/authority currentness block;
 * - missing/conflicting fleet facts resolve to WAITING_INPUT with observable
 *   missing-fact descriptors — they are never silently guessed;
 * - sbIncorporated / pnInstalled / optionInstalled / equipmentModelInstalled
 *   keep explicit-absence semantics (installed:false is a fact, an absent key
 *   is unknown).
 */

import type { ApplicabilityFleetSnapshot } from './applicabilityKleeneEngine';

export const FLEET_MASTER_DATA_SCHEMA_VERSION =
  'wiselink.v3_1.applicability_fleet.fleet_master_data.v1' as const;

export type FleetCurrentness =
  | 'CURRENT'
  | 'STALE'
  | 'CONFLICT'
  | 'UNVERIFIED';

export interface FleetSourceRef {
  /** Host DV / professional-package record the fact was read from. */
  sourceTable: string;
  sourceRecordId: string;
  /** Optional source field path for qualified facts. */
  sourceField?: string | null;
}

export interface FleetSourceCurrentness {
  sourceSnapshotId: string | null;
  sourceRevisionKey: string | null;
  authorityRevision: string | null;
  status: FleetCurrentness;
  /** asOf the fleet source snapshot was frozen at, when known. */
  sourceAsOf: string | null;
  /** Human-readable reason for non-CURRENT statuses. */
  reason: string | null;
}

export interface FleetMasterDataAssetRecord {
  assetId: string;
  assetVersionId: string;
  aircraftNumber: string;
  aliases?: Array<{ aliasValue: string }>;
  fleetFamily?: string | null;
  aircraftModel?: string | null;
  series?: string | null;
  msn?: string | null;
  lineNumber?: number | null;
  deliveryDate?: string | null;
  sourceRef: FleetSourceRef;
  recordHash: string;
}

export interface FleetMasterDataFactRecord {
  factId: string;
  assetId: string;
  factType:
    | 'fleet_configuration'
    | 'sb_incorporation'
    | 'data_quality_issue';
  property: string;
  qualifier?: string | null;
  value: unknown;
  validAsOf?: string | null;
  sourceRef: FleetSourceRef;
  recordHash: string;
}

export interface FleetMasterDataSource {
  schemaVersion: typeof FLEET_MASTER_DATA_SCHEMA_VERSION;
  sourceSnapshotId: string | null;
  sourceRevisionKey: string | null;
  authorityRevision: string | null;
  sourceAsOf: string | null;
  assets: FleetMasterDataAssetRecord[];
  facts: FleetMasterDataFactRecord[];
}

export interface MissingFleetFact {
  kind: 'missing_fleet_fact';
  assetId: string | null;
  property: string;
  qualifier: string | null;
  factType: string;
  strategy: 'direct_fact' | 'data_quality_warning';
  reason: string;
}

export interface ConflictingFleetFactEvidence {
  factId: string;
  value: unknown;
  validAsOf: string | null;
  sourceRef: FleetSourceRef;
  recordHash: string;
}

export interface ConflictingFleetFact {
  kind: 'conflicting_fleet_fact';
  assetId: string;
  property: string;
  qualifier: string | null;
  factType: string;
  strategy: 'direct_fact';
  reason: string;
  /** All effective facts behind the conflict, with full source evidence. */
  conflicts: ConflictingFleetFactEvidence[];
}

export interface FleetSnapshotResolution {
  status: 'RESOLVED' | 'WAITING_INPUT';
  missingFacts: MissingFleetFact[];
  conflictingFacts: ConflictingFleetFact[];
  snapshot: ApplicabilityFleetSnapshot | null;
  sourceCurrentness: FleetSourceCurrentness;
  provenance: {
    assetId: string | null;
    assetVersionId: string | null;
    recordHash: string | null;
    sourceRefs: FleetSourceRef[];
  } | null;
}

export interface ResolveFleetSnapshotInput {
  dataSource: FleetMasterDataSource;
  aircraftNumber: string;
  asOf: string;
}

function normalizeKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeSbNumber(value: unknown): string {
  return normalizeKey(value)
    .replace(/^(BOEING\s*)?SB\s*/iu, '')
    .replace(/[^A-Z0-9]/gu, '');
}

function normalizePartNumber(value: unknown): string {
  return normalizeKey(value).replace(/[^A-Z0-9]/gu, '');
}

function normalizeEquipmentModel(value: unknown): string {
  return normalizeKey(value).replace(/[^A-Z0-9]/gu, '');
}

const QUALIFIED_PROPERTIES = [
  'sbIncorporated',
  'pnInstalled',
  'optionInstalled',
  'equipmentModelInstalled',
];

const QUALIFIER_NORMALIZERS: Record<string, (value: unknown) => string> = {
  sbIncorporated: normalizeSbNumber,
  pnInstalled: normalizePartNumber,
  equipmentModelInstalled: normalizeEquipmentModel,
  optionInstalled: normalizeKey,
};

function normalizeQualifier(property: string, qualifier: unknown): string {
  const normalizer = QUALIFIER_NORMALIZERS[property];
  return normalizer ? normalizer(qualifier) : normalizeKey(qualifier);
}

function collectSourceCurrentness(
  source: FleetMasterDataSource,
): FleetSourceCurrentness {
  const status: FleetCurrentness = source.sourceSnapshotId && source.sourceRevisionKey
    ? 'CURRENT'
    : source.sourceSnapshotId || source.sourceRevisionKey
      ? 'UNVERIFIED'
      : 'UNVERIFIED';
  return {
    sourceSnapshotId: source.sourceSnapshotId ?? null,
    sourceRevisionKey: source.sourceRevisionKey ?? null,
    authorityRevision: source.authorityRevision ?? null,
    status,
    sourceAsOf: source.sourceAsOf ?? null,
    reason:
      status === 'CURRENT'
        ? null
        : source.sourceSnapshotId || source.sourceRevisionKey
          ? 'FLEET_SOURCE_SNAPSHOT_IDENTITY_INCOMPLETE'
          : 'FLEET_SOURCE_SNAPSHOT_IDENTITY_MISSING',
  };
}

function findAssetByAircraftNumber(
  assets: FleetMasterDataAssetRecord[],
  aircraftNumber: string,
): FleetMasterDataAssetRecord | null {
  const target = normalizeKey(aircraftNumber);
  if (!target) return null;
  return (
    assets.find(
      (asset) =>
        normalizeKey(asset.aircraftNumber) === target
        || (asset.aliases || []).some(
          (alias) => normalizeKey(alias.aliasValue) === target,
        ),
    ) ?? null
  );
}

function factsAsOf(facts: FleetMasterDataFactRecord[], asOf: string): FleetMasterDataFactRecord[] {
  return facts.filter((fact) => {
    if (!fact.validAsOf) return true;
    return fact.validAsOf <= asOf;
  });
}

/**
 * Detects effective qualified facts that disagree on the same asset /
 * property / normalized qualifier. Same-value duplicates are NOT conflicts;
 * different qualifiers and future (asOf-filtered) facts never conflict.
 */
function detectQualifiedFactConflicts(
  asset: FleetMasterDataAssetRecord,
  effectiveFacts: FleetMasterDataFactRecord[],
): ConflictingFleetFact[] {
  const groups = new Map<string, FleetMasterDataFactRecord[]>();
  for (const fact of effectiveFacts) {
    if (!QUALIFIED_PROPERTIES.includes(fact.property)) continue;
    const qualifier = normalizeQualifier(fact.property, fact.qualifier ?? '');
    if (!qualifier) continue;
    const groupKey = `${fact.property}\u0000${qualifier}`;
    const group = groups.get(groupKey) || [];
    group.push(fact);
    groups.set(groupKey, group);
  }

  const conflicts: ConflictingFleetFact[] = [];
  for (const [groupKey, groupFacts] of groups) {
    const distinctValues = new Set(
      groupFacts.map((fact) =>
        fact.value === undefined ? 'null' : JSON.stringify(fact.value),
      ),
    );
    if (distinctValues.size <= 1) continue;
    const separatorIndex = groupKey.indexOf('\u0000');
    const property = groupKey.slice(0, separatorIndex);
    const qualifier = groupKey.slice(separatorIndex + 1);
    conflicts.push({
      kind: 'conflicting_fleet_fact',
      assetId: asset.assetId,
      property,
      qualifier,
      factType: groupFacts[0].factType,
      strategy: 'direct_fact',
      reason: `FLEET_FACT_CONFLICT:${property}:${qualifier}`,
      conflicts: groupFacts.map((fact) => ({
        factId: fact.factId,
        value: fact.value,
        validAsOf: fact.validAsOf ?? null,
        sourceRef: fact.sourceRef,
        recordHash: fact.recordHash,
      })),
    });
  }
  return conflicts;
}

function applyQualifiedFact(
  properties: Record<string, unknown>,
  fact: FleetMasterDataFactRecord,
) {
  if (QUALIFIED_PROPERTIES.includes(fact.property)) {
    const bucket = (properties[fact.property] ?? {}) as Record<string, unknown>;
    const key = normalizeQualifier(fact.property, fact.qualifier ?? '');
    if (!key) return;
    bucket[key] = fact.value;
    properties[fact.property] = bucket;
    return;
  }
  properties[fact.property] = fact.value;
}

export function resolveFleetSnapshot(input: ResolveFleetSnapshotInput): FleetSnapshotResolution {
  const { dataSource, aircraftNumber, asOf } = input;
  if (dataSource.schemaVersion !== FLEET_MASTER_DATA_SCHEMA_VERSION) {
    throw new Error('FLEET_MASTER_DATA_SCHEMA_VERSION_UNSUPPORTED');
  }
  const sourceCurrentness = collectSourceCurrentness(dataSource);

  const asset = findAssetByAircraftNumber(dataSource.assets, aircraftNumber);
  if (!asset) {
    return {
      status: 'WAITING_INPUT',
      missingFacts: [
        {
          kind: 'missing_fleet_fact',
          assetId: null,
          property: 'aircraftNumber',
          qualifier: null,
          factType: 'fleet_configuration',
          strategy: 'direct_fact',
          reason: `FLEET_ASSET_NOT_FOUND_FOR_AIRCRAFT_NUMBER:${normalizeKey(aircraftNumber)}`,
        },
      ],
      snapshot: null,
      conflictingFacts: [],
      sourceCurrentness,
      provenance: null,
    };
  }

  const effectiveFacts = factsAsOf(
    dataSource.facts.filter((fact) => fact.assetId === asset.assetId),
    asOf,
  );
  const conflictingFacts = detectQualifiedFactConflicts(asset, effectiveFacts);
  if (conflictingFacts.length > 0) {
    // Conflicting qualified facts must never silently pick a winner: the
    // resolution blocks as WAITING_INPUT and carries every conflicting
    // factId / SourceRef / recordHash for review.
    return {
      status: 'WAITING_INPUT',
      missingFacts: [],
      conflictingFacts,
      snapshot: null,
      sourceCurrentness,
      provenance: {
        assetId: asset.assetId,
        assetVersionId: asset.assetVersionId,
        recordHash: asset.recordHash,
        sourceRefs: [
          asset.sourceRef,
          ...effectiveFacts.map((fact) => fact.sourceRef),
        ],
      },
    };
  }
  const properties: Record<string, unknown> = {
    fleetFamily: asset.fleetFamily ?? undefined,
    series: asset.series ?? undefined,
    tailNumber: asset.aircraftNumber,
  };
  if (asset.msn != null) properties.msn = asset.msn;
  if (asset.lineNumber != null) properties.lineNumber = asset.lineNumber;
  if (asset.deliveryDate != null) properties.deliveryDate = asset.deliveryDate;
  if (asset.aircraftModel != null) properties.model = asset.aircraftModel;
  for (const fact of effectiveFacts) {
    applyQualifiedFact(properties, fact);
  }

  const sourceRefs: FleetSourceRef[] = [
    asset.sourceRef,
    ...effectiveFacts.map((fact) => fact.sourceRef),
  ];

  const snapshot: ApplicabilityFleetSnapshot = {
    assetId: asset.assetId,
    assessmentAsOf: asOf,
    properties,
    context: {
      aircraftNumber: asset.aircraftNumber,
      fleetFamily: asset.fleetFamily ?? undefined,
      series: asset.series ?? undefined,
      aircraftModel: asset.aircraftModel ?? undefined,
    },
  };

  return {
    status: 'RESOLVED',
    missingFacts: [],
    conflictingFacts: [],
      snapshot,
    sourceCurrentness,
    provenance: {
      assetId: asset.assetId,
      assetVersionId: asset.assetVersionId,
      recordHash: asset.recordHash,
      sourceRefs,
    },
  };
}
