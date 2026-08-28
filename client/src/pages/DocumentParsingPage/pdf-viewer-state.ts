export function clampPdfPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page) || pageCount <= 0) return 1;
  return Math.min(pageCount, Math.max(1, Math.trunc(page)));
}

export function visiblePdfPages(
  currentPage: number,
  pageCount: number,
  mobile: boolean,
): number[] {
  const current: number = clampPdfPage(currentPage, pageCount);
  if (mobile) return [current];
  return [current - 1, current, current + 1].filter(
    (page: number) => page >= 1 && page <= pageCount,
  );
}

/** Accepts only a positive base-10 page number from a browser deep link. */
export function parsePdfTargetPage(value: string | null): number | null {
  const normalized: string = value?.trim() ?? '';
  if (!/^[1-9]\d*$/u.test(normalized)) return null;
  const page: number = Number(normalized);
  return Number.isSafeInteger(page) ? page : null;
}

/** An explicit structured-content page survives even when Reader query units are empty. */
export function resolvePdfTargetPage(
  explicitTargetPage: number | null,
  queriedUnitPageStart: number | null | undefined,
): number | null {
  if (
    explicitTargetPage !== null &&
    Number.isSafeInteger(explicitTargetPage) &&
    explicitTargetPage > 0
  ) {
    return explicitTargetPage;
  }
  if (
    queriedUnitPageStart !== null &&
    queriedUnitPageStart !== undefined &&
    Number.isSafeInteger(queriedUnitPageStart) &&
    queriedUnitPageStart > 0
  ) {
    return queriedUnitPageStart;
  }
  return null;
}
