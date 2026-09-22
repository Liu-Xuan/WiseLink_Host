import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { createCheckpointStore } from './run-hosted-review-turn.mjs';

export const INITIAL_ASSESSMENT_OPERATIONS = {
  EVALUATE_JOBAID: { stage: 'jobAid', begin: 'begin_dynamic_evaluation', commit: 'commit_dynamic_evaluation_candidate' },
  SYNTHESIZE_OVERALL: { stage: 'overall', begin: 'begin_overall_synthesis', commit: 'commit_overall_candidate' },
};

// A local record is only a candidate for recovery. It never grants a lease.
// The caller must begin the exact Host request again and validate a newer
// generation before using any recorded model response or saved context.
export async function inspectInitialAssessmentRecovery({ checkpoint, initial, workItemId, operation, now = Date.now() }) {
  const spec = INITIAL_ASSESSMENT_OPERATIONS[operation];
  const stage = initial.stages?.[spec?.stage];
  if (!spec || initial.status !== 'BUSY' || stage?.status !== 'BUSY' || stage.attemptStatus !== 'RUNNING') return null;
  const binding = await checkpoint.readOptional('binding');
  if (!binding || binding.workItemId !== workItemId || binding.documentVersionId !== initial.documentVersionId ||
    binding.operation !== operation || (stage.requestId !== undefined && stage.requestId !== binding.requestId)) return null;
  if (await checkpoint.readOptional('run-result')) return null;
  // COMMITTING and an unconfirmed commit require the existing exact result
  // readback path, never a restarted model loop.
  if (await checkpoint.readOptional(`${spec.commit}-1.started`)) return null;
  const enabled = await checkpoint.readOptional('assessment-enabled');
  const state = await checkpoint.readOptional('assessment-state');
  const claim = await checkpoint.readOptional('assessment-current-claim');
  if (!enabled || !state || !claim || claim.attemptRef !== stage.attemptRef || claim.status !== 'RUNNING' ||
    claim.task?.workItemId !== workItemId || claim.task?.documentVersionId !== initial.documentVersionId ||
    !Number.isSafeInteger(claim.leaseGeneration) || claim.leaseGeneration < 1 ||
    !Number.isSafeInteger(state.round) || state.round < 1 || state.round > 64) return null;
  const expires = Date.parse(claim.leaseExpiresAt);
  const deadline = Date.parse(claim.task.deadline);
  if (!Number.isFinite(expires) || !Number.isFinite(deadline) || expires > now || deadline <= now) return null;
  const started = await checkpoint.readOptional(`assessment-round-${state.round}.started`);
  const result = await checkpoint.readOptional(`assessment-round-${state.round}.result`);
  if (started && !result) return { status: 'REQUIRES_ATTENTION', operation,
    attemptRef: claim.attemptRef, errorCode: 'INITIAL_ASSESSMENT_MODEL_OUTCOME_UNKNOWN', candidateOnly: true };
  return { status: 'RECOVERY_CANDIDATE', operation, previousClaim: claim };
}

export function assertFreshInitialAssessmentClaim(previous, current) {
  if (current?.status !== 'RUNNING' || current.attemptRef !== previous.attemptRef ||
    !isDeepStrictEqual(current.task, previous.task) || !Number.isSafeInteger(current.leaseGeneration) ||
    typeof current.leaseToken !== 'string' || !current.leaseToken) {
    throw new Error('INITIAL_ASSESSMENT_RECOVERY_BINDING_MISMATCH');
  }
  // A previous heartbeat may have renewed a live worker after the local copy
  // expired. Returning its old lease is not permission to run concurrently.
  if (current.leaseGeneration <= previous.leaseGeneration)
    throw new Error('INITIAL_ASSESSMENT_STILL_OWNED');
  if (!Number.isFinite(Date.parse(current.leaseExpiresAt)) || Date.parse(current.leaseExpiresAt) <= Date.now())
    throw new Error('INITIAL_ASSESSMENT_RECOVERY_LEASE_EXPIRED');
}

export function initialStageCheckpointPath(options, operation, requestId) {
  if (requestId !== undefined && !/^[A-Za-z0-9_-]{1,64}$/u.test(requestId))
    throw new Error('INITIAL_CONTINUATION_REQUEST_INVALID');
  return join(options.checkpointRoot, encodeURIComponent(options.workItemId), 'initial', operation,
    ...(requestId ? ['requests', requestId] : []));
}

export async function findInitialAssessmentRecovery(options, initial) {
  if (initial.status !== 'BUSY') return null;
  for (const [operation, spec] of Object.entries(INITIAL_ASSESSMENT_OPERATIONS)) {
    const stage = initial.stages[spec.stage];
    if (stage.status !== 'BUSY' || stage.attemptStatus !== 'RUNNING') continue;
    const checkpoint = await createCheckpointStore(initialStageCheckpointPath(options, operation, stage.requestId));
    const recovery = await inspectInitialAssessmentRecovery({ checkpoint, initial, workItemId: options.workItemId, operation });
    if (recovery) return recovery;
  }
  return null;
}
