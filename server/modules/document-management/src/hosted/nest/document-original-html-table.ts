import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
export interface OriginalHtmlCell { text: string; columnIndex: number; rowSpan: number; colSpan: number; header: boolean }
export interface OriginalHtmlTable { caption: string; rows: OriginalHtmlCell[][]; text: string; issues: string[] }
const children = (node: Node): Node[] => 'childNodes' in node ? node.childNodes : [];
const elements = (node: Node, tag: string): Element[] => children(node).flatMap(child =>
  'tagName' in child && child.tagName === tag ? [child] : elements(child, tag));
function text(node: Node): string {
  if (node.nodeName === '#text') return (node as DefaultTreeAdapterMap['textNode']).value;
  if ('tagName' in node && ['script', 'style', 'template'].includes(node.tagName)) return '';
  if ('tagName' in node && node.tagName === 'br') return '\n';
  const value = children(node).map(text).join('');
  return 'tagName' in node && ['p', 'div', 'li'].includes(node.tagName) ? `${value}\n` : value;
}

/** HTML syntax supplies row/column spans; contents remain plain strings.
 * Nested tables and overlapping spans are explicit limitations, not flattened guesses. */
export function readOriginalHtmlTable(html: string): OriginalHtmlTable | null {
  const fragment = parseFragment(html);
  const tables = elements(fragment, 'table');
  if (tables.length !== 1) return null;
  const table = tables[0];
  if (elements(table, 'table').length) return null;
  const groups = children(table).filter((node): node is Element => 'tagName' in node && ['thead', 'tbody', 'tfoot'].includes(node.tagName));
  const directRows = children(table).filter((node): node is Element => 'tagName' in node && node.tagName === 'tr');
  const rowGroups = groups.length ? groups.map(group => elements(group, 'tr')) : [directRows];
  const issues: string[] = [];
  const rows: OriginalHtmlCell[][] = [];
  const widths: number[] = [];
  for (const group of rowGroups) {
    const occupied = new Map<number, number>();
    group.forEach((row, rowIndex) => {
      const cells = children(row).filter((node): node is Element => 'tagName' in node && ['td', 'th'].includes(node.tagName));
      let column = 0;
      const parsed = cells.map(cell => {
        while ((occupied.get(column) ?? 0) > rowIndex) column++;
        const span = (name: string) => {
          const value = cell.attrs.find(attr => attr.name === name)?.value;
          if (value === undefined) return 1;
          if (name === 'rowspan' && value === '0') return group.length - rowIndex;
          if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1000) { issues.push('INVALID_SPAN'); return 1; }
          return Number(value);
        };
        const rowSpan = span('rowspan'), colSpan = span('colspan'), start = column;
        if (rowSpan > group.length - rowIndex) issues.push('SPAN_OUTSIDE_ROW_GROUP');
        for (let c = column; c < column + colSpan; c++) {
          if ((occupied.get(c) ?? 0) > rowIndex) issues.push('OVERLAPPING_SPAN');
          occupied.set(c, rowIndex + rowSpan);
        }
        column += colSpan;
        return { text: text(cell).trim(), columnIndex: start, rowSpan, colSpan, header: cell.tagName === 'th' };
      });
      rows.push(parsed);
      const columns = [...occupied.entries()].filter(([_column, end]) => end > rowIndex).map(([column]) => column);
      widths.push(columns.length ? Math.max(...columns) + 1 : 0);
    });
  }
  if (!rows.length || rows.every(row => !row.length)) return null;
  if (new Set(widths).size > 1) issues.push('ROW_WIDTH_MISMATCH');
  const caption = elements(table, 'caption').map(text).join('\n').trim();
  return { caption, rows, text: [caption, ...rows.flat().map(cell => cell.text)].filter(Boolean).join(' '), issues: [...new Set(issues)] };
}
