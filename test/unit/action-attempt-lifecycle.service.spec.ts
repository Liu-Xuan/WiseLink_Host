import {
  canonicalJson,
  sealResultEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type { OpenClawResultEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope.types';
import { ActionAttemptLifecycleService } from '../../server/modules/action-attempt/action-attempt-lifecycle.service';
import type {
  ActionAttemptRow,
  ActionAttemptWorkItemBinding,
  ReserveAndClaimInput,
} from '../../server/modules/action-attempt/action-attempt.types';
import {
  ACTION_ATTEMPT_DEFAULT_DEADLINE_MS,
  ACTION_ATTEMPT_LEASE_MS,
} from '../../server/modules/action-attempt/action-attempt.types';

describe('ActionAttemptLifecycleService', () => {
  it('reserves once as QUEUED and lets the existing begin path claim the same task', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);
    let builds = 0;
    const input = reservationInput(async () => {
      builds += 1;
      return { controlled: true };
    });

    const reserved = await service.reserve(input);
    const reread = await service.readExactIdempotency({
      tenantId: 'tenant-test',
      workItemId: 'WI-test',
      taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
      baseRevision: 7,
      documentVersionId: 'DV-test',
      idempotencyKey: 'openclaw-v1:test',
    });
    const claimed = await service.reserveAndClaim(input);

    expect(reserved).toMatchObject({
      created: true,
      row: { status: 'QUEUED' },
    });
    expect(claimed).toMatchObject({
      created: false,
      attemptRef: reserved.task.operationRef,
      status: 'RUNNING',
    });
    expect(reread?.operationRef).toBe(reserved.task.operationRef);
    expect(repository.transitions).toEqual(['QUEUED', 'RUNNING']);
    expect(builds).toBe(1);
  });

  it('atomically refreshes and claims the same expired unstarted user-regeneration attempt', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-29T10:00:00.000Z'));
    try {
      const repository = new MemoryActionAttemptRepository();
      const service = new ActionAttemptLifecycleService(repository as never);
      const input: ReserveAndClaimInput = {
        ...reservationInput(async () => ({ controlled: true })),
        taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
        idempotencyKey:
          'openclaw-v1:overall:WI-test:7:USER_REQUESTED_REGENERATION:REQ-1',
        allowExpiredUnclaimedDeadlineRefresh: true,
      };
      const liveRepository = new MemoryActionAttemptRepository();
      const liveService = new ActionAttemptLifecycleService(
        liveRepository as never,
      );
      const liveReservation = await liveService.reserve(input);
      const liveClaim = await liveService.reserveAndClaim(input);
      expect(liveClaim.task.inputHash).toBe(liveReservation.task.inputHash);
      expect(liveClaim.task.deadline).toBe(liveReservation.task.deadline);

      const reserved = await service.reserve(input);
      const originalAttemptId = reserved.row.attemptId;
      const originalInputHash = reserved.task.inputHash;

      jest.setSystemTime(new Date('2026-08-29T11:00:01.000Z'));
      const claimed = await service.reserveAndClaim(input);

      expect(claimed).toMatchObject({
        created: false,
        attemptRef: reserved.task.operationRef,
        triggerRequestId: reserved.row.triggerRequestId,
        status: 'RUNNING',
        leaseGeneration: 1,
      });
      expect(repository.row).toMatchObject({
        attemptId: originalAttemptId,
        attemptNo: 1,
        status: 'RUNNING',
        claimCount: 1,
        retryCount: 0,
      });
      expect(claimed.task.inputHash).not.toBe(originalInputHash);
      expect(claimed.task.inputHash).toBe(repository.row?.taskInputHash);
      expect(claimed.task.deadline).toBe('2026-08-29T12:00:01.000Z');
      expect(claimed.task).toMatchObject({
        actionAttemptId: reserved.task.actionAttemptId,
        operationRef: reserved.task.operationRef,
        taskType: reserved.task.taskType,
        tenantId: reserved.task.tenantId,
        workItemId: reserved.task.workItemId,
        inputRevision: reserved.task.inputRevision,
        baseRevision: reserved.task.baseRevision,
        documentVersionId: reserved.task.documentVersionId,
        idempotencyKey: reserved.task.idempotencyKey,
        modelInput: reserved.task.modelInput,
      });
      expect(repository.row?.deadlineAt.toISOString()).toBe(
        claimed.task.deadline,
      );
      expect(repository.transitions).toEqual(['QUEUED', 'RUNNING']);

      const driftRepository = new MemoryActionAttemptRepository();
      const driftService = new ActionAttemptLifecycleService(
        driftRepository as never,
      );
      jest.setSystemTime(new Date('2026-08-29T12:30:00.000Z'));
      const driftReservation = await driftService.reserve(input);
      const driftInputHash = driftReservation.task.inputHash;
      jest.setSystemTime(new Date('2026-08-29T13:30:01.000Z'));
      driftRepository.beforeExpiredUnstartedClaim = () => {
        driftRepository.binding.revision += 1;
      };
      await expect(driftService.reserveAndClaim(input)).rejects.toMatchObject({
        code: 'ACTION_ATTEMPT_CONCURRENCY_SLOTS_EXHAUSTED',
      });
      expect(driftRepository.row).toMatchObject({
        attemptId: driftReservation.row.attemptId,
        status: 'QUEUED',
        claimCount: 0,
        leaseGeneration: 0,
        taskInputHash: driftInputHash,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the default fail-closed timeout for expired queues without an explicit refresh grant', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-29T10:00:00.000Z'));
    try {
      const repository = new MemoryActionAttemptRepository();
      const service = new ActionAttemptLifecycleService(repository as never);
      const input = reservationInput(async () => ({ controlled: true }));
      await service.reserve(input);

      jest.setSystemTime(new Date('2026-08-29T11:00:01.000Z'));
      await expect(service.reserveAndClaim(input)).rejects.toMatchObject({
        code: 'ACTION_ATTEMPT_TIMED_OUT',
      });
      expect(repository.row?.status).toBe('TIMED_OUT');
      expect(repository.transitions).toEqual(['QUEUED', 'TIMED_OUT']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('persists QUEUED before claim and replays the same live fence', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);
    let builds = 0;
    const input = reservationInput(async () => {
      builds += 1;
      return { controlled: true };
    });

    const first = await service.reserveAndClaim(input);
    const replay = await service.reserveAndClaim(input);

    expect(repository.transitions).toEqual(['QUEUED', 'RUNNING']);
    expect(first).toMatchObject({
      created: true,
      status: 'RUNNING',
      leaseGeneration: 1,
    });
    expect(repository.row?.executorSessionKey).toBe(
      `g2-action-attempt:${first.attemptRef}`,
    );
    expect(replay).toMatchObject({
      created: false,
      attemptRef: first.attemptRef,
      leaseToken: first.leaseToken,
      leaseGeneration: first.leaseGeneration,
    });
    expect(builds).toBe(1);
  });

  it('gives hosted model work a 30-minute lease within a one-hour deadline', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);

    const claim = await service.reserveAndClaim(
      reservationInput(async () => ({ controlled: true })),
    );

    expect(ACTION_ATTEMPT_LEASE_MS).toBe(30 * 60_000);
    expect(ACTION_ATTEMPT_DEFAULT_DEADLINE_MS).toBe(60 * 60_000);
    expect(
      new Date(claim.leaseExpiresAt).getTime() -
        repository.row!.createdAt.getTime(),
    ).toBe(ACTION_ATTEMPT_LEASE_MS);
    expect(
      repository.row!.deadlineAt.getTime() -
        repository.row!.createdAt.getTime(),
    ).toBe(ACTION_ATTEMPT_DEFAULT_DEADLINE_MS);
  });

  it('crosses a durable COMMITTING cutoff and reconciles duplicate delivery', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);
    const input = reservationInput(async () => ({ controlled: true }));
    const claim = await service.reserveAndClaim(input);
    const result = successResult(claim.task);
    const fence = {
      attemptRef: claim.attemptRef,
      tenantId: 'tenant-test',
      workItemId: 'WI-test',
      principalId: 'openclaw-real',
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      result,
    };

    const prepared = await service.prepareCommit(fence);
    expect(prepared.row.status).toBe('COMMITTING');
    await expect(service.reserveAndClaim(input)).resolves.toMatchObject({
      attemptRef: claim.attemptRef,
      status: 'COMMITTING',
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      recoveryResult: result,
    });
    await expect(
      service.prepareCommit({
        ...fence,
        leaseToken: '00000000-0000-4000-8000-999999999999',
      }),
    ).rejects.toMatchObject({ code: 'ACTION_ATTEMPT_LEASE_FENCE_REJECTED' });
    await expect(
      service.requestCancel({
        attemptRef: claim.attemptRef,
        tenantId: 'tenant-test',
        workItemId: 'WI-test',
        reason: 'too late',
      }),
    ).rejects.toMatchObject({ code: 'ACTION_ATTEMPT_CANCEL_TOO_LATE' });

    await service.finishProjectionSuccess(prepared);
    const duplicate = await service.prepareCommit(fence);
    expect(duplicate).toMatchObject({
      recovery: true,
      row: { status: 'SUCCEEDED' },
    });
    await expect(
      service.finishProjectionSuccess(duplicate),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      projectionApplied: true,
    });
    expect(repository.transitions).toEqual([
      'QUEUED',
      'RUNNING',
      'COMMITTING',
      'SUCCEEDED',
    ]);
  });

  it('terminalizes a Host-evaluated missing-fact candidate as WAITING_INPUT after COMMITTING', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);
    const claim = await service.reserveAndClaim(
      reservationInput(async () => ({ controlled: true })),
    );
    const result = successResult(claim.task);
    const prepared = await service.prepareCommit({
      attemptRef: claim.attemptRef,
      tenantId: 'tenant-test',
      workItemId: 'WI-test',
      principalId: 'openclaw-real',
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      result,
    });

    await expect(
      service.finishProjectionWaitingInput(prepared),
    ).resolves.toMatchObject({
      status: 'WAITING_INPUT',
      projectionApplied: true,
      terminalReason: 'HOST_MISSING_CONTROLLED_FACTS',
    });
    expect(repository.transitions).toEqual([
      'QUEUED',
      'RUNNING',
      'COMMITTING',
      'WAITING_INPUT',
    ]);
    expect(repository.row?.resultContentHash).toBe(result.contentHash);
  });

  it('fails closed when current revision regresses below base revision', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);
    const claim = await service.reserveAndClaim(
      reservationInput(async () => ({ controlled: true })),
    );
    repository.binding.revision = claim.task.baseRevision - 1;

    await expect(
      service.prepareCommit({
        attemptRef: claim.attemptRef,
        tenantId: 'tenant-test',
        workItemId: 'WI-test',
        principalId: 'openclaw-real',
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
        result: successResult(claim.task),
      }),
    ).rejects.toMatchObject({ code: 'WORK_ITEM_REVISION_REGRESSED' });
    expect(repository.row?.status).toBe('FAILED');
    expect(repository.row?.terminalReason).toBe('WORK_ITEM_REVISION_REGRESSED');
    expect(repository.row?.projectionApplied).toBe(false);
  });

  it.each([
    {
      revisionDelta: 1,
      status: 'CONFLICT',
      code: 'WORK_ITEM_REVISION_CONFLICT',
    },
    { revisionDelta: 2, status: 'OBSOLETE', code: 'WORK_ITEM_RESULT_OBSOLETE' },
  ])(
    'terminalizes revision drift +$revisionDelta as $status',
    async ({ revisionDelta, status, code }) => {
      const repository = new MemoryActionAttemptRepository();
      const service = new ActionAttemptLifecycleService(repository as never);
      const claim = await service.reserveAndClaim(
        reservationInput(async () => ({ controlled: true })),
      );
      repository.binding.revision = claim.task.baseRevision + revisionDelta;

      await expect(
        service.prepareCommit({
          attemptRef: claim.attemptRef,
          tenantId: 'tenant-test',
          workItemId: 'WI-test',
          principalId: 'openclaw-real',
          leaseToken: claim.leaseToken,
          leaseGeneration: claim.leaseGeneration,
          result: successResult(claim.task),
        }),
      ).rejects.toMatchObject({ code });
      expect(repository.row).toMatchObject({
        status,
        projectionApplied: false,
      });
    },
  );

  it('rejects corrupt COMMITTING readback instead of treating it as {}', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);
    const claim = await service.reserveAndClaim(
      reservationInput(async () => ({ controlled: true })),
    );
    const result = successResult(claim.task);
    const prepared = await service.prepareCommit({
      attemptRef: claim.attemptRef,
      tenantId: 'tenant-test',
      workItemId: 'WI-test',
      principalId: 'openclaw-real',
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      result,
    });
    repository.row = { ...prepared.row, resultEnvelopeJson: '{broken' };

    await expect(
      service.prepareCommit({
        attemptRef: claim.attemptRef,
        tenantId: 'tenant-test',
        workItemId: 'WI-test',
        principalId: 'openclaw-real',
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
        result,
      }),
    ).rejects.toThrow('RESULT_ENVELOPE_JSON_INVALID');
  });

  it('recovers an expired lease with a new monotonically fenced claim', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);
    const input = reservationInput(async () => ({ controlled: true }));
    const first = await service.reserveAndClaim(input);
    repository.row = {
      ...repository.requiredRow(),
      leaseExpiresAt: new Date(Date.now() - 1),
    };

    const recovered = await service.reserveAndClaim(input);
    expect(recovered.leaseToken).not.toBe(first.leaseToken);
    expect(recovered.leaseGeneration).toBe(2);
    expect(repository.row?.retryCount).toBe(1);
    expect(repository.transitions).toEqual([
      'QUEUED',
      'RUNNING',
      'RETRY_SCHEDULED',
      'RUNNING',
    ]);
  });

  it('rejects an expired candidate lease without mutating the attempt', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);
    const claim = await service.reserveAndClaim(
      reservationInput(async () => ({ controlled: true })),
    );
    repository.row = {
      ...repository.requiredRow(),
      leaseExpiresAt: new Date(Date.now() - 1),
    };
    const before = structuredClone(repository.requiredRow());
    const transitionsBefore = [...repository.transitions];

    await expect(
      service.prepareCommit({
        attemptRef: claim.attemptRef,
        tenantId: 'tenant-test',
        workItemId: 'WI-test',
        principalId: 'openclaw-real',
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
        result: successResult(claim.task),
        failClosedWithoutRejectionMutation: true,
      }),
    ).rejects.toMatchObject({ code: 'ACTION_ATTEMPT_LEASE_EXPIRED' });
    expect(repository.row).toEqual(before);
    expect(repository.transitions).toEqual(transitionsBefore);
  });

  it('terminalizes a running attempt when its deadline expires before heartbeat', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);
    const claim = await service.reserveAndClaim(
      reservationInput(async () => ({ controlled: true })),
    );
    repository.row = {
      ...repository.requiredRow(),
      deadlineAt: new Date(Date.now() - 1),
    };

    await expect(
      service.heartbeat({
        attemptRef: claim.attemptRef,
        tenantId: 'tenant-test',
        workItemId: 'WI-test',
        principalId: 'openclaw-real',
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
      }),
    ).rejects.toMatchObject({ code: 'ACTION_ATTEMPT_TIMED_OUT' });
    expect(repository.row?.status).toBe('TIMED_OUT');
    expect(repository.row?.terminalReason).toBe(
      'ACTION_ATTEMPT_DEADLINE_EXCEEDED',
    );
  });

  it('stores a failed ResultEnvelope as an explicit terminal receipt', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);
    const claim = await service.reserveAndClaim(
      reservationInput(async () => ({ controlled: true })),
    );
    const prepared = await service.prepareCommit({
      attemptRef: claim.attemptRef,
      tenantId: 'tenant-test',
      workItemId: 'WI-test',
      principalId: 'openclaw-real',
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      result: failedResult(claim.task),
    });

    expect(service.projectTerminal(prepared.row)).toMatchObject({
      attemptRef: claim.attemptRef,
      status: 'FAILED',
      projectionApplied: false,
      terminalReason: 'OPENCLAW_HTTP_503',
    });
    expect(repository.row?.resultEnvelopeJson).not.toBe('{}');
  });

  it('terminalizes a deterministic Host Result Gate rejection without losing the envelope', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);
    const claim = await service.reserveAndClaim(
      reservationInput(async () => ({ controlled: true })),
    );
    const result = successResult(claim.task);
    const prepared = await service.prepareCommit({
      attemptRef: claim.attemptRef,
      tenantId: 'tenant-test',
      workItemId: 'WI-test',
      principalId: 'openclaw-real',
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      result,
    });

    await expect(
      service.finishResultGateFailure(
        prepared,
        new Error('BASE_ONE_SHOT_RULE_RESULT_ROW_BUDGET_EXCEEDED:2'),
      ),
    ).resolves.toMatchObject({
      status: 'FAILED',
      projectionApplied: false,
      terminalReason: 'HOST_RESULT_GATE_REJECTED',
    });
    expect(repository.row).toMatchObject({
      status: 'FAILED',
      errorCode: 'BASE_ONE_SHOT_RULE_RESULT_ROW_BUDGET_EXCEEDED',
      errorMessage: 'BASE_ONE_SHOT_RULE_RESULT_ROW_BUDGET_EXCEEDED:2',
      resultContentHash: result.contentHash,
    });
    expect(repository.row?.resultEnvelopeJson).toBe(canonicalJson(result));
  });

  it('cancels RUNNING atomically and fences the stale executor', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);
    const claim = await service.reserveAndClaim(
      reservationInput(async () => ({ controlled: true })),
    );

    await expect(
      service.requestCancel({
        attemptRef: claim.attemptRef,
        tenantId: 'tenant-test',
        workItemId: 'WI-test',
        reason: 'operator cancelled isolated DEV run',
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(
      service.prepareCommit({
        attemptRef: claim.attemptRef,
        tenantId: 'tenant-test',
        workItemId: 'WI-test',
        principalId: 'openclaw-real',
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
        result: successResult(claim.task),
      }),
    ).rejects.toMatchObject({ code: 'ACTION_ATTEMPT_ALREADY_CANCELLED' });
    expect(repository.row?.leaseToken).toBeNull();
  });

  it('terminalizes a persisted RUNNING cancellation marker before commit', async () => {
    const repository = new MemoryActionAttemptRepository();
    const service = new ActionAttemptLifecycleService(repository as never);
    const claim = await service.reserveAndClaim(
      reservationInput(async () => ({ controlled: true })),
    );
    repository.row = {
      ...repository.requiredRow(),
      cancelRequestedAt: new Date(),
      cancelReason: 'persisted cancellation marker',
    };

    await expect(
      service.prepareCommit({
        attemptRef: claim.attemptRef,
        tenantId: 'tenant-test',
        workItemId: 'WI-test',
        principalId: 'openclaw-real',
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
        result: successResult(claim.task),
      }),
    ).rejects.toMatchObject({ code: 'ACTION_ATTEMPT_CANCELLED' });
    expect(repository.row).toMatchObject({
      status: 'CANCELLED',
      terminalReason: 'CANCELLED_BEFORE_COMMIT',
      projectionApplied: false,
    });
    expect(repository.row?.errorCode ?? null).toBeNull();
    expect(repository.row?.errorMessage ?? null).toBeNull();
  });
});

