import { buildAuthorizedSourceSearchProjection, buildWorkSearchProjection, EngineeringSearchProjectionWriter, projectionOwnerToSubjectKind } from './engineering-search-projection';

it('maps persisted projection owners to the public search subject kinds', () => {
  expect(projectionOwnerToSubjectKind('USER')).toBe('WORK_ITEM');
  expect(projectionOwnerToSubjectKind('MATTER')).toBe('ENGINEERING_MATTER');
  expect(projectionOwnerToSubjectKind('SOURCE')).toBeNull();
});

it('builds SOURCE and RECORD rows only from caller-supplied authorized text', () => {
  const rows = buildAuthorizedSourceSearchProjection([
    { entryId: 'src:r1:u1', ownerKind: 'SOURCE', ownerId: 'src-1', exactRevisionRef: 'rev-1', entryKind: 'SOURCE', locatorRef: 'unit:u1', title: '章节', originalText: '液压系统 脚注 条件', identifiers: ['SB 123'] },
    { entryId: 'src:r1:record-7', ownerKind: 'SOURCE', ownerId: 'src-1', exactRevisionRef: 'rev-1', entryKind: 'RECORD', locatorRef: 'record:7', originalText: '原生记录条件', parentContextRef: 'table-1' },
  ]);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ entryKind: 'SOURCE', ownerKind: 'SOURCE', locatorRef: 'unit:u1', parentContextRef: null });
  expect(rows[0]?.search.identifiers).toEqual(['SB 123']);
  expect(rows[1]).toMatchObject({ entryKind: 'RECORD', parentContextRef: 'table-1' });
});

it('rejects malformed or duplicate authorized source entries before persistence', () => {
  expect(() => buildAuthorizedSourceSearchProjection([
    { entryId: '', ownerKind: 'SOURCE', ownerId: 'src', exactRevisionRef: 'rev', entryKind: 'SOURCE', locatorRef: 'unit', originalText: '正文' },
  ])).toThrow('ENGINEERING_SEARCH_SOURCE_ENTRYID_INVALID');
  expect(() => buildAuthorizedSourceSearchProjection([
    { entryId: 'same', ownerKind: 'SOURCE', ownerId: 'src', exactRevisionRef: 'rev', entryKind: 'SOURCE', locatorRef: 'a', originalText: '正文' },
    { entryId: 'same', ownerKind: 'SOURCE', ownerId: 'src', exactRevisionRef: 'rev', entryKind: 'RECORD', locatorRef: 'b', originalText: '正文' },
  ])).toThrow('ENGINEERING_SEARCH_SOURCE_ENTRY_DUPLICATE');
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

it('rebuilds pending revisions independently and keeps failed items pending', async () => {
  const writer = Object.create(EngineeringSearchProjectionWriter.prototype) as EngineeringSearchProjectionWriter & Record<string, jest.Mock>;
  const pending = [
    { tenantId: 't1', revisionRef: 'wr-1', ownerKind: 'USER' as const, ownerId: 'u1', subjectId: null, lastError: 'old', attempts: 1 },
    { tenantId: 't1', revisionRef: 'mw-1', ownerKind: 'MATTER' as const, ownerId: 'u2', subjectId: 'm1', lastError: 'old', attempts: 1 },
  ];
  writer.listPending = jest.fn().mockResolvedValue(pending);
  writer.indexJobAidRevision = jest.fn().mockResolvedValue(undefined);
  writer.indexMatterRevision = jest.fn().mockRejectedValue(new Error('INDEX_TEMPORARY_FAILURE'));
  writer.markPending = jest.fn().mockResolvedValue(undefined);
  const result = await writer.rebuildPending({ tenantId: 't1', load: async item => {
    if (item.ownerKind === 'MATTER') throw new Error('SOURCE_NOT_READABLE');
    return { issues: [] } as never;
  }});
  expect(result).toEqual({ attempted: 2, rebuilt: 1, failed: 1 });
  expect(writer.indexJobAidRevision).toHaveBeenCalledWith(expect.objectContaining({ revisionRef: 'wr-1' }));
  expect(writer.markPending).toHaveBeenCalledWith(expect.objectContaining({ revisionRef: 'mw-1' }));
});
