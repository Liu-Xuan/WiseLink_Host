import type {
  DocumentActivityReadingRequest,
  DocumentActivityReadingResponse,
  DocumentActivityRevision,
  DocumentActivityStatement,
} from '@shared/document-activity.interface';
import type { TranslationSourceAnchorV2 } from '@shared/canonical-translation-v2.interface';
import {
  activityReadingParams,
  activityWindowPin,
  revisionSemanticPin,
  revisionTextPin,
} from '@client/src/features/matter/reading-return';

/** Activity identity as carried by the page query; the document version lives in the route. */
export interface ActivityEntryQuery {
  parseRunId: string | null;
  candidateRevision: number | null;
  runRef: string | null;
  statementId: string | null;
  anchor: string | null;
}

export type ActivityEntryValidation =
  | { ok: false; reason: string }
  | {
      ok: true;
      parseRunId: string | null;
      candidateRevision: number | null;
      runRef: string | null;
      statementId: string | null;
      anchor: string | null;
    };

function isBlockedEntry(entry: ActivityEntryValidation): entry is { ok: false; reason: string } {
  return entry.ok === false;
}

const EMPTY_ACTIVITY_PINS: ActivityEntryQuery = {
  parseRunId: null,
  candidateRevision: null,
  runRef: null,
  statementId: null,
  anchor: null,
};

/** Pin accessors use an in-guard so callers never rely on literal discriminant narrowing. */
export function activityEntryPins(entry: ActivityEntryValidation): ActivityEntryQuery {
  return 'reason' in entry ? EMPTY_ACTIVITY_PINS : entry;
}

export function activityEntryReason(entry: ActivityEntryValidation): string | null {
  return 'reason' in entry ? entry.reason : null;
}

function pinProblem(state: 'duplicate' | 'empty' | 'invalid'): string {
  if (state === 'duplicate') return '出现重复';
  if (state === 'empty') return '为空';
  return '不合法';
}

/**
 * - An empty query is the only full discovery; any explicit pin is never "repaired".
 * - A single pin without parseRunId is rejected (no parse run to pin a candidate to).
 * - candidateRevision and runRef pin one saved candidate together; presenting only one
 *   of them is a half pin and is rejected whether or not a parse run is present.
 * - Illegal, duplicated or empty pins are rejected; nothing is guessed and no request
 *   is issued for a rejected entry.
 */
export function validateActivityEntry(
  params: URLSearchParams,
): ActivityEntryValidation {
  const window = activityWindowPin(params);
  if (window.state !== 'ok' && window.state !== 'absent')
    return { ok: false, reason: `时间窗参数${pinProblem(window.state)}，只允许 all 或 current-year，无法进行活动阅读。` };
  const parseRunId = revisionTextPin(params, 'parseRunId');
  if (parseRunId.state !== 'ok' && parseRunId.state !== 'absent')
    return { ok: false, reason: `解析版本${pinProblem(parseRunId.state)}，无法进行活动阅读。` };
  const candidateRevision = revisionSemanticPin(params, 'candidateRevision');
  if (candidateRevision.state !== 'ok' && candidateRevision.state !== 'absent')
    return { ok: false, reason: `候选改版号${pinProblem(candidateRevision.state)}，必须是正整数，无法进行活动阅读。` };
  const runRef = revisionTextPin(params, 'runRef');
  if (runRef.state !== 'ok' && runRef.state !== 'absent')
    return { ok: false, reason: `运行标识${pinProblem(runRef.state)}，无法进行活动阅读。` };
  const statementId = revisionTextPin(params, 'statementId');
  if (statementId.state !== 'ok' && statementId.state !== 'absent')
    return { ok: false, reason: `声明标识${pinProblem(statementId.state)}，无法进行活动阅读。` };
  const anchor = revisionTextPin(params, 'anchor');
  if (anchor.state !== 'ok' && anchor.state !== 'absent')
    return { ok: false, reason: `锚点${pinProblem(anchor.state)}，无法进行活动阅读。` };
  if (
    parseRunId.state === 'absent' &&
    (candidateRevision.state === 'ok' ||
      runRef.state === 'ok' ||
      statementId.state === 'ok' ||
      anchor.state === 'ok')
  )
    return { ok: false, reason: '未指定解析版本时，候选改版号、运行标识、声明或锚点不能单独使用。' };
  const hasRevision = candidateRevision.state === 'ok';
  const hasRunRef = runRef.state === 'ok';
  // candidateRevision and runRef pin one saved candidate together; a half pair does
  // not identify which candidate to read and must never trigger discovery or a read.
  if (hasRevision !== hasRunRef) {
    return {
      ok: false,
      reason:
        parseRunId.state === 'ok'
          ? '候选改版与运行标识必须成对出现，缺少其一时不会读取候选。'
          : '候选改版与运行标识必须成对出现，缺少其一时不会发现候选。',
    };
  }
  return {
    ok: true,
    parseRunId: parseRunId.state === 'ok' ? parseRunId.value : null,
    candidateRevision: candidateRevision.state === 'ok' ? candidateRevision.value : null,
    runRef: runRef.state === 'ok' ? runRef.value : null,
    statementId: statementId.state === 'ok' ? statementId.value : null,
    anchor: anchor.state === 'ok' ? anchor.value : null,
  };
}

export type ActivityEntryPlan =
  | { mode: 'blocked'; reason: string }
  | { mode: 'discover-run' }
  | {
      mode: 'read';
      request: DocumentActivityReadingRequest;
      discovery: boolean;
    };

