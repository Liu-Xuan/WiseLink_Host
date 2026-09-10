import type { DialogueContributionReadModel } from '@shared/dialogue.interface';
export interface DialogueChosenContribution {
  contributionRef: string;
  expectedRevision: number;
}
export function dialogueAssessmentSelectionValid(
  chosen: DialogueChosenContribution[],
  contributions: DialogueContributionReadModel[],
  workItemId: string,
): boolean {
  return (
    chosen.length > 0 &&
    chosen.length <= 20 &&
    new Set(chosen.map((item) => item.contributionRef)).size ===
      chosen.length &&
    chosen.every((selected) =>
      contributions.some(
        (current) =>
          current.contributionRef === selected.contributionRef &&
          current.workItemId === workItemId &&
          current.status === 'ACTIVE' &&
          current.revision === selected.expectedRevision,
      ),
    )
  );
}
