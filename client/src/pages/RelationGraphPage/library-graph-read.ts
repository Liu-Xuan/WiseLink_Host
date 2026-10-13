import type { CanonicalLibraryGraphRequest, CanonicalLibraryGraphResponse } from '@shared/library-graph.interface';
import { LIBRARY_GRAPH_FILTER_KEYS } from './library-graph-route';
import { getCanonicalLibraryGraph } from '@client/src/api/canonical-host';
const safeCount = (n:unknown):n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const text = (n:unknown,max:number,nonempty=false):n is string => typeof n === 'string'
  && n.length <= max && !/[\u0000-\u001f\u007f]/u.test(n) && (!nonempty || Boolean(n.trim()));
/** Fail closed on a wrong-level, unbounded or ambiguous projection. No partial graph is invented. */
export function validateLibraryGraphPage(page:CanonicalLibraryGraphResponse, request:CanonicalLibraryGraphRequest):CanonicalLibraryGraphResponse {
  const fail = () => { throw new Error('LIBRARY_GRAPH_RESPONSE_INVALID'); };
  if (!page || page.scope !== 'TENANT_DOCUMENT_CATALOG' || page.level !== request.level
    || page.versionMeaning !== 'ALL_READABLE_VERSIONS' || page.consistency !== 'LIVE_READ'
    || page.relationMeaning !== 'CLASSIFICATION_AND_CONTAINMENT_ONLY'
    || page.coverage?.documentReferences !== 'NOT_INDEXED' || page.coverage.matterMemberships !== 'NOT_LOADED'
    || page.fileReadPerformed !== false || page.modelRunPerformed !== false
    || page.limit !== (request.limit ?? 50) || !Array.isArray(page.items) || page.items.length > page.limit
    || !safeCount(page.counts?.uniqueFamilyCount) || !safeCount(page.counts.readableVersionCountInMatchingFamilies)
    || typeof page.hasMore !== 'boolean' || (page.hasMore ? !text(page.nextCursor,8192,true) || !/^[\w-]+$/u.test(page.nextCursor!) : page.nextCursor !== null)) fail();
  if (page.hasMore && (!page.items.length || page.nextCursor === request.cursor)) fail();
  if (page.level !== 'versions' && request.level !== 'versions'
    && (!page.filters || LIBRARY_GRAPH_FILTER_KEYS.some(key => (page.filters[key] ?? '') !== (request[key] ?? '')))) fail();
  const ids = new Set<string>();
  if (page.level === 'clusters' && request.level === 'clusters') {
    if (page.groupBy !== request.groupBy || page.countScope !== 'FILTERED_FAMILIES'
      || typeof page.clusterCountsOverlap !== 'boolean') fail();
    for (const item of page.items) {
      if (item.kind !== 'CLASSIFICATION' || !(item.value === null || text(item.value,96))
        || !safeCount(item.uniqueFamilyCount) || !safeCount(item.readableVersionCountInMatchingFamilies)) fail();
      const id = JSON.stringify(item.value); if (ids.has(id)) fail(); ids.add(id);
    }
  } else if (page.level === 'families' && request.level === 'families') {
    if (page.groupBy !== request.groupBy || page.clusterValue !== request.clusterValue || page.countScope !== 'FILTERED_CLUSTER_FAMILIES') fail();
    for (const item of page.items) {
      if (item.kind !== 'FAMILY' || !text(item.familyId,96,true) || !text(item.documentId,96,true)
        || !text(item.documentCode,512) || !text(item.normalizedFamily,96) || !safeCount(item.readableVersionCount)
        || ids.has(item.familyId)) fail(); ids.add(item.familyId);
    }
  } else if (page.level === 'versions' && request.level === 'versions') {
    if (page.familyId !== request.familyId || page.countScope !== 'SELECTED_FAMILY_FRESH_READ') fail();
    for (const item of page.items) {
      if (item.kind !== 'VERSION' || !text(item.documentVersionId,96,true) || !text(item.businessRevision,512)
        || (item.readerWorkItemId !== undefined && !text(item.readerWorkItemId,96,true))
        || !text(item.committedAt,96,true) || typeof item.isCurrent !== 'boolean' || ids.has(item.documentVersionId)) fail();
      ids.add(item.documentVersionId);
    }
  } else fail();
  if (new TextEncoder().encode(JSON.stringify(page)).byteLength > 256 * 1024) fail();
  return page;
}
export async function readLibraryGraphPage(request:CanonicalLibraryGraphRequest,signal:AbortSignal):Promise<CanonicalLibraryGraphResponse> {
  return validateLibraryGraphPage(await getCanonicalLibraryGraph(request,signal),request);
}