/** Zero-request gate: a blocked plan must never reach the network. */
export function planActivityEntry(
  documentVersionId: string,
  entry: ActivityEntryValidation,
): ActivityEntryPlan {
  if (isBlockedEntry(entry)) return { mode: 'blocked', reason: entry.reason };
  if (entry.parseRunId === null) return { mode: 'discover-run' };
  const discovery = entry.candidateRevision === null && entry.runRef === null;
  const request: DocumentActivityReadingRequest = {
    documentVersionId,
    parseRunId: entry.parseRunId,
  };
  if (entry.candidateRevision !== null)
    request.candidateRevision = entry.candidateRevision;
  return { mode: 'read', request, discovery };
}

export interface ActivityEntryDeps {
  readParsingStatus: (
    documentVersionId: string,
    signal: AbortSignal,
  ) => Promise<{ publishedRun: { parseRunId: string } | null }>;
  readActivityReading: (
    request: DocumentActivityReadingRequest,
    signal: AbortSignal,
  ) => Promise<DocumentActivityReadingResponse>;
}

export interface ActivityEntryLoadResult {
  reading: DocumentActivityReadingResponse | null;
  /** Non-null when discovery produced a new pin set to write back with replace. */
  replaceQuery: string | null;
  error: string | null;
  unreadable: string | null;
}

/**
 * Load the saved activity candidate for a validated entry. Explicit pins never fall
 * back to the latest saved candidate; a pinned runRef or candidateRevision that does
 * not match the saved candidate is an error, not a silent re-point.
 */
export async function loadActivityEntry(options: {
  documentVersionId: string;
  entry: ActivityEntryValidation;
  baseParams: URLSearchParams;
  deps: ActivityEntryDeps;
  signal: AbortSignal;
  current: () => boolean;
}): Promise<ActivityEntryLoadResult> {
  const { documentVersionId, entry, baseParams, deps, signal, current } = options;
  const empty: ActivityEntryLoadResult = {
    reading: null,
    replaceQuery: null,
    error: null,
    unreadable: null,
  };
  if (isBlockedEntry(entry)) return { ...empty, error: entry.reason };
  const plan = planActivityEntry(documentVersionId, entry);
  if (plan.mode === 'blocked') return { ...empty, error: plan.reason };
  let request: DocumentActivityReadingRequest;
  if (plan.mode === 'discover-run') {
    const status = await deps.readParsingStatus(documentVersionId, signal);
    if (!current()) throw new Error('DOCUMENT_ACTIVITY_ENTRY_OBSOLETE');
    if (!status.publishedRun)
      return {
        ...empty,
        unreadable:
          '该文档版本没有已发布的解析版本，无法进行活动阅读。本页面不会启动新的解析。',
      };
    request = { documentVersionId, parseRunId: status.publishedRun.parseRunId };
  } else {
    request = plan.request;
  }
  const response = await deps.readActivityReading(request, signal);
  if (!current()) throw new Error('DOCUMENT_ACTIVITY_ENTRY_OBSOLETE');
  const candidate = response.candidate;
  if (entry.runRef !== null) {
    if (!candidate)
      return {
        ...empty,
        error: `运行标识「${entry.runRef}」没有已保存的活动候选，不会改用其他候选。`,
      };
    if (candidate.runRef !== entry.runRef)
      return {
        ...empty,
        error: `运行标识与已保存候选不一致（请求「${entry.runRef}」，已保存「${candidate.runRef}」），不会改用其他候选。`,
      };
  }
  if (entry.candidateRevision !== null && !candidate)
    return {
      ...empty,
      error: `指定的候选改版 ${entry.candidateRevision} 没有已保存的候选，不会改回到其他改版。`,
    };
  let replaceQuery: string | null = null;
  const discovered = entry.candidateRevision === null && entry.runRef === null;
  if (discovered && (candidate !== null || entry.parseRunId === null)) {
    const query = activityReadingParams(baseParams);
    query.set('parseRunId', request.parseRunId);
    if (candidate) {
      query.set('candidateRevision', String(candidate.candidateRevision));
      query.set('runRef', candidate.runRef);
    }
    replaceQuery = query.toString();
  }
  return { ...empty, reading: response, replaceQuery };
}

/** Query for a statement/anchor selection change; known pins are never altered. */
export function activitySelectionQuery(
  baseParams: URLSearchParams,
  selection: { statementId?: string | null; anchor?: string | null },
): string {
  const query = activityReadingParams(baseParams);
  if (selection.statementId !== undefined) {
    query.delete('statementId');
    if (selection.statementId) query.set('statementId', selection.statementId);
  }
  if (selection.anchor !== undefined) {
    query.delete('anchor');
    if (selection.anchor) query.set('anchor', selection.anchor);
  }
  return query.toString();
}

export function findActivityStatement(
  candidate: DocumentActivityRevision | null,
  statementId: string,
): DocumentActivityStatement | null {
  if (!candidate) return null;
  return (
    candidate.statements.find(
      (statement: DocumentActivityStatement) =>
        statement.statementId === statementId,
    ) ?? null
  );
}

export function findActivityAnchor(
  candidate: DocumentActivityRevision | null,
  anchorId: string,
): TranslationSourceAnchorV2 | null {
  if (!candidate) return null;
  return (
    candidate.sourceAnchors.find(
      (anchor: TranslationSourceAnchorV2) => anchor.anchorId === anchorId,
    ) ?? null
  );
}
