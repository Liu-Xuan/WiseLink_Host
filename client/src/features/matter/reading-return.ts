import { graphReturnTarget } from '@client/src/pages/RelationGraphPage/suite-graph-return';
import {
  normalizedEngineeringIssueReadingParams,
} from './engineering-issue-reading';
import { parseSituationReadingQuery } from '../trinity/situation-reading';
const LIBRARY_FILTERS = [
  'familyId',
  'search',
  'normalizedFamily',
  'ata',
  'aircraftModel',
  'fleetFamily',
  'fleetModel',
] as const;

/** URL-only read state; never accept an arbitrary return URL or a write intent. */
export function knowledgeReadingIdentity(params: URLSearchParams):
  | { state: 'absent' | 'invalid' }
  | { state: 'ok'; identity: { subjectKind: 'WORK_ITEM' | 'ENGINEERING_MATTER'; subjectId: string; workRef: string } } {
  const keys = ['subjectKind', 'subjectId', 'workRef'];
  if (keys.every(key => !params.has(key))) return { state: 'absent' };
  if (keys.some(key => params.getAll(key).length !== 1)) return { state: 'invalid' };
  const subjectKind = params.get('subjectKind');
  const subjectId = params.get('subjectId') ?? '', workRef = params.get('workRef') ?? '';
  if ((subjectKind !== 'WORK_ITEM' && subjectKind !== 'ENGINEERING_MATTER') ||
    [subjectId, workRef].some(value => !value.trim() || value !== value.trim() || value.length > 255 || /[\u0000-\u001f\u007f]/u.test(value)))
    return { state: 'invalid' };
  return { state: 'ok', identity: { subjectKind, subjectId, workRef } };
}

export function knowledgeReadingParams(params: URLSearchParams): URLSearchParams {
  const result = new URLSearchParams();
  for (const key of ['query', 'subjectKind', 'subjectId', 'workRef', 'scope', 'kind', 'after', 'listY', 'articleY']) {
    if (params.getAll(key).length !== 1) continue;
    const value = params.get(key) ?? '';
    const limit = key === 'after' ? 2400 : key === 'query' ? 200 : 255;
    if (value.length > limit || /[\u0000-\u001f\u007f]/u.test(value)) continue;
    if (key === 'scope' && !['CURRENT', 'ALL', 'HISTORICAL'].includes(value)) continue;
    if (key === 'kind' && !['works', 'sources'].includes(value)) continue;
    if (key === 'subjectKind' && !['WORK_ITEM', 'ENGINEERING_MATTER'].includes(value)) continue;
    if ((key === 'listY' || key === 'articleY') && !/^\d{1,7}$/.test(value)) continue;
    if (value) result.set(key, value);
  }
  result.sort();
  return result;
}

function identifier(value: string | null): string {
  const text = value?.trim() ?? '';
  return text.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(text) ? text : '';
}

/** Read-only directory state, never arbitrary URLs or write-intent parameters. */
export function libraryReadingParams(params: URLSearchParams): URLSearchParams {
  const requestedMode = params.getAll('mode').length === 1 ? params.get('mode') : null;
  const mode = requestedMode === 'matter' || requestedMode === 'tasks'
    ? requestedMode : 'document';
  const result = new URLSearchParams({ mode });
  for (const key of LIBRARY_FILTERS) {
    if (params.getAll(key).length !== 1) continue;
    const value = identifier(params.get(key));
    if (value) result.set(key, value);
  }
  const selectionKey = mode === 'matter' ? 'selectedMatterId'
    : mode === 'document' ? 'selectedDocumentVersionId' : null;
  if (selectionKey && params.getAll(selectionKey).length === 1) {
    const value = identifier(params.get(selectionKey));
    if (value) result.set(selectionKey, value);
  }
  if ((mode === 'matter' || mode === 'tasks') && params.getAll('workItemId').length === 1) {
    const value = identifier(params.get('workItemId'));
    if (value) result.set('workItemId', value);
  }
  if (mode === 'document' && params.getAll('expandedFamilyIds').length === 1) {
    const raw = params.get('expandedFamilyIds') ?? '';
    const families = raw.split(',');
    if (raw.length <= 2048 && families.length <= 32 &&
      families.every(value => value && identifier(value) === value))
      result.set('expandedFamilyIds', [...new Set(families)].sort().join(','));
  }
  if (params.getAll('density').length === 1 && params.get('density') === 'compact')
    result.set('density', 'compact');
  for (const key of ['listY', 'quicklookY']) {
    const value = params.get(key) ?? '';
    if (params.getAll(key).length === 1 && /^\d{1,7}$/.test(value)) result.set(key, value);
  }
  if (params.get('catalogView') === 'tree') result.set('catalogView', 'tree');
  if (params.get('grouping') === 'ata' || params.get('grouping') === 'aircraft')
    result.set('grouping', params.get('grouping')!);
  result.sort();
  return result;
}

