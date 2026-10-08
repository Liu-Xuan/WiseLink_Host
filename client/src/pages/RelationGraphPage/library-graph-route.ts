import type { CanonicalLibraryGraphRequest, LibraryGraphFilters } from '@shared/library-graph.interface';
import { graphReadingParams, readGraphReadingState, type SuiteGraphReadingState } from './suite-graph-return';
import { LIBRARY_GRAPH_FILTER_KEYS } from './library-graph-entry';
export { LIBRARY_GRAPH_ROUTE, LIBRARY_GRAPH_PAGE_SIZE, LIBRARY_GRAPH_FILTER_KEYS, readLibraryGraphEntry, type LibraryGraphEntry } from './library-graph-entry';
export function libraryGraphReadingParams(request:CanonicalLibraryGraphRequest, state:SuiteGraphReadingState = {}, session?:number):URLSearchParams {
  const bounded = graphReadingParams('_',null,{selectedId:state.selectedId,viewport:state.viewport,layoutSnapshot:state.layoutSnapshot});
  if (session !== undefined && Number.isSafeInteger(session) && session >= 0) bounded.set('displaySession',String(session));
  bounded.delete('matterId'); bounded.set('scope','library'); bounded.set('level',request.level);
  if (request.level === 'versions') bounded.set('familyId',request.familyId);
  else {
    bounded.set('groupBy',request.groupBy);
    for (const key of LIBRARY_GRAPH_FILTER_KEYS) if (request[key]) bounded.set(key,request[key]!);
    if (request.level === 'families') {
      if (request.clusterValue === null) bounded.set('clusterMissing','true');
      else bounded.set('clusterValue',request.clusterValue);
    }
  }
  if (request.cursor) bounded.set('cursor',request.cursor);
  return bounded;
}
export function libraryGraphState(params:URLSearchParams):SuiteGraphReadingState {
  const {selectedId,viewport,layoutSnapshot} = readGraphReadingState(params);
  return {selectedId,viewport,layoutSnapshot};
}
export function libraryGraphFilters(request:CanonicalLibraryGraphRequest):LibraryGraphFilters {
  return request.level === 'versions' ? {} : Object.fromEntries(LIBRARY_GRAPH_FILTER_KEYS
    .filter(key => request[key]).map(key => [key,request[key]]));
}
