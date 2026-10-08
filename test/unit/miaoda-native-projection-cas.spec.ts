import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { MiaodaWorkItemRepository } from '@server/modules/work-item/miaoda-work-item.repository';
import { MiaodaCanonicalWorkItemRegistrarAdapter } from '@server/modules/work-item/miaoda-canonical-work-item-registrar.adapter';
import { tdmsNativeEvidenceFixture } from './fixtures/tdms-native-evidence.fixture';

type CasInput = Parameters<MiaodaWorkItemRepository['compareAndSet']>[0];
type Carrier = 'baseRules' | 'overallSynthesis' | 'stagedBaseRules';

function projection(carrier?: Carrier): CasInput['next'] {
  const readingResult = { evidence: [tdmsNativeEvidenceFixture()] };
  return {
    workItemId: 'WI-NATIVE-CAS',
    requestId: 'REQ-NATIVE-CAS',
    phase: 'CANDIDATE_READBACK_VERIFIED',
    source: { documentVersionId: 'DV-NATIVE-CAS' },
    classification: { status: 'CONFIRMED', normalizedFamily: 'SB' },
    package: null,
    failure: null,
    recordingFailure: null,
    ...(carrier === 'stagedBaseRules'
      ? {
          configurationEvidenceReevaluation: {
            stagedBundle: { baseRules: { readingResult } },
          },
        }
      : carrier
        ? { integratedAssessment: { [carrier]: { readingResult } } }
        : {}),
  } as unknown as CasInput['next'];
}

/** Offline database protocol double: stages writes until the real transaction
 * callback returns. This exercises production CAS, not a replacement CAS guard. */
function harness() {
  const events: string[] = [];
  let stored: CanonicalWorkItemProjection | null = null;
  let pending: CanonicalWorkItemProjection | null = null;
  let onUpdate: (() => Promise<void>) | undefined;
  const returning = jest.fn(async () => {
    events.push('update');
    await onUpdate?.();
    return [{ workItemId: 'WI-NATIVE-CAS' }];
  });
  const update = jest.fn(() => ({
    set: (value: { projectionJson: string }) => {
      pending = JSON.parse(value.projectionJson) as CanonicalWorkItemProjection;
      return { where: () => ({ returning }) };
    },
  }));
  const database = {
    select: jest.fn(() => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            for: async () => [
              {
                revision: 4,
                documentVersionId: 'DV-NATIVE-CAS',
                requestedByUserId: 'owner',
              },
            ],
          }),
        }),
      }),
    })),
    execute: jest.fn(async () => {
      events.push('latest-work');
      return [
        {
          workRevisionRef: 'JAWR-NATIVE-4',
          documentVersionId: 'DV-NATIVE-CAS',
        },
      ];
    }),
    update,
  };
  const transaction = jest.fn(
    async (operation: (db: typeof database) => Promise<unknown>) => {
      events.push('transaction');
      try {
        const result = await operation(database);
        stored = pending;
        events.push('commit');
        return result;
      } catch (error) {
        pending = null;
        events.push('rollback');
        throw error;
      }
    },
  );
  const repository = new MiaodaWorkItemRepository({
    transaction,
    update,
  } as never);
  const registrar = new MiaodaCanonicalWorkItemRegistrarAdapter(repository);
  const input: CasInput = {
    workItemId: 'WI-NATIVE-CAS',
    expectedRevision: 4,
    next: projection('baseRules'),
    syncPrimaryAttempt: false,
    jobAidWorkRevisionGuard: {
      tenantId: 'fixture-tenant',
      workRevisionRef: 'JAWR-NATIVE-4',
    },
  };
  return {
    repository,
    registrar,
    input,
    database,
    transaction,
    update,
    events,
    stored: () => stored,
    onUpdate: (callback: () => Promise<void>) => {
      onUpdate = callback;
    },
  };
}

