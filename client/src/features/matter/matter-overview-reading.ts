import type { AssessmentReadingResult } from '@shared/assessment-reading.interface';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';

export function readableMatterOverview(
  revision: EngineeringMatterWorkingRevisionReadModel | null,
): AssessmentReadingResult | null {
  if (revision?.state.problemWork?.overviewStatus === 'NOT_AVAILABLE') return null;
  return revision?.state.substantiveResult ?? null;
}
