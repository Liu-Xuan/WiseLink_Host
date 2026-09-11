import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

export interface MineruTableCell {
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  header: boolean;
}
export interface MineruTranslationTable {
  /** Null is a covered merge slot. Layout stays with Host; model preserves this matrix shape. */
  rows: Array<Array<string | null>>;
  cells: MineruTableCell[];
  needsVisualReview: boolean;
}

/** Parse table HTML as inert data; scripts/styles/URLs are never model context. */
export function readMineruTranslationTable(
  html: string,
): MineruTranslationTable {
  if (!html.trim() || html.length > 2_000_000)
    throw new Error('MINERU_TABLE_HTML_INVALID');
  const root = parseFragment(html);
  const tables = descendants(root, 'table');
  if (tables.length !== 1) throw new Error('MINERU_TABLE_NESTING_UNSUPPORTED');
  const table = tables[0];
  const rowElements = descendants(table, 'tr');
  if (!rowElements.length || rowElements.length > 2000)
    throw new Error('MINERU_TABLE_ROWS_INVALID');
  const rows: Array<Array<string | null>> = rowElements.map(() => []);
  const cells: MineruTableCell[] = [];
  let needsVisualReview = false;
  rowElements.forEach((row, rowIndex) => {
    let column = 0;
    for (const cell of row.childNodes.filter(
      (node): node is Element =>
        isElement(node) && ['td', 'th'].includes(node.tagName),
    )) {
      while (rows[rowIndex][column] !== undefined) column += 1;
      const rowSpan = span(cell, 'rowspan');
      const colSpan = span(cell, 'colspan');
      if (
        rowIndex + rowSpan > rows.length ||
        column + colSpan > 100 ||
        cells.length >= 20000
      )
        throw new Error('MINERU_TABLE_GEOMETRY_INVALID');
      for (let r = rowIndex; r < rowIndex + rowSpan; r++) {
        for (let c = column; c < column + colSpan; c++) {
          if (rows[r][c] !== undefined) throw new Error('MINERU_TABLE_OVERLAP');
          rows[r][c] =
            r === rowIndex && c === column ? plainHtmlText(cell).trim() : null;
        }
      }
      needsVisualReview ||= descendants(cell, 'img').length > 0;
      cells.push({
        row: rowIndex,
        column,
        rowSpan,
        colSpan,
        header: cell.tagName === 'th',
      });
      column += colSpan;
    }
  });
  const width = Math.max(...rows.map((row) => row.length));
  if (
    !cells.length ||
    !width ||
    rows.some(
      (row) =>
        row.length !== width ||
        Array.from(row).some((cell) => cell === undefined),
    )
  )
    throw new Error('MINERU_TABLE_GEOMETRY_INVALID');
  return { rows, cells, needsVisualReview };
}

export function plainMineruHtml(html: string): string {
  if (html.length > 2_000_000) throw new Error('MINERU_HTML_TOO_LARGE');
  return plainHtmlText(parseFragment(html)).trim();
}
function plainHtmlText(node: Node): string {
  if ('value' in node && node.nodeName === '#text') return node.value;
  if (
    isElement(node) &&
    ['script', 'style', 'iframe', 'object', 'embed', 'img'].includes(
      node.tagName,
    )
  )
    return '';
  if (isElement(node) && node.tagName === 'br') return '\n';
  const text =
    'childNodes' in node ? node.childNodes.map(plainHtmlText).join('') : '';
  return isElement(node) && ['p', 'div', 'li', 'tr'].includes(node.tagName)
    ? `${text}\n`
    : text;
}
function isElement(node: Node): node is Element {
  return 'tagName' in node;
}
function descendants(root: Node, tag: string): Element[] {
  const found: Element[] = [];
  const pending: Node[] = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (isElement(node) && node.tagName === tag) found.push(node);
    if ('childNodes' in node) pending.push(...[...node.childNodes].reverse());
  }
  return found;
}
function span(element: Element, name: string): number {
  const raw = element.attrs.find((attr) => attr.name === name)?.value ?? '1';
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > 100)
    throw new Error('MINERU_TABLE_SPAN_INVALID');
  return Number(raw);
}
