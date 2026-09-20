import type { EngineeringIssueSearchHit } from '@shared/engineering-issue-search.interface';

export interface EngineeringIssueReadingState {
  query: string;
  scope: 'CURRENT' | 'HISTORY';
  selected: Pick<
    EngineeringIssueSearchHit,
    'subjectKind' | 'subjectId' | 'workRef' | 'issueKey'
  > | null;
}

export type EngineeringIssueReadingParse =
  | { state: 'ok'; value: EngineeringIssueReadingState }
  | { state: 'invalid'; reason: string };

const ID_KEYS = [
  'issueSubjectKind',
  'issueSubjectId',
  'issueWorkRef',
  'issueKey',
] as const;

function clean(value: string, limit: number): string | null {
  return value
    && value === value.trim()
    && value.length <= limit
    && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : null;
}

/** Read-only issue-search URL state. Partial or duplicate identities are rejected. */
export function readEngineeringIssueReadingState(
  params: URLSearchParams,
): EngineeringIssueReadingParse {
  const queryValues = params.getAll('issueSearchQuery');
  const scopeValues = params.getAll('issueSearchScope');
  if (queryValues.length > 1 || scopeValues.length > 1) {
    return { state: 'invalid', reason: '问题检索范围出现重复参数，未读取历史工作。' };
  }
  const query = queryValues[0] ?? '';
  if (query && !clean(query, 200)) {
    return { state: 'invalid', reason: '问题检索词不合法，未读取历史工作。' };
  }
  const scope = scopeValues[0] ?? 'CURRENT';
  if (scope !== 'CURRENT' && scope !== 'HISTORY') {
    return { state: 'invalid', reason: '问题检索范围不合法，未读取历史工作。' };
  }
  const present = ID_KEYS.filter((key) => params.has(key));
  if (present.length === 0) {
    return { state: 'ok', value: { query, scope, selected: null } };
  }
  if (
    present.length !== ID_KEYS.length
    || ID_KEYS.some((key) => params.getAll(key).length !== 1)
  ) {
    return { state: 'invalid', reason: '历史问题身份不完整或重复，未改读当前工作。' };
  }
  const subjectKind = params.get('issueSubjectKind');
  const subjectId = clean(params.get('issueSubjectId') ?? '', 512);
  const workRef = clean(params.get('issueWorkRef') ?? '', 512);
  const issueKey = clean(params.get('issueKey') ?? '', 512);
  if (
    (subjectKind !== 'WORK_ITEM' && subjectKind !== 'ENGINEERING_MATTER')
    || !subjectId
    || !workRef
    || !issueKey
  ) {
    return { state: 'invalid', reason: '历史问题身份不合法，未改读当前工作。' };
  }
  return {
    state: 'ok',
    value: {
      query,
      scope,
      selected: { subjectKind, subjectId, workRef, issueKey },
    },
  };
}

export function engineeringIssueReadingParams(
  state: EngineeringIssueReadingState,
): URLSearchParams {
  const params = new URLSearchParams();
  if (state.query) params.set('issueSearchQuery', state.query);
  params.set('issueSearchScope', state.scope);
  if (state.selected) {
    params.set('issueSubjectKind', state.selected.subjectKind);
    params.set('issueSubjectId', state.selected.subjectId);
    params.set('issueWorkRef', state.selected.workRef);
    params.set('issueKey', state.selected.issueKey);
  }
  return params;
}

export function normalizedEngineeringIssueReadingParams(
  params: URLSearchParams,
): URLSearchParams | null {
  const parsed = readEngineeringIssueReadingState(params);
  return parsed.state === 'ok'
    ? engineeringIssueReadingParams(parsed.value)
    : null;
}