describe('native projection transaction CAS guards', () => {
  it.each<Carrier>(['baseRules', 'overallSynthesis', 'stagedBaseRules'])(
    'denies %s native carrier without a native authorization guard before database I/O',
    async (carrier) => {
      const h = harness();
      await expect(
        h.registrar.compareAndSet({ ...h.input, next: projection(carrier) }),
      ).rejects.toThrow('TDMS_NATIVE_PROJECTION_AUTHORIZATION_REQUIRED');
      expect(h.transaction).not.toHaveBeenCalled();
      expect(h.update).not.toHaveBeenCalled();
    },
  );

  it('denies a native callback without the locked exact-work guard', async () => {
    const h = harness();
    const { jobAidWorkRevisionGuard: _guard, ...input } = h.input;
    await expect(
      h.repository.compareAndSet({
        ...input,
        nativeEvidenceGuard: async () => undefined,
      }),
    ).rejects.toThrow('TDMS_NATIVE_PROJECTION_AUTHORIZATION_REQUIRED');
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('passes the identical transaction database before and after the awaited update through the registrar', async () => {
    const h = harness();
    const guard = jest.fn(async (database: PostgresJsDatabase) => {
      expect(database).toBe(h.database);
      h.events.push('native-guard');
    });
    await expect(
      h.registrar.compareAndSet({ ...h.input, nativeEvidenceGuard: guard }),
    ).resolves.toMatchObject({ workItemId: 'WI-NATIVE-CAS', revision: 5 });
    expect(guard).toHaveBeenCalledTimes(2);
    expect(h.events).toEqual([
      'transaction',
      'latest-work',
      'native-guard',
      'update',
      'native-guard',
      'commit',
    ]);
    expect(h.stored()?.revision).toBe(5);
  });

  it('rolls back when native permission is revoked across the awaited database update', async () => {
    const h = harness();
    let allowed = true;
    h.onUpdate(async () => {
      await Promise.resolve();
      allowed = false;
    });
    const guard = jest.fn(async (database: PostgresJsDatabase) => {
      expect(database).toBe(h.database);
      h.events.push('native-guard');
      if (!allowed) throw new Error('FIXTURE_NATIVE_ACCESS_REVOKED');
    });
    await expect(
      h.repository.compareAndSet({ ...h.input, nativeEvidenceGuard: guard }),
    ).rejects.toThrow('FIXTURE_NATIVE_ACCESS_REVOKED');
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(h.events.at(-1)).toBe('rollback');
    expect(h.stored()).toBeNull();
  });

  it('does not write if authorization is already revoked inside the locked transaction', async () => {
    const h = harness();
    await expect(
      h.repository.compareAndSet({
        ...h.input,
        nativeEvidenceGuard: async () => {
          throw new Error('FIXTURE_NATIVE_ACCESS_REVOKED');
        },
      }),
    ).rejects.toThrow('FIXTURE_NATIVE_ACCESS_REVOKED');
    expect(h.update).not.toHaveBeenCalled();
    expect(h.stored()).toBeNull();
  });

  it('keeps ordinary CAS on its original unguarded path', async () => {
    const h = harness();
    await expect(
      h.repository.compareAndSet({
        workItemId: h.input.workItemId,
        expectedRevision: 4,
        next: projection(),
        syncPrimaryAttempt: false,
      }),
    ).resolves.toMatchObject({ workItemId: 'WI-NATIVE-CAS', revision: 5 });
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.database.execute).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledTimes(1);
  });
});


it('internal projection persistence also denies an unguarded retained native carrier', async () => {
  const h = harness();
  await expect((h.repository as unknown as {
    persistProjectionCas(input: CasInput, database: unknown): Promise<unknown>;
  }).persistProjectionCas(h.input, h.database)).rejects.toThrow('TDMS_NATIVE_PROJECTION_AUTHORIZATION_REQUIRED');
  expect(h.update).not.toHaveBeenCalled();
});
