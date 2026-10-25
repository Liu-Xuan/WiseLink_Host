import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { createCheckpointStore, readCheckpointCandidate, actualModelVersion, parseStrictJsonObject,
  isFunctionResponseContentSupported, summarizeHostedReviewModelOutputShape } from './run-hosted-review-turn.mjs';
import { canonicalSha256, WISELINK_SKILL_VERSION, WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION } from './validate-payload.mjs';
import { decodeJobAidStep } from './jobaid-work-shape.mjs';
import { classifyHostedAssessmentProtocol } from './request-hosted-gateway.mjs';
import { modelExecutorProvenance } from './model-executor.mjs';

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
    !['RUNNING', 'COMMITTING'].includes(stage.attemptStatus)) return null;
  const read = step => readCheckpointCandidate(checkpoint, step);
  const binding = await read('binding');
  if (!binding || binding.workItemId !== workItemId || binding.documentVersionId !== initial.documentVersionId ||
    binding.operation !== operation || (stage.requestId !== undefined && stage.requestId !== binding.requestId)) return null;
  if (stage.attemptStatus === 'COMMITTING') {
    const claim=(await read(`${spec.begin}-1.result`))?.value ??
      await read('assessment-current-claim');
    if (claim?.status !== 'RUNNING' || claim.attemptRef !== stage.attemptRef ||
      claim.task?.workItemId !== workItemId || claim.task?.documentVersionId !== initial.documentVersionId ||
      !Number.isSafeInteger(claim.leaseGeneration) || claim.leaseGeneration < 1)
      return null;
    return {status:'RECOVERY_COMMITTING',operation,previousClaim:claim};
  }
  const priorRun = await read('run-result');
  if (priorRun && priorRun.attemptStatus !== 'UNKNOWN') return null;
  if (operation === 'EXTRACT_APPLICABILITY' && stage.attemptStatus === 'RUNNING') {
    const begin = await read(`${spec.begin}-1.result`);
    if (!begin) {
      const beginStarted = await read(`${spec.begin}-1.started`);
      if (!beginStarted) return null;
      if (await read('commit_applicability_candidate-1.started')) return null;
      if (await read('model.started')) {
        return {status:'REQUIRES_ATTENTION',operation,attemptRef:stage.attemptRef,
          errorCode:'INITIAL_APPLICABILITY_BEGIN_MODEL_ALREADY_STARTED',candidateOnly:true};
      }
      if (typeof stage.attemptRef !== 'string' || !stage.attemptRef) return null;
      return {status:'RECOVERY_BEGIN',operation,previousAttemptRef:stage.attemptRef};
    }
  }
  // COMMITTING and an unconfirmed commit require the existing exact result
  // readback path, never a restarted model loop.
  if (await read(`${spec.commit}-1.started`)) return null;
  if (operation === 'EXTRACT_APPLICABILITY') {
    const saved = await read(`${spec.begin}-1.result`);
    const claim = saved?.value;
    if (claim?.status !== 'RUNNING' || claim.attemptRef !== stage.attemptRef ||
      claim.task?.workItemId !== workItemId || claim.task?.documentVersionId !== initial.documentVersionId ||
      !Number.isSafeInteger(claim.leaseGeneration) || claim.leaseGeneration < 1) return null;
    const expires = Date.parse(claim.leaseExpiresAt);
    const deadline = Date.parse(claim.task.deadline);
    if (!Number.isFinite(expires) || !Number.isFinite(deadline) || expires > now || deadline <= now) return null;
    if (await read('model.started') && !await read('model.result'))
      return {status:'REQUIRES_ATTENTION',operation,attemptRef:claim.attemptRef,
        errorCode:'INITIAL_APPLICABILITY_MODEL_OUTCOME_UNKNOWN',candidateOnly:true};
    return {status:'RECOVERY_CANDIDATE',operation,previousClaim:claim};
  }
  const enabled = await read('assessment-enabled');
  const state = await read('assessment-state');
  const claim = await read('assessment-current-claim');
  if (!enabled || !state || !claim || claim.attemptRef !== stage.attemptRef || claim.status !== 'RUNNING' ||
    claim.task?.workItemId !== workItemId || claim.task?.documentVersionId !== initial.documentVersionId ||
    !Number.isSafeInteger(claim.leaseGeneration) || claim.leaseGeneration < 1 ||
    !Number.isSafeInteger(state.round) || state.round < 1 || state.round > 64) return null;
  if (enabled.generationPolicy?.loopPolicyVersion === 'stage-protocol-progress-v1' &&
      ![state.protocolRepairs, state.noProgressRepairs]
        .every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1))
    return { status: 'REQUIRES_ATTENTION', operation, attemptRef: claim.attemptRef,
      errorCode: 'JOBAID_CHECKPOINT_POLICY_CHANGED', candidateOnly: true };
  const expires = Date.parse(claim.leaseExpiresAt);
  const deadline = Date.parse(claim.task.deadline);
  if (!Number.isFinite(expires) || !Number.isFinite(deadline) || expires > now || deadline <= now) return null;
  const started = await read(`assessment-round-${state.round}.started`);
  const result = await read(`assessment-round-${state.round}.result`);
  // Only this new Codex program request has an independent durable child
  // receipt. The gateway below is called in recover-only mode: this candidate
  // permits lease reacquisition, never a replacement model dispatch.
  if (started && !result && binding.modelExecutor === 'CODEX' &&
      enabled.binding?.modelExecutor === 'CODEX' &&
      enabled.generationPolicy?.loopPolicyVersion === 'program-controlled-v1' && state.round === 1 &&
      enabled.binding.assessmentBinding?.attemptRef === claim.attemptRef &&
      started.codexRecoveryRequestId === `program:${claim.attemptRef}:round-1` &&
      (await read('program-model-input'))?.body)
    return { status: 'RECOVERY_CANDIDATE', operation, previousClaim: claim,
      modelRecovery: 'CODEX_DURABLE_RECEIPT_ONLY' };
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
    (previous.task !== undefined && !isDeepStrictEqual(current.task,previous.task)))
    throw new Error('INITIAL_ASSESSMENT_RECOVERY_BINDING_MISMATCH');
}

