import { buildWikiRecentChanges, wikiStoredTime, wikiSourceBlocker } from '../../client/src/features/matter/wiki-recent-changes';
import { conversation, jobAidRevision, jobAidWork, matterWork, turn } from './helpers/wiki-recent-changes.fixture';

describe('Wiki real saved-work presentation', () => {
  it('shows one exact persisted work and deduplicates its receipt without equating ID namespaces', () => {
    const result = buildWikiRecentChanges(jobAidWork, 'CURRENT', conversation([turn(), turn()]));
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ workRef: 'JW-2', revision: 2,
      savedAt: '2026-10-02T08:00:00.000Z', actionAttemptId: 'db-attempt-2',
      receipts: [{ operationRef: 'operation-2', completedAt: '2026-10-02T08:00:01.000Z' }] });
    expect(result.receiptNotice).toBeNull();
  });

  it('does not turn a matching title, later work, wrong revision, input revision or turn into a receipt', () => {
    for (const patch of [
      { workRevisionRef: 'JW-3' }, { workRevision: 3 }, { basedOnWorkItemRevision: 6 },
      { requestId: 'review-turn:T3' }, { workItemId: 'WI2' },
    ]) {
      const work = { kind: 'WORK_ITEM' as const, revision: { ...jobAidRevision, ...patch } };
      if (patch.workItemId) expect(() => buildWikiRecentChanges(work, 'CURRENT', conversation())).toThrow('OBJECT_NOT_FOUND');
      else expect(buildWikiRecentChanges(work, 'CURRENT', conversation()).events[0].receipts).toEqual([]);
    }
  });

  it.each(['CHAT', 'UNCHANGED', 'FAILED'] as const)('does not turn %s into an actual work update', (variant) => {
    const item = turn();
    if (variant === 'CHAT') item.purpose = 'CHAT';
    if (variant === 'UNCHANGED') item.assistantCandidate!.jobAidWorkingUpdate!.status = 'UNCHANGED';
    if (variant === 'FAILED') item.execution = { status: 'FAILED', attemptRef: 'operation-2',
      requestedAt: null, startedAt: null, updatedAt: '2026-10-02T08:00:01Z', completedAt: null,
      error: { code: 'FIXTURE_FAILURE', message: '固定失败' } };
    const result = buildWikiRecentChanges(jobAidWork, 'CURRENT', conversation([item]));
    expect(result.events).toHaveLength(1); // The separately persisted work still exists.
    expect(result.events[0].receipts).toEqual([]);
  });

  it('rejects foreign Matter scope before retaining a receipt', () => {
    const read = conversation();
    read.reviewScope = { kind: 'ENGINEERING_MATTER', matterId: 'M2' };
    read.turns[0].reviewScope = read.reviewScope;
    expect(() => buildWikiRecentChanges(jobAidWork, 'CURRENT', read)).toThrow('OBJECT_NOT_FOUND');
    expect(() => buildWikiRecentChanges(matterWork, 'CURRENT', read)).toThrow('OBJECT_NOT_FOUND');
  });

  it('rejects conflicting copies of one receipt and preserves the original save', () => {
    const another = turn(); another.assistantCandidate!.actionAttemptRef = 'operation-other';
    const result = buildWikiRecentChanges(jobAidWork, 'CURRENT', conversation([turn(), another]));
    expect(result.events[0].receipts).toEqual([]);
    expect(result.receiptNotice).toContain('身份冲突');
  });

  it('keeps Matter save and explains the missing exact-work receipt contract', () => {
    const item = turn({ reviewScope: { kind: 'ENGINEERING_MATTER', matterId: 'M1' } });
    item.assistantCandidate!.matterWorkingUpdate = { matterId: 'M1', status: 'APPLIED', workingRevision: 2,
      resultRef: 'OLDER-OVERALL', resultRevision: 1, resultChanged: true, coverageChanged: true, reasonCode: null };
    const read = conversation([item]); read.reviewScope = item.reviewScope;
    const result = buildWikiRecentChanges(matterWork, 'CURRENT', read);
    expect(result.events[0]).toMatchObject({ workRef: 'MW-2', sourceReviewTurnId: 'T2', receipts: [] });
    expect(result.receiptNotice).toContain('未提供确切工作引用');
  });

  it('never adds a current receipt to a selected historical work', () => {
    const result = buildWikiRecentChanges(jobAidWork, 'HISTORICAL', conversation());
    expect(result.events[0].receipts).toEqual([]);
    expect(result.receiptNotice).toContain('未读取当前讨论');
    expect(buildWikiRecentChanges(null, 'CURRENT', conversation()).events).toEqual([]);
  });

  it('does not use receipt completion or a date-only string as a missing work-save time', () => {
    const work = { kind: 'WORK_ITEM' as const, revision: { ...jobAidRevision, createdAt: '' } };
    expect(buildWikiRecentChanges(work, 'CURRENT', conversation()).events[0].savedAt).toBeNull();
    expect(wikiStoredTime('2026-10-02')).toBeNull();
    expect(wikiStoredTime('TBD')).toBeNull();
    expect(wikiStoredTime('2026-02-30T08:00:00Z')).toBeNull();
    expect(wikiStoredTime('2026-10-02T24:00:00Z')).toBeNull();
    expect(wikiStoredTime('2026-10-02T16:00:00+08:00')).toBe('2026-10-02T16:00:00+08:00');
  });

  it('refuses historical candidate strings without persisted work ownership, even with all three pins', () => {
    expect(wikiSourceBlocker('HISTORICAL', { label: '旧版', documentVersionId: 'DV1',
      parseRunId: 'PR1', candidateRevision: 2, runRef: 'DA1' })).toContain('未提供可核对归属');
  });
});
