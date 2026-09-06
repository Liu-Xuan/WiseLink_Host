import type {
  ReviewEvidenceActivity,
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
  if (!Array.isArray(raw) || !raw.every(isActivity))
    return unreadableActivity();
  return {
    items: raw.slice(-100).map((item) => ({
      kind: item.kind,
      observedAt: item.observedAt,
      sourceRefIds: [...item.sourceRefIds],
      sourceCatalogCount: item.sourceCatalogCount,
    })),
    omittedEarlierCount: Math.max(0, raw.length - 100),
    error: null,
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