class MemoryActionAttemptRepository {
  binding: ActionAttemptWorkItemBinding = {
    workItemId: 'WI-test',
    tenantId: 'tenant-test',
    documentVersionId: 'DV-test',
    revision: 7,
    projectionJson: '{}',
  };
  row: ActionAttemptRow | null = null;
  transitions: string[] = [];
  beforeExpiredUnstartedClaim: (() => void) | null = null;

  async readWorkItemBinding() {
    return structuredClone(this.binding);
  }

  async nextAttemptNo() {
    return 1;
  }

  async readByIdempotency(input: { idempotencyKey: string }) {
    return this.row?.idempotencyKey === input.idempotencyKey &&
      ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(
        this.row.status,
      )
      ? this.row
      : null;
  }

  async readLatestByExactIdempotency(input: { idempotencyKey: string }) {
    return this.row?.idempotencyKey === input.idempotencyKey ? this.row : null;
  }

  async readByOperationRef(operationRef: string) {
    return this.row?.operationRef === operationRef ? this.row : null;
  }

  async readByAttemptId(attemptId: string) {
    return this.row?.attemptId === attemptId ? this.row : null;
  }

  async reserve(value: Record<string, unknown>) {
    const row = newRow(value);
    this.row = row;
    this.transitions.push(row.status);
    return { row, created: true };
  }

