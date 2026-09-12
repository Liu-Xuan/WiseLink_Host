import { matchOriginalText, normalizeOriginalWhitespace, readOriginalMarkdownTable } from '../../../server/modules/document-management/src/hosted/nest/document-original-text';

describe('deterministic original comparison', () => {
  it('matches complete sentences over adjacent pages and preserves signs/part numbers', () => {
    expect(matchOriginalText('Do not use A-12 unless X.', [
      { pageIndex: 0, text: 'Do not use A-12' }, { pageIndex: 1, text: 'unless X.' },
    ])).toMatchObject({ status: 'UNIQUE', candidates: [{ pageIndexes: [0, 1] }] });
    expect(normalizeOriginalWhitespace(' A-12\n -0.25 ')).toBe('A-12 -0.25');
    expect(matchOriginalText('Use A12 at 0.25', [{ pageIndex: 0, text: 'Use A-12 at -0.25' }]).status).toBe('NOT_FOUND');
  });
  it('keeps repeated passages ambiguous and refuses unprocessed page gaps', () => {
    expect(matchOriginalText('Repeat.', [{ pageIndex: 0, text: 'Repeat. Repeat.' }]).status).toBe('AMBIGUOUS');
    expect(matchOriginalText('Before after', [
      { pageIndex: 0, text: 'Before' }, { pageIndex: 2, text: 'after' },
    ]).status).toBe('NOT_FOUND');
  });
  it('preserves legitimate key-value tables, escaped pipes, extra columns and missing cells', () => {
    const table = readOriginalMarkdownTable(['| Key | Value |', '| --- | --- |',
      '| A | a long legitimate value |', '| B | 12 | extra |', '| C |', '| D | x\\|y |']);
    expect(table.rows).toEqual([['A', 'a long legitimate value'], ['B', '12', 'extra'], ['C'], ['D', 'x|y']]);
    expect(table.issues).toEqual([
      { rowIndex: 1, expectedColumns: 2, actualColumns: 3 },
      { rowIndex: 2, expectedColumns: 2, actualColumns: 1 },
    ]);
  });
});
