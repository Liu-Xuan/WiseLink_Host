import { canonicalJson, canonicalSha256, sealResultEnvelope, validateTaskEnvelope, WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION, WISELINK_SKILL_VERSION } from './validate-payload.mjs';
import { TRANSLATION_BLOCK_PROMPT_VERSION, validateTranslationSemanticBatch } from './invoke-hosted-translation-block.mjs';
import { modelExecutorProvenance } from './model-executor.mjs';

/** Host persists and chooses versions; this coordinator never assembles text. */
export async function runSemanticTranslation({ begin, callTool, translate, requestId, modelExecutor = 'HOSTED' }) {
  if (!['HOSTED', 'CODEX'].includes(modelExecutor)) throw new Error('MODEL_EXECUTOR_UNSUPPORTED');
  validateTaskEnvelope(begin.task);
  if (begin.task.modelInput.schemaVersion !== 'wiselink.3_1.translation_task.v2' || typeof requestId !== 'string' || !requestId.trim())
    throw new Error('TRANSLATION_V2_BEGIN_INVALID');
  const binding = { attemptRef: begin.attemptRef, leaseToken: begin.leaseToken, leaseGeneration: begin.leaseGeneration };
  const startedAt = Date.now();
  const executions = new Map();
  let codexGenerationSeen = false;
  let requestNo = 0;
  let currentClientRequestId = null;
  const heartbeat = () => callTool('heartbeat_action_attempt', binding);
  const workspace = async (args) => {
    const input = { ...binding, ...args };
    try { return await callTool('translation_workspace', input); }
    catch (cause) {
      if (cause?.receivedHostToolError === true || args.phase === 'READ' || args.phase === 'READ_BATCH') throw cause;
      // Exact idempotent operation after a transport ambiguity. No replacement
      // translation and no new generation request is made by this recovery.
      await callTool('translation_workspace', { ...binding, phase: 'READ' });
      if (codexGenerationSeen) {
        if (['SAVE', 'CHECK', 'CHECK_BATCH', 'RECORD_FAILURE'].includes(args.phase) && currentClientRequestId) {
          try {
            const observed = await callTool('translation_workspace', { ...binding, phase: 'NEXT',
              requestId: currentClientRequestId, batchSemanticChecks: true });
            if (observed?.action === 'REQUEST_RECONCILED' &&
                observed.generationRequestRef === args.generationRequestRef &&
                observed.requestStatus === (args.phase === 'RECORD_FAILURE' ? 'FAILED' : 'SAVED'))
              return observed;
          } catch { /* An unavailable exact Host read cannot authorize a write replay. */ }
        }
        throw new Error('TRANSLATION_SAVE_CONFIRMATION_PENDING', { cause });
      }
      await heartbeat();
      return callTool('translation_workspace', input);
    }
  };
  translationLoop: for (;;) {
    if (Date.now() >= Date.parse(begin.task.deadline)) throw new Error('TRANSLATION_ATTEMPT_DEADLINE_REACHED');
    await heartbeat();
    requestNo += 1;
    currentClientRequestId = `${requestId}:batch-${requestNo}`;
    const next = await workspace({ phase: 'NEXT', requestId: currentClientRequestId, batchSemanticChecks: true });
    if (next.action === 'DONE') break;
    if (next.action === 'REQUEST_RECONCILED') {
      if (typeof translate.recoverTranslationExecution === 'function') {
        const prior = await translate.recoverTranslationExecution(next.generationRequestRef, currentClientRequestId);
        executions.set(next.generationRequestRef, prior.provenance);
      }
      continue;
    }
    if (next.action === 'UNRESOLVED_GENERATION') throw new Error('TRANSLATION_GENERATION_OUTCOME_UNKNOWN');
    const batch = await collectBatch(next, workspace);
    let execution;
    try {
      execution = await translate(batch, { heartbeat,
        sessionDiscriminator: batch.generationRequestRef,
        checkpointKey: `translation-${batch.generationRequestRef}`,
        codexTranslationBinding: { workItemId: begin.task.workItemId, documentVersionId: begin.task.documentVersionId,
          attemptRef: begin.attemptRef, workspaceId: batch.workspaceId,
          clientRequestId: currentClientRequestId,
          generationRequestRef: batch.generationRequestRef, purpose: batch.purpose,
          blockIds: batch.blocks.map(block => block.blockId), batchHash: canonicalSha256(batch) },
        timeoutMs: Math.max(1, Date.parse(begin.task.deadline) - Date.now()),
      });
    } catch (cause) {
      if (['CODEX_GENERATION_OUTCOME_UNKNOWN', 'CODEX_GENERATION_RECOVERY_MISMATCH',
        'CODEX_GENERATION_RECEIPT_INVALID'].includes(cause?.cause?.message ?? cause?.message)) throw cause;
      const error = cause?.translationFailure ?? { code: 'TRANSLATION_GENERATION_OUTCOME_UNKNOWN', origin: 'TRANSPORT', outcome: 'GENERATION_UNKNOWN', retryable: false };
      await workspace({ phase: 'RECORD_FAILURE', generationRequestRef: batch.generationRequestRef, error });
      throw cause;
    }
    if (!execution?.output || !execution.actualExecution || !execution.provenance) throw new Error('TRANSLATION_EXECUTION_PROVENANCE_REQUIRED');
    if (execution.provenance.toolVersions?.['model-executor'] === 'CODEX') codexGenerationSeen = true;
    executions.set(batch.generationRequestRef, execution.provenance);
    await heartbeat();
    if (batch.purpose === 'CHECK_BATCH') {
      const saved = await workspace({ phase: 'CHECK_BATCH', generationRequestRef: batch.generationRequestRef,
        semanticReviews: execution.output.checks, actualExecution: execution.actualExecution });
      if (saved.action === 'REQUEST_RECONCILED') continue translationLoop;
      if (saved.generationRequestRef !== batch.generationRequestRef || saved.blocks?.length !== batch.blocks.length ||
        saved.blocks.some((entry, index) => entry.blockId !== batch.blocks[index].blockId ||
          entry.blockRevisionId !== batch.checkCandidates[index].blockRevisionId))
        throw new Error('TRANSLATION_CHECK_READBACK_MISMATCH');
    } else if (batch.purpose === 'CHECK') {
      const checked = await workspace({ phase: 'CHECK', generationRequestRef: batch.generationRequestRef,
        expectedRowVersion: next.targetRowVersion, semanticReview: execution.output, actualExecution: execution.actualExecution });
      if (checked.action === 'REQUEST_RECONCILED') continue translationLoop;
    } else {
      const saved = await workspace({ phase: 'SAVE', generationRequestRef: batch.generationRequestRef,
        candidates: execution.output.blocks, actualExecution: execution.actualExecution });
      if (saved.action === 'REQUEST_RECONCILED') continue translationLoop;
      if (saved.generationRequestRef !== batch.generationRequestRef || saved.blocks.length !== execution.output.blocks.length)
        throw new Error('TRANSLATION_SAVE_READBACK_MISMATCH');
      if (execution.output.blocks.length < batch.blocks.length) {
        // The response finished at whole-block boundaries. Preserve its actual
        // saved prefix; close that generation before scheduling the remainder.
        await workspace({ phase: 'RECORD_FAILURE', generationRequestRef: batch.generationRequestRef,
          error: { origin: 'OUTPUT_CONTRACT', code: 'TRANSLATION_BATCH_PREFIX_ONLY', outcome: 'KNOWN_FAILURE', retryable: false } });
      }
    }
  }
  await heartbeat();
  const assembled = await workspace({ phase: 'ASSEMBLE' });
  if (assembled.schemaVersion !== 'wiselink.3_1.translation_final_result.v2' || assembled.workspaceId !== begin.task.modelInput.workspaceId)
    throw new Error('TRANSLATION_ASSEMBLY_BINDING_INVALID');
  const priorSealed = await translate.readSealedTranslationResult?.(begin.task, assembled);
  if (priorSealed) return { result: priorSealed, completeness: assembled.completeness,
    modelRequestCount: executions.size };
  const completedExecutions = [...executions.values()];
  const provenance = {
    modelVersion: completedExecutions.length ? [...new Set(completedExecutions.map((execution) => execution.modelVersion))].join(';') : 'host-assembly/no-model-call',
    skillVersion: WISELINK_SKILL_VERSION, promptVersion: TRANSLATION_BLOCK_PROMPT_VERSION,
    toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION,
      ...modelExecutorProvenance({ modelExecutor }) },
    runMetrics: { durationMs: Date.now() - startedAt, inputUnits: completedExecutions.reduce((sum, execution) => sum + execution.runMetrics.inputUnits, 0),
      outputUnits: completedExecutions.reduce((sum, execution) => sum + execution.runMetrics.outputUnits, 0) },
  };
  const result = sealResultEnvelope({ task: begin.task, modelOutput: assembled, provenance,
    outputArtifactRefs: [{ ref: assembled.artifact.ref, sha256: assembled.artifact.sha256 }],
    factsConsidered: assembled.manifest.blockRevisions.map((block) => block.blockRevisionId),
    warnings: assembled.completeness === 'PARTIAL' ? ['TRANSLATION_PARTIAL_SCOPE'] : assembled.completeness === 'COMPLETE_WITH_ISSUES' ? ['TRANSLATION_REVIEW_ISSUES_REMAIN'] : [],
  });
  await translate.persistSealedTranslationResult?.(begin.task, assembled, result);
  return { result, completeness: assembled.completeness, modelRequestCount: executions.size };
}