  async claimExact(input: {
    attemptId: string;
    expectedStatus: string;
    leaseOwner: string;
    leaseSlot: number;
    now: Date;
    leaseMs: number;
  }) {
    const row = this.requiredRow();
    if (
      row.attemptId !== input.attemptId ||
      row.status !== input.expectedStatus
    ) {
      return null;
    }
    this.row = {
      ...row,
      status: 'RUNNING',
      claimCount: row.claimCount + 1,
      leaseOwner: input.leaseOwner,
      leaseToken: `00000000-0000-4000-8000-${String(row.leaseGeneration + 1).padStart(12, '0')}`,
      leaseGeneration: row.leaseGeneration + 1,
      leaseSlot: input.leaseSlot,
      executorSessionKey: `g2-action-attempt:${row.operationRef}`,
      leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
      lastHeartbeatAt: input.now,
      nextAttemptAt: null,
      startedAt: row.startedAt ?? input.now,
      updatedAt: input.now,
    };
    this.transitions.push('RUNNING');
    return this.row;
  }

  async claimExpiredUnstartedExact(input: {
    attemptId: string;
    attemptNo: number;
    triggerRequestId: string;
    tenantId: string;
    baseRevision: number;
    documentVersionId: string;
    idempotencyKey: string;
    expectedTaskInputHash: string;
    expectedClaimCount: number;
    expectedRetryCount: number;
    expectedLeaseGeneration: number;
    operationRef: string;
    leaseOwner: string;
    leaseSlot: number;
    now: Date;
    leaseMs: number;
    refreshedDeadlineAt: Date;
    taskEnvelopeJson: string;
    taskInputHash: string;
  }) {
    this.beforeExpiredUnstartedClaim?.();
    this.beforeExpiredUnstartedClaim = null;
    const row = this.requiredRow();
    if (
      row.attemptId !== input.attemptId ||
      row.attemptNo !== input.attemptNo ||
      row.triggerRequestId !== input.triggerRequestId ||
      row.status !== 'QUEUED' ||
      row.actionType !== 'OPENCLAW_OVERALL_SYNTHESIS' ||
      row.tenantId !== input.tenantId ||
      row.baseRevision !== input.baseRevision ||
      row.inputRevision !== input.baseRevision ||
      row.documentVersionId !== input.documentVersionId ||
      row.idempotencyKey !== input.idempotencyKey ||
      row.taskInputHash !== input.expectedTaskInputHash ||
      this.binding.tenantId !== input.tenantId ||
      this.binding.revision !== input.baseRevision ||
      this.binding.documentVersionId !== input.documentVersionId ||
      row.claimCount !== input.expectedClaimCount ||
      row.retryCount !== input.expectedRetryCount ||
      row.leaseGeneration !== input.expectedLeaseGeneration ||
      row.operationRef !== input.operationRef ||
      row.startedAt !== null ||
      row.leaseOwner !== null ||
      row.leaseToken !== null ||
      row.leaseExpiresAt !== null ||
      row.lastHeartbeatAt !== null ||
      row.leaseSlot !== null ||
      row.executorSessionKey !== null ||
      row.commitStartedAt !== null ||
      row.resultEnvelopeJson !== null ||
      row.resultContentHash !== null ||
      row.completedAt !== null ||
      row.terminalReason !== null ||
      (row.errorCode ?? null) !== null ||
      (row.errorMessage ?? null) !== null ||
      row.projectionApplied ||
      row.cancelRequestedAt !== null ||
      row.cancelReason !== null ||
      !row.deadlineAt ||
      row.deadlineAt > input.now
    ) {
      return null;
    }
    this.row = {
      ...row,
      status: 'RUNNING',
      claimCount: row.claimCount + 1,
      leaseOwner: input.leaseOwner,
      leaseToken: `00000000-0000-4000-8000-${String(row.leaseGeneration + 1).padStart(12, '0')}`,
      leaseGeneration: row.leaseGeneration + 1,
      leaseSlot: input.leaseSlot,
      executorSessionKey: `g2-action-attempt:${row.operationRef}`,
      leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
      lastHeartbeatAt: input.now,
      nextAttemptAt: null,
      startedAt: input.now,
      deadlineAt: input.refreshedDeadlineAt,
      taskEnvelopeJson: input.taskEnvelopeJson,
      taskInputHash: input.taskInputHash,
      errorCode: null,
      errorMessage: null,
      updatedAt: input.now,
    };
    this.transitions.push('RUNNING');
    return this.row;
  }

