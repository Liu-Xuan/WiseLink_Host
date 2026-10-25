#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson } from './validate-payload.mjs';
import { assertHostedModelGatewayReady, createCheckpointStore, createHostMcpConnection,
  resolveRuntimeConfig } from './run-hosted-review-turn.mjs';
import { validateSummaryRunBudget } from './derived-summary-native-gateway.mjs';
import { assertDerivedSummaryReadReceiptShape } from './derived-summary-read-projection.mjs';
import { invokeHostedDerivedSummaryModel, validateDerivedSummarySparseCandidateReplay } from './invoke-hosted-derived-summary-model.mjs';
import { derivedSummaryRegistry, validateDerivedSummaryContent, materializeDerivedSummaryContent,
  normalizeDerivedSummaryContent, validateDerivedSummaryReadSelection,
  validateDerivedSummaryReading, validateDerivedSummaryTask, validateDerivedSummaryProvenance } from './derived-summary-shape.mjs';

const ACTIVE = new Set(['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING']);
const required = (value, code) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value;
};

function assertTarget(value, target, code) {
  if (value?.summaryId !== target.summaryId || value.attemptRef !== target.attemptRef) throw new Error(code);
}

function assertSavedRead(read, target, task, content, provenance) {
  const { receipt, summary } = read ?? {};
  const bodyRefs = new Set(typeof summary?.content?.body === 'string'
    ? [...summary.content.body.matchAll(/\[\[([^\]\r\n]+)\]\]/gu)].map(match => match[1]) : []);
  if (receipt?.summaryId !== target.summaryId || typeof receipt.summaryRef !== 'string' || !receipt.summaryRef ||
      receipt.revision !== task.expectedSummaryRevision + 1 || receipt.replay !== true ||
      summary?.summaryId !== target.summaryId || summary.summaryRef !== receipt.summaryRef ||
      summary.revision !== receipt.revision || summary.attemptRef !== target.attemptRef || summary.requestId !== task.requestId ||
      summary.candidateOnly !== true || summary.classificationStatus !== 'CANDIDATE' ||
      canonicalJson(summary.scope) !== canonicalJson(task.modelInput.scope) ||
      (content && canonicalJson(summary.content) !== canonicalJson(content)) ||
      (provenance && canonicalJson(summary.producer) !== canonicalJson(provenance)) ||
      !Array.isArray(summary.members) || summary.members.length !== task.modelInput.members.length ||
      summary.members.some((member, index) => canonicalJson(member.member) !== canonicalJson(task.modelInput.members[index].member)) ||
      !Array.isArray(summary.coverage) || summary.coverage.length !== task.modelInput.members.length ||
      new Set(summary.coverage.map(entry => entry.evidenceRef)).size !== task.modelInput.members.length ||
      summary.coverage.some(entry => !task.modelInput.members.some(member => member.evidenceRef === entry.evidenceRef &&
        canonicalJson(member.member) === canonicalJson(entry.member) &&
        canonicalJson(member.rootRefs) === canonicalJson(entry.rootRefs)) || entry.delivered !== true ||
        entry.used !== bodyRefs.has(entry.evidenceRef) || typeof entry.limitation !== 'string'))
    throw new Error('DERIVED_SUMMARY_SAVE_READBACK_MISMATCH');
  return read;
}

