import {
  suiteGraphSourceEventId,
  type SuiteGraphTimelineEventPins,
} from './suite-graph-timeline';

export interface SuiteGraphReadingState {
  selectedId?: string;
  hiddenGroups?: string[];
  page?: number;
  density?: number;
  relationMode?: 'aggregated' | 'individual';
  layoutMode?: 'reference' | 'force';
  perspective?: 'matter' | 'documents' | 'domain' | 'panorama';
  viewport?: {zoom: number; pan: {x: number; y: number}};
  /** Selected left-column event identity (internal serialized key, never an entry pin). */
  eventId?: string;
  /** Exact saved source identity needed to restore a source event after remount. */
  eventPins?: SuiteGraphTimelineEventPins;
  wikiTab?: 'knowledge' | 'basis' | 'discussion';
}
const text = (value: string, limit = 512) => Boolean(value && value === value.trim() && value.length <= limit && !/[\u0000-\u001f\u007f]/u.test(value));
const single = (params: URLSearchParams, key: string) => params.getAll(key).length === 1 ? params.get(key)! : '';

function validEventPins(value: unknown): value is SuiteGraphTimelineEventPins {
  if (!value || typeof value !== 'object') return false;
  const pins = value as Partial<SuiteGraphTimelineEventPins>;
  return [
    pins.documentVersionId,
    pins.familyId,
    pins.parseRunId,
    pins.runRef,
    pins.statementId,
  ].every((item) => typeof item === 'string' && text(item, 512))
    && Number.isSafeInteger(pins.candidateRevision)
    && pins.candidateRevision! >= 1
    && pins.candidateRevision! <= 999999
    && (pins.anchorId === null
      || (typeof pins.anchorId === 'string' && text(pins.anchorId, 512)));
}