// Absence is the initial stage. A supplied continuation must survive JSON as
// a nonempty string; undefined/null/numbers are never another initial request.
export function optionalInitialStageRequest(value, key = 'requestId') {
  if (!value || !Object.hasOwn(value, key)) return undefined;
  const requestId = value[key];
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(requestId))
    throw new Error('INITIAL_CONTINUATION_REQUEST_INVALID');
  return requestId;
}

export function initialStageCheckpointPath(options, operation, requestId) {
  if (requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(requestId)))
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

// A renewed, unchanged queue grant permits only this observed sealed commit
// replay in the consumer. The Host still authorizes every read and mutation.
export async function confirmInitialCommittingRecovery(options, initial, dependencies) {
  const candidates = Object.entries(INITIAL_ASSESSMENT_OPERATIONS).filter(([operation, spec]) =>
    operation !== 'EXTRACT_APPLICABILITY' && initial.stages?.[spec.stage]?.status === 'BUSY' &&
    initial.stages[spec.stage].attemptStatus === 'COMMITTING');
  if (initial.status !== 'BUSY' || initial.nextOperation !== null || candidates.length !== 1 ||
      typeof dependencies.callTool !== 'function')
    throw new Error('INITIAL_COMMITTING_RECOVERY_NOT_CONFIRMED');
  const [operation, spec] = candidates[0];
  const stage = initial.stages[spec.stage];
  if (typeof stage.attemptRef !== 'string' || !stage.attemptRef)
    throw new Error('INITIAL_COMMITTING_RECOVERY_NOT_CONFIRMED');
  const observed = await dependencies.callTool('get_action_attempt_status', {
    attemptRef: stage.attemptRef, workItemId: options.workItemId,
  });
  const result = observed?.recoveryResult;
  const { contentHash, ...body } = result ?? {};
  const taskType = operation === 'EVALUATE_JOBAID'
    ? 'OPENCLAW_DYNAMIC_EVALUATION' : 'OPENCLAW_OVERALL_SYNTHESIS';
  if (observed?.attemptRef !== stage.attemptRef || observed.status !== 'COMMITTING' ||
      observed.taskType !== taskType || observed.recoveryAvailable !== true ||
      typeof contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(contentHash) ||
      observed.resultContentHash !== contentHash || canonicalSha256(body) !== contentHash ||
      result.operationRef !== stage.attemptRef || result.taskType !== taskType ||
      result.workItemId !== options.workItemId)
    throw new Error('INITIAL_COMMITTING_RECOVERY_NOT_CONFIRMED');
  return { status: 'RECOVERY_COMMITTING', operation, attemptRef: stage.attemptRef,
    resultContentHash: contentHash, documentVersionId: initial.documentVersionId,
    workItemRevision: initial.workItemRevision,
    ...(Object.hasOwn(stage, 'requestId') ? { requestId: optionalInitialStageRequest(stage) } : {}) };
}

