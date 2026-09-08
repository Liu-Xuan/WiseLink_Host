import { canonicalJson, sealResultEnvelope, validateTaskEnvelope, WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION, WISELINK_SKILL_VERSION } from './validate-payload.mjs';
import { TRANSLATION_BLOCK_PROMPT_VERSION, validateTranslationSemanticBatch } from './invoke-hosted-translation-block.mjs';

/** Host persists and chooses versions; this coordinator never assembles text. */
export async function runSemanticTranslation({ begin, callTool, translate, requestId }) {
  validateTaskEnvelope(begin.task);
  if (begin.task.modelInput.schemaVersion !== 'wiselink.3_1.translation_task.v2' || typeof requestId !== 'string' || !requestId.trim())
    throw new Error('TRANSLATION_V2_BEGIN_INVALID');
  const binding = { attemptRef: begin.attemptRef, leaseToken: begin.leaseToken, leaseGeneration: begin.leaseGeneration };
  const startedAt = Date.now();
  const executions = [];
  let requestNo = 0;
  const heartbeat = () => callTool('heartbeat_action_attempt', binding);
  const workspace = async (args) => {
    const input = { ...binding, ...args };
    try { return await callTool('translation_workspace', input); }
    catch (cause) {
      if (cause?.receivedHostToolError === true || args.phase === 'READ' || args.phase === 'READ_BATCH') throw cause;
      // Exact idempotent operation after a transport ambiguity. No replacement
      // translation and no new generation request is made by this recovery.
      await callTool('translation_workspace', { ...binding, phase: 'READ' });
      await heartbeat();
      return callTool('translation_workspace', input);
    }
  };
  for (;;) {
    if (Date.now() >= Date.parse(begin.task.deadline)) throw new Error('TRANSLATION_ATTEMPT_DEADLINE_REACHED');
    await heartbeat();
    requestNo += 1;
    const next = await workspace({ phase: 'NEXT', requestId: `${requestId}:batch-${requestNo}` });
    if (next.action === 'DONE') break;
    if (next.action === 'REQUEST_RECONCILED') continue;
    if (next.action === 'UNRESOLVED_GENERATION') throw new Error('TRANSLATION_GENERATION_OUTCOME_UNKNOWN');
    const batch = await collectBatch(next, workspace);
    let execution;
    try {
      execution = await translate(batch, { heartbeat,
        sessionDiscriminator: batch.generationRequestRef,
        checkpointKey: `translation-${batch.generationRequestRef}`,
        timeoutMs: Math.max(1, Date.parse(begin.task.deadline) - Date.now()),
      });
    } catch (cause) {
      const error = cause?.translationFailure ?? { code: 'TRANSLATION_GENERATION_OUTCOME_UNKNOWN', origin: 'TRANSPORT', outcome: 'GENERATION_UNKNOWN', retryable: false };
      await workspace({ phase: 'RECORD_FAILURE', generationRequestRef: batch.generationRequestRef, error });
      throw cause;
    }
    if (!execution?.output || !execution.actualExecution || !execution.provenance) throw new Error('TRANSLATION_EXECUTION_PROVENANCE_REQUIRED');
    executions.push(execution.provenance);
    await heartbeat();
    if (batch.purpose === 'CHECK') {
      await workspace({ phase: 'CHECK', generationRequestRef: batch.generationRequestRef,
        expectedRowVersion: next.targetRowVersion, semanticReview: execution.output, actualExecution: execution.actualExecution });
    } else {
      const saved = await workspace({ phase: 'SAVE', generationRequestRef: batch.generationRequestRef,
        candidates: execution.output.blocks, actualExecution: execution.actualExecution });
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
  const provenance = {
    modelVersion: executions.length ? [...new Set(executions.map((execution) => execution.modelVersion))].join(';') : 'host-assembly/no-model-call',
    skillVersion: WISELINK_SKILL_VERSION, promptVersion: TRANSLATION_BLOCK_PROMPT_VERSION,
    toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION },
    runMetrics: { durationMs: Date.now() - startedAt, inputUnits: executions.reduce((sum, execution) => sum + execution.runMetrics.inputUnits, 0),
      outputUnits: executions.reduce((sum, execution) => sum + execution.runMetrics.outputUnits, 0) },
  };
  const result = sealResultEnvelope({ task: begin.task, modelOutput: assembled, provenance,
    outputArtifactRefs: [{ ref: assembled.artifact.ref, sha256: assembled.artifact.sha256 }],
    factsConsidered: assembled.manifest.blockRevisions.map((block) => block.blockRevisionId),
    warnings: assembled.completeness === 'PARTIAL' ? ['TRANSLATION_PARTIAL_SCOPE'] : assembled.completeness === 'COMPLETE_WITH_ISSUES' ? ['TRANSLATION_REVIEW_ISSUES_REMAIN'] : [],
  });
  return { result, completeness: assembled.completeness, modelRequestCount: executions.length };
}

async function collectBatch(first, workspace) {
  if (first.schemaVersion !== 'wiselink.3_1.translation_batch_delivery.v2' || first.delivery?.partIndex !== 0 ||
    !['GENERATE', 'CORRECT', 'CHECK'].includes(first.action)) throw new Error('TRANSLATION_BATCH_DELIVERY_INVALID');
  const buffers = [];
  for (let partIndex = 0; partIndex < first.delivery.partCount; partIndex += 1) {
    const part = partIndex === 0 ? first : await workspace({ phase: 'READ_BATCH', generationRequestRef: first.generationRequestRef, partIndex });
    if (part.schemaVersion !== first.schemaVersion || part.action !== first.action || part.workspaceId !== first.workspaceId ||
      part.generationRequestRef !== first.generationRequestRef || part.delivery?.partIndex !== partIndex ||
      part.delivery.partCount !== first.delivery.partCount || part.delivery.byteLength !== first.delivery.byteLength ||
      canonicalJson(part.blockIds) !== canonicalJson(first.blockIds) || part.targetBlockRevisionId !== first.targetBlockRevisionId ||
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
  return batch;
}
