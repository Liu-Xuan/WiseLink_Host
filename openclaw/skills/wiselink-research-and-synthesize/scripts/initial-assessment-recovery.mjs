import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { createCheckpointStore } from './run-hosted-review-turn.mjs';

export const INITIAL_ASSESSMENT_OPERATIONS = {
  EXTRACT_APPLICABILITY: { stage: 'applicability', begin: 'begin_applicability_evaluation', commit: 'commit_applicability_candidate' },
  EVALUATE_JOBAID: { stage: 'jobAid', begin: 'begin_dynamic_evaluation', commit: 'commit_dynamic_evaluation_candidate' },
  SYNTHESIZE_OVERALL: { stage: 'overall', begin: 'begin_overall_synthesis', commit: 'commit_overall_candidate' },
};

// A local record is only a candidate for recovery. It never grants a lease.
// The caller must begin the exact Host request again and validate a newer
// generation before using any recorded model response or saved context.
export async function inspectInitialAssessmentRecovery({ checkpoint, initial, workItemId, operation, now = Date.now() }) {
  const spec = INITIAL_ASSESSMENT_OPERATIONS[operation];
  const stage = initial.stages?.[spec?.stage];
  if (!spec || initial.status !== 'BUSY' || stage?.status !== 'BUSY' ||
    (stage.attemptStatus !== 'RUNNING' && !(operation === 'EXTRACT_APPLICABILITY' && stage.attemptStatus === 'COMMITTING'))) return null;
  const binding = await checkpoint.readOptional('binding');
  if (!binding || binding.workItemId !== workItemId || binding.documentVersionId !== initial.documentVersionId ||
    binding.operation !== operation || (stage.requestId !== undefined && stage.requestId !== binding.requestId)) return null;
  if (await checkpoint.readOptional('run-result')) return null;
  if (operation === 'EXTRACT_APPLICABILITY' && stage.attemptStatus === 'COMMITTING') {
    const claim=(await checkpoint.readOptional(`${spec.begin}-1.result`))?.value;
    if (claim?.status !== 'RUNNING' || claim.attemptRef !== stage.attemptRef ||
      claim.task?.workItemId !== workItemId || claim.task?.documentVersionId !== initial.documentVersionId)
      return null;
    return {status:'RECOVERY_COMMITTING',operation,previousClaim:claim};
  }
  // COMMITTING and an unconfirmed commit require the existing exact result
  // readback path, never a restarted model loop.
  if (await checkpoint.readOptional(`${spec.commit}-1.started`)) return null;
  if (operation === 'EXTRACT_APPLICABILITY') {
    const saved = await checkpoint.readOptional(`${spec.begin}-1.result`);
    const claim = saved?.value;
    if (claim?.status !== 'RUNNING' || claim.attemptRef !== stage.attemptRef ||
      claim.task?.workItemId !== workItemId || claim.task?.documentVersionId !== initial.documentVersionId ||
      !Number.isSafeInteger(claim.leaseGeneration) || claim.leaseGeneration < 1) return null;
    const expires = Date.parse(claim.leaseExpiresAt);
    const deadline = Date.parse(claim.task.deadline);
    if (!Number.isFinite(expires) || !Number.isFinite(deadline) || expires > now || deadline <= now) return null;
    if (await checkpoint.readOptional('model.started') && !await checkpoint.readOptional('model.result'))
      return {status:'REQUIRES_ATTENTION',operation,attemptRef:claim.attemptRef,
        errorCode:'INITIAL_APPLICABILITY_MODEL_OUTCOME_UNKNOWN',candidateOnly:true};
    return {status:'RECOVERY_CANDIDATE',operation,previousClaim:claim};
  }
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

export function assertCommittingInitialClaim(previous,current) {
  if (current?.status !== 'COMMITTING' || current.attemptRef !== previous.attemptRef ||
    !isDeepStrictEqual(current.task,previous.task))
    throw new Error('INITIAL_ASSESSMENT_RECOVERY_BINDING_MISMATCH');
}

export function initialStageCheckpointPath(options, operation, requestId) {
  if (requestId !== undefined && !/^[A-Za-z0-9_-]{1,64}$/u.test(requestId))
    throw new Error('INITIAL_CONTINUATION_REQUEST_INVALID');
  if (operation === 'EXTRACT_APPLICABILITY' && options.initialWorkItemRevision !== undefined &&
    (!Number.isSafeInteger(options.initialWorkItemRevision) || options.initialWorkItemRevision < 0))
    throw new Error('INITIAL_APPLICABILITY_REVISION_INVALID');
  return join(options.checkpointRoot, encodeURIComponent(options.workItemId), 'initial', operation,
    ...(operation === 'EXTRACT_APPLICABILITY' && options.initialWorkItemRevision !== undefined
      ? ['revisions', String(options.initialWorkItemRevision)] : []),
    ...(requestId ? ['requests', requestId] : []));
}

export function initialApplicabilityCheckpointPointerPath(options) {
  return join(options.checkpointRoot, encodeURIComponent(options.workItemId), 'initial', 'EXTRACT_APPLICABILITY');
}

export async function findInitialAssessmentRecovery(options, initial) {
  if (initial.status !== 'BUSY') return null;
  for (const [operation, spec] of Object.entries(INITIAL_ASSESSMENT_OPERATIONS)) {
    const stage = initial.stages[spec.stage];
    if (stage.status !== 'BUSY' || (stage.attemptStatus !== 'RUNNING' &&
      !(operation === 'EXTRACT_APPLICABILITY' && stage.attemptStatus === 'COMMITTING'))) continue;
    let checkpointOptions=options;
    let requestId=stage.requestId;
    let initialWorkItemRevision;
    if (operation === 'EXTRACT_APPLICABILITY') {
      const pointerStore=await createCheckpointStore(initialApplicabilityCheckpointPointerPath(options));
      const pointer=await pointerStore.readOptional('active');
      if (!pointer || !Number.isSafeInteger(pointer.workItemRevision) || pointer.workItemRevision < 0 ||
        (stage.requestId !== undefined && pointer.requestId !== stage.requestId)) continue;
      checkpointOptions={...options,initialWorkItemRevision:pointer.workItemRevision};
      initialWorkItemRevision=pointer.workItemRevision;
      requestId=pointer.requestId;
    }
    const checkpoint = await createCheckpointStore(initialStageCheckpointPath(checkpointOptions, operation, requestId));
    const recovery = await inspectInitialAssessmentRecovery({ checkpoint, initial, workItemId: options.workItemId, operation });
    if (recovery) return initialWorkItemRevision === undefined ? recovery : {...recovery,initialWorkItemRevision};
  }
  return null;
}