export async function findInitialAssessmentRecovery(options, initial, dependencies = {}) {
  if (initial.status !== 'BUSY') return null;
  for (const [operation, spec] of Object.entries(INITIAL_ASSESSMENT_OPERATIONS)) {
    const stage = initial.stages[spec.stage];
    if (stage.status !== 'BUSY' || !['RUNNING', 'COMMITTING'].includes(stage.attemptStatus) ||
        typeof stage.attemptRef !== 'string' || !stage.attemptRef) continue;
    if (stage.attemptStatus === 'COMMITTING' && operation !== 'EXTRACT_APPLICABILITY' &&
        typeof dependencies.callTool === 'function') {
      const observed = await dependencies.callTool('get_action_attempt_status', {
        attemptRef: stage.attemptRef, workItemId: options.workItemId,
      });
      if (observed?.attemptRef !== stage.attemptRef || observed.status !== 'COMMITTING' ||
          observed.recoveryAvailable !== true || !observed.recoveryResult ||
          observed.resultContentHash !== observed.recoveryResult.contentHash)
        throw new Error('INITIAL_COMMITTING_RECOVERY_NOT_CONFIRMED');
      return { status: 'RECOVERY_COMMITTING', operation, attemptRef: stage.attemptRef };
    }
    let checkpointOptions=options;
    let requestId=optionalInitialStageRequest(stage);
    let initialWorkItemRevision;
    if (operation === 'EXTRACT_APPLICABILITY') {
      const pointerStore=await createCheckpointStore(initialApplicabilityCheckpointPointerPath(options));
      const pointer=await readCheckpointCandidate(pointerStore, 'active');
      if (!pointer || !Number.isSafeInteger(pointer.workItemRevision) || pointer.workItemRevision < 0 ||
        (stage.requestId !== undefined && pointer.requestId !== stage.requestId)) continue;
      checkpointOptions={...options,initialWorkItemRevision:pointer.workItemRevision};
      initialWorkItemRevision=pointer.workItemRevision;
      if (pointer.requestId !== null && typeof pointer.requestId !== 'string') continue;
      requestId=pointer.requestId ?? undefined;
    }
    const checkpoint = await createCheckpointStore(initialStageCheckpointPath(checkpointOptions, operation, requestId));
    const recovery = await inspectInitialAssessmentRecovery({ checkpoint, initial, workItemId: options.workItemId, operation });
    const policyChanged = recovery?.status === 'REQUIRES_ATTENTION' &&
      recovery.errorCode === 'JOBAID_CHECKPOINT_POLICY_CHANGED';
    if (recovery && !policyChanged) return initialWorkItemRevision === undefined ? recovery : {...recovery,initialWorkItemRevision};
    if (operation !== 'EXTRACT_APPLICABILITY' && typeof dependencies.callTool === 'function') {
      // A deleted claim or damaged budget cannot grant a lease or prove a provider stopped.
      // Still query Host work, including the original SAVE key when it belongs
      // to this exact attempt, before returning an honest unknown observation.
      const saved = await readExactSavedWork(dependencies.callTool, stage.attemptRef, options.workItemId, initial.documentVersionId);
      const revision = saved.revision;
      const closure = policyChanged ? await inspectPolicyFailureClosure(checkpoint, operation, saved) : null;
      const expires = Date.parse(closure?.claim.leaseExpiresAt);
      if (closure && Number.isFinite(expires) && expires <= Date.now())
        return { status: 'RECOVERY_CANDIDATE', operation, previousClaim: closure.claim,
          closeOnly: closure.proof };
      return { status: 'REQUIRES_ATTENTION', operation, attemptRef: stage.attemptRef,
        errorCode: saved.executionStatus === 'CANCELLED' ? 'ACTION_ATTEMPT_ALREADY_CANCELLED'
          : policyChanged && saved.executionStatus === 'RUNNING' ? 'JOBAID_CHECKPOINT_POLICY_CHANGED'
          : 'INITIAL_ASSESSMENT_MODEL_OUTCOME_UNKNOWN', candidateOnly: true,
        ...(typeof revision?.workRevisionRef === 'string' ? { savedWorkRevisionRef: revision.workRevisionRef } : {}) };
    }
    if (recovery) return recovery;
  }
  return null;
}

