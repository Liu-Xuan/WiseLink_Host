import { buildWorkSearchProjection } from './engineering-search-projection';

describe('buildWorkSearchProjection', () => {
  it('keeps issue locators and exact revision while producing rebuildable text', () => {
    const rows = buildWorkSearchProjection({ ownerKind: 'USER', ownerId: 'u1', exactRevisionRef: 'wr-1', content: {
      issues: [{ issueKey: 'ISSUE-1', question: '中文脚注条件', statements: [{ text: 'English condition' }], riskScenarios: [], measures: [] }],
    } as never });
    expect(rows[0]).toMatchObject({ entryId: 'wr-1:issue:ISSUE-1', locatorRef: 'issues[0]', exactRevisionRef: 'wr-1' });
    expect(rows[0].search.identifiers).toContain('ISSUE-1');
    expect(rows[0].search.originalText).toContain('English condition');
  });
});
