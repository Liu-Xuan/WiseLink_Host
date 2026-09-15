import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';

/** Never substitute current work or a late response for an explicitly requested work ref. */
export function selectMatterWorkRevision(
  requestedWorkRef: string,
  current: EngineeringMatterWorkingRevisionReadModel | null,
  requested: EngineeringMatterWorkingRevisionReadModel | null,
): EngineeringMatterWorkingRevisionReadModel | null {
  if (!requestedWorkRef) return current;
  if (current?.matterWorkRevisionId === requestedWorkRef) return current;
  return requested?.matterWorkRevisionId === requestedWorkRef
    ? requested
    : null;
}
