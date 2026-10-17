import type { WikiGuideIssueHit, WikiGuidePathSegment } from '@shared/wiki-guide.interface';

export interface WikiGuidePageState {
  kind: 'SECTIONS' | 'SEARCH_CHAPTERS' | 'ISSUES';
  after: string | null;
  anchor: string;
  offset: number;
}

export interface WikiGuideState {
  rootSummaryId: string | null;
  chapterSummaryId: string | null;
  search: string;
  scrollTop: number;
  /** One exact result page and trigger, never the whole expanded directory. */
  page?: WikiGuidePageState;
}

const keys = ['wikiRoot', 'wikiChapter', 'wikiQuery', 'wikiY', 'wikiPage', 'wikiAfter', 'wikiAnchor', 'wikiOffset'] as const;
const summaryId = /^DS-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const token = (value: string): boolean => Boolean(value) && value === value.trim() &&
  value.length <= 255 && !/[\u0000-\u001f\u007f]/u.test(value);
function validCursor(value: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length > 4000) return false;
  try {
    return btoa(atob(value.replace(/-/gu, '+').replace(/_/gu, '/')))
      .replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '') === value;
  } catch { return false; }
}

export const wikiGuideIssueAnchor = (hit: Pick<WikiGuideIssueHit, 'subjectKind' | 'subjectId' | 'workRef' | 'issueKey'>): string =>
  JSON.stringify([hit.subjectKind, hit.subjectId, hit.workRef, hit.issueKey]);

function validIssueAnchor(value: string): boolean {
  try {
    const parts: unknown = JSON.parse(value);
    return Array.isArray(parts) && parts.length === 4 && ['WORK_ITEM', 'ENGINEERING_MATTER'].includes(parts[0]) &&
      parts.slice(1).every(part => typeof part === 'string' && token(part)) && JSON.stringify(parts) === value;
  } catch { return false; }
}

export const EMPTY_WIKI_GUIDE_STATE: WikiGuideState = {
  rootSummaryId: null, chapterSummaryId: null, search: '', scrollTop: 0,
};

/** Only the guide's own read state is accepted; never a destination URL. */
export function readWikiGuideState(params: URLSearchParams): WikiGuideState | null {
  if (params.toString().length > 8192 || [...params.keys()].some(key => !keys.includes(key as typeof keys[number])) ||
    keys.some(key => params.getAll(key).length > 1)) return null;
  const root = params.get('wikiRoot'), chapter = params.get('wikiChapter');
  const search = params.get('wikiQuery') ?? '', y = params.get('wikiY');
  if ((root !== null && !summaryId.test(root)) || (chapter !== null && !summaryId.test(chapter)) ||
    search.length > 200 || /[\u0000-\u001f\u007f]/u.test(search) ||
    (y !== null && (!/^(?:0|[1-9]\d{0,6})$/u.test(y) || Number(y) > 9_999_999))) return null;
  const state: WikiGuideState = { rootSummaryId: root, chapterSummaryId: chapter, search, scrollTop: Number(y ?? 0) };
  if (['wikiPage', 'wikiAfter', 'wikiAnchor', 'wikiOffset'].some(key => params.has(key))) {
    const kind = params.get('wikiPage'), after = params.get('wikiAfter'), anchor = params.get('wikiAnchor') ?? '';
    const offset = params.get('wikiOffset');
    if (!root || !kind || !['SECTIONS', 'SEARCH_CHAPTERS', 'ISSUES'].includes(kind) ||
      (kind === 'SECTIONS' ? !chapter || Boolean(search.trim()) : !search.trim()) ||
      (after !== null && !validCursor(after)) ||
      !anchor || anchor.length > 1024 || (kind === 'ISSUES' ? !validIssueAnchor(anchor) : !summaryId.test(anchor)) ||
      offset === null || !/^(?:0|-?[1-9]\d{0,4})$/u.test(offset) || Math.abs(Number(offset)) > 10_000) return null;
    state.page = { kind: kind as WikiGuidePageState['kind'], after, anchor, offset: Number(offset) };
  }
  return state;
}

export function wikiGuideStateParams(state: WikiGuideState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.rootSummaryId !== null) params.set('wikiRoot', state.rootSummaryId);
  if (state.chapterSummaryId !== null) params.set('wikiChapter', state.chapterSummaryId);
  if (state.search) params.set('wikiQuery', state.search);
  if (state.scrollTop) params.set('wikiY', String(state.scrollTop));
  if (state.page) {
    params.set('wikiPage', state.page.kind);
    if (state.page.after !== null) params.set('wikiAfter', state.page.after);
    params.set('wikiAnchor', state.page.anchor); params.set('wikiOffset', String(state.page.offset));
  }
  return params;
}

export function wikiGuideReturnRoute(encoded: string | null): string | null {
  if (encoded === null || encoded.length > 8192) return null;
  const params = new URLSearchParams(encoded);
  const state = readWikiGuideState(params);
  if (!state) return null;
  const query = wikiGuideStateParams(state).toString();
  return '/situation' + (query ? '?' + query : '');
}

function returnState(state: WikiGuideState): string | null {
  const params = wikiGuideStateParams(state);
  if (!readWikiGuideState(params)) return null;
  return params.toString();
}

export function wikiGuideSummaryRoute(node: WikiGuidePathSegment, state: WikiGuideState): string | null {
  const saved = node.currentSummaryRef, back = returnState(state);
  if (!summaryId.test(node.summaryId) || !saved || !token(saved) || back === null) return null;
  return '/summaries/' + encodeURIComponent(node.summaryId) + '?' + new URLSearchParams({
    summaryRef: saved, returnWikiGuideQuery: back,
  });
}

export function wikiGuideIssueRoute(hit: WikiGuideIssueHit, state: WikiGuideState): string | null {
  const back = returnState(state);
  if (!['WORK_ITEM', 'ENGINEERING_MATTER'].includes(hit.subjectKind) ||
    ![hit.subjectId, hit.workRef, hit.issueKey].every(token) || back === null) return null;
  return '/knowledge?' + new URLSearchParams({
    subjectKind: hit.subjectKind, subjectId: hit.subjectId, workRef: hit.workRef,
    knowledgeIssueKey: hit.issueKey, returnWikiGuideQuery: back,
  });
}
