import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { CanonicalModelSettingsRepository } from '../../server/modules/model-settings/canonical-model-settings.repository';
import { taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import {
  MiaodaWorkItemRepository,
  type WorkItemReservationInput,
} from '../../server/modules/work-item/miaoda-work-item.repository';

describe('task model persistence', () => {
  const selected = taskModelSelection(
    'dli/gpt-5.6-sol',
    new Date('2026-09-06T00:00:00Z'),
  );

  it('reads a legacy initial selection under the exact tenant and WorkItem, excluding later Review overrides', async () => {
    const limit = jest
      .fn()
      .mockResolvedValueOnce([{ model: null }])
      .mockResolvedValueOnce([{ model: JSON.stringify(selected) }]);
    const where = jest.fn((_condition: SQL) => ({
      limit,
      orderBy: () => ({ limit }),
    }));
    const db = { select: jest.fn(() => ({ from: () => ({ where }) })) };
    const repository = new CanonicalModelSettingsRepository(db as never);
    expect(await repository.readWorkItemModel('tenant-1', 'WI-1')).toEqual(
      selected,
    );
    const query = new PgDialect().sqlToQuery(where.mock.calls[1][0]);
    expect(query.params).toEqual(
      expect.arrayContaining(['tenant-1', 'WI-1', 'OPENCLAW_TRANSLATE']),
    );
    expect(query.params).not.toContain('OPENCLAW_INTERACTIVE_REVIEW');
  });

  it('does not read attempts if the WorkItem is not visible', async () => {
    const select = jest.fn(() => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }));
    const repository = new CanonicalModelSettingsRepository({
      select,
    } as never);
    await expect(
      repository.readWorkItemModel('tenant-other', 'WI-1'),
    ).rejects.toMatchObject({ code: 'TASK_MODEL_WORK_ITEM_NOT_FOUND' });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('pins only empty control metadata and returns the concurrent winner without revising engineering content', async () => {
    const where = jest.fn().mockResolvedValue([]);
    const set = jest.fn((_values: { analysisModelJson: string }) => ({
      where,
    }));
    const repository = new CanonicalModelSettingsRepository({
      update: () => ({ set }),
    } as never);
    jest.spyOn(repository, 'readWorkItemModel').mockResolvedValue(selected);
    expect(
      await repository.pinWorkItemModel(
        'tenant-1',
        'WI-1',
        taskModelSelection(),
      ),
    ).toEqual(selected);
    expect(Object.keys(set.mock.calls[0][0])).toEqual(['analysisModelJson']);
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.sql).toContain('is null');
    expect(query.params).toEqual(['tenant-1', 'WI-1']);
  });

  it.each([true, false])(
    'keeps a reused WorkItem model; an explicitly changed selection conflicts: %s',
    async (explicit) => {
      const input: WorkItemReservationInput = {
        tenantId: 'tenant-1',
        actorUserId: 'actor-1',
        documentId: 'DOC-1',
        documentVersionId: 'DV-1',
        sourceArtifactId: 'SOURCE-1',
        sourceFileSha256: 'a'.repeat(64),
        sourceByteLength: 12,
        normalizedFamily: 'SB',
        requestOrigin: 'MIAODA',
        runKey: 'dev:same-request',
        analysisModel: taskModelSelection(),
        modelChoiceExplicit: explicit,
      };
      const limit = jest
        .fn()
        .mockResolvedValueOnce([
          {
            ...input,
            workItemId: 'WI-1',
            requestId: 'REQ-1',
            analysisModelJson: JSON.stringify(selected),
          },
        ])
        .mockResolvedValueOnce([{ attemptId: 'ATT-1' }]);
      const values = jest.fn((_values: { analysisModelJson: string }) => ({
        onConflictDoNothing: () => ({ returning: async () => [] }),
      }));
      const tx = {
        insert: () => ({ values }),
        select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
      };
      const repository = new MiaodaWorkItemRepository({
        transaction: async (work: (database: typeof tx) => unknown) => work(tx),
      } as never);
      if (explicit)
        await expect(repository.reserve(input)).rejects.toMatchObject({
          code: 'WORK_ITEM_MODEL_IDEMPOTENCY_CONFLICT',
          statusCode: 409,
        });
      else
        await expect(repository.reserve(input)).resolves.toMatchObject({
          workItemId: 'WI-1',
          created: false,
        });
      expect(
        JSON.parse(values.mock.calls[0][0].analysisModelJson).modelRef,
      ).toBe('miaoda/minimax-m3');
    },
  );
});