  async heartbeat() {
    return true;
  }

  async markCommitting(input: {
    result: OpenClawResultEnvelope;
    now: Date;
    recoveryLeaseMs: number;
  }) {
    const row = this.requiredRow();
    if (row.status !== 'RUNNING' || row.cancelRequestedAt) return null;
    this.row = {
      ...row,
      status: 'COMMITTING',
      resultEnvelopeJson: canonicalJson(input.result),
      resultContentHash: input.result.contentHash,
      commitStartedAt: input.now,
      leaseExpiresAt: new Date(input.now.getTime() + input.recoveryLeaseMs),
      updatedAt: input.now,
    };
    this.transitions.push('COMMITTING');
    return this.row;
  }

  async finishTerminal(input: {
    fromStatus: string;
    status: string;
    terminalReason: string;
    result?: OpenClawResultEnvelope;
    projectionApplied?: boolean;
    errorCode?: string;
    errorMessage?: string;
    now: Date;
  }) {
    const row = this.requiredRow();
    if (row.status !== input.fromStatus) return false;
    this.row = {
      ...row,
      status: input.status,
      terminalReason: input.terminalReason,
      resultEnvelopeJson: input.result
        ? canonicalJson(input.result)
        : row.resultEnvelopeJson,
      resultContentHash: input.result?.contentHash ?? row.resultContentHash,
      projectionApplied: input.projectionApplied ?? false,
      errorCode: input.errorCode ?? row.errorCode,
      errorMessage: input.errorMessage ?? row.errorMessage,
      completedAt: input.now,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      leaseSlot: null,
      updatedAt: input.now,
    };
    this.transitions.push(input.status);
    return true;
  }

