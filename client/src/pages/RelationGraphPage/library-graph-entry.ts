import type { CanonicalLibraryGraphRequest, LibraryGraphFilters } from '@shared/library-graph.interface';
export const LIBRARY_GRAPH_ROUTE = '/graph?scope=library';
export const LIBRARY_GRAPH_PAGE_SIZE = 50;
export const LIBRARY_GRAPH_FILTER_KEYS = ['search', 'normalizedFamily', 'ata', 'aircraftModel', 'fleetFamily', 'fleetModel'] as const;
export type LibraryGraphEntry = {kind:'absent'} | {kind:'invalid'} | {kind:'library'; request:CanonicalLibraryGraphRequest};
const validText = (value:string, max:number) => value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
/** Route state is display intent, never a grant. Every page is authorized again by Host. */
export function readLibraryGraphEntry(params:URLSearchParams):LibraryGraphEntry {
  if (!params.has('scope') || !params.getAll('scope').includes('library')) return {kind:'absent'};
  const allowed = new Set(['scope','level','groupBy','clusterValue','clusterMissing','familyId','cursor',
    'selectedId','viewport','layoutSnapshot','displaySession','macroView', ...LIBRARY_GRAPH_FILTER_KEYS]);
  if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1)
    || params.get('scope') !== 'library') return {kind:'invalid'};
  if ([['selectedId',2048],['viewport',256],['layoutSnapshot',64]].some(([key,max]) =>
    params.has(String(key)) && !validText(params.get(String(key))!,Number(max)))) return {kind:'invalid'};
  if (params.has('displaySession') && !/^\d{1,10}$/u.test(params.get('displaySession')!)) return {kind:'invalid'};
  if (params.has('macroView') && params.get('macroView') !== 'network') return {kind:'invalid'};
  const level = params.get('level') ?? 'clusters';
  if (!['clusters','families','versions'].includes(level)) return {kind:'invalid'};
  const cursor = params.get('cursor') ?? undefined;
  if (cursor !== undefined && (!/^[\w-]+$/u.test(cursor) || cursor.length > 8192)) return {kind:'invalid'};
  const page = {limit:LIBRARY_GRAPH_PAGE_SIZE, ...(cursor ? {cursor}: {})};
  if (level === 'versions') {
    const familyId = params.get('familyId');
    if (!familyId?.trim() || !validText(familyId,96)
      || ['groupBy','clusterValue','clusterMissing',...LIBRARY_GRAPH_FILTER_KEYS].some(key => params.has(key))) return {kind:'invalid'};
    return {kind:'library',request:{level:'versions',familyId,...page}};
  }
  const groupBy = params.get('groupBy') ?? 'ata';
  if (!['ata','normalizedFamily'].includes(groupBy) || params.has('familyId')) return {kind:'invalid'};
  const filters:LibraryGraphFilters = {};
  for (const key of LIBRARY_GRAPH_FILTER_KEYS) {
    const raw = params.get(key);
    if (raw === null) continue;
    if (!validText(raw,key === 'search' ? 200 : 96)) return {kind:'invalid'};
    const value = raw.trim();
    if (value) filters[key] = key === 'fleetFamily' || key === 'fleetModel' ? value.toUpperCase() : value;
  }
  if ((filters.fleetModel && !filters.fleetFamily) || (filters.fleetFamily && filters.aircraftModel)) return {kind:'invalid'};
  const group = groupBy as 'ata'|'normalizedFamily';
  if (level === 'families') {
    if (params.has('clusterMissing') === params.has('clusterValue')) return {kind:'invalid'};
    if (params.has('clusterMissing') && params.get('clusterMissing') !== 'true') return {kind:'invalid'};
    const clusterValue = params.has('clusterMissing') ? null : params.get('clusterValue')!;
    if (clusterValue !== null && !validText(clusterValue,96)) return {kind:'invalid'};
    return {kind:'library',request:{level:'families',groupBy:group,clusterValue,...filters,...page}};
  }
  if (params.has('clusterValue') || params.has('clusterMissing')) return {kind:'invalid'};
  return {kind:'library',request:{level:'clusters',groupBy:group,...filters,...page}};
}
