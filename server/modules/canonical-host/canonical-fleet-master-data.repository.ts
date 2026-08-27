import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import {
  canonicalFleetAliasVersion,
  canonicalFleetAssetVersion,
  canonicalFleetConfigurationFactVersion,
  canonicalFleetScopeHead,
  canonicalFleetSourceSnapshot,
} from '../../database/schema';
import {
  FLEET_MASTER_DATA_SCHEMA_VERSION,
  type FleetMasterDataAssetRecord,
  type FleetMasterDataFactRecord,
  type FleetMasterDataSource,
} from '../assessment-workbench/applicability-fleet/fleetMasterData';

interface CurrentFleetSourceRow {
  sourceSnapshotId: string;
  sourceRevisionKey: string;
  sourceAsOf: string;
  authorityRevision: number;
}

interface FleetAliasRow {
  assetId: string;
  aliasValue: string;
}

interface FleetFactRow {
  factId: string;
  factVersionId: string;
  assetId: string;
  factType: string;
  property: string;
  qualifier: string | null;
  valueJson: string;
  validAsOf: string | null;
  recordHash: string;
}

/**
 * Tenant-scoped read owner for the current canonical FleetMasterData head.
 * It returns only records for the selected aircraft; the 0.10 migration file
 * is never opened by product runtime.
 */
@Injectable()
export class CanonicalFleetMasterDataRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async readCurrentForAircraft(input: {
    tenantId: string;
    aircraftIdentifier: string;
    asOf: string;
  }): Promise<FleetMasterDataSource> {
    const tenantId: string = requiredText(input.tenantId);
    const aircraftIdentifier: string = normalizeIdentifier(
      input.aircraftIdentifier,
    );
    const asOf: string = requiredIsoDate(input.asOf);
    const source: CurrentFleetSourceRow =
      await this.requiredCurrentSource(tenantId);

    const matchingAliases: FleetAliasRow[] = await this.db
      .select({
        assetId: canonicalFleetAliasVersion.assetId,
        aliasValue: canonicalFleetAliasVersion.aliasValue,
      })
      .from(canonicalFleetAliasVersion)
      .where(
        and(
          eq(canonicalFleetAliasVersion.tenantId, tenantId),
          eq(
            canonicalFleetAliasVersion.sourceSnapshotId,
            source.sourceSnapshotId,
          ),
          eq(canonicalFleetAliasVersion.status, 'ACTIVE'),
          sql`upper(btrim(${canonicalFleetAliasVersion.aliasValue})) = ${aircraftIdentifier}`,
        ),
      );
    const aliasAssetIds: string[] = [
      ...new Set(
        matchingAliases.map((row: FleetAliasRow): string => row.assetId),
      ),
    ];
    const identifierCondition =
      aliasAssetIds.length === 0
        ? sql`upper(btrim(${canonicalFleetAssetVersion.aircraftNumber})) = ${aircraftIdentifier}`
        : or(
            sql`upper(btrim(${canonicalFleetAssetVersion.aircraftNumber})) = ${aircraftIdentifier}`,
            inArray(canonicalFleetAssetVersion.assetId, aliasAssetIds),
          );
    const assetRows = await this.db
      .select({
        assetId: canonicalFleetAssetVersion.assetId,
        assetVersionId: canonicalFleetAssetVersion.assetVersionId,
        aircraftNumber: canonicalFleetAssetVersion.aircraftNumber,
        fleetFamily: canonicalFleetAssetVersion.fleetFamily,
        aircraftModel: canonicalFleetAssetVersion.aircraftModel,
        series: canonicalFleetAssetVersion.series,
        msn: canonicalFleetAssetVersion.msn,
        lineNumber: canonicalFleetAssetVersion.lineNumber,
        deliveryDate: canonicalFleetAssetVersion.deliveryDate,
        recordHash: canonicalFleetAssetVersion.recordHash,
      })
      .from(canonicalFleetAssetVersion)
      .where(
        and(
          eq(canonicalFleetAssetVersion.tenantId, tenantId),
          eq(
            canonicalFleetAssetVersion.sourceSnapshotId,
            source.sourceSnapshotId,
          ),
          eq(canonicalFleetAssetVersion.status, 'ACTIVE'),
          sql`${canonicalFleetAssetVersion.validFrom}::date <= ${asOf}::date`,
          or(
            isNull(canonicalFleetAssetVersion.validTo),
            sql`${canonicalFleetAssetVersion.validTo}::date > ${asOf}::date`,
          ),
          identifierCondition,
        ),
      );
    const assetIds: string[] = assetRows.map(
      (row: (typeof assetRows)[number]): string => row.assetId,
    );
    const aliases: FleetAliasRow[] =
      assetIds.length === 0
        ? []
        : await this.db
            .select({
              assetId: canonicalFleetAliasVersion.assetId,
              aliasValue: canonicalFleetAliasVersion.aliasValue,
            })
            .from(canonicalFleetAliasVersion)
            .where(
              and(
                eq(canonicalFleetAliasVersion.tenantId, tenantId),
                eq(
                  canonicalFleetAliasVersion.sourceSnapshotId,
                  source.sourceSnapshotId,
                ),
                eq(canonicalFleetAliasVersion.status, 'ACTIVE'),
                inArray(canonicalFleetAliasVersion.assetId, assetIds),
              ),
            );
    const facts: FleetFactRow[] =
      assetIds.length === 0
        ? []
        : await this.db
            .select({
              factId: canonicalFleetConfigurationFactVersion.factId,
              factVersionId:
                canonicalFleetConfigurationFactVersion.factVersionId,
              assetId: canonicalFleetConfigurationFactVersion.assetId,
              factType: canonicalFleetConfigurationFactVersion.factType,
              property: canonicalFleetConfigurationFactVersion.property,
              qualifier: canonicalFleetConfigurationFactVersion.qualifier,
              valueJson: canonicalFleetConfigurationFactVersion.valueJson,
              validAsOf: canonicalFleetConfigurationFactVersion.validAsOf,
              recordHash: canonicalFleetConfigurationFactVersion.recordHash,
            })
            .from(canonicalFleetConfigurationFactVersion)
            .where(
              and(
                eq(canonicalFleetConfigurationFactVersion.tenantId, tenantId),
                eq(
                  canonicalFleetConfigurationFactVersion.sourceSnapshotId,
                  source.sourceSnapshotId,
                ),
                eq(canonicalFleetConfigurationFactVersion.status, 'ACTIVE'),
                inArray(
                  canonicalFleetConfigurationFactVersion.assetId,
                  assetIds,
                ),
                or(
                  isNull(canonicalFleetConfigurationFactVersion.validAsOf),
                  lte(canonicalFleetConfigurationFactVersion.validAsOf, asOf),
                ),
              ),
            );
    const aliasesByAsset: Map<
      string,
      Array<{ aliasValue: string }>
    > = new Map();
    for (const alias of aliases) {
      const values: Array<{ aliasValue: string }> =
        aliasesByAsset.get(alias.assetId) ?? [];
      values.push({ aliasValue: alias.aliasValue });
      aliasesByAsset.set(alias.assetId, values);
    }
    const assets: FleetMasterDataAssetRecord[] = assetRows.map(
      (row: (typeof assetRows)[number]): FleetMasterDataAssetRecord => ({
        assetId: row.assetId,
        assetVersionId: row.assetVersionId,
        aircraftNumber: row.aircraftNumber,
        aliases: aliasesByAsset.get(row.assetId) ?? [],
        fleetFamily: row.fleetFamily,
        aircraftModel: row.aircraftModel,
        series: row.series,
        msn: row.msn,
        lineNumber: row.lineNumber,
        deliveryDate: row.deliveryDate,
        sourceRef: {
          sourceTable: 'canonical_fleet_asset_version',
          sourceRecordId: row.assetVersionId,
        },
        recordHash: row.recordHash,
      }),
    );
    return {
      schemaVersion: FLEET_MASTER_DATA_SCHEMA_VERSION,
      sourceSnapshotId: source.sourceSnapshotId,
      sourceRevisionKey: source.sourceRevisionKey,
      authorityRevision: String(source.authorityRevision),
      sourceAsOf: source.sourceAsOf,
      assets,
      facts: facts.map(toFleetFact),
    };
  }

  private async requiredCurrentSource(
    tenantId: string,
  ): Promise<CurrentFleetSourceRow> {
    const [row] = await this.db
      .select({
        sourceSnapshotId: canonicalFleetSourceSnapshot.sourceSnapshotId,
        sourceRevisionKey: canonicalFleetSourceSnapshot.sourceRevisionKey,
        sourceAsOf: canonicalFleetSourceSnapshot.sourceAsOf,
        authorityRevision: canonicalFleetScopeHead.authorityRevision,
      })
      .from(canonicalFleetScopeHead)
      .innerJoin(
        canonicalFleetSourceSnapshot,
        and(
          eq(
            canonicalFleetSourceSnapshot.tenantId,
            canonicalFleetScopeHead.tenantId,
          ),
          eq(
            canonicalFleetSourceSnapshot.sourceSnapshotId,
            canonicalFleetScopeHead.currentSourceSnapshotId,
          ),
        ),
      )
      .where(eq(canonicalFleetScopeHead.tenantId, tenantId))
      .limit(1);
    if (!row) {
      throw serviceUnavailable('APPLICABILITY_FLEET_DATABASE_UNAVAILABLE');
    }
    return row;
  }
}