  async finishResultGateFailure(input: {
    leaseToken: string;
    leaseGeneration: number;
    result: OpenClawResultEnvelope;
    errorCode: string;
    errorMessage: string;
    now: Date;
  }) {
    const row = this.requiredRow();
    if (
      row.leaseToken !== input.leaseToken ||
      row.leaseGeneration !== input.leaseGeneration
    ) {
      return false;
    }
    return this.finishTerminal({
      fromStatus: 'COMMITTING',
      status: 'FAILED',
      terminalReason: 'HOST_RESULT_GATE_REJECTED',
      result: input.result,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      now: input.now,
    });
  }

  async recoverExpiredRunning(input: { now: Date }) {
    const row = this.requiredRow();
    if (
      row.status !== 'RUNNING' ||
      !row.leaseExpiresAt ||
      row.leaseExpiresAt > input.now
    ) {
      return false;
    }
    this.row = {
      ...row,
      status: 'RETRY_SCHEDULED',
      retryCount: row.retryCount + 1,
      nextAttemptAt: input.now,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      leaseSlot: null,
      updatedAt: input.now,
    };
    this.transitions.push('RETRY_SCHEDULED');
    return true;
  }

  async requestCancel(input: { reason: string; now: Date }) {
    const row = this.requiredRow();
    if (row.status === 'COMMITTING') return 'TOO_LATE';
    if (!['QUEUED', 'RUNNING', 'RETRY_SCHEDULED'].includes(row.status)) {
      return 'NOT_ACTIVE';
    }
    this.row = {
      ...row,
      status: 'CANCELLED',
      cancelRequestedAt: input.now,
      cancelReason: input.reason,
      terminalReason: 'CANCELLED_BY_REQUEST',
      completedAt: input.now,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      leaseSlot: null,
      updatedAt: input.now,
    };
    this.transitions.push('CANCELLED');
    return 'CANCELLED';
  }

