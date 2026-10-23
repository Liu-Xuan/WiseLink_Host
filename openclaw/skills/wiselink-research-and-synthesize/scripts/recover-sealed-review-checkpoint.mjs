import { randomUUID } from 'node:crypto';
import {
  boundedReviewRecoveryTask,
  reconcileBoundedReviewSealedStatus,
  runInteractiveReviewTurn,
} from './orchestrate-host-mcp.mjs';
import { canonicalJson, canonicalSha256, validateResultEnvelope } from './validate-payload.mjs';

const SCHEMA = 'wiselink.3_1.hosted_review_driver.v1';
const ATTENTION = new Set([
  'COMMITTING_RECOVERY_READ_ONLY', 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY',
]);

function assertHash(record, expected, step) {
  if (record?.schemaVersion !== SCHEMA || record.argsHash !== expected)
    throw new Error(`REVIEW_CHECKPOINT_ARGUMENT_MISMATCH:${step}`);
}

function commitArgs(begin, result) {
  // This is the original driver checkpoint shape, before the consumer adds
  // workItemId to the actual MCP transport. Never reseal or rebuild the result.
  return { attemptRef: begin.attemptRef, leaseToken: begin.leaseToken,
    leaseGeneration: begin.leaseGeneration, resultJson: canonicalJson(result) };
}

/** One private recovery lane for an already sealed c235 bounded Review only.
 * Old checkpoints locate/compare; fresh Host begin/status remain authoritative.
 * The ordinary remoteStep implementation and all old files stay unchanged. */
