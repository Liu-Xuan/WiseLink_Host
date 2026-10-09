import { tableAttachedSourceText } from '../../client/src/pages/DocumentParsingPage/table-source-text';

describe('exact display-only attached table source overlap', () => {
  it.each([
    ['Load limits', 'Load limits', null],
    ['Load limits', 'Load limits\nExcept B.', 'Except B.'],
    ['Load limits', 'Load limits\r\n\r\n  Do not operate unless X < 12.  ', '  Do not operate unless X < 12.  '],
    ['A\nOnly if X', 'A\nOnly if X\nKeep B.', 'Keep B.'],
    ['Load limits', 'Load limits\n\n', null],
    ['Load limits', 'Load limits apply only if X.', 'Load limits apply only if X.'],
    ['Load limits', 'Do not use Load limits without review.', 'Do not use Load limits without review.'],
    ['A & B', 'A &amp; B\nDo not use.', 'A &amp; B\nDo not use.'],
    ['LOAD LIMITS', 'Load limits\nExcept B.', 'Load limits\nExcept B.'],
    ['A B', 'A  B\nExcept B.', 'A  B\nExcept B.'],
    ['Only when X', 'Only when X is closed.\nDo not proceed otherwise.', 'Only when X is closed.\nDo not proceed otherwise.'],
    ['', '  Except B.\nRetain C. ', '  Except B.\nRetain C. '],
    [' ', '  Except B.\nRetain C. ', '  Except B.\nRetain C. '],
  ])('preserves exact unmatched source for caption %p and rawText %p', (caption, rawText, expected) => {
    const payload = { caption, rawText };
    const before = structuredClone(payload);
    expect(tableAttachedSourceText(payload)).toBe(expected);
    expect(payload).toEqual(before);
  });
  it.each([undefined, null, '', ' \n ', 12, ['Except B.']])('does not invent text from %p', rawText => {
    expect(tableAttachedSourceText({ rawText, caption: 'Load limits' })).toBeNull();
  });
});