export function graphReadingParams(matterId: string, workRef: string | null, state: SuiteGraphReadingState): URLSearchParams {
  const params = new URLSearchParams({matterId});
  if (workRef) params.set('workRef', workRef);
  if (state.selectedId && text(state.selectedId, 2048)) params.set('selectedId', state.selectedId);
  if (state.hiddenGroups?.length && state.hiddenGroups.length <= 32 && state.hiddenGroups.every(key => text(key, 256))) params.set('hiddenGroups', JSON.stringify([...new Set(state.hiddenGroups)]));
  if (Number.isInteger(state.page) && state.page! >= 0 && state.page! <= 99999) params.set('page', String(state.page));
  if (Number.isInteger(state.density) && state.density! >= 1 && state.density! <= 6) params.set('density', String(state.density));
  if (state.relationMode === 'aggregated' || state.relationMode === 'individual') params.set('relationMode', state.relationMode);
  if (state.layoutMode === 'reference' || state.layoutMode === 'force') params.set('layoutMode', state.layoutMode);
  if (state.perspective && ['matter', 'documents', 'domain', 'panorama'].includes(state.perspective)) params.set('perspective', state.perspective);
  if (state.eventId && text(state.eventId, 2048)) {
    params.set('eventId', state.eventId);
    if (
      validEventPins(state.eventPins)
      && suiteGraphSourceEventId(state.eventPins) === state.eventId
    ) {
      params.set('eventPins', JSON.stringify(state.eventPins));
    }
  }
  if (state.wikiTab && ['knowledge', 'basis', 'discussion'].includes(state.wikiTab)) params.set('wikiTab', state.wikiTab);
  const camera = state.viewport;
  if (camera && Number.isFinite(camera.zoom) && camera.zoom >= .05 && camera.zoom <= 6 && [camera.pan.x, camera.pan.y].every(n => Number.isFinite(n) && Math.abs(n) <= 100000)) params.set('viewport', JSON.stringify(camera));
  return params;
}
export function readGraphReadingState(params: URLSearchParams): SuiteGraphReadingState {
  const state: SuiteGraphReadingState = {};
  const selected = single(params, 'selectedId');
  if (text(selected, 2048)) state.selectedId = selected;
  try {
    const hidden: unknown = JSON.parse(single(params, 'hiddenGroups'));
    if (Array.isArray(hidden) && hidden.length <= 32 && hidden.every(key => typeof key === 'string' && text(key, 256))) state.hiddenGroups = hidden;
  } catch { /* Optional malformed display state is omitted. */ }
  for (const key of ['page', 'density'] as const) {
    const value = single(params, key);
    if (/^\d{1,5}$/.test(value)) state[key] = Number(value);
  }
  const mode = single(params, 'relationMode');
  if (mode === 'aggregated' || mode === 'individual') state.relationMode = mode;
  const layout = single(params, 'layoutMode');
  if (layout === 'reference' || layout === 'force') state.layoutMode = layout;
  const perspective = single(params, 'perspective');
  if (perspective === 'matter' || perspective === 'documents' || perspective === 'domain' || perspective === 'panorama') state.perspective = perspective;
  const eventId = single(params, 'eventId');
  if (text(eventId, 2048)) {
    state.eventId = eventId;
    try {
      const pins: unknown = JSON.parse(single(params, 'eventPins'));
      if (validEventPins(pins) && suiteGraphSourceEventId(pins) === eventId) {
        state.eventPins = pins;
      }
    } catch { /* Optional malformed event pins are omitted. */ }
  }
  const wikiTab = single(params, 'wikiTab');
  if (wikiTab === 'knowledge' || wikiTab === 'basis' || wikiTab === 'discussion') state.wikiTab = wikiTab;
  try {
    const camera = JSON.parse(single(params, 'viewport'));
    if (camera && typeof camera.zoom === 'number' && typeof camera.pan?.x === 'number' && typeof camera.pan?.y === 'number') state.viewport = camera;
  } catch { /* Optional malformed camera is omitted. */ }
  // Roundtrip through the writer applies numeric bounds too.
  const bounded = graphReadingParams('_', null, state);
  if (!bounded.has('viewport')) delete state.viewport;
  if (!bounded.has('page')) delete state.page;
  if (!bounded.has('density')) delete state.density;
  if (state.viewport && !state.layoutMode) state.layoutMode = 'reference';
  return state;
}
export function withGraphReturn(route: string, graphQuery: URLSearchParams): string {
  const queryStart = route.indexOf('?');
  const path = queryStart === -1 ? route : route.slice(0, queryStart);
  const raw = queryStart === -1 ? '' : route.slice(queryStart + 1);
  const match = /^\/(document-versions|matters)\/([^/]+)(\/process)?$/.exec(path);
  const workItemDocumentMatch = /^\/work-items\/([^/]+)\/(?:analysis|documents)$/.exec(path);
  if (!match && !workItemDocumentMatch) return route;
  const params = new URLSearchParams(raw);
  if (workItemDocumentMatch) {
    const documentVersions = params.getAll('documentVersionId');
    if (
      documentVersions.length !== 1
      || !text(documentVersions[0], 512)
    ) return route;
    for (const key of [...params.keys()]) {
      if (key.startsWith('return')) params.delete(key);
    }
    params.set('returnGraphQuery', graphQuery.toString());
    params.set('returnDocumentVersionId', documentVersions[0]);
    return `${path}?${params}`;
  }
  if (!match) return route;
  if (match[1] === 'document-versions' && match[3]) return route;
  for (const key of [...params.keys()]) if (key.startsWith('return')) params.delete(key);
  params.set('returnGraphQuery', graphQuery.toString());
  if (match[1] === 'document-versions') {
    params.set('returnDocumentVersionId', decodeURIComponent(match[2]));
    if (params.get('parseRunId')) params.set('returnGraphParseRunId', params.get('parseRunId')!);
  } else {
    params.set('returnGraphTargetMatterId', decodeURIComponent(match[2]));
    const work = params.get('workRef') || params.get('sourceWorkRef');
    if (work) params.set('returnGraphTargetWorkRef', work);
  }
  return `${path}?${params}`;
}
export function graphReturnTarget(params: URLSearchParams, documentVersionId?: string, requestedRun?: string | null, matterId?: string): {route: string; label: string} | null {
  const keys = ['returnGraphQuery', 'returnDocumentVersionId', 'returnGraphTargetMatterId', 'returnGraphTargetWorkRef', 'returnGraphParseRunId'];
  if (keys.some(key => params.getAll(key).length > 1)) return null;
  const raw = single(params, 'returnGraphQuery');
  if (!raw || raw.length > 12000) return null;
  const doc = single(params, 'returnDocumentVersionId');
  const targetMatter = single(params, 'returnGraphTargetMatterId');
  if (Boolean(doc) === Boolean(targetMatter)) return null;
  if (doc && (doc !== documentVersionId || params.has('returnGraphTargetWorkRef'))) return null;
  if (targetMatter && targetMatter !== matterId) return null;
  const targetWork = single(params, 'returnGraphTargetWorkRef');
  if (targetWork && targetWork !== single(params, 'workRef') && targetWork !== single(params, 'sourceWorkRef')) return null;
  if (params.has('returnGraphParseRunId') && (!doc || single(params, 'returnGraphParseRunId') !== requestedRun)) return null;
  const query = new URLSearchParams(raw);
  const sourceMatter = single(query, 'matterId');
  const sourceWork = single(query, 'workRef');
  if (!text(sourceMatter) || query.getAll('workRef').length > 1 || (query.has('workRef') && !text(sourceWork))) return null;
  return {route: `/graph?${graphReadingParams(sourceMatter, sourceWork || null, readGraphReadingState(query))}`, label: '返回关系图谱'};
}
