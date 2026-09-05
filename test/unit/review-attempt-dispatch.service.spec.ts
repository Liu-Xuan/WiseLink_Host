import { canonicalJson } from '../../server/modules/action-attempt/action-attempt-envelope';
import {
  ReviewAttemptDispatchService,
  reviewTurnIdempotencyKey,
} from '../../server/modules/action-attempt/review-attempt-dispatch.service';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';

const binding = {
  tenantId: 'tenant-1',
  actorId: 'actor-1',
  workItemId: 'WI-1',
  reviewConversationId: 'RC-1',
  reviewTurnId: 'RT-2',
  inputRevision: 7,
};
const request = {
  ...binding,
  documentVersionId: 'DV-1',
  leaseOwner: 'service:hosted',
};
const projectionInput = {
  ...binding,
  executionRequested: true,
  createdAt: new Date('2026-09-05T01:00:00Z'),
};

describe('automatic Review dispatch', () => {
  it('persists an attempt before preparing context and records preparation failure for the page', async () => {
    const harness = setup();
    const buildInput = jest.fn(async () => {
      expect(harness.row()?.status).toBe('QUEUED');
      throw Object.assign(new Error('Document bytes unavailable'), {
        code: 'ARTIFACT_READ_FAILED',
      });
    });
    await expect(
      harness.service.prepareAndClaim({ ...request, buildInput }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_READ_FAILED' });
    expect(harness.lifecycle.reserveAndClaim).not.toHaveBeenCalled();
    await expect(
      harness.service.executionProjection(projectionInput),
    ).resolves.toMatchObject({
      status: 'FAILED',
      error: { code: 'ARTIFACT_READ_FAILED' },
    });
    await expect(
      harness.service.prepareAndClaim({ ...request, buildInput }),
    ).rejects.toMatchObject({ code: 'REVIEW_TURN_EXECUTION_ALREADY_FINISHED' });
    expect(buildInput).toHaveBeenCalledTimes(1);
  });

  it('uses the prepared input on resume instead of rebuilding it', async () => {
    const harness = setup();
    const buildInput = jest.fn(async () => ({
      modelInput: { question: 'Check the source' },
      sourceRefs: [],
    }));
    await harness.service.prepareAndClaim({ ...request, buildInput });
    await harness.service.prepareAndClaim({ ...request, buildInput });
    expect(harness.repository.reserve).toHaveBeenCalledTimes(1);
    expect(buildInput).toHaveBeenCalledTimes(1);
    expect(harness.lifecycle.reserveAndClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: reviewTurnIdempotencyKey(binding),
        inputRevision: 7,
      }),
    );
    const claimInput = harness.lifecycle.reserveAndClaim.mock.calls[0][0];
    await expect(claimInput.buildModelInput()).resolves.toEqual({
      question: 'Check the source',
    });
  });

  it('distinguishes explicit requested work, legacy saves and successful candidates', async () => {
    const harness = setup();
    await expect(
      harness.service.executionProjection({
        ...projectionInput,
        executionRequested: false,
      }),
    ).resolves.toBeNull();
    await expect(
      harness.service.executionProjection(projectionInput),
    ).resolves.toMatchObject({
      status: 'REQUESTED',
      attemptRef: null,
      startedAt: null,
      error: null,
    });
    await harness.service.prepareAndClaim({
      ...request,
      buildInput: async () => ({ modelInput: {}, sourceRefs: [] }),
    });
    Object.assign(harness.row()!, {
      status: 'SUCCEEDED',
      terminalReason: 'REVIEW_TURN_CANDIDATE_PERSISTED',
    });
    await expect(
      harness.service.executionProjection(projectionInput),
    ).resolves.toMatchObject({ status: 'SUCCEEDED', error: null });
  });

  it('waits for a valid current lease and makes expired work recoverable', async () => {
    const harness = setup();
    await harness.service.prepareAndClaim({
      ...request,
      buildInput: async () => ({ modelInput: {}, sourceRefs: [] }),
    });
    Object.assign(harness.row()!, {
      status: 'RUNNING',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(harness.service.isBusy(binding)).resolves.toBe(true);
    Object.assign(harness.row()!, { leaseExpiresAt: new Date(0) });
    await expect(harness.service.isBusy(binding)).resolves.toBe(false);
  });
});

function setup() {
  let row: ActionAttemptRow | null = null;
  const repository = {
    readLatestByExactIdempotency: jest.fn(async () => row),
    readActiveReviewForWorkItem: jest.fn(async () => row),
    terminalizeExpiredActiveForSuccessor: jest.fn(),
    nextAttemptNo: jest.fn(async () => 1),
    reserve: jest.fn(async (input) => {
      row = {
        ...input,
        taskEnvelopeJson: null,
        startedAt: null,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        terminalReason: null,
      };
      return { row, created: true };
    }),
    prepareReviewInput: jest.fn(async (_id, task) => {
      row!.taskEnvelopeJson = canonicalJson(task);
    }),
    failReviewPreparation: jest.fn(async (_id, errorCode) => {
      Object.assign(row!, {
        status: 'FAILED',
        errorCode,
        errorMessage: '上下文准备失败',
        completedAt: new Date(),
      });
    }),
  };
  const lifecycle = { reserveAndClaim: jest.fn(async (input) => input) };
  return {
    service: new ReviewAttemptDispatchService(
      repository as never,
      lifecycle as never,
    ),
    repository,
    lifecycle,
    row: () => row,
  };
}
