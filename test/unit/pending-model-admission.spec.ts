import { ActionAttemptRepository } from '../../server/modules/action-attempt/action-attempt.repository';
import { taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import { workItem } from '../../server/database/schema';

const original = taskModelSelection(
  'm3probe/minimax-m3',
  new Date('2026-10-10T10:00:00Z'),
);
const changed = taskModelSelection(
  'miaoda/glm-5.3',
  new Date('2026-10-10T14:00:00Z'),
);
const initialTypes = [
  'OPENCLAW_TRANSLATE',
  'OPENCLAW_APPLICABILITY_EVALUATION',
  'OPENCLAW_DYNAMIC_EVALUATION',
  'OPENCLAW_OVERALL_SYNTHESIS',
] as const;

function fixture(
  actionType: string,
  key: string,
  currentModel: string | null = JSON.stringify(changed),
) {
  const attempt = {
    attemptId: 'ATT-CAPTURED-M3',
    tenantId: 'tenant-1',
    workItemId: 'WI-1',
    actorUserId: 'actor-1',
    documentVersionId: 'DV-1',
    baseRevision: 3,
    inputRevision: 3,
    actionType,
    idempotencyKey: key,
    executionModelJson: JSON.stringify(original),
    taskEnvelopeJson: JSON.stringify({
      allowedConnectors: [],
      executionModel: original,
    }),
  };
  const owner = {
    id: 'WI-1',
    revision: 3,
    documentVersionId: 'DV-1',
    initialAilySessionId: null,
    requestedByUserId: 'actor-1',
    analysisModelJson: currentModel,
  };
  const ownerLock = jest.fn().mockResolvedValue([owner]);
  const select = jest.fn(() => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: () =>
          table === workItem ? { for: ownerLock } : Promise.resolve([]),
        orderBy: () => ({ limit: async () => [] }),
      }),
    }),
  }));
  const database = { select };
  const transaction = jest.fn(
    async (run: (tx: typeof database) => Promise<unknown>) => run(database),
  );
  const repository = new ActionAttemptRepository({
    ...database,
    transaction,
  } as never);
  const insert = jest
    .spyOn(repository as never, 'insertReservation' as never)
    .mockResolvedValue({ row: attempt, created: true } as never);
  return { repository, attempt, insert, transaction, ownerLock };
}

describe('initial model reservation fences a delayed captured selection', () => {
  it.each(initialTypes)(
    'rejects old captured M3 after the exact WI selection changed: %s',
    async (actionType) => {
      const state = fixture(actionType, 'initial-model-captured-before-update');
      await expect(
        state.repository.reserve(state.attempt as never),
      ).rejects.toThrow('ACTION_ATTEMPT_MODEL_BINDING_CHANGED');
      expect(state.transaction).toHaveBeenCalledTimes(1);
      expect(state.ownerLock).toHaveBeenCalledWith('update');
      expect(state.insert).not.toHaveBeenCalled();
    },
  );

  it('fences the existing openclaw-v2 path before insertion as well', async () => {
    const state = fixture(
      'OPENCLAW_DYNAMIC_EVALUATION',
      'openclaw-v2:initial-request',
    );
    await expect(
      state.repository.reserve(state.attempt as never),
    ).rejects.toThrow('ACTION_ATTEMPT_MODEL_BINDING_CHANGED');
    expect(state.insert).not.toHaveBeenCalled();
  });

  it('allows the same frozen selection despite different JSON key ordering', async () => {
    const state = fixture(
      'OPENCLAW_DYNAMIC_EVALUATION',
      'initial-model-same',
      JSON.stringify({
        selectedAt: original.selectedAt,
        settingsRevision: original.settingsRevision,
        providerKind: original.providerKind,
        displayName: original.displayName,
        modelRef: original.modelRef,
      }),
    );
    await expect(
      state.repository.reserve(state.attempt as never),
    ).resolves.toMatchObject({ created: true });
    expect(state.insert).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a captured attempt has no authoritative WI model', async () => {
    const state = fixture(
      'OPENCLAW_TRANSLATE',
      'initial-model-missing-owner',
      null,
    );
    await expect(
      state.repository.reserve(state.attempt as never),
    ).rejects.toThrow('ACTION_ATTEMPT_MODEL_BINDING_CHANGED');
    expect(state.insert).not.toHaveBeenCalled();
  });
});