/** Subject-scoped native consumer: no discovery, admission or fabricated WI/Matter. */
export async function consumeHostedDerivedSummary(options, dependencies) {
  const target = { summaryId: required(options.summaryId, 'DERIVED_SUMMARY_ID_REQUIRED'),
    attemptRef: required(options.attemptRef, 'DERIVED_SUMMARY_ATTEMPT_REQUIRED') };
  if (options.workItemId || options.matterId || options.documentVersionId) throw new Error('DERIVED_SUMMARY_SUBJECT_AMBIGUOUS');
  const unfenced = (operation, input = {}) => dependencies.callTool('derived_summary_attempt', { ...target, operation, ...input });
  const status = await unfenced('STATUS');
  assertTarget(status, target, 'DERIVED_SUMMARY_STATUS_BINDING_MISMATCH');
  const checkpointPath = join(required(options.checkpointRoot, 'DERIVED_SUMMARY_CHECKPOINT_REQUIRED'),
    'derived-summary', options.endpointKey ?? 'host', encodeURIComponent(target.summaryId), encodeURIComponent(target.attemptRef));
  const readSaved = async requestId => {
    try { return await unfenced('READ_SAVED_SUMMARY', { requestId }); }
    catch (error) { if (error.hostErrorCode === 'DERIVED_SUMMARY_SAVE_NOT_FOUND') return null; throw error; }
  };
  if (status.status === 'SUCCEEDED') {
    const checkpoint = await (dependencies.createCheckpoint ?? createCheckpointStore)(checkpointPath);
    const prior = await checkpoint.readOptional('binding');
    if (prior) {
      const task = validateDerivedSummaryTask(prior.task, target);
      const saved = assertSavedRead(await readSaved(task.requestId), target, task);
      return { status: 'DERIVED_SUMMARY_SAVED', ...target, summaryRef: saved.receipt.summaryRef,
        revision: saved.receipt.revision, candidateOnly: true };
    }
    return { status: 'DERIVED_SUMMARY_FINISHED', ...target, savedSummaryRefs: status.savedSummaryRefs, candidateOnly: true };
  }
  if (!ACTIVE.has(status.status)) return { status: 'REQUIRES_ATTENTION', ...target,
    attemptStatus: status.status, savedSummaryRefs: status.savedSummaryRefs ?? [] };
  const claim = await unfenced('CLAIM');
  assertTarget(claim, target, 'DERIVED_SUMMARY_CLAIM_BINDING_MISMATCH');
  const task = validateDerivedSummaryTask(claim.task, target);
  if (!['RUNNING', 'COMMITTING'].includes(claim.status) || typeof claim.leaseToken !== 'string' || !claim.leaseToken ||
      !Number.isSafeInteger(claim.leaseGeneration) || claim.leaseGeneration < 1 ||
      !Number.isFinite(Date.parse(claim.leaseExpiresAt))) throw new Error('DERIVED_SUMMARY_LEASE_INVALID');
  const fence = { ...target, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration };
  const call = (operation, input = {}) => dependencies.callTool('derived_summary_attempt', { ...fence, operation, ...input });
  const checkpoint = await (dependencies.createCheckpoint ?? createCheckpointStore)(checkpointPath);
  const binding = { ...target, task };
  const previous = await checkpoint.readOptional('binding');
  if (previous && canonicalJson(previous) !== canonicalJson(binding)) throw new Error('DERIVED_SUMMARY_CHECKPOINT_BINDING_MISMATCH');
  if (!previous) await checkpoint.writeOnce('binding', binding);
  const registry = derivedSummaryRegistry(task.modelInput);
  const read = async intent => {
    validateDerivedSummaryReadSelection(intent, registry, intent.action);
    const result = await call(intent.action, { evidenceRefs: intent.evidenceRefs, purpose: intent.purpose });
    assertDerivedSummaryReadReceiptShape(result, intent.action);
    if (intent.action === 'READ_MEMBER_WORK') {
      if (!Array.isArray(result?.members) || result.members.length !== intent.evidenceRefs.length)
        throw new Error('DERIVED_SUMMARY_MEMBER_READ_BINDING_MISMATCH');
      const members = result.members.map(value => {
        const expected = registry.members.get(value?.evidenceRef);
        if (!intent.evidenceRefs.includes(value?.evidenceRef) || !expected)
          throw new Error('DERIVED_SUMMARY_MEMBER_READ_BINDING_MISMATCH');
        // A sealed old member keeps its complete original body, even after reader enrichment.
        const { understanding: _freshUnderstanding, ...legacy } = value;
        const member = Object.hasOwn(expected, 'understanding') ? value : legacy;
        const immutable = ({ current, overviewStatus, limitations, ...content }) => content;
        if (canonicalJson(immutable(member)) !== canonicalJson(immutable(expected)))
          throw new Error('DERIVED_SUMMARY_MEMBER_READ_BINDING_MISMATCH');
        validateDerivedSummaryReading(value);
        validateDerivedSummaryReading(member);
        return member;
      });
      if (new Set(result.members.map(member => member.evidenceRef)).size !== intent.evidenceRefs.length)
        throw new Error('DERIVED_SUMMARY_MEMBER_READ_BINDING_MISMATCH');
      return { members };
    }
    if (!Array.isArray(result?.evidence) || result.evidence.length !== intent.evidenceRefs.length ||
        new Set(result.evidence.map(item => item?.evidenceRef)).size !== intent.evidenceRefs.length ||
        result.evidence.some(item => !intent.evidenceRefs.includes(item?.evidenceRef) ||
          canonicalJson(item) !== canonicalJson(registry.evidence.get(item.evidenceRef))))
      throw new Error('DERIVED_SUMMARY_SOURCE_READ_BINDING_MISMATCH');
    return { evidence: result.evidence };
  };
  const reportFailure = async error => {
    const code = error.hostErrorCode ?? error?.message?.match(/^((?:DERIVED_SUMMARY|REVIEW|HOSTED_GATEWAY)_[A-Z0-9_-]+)$/u)?.[1];
    if (!code) return;
    try {
      const failed = await call('FAIL', { code,
        message: 'Official Hosted summary execution failed before saving. Exact checkpoints preserve the stage and provider outcome.' });
      assertTarget(failed, target, 'DERIVED_SUMMARY_FAIL_READBACK_MISMATCH');
      if (failed.status !== 'FAILED' || failed.errorCode !== code) throw new Error('DERIVED_SUMMARY_FAIL_READBACK_MISMATCH');
      await checkpoint.write('summary-failure-report', { code, reported: true });
    } catch (reportError) {
      const reportErrorCode = reportError.hostErrorCode ?? 'DERIVED_SUMMARY_FAILURE_REPORT_UNVERIFIED';
      error.failureReportErrorCode = reportErrorCode;
      await checkpoint.write('summary-failure-report', { code, reported: false, reportErrorCode });
    }
  };
  const requestId = task.requestId;
  let candidate = await checkpoint.readOptional('summary-candidate');
  // Older checkpoints contain the same candidate before Host's trim/union.
  // Apply those save rules without regenerating the candidate or its provenance.
  if (candidate) candidate = { ...candidate, content: normalizeDerivedSummaryContent(candidate.content, task.modelInput) };
  let saved = await readSaved(requestId);
  if (saved !== null) assertSavedRead(saved, target, task, candidate?.content, candidate?.provenance);
  if (!saved) {
    const exactMembers = await read({ action: 'READ_MEMBER_WORK', evidenceRefs: [...registry.members.keys()],
      purpose: 'Deliver every exact selected member, complete issues and limitations for this summary attempt.' })
      .catch(async error => { await reportFailure(error); throw error; });
    if (!candidate) {
      let invocation = await checkpoint.readOptional('summary-invocation');
      if (!invocation) {
        invocation = { sessionDiscriminator: `${target.attemptRef}:${claim.leaseGeneration}` };
        await checkpoint.writeOnce('summary-invocation', invocation);
      }
      try {
      candidate = await withSummaryHeartbeat(signal => dependencies.invokeModel({ ...task.modelInput, members: exactMembers.members }, {
        checkpoint, sessionDiscriminator: invocation.sessionDiscriminator, executionModel: task.executionModel,
        deadlineAt: task.deadlineAt, signal, summaryId: target.summaryId, attemptRef: target.attemptRef,
        prepareGateway: dependencies.prepareGateway, runBudget: options.runBudget,
        modelExecutor: options.modelExecutor ?? 'HOSTED', codexOptions: options.codexOptions,
        onStarted: dependencies.onCodexStarted,
        heartbeat: () => call('HEARTBEAT'), readMembers: read, readSources: read,
      }), () => call('HEARTBEAT'));
      candidate.content = materializeDerivedSummaryContent(candidate.content, task.modelInput);
      } catch (error) {
        await reportFailure(error);
        throw error;
      }
      await checkpoint.writeOnce('summary-candidate', candidate);
    }
    validateDerivedSummaryContent(candidate.content, task.modelInput);
    const invocation = await checkpoint.readOptional('summary-invocation');
    await validateDerivedSummarySparseCandidateReplay(task.modelInput, { checkpoint,
      executionModel: task.executionModel, sessionDiscriminator: invocation?.sessionDiscriminator,
      modelExecutor: options.modelExecutor ?? 'HOSTED' }, candidate);
    // Same requestId and exact complete bytes are replayable under the Host unique constraint/CAS.
    const input = { requestId, expectedSummaryRevision: task.expectedSummaryRevision,
      contentJson: JSON.stringify(candidate.content),
      provenanceJson: JSON.stringify(validateDerivedSummaryProvenance(candidate.provenance, task.executionModel)) };
    let receipt;
    try { receipt = await call('SAVE_SUMMARY', input); }
    catch (error) {
      saved = await readSaved(requestId);
      if (saved === null) throw error;
      assertSavedRead(saved, target, task, candidate.content, candidate.provenance);
    }
    if (receipt && (receipt.summaryId !== target.summaryId || typeof receipt.summaryRef !== 'string' || !receipt.summaryRef ||
        receipt.revision !== task.expectedSummaryRevision + 1 || typeof receipt.replay !== 'boolean'))
      throw new Error('DERIVED_SUMMARY_SAVE_RECEIPT_MISMATCH');
    saved ??= await readSaved(requestId);
    assertSavedRead(saved, target, task, candidate.content, candidate.provenance);
    if (receipt && (receipt.summaryRef !== saved.receipt.summaryRef || receipt.revision !== saved.receipt.revision))
      throw new Error('DERIVED_SUMMARY_SAVE_READBACK_MISMATCH');
  }
  // FINISH cannot manufacture success: an exact persisted revision has already been read.
  const finished = await call('FINISH', { requestId });
  assertTarget(finished, target, 'DERIVED_SUMMARY_FINISH_READBACK_MISMATCH');
  if (finished.status !== 'SUCCEEDED' || finished.savedSummaryRef !== saved.receipt.summaryRef)
    throw new Error('DERIVED_SUMMARY_FINISH_READBACK_MISMATCH');
  return { status: 'DERIVED_SUMMARY_SAVED', ...target, summaryRef: saved.receipt.summaryRef,
    revision: saved.receipt.revision, candidateOnly: true };
}