function toFleetFact(row: FleetFactRow): FleetMasterDataFactRecord {
  if (
    !['fleet_configuration', 'sb_incorporation', 'data_quality_issue'].includes(
      row.factType,
    )
  ) {
    throw serviceUnavailable('APPLICABILITY_FLEET_FACT_INVALID');
  }
  let value: unknown;
  try {
    value = JSON.parse(row.valueJson) as unknown;
  } catch {
    throw serviceUnavailable('APPLICABILITY_FLEET_FACT_INVALID');
  }
  return {
    factId: row.factId,
    assetId: row.assetId,
    factType: row.factType as FleetMasterDataFactRecord['factType'],
    property: row.property,
    qualifier: row.qualifier,
    value,
    validAsOf: row.validAsOf,
    sourceRef: {
      sourceTable: 'canonical_fleet_configuration_fact_version',
      sourceRecordId: row.factVersionId,
    },
    recordHash: row.recordHash,
  };
}

function normalizeIdentifier(value: string): string {
  return requiredText(value).toUpperCase();
}

function requiredText(value: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw serviceUnavailable('APPLICABILITY_FLEET_QUERY_INVALID');
  }
  return value.trim();
}

function requiredIsoDate(value: string): string {
  const date: string = requiredText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw serviceUnavailable('APPLICABILITY_FLEET_QUERY_INVALID');
  }
  const timestamp: number = Date.parse(`${date}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== date
  ) {
    throw serviceUnavailable('APPLICABILITY_FLEET_QUERY_INVALID');
  }
  return date;
}

function serviceUnavailable(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 503 });
}
