import {
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  CanonicalLibraryGraphRequest,
  CanonicalLibraryGraphResponse,
  LibraryGraphFilters,
} from '@shared/library-graph.interface';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import { libraryAircraftMentionAliases } from '@shared/library-aircraft-mentions';
import type {
  OwnedLibraryGraphQuery,
  OwnedLibraryGraphResult,
} from '../document-management/src/hosted/nest/miaoda-hosted-library-graph-query';

const FILTERS = [
  'search',
  'normalizedFamily',
  'ata',
  'aircraftModel',
  'fleetFamily',
  'fleetModel',
] as const;
const RESPONSE_BUDGET = 256 * 1024;
const fail = () =>
  new BadRequestException({ code: 'LIBRARY_GRAPH_REQUEST_INVALID' });
const dataFail = () =>
  new UnprocessableEntityException({
    code: 'LIBRARY_GRAPH_DATA_LIMIT_EXCEEDED',
  });
function text(value: unknown, maximum = 96, trim = false): string {
  if (typeof value !== 'string') throw fail();
  const result = trim ? value.trim() : value;
  if (result.length > maximum || result.includes('\0')) throw fail();
  try {
    encodeURIComponent(result);
  } catch {
    throw fail();
  }
  return result;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
  return value as Record<string, unknown>;
}