async function readExactSavedWork(callTool, attemptRef, workItemId, documentVersionId) {
  const saved = await callTool('read_assessment_work', { attemptRef, workItemId });
  const revision = saved?.revision;
  if (saved?.schemaVersion !== 'wiselink.jobaid-work-read.v2' || typeof saved.attemptId !== 'string' ||
      (revision && (revision.workItemId !== workItemId || revision.documentVersionId !== documentVersionId)) ||
      !['RUNNING', 'COMMITTING', 'CANCELLED', 'TIMED_OUT', 'FAILED', 'SUCCEEDED', 'OBSOLETE'].includes(saved.executionStatus))
    throw new Error('INITIAL_SAVED_WORK_READBACK_INVALID');
  if (revision?.actionAttemptId === saved.attemptId && typeof revision.requestId === 'string' && revision.requestId) {
    const original = await callTool('read_assessment_work', { attemptRef, workItemId, requestId: revision.requestId });
    if (original?.schemaVersion !== saved.schemaVersion || original.attemptId !== saved.attemptId ||
        original.executionStatus !== saved.executionStatus || !isDeepStrictEqual(original.revision, revision))
      throw new Error('INITIAL_SAVED_WORK_READBACK_INVALID');
  }
  return saved;
}

// This proves only a settled, partial loop can be stopped. It cannot restore a
// budget, replay a model or reinterpret a COMPLETE saved work/FINISH result.
async function inspectPolicyFailureClosure(checkpoint, operation, saved) {
  const read = step => readCheckpointCandidate(checkpoint, step);
  const binding = await read('binding'), enabled = await read('assessment-enabled');
  const state = await read('assessment-state'), claim = await read('assessment-current-claim');
  const revision = saved.revision;
  if (saved.executionStatus !== 'RUNNING' || revision?.content?.roundCompletion !== 'IN_PROGRESS' ||
      !claim || claim.status !== 'RUNNING' || claim.task?.actionAttemptId !== saved.attemptId ||
      revision.actionAttemptId !== saved.attemptId || typeof revision.requestId !== 'string' || !revision.requestId ||
      binding?.operation !== operation || binding.workItemId !== claim.task.workItemId ||
      binding.documentVersionId !== claim.task.documentVersionId || revision.workItemId !== binding.workItemId ||
      revision.documentVersionId !== binding.documentVersionId || claim.task.operationRef !== claim.attemptRef ||
      revision.basedOnWorkItemRevision !== claim.task.baseRevision ||
      claim.task.modelInput?.modelInput === undefined ||
      !isDeepStrictEqual(claim.task.modelInput.modelInput, claim.modelInput) ||
      claim.task.taskType !== (operation === 'EVALUATE_JOBAID'
        ? 'OPENCLAW_DYNAMIC_EVALUATION' : 'OPENCLAW_OVERALL_SYNTHESIS') ||
      enabled?.generationPolicy?.loopPolicyVersion !== 'stage-protocol-progress-v1' ||
      !isDeepStrictEqual(enabled.binding?.modelInput, claim.modelInput) || enabled.binding?.operation !== operation ||
      !isDeepStrictEqual(enabled.binding?.executionModel, claim.task.executionModel) ||
      enabled.binding?.sessionDiscriminator !== (binding.requestId ?? claim.attemptRef) ||
      !['wiselink.jobaid-problem-task.v2', 'wiselink.jobaid-problem-task.v3'].includes(claim.modelInput?.schemaVersion) ||
      !Number.isSafeInteger(state?.round) || state.round < 2 || state.round > 64 ||
      [state.protocolRepairs, state.noProgressRepairs].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1) ||
      typeof claim.task.executionModel?.modelRef !== 'string' ||
      !Number.isSafeInteger(claim.task.executionModel.settingsRevision) || claim.task.executionModel.settingsRevision < 0 ||
      ![state.inputUnits, state.outputUnits].every(value => Number.isSafeInteger(value) && value >= 0) ||
      !Number.isFinite(enabled.startedAt) || enabled.startedAt > Date.now() ||
      !Number.isFinite(Date.parse(claim.task.deadline)) || Date.parse(claim.task.deadline) <= Date.now() ||
      state.saved?.requestId !== revision.requestId || state.saved.workRevisionRef !== revision.workRevisionRef ||
      state.expectedWorkRevision !== revision.workRevision || state.saved.workRevision !== revision.workRevision ||
      !Number.isSafeInteger(revision.workRevision) || revision.workRevision < 1 ||
      state.saved.roundCompletion !== 'IN_PROGRESS' ||
      typeof checkpoint.hasEntries !== 'function') return null;
  // A durable finished execution belongs to the existing result recovery path,
  // not this partial-work failure branch.
  const priorRun = await read('run-result');
  if (await checkpoint.hasEntries('model.result') || await checkpoint.hasEntries('quarantine-assessment-round-') ||
      (priorRun && (priorRun.attemptStatus !== 'UNKNOWN' || priorRun.errorCode !== 'JOBAID_CHECKPOINT_POLICY_CHANGED')))
    return null;
  for (let round = state.round; round <= 64; round++)
    if (await checkpoint.hasEntries(`assessment-round-${round}`)) return null;
  let last;
  for (let round = 1; round < state.round; round++) {
    const step = `assessment-round-${round}`;
    const started = await read(`${step}.started`), result = await read(`${step}.result`);
    if (started?.schemaVersion !== 'wiselink.3_1.hosted_review_driver.v1' || result?.schemaVersion !== started.schemaVersion ||
        started.step !== step || result.step !== step || !/^[a-f0-9]{64}$/u.test(started.argsHash ?? '') ||
        result.argsHash !== started.argsHash || !Number.isFinite(Date.parse(started.startedAt)) ||
        !Number.isFinite(Date.parse(result.finishedAt)) || Date.parse(result.finishedAt) < Date.parse(started.startedAt) ||
        result.value?.ok !== true || !Number.isSafeInteger(result.value.status) || result.value.status < 200 || result.value.status >= 300 ||
        result.value.localTransportRequestOrdinal !== round || typeof result.value.raw !== 'string' ||
        await checkpoint.hasEntries(`${step}.error`)) return null;
    let payload, parsed;
    try { payload = JSON.parse(result.value.raw); } catch { return null; }
    const protocol = classifyHostedAssessmentProtocol(payload, result.value);
    if (payload?.error || protocol.category === 'OUTPUT_LENGTH') return null;
    if (protocol.category === null) {
      try {
        const message = payload.choices[0].message;
        const shape = summarizeHostedReviewModelOutputShape({ httpStatus: result.value.status, httpOk: true,
          payload, expectedFunctionNames: ['return_wiselink_assessment_step'] });
        if (shape.hasAnalysis || !isFunctionResponseContentSupported(message.content)) return null;
        const args = parseStrictJsonObject(message.tool_calls[0].function.arguments);
        if (Object.keys(args).length !== 1 || !args.step) return null;
        parsed = decodeJobAidStep(args.step);
        const keys = Object.keys(parsed);
        if (parsed.action === 'READ_SOURCES') {
          if (keys.some(key => !['action', 'sourceRefs', 'purpose', 'context'].includes(key)) ||
              !Array.isArray(parsed.sourceRefs) || !parsed.sourceRefs.length ||
              !parsed.sourceRefs.every(ref => typeof ref === 'string' && ref) ||
              typeof parsed.purpose !== 'string' || !parsed.purpose || !['EXACT', 'PAGE'].includes(parsed.context)) return null;
        } else if (parsed.action === 'SAVE_WORK') {
          if (keys.some(key => !['action', 'workJson', 'continueReason'].includes(key)) ||
              typeof parsed.workJson !== 'string') return null;
          parseStrictJsonObject(parsed.workJson);
        } else return null;
      } catch { return null; }
    } else if (!protocol.knownTerminal || !protocol.repairEligible) return null;
    last = { payload, parsed };
  }
  const observation = state.lastObservation;
  if (last?.parsed?.action !== 'READ_SOURCES' || observation?.action !== 'READ_SOURCES' ||
      observation.result?.status !== 'AVAILABLE' ||
      !isDeepStrictEqual(observation.parameters, { sourceRefs: last.parsed.sourceRefs,
        purpose: last.parsed.purpose, context: last.parsed.context })) return null;
  let continuation;
  try { continuation = JSON.parse(state.messages?.at(-1)?.content); } catch { return null; }
  if (continuation?.schemaVersion !== 'wiselink.jobaid-source-read-continuation.v1' ||
      continuation.status !== 'HOST_SOURCE_READ_CONFIRMED' ||
      continuation.expectedWorkRevision !== revision.workRevision ||
      continuation.sourceReadReceipt?.status !== 'AVAILABLE') return null;
  const observed = observation.result, continued = continuation.sourceReadReceipt;
  let context;
  try { context = JSON.parse(state.messages[1]?.content); } catch { context = null; }
  const compact = Object.hasOwn(state, 'evidenceCache') || Object.hasOwn(context ?? {}, 'deliveredSourceReads') ||
    enabled.generationPolicy.contextProjectionVersion === 'shared-evidence-target-work-v2';
  if (compact || Object.hasOwn(observed, 'cachedReadIndex') || Object.hasOwn(continued, 'cachedReadIndex')) {
    const index = observed.cachedReadIndex;
    if (!Number.isSafeInteger(index) || index < 0 || continued.cachedReadIndex !== index) return null;
    const cached = state.evidenceCache?.reads?.[index];
    if (context?.schemaVersion !== claim.modelInput.schemaVersion || context.purpose !== claim.modelInput.purpose ||
        context.documentOverview?.documentVersionRef !== claim.task.documentVersionId ||
        cached?.schemaVersion !== 'wiselink.jobaid-source-read.v2' || cached.status !== 'AVAILABLE' ||
        cached.receiptKind !== 'SOURCE_READ' || cached.scope !== last.parsed.context || cached.completeRequestedScope !== true ||
        !isDeepStrictEqual(cached.sourceRefs, last.parsed.sourceRefs) ||
        !isDeepStrictEqual(cached, context.deliveredSourceReads?.reads?.[index]) ||
        !Array.isArray(cached.evidenceRefs) || !cached.evidenceRefs.length ||
        !Array.isArray(state.evidenceCache.evidence) || !Array.isArray(context.deliveredEvidence)) return null;
    for (const ref of cached.evidenceRefs) {
      const retained = state.evidenceCache.evidence.filter(item => item?.evidenceRef === ref);
      const delivered = context.deliveredEvidence.filter(item => item?.evidenceRef === ref);
      if (typeof ref !== 'string' || !ref || retained.length !== 1 || delivered.length !== 1 ||
          !isDeepStrictEqual(retained[0], delivered[0])) return null;
    }
  } else if (!isDeepStrictEqual(observed.sourceRefs, last.parsed.sourceRefs) ||
      !isDeepStrictEqual(continued.sourceRefs, last.parsed.sourceRefs)) return null;
  return { claim, proof: { round: state.round, workRevisionRef: revision.workRevisionRef, requestId: revision.requestId },
    provenance: {
      modelVersion: actualModelVersion(last.payload, last.payload.choices[0], last.payload.choices[0].message,
        `configured-route:${claim.task.executionModel.modelRef}`),
      promptVersion: claim.modelInput.schemaVersion === 'wiselink.jobaid-problem-task.v3'
        ? 'wiselink-jobaid-problem@v3' : 'wiselink-jobaid-problem@v2',
      skillVersion: WISELINK_SKILL_VERSION,
      toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION,
        'jobaid-problem-protocol': claim.modelInput.schemaVersion === 'wiselink.jobaid-problem-task.v3' ? '3' : '2',
        ...(claim.modelInput.tdmsContext ? { 'tdms-native-context': '1' } : {}) },
      runMetrics: { durationMs: Date.now() - enabled.startedAt, inputUnits: state.inputUnits, outputUnits: state.outputUnits },
    } };
}

export async function finishInitialAssessmentPolicyFailure({ checkpoint, recovery, begin, callTool, modelExecutor = 'HOSTED' }) {
  assertFreshInitialAssessmentClaim(recovery.previousClaim, begin);
  const saved = await readExactSavedWork(callTool, begin.attemptRef, begin.task.workItemId, begin.task.documentVersionId);
  const closure = await inspectPolicyFailureClosure(checkpoint, recovery.operation, saved);
  if (!closure || !isDeepStrictEqual(closure.claim, begin) || !isDeepStrictEqual(closure.proof, recovery.closeOnly))
    throw new Error('INITIAL_ASSESSMENT_POLICY_CLOSURE_UNCONFIRMED');
  return { failureCode: 'JOBAID_CHECKPOINT_POLICY_CHANGED', provenance: {
    ...closure.provenance, toolVersions: { ...closure.provenance.toolVersions,
      ...modelExecutorProvenance({ modelExecutor }) },
  } };
}
