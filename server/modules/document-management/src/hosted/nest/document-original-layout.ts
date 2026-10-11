import type { DocumentPdfPage } from './document-original-pdf';
import { normalizeOriginalWhitespace } from './document-original-text';

export interface OriginalLayoutRun { text: string; x: number; endX: number;
  itemIndexes: number[];
  /** Each original item's own box, in PDF viewport top-left coordinates. */
  boxes: Array<[number, number, number, number]>;
}
export interface OriginalLayoutLine { text: string; start: number; end: number; breakBefore: boolean;
  itemIndexes: number[]; x: number; y: number; width: number; height: number;
  /** Physical gaps between runs, not inferred semantic columns. */
  runs: OriginalLayoutRun[];
}

/** A comparison view only. Raw PDF items remain immutable in the saved sidecar.
 * Unsupported rotations or incomplete geometry retain the original extraction. */
export function originalPageLayout(page: DocumentPdfPage): { page: DocumentPdfPage; lines: OriginalLayoutLine[] } {
  const items = page.items.filter(item => item.text.trim());
  const compact = (text: string) => text.replace(/\s/gu, '');
  if (page.rotation !== 0 || !Number.isFinite(page.width) || page.width <= 0 ||
      !Number.isFinite(page.height) || page.height <= 0 || !items.length ||
      compact(items.map(item => item.text).join('')) !== compact(page.text) ||
      items.some(item => item.transform.length !== 6 || !item.transform.every(Number.isFinite) ||
        Math.abs(item.transform[1]) > 0.01 || Math.abs(item.transform[2]) > 0.01 ||
        item.transform[0] <= 0 || item.transform[3] <= 0 || !Number.isFinite(item.width) || item.width < 0))
    return { page, lines: [] };

  const rows: Array<{ y: number; size: number; items: typeof items }> = [];
  for (const item of [...items].sort((a, b) => b.transform[5] - a.transform[5])) {
    const previous = rows.at(-1);
    if (previous && Math.abs(previous.y - item.transform[5]) <= 0.5) {
      previous.items.push(item);
      previous.size = Math.max(previous.size, item.transform[3]);
    } else rows.push({ y: item.transform[5], size: item.transform[3], items: [item] });
  }
  let text = '';
  const band = (y: number) => y > page.height * 0.88 ? 'top' : y < page.height * 0.13 ? 'bottom' : 'body';
  const lines = rows.map((row, index) => {
    row.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let line = '';
    const runs: OriginalLayoutLine['runs'] = [];
    row.items.forEach((item, itemIndex) => {
      const previous = row.items[itemIndex - 1];
      const gap = previous ? item.transform[4] - previous.transform[4] - previous.width : 0;
      // Only a physically touching hyphenated token is joined. Never erase a
      // spaced minus sign, arbitrary whitespace, or column gap to force a match.
      const joined = previous && /[\p{L}\p{N}]-$/u.test(previous.text) && /^[\p{L}\p{N}]/u.test(item.text) && Math.abs(gap) <= 0.3;
      const separator = itemIndex && !joined ? ' ' : '';
      line += separator + item.text;
      const itemIndexInPage = page.items.indexOf(item);
      const box: [number, number, number, number] = [item.transform[4],
        page.height - item.transform[5] - item.transform[3], item.width, item.transform[3]];
      const run = runs.at(-1);
      // PDF.js can mark the end of a column even when its gutter is smaller
      // than a word gap. Keep that boundary in the independent quote view.
      if (run && !previous?.hasEOL && gap <= Math.max(row.size * 1.6, 8)) {
        run.text += separator + item.text; run.endX = item.transform[4] + item.width;
        run.itemIndexes.push(itemIndexInPage); run.boxes.push(box);
      } else runs.push({ text: item.text, x: item.transform[4], endX: item.transform[4] + item.width,
        itemIndexes: [itemIndexInPage], boxes: [box] });
    });
    line = normalizeOriginalWhitespace(line);
    if (text) text += ' ';
    const start = text.length;
    text += line;
    const previous = rows[index - 1];
    return { text: line, start, end: text.length, itemIndexes: row.items.map(item => page.items.indexOf(item)),
      x: row.items[0].transform[4], y: row.y, width: Math.max(...row.items.map(item => item.transform[4] + item.width)) - row.items[0].transform[4],
      height: row.size, runs: runs.map(run => ({ ...run, text: normalizeOriginalWhitespace(run.text) })), breakBefore: !previous ||
      band(row.y) !== band(previous.y) || previous.y - row.y > Math.max(previous.size, row.size) * 1.65 ||
      /^\d+[.)]\s/u.test(line) };
  });
  return { page: { ...page, text }, lines };
}
