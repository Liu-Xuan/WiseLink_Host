import { drizzle } from 'drizzle-orm/pg-proxy';
import { ReviewConversationRepository } from '../../server/modules/review-persistence/review-conversation.repository';

describe('pending Review query', () => {
  it('binds the trusted successor actor before its exact pointer read without fetching body fields', async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    const repository = new ReviewConversationRepository(drizzle(query) as never);
    await expect(repository.loadSuccessorOverallAuthorizationMetadata({
      tenantId: 'tenant-1', actorId: 'actor-1', workItemId: 'WI-1', reviewTurnRef: 'RT-1',
    })).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("set_config('app.user_id'");
    expect(sql).toContain('TRUE');
    expect(sql).toContain('CROSS JOIN LATERAL');
    expect(sql).toContain('candidate_turn.actor_id = actor_context.actor_id');
    expect(sql).toContain('candidate_turn.review_turn_id =');
    expect(sql).toContain('candidate_turn.tenant_id =');
    expect(sql).toContain('candidate_turn.work_item_id =');
    expect(parameters).toEqual(['actor-1', 'RT-1', 'tenant-1', 'WI-1']);
    expect(sql).not.toMatch(/user_message|assistant_response|candidate_text|SELECT \*/u);
  });

  it.each(['', '-1', 'service:executor'])('rejects non-engineer actor %s before successor pointer SQL', async actorId => {
    const query = jest.fn(async () => ({ rows: [] }));
    const repository = new ReviewConversationRepository(drizzle(query) as never);
    await expect(repository.loadSuccessorOverallAuthorizationMetadata({
      tenantId: 'tenant-1', actorId, workItemId: 'WI-1', reviewTurnRef: 'RT-1',
    })).rejects.toThrow('REVIEW_OPENCLAW_ACTOR_CONTEXT_UNAVAILABLE');
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ['SUCCEEDED', '{"storedTask":true}'],
    [null, null],
  ])('reads the immediately previous turn without skipping an uncommitted attempt (%s)', async (status, taskEnvelopeJson) => {
    const query = jest.fn(async () => ({ rows: [[status, taskEnvelopeJson]] }));
    const repository = new ReviewConversationRepository(drizzle(query) as never);
    await expect(repository.loadPreviousOpenClawTask({
      reviewConversationId: 'RC-1', tenantId: 'tenant-1', actorId: 'actor-1',
      workItemId: 'WI-1', beforeTurnNo: 3,
    })).resolves.toEqual({ status, taskEnvelopeJson });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("set_config('app.user_id'");
    expect(sql).toContain('"review_turn"."actor_id" = "previous_review_actor_id"');
    expect(sql).toContain('inner join lateral');
    expect(sql).toContain('left join "action_attempt"');
    expect(sql).toContain('order by "review_turn"."turn_no" desc');
    expect(parameters).toEqual(expect.arrayContaining(['RC-1', 'tenant-1', 'actor-1', 'WI-1', 3]));
    expect(parameters).not.toContain('SUCCEEDED');
  });

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
    expect(sql).toContain('as "pending_review_actor_id"');
    expect(sql).toContain('"review_turn"."actor_id" = "pending_review_actor_id"');
    expect(sql).toContain('"review_conversation"."actor_id" = "pending_review_actor_id"');
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
