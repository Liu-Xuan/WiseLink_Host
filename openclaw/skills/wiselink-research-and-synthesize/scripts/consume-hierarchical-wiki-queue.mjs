import { join } from 'node:path';
import { consumeHostedDerivedSummary } from './consume-hosted-derived-summary.mjs';
import { consumeHostedMatter } from './consume-hosted-matter.mjs';
import { createCheckpointStore } from './run-hosted-review-turn.mjs';
import {
  createSummaryGatewaySession,
  validateSummaryGatewayReceipt,
  validateSummaryRunBudget,
} from './derived-summary-native-gateway.mjs';
import { createSummaryCodexGatewaySession, validateSummaryCodexReceipt } from './derived-summary-codex-gateway.mjs';
import { validateDerivedSummaryTask } from './derived-summary-shape.mjs';
import { canonicalJson, WISELINK_PROFILE_REF } from './validate-payload.mjs';
import { requestHostedGateway } from './request-hosted-gateway.mjs';

async function providerClosed(store, active) {
  const started = await store.readOptional('summary-gateway.started');
  const receipt = await store.readOptional('summary-gateway.receipt');
  const codexStarted = await store.readOptional('summary-codex.started');
  const codexReceipt = await store.readOptional('summary-codex.receipt');
  if (started && codexStarted) throw new Error('WIKI_GATEWAY_BINDING_INVALID');
  if (codexStarted) {
    if (receipt || started || codexStarted.executor !== 'CODEX' ||
        codexStarted.attemptRef !== active.attemptRef ||
        codexStarted.subject?.kind !== (active.kind === 'MATTER' ? 'ENGINEERING_MATTER' : 'DERIVED_SUMMARY') ||
        (active.kind === 'MATTER' ? codexStarted.subject.matterId !== active.matterId
          : codexStarted.subject.summaryId !== active.summaryId))
      throw new Error('WIKI_CODEX_BINDING_INVALID');
    if (active.kind === 'MATTER') {
      const binding = await store.readOptional('binding');
      const gateway = await store.readOptional('wiki-matter.gateway-binding');
      if (binding?.matterId !== active.matterId || binding.attemptRef !== active.attemptRef ||
          gateway?.matterId !== active.matterId || gateway.attemptRef !== active.attemptRef ||
          canonicalJson(codexStarted.executionModel) !== canonicalJson(gateway.executionModel) ||
          codexStarted.taskDeadlineAt !== gateway.deadlineAt)
        throw new Error('WIKI_CODEX_BINDING_INVALID');
    } else {
      const binding = await store.readOptional('binding');
      if (binding?.summaryId !== active.summaryId || binding.attemptRef !== active.attemptRef ||
          canonicalJson(codexStarted.executionModel) !==
            canonicalJson(validateDerivedSummaryTask(binding.task, active).executionModel) ||
          codexStarted.taskDeadlineAt !== binding.task.deadlineAt)
        throw new Error('WIKI_CODEX_BINDING_INVALID');
    }
    return !!codexReceipt && validateSummaryCodexReceipt(codexReceipt, codexStarted).closed;
  }
  if (codexReceipt) throw new Error('WIKI_CODEX_BINDING_INVALID');
  if (!started) return active.phase === 'NO_GATEWAY' && !receipt;
  if (active.kind === 'MATTER') {
    const binding = await store.readOptional('binding');
    const gateway = await store.readOptional('wiki-matter.gateway-binding');
    if (
      binding?.matterId !== active.matterId ||
      binding.attemptRef !== active.attemptRef ||
      !binding.inputHash ||
      gateway?.matterId !== active.matterId ||
      gateway.attemptRef !== active.attemptRef ||
      started.attemptRef !== active.attemptRef ||
      started.subject?.kind !== 'ENGINEERING_MATTER' ||
      started.subject.matterId !== active.matterId ||
      started.nativeSessionKey !==
        `agent:${WISELINK_PROFILE_REF}:matter:${active.matterId}:${active.attemptRef}` ||
      canonicalJson(started.executionModel) !==
        canonicalJson(gateway.executionModel) ||
      started.taskDeadlineAt !== gateway.deadlineAt
    )
      throw new Error('WIKI_GATEWAY_BINDING_INVALID');
    return !!receipt && summaryProviderSafelyClosed(receipt, started);
  }
  const binding = await store.readOptional('binding');
  if (
    binding?.summaryId !== active.summaryId ||
    binding.attemptRef !== active.attemptRef
  )
    throw new Error('WIKI_CHECKPOINT_BINDING_INVALID');
  const task = validateDerivedSummaryTask(binding.task, active);
  if (
    started.attemptRef !== active.attemptRef ||
    started.subject?.kind !== 'DERIVED_SUMMARY' ||
    started.subject.summaryId !== active.summaryId ||
    started.nativeSessionKey !==
      `agent:${WISELINK_PROFILE_REF}:summary:${active.summaryId}:${active.attemptRef}` ||
    canonicalJson(started.executionModel) !==
      canonicalJson(task.executionModel) ||
    started.taskDeadlineAt !== task.deadlineAt
  )
    throw new Error('WIKI_GATEWAY_BINDING_INVALID');
  return !!receipt && summaryProviderSafelyClosed(receipt, started);
}

