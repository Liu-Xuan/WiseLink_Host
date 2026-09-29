import { collectBatch } from './run-semantic-translation.mjs';

/** One Host-owned document attempt, bounded leased semantic batches per queue tick. */
export async function runDocumentSemanticTranslationStep(summary, { callTool, translate, observeModelOutput }) {
  const identity = { documentVersionId: summary.documentVersionId, parseRunId: summary.parseRunId,
    attemptRef: summary.attemptRef };
  const claimed = await callTool('document_translation', { action: 'CLAIM', ...identity });
  if (['BUSY', 'REQUIRES_ATTENTION'].includes(claimed?.status)) return claimed;
  const fence = claimed?.fence;
  if (!fence || fence.attemptRef !== identity.attemptRef ||
      claimed.task?.modelInput?.documentProducer !== 'HOSTED_M3' ||
      claimed.task.documentVersionId !== identity.documentVersionId ||
      claimed.task.parseRunId !== identity.parseRunId ||
      claimed.task.workspaceId !== claimed.task.modelInput.workspaceId ||
      claimed.executionModel?.modelRef !== 'm3probe/minimax-m3')
    throw new Error('DOCUMENT_TRANSLATION_CLAIM_BINDING_INVALID');
  const lease = { leaseToken: fence.leaseToken, leaseGeneration: fence.leaseGeneration };
  const binding = { ...identity, ...lease };
  let heartbeatError = null;
  let heartbeat = Promise.resolve();
  const renew = async () => {
    const result = await callTool('document_translation', { action: 'HEARTBEAT', ...binding });
    if (result?.renewed !== true || result.attemptRef !== identity.attemptRef)
      throw new Error('DOCUMENT_TRANSLATION_HEARTBEAT_REJECTED');
  };
  const timer = setInterval(() => {
    heartbeat = heartbeat.then(renew).catch(error => { heartbeatError = error; });
  }, 30_000);
  const assertLease = async () => {
    await heartbeat;
    if (heartbeatError) throw new Error('DOCUMENT_TRANSLATION_LEASE_LOST', { cause: heartbeatError });
    await renew();
  };
  const workspace = (fields) => callTool('document_translation', { action: 'WORKSPACE', ...binding,
    workspaceCommand: { attemptRef: binding.attemptRef, leaseToken: binding.leaseToken,
      leaseGeneration: binding.leaseGeneration, ...fields } });
  let finished = false;
  try {
    const tickDeadline = Date.now() + 8 * 60_000;
    for (let step = 0; step < 4 && Date.now() < tickDeadline; step++) {
      await assertLease();
      const progress = await workspace({ phase: 'READ' });
      if (!Number.isSafeInteger(progress?.generationRequestCount) || progress.generationRequestCount < 0 ||
          !Number.isSafeInteger(progress.retryableFailureCount))
        throw new Error('DOCUMENT_TRANSLATION_PROGRESS_INVALID');
      if (progress.terminalFailureCode) {
        await assertLease();
        finished = true;
        const failed = await callTool('document_translation', { action: 'FAIL', ...binding,
          errorCode: progress.terminalFailureCode });
        if (failed?.status !== 'FAILED') throw new Error('DOCUMENT_TRANSLATION_FAIL_READBACK_MISMATCH');
        return { ...summary, status: 'REQUIRES_ATTENTION', errorCode: progress.terminalFailureCode };
      }
      if (progress.retryableFailureCount >= 3)
        return { ...summary, status: 'REQUIRES_ATTENTION', errorCode: 'DOCUMENT_TRANSLATION_RETRY_LIMIT' };
      const next = await workspace({ phase: 'NEXT',
        requestId: `document:${identity.attemptRef}:batch-${progress.generationRequestCount}`,
        batchSemanticChecks: true });
      if (next.action === 'DONE') {
        await assertLease();
        const result = await callTool('document_translation', { action: 'FINISH', ...binding });
        finished = true;
        return result;
      }
      if (next.action === 'UNRESOLVED_GENERATION')
        return { ...summary, status: 'REQUIRES_ATTENTION',
          errorCode: 'DOCUMENT_TRANSLATION_GENERATION_OUTCOME_UNKNOWN' };
      if (next.action === 'REQUEST_RECONCILED') continue;
      const batch = await collectBatch(next, workspace);
      let execution;
      try {
        execution = await translate(batch, { executionModel: claimed.executionModel,
          configuredModelVersion: claimed.executionModel.modelRef, heartbeat: assertLease,
          sessionDiscriminator: batch.generationRequestRef,
          observeModelOutput: (shape, round = 1) => observeModelOutput?.({
            attemptRef: identity.attemptRef, generationRequestRef: batch.generationRequestRef,
            shape, round }),
          timeoutMs: Math.max(1, Math.min(15 * 60_000, Date.parse(claimed.task.deadline) - Date.now())) });
      } catch (error) {
        const failure = error?.translationFailure ?? { origin: 'TRANSPORT',
          code: 'DOCUMENT_TRANSLATION_GENERATION_OUTCOME_UNKNOWN', outcome: 'GENERATION_UNKNOWN', retryable: false };
        await assertLease();
        await workspace({ phase: 'RECORD_FAILURE', generationRequestRef: batch.generationRequestRef, error: failure });
        if (failure.outcome === 'KNOWN_FAILURE' && !failure.retryable) {
          finished = true;
          const failed = await callTool('document_translation', { action: 'FAIL', ...binding,
            errorCode: failure.code });
          if (failed?.status !== 'FAILED') throw new Error('DOCUMENT_TRANSLATION_FAIL_READBACK_MISMATCH');
        }
        return { ...summary, status: failure.outcome === 'KNOWN_FAILURE' && failure.retryable
          ? 'RUNNING' : 'REQUIRES_ATTENTION', errorCode: failure.code };
      }
      if (!execution?.output || !execution.actualExecution)
        throw new Error('DOCUMENT_TRANSLATION_EXECUTION_INVALID');
      await assertLease();
      if (batch.purpose === 'CHECK_BATCH') {
        await workspace({ phase: 'CHECK_BATCH', generationRequestRef: batch.generationRequestRef,
          semanticReviews: execution.output.checks, actualExecution: execution.actualExecution });
      } else if (batch.purpose === 'CHECK') {
        await workspace({ phase: 'CHECK', generationRequestRef: batch.generationRequestRef,
          expectedRowVersion: next.targetRowVersion, semanticReview: execution.output,
          actualExecution: execution.actualExecution });
      } else {
        const saved = await workspace({ phase: 'SAVE', generationRequestRef: batch.generationRequestRef,
          candidates: execution.output.blocks, actualExecution: execution.actualExecution });
        if (saved?.generationRequestRef !== batch.generationRequestRef ||
            saved.blocks?.length !== execution.output.blocks.length)
          throw new Error('DOCUMENT_TRANSLATION_SAVE_READBACK_MISMATCH');
        if (execution.output.blocks.length < batch.blocks.length)
          await workspace({ phase: 'RECORD_FAILURE', generationRequestRef: batch.generationRequestRef,
            error: { origin: 'OUTPUT_CONTRACT', code: 'TRANSLATION_BATCH_PREFIX_ONLY',
              outcome: 'KNOWN_FAILURE', retryable: false } });
      }
    }
    return { ...summary, status: 'RUNNING', stepStatus: 'PROGRESSED' };
  } finally {
    clearInterval(timer);
    await heartbeat;
    if (!finished && !heartbeatError) {
      const released = await callTool('document_translation', { action: 'RELEASE', ...binding });
      if (released?.released !== true || released.attemptRef !== identity.attemptRef)
        throw new Error('DOCUMENT_TRANSLATION_RELEASE_REJECTED');
    }
  }
}