export async function recoverBoundedReviewCheckpoint({ checkpoint, options, prior, callTool }) {
  const receipt = await checkpoint.readOptional('begin.result');
  const old = receipt?.value;
  const addon = old?.task?.modelInput?.jobAidContext?.tdmsReviewContext;
  if (addon?.mode !== 'BOUNDED_NATIVE_READ') return null;
  const originalStarted = await checkpoint.readOptional('commit.started');
  const originalCommit = await checkpoint.readOptional('commit.result');
  if (!(originalStarted && !originalCommit) && old?.status !== 'COMMITTING' &&
      !ATTENTION.has(prior?.outcome)) return null;
  try {
    if (typeof callTool !== 'function') throw new Error('REVIEW_DRIVER_DEPENDENCY_REQUIRED');
    const mode = await checkpoint.readOptional('run-mode');
    if (mode && mode.mode !== 'INTERACTIVE_REVIEW')
      throw new Error('REVIEW_CHECKPOINT_MODE_BINDING_MISMATCH');
    const beginArgs = { reviewConversationRef: options.reviewConversationRef,
      requestId: options.requestId, ...(options.workItemId ? { workItemId: options.workItemId } : {}) };
    assertHash(receipt, canonicalSha256(beginArgs), 'begin');
    const oldTask = boundedReviewRecoveryTask(old.task);
    if (!oldTask || oldTask.reviewConversationRef !== options.reviewConversationRef ||
        oldTask.requestId !== options.requestId ||
        (options.workItemId && old.task.workItemId !== options.workItemId))
      throw new Error('REVIEW_SEALED_CHECKPOINT_BINDING_MISMATCH');
    const prefix = `bounded-sealed-recovery-${randomUUID()}`;
    const commitStep = `${prefix}-commit`;
    const counts = new Map();
    const remote = async (step, name, args, ambiguousCommit = false) => checkpoint.remoteStep({
      step, args, ambiguousCommit, perform: async () => {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        return callTool(name, structuredClone(args));
      },
    });
    const begin = await remote(`${prefix}-begin`, 'begin_review_turn', beginArgs);
    const freshTask = boundedReviewRecoveryTask(begin?.task);
    if (!freshTask || begin.status !== 'COMMITTING' ||
        begin.attemptRef !== old.attemptRef || begin.attemptRef !== begin.task.operationRef ||
        typeof begin.leaseToken !== 'string' || !begin.leaseToken.trim() ||
        begin.leaseToken !== old.leaseToken || begin.leaseGeneration !== old.leaseGeneration ||
        !Number.isSafeInteger(begin.leaseGeneration) || begin.leaseGeneration < 1 ||
        canonicalJson(begin.task) !== canonicalJson(old.task))
      throw new Error('REVIEW_SEALED_FRESH_BEGIN_BINDING_MISMATCH');
    const result = validateResultEnvelope(begin.task, begin.recoveryResult);
    const args = commitArgs(begin, result), hash = canonicalSha256(args);
    if (originalStarted) assertHash(originalStarted, hash, 'commit');
    if (originalCommit) assertHash(originalCommit, hash, 'commit');
    const rejection = await checkpoint.readOptional('commit.error');
    if (rejection) assertHash(rejection, hash, 'commit');
    const latest = await checkpoint.readOptional('bounded-sealed-recovery-last-commit');
    let recoveryCommit = null;
    if (latest) {
      assertHash(latest, hash, 'bounded-sealed-recovery-last-commit');
      if (typeof latest.step !== 'string' ||
          !/^bounded-sealed-recovery-[a-f0-9-]{36}-commit$/u.test(latest.step))
        throw new Error('REVIEW_SEALED_COMMIT_CHECKPOINT_INCOMPLETE');
      const recoveryStarted = await checkpoint.readOptional(`${latest.step}.started`);
      recoveryCommit = await checkpoint.readOptional(`${latest.step}.result`);
      if (recoveryStarted) assertHash(recoveryStarted, hash, latest.step);
      if (recoveryCommit) {
        if (!recoveryStarted) throw new Error('REVIEW_SEALED_COMMIT_CHECKPOINT_INCOMPLETE');
        assertHash(recoveryCommit, hash, latest.step);
      }
    }
    // Retain a received receipt, including an invalid one. A later status-only
    // observation must never launder a known bad receipt into success.
    const retainedRecord = recoveryCommit ?? originalCommit;
    if (retainedRecord && !Object.hasOwn(retainedRecord, 'value'))
      throw new Error('REVIEW_SEALED_COMMIT_CHECKPOINT_INCOMPLETE');
    const retainedCommit = retainedRecord?.value;
    let statusCount = 0, beforeStatus = null, commitRequested = false;
    const recoveryCall = async (name, value) => {
      if (name === 'begin_review_turn') {
        if (canonicalJson(value) !== canonicalJson(beginArgs))
          throw new Error('REVIEW_SEALED_BEGIN_ARGUMENT_MISMATCH');
        return structuredClone(begin);
      }
      if (name === 'get_action_attempt_status') {
        statusCount += 1;
        if (statusCount > 2) throw new Error('REVIEW_SEALED_STATUS_LIMIT_REACHED');
        const observed = await remote(`${prefix}-status-${statusCount === 1 ? 'before' : 'after'}`,
          name, value);
        if (statusCount === 1) {
          beforeStatus = observed;
          if (retainedCommit !== undefined)
            reconcileBoundedReviewSealedStatus(begin, observed, retainedCommit);
        }
        return observed;
      }
      if (name === 'commit_review_turn_candidate') {
        if (commitRequested || canonicalJson(value) !== canonicalJson(args))
          throw new Error('REVIEW_SEALED_COMMIT_REPLAY_FORBIDDEN');
        commitRequested = true;
        // The pointer only locates received receipts for validation. It is not
        // a dispatch gate: a later authorized trigger gets its own fresh Host
        // begin/status and may finish the same still-COMMITTING sealed result.
        await checkpoint.write('bounded-sealed-recovery-last-commit', {
          schemaVersion: SCHEMA, step: commitStep, argsHash: hash,
        });
        return remote(commitStep, name, value, true);
      }
      throw new Error(`REVIEW_SEALED_RECOVERY_TOOL_FORBIDDEN:${name}`);
    };
    let execution;
    try {
      execution = await runInteractiveReviewTurn({ mode: 'INTERACTIVE_REVIEW',
        ...beginArgs, callTool: recoveryCall,
        respond() { throw new Error('REVIEW_SEALED_MODEL_REPLAY_FORBIDDEN'); },
      });
    } catch (error) {
      // A completed attempt may be returned by the Host's sealed begin route.
      // Its status no longer has recoveryResult. Accept only exact Review
      // terminal semantics, and revalidate any real retained receipt.
      if (commitRequested || beforeStatus?.status !== 'SUCCEEDED') throw error;
    }
    if (!commitRequested && beforeStatus?.status === 'SUCCEEDED')
      execution = reconcileBoundedReviewSealedStatus(begin, beforeStatus, retainedCommit);
    return { execution, begin, counts, prefix };
  } catch (error) {
    // Even a fresh mismatched RUNNING begin must not trigger the consumer's
    // ordinary pre-commit cancellation. Recovery never cancels an attempt.
    error.sealedReviewRecovery = true;
    throw error;
  }
}