export function summaryProviderSafelyClosed(receipt, binding) {
  validateSummaryGatewayReceipt(receipt, binding, { closed: true });
  return (
    receipt.unknownTerminal === false &&
    receipt.activeOrdinal === null &&
    (receipt.upstreamDispatchCount === 0
      ? receipt.dispatches.length === 0
      : receipt.providerStopConfirmed === true &&
        receipt.transportCompleted === true &&
        receipt.dispatches.every(
          (item) =>
            item.transportCompleted &&
            item.providerKnownTerminal &&
            (['stop', 'tool_calls', 'length', 'content_filter'].includes(
              item.finishReason,
            ) ||
              (item.finishReason === null &&
                [429, 503].includes(item.upstreamHttpStatus))),
        ))
  );
}

/** Runs under the existing auto-queue endpoint owner lock, after user/document
 * work is IDLE. The pointer precedes provider preparation and survives UNKNOWN. */
export async function consumeHierarchicalWikiIdle(options, dependencies) {
  if (!options.enabled) return { status: 'IDLE' };
  const codex = options.modelExecutor === 'CODEX';
  const runBudget = validateSummaryRunBudget(options.runBudget);
  const { checkpoint } = dependencies;
  let active = await checkpoint.readOptional('active-wiki');
  if (
    active &&
    (active.schemaVersion !== 1 ||
      ![undefined, 'SUMMARY', 'MATTER'].includes(active.kind) ||
      (active.kind === 'MATTER'
        ? !/^MAT-[A-Za-z0-9_-]{1,92}$/u.test(active.matterId)
        : !/^DS-[A-Za-z0-9_-]{1,93}$/u.test(active.summaryId)) ||
      !/^AQ-[A-Za-z0-9-]+$/u.test(active.attemptRef) ||
      ![undefined, 'CODEX'].includes(active.modelExecutor) ||
      !['NO_GATEWAY', 'PREPARING'].includes(active.phase))
  )
    throw new Error('WIKI_ACTIVE_POINTER_INVALID');
  // Markerless v1 pointers belong to the original Hosted executor. The exact
  // owner must not resume an unresolved attempt with a different executor.
  if (active && (active.modelExecutor === 'CODEX') !== codex)
    throw new Error('WIKI_MODEL_EXECUTOR_BINDING_INVALID');
  if (!active) {
    const next = await dependencies.callTool('next_hierarchical_wiki', {});
    if (next.status === 'IDLE') return next;
    if (next.status === 'ATTENTION' && Array.isArray(next.errorCodes))
      return next;
    if (
      !['SUMMARY_PENDING', 'MATTER_PENDING'].includes(next.status) ||
      (next.status === 'MATTER_PENDING'
        ? !/^MAT-[A-Za-z0-9_-]{1,92}$/u.test(next.matterId)
        : !/^DS-[A-Za-z0-9_-]{1,93}$/u.test(next.summaryId)) ||
      !/^AQ-[A-Za-z0-9-]+$/u.test(next.attemptRef)
    )
      throw new Error('WIKI_DISPATCH_BINDING_INVALID');
    active = {
      schemaVersion: 1,
      ...(next.status === 'MATTER_PENDING'
        ? { kind: 'MATTER', matterId: next.matterId }
        : { kind: 'SUMMARY', summaryId: next.summaryId }),
      attemptRef: next.attemptRef,
      ...(codex ? { modelExecutor: 'CODEX' } : {}),
      phase: 'NO_GATEWAY',
    };
    await checkpoint.write('active-wiki', active);
  }
  const matter = active.kind === 'MATTER';
  const target = {
    ...(matter
      ? { matterId: active.matterId }
      : { summaryId: active.summaryId }),
    attemptRef: active.attemptRef,
  };
  const matterRoot = join(
    options.checkpointRoot,
    'hierarchical-wiki',
    options.endpointKey,
  );
  const store = await (dependencies.createCheckpoint ?? createCheckpointStore)(
    matter
      ? join(
          matterRoot,
          'matter',
          encodeURIComponent(target.matterId),
          encodeURIComponent(target.attemptRef),
        )
      : join(
          options.checkpointRoot,
          'derived-summary',
          options.endpointKey,
          encodeURIComponent(target.summaryId),
          encodeURIComponent(target.attemptRef),
        ),
  );
  const callMatter = async (name, input, ...rest) => {
    const response = await dependencies.callTool(
      `hierarchical_wiki_${name}`,
      input,
      ...rest,
    );
    if (
      name === 'next_matter_assessment' &&
      (response.matterId !== target.matterId ||
        response.next?.attemptRef !== target.attemptRef)
    )
      throw new Error('WIKI_MATTER_PENDING_BINDING_MISMATCH');
    return response;
  };
  try {
    // Each new invocation gets its own one-use preparer. Existing attempt start
    // markers and gateway receipts still prevent rearming an old request.
    const prepare = codex ? null : dependencies.createGatewayPreparer();
    const prepareGateway = async (binding) => {
      active = { ...active, phase: 'PREPARING' };
      await checkpoint.write('active-wiki', active);
      return prepare(binding);
    };
    const onCodexStarted = async () => {
      active = { ...active, phase: 'PREPARING' };
      await checkpoint.write('active-wiki', active);
    };
    const result = matter
      ? await (dependencies.consumeMatter ?? consumeHostedMatter)(
          { matterId: target.matterId, checkpointRoot: matterRoot,
            ...(codex ? { modelExecutor: 'CODEX' } : {}) },
          {
            callTool: callMatter,
            createCheckpoint: dependencies.createCheckpoint,
            invokeMatterModel: async (input, hooks) => {
              if (hooks.executionModel?.modelRef !== 'miaoda/glm-5.3')
                throw new Error('WIKI_AUTOMATIC_MODEL_UNAVAILABLE');
              const binding = {
                ...target,
                executionModel: hooks.executionModel,
                deadlineAt: hooks.taskDeadline,
              };
              const previous = await store.readOptional(
                'wiki-matter.gateway-binding',
              );
              if (
                previous &&
                canonicalJson(previous) !== canonicalJson(binding)
              )
                throw new Error('WIKI_GATEWAY_BINDING_INVALID');
              if (!previous)
                await store.writeOnce('wiki-matter.gateway-binding', binding);
              const gateway = (codex ? createSummaryCodexGatewaySession : createSummaryGatewaySession)({
                ...binding,
                runBudget,
                checkpoint: store,
                ...(codex ? { codexOptions: options.codexOptions, durableRounds: true,
                  onStarted: onCodexStarted, requestGateway: dependencies.requestGateway } : { prepareGateway,
                  requestGateway: dependencies.requestGateway ?? requestHostedGateway }),
              });
              try {
                return await dependencies.invokeMatterModel(input, hooks, {
                  requestGateway: (_url, init) => {
                    if (codex) gateway.setRound(init.codexRound, init.codexRecoverOnly);
                    return gateway.request(init);
                  },
                });
              } finally {
                await gateway.close();
              }
            },
          },
        )
      : await (dependencies.consumeSummary ?? consumeHostedDerivedSummary)(
          {
            ...target,
            runBudget,
            checkpointRoot: options.checkpointRoot,
            endpointKey: options.endpointKey,
            modelExecutor: options.modelExecutor,
            codexOptions: options.codexOptions,
          },
          {
            callTool: dependencies.callTool,
            createCheckpoint: dependencies.createCheckpoint,
            invokeModel: dependencies.invokeModel,
            prepareGateway,
            onCodexStarted,
          },
        );
    if (!(await providerClosed(store, active)))
      return {
        status: 'WIKI_ATTENTION',
        ...target,
        errorCode: 'WIKI_PROVIDER_TERMINAL_UNKNOWN',
      };
    if (
      !(
        matter
          ? ['MATTER_WORK_SAVED']
          : ['DERIVED_SUMMARY_SAVED', 'DERIVED_SUMMARY_FINISHED']
      ).includes(result.status)
    )
      throw new Error('WIKI_CONSUMER_RESULT_INVALID');
    await checkpoint.write('active-wiki', null);
    return {
      status: matter ? 'WIKI_MATTER_DISPATCHED' : 'WIKI_DISPATCHED',
      ...target,
      result,
    };
  } catch (error) {
    // A completed Codex process is only a model receipt. A failed or lost
    // SAVE/READ/FINISH acknowledgement must keep this exact queue pointer so
    // the same Host request can be read back and completed on the next tick.
    if (codex && await store.readOptional('summary-codex.started')) {
      return { status: 'WIKI_ATTENTION', ...target,
        errorCode: error?.message === 'DERIVED_SUMMARY_CODEX_PROCESS_UNVERIFIED'
          ? 'WIKI_PROVIDER_TERMINAL_UNKNOWN'
          : typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
            ? error.message : 'WIKI_CODEX_RECOVERY_REQUIRES_ATTENTION' };
    }
    const started = await store.readOptional('summary-gateway.started') ||
      await store.readOptional('summary-codex.started');
    let closed = false;
    let controlError = null;
    try {
      if (started) closed = await providerClosed(store, active);
    } catch {
      /* Preserve the pointer when checkpoint or terminal proof is invalid. */
    }
    if (closed || (!started && active.phase === 'NO_GATEWAY')) {
      // No model could have started through this pointer. End the exact Host
      // request before releasing it; an uncertain control write remains pinned.
      try {
        const cancel = await dependencies.callTool(
          'hierarchical_wiki_cleanup',
          {
            kind: matter ? 'MATTER' : 'SUMMARY',
            subjectId: matter ? target.matterId : target.summaryId,
            attemptRef: target.attemptRef,
            operation: 'CANCEL',
          },
        );
        closed =
          (matter
            ? cancel.matterId === target.matterId
            : cancel.summaryId === target.summaryId) &&
          cancel.attemptRef === target.attemptRef &&
          [
            'CANCELLED',
            'FAILED',
            'SUCCEEDED',
            'CONFLICT',
            'TIMED_OUT',
            'OBSOLETE',
          ].includes(cancel.status);
        if (
          !closed &&
          (cancel.status === 'COMMITTING' || cancel.cancelResult === 'TOO_LATE')
        )
          controlError = 'WIKI_HOST_COMMIT_PENDING';
      } catch {
        closed = false;
      }
    }
    if (closed) await checkpoint.write('active-wiki', null);
    const message = error instanceof Error ? error.message : '';
    return {
      status: 'WIKI_ATTENTION',
      ...target,
      errorCode:
        controlError ??
        (closed
          ? /^[A-Z][A-Z0-9_:-]+$/u.test(message)
            ? message
            : 'WIKI_CONSUMER_FAILED'
          : 'WIKI_PROVIDER_TERMINAL_UNKNOWN'),
    };
  }
}
