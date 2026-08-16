import type { CanonicalWorkItemProjection } from '@shared/api.interface';

import { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';

function projection(): Omit<CanonicalWorkItemProjection, 'revision'> {
  return {
    workItemId: 'WI-AUDIT-1',
    requestId: 'REQ-AUDIT-1',
    phase: 'CANDIDATE_READBACK_VERIFIED',
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
    },
    source: {
      documentVersionId: 'document-version-audit-1',
    },
    package: null,
    failure: null,
    recordingFailure: null,
  } as unknown as Omit<CanonicalWorkItemProjection, 'revision'>;
}

function repository() {
  const returning = jest.fn().mockResolvedValue([{ workItemId: 'WI-AUDIT-1' }]);
  const where = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });
  const target = new MiaodaWorkItemRepository({ update } as never);
  const syncPrimaryAttempt = jest
    .spyOn(target as never, 'updatePrimaryAttempt' as never)
    .mockResolvedValue(undefined as never);
  return { target, syncPrimaryAttempt };
}

describe('MiaodaWorkItemRepository assessment CAS audit isolation', () => {
  it('does not rewrite the primary parse ActionAttempt for an assessment-only CAS', async () => {
    const target = repository();

    await target.target.compareAndSet({
      workItemId: 'WI-AUDIT-1',
      expectedRevision: 3,
      next: projection(),
      syncPrimaryAttempt: false,
    });

    expect(target.syncPrimaryAttempt).not.toHaveBeenCalled();
  });

  it('keeps primary parse attempt synchronization as the default', async () => {
    const target = repository();

    await target.target.compareAndSet({
      workItemId: 'WI-AUDIT-1',
      expectedRevision: 2,
      next: projection(),
    });

    expect(target.syncPrimaryAttempt).toHaveBeenCalledTimes(1);
  });
});
