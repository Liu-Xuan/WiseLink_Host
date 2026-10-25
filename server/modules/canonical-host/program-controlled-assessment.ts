import type { CanonicalOpenClawOverallProjection } from '@shared/api.interface';
import type { JobAidWorkingReadModel, JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import type { ActionAttemptRow } from '../action-attempt/action-attempt.types';

function observations(activityJson: string | null | undefined): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(activityJson ?? '[]');
  if (!Array.isArray(parsed)) throw new Error('JOBAID_ACTIVITY_RECORDS_INVALID');
  return parsed.filter((item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === 'object' && !Array.isArray(item));
}

/** A real independent Host READ precedes initial projection; a SAVE receipt is insufficient. */
export function exactProgramWorkRead(
  row: Pick<ActionAttemptRow, 'attemptId' | 'workItemId' | 'documentVersionId' | 'baseRevision' | 'reviewActivityJson'>,
  revision: JobAidWorkRevision,
): NonNullable<CanonicalOpenClawOverallProjection['sourceAssessment']> {
  if (revision.actionAttemptId !== row.attemptId || revision.workItemId !== row.workItemId ||
      revision.documentVersionId !== row.documentVersionId || revision.basedOnWorkItemRevision !== row.baseRevision)
    throw new Error('JOBAID_PROGRAM_READ_BINDING_INVALID');
  const read = observations(row.reviewActivityJson).reverse().find(item => item.kind === 'ASSESSMENT_WORK_READ' &&
    item.workRevisionRef === revision.workRevisionRef && item.workRevision === revision.workRevision &&
    item.saveRequestId === revision.requestId && typeof item.observedAt === 'string' &&
    Number.isFinite(Date.parse(item.observedAt)));
  if (!read) throw new Error('JOBAID_PROGRAM_INDEPENDENT_READ_REQUIRED');
  return {actionAttemptId: row.attemptId, workRevisionRef: revision.workRevisionRef,
    workRevision: revision.workRevision, saveRequestId: revision.requestId, readObservedAt: String(read.observedAt)};
}

export function latestProgramProgress(activityJson: string | null | undefined):
  NonNullable<JobAidWorkingReadModel['selectedExecution']>['programProgress'] {
  const observed = observations(activityJson).reverse().find(item => item.kind === 'ASSESSMENT_PROGRAM_PROGRESS' &&
    (item.phase === 'MATERIALS_READY' || item.phase === 'MODEL_RESPONSE_SAVED') &&
    typeof item.checkpointRef === 'string' && /^[A-Za-z0-9:._-]{1,512}$/u.test(item.checkpointRef) &&
    typeof item.observedAt === 'string' && Number.isFinite(Date.parse(item.observedAt)));
  return observed ? {phase: observed.phase as 'MATERIALS_READY' | 'MODEL_RESPONSE_SAVED',
    checkpointRef: String(observed.checkpointRef), observedAt: String(observed.observedAt)} : null;
}
