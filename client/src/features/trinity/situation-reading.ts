import {
  TRINITY_SOURCE_CATEGORY_META,
  TRINITY_STAGE_META,
} from './trinity-model';

const MAX_RETURN_QUERY_LENGTH = 1024;
const MAX_PAGE_Y = 10_000_000;
const SITUATION_KEYS = new Set(['stage', 'source', 'pageY']);
const STAGE_IDS = new Set(TRINITY_STAGE_META.map((item) => item.id));
const SOURCE_IDS = new Set(
  TRINITY_SOURCE_CATEGORY_META.map((item) => item.id),
);
const REPLACED_MATTER_RETURN_KEYS = new Set([
  'returnMatterId',
  'returnMatterWorkRef',
  'returnMatterPanel',
  'returnDocumentVersionId',
]);

function identifier(value: string | null): string {
  const text = value?.trim() ?? '';
  return text && text.length <= 512 &&
    !/[\u0000-\u001f\u007f]/u.test(text) ? text : '';
}

function singleAllowed(
  params: URLSearchParams,
  key: 'stage' | 'source',
  allowed: ReadonlySet<string>,
): string | null {
  const values = params.getAll(key);
  if (!values.length) return '';
  if (values.length !== 1 || !allowed.has(values[0])) return null;
  return values[0];
}

function pageY(params: URLSearchParams): number | null | undefined {
  const values = params.getAll('pageY');
  if (!values.length) return undefined;
  if (values.length !== 1 || !/^\d{1,8}$/u.test(values[0])) return null;
  const value = Number(values[0]);
  return Number.isSafeInteger(value) && value <= MAX_PAGE_Y ? value : null;
}

/** Strict nested return state; it never carries an arbitrary route or identity. */
export function parseSituationReadingQuery(
  raw: string,
): URLSearchParams | null {
  if (raw.length > MAX_RETURN_QUERY_LENGTH) return null;
  const params = new URLSearchParams(raw);
  if ([...params.keys()].some((key) => !SITUATION_KEYS.has(key))) return null;
  const stage = singleAllowed(params, 'stage', STAGE_IDS);
  const source = singleAllowed(params, 'source', SOURCE_IDS);
  const scroll = pageY(params);
  if (stage === null || source === null || scroll === null) return null;
  if (stage && source) return null;
  const result = new URLSearchParams();
  if (stage) result.set('stage', stage);
  if (source) result.set('source', source);
  if (scroll !== undefined) result.set('pageY', String(scroll));
  result.sort();
  return result;
}

/** Current focus selection, optionally pinned to the visible page position. */
export function situationReadingQuery(
  params: URLSearchParams,
  scrollY?: number,
): URLSearchParams | null {
  const selected = new URLSearchParams();
  for (const key of ['stage', 'source'] as const) {
    for (const value of params.getAll(key)) selected.append(key, value);
  }
  if (scrollY !== undefined) {
    const bounded = Math.min(
      MAX_PAGE_Y,
      Math.max(0, Math.round(scrollY)),
    );
    selected.set('pageY', String(bounded));
  }
  return parseSituationReadingQuery(selected.toString());
}

export function situationFocusRoute(
  matterId: string,
  currentParams: URLSearchParams,
  preserveSelection: boolean,
): string | null {
  const id = identifier(matterId);
  if (!id) return null;
  const route = `/matters/${encodeURIComponent(id)}/posture`;
  if (!preserveSelection) return route;
  const state = situationReadingQuery(currentParams);
  if (!state) return null;
  state.delete('pageY');
  return `${route}${state.size ? `?${state.toString()}` : ''}`;
}

function pathIdentifier(pathname: string, pattern: RegExp): string {
  const encoded = pathname.match(pattern)?.[1] ?? '';
  try {
    return identifier(decodeURIComponent(encoded));
  } catch {
    return '';
  }
}

function onlyExpectedMatterReturnKeys(params: URLSearchParams): boolean {
  const returnKeys = [...params.keys()].filter((key) =>
    key.startsWith('return'));
  return returnKeys.every((key) =>
    REPLACED_MATTER_RETURN_KEYS.has(key) &&
    params.getAll(key).length === 1);
}

/**
 * Add a fixed posture return to an exact document or matter-work route.
 * Existing matter-reader return fields are accepted only when they bind to the
 * same matter/version, then replaced atomically by the situation parent.
 */
export function withSituationReturn(
  route: string,
  matterId: string,
  currentParams: URLSearchParams,
  scrollY?: number,
): string | null {
  const parentMatterId = identifier(matterId);
  const state = situationReadingQuery(currentParams, scrollY);
  if (!parentMatterId || !state) return null;
  const base = new URL('https://wiselink.invalid');
  const target = new URL(route, base);
  if (target.origin !== base.origin || !onlyExpectedMatterReturnKeys(
    target.searchParams,
  )) return null;
  const documentVersionId = pathIdentifier(
    target.pathname,
    /^\/document-versions\/([^/]+)$/u,
  );
  const targetMatterId = pathIdentifier(
    target.pathname,
    /^\/matters\/([^/]+)$/u,
  );
  if (documentVersionId) {
    const priorMatterIds = target.searchParams.getAll('returnMatterId');
    const priorVersions = target.searchParams.getAll('returnDocumentVersionId');
    if ((priorMatterIds.length &&
      (priorMatterIds.length !== 1 || priorMatterIds[0] !== parentMatterId)) ||
      (priorVersions.length &&
        (priorVersions.length !== 1 || priorVersions[0] !== documentVersionId))) {
      return null;
    }
    for (const key of REPLACED_MATTER_RETURN_KEYS) {
      target.searchParams.delete(key);
    }
    target.searchParams.set('returnDocumentVersionId', documentVersionId);
  } else if (targetMatterId) {
    if (targetMatterId !== parentMatterId) return null;
    const workRefs = target.searchParams.getAll('workRef');
    if (workRefs.length > 1) return null;
    const workRef = workRefs.length ? identifier(workRefs[0]) : '';
    if (workRefs.length && !workRef) return null;
    if (workRef) target.searchParams.set('returnSituationWorkRef', workRef);
  } else {
    return null;
  }
  target.searchParams.set('returnSituationMatterId', parentMatterId);
  target.searchParams.set('returnSituationQuery', state.toString());
  return `${target.pathname}?${target.searchParams.toString()}`;
}