  requiredRow(): ActionAttemptRow {
    if (!this.row) throw new Error('missing row');
    return this.row;
  }
}

function reservationInput(
  buildModelInput: ReserveAndClaimInput['buildModelInput'],
): ReserveAndClaimInput {
  return {
    workItemId: 'WI-test',
    taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    tenantId: 'tenant-test',
    actorUserId: 'service:openclaw-main',
    leaseOwner: 'openclaw-real',
    documentVersionId: 'DV-test',
    inputRevision: 7,
    baseRevision: 7,
    idempotencyKey: 'openclaw-v1:test',
    sourceRefs: [{ ref: 'artifact://source', sha256: 'a'.repeat(64) }],
    buildModelInput,
  };
}

function successResult(
  task: Awaited<
    ReturnType<ActionAttemptLifecycleService['reserveAndClaim']>
  >['task'],
): OpenClawResultEnvelope {
  return sealResultEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
    actionAttemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    taskType: task.taskType,
    workItemId: task.workItemId,
    baseRevision: task.baseRevision,
    status: 'SUCCEEDED',
    businessOutcome: 'CANDIDATE_READY',
    candidateStatus: null,
    modelOutput: '{"candidate":true}',
    outputArtifactRefs: [],
    sourceRefs: [...task.sourceRefs],
    factsConsidered: [],
    missingInputs: [],
    conflicts: [],
    warnings: [],
    modelVersion: 'openclaw-real',
    promptVersion: 'prompt-v1',
    skillVersion: 'skill-v1',
    toolVersions: { host: '006146b' },
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
    errorCode: null,
    errorDetail: null,
  });
}

