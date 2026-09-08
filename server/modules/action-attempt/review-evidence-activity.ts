import type {
  ReviewEvidenceActivity,
  ReviewRuntimeActivity,
  ReviewTurnExecutionReadModel,
} from '@shared/api.interface';

/** The database retains all receipts; keep the page's latest activity bounded. */
export function projectReviewEvidenceActivity(
  stored: string | null | undefined,
): ReviewTurnExecutionReadModel['evidenceActivity'] {
  if (stored == null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return unreadableActivity();
  }
  if (!Array.isArray(raw) || !raw.every(isReviewActivity))
    return unreadableActivity();
  const evidence = raw.filter(isActivity);
  return {
    items: evidence.slice(-100).map((item) => ({
      kind: item.kind,
      observedAt: item.observedAt,
      sourceRefIds: [...item.sourceRefIds],
      sourceCatalogCount: item.sourceCatalogCount,
    })),
    omittedEarlierCount: Math.max(0, evidence.length - 100),
    error: null,
  };
}

export function projectReviewRuntimeActivity(
  stored: string | null | undefined,
): ReviewTurnExecutionReadModel['runtimeActivity'] {
  if (stored == null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return unreadableRuntimeActivity();
  }
  if (!Array.isArray(raw) || !raw.every(isReviewActivity))
    return unreadableRuntimeActivity();
  const runtime = raw.filter(isReviewRuntimeActivity);
  return {
    items: runtime.slice(-100).map((item) => ({
      kind: item.kind,
      observedAt: item.observedAt,
      requestNo: item.requestNo,
      retryNo: item.retryNo,
      delayMs: item.delayMs,
      errorCode: item.errorCode,
    })),
    omittedEarlierCount: Math.max(0, runtime.length - 100),
    error: null,
  };
}

export function isReviewRuntimeActivity(
  value: unknown,
): value is ReviewRuntimeActivity {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    (item.kind === 'MODEL_REQUEST' || item.kind === 'MODEL_RETRY') &&
    typeof item.observedAt === 'string' &&
    Number.isFinite(Date.parse(item.observedAt)) &&
    Number.isSafeInteger(item.requestNo) &&
    Number(item.requestNo) > 0 &&
    Number.isSafeInteger(item.retryNo) &&
    Number(item.retryNo) >= 0 &&
    Number(item.retryNo) <= 2 &&
    Number.isSafeInteger(item.delayMs) &&
    Number(item.delayMs) >= 0 &&
    Number(item.delayMs) <= 30000 &&
    (item.errorCode === null ||
      (typeof item.errorCode === 'string' &&
        /^[A-Z][A-Z0-9_]{0,119}$/u.test(item.errorCode))) &&
    (item.kind === 'MODEL_RETRY'
      ? Number(item.retryNo) > 0 && item.errorCode !== null
      : item.delayMs === 0 && item.errorCode === null)
  );
}

function isReviewActivity(
  value: unknown,
): value is ReviewEvidenceActivity | ReviewRuntimeActivity {
  return isActivity(value) || isReviewRuntimeActivity(value);
}

function unreadableRuntimeActivity(): NonNullable<
  ReviewTurnExecutionReadModel['runtimeActivity']
> {
  return {
    items: [],
    omittedEarlierCount: 0,
    error: {
      code: 'REVIEW_RUNTIME_ACTIVITY_UNREADABLE',
      message: '运行进度暂不可读；可查看本回合执行状态。',
    },
  };
}

function isActivity(value: unknown): value is ReviewEvidenceActivity {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    (item.kind === 'CONTEXT_PREPARED' ||
      item.kind === 'SOURCE_REFS_RESOLVED') &&
    typeof item.observedAt === 'string' &&
    Number.isFinite(Date.parse(item.observedAt)) &&
    Array.isArray(item.sourceRefIds) &&
    item.sourceRefIds.every(
      (ref) => typeof ref === 'string' && ref.trim() === ref && ref.length > 0,
    ) &&
    Number.isSafeInteger(item.sourceCatalogCount) &&
    Number(item.sourceCatalogCount) >= 0
  );
}

function unreadableActivity(): NonNullable<
  ReviewTurnExecutionReadModel['evidenceActivity']
> {
  // A corrupt optional receipt must be visible without hiding the turn's
  // persisted execution state, candidate or editable engineer input.
  return {
    items: [],
    omittedEarlierCount: 0,
    error: {
      code: 'REVIEW_ACTIVITY_UNREADABLE',
      message: '取证记录暂不可读；执行状态与候选独立显示。',
    },
  };
}
