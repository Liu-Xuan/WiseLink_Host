import { JOBAID_CHECKLIST_RC1, JOBAID_CHECKLIST_RC1_CONTENT_HASH } from '@shared/jobaid-checklist-rc1';
import type { JobAidChecklistBinding } from '@shared/jobaid-checklist.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

/** New PROGRAM_AGENT initial tasks only. No history or already-sealed task is upgraded. */
export function buildJobAidChecklistBinding(goal: Pick<JobAidChecklistBinding['goal'],
  'workItemId' | 'documentVersionId' | 'basedOnWorkItemRevision'>): JobAidChecklistBinding {
  return {
    definitionId: JOBAID_CHECKLIST_RC1.definitionId,
    definitionVersion: JOBAID_CHECKLIST_RC1.definitionVersion,
    definitionContentHash: JOBAID_CHECKLIST_RC1_CONTENT_HASH,
    contractVersion: JOBAID_CHECKLIST_RC1.contractVersion,
    definition: structuredClone(JOBAID_CHECKLIST_RC1),
    goal: { workItemId: goal.workItemId, documentVersionId: goal.documentVersionId,
      basedOnWorkItemRevision: goal.basedOnWorkItemRevision, purpose: 'INITIAL_PROBLEM_ASSESSMENT',
      contextRefs: ['documentOverview', 'discussion', 'contextPackage'], stageBoundary: 'CANDIDATE_ANALYSIS_ONLY' },
    selection: JOBAID_CHECKLIST_RC1.items.map(item => ({ itemId: item.itemId,
      mode: item.selection.defaultMode, reason: item.selection.optionalBoundary })),
    acceptance: {
      allowedSavedOutcomes: ['ANSWERED', 'OPEN', 'CONFLICT', 'DEFERRED'],
      allowedDeferredItemIds: [],
      // Existing initial assessment permits qualified candidate analysis, not formal decisions.
      allowedCompletionWithOpenItemIds: JOBAID_CHECKLIST_RC1.items.map(item => item.itemId),
      roundCompletionIsFormalAdoption: false,
    },
  };
}

/** Validate the exact sealed snapshot, never substitute current source or model input. */
export function assertJobAidChecklistBinding(binding: JobAidChecklistBinding): void {
  if (!binding || !binding.goal || typeof binding.goal.workItemId !== 'string' ||
      typeof binding.goal.documentVersionId !== 'string' || !binding.goal.workItemId ||
      !binding.goal.documentVersionId || !Number.isSafeInteger(binding.goal.basedOnWorkItemRevision) ||
      binding.goal.basedOnWorkItemRevision < 0 ||
      canonicalJson(binding) !== canonicalJson(buildJobAidChecklistBinding(binding.goal)))
    throw new Error('JOBAID_CHECKLIST_BINDING_INVALID');
}
