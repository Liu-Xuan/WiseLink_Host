import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import { selectMatterWorkRevision } from '../../client/src/features/matter/matter-work-selection';

function revision(workRef: string): EngineeringMatterWorkingRevisionReadModel {
  return { matterWorkRevisionId: workRef } as EngineeringMatterWorkingRevisionReadModel;
}

test('a late A response cannot replace an explicitly requested B work revision', () => {
  const current = revision('MWREV-CURRENT');
  const lateA = revision('MWREV-A');
  const requestedB = revision('MWREV-B');

  expect(selectMatterWorkRevision('MWREV-B', current, lateA)).toBeNull();
  expect(selectMatterWorkRevision('MWREV-B', current, requestedB)).toBe(
    requestedB,
  );
  expect(selectMatterWorkRevision('MWREV-CURRENT', current, lateA)).toBe(
    current,
  );
  expect(selectMatterWorkRevision('', current, lateA)).toBe(current);
});
