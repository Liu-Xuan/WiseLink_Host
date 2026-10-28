import { sql, type SQL } from 'drizzle-orm';
import { actionAttempt } from '../../database/schema';
import { JOBAID_CHECKLIST_RC1, JOBAID_CHECKLIST_RC1_CONTENT_HASH } from '@shared/jobaid-checklist-rc1';
import type { JobAidChecklistBinding, JobAidChecklistDefinitionRead,
  JobAidChecklistTaskRead } from '@shared/jobaid-checklist.interface';
import { assertJobAidChecklistBinding } from './jobaid-checklist-binding';

/** Select only the sealed definition and its exact local association, never task/full bodies. */
export function checklistTaskSelection(): SQL<unknown> {
  return sql`jsonb_build_object(
    'prepared', ${actionAttempt.taskEnvelopeJson} IS NOT NULL,
    'workItemId', ${actionAttempt.taskEnvelopeJson}::jsonb->>'workItemId',
    'attemptId', ${actionAttempt.taskEnvelopeJson}::jsonb->>'actionAttemptId',
    'taskType', ${actionAttempt.taskEnvelopeJson}::jsonb->>'taskType',
    'reviewTurnRef', ${actionAttempt.taskEnvelopeJson}::jsonb->'modelInput'->>'reviewTurnRef',
    'reviewConversationRef', ${actionAttempt.taskEnvelopeJson}::jsonb->'modelInput'->>'reviewConversationRef',
    'documentVersionId', CASE WHEN ${actionAttempt.actionType} = 'OPENCLAW_INTERACTIVE_REVIEW'
      THEN ${actionAttempt.taskEnvelopeJson}::jsonb->'modelInput'->'jobAidContext'->'previousWork'->>'documentVersionId'
      ELSE ${actionAttempt.taskEnvelopeJson}::jsonb->>'documentVersionId' END,
    'binding', CASE WHEN ${actionAttempt.actionType} = 'OPENCLAW_INTERACTIVE_REVIEW'
      THEN ${actionAttempt.taskEnvelopeJson}::jsonb->'modelInput'->'jobAidContext'->'previousWork'->'content'->'checklistBinding'
      ELSE COALESCE(${actionAttempt.taskEnvelopeJson}::jsonb->'modelInput'->'checklistBinding',
        ${actionAttempt.taskEnvelopeJson}::jsonb->'modelInput'->'previousWork'->'content'->'checklistBinding') END
  )`;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** This is a read projection, not semantic validation, a lease check, or a precheck receipt. */
export function projectTaskChecklist(value: unknown, expected: {
  workItemId: string; attemptId: string; taskType: string;
  reviewTurnRef?: string; reviewConversationRef?: string;
}): JobAidChecklistTaskRead {
  const unavailable = (status: JobAidChecklistTaskRead['status']): JobAidChecklistTaskRead =>
    ({ status, snapshot: null });
  if (!record(value)) return unavailable('INVALID');
  if (value.prepared === false) return unavailable('NOT_PREPARED');
  if (value.prepared !== true || value.workItemId !== expected.workItemId ||
      value.attemptId !== expected.attemptId || value.taskType !== expected.taskType ||
      (expected.reviewTurnRef !== undefined && value.reviewTurnRef !== expected.reviewTurnRef) ||
      (expected.reviewConversationRef !== undefined && value.reviewConversationRef !== expected.reviewConversationRef))
    return unavailable('INVALID');
  if (value.binding === null || value.binding === undefined) return unavailable('NOT_BOUND');
  if (!record(value.binding)) return unavailable('INVALID');
  if (value.binding.definitionId !== JOBAID_CHECKLIST_RC1.definitionId ||
      value.binding.definitionVersion !== JOBAID_CHECKLIST_RC1.definitionVersion ||
      value.binding.contractVersion !== JOBAID_CHECKLIST_RC1.contractVersion)
    return unavailable('UNSUPPORTED');
  const binding = value.binding as unknown as JobAidChecklistBinding;
  try {
    // Compare the actual sealed value; never replace a missing/older binding with current constants.
    assertJobAidChecklistBinding(binding);
    if (binding.goal.workItemId !== expected.workItemId ||
        binding.goal.documentVersionId !== value.documentVersionId) return unavailable('INVALID');
  } catch { return unavailable('INVALID'); }
  return { status: 'AVAILABLE', snapshot: structuredClone({
    definitionId: binding.definitionId, definitionVersion: binding.definitionVersion,
    definitionContentHash: binding.definitionContentHash, contractVersion: binding.contractVersion,
    definition: binding.definition, selection: binding.selection, acceptance: binding.acceptance,
  }) };
}

export function currentChecklistDefinition(): JobAidChecklistDefinitionRead {
  return { schemaVersion: 'wiselink.checklist-definition-read.v1', source: 'HOST_RELEASE',
    management: 'READ_ONLY_RELEASE_MANAGED', current: {
      definitionId: JOBAID_CHECKLIST_RC1.definitionId, definitionVersion: JOBAID_CHECKLIST_RC1.definitionVersion,
      contractVersion: JOBAID_CHECKLIST_RC1.contractVersion,
      definitionContentHash: JOBAID_CHECKLIST_RC1_CONTENT_HASH, definition: structuredClone(JOBAID_CHECKLIST_RC1),
    } };
}
