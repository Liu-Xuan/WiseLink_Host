import {
  buildEngineeringSearchText,
  prepareEngineeringSearchQuery,
  tokenizeEngineeringSearchText,
} from './engineering-search-text';

describe('engineering search text', () => {
  it('requires real ICU Chinese word support and indexes body footnotes without changing source text', () => {
    expect(Intl.Segmenter.supportedLocalesOf(['zh', 'en'])).toHaveLength(2);
    const original = '液压系统\n正文：检查泄漏。\n脚注①：低温条件下需要复查。';
    const projection = buildEngineeringSearchText(original);
    expect(projection.originalText).toBe(original);
    expect(projection.tokenizedText.split(' ')).toEqual(expect.arrayContaining(['液压', '系统', '低温']));
    const query = prepareEngineeringSearchQuery('低温');
    for (const word of query.tokenizedText.split(' ')) {
      expect(projection.tokenizedText.split(' ')).toContain(word);
    }
    expect(projection.textSearchConfiguration).toBe(query.textSearchConfiguration);
  });

  it('preserves English conditions including negation in the simple full-text input', () => {
    const projection = buildEngineeringSearchText('Footnote: do NOT operate unless pressure is stable.');
    expect(projection.tokenizedText.split(' ')).toEqual(expect.arrayContaining(['not', 'unless', 'pressure', 'stable']));
    expect(prepareEngineeringSearchQuery('unless pressure').tokenizedText).toBe('unless pressure');
  });

  it('keeps exact part numbers and software revisions separate from word tokens', () => {
    const projection = buildEngineeringSearchText('Use PN 123-456-01, SW V2.10.', ['123-456-01', 'v2.10', '１２３–４５６–０１']);
    expect(projection.identifiers).toEqual(['123-456-01', 'V2.10']);
    expect(prepareEngineeringSearchQuery('检查 123-456-01 与 v2.10').exactIdentifierCandidates)
      .toEqual(expect.arrayContaining(['123-456-01', 'V2.10']));
    expect(prepareEngineeringSearchQuery('123-456-01').queryFunction).toBe('plainto_tsquery');
    expect(prepareEngineeringSearchQuery('123-456-01').tokenizedText).not.toContain('-');
    expect(projection.identifiers).not.toContain('12345601');
  });

  it('treats query operators as plain words, not executable query or SQL syntax', () => {
    const query = prepareEngineeringSearchQuery("pressure | !stable'); DROP TABLE sources; --");
    expect(query.queryFunction).toBe('plainto_tsquery');
    expect(query.tokenizedText).not.toMatch(/[|!';]/u);
    expect(tokenizeEngineeringSearchText('')).toBe('');
  });
});
