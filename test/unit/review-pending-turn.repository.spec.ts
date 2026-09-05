import { drizzle } from 'drizzle-orm/pg-proxy';
import { ReviewConversationRepository } from '../../server/modules/review-persistence/review-conversation.repository';

describe('pending Review query', () => {
  it('uses one actor-bound ordered query and returns the persisted turn identity', async () => {
    const query = jest.fn(async () => ({
      rows: [['RC-1', 'RT-2', 'request-2', 2, 7]],
    }));
    const repository = new ReviewConversationRepository(
      drizzle(query) as never,
    );
    await expect(
      repository.loadPendingOpenClawTurn({
        tenantId: 'tenant-1',
        actorId: 'actor-1',
        workItemId: 'WI-1',
      }),
    ).resolves.toEqual({
      reviewConversationId: 'RC-1',
      reviewTurnId: 'RT-2',
      requestId: 'request-2',
      turnNo: 2,
      inputRevision: 7,
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain("set_config('app.user_id'");
    expect(sql).toContain('inner join lateral');
    expect(sql).toContain('not exists');
    expect(sql).toContain('order by');
    expect(parameters).toEqual(
      expect.arrayContaining([
        'WI-1',
        'actor-1',
        'tenant-1',
        'ACTIVE',
        'cli_aadde8b579f95bc9',
        '%"executionRequested":true%',
      ]),
    );
  });
});
