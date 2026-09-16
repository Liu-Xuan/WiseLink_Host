const LIBRARY_FILTERS = [
  'familyId',
  'search',
  'normalizedFamily',
  'ata',
  'aircraftModel',
  'fleetFamily',
  'fleetModel',
] as const;

function identifier(value: string | null): string {
  const text = value?.trim() ?? '';
  return text.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(text) ? text : '';
}

/** Read-only directory state, never arbitrary URLs or write-intent parameters. */
export function libraryReadingParams(params: URLSearchParams): URLSearchParams {
  const result = new URLSearchParams({ mode: 'document' });
  for (const key of LIBRARY_FILTERS) {
    const value = identifier(params.get(key));
    if (value) result.set(key, value);
  }
  if (params.get('catalogView') === 'tree') result.set('catalogView', 'tree');
  if (params.get('grouping') === 'ata' || params.get('grouping') === 'aircraft')
    result.set('grouping', params.get('grouping')!);
  result.sort();
  return result;
}

export function libraryReadingScope(params: URLSearchParams): string {
  return `library:${libraryReadingParams(params).toString()}`;
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
  if (
    parseRunId.state !== 'ok' ||
    candidateRevision.state !== 'ok' ||
    runRef.state !== 'ok' ||
    (statementId.state !== 'ok' && statementId.state !== 'absent') ||
    (anchor.state !== 'ok' && anchor.state !== 'absent') ||
    (libraryQuery.state !== 'ok' && libraryQuery.state !== 'absent')
  )
    return null;
  return {
    parseRunId: parseRunId.value,
    candidateRevision: candidateRevision.value,
    runRef: runRef.value,
    statementId: statementId.state === 'ok' ? statementId.value : null,
    anchor: anchor.state === 'ok' ? anchor.value : null,
  };
}

export interface ActivityIdentityPins {
  parseRunId: string;
  candidateRevision: number;
  runRef: string;
  statementId: string | null;
  anchor: string | null;
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
): URLSearchParams {
  const params = new URLSearchParams({
    returnMatterId: matterId,
    returnDocumentVersionId: documentVersionId,
  });
  if (panel === 'review' || panel === 'materials')
    params.set('returnMatterPanel', panel);
  if (workRef) params.set('returnMatterWorkRef', workRef);
  return params;
}

export function readingReturnTarget(
  params: URLSearchParams,
  documentVersionId?: string,
  requestedRun?: string | null,
): { route: string; label: string } | null {
  const keys = [
    'returnMatterId',
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
      'returnDocumentVersionId',
      'returnRevisionSide',
      'returnActivityQuery',
      'returnActivityView',
    ].some((key) => params.getAll(key).length > 1)
  )
    return null;
  if (params.has('returnActivityView') && !params.has('returnActivityQuery')) return null;
  const binding = identifier(params.get('returnDocumentVersionId'));
  if (
    params.has('returnDocumentVersionId') &&
    (!binding ||
      (documentVersionId !== undefined && binding !== documentVersionId))
  )
    return null;
  const matterId = identifier(params.get('returnMatterId'));
  if (matterId) {
    const panel = params.get('returnMatterPanel');
    const workRef = identifier(params.get('returnMatterWorkRef'));
    if (params.has('returnMatterWorkRef') && !workRef) return null;
    const query = new URLSearchParams();
    if (workRef) query.set('workRef', workRef);
    else if (panel === 'review' || panel === 'materials')
      query.set('panel', panel);
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
      label: '返回原文档目录',
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
    if (!binding || !activityQuery || activityQuery.length > 4096) return null;
    const nested = new URLSearchParams(activityQuery);
    if (
      nested.has('returnActivityQuery') ||
      nested.has('returnActivityView') ||
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
    const query = activityReadingParams(nested);
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
