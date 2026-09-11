import { buildWorkSearchProjection, projectionOwnerToSubjectKind } from './engineering-search-projection';

it('maps persisted projection owners to the public search subject kinds', () => {
  expect(projectionOwnerToSubjectKind('USER')).toBe('WORK_ITEM');
  expect(projectionOwnerToSubjectKind('MATTER')).toBe('ENGINEERING_MATTER');
  expect(projectionOwnerToSubjectKind('SOURCE')).toBeNull();
});

describe('buildWorkSearchProjection', () => {
  it('keeps issue locators and exact revision while producing rebuildable text', () => {
    const rows = buildWorkSearchProjection({ ownerKind: 'USER', ownerId: 'u1', exactRevisionRef: 'wr-1', content: {
      issues: [{ issueKey: 'ISSUE-1', question: '中文脚注条件', statements: [{ text: 'English condition' }], riskScenarios: [], measures: [] }],
    } as never });
    expect(rows[0]).toMatchObject({ entryId: 'wr-1:issue:ISSUE-1', locatorRef: 'issues[0]', exactRevisionRef: 'wr-1' });
    expect(rows[0].search.identifiers).toContain('ISSUE-1');
    expect(rows[0].search.originalText).toContain('English condition');
  });

  it('keeps the matter subject separate from the creator used by ACL filtering', () => {
    const rows = buildWorkSearchProjection({ ownerKind: 'MATTER', ownerId: 'creator-1', subjectId: 'matter-1', exactRevisionRef: 'mw-1', content: {
      issues: [{ issueKey: 'ISSUE-1', question: '条件', statements: [], riskScenarios: [], measures: [] }],
    } as never });
    expect(rows[0].ownerId).toBe('creator-1');
    expect(rows[0].parentContextRef).toBe('matter-1');
  });
});