export function libraryReadingScope(params: URLSearchParams): string {
  const state = libraryReadingParams(params);
  state.delete('listY');
  state.delete('quicklookY');
  return `library:${state.toString()}`;
}

export function libraryDocumentReadingRoute(
  documentVersionId: string,
  params: URLSearchParams,
): string {
  const query = new URLSearchParams({
    returnDocumentVersionId: documentVersionId,
    returnLibraryQuery: libraryReadingParams(params).toString(),
  });
  return `/document-versions/${encodeURIComponent(documentVersionId)}?${query}`;
}

function directDocumentReadingRoute(documentVersionId: string,
  returnKey: 'returnWorkItemId', workItemId: string,
  unboundEvidence = false): string {
  const version = identifier(documentVersionId), workItem = identifier(workItemId);
  if (!version || !workItem)
    throw new Error('DOCUMENT_READING_ROUTE_IDENTITY_INVALID');
  const query = new URLSearchParams({ [returnKey]: workItem });
  if (unboundEvidence) query.set('unboundEvidence', '1');
  return `/document-versions/${encodeURIComponent(version)}?${query}`;
}

export function libraryTaskDocumentReadingRoute(documentVersionId: string,
  workItemId: string, params: URLSearchParams,
  unboundEvidence = false): string {
  const version = identifier(documentVersionId), workItem = identifier(workItemId);
  if (!version || !workItem) throw new Error('DOCUMENT_READING_ROUTE_IDENTITY_INVALID');
  const state = new URLSearchParams(params);
  state.set('mode', 'tasks'); state.set('workItemId', workItem);
  const query = new URLSearchParams({ returnDocumentVersionId: version,
    returnLibraryQuery: libraryReadingParams(state).toString() });
  if (unboundEvidence) query.set('unboundEvidence', '1');
  return `/document-versions/${encodeURIComponent(version)}?${query}`;
}

export function workItemDocumentReadingRoute(documentVersionId: string,
  workItemId: string, unboundEvidence = false): string {
  return directDocumentReadingRoute(documentVersionId, 'returnWorkItemId', workItemId,
    unboundEvidence);
}

/** Bind directory return to the matter being opened, never an arbitrary destination. */
export function libraryMatterReadingRoute(
  matterId: string,
  params: URLSearchParams,
): string {
  const state = new URLSearchParams(params);
  state.set('mode', 'matter');
  state.set('selectedMatterId', matterId);
  const query = new URLSearchParams({
    returnLibraryMatterId: matterId,
    returnLibraryQuery: libraryReadingParams(state).toString(),
  });
  return `/matters/${encodeURIComponent(matterId)}?${query}`;
}

const REVISION_SIDE_KEYS = ['before', 'after', 'roleKey'] as const;
const REVISION_RUN_KEYS = ['beforeParseRun', 'afterParseRun'] as const;
const REVISION_SEMANTIC_KEYS = [
  'beforeSemanticRevision',
  'afterSemanticRevision',
] as const;