/** A rejected renewal cancels the actual gateway request before any save. */
export async function withSummaryHeartbeat(invoke, heartbeat, intervalMs = 10_000) {
  const controller = new AbortController();
  let pending; let failure;
  const timer = setInterval(() => {
    if (!pending && !failure) pending = Promise.resolve().then(heartbeat).catch(error => {
      failure = error; controller.abort(error);
    }).finally(() => { pending = null; });
  }, intervalMs);
  try {
    const result = await invoke(controller.signal);
    if (pending) await pending;
    if (failure) throw failure;
    return result;
  } finally {
    clearInterval(timer);
    if (pending) await pending;
  }
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (argv.filter(value => value === name).length > 1) throw new Error('DERIVED_SUMMARY_CLI_OPTION_DUPLICATE');
  return index < 0 ? undefined : argv[index + 1];
}

export function derivedSummaryCliTarget(argv) {
  if (argv.some(value => ['--work-item-id', '--matter-id', '--document-version-id', '--auto-queue'].includes(value)))
    throw new Error('DERIVED_SUMMARY_SUBJECT_AMBIGUOUS');
  const summaryId = required(option(argv, '--summary-id'), 'DERIVED_SUMMARY_ID_REQUIRED');
  const attemptRef = required(option(argv, '--attempt-ref'), 'DERIVED_SUMMARY_ATTEMPT_REQUIRED');
  if (!/^DS-[A-Za-z0-9_-]{1,93}$/u.test(summaryId) || !/^[A-Za-z0-9_-]{1,128}$/u.test(attemptRef))
    throw new Error('DERIVED_SUMMARY_CLI_TARGET_INVALID');
  return { summaryId, attemptRef };
}

