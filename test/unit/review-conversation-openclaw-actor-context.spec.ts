import { ReviewConversationRepository } from '../../server/modules/review-persistence/review-conversation.repository';

describe('ReviewConversationRepository OpenClaw actor context', () => {
  it('sets the Host-owned actor inside one transaction before any Review read', async () => {
    const executor = {
      execute: jest.fn(async () => [{ actorId: 'actor-1' }]),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn(async () => []) })),
        })),
      })),
    };
    const db = {
      transaction: jest.fn(async (operation) => operation(executor)),
    };
    const repository = new ReviewConversationRepository(db as never);

    await expect(
      repository.loadOpenClawTurnBinding({
        reviewConversationId: 'RC-1',
        requestId: 'request-1',
        tenantId: 'tenant-1',
        actorId: 'actor-1',
        workItemId: 'WI-1',
      }),
    ).resolves.toBeNull();

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.select).toHaveBeenCalledTimes(1);
    expect(executor.execute.mock.invocationCallOrder[0]).toBeLessThan(
      executor.select.mock.invocationCallOrder[0],
    );
  });

  it('fails closed before reading Review rows when local actor context is not established', async () => {
    const executor = {
      execute: jest.fn(async () => [{ actorId: 'actor-other' }]),
      select: jest.fn(),
    };
    const db = {
      transaction: jest.fn(async (operation) => operation(executor)),
    };
    const repository = new ReviewConversationRepository(db as never);

    await expect(
      repository.loadOpenClawTurnBinding({
        reviewConversationId: 'RC-1',
        requestId: 'request-1',
        tenantId: 'tenant-1',
        actorId: 'actor-1',
        workItemId: 'WI-1',
      }),
    ).rejects.toThrow('REVIEW_OPENCLAW_ACTOR_CONTEXT_UNAVAILABLE');
    expect(executor.select).not.toHaveBeenCalled();
  });

  it('never establishes a transaction for the public or service actor', async () => {
    const db = { transaction: jest.fn() };
    const repository = new ReviewConversationRepository(db as never);

    for (const actorId of ['-1', 'service:openclaw', '']) {
      await expect(
        repository.loadOpenClawTurnBinding({
          reviewConversationId: 'RC-1',
          requestId: 'request-1',
          tenantId: 'tenant-1',
          actorId,
          workItemId: 'WI-1',
        }),
      ).rejects.toThrow('REVIEW_OPENCLAW_ACTOR_CONTEXT_UNAVAILABLE');
    }
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
