/** Text comparison keeps punctuation, signs and part-number hyphens intact. */
export function normalizeOriginalWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

export interface OriginalTextPage { pageIndex: number; text: string }
export interface OriginalTextMatch {
  status: 'UNIQUE' | 'AMBIGUOUS' | 'NOT_FOUND';
  candidates: Array<{ pageIndexes: number[]; start: number; end: number }>;
}

/** Offsets refer to the comparison view only, never advertised as original PDF offsets. */
export function matchOriginalText(text: string, pages: OriginalTextPage[]): OriginalTextMatch {
  const needle = normalizeOriginalWhitespace(text);
  if (!needle) return { status: 'NOT_FOUND', candidates: [] };
  const ordered = [...pages].sort((a, b) => a.pageIndex - b.pageIndex);
  if (new Set(ordered.map(page => page.pageIndex)).size !== ordered.length)
    throw new Error('DOCUMENT_ORIGINAL_DUPLICATE_PAGE');
  let comparison = '';
  const spans = ordered.map(page => {
    if (!Number.isSafeInteger(page.pageIndex) || page.pageIndex < 0)
      throw new Error('DOCUMENT_ORIGINAL_PAGE_INVALID');
    if (comparison) comparison += '\n';
    const start = comparison.length;
    comparison += normalizeOriginalWhitespace(page.text);
    return { pageIndex: page.pageIndex, start, end: comparison.length };
  });
  // Page separator has the same comparison width as ordinary whitespace.
  comparison = comparison.replace(/\n/g, ' ');
  const candidates: OriginalTextMatch['candidates'] = [];
  let offset = 0;
  while (offset <= comparison.length - needle.length) {
    const start = comparison.indexOf(needle, offset);
    if (start < 0) break;
    const end = start + needle.length;
    const pageIndexes = spans.filter(span => span.start < end && span.end > start).map(span => span.pageIndex);
    // A gap in processed pages cannot serve as proof of cross-page continuation.
    if (pageIndexes.every((page, index) => index === 0 || page === pageIndexes[index - 1] + 1))
      candidates.push({ pageIndexes, start, end });
    offset = start + 1;
  }
  return { status: candidates.length === 1 ? 'UNIQUE' : candidates.length ? 'AMBIGUOUS' : 'NOT_FOUND', candidates };
}

export interface OriginalMarkdownTable {
  header: string[];
  rows: string[][];
  rawLines: string[];
  /** Missing cells are absent, never synthesized as genuine blanks. Extra cells remain. */
  issues: Array<{ rowIndex: number; expectedColumns: number; actualColumns: number }>;
}

/** Parse GFM table syntax without discarding overflow cells or guessing pseudo-tables. */
export function readOriginalMarkdownTable(lines: string[]): OriginalMarkdownTable {
  if (lines.length < 2) throw new Error('DOCUMENT_ORIGINAL_TABLE_INVALID');
  const header = splitMarkdownRow(lines[0]);
  const delimiter = splitMarkdownRow(lines[1]);
  if (!header.length || delimiter.length !== header.length ||
      delimiter.some(cell => !/^:?-{3,}:?$/.test(cell.trim())))
    throw new Error('DOCUMENT_ORIGINAL_TABLE_INVALID');
  const rows = lines.slice(2).map(splitMarkdownRow);
  return { header, rows, rawLines: [...lines], issues: rows.flatMap((row, rowIndex) =>
    row.length === header.length ? [] : [{ rowIndex, expectedColumns: header.length, actualColumns: row.length }]) };
}

function splitMarkdownRow(line: string): string[] {
  let input = line.trim();
  if (input.startsWith('|')) input = input.slice(1);
  if (input.endsWith('|')) {
    let slashes = 0;
    for (let index = input.length - 2; index >= 0 && input[index] === '\\'; index--) slashes++;
    if (slashes % 2 === 0) input = input.slice(0, -1);
  }
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '\\' && index + 1 < input.length && ['|', '\\'].includes(input[index + 1])) {
      cell += input[++index];
    } else if (char === '|') {
      cells.push(cell.trim()); cell = '';
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}
