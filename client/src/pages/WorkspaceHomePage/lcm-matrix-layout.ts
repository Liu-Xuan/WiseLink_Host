import type { LcmMatrixSoftwareIndex } from '@shared/lcm-matrix.interface';

export interface LcmMatrixRow {
  key: string;
  software: LcmMatrixSoftwareIndex;
  partNumber?: string | null;
  top: number;
  height: number;
  softwareIndex: number;
}

export function lcmMatrixRows(software: LcmMatrixSoftwareIndex[], expanded: Set<string>): LcmMatrixRow[] {
  let top = 0;
  const rows: LcmMatrixRow[] = [];
  software.forEach((group, softwareIndex) => {
    rows.push({ key: group.softwareRef, software: group, top, height: 72, softwareIndex });
    top += 72;
    if (expanded.has(group.softwareRef)) for (const part of group.parts) {
      rows.push({ key: JSON.stringify([group.softwareRef, part.partNumber]), software: group,
        partNumber: part.partNumber, top, height: 44, softwareIndex });
      top += 44;
    }
  });
  return rows;
}

export function lcmRowWindow(rows: LcmMatrixRow[], scrollTop: number, height: number, overscan = 3): [number, number] {
  let low = 0, high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (rows[middle].top + rows[middle].height <= scrollTop) low = middle + 1;
    else high = middle;
  }
  let end = low;
  while (end < rows.length && rows[end].top < scrollTop + height) end++;
  return [Math.max(0, low - overscan), Math.min(rows.length, end + overscan)];
}

export function lcmPreserveScrollAnchor(before: LcmMatrixRow[], after: LcmMatrixRow[], top: number): number {
  const anchor = before.find(row => row.top + row.height > top);
  if (!anchor) return top;
  const next = after.find(row => row.key === anchor.key) ??
    after.find(row => row.software.softwareRef === anchor.software.softwareRef);
  return next ? next.top + Math.min(top - anchor.top, next.height - 1) : top;
}

export interface LcmGridWindow { rowStart: number; rowLimit: number; columnStart: number; columnLimit: number }
export const LCM_INITIAL_WINDOW: LcmGridWindow = { rowStart: 0, rowLimit: 20, columnStart: 0, columnLimit: 16 };

export function lcmWindowForRows(rows: LcmMatrixRow[], start: number, end: number,
  columnStart: number, columnLimit: number): LcmGridWindow {
  const rowStart = rows[start]?.softwareIndex ?? 0;
  return { rowStart, rowLimit: Math.min(50, Math.max(1, (rows[end - 1]?.softwareIndex ?? rowStart) - rowStart + 1)),
    columnStart, columnLimit: Math.min(50, Math.max(1, columnLimit)) };
}