function failedResult(
  task: Awaited<
    ReturnType<ActionAttemptLifecycleService['reserveAndClaim']>
  >['task'],
): OpenClawResultEnvelope {
  return sealResultEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
    actionAttemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    taskType: task.taskType,
    workItemId: task.workItemId,
    baseRevision: task.baseRevision,
    status: 'FAILED',
    businessOutcome: 'NOT_PRODUCED',
    candidateStatus: null,
    modelOutput: null,
    outputArtifactRefs: [],
    sourceRefs: [...task.sourceRefs],
    factsConsidered: [],
    missingInputs: [],
    conflicts: [],
    warnings: [],
    modelVersion: 'openclaw-execution-failed',
    promptVersion: 'prompt-v1',
    skillVersion: 'skill-v1',
    toolVersions: { host: '006146b' },
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 0 },
    errorCode: 'OPENCLAW_HTTP_503',
    errorDetail: 'Gateway unavailable after bounded retry.',
  });
}

function newRow(value: Record<string, unknown>): ActionAttemptRow {
  const now = value.createdAt as Date;
  return {
    attemptId: String(value.attemptId),
    operationRef: String(value.operationRef),
    triggerRequestId: String(value.triggerRequestId),
    workItemId: String(value.workItemId),
    actionType: String(value.actionType),
    attemptNo: Number(value.attemptNo),
    status: String(value.status),
    requestOrigin: String(value.requestOrigin),
    tenantId: String(value.tenantId),
    actorUserId: String(value.actorUserId),
    priority: Number(value.priority),
    inputRevision: Number(value.inputRevision),
    baseRevision: Number(value.baseRevision),
    documentVersionId: String(value.documentVersionId),
    taskEnvelopeJson: String(value.taskEnvelopeJson),
    taskInputHash: String(value.taskInputHash),
    resultEnvelopeJson: null,
    resultContentHash: null,
    idempotencyKey: String(value.idempotencyKey),
    claimCount: 0,
    retryCount: 0,
    maxAttempts: Number(value.maxAttempts),
    leaseOwner: null,
    leaseToken: null,
    leaseGeneration: 0,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    nextAttemptAt: value.nextAttemptAt as Date,
    deadlineAt: value.deadlineAt as Date,
    cancelRequestedAt: null,
    cancelReason: null,
    terminalReason: null,
    projectionApplied: false,
    executorSessionKey: null,
    commitStartedAt: null,
    leaseSlot: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
