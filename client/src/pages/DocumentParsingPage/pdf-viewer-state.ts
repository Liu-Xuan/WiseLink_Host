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