/** Positive safe integer; rejects signs, decimals, non-digits, zero and values above Number.MAX_SAFE_INTEGER. No fixed-width truncation. */
export function parsePositiveSafeInteger(raw: string): number | null {
  if (!/^\d+$/u.test(raw)) return null;
  if (raw.length > 16) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export type RevisionTextPin =
  | { state: 'absent' | 'duplicate' | 'empty' | 'invalid' }
  | { state: 'ok'; value: string };

export type RevisionSemanticPin =
  | { state: 'absent' | 'duplicate' | 'empty' | 'invalid' }
  | { state: 'ok'; value: number };

/** One identity text field; distinguishes unspecified, duplicate, empty and illegal. */
export function revisionTextPin(
  params: URLSearchParams,
  key: string,
): RevisionTextPin {
  const all = params.getAll(key);
  if (all.length === 0) return { state: 'absent' };
  if (all.length > 1) return { state: 'duplicate' };
  const raw = all[0].trim();
  if (raw === '') return { state: 'empty' };
  const value = identifier(all[0]);
  return value ? { state: 'ok', value } : { state: 'invalid' };
}

/** One semantic-revision field; a legal value is a positive safe integer. */
export function revisionSemanticPin(
  params: URLSearchParams,
  key: string,
): RevisionSemanticPin {
  const all = params.getAll(key);
  if (all.length === 0) return { state: 'absent' };
  if (all.length > 1) return { state: 'duplicate' };
  const raw = all[0].trim();
  if (raw === '') return { state: 'empty' };
  const value = parsePositiveSafeInteger(raw);
  return value === null ? { state: 'invalid' } : { state: 'ok', value };
}

function singleToken(params: URLSearchParams, key: string): string | null {
  const pin = revisionTextPin(params, key);
  return pin.state === 'ok' ? pin.value : null;
}

function singleSemanticToken(
  params: URLSearchParams,
  key: string,
): string | null {
  const pin = revisionSemanticPin(params, key);
  return pin.state === 'ok' ? String(pin.value) : null;
}

/** Normalized revision-comparison identity; only exact Host identities, never arbitrary URLs. Duplicate or illegal pins are dropped, never repaired. */
export function revisionReadingParams(params: URLSearchParams): URLSearchParams {
  const result = new URLSearchParams();
  for (const key of REVISION_SIDE_KEYS) {
    const value = singleToken(params, key);
    if (value) result.set(key, value);
  }
  const focusSide = params.getAll('focusSide');
  if (
    focusSide.length === 1 &&
    (focusSide[0] === 'before' || focusSide[0] === 'after')
  )
    result.set('focusSide', focusSide[0]);
  for (const key of REVISION_RUN_KEYS) {
    const value = singleToken(params, key);
    if (value) result.set(key, value);
  }
  for (const key of REVISION_SEMANTIC_KEYS) {
    const value = singleSemanticToken(params, key);
    if (value) result.set(key, value);
  }
  const returnLibraryQuery = params.getAll('returnLibraryQuery');
  if (returnLibraryQuery.length === 1 && returnLibraryQuery[0]) {
    const normalized = libraryReadingParams(
      new URLSearchParams(returnLibraryQuery[0]),
    ).toString();
    if (normalized) result.set('returnLibraryQuery', normalized);
  }
  result.sort();
  return result;
}

export interface RevisionPinTriple {
  dv: string;
  run: string;
  semanticRevision: number;
}

/** Both ends fully pinned, legal and distinct; null when any pin is absent, empty, illegal, duplicated or the ends collide. */
export function completeRevisionPins(
  params: URLSearchParams,
): { before: RevisionPinTriple; after: RevisionPinTriple } | null {
  const beforeDv = revisionTextPin(params, 'before');
  const afterDv = revisionTextPin(params, 'after');
  const beforeRun = revisionTextPin(params, 'beforeParseRun');
  const afterRun = revisionTextPin(params, 'afterParseRun');
  const beforeSem = revisionSemanticPin(params, 'beforeSemanticRevision');
  const afterSem = revisionSemanticPin(params, 'afterSemanticRevision');
  if (
    beforeDv.state !== 'ok' ||
    afterDv.state !== 'ok' ||
    beforeRun.state !== 'ok' ||
    afterRun.state !== 'ok' ||
    beforeSem.state !== 'ok' ||
    afterSem.state !== 'ok'
  )
    return null;
  if (beforeDv.value === afterDv.value) return null;
  if (beforeRun.value === afterRun.value) return null;
  return {
    before: {
      dv: beforeDv.value,
      run: beforeRun.value,
      semanticRevision: beforeSem.value,
    },
    after: {
      dv: afterDv.value,
      run: afterRun.value,
      semanticRevision: afterSem.value,
    },
  };
}

export function revisionReadingReturnParams(
  revisionQuery: string,
  side: 'before' | 'after',
  documentVersionId: string,
): URLSearchParams {
  return new URLSearchParams({
    returnDocumentVersionId: documentVersionId,
    returnRevisionQuery: revisionQuery,
    returnRevisionSide: side,
  });
}

const ACTIVITY_TEXT_KEYS = ['parseRunId', 'runRef', 'statementId', 'anchor'] as const;
const ACTIVITY_WINDOW_VALUES = ['all', 'current-year'] as const;
const ACTIVITY_RETURN_QUERY_LIMIT = 4096;
// A graph query is bounded to 12,000 decoded characters by graphReturnTarget.
// Nesting that query inside returnActivityQuery percent-encodes it once more.
const ACTIVITY_WITH_GRAPH_RETURN_QUERY_LIMIT = 50_000;
// One activities reader layer may wrap a bounded timeline query which itself owns
// the already bounded graph return. This is not a general recursive return format.
const ACTIVITY_READER_RETURN_QUERY_LIMIT = 120_000;

export type ActivityWindowPin =
  | { state: 'absent' | 'duplicate' | 'empty' | 'invalid' }
  | { state: 'ok'; value: (typeof ACTIVITY_WINDOW_VALUES)[number] };

/** Controlled timeline window: single occurrence, whitelist-only; anything else is rejected, never repaired. */
export function activityWindowPin(params: URLSearchParams): ActivityWindowPin {
  const pin = revisionTextPin(params, 'window');
  if (pin.state !== 'ok') return { state: pin.state };
  const value = pin.value as (typeof ACTIVITY_WINDOW_VALUES)[number];
  return ACTIVITY_WINDOW_VALUES.includes(value)
    ? { state: 'ok', value }
    : { state: 'invalid' };
}

export interface ActivityPinSet {
  parseRunId: string;
  candidateRevision: number;
  runRef: string;
  statementId: string;
}

/** Normalized activity-reading identity; only exact Host pins plus the controlled library return context survive. Illegal or duplicated pins are dropped, never repaired. */
export function activityReadingParams(params: URLSearchParams): URLSearchParams {
  const result = new URLSearchParams();
  for (const key of ACTIVITY_TEXT_KEYS) {
    const value = singleToken(params, key);
    if (value) result.set(key, value);
  }
  const candidateRevision = singleSemanticToken(params, 'candidateRevision');
  if (candidateRevision) result.set('candidateRevision', candidateRevision);
  const window = activityWindowPin(params);
  if (window.state === 'ok') result.set('window', window.value);
  const returnLibraryQuery = params.getAll('returnLibraryQuery');
  if (returnLibraryQuery.length === 1 && returnLibraryQuery[0]) {
    const normalized = libraryReadingParams(
      new URLSearchParams(returnLibraryQuery[0]),
    ).toString();
    if (normalized) result.set('returnLibraryQuery', normalized);
  }
  const documentVersionId = singleToken(params, 'documentVersionId');
  const requestedRun = singleToken(params, 'parseRunId');
  const hasCompetingReturnIntent = [
    'returnMatterId',
    'returnKnowledgeQuery',
    'returnLibraryQuery',
    'returnRevisionQuery',
    'returnActivityQuery',
    'returnLibraryWorkItemId',
    'returnWorkItemId',
  ].some((key) => params.has(key));
  if (
    documentVersionId &&
    !hasCompetingReturnIntent &&
    params.has('returnGraphQuery') &&
    graphReturnTarget(params, documentVersionId, requestedRun)
  ) {
    result.set('returnGraphQuery', params.get('returnGraphQuery')!);
    for (const key of [
      'returnDocumentVersionId',
      'returnGraphParseRunId',
    ] as const) {
      const value = singleToken(params, key);
      if (value) result.set(key, value);
    }
  }
  result.sort();
  return result;
}

const ACTIVITY_PARENT_RETURN_KEYS = new Set([
  'returnGraphQuery',
  'returnDocumentVersionId',
  'returnGraphParseRunId',
  'returnLibraryQuery',
]);

/**
 * Activity-reader state may retain one exact timeline/activity-graph parent. The
 * parent is bound to the same saved candidate and cannot contain another activity
 * return, a write intent, or an arbitrary destination.
 */
export function activityReaderParams(
  params: URLSearchParams,
  documentVersionId: string,
): URLSearchParams {
  const result = activityReadingParams(params);
  const rawQueries = params.getAll('returnActivityQuery');
  const rawViews = params.getAll('returnActivityView');
  if (rawQueries.length === 0 && rawViews.length === 0) return result;
  if (rawQueries.length !== 1 || rawViews.length !== 1) return result;
  const view = rawViews[0];
  const raw = rawQueries[0];
  if (
    (view !== 'timeline' && view !== 'graph')
    || !raw
    || raw.length > ACTIVITY_WITH_GRAPH_RETURN_QUERY_LIMIT
  ) return result;
  const current = completeActivityIdentity(params);
  if (!current) return result;
  const parent = new URLSearchParams(raw);
  if (
    [...parent.keys()].some(
      (key) => key.startsWith('return')
        && !ACTIVITY_PARENT_RETURN_KEYS.has(key),
    )
    || parent.getAll('documentVersionId').length !== 1
    || parent.get('documentVersionId') !== documentVersionId
  ) return result;
  const parentIdentity = completeActivityIdentity(parent);
  if (
    !parentIdentity
    || parentIdentity.parseRunId !== current.parseRunId
    || parentIdentity.candidateRevision !== current.candidateRevision
    || parentIdentity.runRef !== current.runRef
  ) return result;
  const normalizedParent = activityReadingParams(parent);
  normalizedParent.set('documentVersionId', documentVersionId);
  if (
    parent.has('returnGraphQuery')
    && !normalizedParent.has('returnGraphQuery')
  ) return result;
  result.set('returnActivityQuery', normalizedParent.toString());
  result.set('returnActivityView', view);
  result.set('returnDocumentVersionId', documentVersionId);
  result.sort();
  return result;
}

/**
 * Return identity for an activity reading entry: the document version comes from the
 * route, and parseRunId, candidateRevision and runRef must all be present and legal.
 * statementId and anchor are optional; any explicit bad, duplicated or empty value
 * rejects the whole selection instead of being silently dropped.
 */
export function completeActivityIdentity(
  params: URLSearchParams,
): ActivityIdentityPins | null {
  const parseRunId = revisionTextPin(params, 'parseRunId');
  const candidateRevision = revisionSemanticPin(params, 'candidateRevision');
  const runRef = revisionTextPin(params, 'runRef');
  const statementId = revisionTextPin(params, 'statementId');
  const anchor = revisionTextPin(params, 'anchor');
  const libraryQuery = revisionTextPin(params, 'returnLibraryQuery');
  const window = activityWindowPin(params);
  if (
    parseRunId.state !== 'ok' ||
    candidateRevision.state !== 'ok' ||
    runRef.state !== 'ok' ||
    (statementId.state !== 'ok' && statementId.state !== 'absent') ||
    (anchor.state !== 'ok' && anchor.state !== 'absent') ||
    (libraryQuery.state !== 'ok' && libraryQuery.state !== 'absent') ||
    (window.state !== 'ok' && window.state !== 'absent')
  )
    return null;
  return {
    parseRunId: parseRunId.value,
    candidateRevision: candidateRevision.value,
    runRef: runRef.value,
    statementId: statementId.state === 'ok' ? statementId.value : null,
    anchor: anchor.state === 'ok' ? anchor.value : null,
    window: window.state === 'ok' ? window.value : null,
  };
}

export interface ActivityIdentityPins {
  parseRunId: string;
  candidateRevision: number;
  runRef: string;
  statementId: string | null;
  anchor: string | null;
  window: 'all' | 'current-year' | null;
}

/** The four exact pins of an activity reading entry (selections are optional there). */
export function completeActivityPins(
  params: URLSearchParams,
): ActivityPinSet | null {
  const parseRunId = revisionTextPin(params, 'parseRunId');
  const candidateRevision = revisionSemanticPin(params, 'candidateRevision');
  const runRef = revisionTextPin(params, 'runRef');
  const statementId = revisionTextPin(params, 'statementId');
  if (
    parseRunId.state !== 'ok' ||
    candidateRevision.state !== 'ok' ||
    runRef.state !== 'ok' ||
    statementId.state !== 'ok'
  )
    return null;
  return {
    parseRunId: parseRunId.value,
    candidateRevision: candidateRevision.value,
    runRef: runRef.value,
    statementId: statementId.value,
  };
}

export function activityReadingReturnParams(
  activityQuery: string,
  documentVersionId: string,
  view: 'activities' | 'timeline' | 'graph' = 'activities',
): URLSearchParams {
  const params = new URLSearchParams({
    returnDocumentVersionId: documentVersionId,
    returnActivityQuery: activityQuery,
  });
  if (view !== 'activities') params.set('returnActivityView', view);
  return params;
}

export function matterReadingReturnParams(
  matterId: string,
  documentVersionId: string,
  panel: string,
  workRef = '',
  directoryContext?: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams({
    returnMatterId: matterId,
    returnDocumentVersionId: documentVersionId,
  });
  if (panel === 'review' || panel === 'materials')
    params.set('returnMatterPanel', panel);
  if (workRef) params.set('returnMatterWorkRef', workRef);
  if (directoryContext?.has('returnLibraryMatterId') &&
    readingReturnTarget(directoryContext, undefined, null, matterId)) {
    params.set('returnMatterLibraryQuery', libraryReadingParams(
      new URLSearchParams(directoryContext.get('returnLibraryQuery')!),
    ).toString());
  }
  if (directoryContext?.has('returnGraphQuery') && graphReturnTarget(directoryContext, undefined, null, matterId)) {
    params.set('returnMatterGraphQuery', directoryContext.get('returnGraphQuery')!);
  }
  if (panel === 'materials' && !workRef && directoryContext) {
    const hasIssueState = [
      'issueSearchQuery',
      'issueSearchScope',
      'issueSubjectKind',
      'issueSubjectId',
      'issueWorkRef',
      'issueKey',
    ].some((key) => directoryContext.has(key));
    if (hasIssueState) {
      const issueState = normalizedEngineeringIssueReadingParams(directoryContext);
      if (issueState) params.set('returnMatterIssueQuery', issueState.toString());
    } else {
      const sourceWorkRef = singleToken(directoryContext, 'sourceWorkRef');
      const sourceIssueKey = singleToken(directoryContext, 'sourceIssueKey');
      if (sourceWorkRef && sourceIssueKey) {
        const legacyState = normalizedEngineeringIssueReadingParams(
          new URLSearchParams({
            issueSearchScope: 'CURRENT',
            issueSubjectKind: 'ENGINEERING_MATTER',
            issueSubjectId: matterId,
            issueWorkRef: sourceWorkRef,
            issueKey: sourceIssueKey,
          }),
        );
        if (legacyState) {
          params.set('returnMatterIssueQuery', legacyState.toString());
        }
      }
    }
  }
  return params;
}

/** Global Library exit from an exact Matter graph; never an arbitrary URL. */
export function libraryGraphReturnRoute(graphQuery: URLSearchParams): string {
  const raw = graphQuery.toString();
  // Retain a rejected intent explicitly instead of falling back to a current graph.
  return `/library?${new URLSearchParams({ returnLibraryGraphQuery: raw.length <= 12000 ? raw : '' })}`;
}

function libraryGraphReturnTarget(params: URLSearchParams, pathname?: string): { route: string; label: string } | null {
  if (pathname !== '/library' || params.getAll('returnLibraryGraphQuery').length !== 1 ||
    [...params.keys()].some(key => key.startsWith('return') && key !== 'returnLibraryGraphQuery')) return null;
  const raw = params.get('returnLibraryGraphQuery')!;
  if (!raw || raw.length > 12000) return null;
  const graph = new URLSearchParams(raw);
  const matterId = graph.get('matterId') ?? '';
  const workRef = graph.get('workRef');
  // A document/work-item graph cannot be silently converted to a Matter graph.
  if (['workItemId', 'documentVersionId', 'sourceWorkRef'].some(key => graph.has(key))) return null;
  const bound = new URLSearchParams({ returnGraphQuery: raw, returnGraphTargetMatterId: matterId });
  if (workRef !== null) {
    bound.set('workRef', workRef);
    bound.set('returnGraphTargetWorkRef', workRef);
  }
  return graphReturnTarget(bound, undefined, null, matterId);
}

export function readingReturnTarget(
  params: URLSearchParams,
  documentVersionId?: string,
  requestedRun?: string | null,
  currentMatterId?: string,
  currentWorkRef?: string,
  currentPathname?: string,
): { route: string; label: string } | null {
  if (params.has('returnLibraryGraphQuery')) return libraryGraphReturnTarget(params, currentPathname);
  const keys = [
    'returnSituationQuery',
    'returnGraphQuery',
    'returnMatterId',
    'returnKnowledgeQuery',
    'returnLibraryQuery',
    'returnRevisionQuery',
    'returnActivityQuery',
    'returnLibraryWorkItemId',
    'returnWorkItemId',
  ];
  if (keys.filter((key) => params.has(key)).length > 1) return null;
  if (
    [
      ...keys,
      'returnMatterWorkRef',
      'returnLibraryMatterId',
      'returnMatterLibraryQuery',
      'returnMatterGraphQuery',
      'returnMatterIssueQuery',
      'returnSituationMatterId',
      'returnSituationWorkRef',
      'returnDocumentVersionId',
      'returnRevisionSide',
      'returnActivityQuery',
      'returnActivityView',
    ].some((key) => params.getAll(key).length > 1)
  )
    return null;
  if (params.has('returnSituationQuery')) {
    const allowedSituationReturnKeys = new Set([
      'returnSituationQuery',
      'returnSituationMatterId',
      'returnSituationWorkRef',
      'returnDocumentVersionId',
    ]);
    if ([...params.keys()].some((key) =>
      key.startsWith('return') && !allowedSituationReturnKeys.has(key))) {
      return null;
    }
    const raw = params.get('returnSituationQuery');
    const matterId = identifier(params.get('returnSituationMatterId'));
    const workRef = identifier(params.get('returnSituationWorkRef'));
    const binding = identifier(params.get('returnDocumentVersionId'));
    if (raw === null || !matterId || !parseSituationReadingQuery(raw)) return null;
    if (params.has('returnSituationWorkRef') && !workRef) return null;
    if (params.has('returnDocumentVersionId')) {
      if (workRef || documentVersionId === undefined ||
        !binding || binding !== documentVersionId) return null;
    } else if (!currentMatterId || matterId !== currentMatterId ||
      (workRef && workRef !== currentWorkRef)) {
      return null;
    }
    if (workRef) {
      const routeWorkRefs = params.getAll('workRef');
      if (routeWorkRefs.length !== 1 ||
        identifier(routeWorkRefs[0]) !== workRef) return null;
    }
    const state = parseSituationReadingQuery(raw)!;
    return {
      route: `/matters/${encodeURIComponent(matterId)}/posture${
        state.size ? `?${state.toString()}` : ''
      }`,
      label: '返回当前工程态势',
    };
  }
  if (['returnSituationMatterId', 'returnSituationWorkRef'].some(
    (key) => params.has(key),
  )) return null;
  if (params.has('returnGraphQuery')) return graphReturnTarget(params, documentVersionId, requestedRun, currentMatterId);
  if (['returnGraphTargetMatterId', 'returnGraphTargetWorkRef', 'returnGraphParseRunId'].some(key => params.has(key))) return null;
  if (params.has('returnActivityView') && !params.has('returnActivityQuery')) return null;
  if (params.has('returnMatterGraphQuery') && (!params.has('returnMatterId') || params.has('returnMatterLibraryQuery'))) return null;
  if (params.has('returnMatterLibraryQuery') && !params.has('returnMatterId')) return null;
  if (params.has('returnMatterIssueQuery') && !params.has('returnMatterId')) return null;
  if (params.has('returnLibraryMatterId')) {
    const boundMatter = identifier(params.get('returnLibraryMatterId'));
    const raw = params.get('returnLibraryQuery');
    if (!boundMatter || boundMatter !== currentMatterId || !raw || raw.length > 4096 ||
      params.has('returnDocumentVersionId') || params.has('returnMatterWorkRef')) return null;
    const state = new URLSearchParams(raw);
    if (state.getAll('mode').length !== 1 || state.get('mode') !== 'matter' ||
      state.getAll('selectedMatterId').length !== 1 || state.get('selectedMatterId') !== boundMatter) return null;
    return { route: `/library?${libraryReadingParams(state)}`, label: '返回原事项目录' };
  }
  const binding = identifier(params.get('returnDocumentVersionId'));
  if (
    params.has('returnDocumentVersionId') &&
    (!binding ||
      (documentVersionId !== undefined && binding !== documentVersionId))
  )
    return null;
  const matterId = identifier(params.get('returnMatterId'));
  if (params.has('returnKnowledgeQuery')) {
    const query = params.get('returnKnowledgeQuery');
    if (!query || query.length > 4096) return null;
    const nested = new URLSearchParams(query);
    const identity = knowledgeReadingIdentity(nested);
    if (identity.state === 'invalid') return null;
    if (!binding) {
      // A graph return is bound to the exact saved matter work, not a document.
      if (documentVersionId !== undefined || identity.state !== 'ok' ||
        identity.identity.subjectKind !== 'ENGINEERING_MATTER' ||
        identity.identity.subjectId !== currentMatterId ||
        identity.identity.workRef !== currentWorkRef ||
        params.getAll('matterId').length !== 1 || params.get('matterId') !== currentMatterId ||
        params.getAll('workRef').length !== 1 || params.get('workRef') !== currentWorkRef ||
        [...params.keys()].some(key => key.startsWith('return') && key !== 'returnKnowledgeQuery')) return null;
    }
    return { route: `/knowledge?${knowledgeReadingParams(nested)}`, label: '返回工程知识' };
  }
  if (matterId) {
    const panel = params.get('returnMatterPanel');
    const workRef = identifier(params.get('returnMatterWorkRef'));
    if (params.has('returnMatterWorkRef') && !workRef) return null;
    const query = new URLSearchParams();
    if (workRef) query.set('workRef', workRef);
    else if (panel === 'review' || panel === 'materials')
      query.set('panel', panel);
    if (params.has('returnMatterLibraryQuery')) {
      const raw = params.get('returnMatterLibraryQuery');
      if (!raw || raw.length > 4096) return null;
      const nested = new URLSearchParams(raw);
      if (nested.getAll('mode').length !== 1 || nested.get('mode') !== 'matter' ||
        nested.getAll('selectedMatterId').length !== 1 || nested.get('selectedMatterId') !== matterId) return null;
      query.set('returnLibraryMatterId', matterId);
      query.set('returnLibraryQuery', libraryReadingParams(nested).toString());
    }
    if (params.has('returnMatterGraphQuery')) {
      const raw = params.get('returnMatterGraphQuery')!;
      if (workRef) query.set('workRef', workRef);
      query.set('returnGraphQuery', raw);
      query.set('returnGraphTargetMatterId', matterId);
      if (workRef) query.set('returnGraphTargetWorkRef', workRef);
      if (!graphReturnTarget(query, undefined, null, matterId)) return null;
    }
    if (params.has('returnMatterIssueQuery')) {
      if (workRef || panel !== 'materials') return null;
      const raw = params.get('returnMatterIssueQuery');
      if (!raw || raw.length > 4096) return null;
      const rawIssueState = new URLSearchParams(raw);
      if ([...rawIssueState.keys()].some((key) => key.startsWith('return'))) {
        return null;
      }
      const issueState = normalizedEngineeringIssueReadingParams(
        rawIssueState,
      );
      if (!issueState) return null;
      issueState.forEach((value, key) => query.set(key, value));
    }
    return {
      route: `/matters/${encodeURIComponent(matterId)}${query.size ? `?${query}` : ''}`,
      label: workRef
        ? '返回原工作简报'
        : panel === 'review'
          ? '返回事项讨论'
          : panel === 'materials'
            ? '返回关联资料'
            : '返回事项简报',
    };
  }
  if (params.has('returnLibraryQuery')) {
    if (
      !binding ||
      !params.get('returnLibraryQuery') ||
      params.get('returnLibraryQuery')!.length > 4096
    )
      return null;
    return {
      route: `/library?${libraryReadingParams(new URLSearchParams(params.get('returnLibraryQuery')!))}`,
      label: new URLSearchParams(params.get('returnLibraryQuery')!).get('mode') === 'matter'
        ? '返回原事项目录'
        : new URLSearchParams(params.get('returnLibraryQuery')!).get('mode') === 'tasks'
          ? '返回任务快览' : '返回原文档目录',
    };
  }
  if (params.has('returnRevisionQuery')) {
    const side = params.get('returnRevisionSide');
    const revisionQuery = params.get('returnRevisionQuery');
    if (!binding || !revisionQuery || revisionQuery.length > 4096) return null;
    if (side !== 'before' && side !== 'after') return null;
    const nested = new URLSearchParams(revisionQuery);
    const pins = completeRevisionPins(nested);
    if (!pins) return null;
    if (nested.getAll('roleKey').length > 1) return null;
    const sidePin = side === 'before' ? pins.before : pins.after;
    if (sidePin.dv !== binding) return null;
    if (requestedRun && sidePin.run !== requestedRun) return null;
    const query = revisionReadingParams(nested);
    query.set('focusSide', side);
    return {
      route: `/document-revisions?${query.toString()}`,
      label: '返回改版比较',
    };
  }
  if (params.has('returnActivityQuery')) {
    const activityQuery = params.get('returnActivityQuery');
    if (!binding || !activityQuery) return null;
    const nested = new URLSearchParams(activityQuery);
    const graphValidation = new URLSearchParams(nested);
    graphValidation.set('documentVersionId', binding);
    const nestedRun = singleToken(nested, 'parseRunId');
    const hasValidGraphReturn = Boolean(
      nested.has('returnGraphQuery') &&
      graphReturnTarget(graphValidation, binding, nestedRun),
    );
    const hasReaderParent = params.get('returnActivityView') === null
      && nested.getAll('returnActivityQuery').length === 1
      && nested.getAll('returnActivityView').length === 1
      && activityReaderParams(nested, binding).has('returnActivityQuery');
    const activityLimit = hasReaderParent
      ? ACTIVITY_READER_RETURN_QUERY_LIMIT
      : hasValidGraphReturn
        ? ACTIVITY_WITH_GRAPH_RETURN_QUERY_LIMIT
        : ACTIVITY_RETURN_QUERY_LIMIT;
    if (activityQuery.length > activityLimit) return null;
    if (
      (!hasReaderParent && (
        nested.has('returnActivityQuery')
        || nested.has('returnActivityView')
      )) ||
      nested.has('returnRevisionQuery') ||
      nested.has('returnMatterId') ||
      nested.has('returnLibraryWorkItemId') ||
      nested.has('returnWorkItemId')
    )
      return null;
    const pins = completeActivityIdentity(nested);
    if (!pins) return null;
    if (requestedRun && pins.parseRunId !== requestedRun) return null;
    const view = params.get('returnActivityView');
    if (view !== null && view !== 'timeline' && view !== 'graph') return null;
    const normalizedSource = new URLSearchParams(nested);
    normalizedSource.set('documentVersionId', binding);
    const query = hasReaderParent
      ? activityReaderParams(normalizedSource, binding)
      : activityReadingParams(normalizedSource);
    if (view) {
      query.set('documentVersionId', binding);
      return {
        route: `${view === 'timeline' ? '/timeline' : '/activity-graph'}?${query.toString()}`,
        label: view === 'timeline' ? '返回工程时间轴' : '返回声明关系图',
      };
    }
    return {
      route: `/document-versions/${encodeURIComponent(binding)}/activities?${query.toString()}`,
      label: '返回活动阅读',
    };
  }
  const libraryWorkItemId = identifier(params.get('returnLibraryWorkItemId'));
  if (libraryWorkItemId)
    return {
      route: `/library?${new URLSearchParams({ mode: 'tasks', workItemId: libraryWorkItemId })}`,
      label: '返回任务快览',
    };
  const workItemId = identifier(params.get('returnWorkItemId'));
  return workItemId
    ? {
        route: `/work-items/${encodeURIComponent(workItemId)}`,
        label: '返回评估简报',
      }
    : null;
}