export async function collectBatch(first, workspace) {
  if (first.schemaVersion !== 'wiselink.3_1.translation_batch_delivery.v2' || first.delivery?.partIndex !== 0 ||
    !['GENERATE', 'CORRECT', 'CHECK', 'CHECK_BATCH'].includes(first.action)) throw new Error('TRANSLATION_BATCH_DELIVERY_INVALID');
  const buffers = [];
  for (let partIndex = 0; partIndex < first.delivery.partCount; partIndex += 1) {
    const part = partIndex === 0 ? first : await workspace({ phase: 'READ_BATCH', generationRequestRef: first.generationRequestRef, partIndex });
    if (part.schemaVersion !== first.schemaVersion || part.action !== first.action || part.workspaceId !== first.workspaceId ||
      part.generationRequestRef !== first.generationRequestRef || part.delivery?.partIndex !== partIndex ||
      part.delivery.partCount !== first.delivery.partCount || part.delivery.byteLength !== first.delivery.byteLength ||
      canonicalJson(part.blockIds) !== canonicalJson(first.blockIds) || canonicalJson(part.checkTargets ?? []) !== canonicalJson(first.checkTargets ?? []) || part.targetBlockRevisionId !== first.targetBlockRevisionId ||
      part.targetRowVersion !== first.targetRowVersion || typeof part.delivery.payloadBase64 !== 'string') throw new Error('TRANSLATION_BATCH_DELIVERY_BINDING_INVALID');
    const bytes = Buffer.from(part.delivery.payloadBase64, 'base64');
    if (bytes.toString('base64') !== part.delivery.payloadBase64 || !bytes.length) throw new Error('TRANSLATION_BATCH_DELIVERY_ENCODING_INVALID');
    buffers.push(bytes);
  }
  const bytes = Buffer.concat(buffers);
  if (bytes.length !== first.delivery.byteLength) throw new Error('TRANSLATION_BATCH_DELIVERY_LENGTH_INVALID');
  const batch = JSON.parse(bytes.toString('utf8'));
  validateTranslationSemanticBatch(batch);
  if (batch.workspaceId !== first.workspaceId || batch.generationRequestRef !== first.generationRequestRef || batch.purpose !== first.action ||
    canonicalJson(batch.blocks.map((block) => block.blockId)) !== canonicalJson(first.blockIds)) throw new Error('TRANSLATION_BATCH_CONTENT_BINDING_INVALID');
  if (batch.purpose === 'CHECK_BATCH' && canonicalJson(batch.checkCandidates.map(({ candidate: _candidate, ...target }) => target)) !== canonicalJson(first.checkTargets))
    throw new Error('TRANSLATION_BATCH_CONTENT_BINDING_INVALID');
  return batch;
}
