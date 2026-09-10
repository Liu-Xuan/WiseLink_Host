import 'reflect-metadata';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ReviewConversationRepository } from '../../server/modules/review-persistence/review-conversation.repository';

const requestRef = '44444444-4444-4444-8444-444444444444';
const input = {
  conversation: {
    reviewConversationId: 'RC-A',
    tenantId: 'tenant',
    actorId: 'actor',
    workItemId: 'WI-A',
  },
  requestId: `dialogue-${requestRef}`,
  userMessage: 'frozen raw input',
  purpose: 'UPDATE_ASSESSMENT' as const,
  executionRequested: true,
  includedDiscussionTurnIds: [],
  expectedInputRevision: 7,
  currentRevision: 7,
};
const original = {
  reviewTurnId: 'RT-original',
  userMessage: input.userMessage,
  candidateText: input.userMessage,
  purpose: input.purpose,
  executionRequested: true,
  includedDiscussionTurnIds: [],
  expectedInputRevision: 7,
  attachmentBindings: [],
  inputType: 'ENGINEER_TEXT',
  adoptionStatus: 'CANDIDATE_UNADOPTED',
};
function harness() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const values = jest.fn().mockResolvedValue(undefined);
  const database = {
    execute: jest.fn(async (query) => {
      const compiled = new PgDialect().sqlToQuery(query);
      queries.push(compiled);
      if (compiled.sql.includes('dialogue_assessment_request'))
        return [
          {
            request_json: JSON.stringify({
              expectedWorkItemRevision: 7,
              expectedWorkingRef: 'work-4',
            }),
            user_message: input.userMessage,
          },
        ];
      if (compiled.sql.includes('FROM work_item')) return [{ revision: 7 }];
      return [{ assessment_work_revision_id: 'work-4' }];
    }),
    insert: jest.fn(() => ({ values })),
  };
  const actors = {
    withActorTransaction: jest.fn(async (_actor, run) => run({ database })),
  };
  const outside = { insert: jest.fn(() => ({ values })) };
  const repository = new ReviewConversationRepository(
    outside as never,
    actors as never,
  );
  const load = jest.spyOn(
    repository as unknown as { loadTurnByRequest: () => Promise<unknown> },
    'loadTurnByRequest',
  );
  load
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValue(original);
  return { repository, database, actors, outside, values, load, queries };
}
describe('dialogue assessment atomic dispatch', () => {
  it('locks owner-bound request and work item and inserts inside the actor transaction', async () => {
    const h = harness();
    await expect(
      h.repository.appendTextTurn(input as never),
    ).resolves.toMatchObject({ replayed: false });
    expect(h.actors.withActorTransaction).toHaveBeenCalledWith(
      'actor',
      expect.any(Function),
    );
    expect(h.queries[0].sql).toContain('FOR UPDATE');
    expect(h.queries[0].params).toEqual([
      requestRef,
      'tenant',
      'actor',
      'WI-A',
      'RC-A',
    ]);
    expect(h.queries[1].sql).toContain('FROM work_item');
    expect(h.queries[1].sql).toContain('FOR UPDATE');
    expect(h.database.insert).toHaveBeenCalledTimes(1);
    expect(h.outside.insert).not.toHaveBeenCalled();
  });
  it.each(['working', 'revision', 'no-working'])(
    'rejects a changed base at real insertion (%s)',
    async (change) => {
      const h = harness();
      const execute = h.database.execute.getMockImplementation()!;
      h.database.execute.mockImplementation(async (q) => {
        const rows = await execute(q);
        const sql = h.queries.at(-1)!.sql;
        if (change === 'revision' && sql.includes('FROM work_item'))
          return [{ revision: 8 }] as never;
        if (sql.includes('FROM assessment_work_revision'))
          return change === 'no-working'
            ? []
            : ([{ assessment_work_revision_id: 'work-5' }] as never);
        return rows;
      });
      await expect(h.repository.appendTextTurn(input as never)).rejects.toThrow(
        'DIALOGUE_ASSESSMENT_BASE_CHANGED',
      );
      expect(h.database.insert).not.toHaveBeenCalled();
    },
  );
  it('recovers a concurrent original turn before checking the now newer base', async () => {
    const h = harness();
    h.load
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(original);
    await expect(h.repository.appendTextTurn(input as never)).resolves.toEqual({
      turn: original,
      replayed: true,
    });
    expect(h.queries).toHaveLength(1);
    expect(h.database.insert).not.toHaveBeenCalled();
  });
  it('returns an existing same-request turn without requiring its old base to remain current', async () => {
    const h = harness();
    h.load.mockReset().mockResolvedValue(original);
    await expect(h.repository.appendTextTurn(input as never)).resolves.toEqual({
      turn: original,
      replayed: true,
    });
    expect(h.actors.withActorTransaction).not.toHaveBeenCalled();
  });
  it('rejects an unbound dialogue request and changed frozen text', async () => {
    const h = harness();
    h.database.execute.mockResolvedValue([]);
    await expect(h.repository.appendTextTurn(input as never)).rejects.toThrow(
      'DIALOGUE_ASSESSMENT_BINDING_CHANGED',
    );
    expect(h.database.insert).not.toHaveBeenCalled();
    const other = harness();
    await expect(
      other.repository.appendTextTurn({
        ...input,
        userMessage: 'different',
      } as never),
    ).rejects.toThrow('DIALOGUE_ASSESSMENT_BINDING_CHANGED');
    expect(other.database.insert).not.toHaveBeenCalled();
  });
  it('keeps ordinary review dispatch on its existing path', async () => {
    const h = harness();
    h.load.mockReset().mockResolvedValueOnce(null).mockResolvedValue(original);
    await h.repository.appendTextTurn({
      ...input,
      requestId: 'ordinary',
    } as never);
    expect(h.outside.insert).toHaveBeenCalledTimes(1);
    expect(h.actors.withActorTransaction).not.toHaveBeenCalled();
  });
});