/** GET query syntax maps missing classification explicitly; literal empty values survive. */
export function libraryGraphHttpRequest(
  raw: unknown,
): CanonicalLibraryGraphRequest {
  const request = { ...record(raw) };
  if ('limit' in request) {
    if (
      typeof request.limit !== 'string' ||
      !/^[1-9][0-9]*$/u.test(request.limit)
    )
      throw fail();
    request.limit = Number(request.limit);
  }
  if ('clusterMissing' in request) {
    if (
      request.clusterMissing !== 'true' ||
      'clusterValue' in request ||
      request.level !== 'families'
    )
      throw fail();
    request.clusterValue = null;
    delete request.clusterMissing;
  }
  return graphRequest(request);
}
export function graphRequest(raw: unknown): CanonicalLibraryGraphRequest {
  const value = record(raw);
  const level = value.level;
  if (!['clusters', 'families', 'versions'].includes(level as string))
    throw fail();
  const allowed = new Set([
    'level',
    'cursor',
    'limit',
    ...(level === 'versions'
      ? ['familyId']
      : [
          'groupBy',
          ...FILTERS,
          ...(level === 'families' ? ['clusterValue'] : []),
        ]),
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw fail();
  const limit = value.limit ?? 50;
  if (
    !Number.isSafeInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > 50
  )
    throw fail();
  const page = {
    limit: limit as number,
    ...('cursor' in value ? { cursor: text(value.cursor, 8192) } : {}),
  };
  if (level === 'versions') {
    const familyId = text(value.familyId);
    if (!familyId.trim()) throw fail();
    return { level, familyId, ...page };
  }
  const groupBy = value.groupBy;
  if (groupBy !== 'normalizedFamily' && groupBy !== 'ata') throw fail();
  const filters: LibraryGraphFilters = {};
  for (const key of FILTERS) {
    if (value[key] !== undefined) {
      const filtered = text(value[key], key === 'search' ? 200 : 96, true);
      if (filtered)
        filters[key] =
          key === 'fleetFamily' || key === 'fleetModel'
            ? filtered.toUpperCase()
            : filtered;
    }
  }
  if (
    (filters.fleetModel && !filters.fleetFamily) ||
    (filters.fleetFamily && filters.aircraftModel)
  )
    throw fail();
  if (level === 'families') {
    const clusterValue =
      value.clusterValue === null ? null : text(value.clusterValue);
    return { level, groupBy, clusterValue, ...filters, ...page };
  }
  return { level: 'clusters', groupBy, ...filters, ...page };
}
function afterCursor(
  cursor: string | undefined,
  context: string,
  level: string,
) {
  if (cursor === undefined) return null;
  try {
    if (!cursor || !/^[\w-]+$/u.test(cursor) || cursor.length > 8192)
      throw new Error();
    const parsed = record(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    if (
      Object.keys(parsed).sort().join(',') !== 'context,value' ||
      parsed.context !== context
    )
      throw new Error();
    if (parsed.value === null && level === 'clusters') return { value: null };
    const value = text(parsed.value);
    if (level !== 'clusters' && !value.trim()) throw new Error();
    return { value };
  } catch {
    throw new BadRequestException({ code: 'LIBRARY_GRAPH_CURSOR_INVALID' });
  }
}
function validText(
  value: unknown,
  bytes: number,
  nonempty = false,
): value is string {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    Buffer.byteLength(value, 'utf8') > bytes ||
    value.length > (bytes === 384 ? 96 : 512) ||
    (nonempty && !value.trim())
  )
    return false;
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export async function readLibraryGraph(
  input: CanonicalLibraryGraphRequest,
  scope: { tenantId: string; actorUserId: string; appId: string },
  readFleet: () => Promise<CanonicalLibraryFleetCatalog>,
  read: (
    query: OwnedLibraryGraphQuery,
  ) => PromiseLike<OwnedLibraryGraphResult[]>,
): Promise<CanonicalLibraryGraphResponse> {
  const request = graphRequest(input);
  let fleetMentionValues: string[] | undefined;
  let fleetRevision: string[] | undefined;
  if (request.level !== 'versions' && request.fleetFamily) {
    const catalog = await readFleet();
    if (catalog.status === 'MISSING' || !catalog.source)
      throw new ServiceUnavailableException({
        code: 'LIBRARY_FLEET_CATALOG_MISSING',
      });
    const family = catalog.families.find(
      (item) => item.fleetFamily === request.fleetFamily,
    );
    if (
      !family ||
      (request.fleetModel && !family.models.includes(request.fleetModel))
    )
      throw fail();
    fleetMentionValues = [
      ...new Set(
        (request.fleetModel
          ? [request.fleetModel]
          : [family.fleetFamily, ...family.models]
        ).flatMap(libraryAircraftMentionAliases),
      ),
    ];
    if (!fleetMentionValues.length) throw fail();
    fleetRevision = [
      catalog.source.sourceSnapshotId,
      catalog.source.authorityRevision,
      catalog.asOf,
    ];
  }
  const { cursor, ...selection } = request;
  // Plain scoped continuation, never a capability. Authorization is rerun on every page.
  const context = JSON.stringify([
    scope,
    selection,
    fleetRevision ?? null,
    fleetMentionValues ?? null,
  ]);
  const after = afterCursor(cursor, context, request.level);
  const [row] = await read({
    tenantId: scope.tenantId,
    actorUserId: scope.actorUserId,
    request,
    fleetMentionValues,
    after,
    limit: request.limit!,
  });
  if (
    !row ||
    row.invalidData ||
    !Array.isArray(row.items) ||
    row.items.length > request.limit! + 1 ||
    !count(row.uniqueFamilyCount) ||
    !count(row.readableVersionCountInMatchingFamilies)
  )
    throw dataFail();
  const counts = {
    uniqueFamilyCount: row.uniqueFamilyCount,
    readableVersionCountInMatchingFamilies:
      row.readableVersionCountInMatchingFamilies,
  };
  const items = row.items.slice(0, request.limit).map((item) => {
    if (
      request.level === 'clusters' &&
      item.kind === 'CLASSIFICATION' &&
      (item.value === null || validText(item.value, 384)) &&
      count(item.uniqueFamilyCount) &&
      count(item.readableVersionCountInMatchingFamilies)
    ) {
      return {
        kind: item.kind,
        value: item.value,
        uniqueFamilyCount: item.uniqueFamilyCount,
        readableVersionCountInMatchingFamilies:
          item.readableVersionCountInMatchingFamilies,
      };
    }
    if (
      request.level === 'families' &&
      item.kind === 'FAMILY' &&
      validText(item.familyId, 384, true) &&
      validText(item.documentId, 384, true) &&
      validText(item.documentCode, 2048) &&
      validText(item.normalizedFamily, 384) &&
      count(item.readableVersionCount)
    ) {
      return {
        kind: item.kind,
        familyId: item.familyId,
        documentId: item.documentId,
        documentCode: item.documentCode,
        normalizedFamily: item.normalizedFamily,
        readableVersionCount: item.readableVersionCount,
      };
    }
    if (
      request.level === 'versions' &&
      item.kind === 'VERSION' &&
      validText(item.documentVersionId, 384, true) &&
      (item.readerWorkItemId === undefined || validText(item.readerWorkItemId, 384, true)) &&
      validText(item.businessRevision, 2048) &&
      typeof item.isCurrent === 'boolean' &&
      typeof item.committedAt === 'string' &&
      Number.isFinite(Date.parse(item.committedAt))
    ) {
      return {
        kind: item.kind,
        documentVersionId: item.documentVersionId,
        ...(item.readerWorkItemId ? { readerWorkItemId: item.readerWorkItemId } : {}),
        businessRevision: item.businessRevision,
        committedAt: new Date(item.committedAt).toISOString(),
        isCurrent: item.isCurrent,
      };
    }
    throw dataFail();
  });
  const last = items.at(-1);
  const hasMore = row.items.length > request.limit!;
  const nextCursor =
    hasMore && last
      ? Buffer.from(
          JSON.stringify({
            context,
            value:
              last.kind === 'CLASSIFICATION'
                ? last.value
                : last.kind === 'FAMILY'
                  ? last.familyId
                  : last.documentVersionId,
          }),
        ).toString('base64url')
      : null;
  if (nextCursor && nextCursor.length > 8192) throw dataFail();
  const filters: LibraryGraphFilters = {};
  if (request.level !== 'versions')
    for (const key of FILTERS) if (request[key]) filters[key] = request[key];
  const response = {
    scope: 'TENANT_DOCUMENT_CATALOG',
    versionMeaning: 'ALL_READABLE_VERSIONS',
    consistency: 'LIVE_READ',
    relationMeaning: 'CLASSIFICATION_AND_CONTAINMENT_ONLY',
    coverage: {
      documentReferences: 'NOT_INDEXED',
      matterMemberships: 'NOT_LOADED',
    },
    counts,
    limit: request.limit!,
    hasMore,
    nextCursor,
    fileReadPerformed: false,
    modelRunPerformed: false,
    ...(request.level === 'versions'
      ? {
          level: request.level,
          familyId: request.familyId,
          countScope: 'SELECTED_FAMILY_FRESH_READ',
        }
      : request.level === 'families'
        ? {
            level: request.level,
            groupBy: request.groupBy,
            clusterValue: request.clusterValue,
            filters,
            countScope: 'FILTERED_CLUSTER_FAMILIES',
          }
        : {
            level: request.level,
            groupBy: request.groupBy,
            filters,
            countScope: 'FILTERED_FAMILIES',
            clusterCountsOverlap: request.groupBy === 'ata',
          }),
    items,
  } as CanonicalLibraryGraphResponse;
  if (Buffer.byteLength(JSON.stringify(response), 'utf8') > RESPONSE_BUDGET)
    throw dataFail();
  return response;
}