async function main(argv, env) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: node consume-hosted-derived-summary.mjs --summary-id ID --attempt-ref ID [--checkpoint-root PATH] --openclaw-config PATH --timeout-ms MS --max-completion-tokens N --max-model-requests N [--reasoning-effort low|high|max] [--provider-timeout-seconds S] [--native-gateway-launcher PATH]\nConsumes exactly one Host-admitted candidate summary attempt through the configured official Hosted profile.\n');
    return;
  }
  const target = derivedSummaryCliTarget(argv);
  const runBudget = validateSummaryRunBudget({ timeoutMs: Number(option(argv, '--timeout-ms')),
    maxCompletionTokens: Number(option(argv, '--max-completion-tokens')),
    maxModelRequests: Number(option(argv, '--max-model-requests')),
    reasoningEffort: option(argv, '--reasoning-effort') ?? 'low',
    ...(option(argv, '--provider-timeout-seconds') ? { providerTimeoutSeconds: Number(option(argv, '--provider-timeout-seconds')) } : {}) });
  const sourceConfigPath = required(option(argv, '--openclaw-config'), 'DERIVED_SUMMARY_CONFIG_PATH_REQUIRED');
  const launcher = await import(pathToFileURL(option(argv, '--native-gateway-launcher') ??
    fileURLToPath(new URL('./native-temporary-review-gateway.mjs', import.meta.url))).href);
  if (typeof launcher.createNativeReviewGatewayPreparer !== 'function') throw new Error('DERIVED_SUMMARY_NATIVE_LAUNCHER_INVALID');
  const prepareGateway = launcher.createNativeReviewGatewayPreparer({ sourceConfigPath });
  const runtime = await resolveRuntimeConfig(argv, env);
  assertHostedModelGatewayReady(runtime);
  const endpoint = new URL(runtime.hostMcpUrl);
  const connection = await createHostMcpConnection(runtime);
  try {
    const result = await consumeHostedDerivedSummary({ ...target, runBudget,
      checkpointRoot: option(argv, '--checkpoint-root') ?? join(homedir(), '.openclaw', 'wiselink-summary-runs'),
      endpointKey: encodeURIComponent(endpoint.origin + endpoint.pathname),
    }, { callTool: connection.callTool, prepareGateway,
      invokeModel: (input, hooks) => invokeHostedDerivedSummaryModel(input, { ...runtime, ...hooks }) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { await connection.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).catch(error => {
    const code = error?.hostErrorCode ?? error?.message?.match(/^((?:DERIVED_SUMMARY|REVIEW|HOSTED_GATEWAY|NATIVE_GATEWAY)_[A-Z0-9_-]+)/u)?.[1] ?? 'DERIVED_SUMMARY_CONSUMER_FAILED';
    process.stderr.write(`${JSON.stringify({ errorCode: code, ...(error.failureReportErrorCode ?
      { failureReportErrorCode: error.failureReportErrorCode } : {}) })}\n`); process.exitCode = 1;
  });
}
