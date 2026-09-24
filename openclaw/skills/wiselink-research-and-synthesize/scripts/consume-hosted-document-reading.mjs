// Consumes only an explicitly accepted run. No BEGIN, parsing, translation or activity writes.
import { isDeepStrictEqual } from 'node:util';
import { WISELINK_SKILL_VERSION } from './validate-payload.mjs';
const HOST_READING_LEASE_MS = 120_000;
const CHECKPOINT_SCHEMA = 'wiselink.document.reading-checkpoint.v1';
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/u.test(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const tokenCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

// Older model.result/failure checkpoints have no response metadata. Keep that
// absence explicit; zero is a reported token count, never a fallback.
function readingModelResponse(value) {
  const response = value?.modelResponse;
  const usage = response?.usage;
  return {
    finishReason: typeof response?.finishReason === 'string' &&
      /^[a-z_]{1,48}$/u.test(response.finishReason) ? response.finishReason : null,
    usage: {
      inputTokens: tokenCount(usage?.inputTokens),
      outputTokens: tokenCount(usage?.outputTokens),
      totalTokens: tokenCount(usage?.totalTokens),
      reasoningTokens: tokenCount(usage?.reasoningTokens),
    },
  };
}

function withReadingSignal(operation, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); })
      .then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function startReadingLease({ call, fence, documentVersionId, runRef, deadline, claimedAt, intervalMs }) {
  const controller = new AbortController();
  const deadlineAt = Date.parse(deadline ?? '');
  let leaseExpiresAt = claimedAt + HOST_READING_LEASE_MS;
  let lostError = null;
  let busy = false;
  let stopped = false;
  let watchdog;
  let busyDone = Promise.resolve();
  const interval = Math.min(
    Number.isSafeInteger(intervalMs) && intervalMs > 0 ? intervalMs : HOST_READING_LEASE_MS / 2,
    HOST_READING_LEASE_MS / 2);
  const lose = (error) => {
    if (lostError || stopped) return;
    lostError = error;
    controller.abort(error);
  };
  const check = () => {
    if (!Number.isFinite(deadlineAt) || Date.now() >= deadlineAt)
      lose(new Error('READING_DEADLINE_EXCEEDED'));
    else if (Date.now() >= leaseExpiresAt)
      lose(new Error('READING_LEASE_LOST'));
  };
  const arm = () => {
    clearTimeout(watchdog);
    check();
    if (!lostError && !stopped)
      watchdog = setTimeout(arm, Math.max(1, Math.min(deadlineAt, leaseExpiresAt) - Date.now()));
  };
  arm();
  const timer = setInterval(() => {
    check();
    if (lostError || stopped || busy) return;
    busy = true;
    const sentAt = Date.now();
    const requestSignal = AbortSignal.any([
      controller.signal, AbortSignal.timeout(Math.max(1, Math.min(HOST_READING_LEASE_MS / 2, deadlineAt - sentAt, leaseExpiresAt - sentAt))),
    ]);
    busyDone = withReadingSignal(() => call('READING_HEARTBEAT',
      { ...fence, documentVersionId, runRef }, { signal: requestSignal, timeout: HOST_READING_LEASE_MS }), requestSignal)
      .then((renewed) => {
        if (renewed?.runRef !== runRef || renewed?.renewed !== true)
          throw new Error('READING_HEARTBEAT_REJECTED');
        // Conservatively date renewal from send, never from a delayed reply.
        leaseExpiresAt = sentAt + HOST_READING_LEASE_MS;
        arm();
      })
      .catch((error) => { check(); lose(new Error('READING_LEASE_LOST', { cause: error })); })
      .finally(() => { busy = false; });
  }, interval);
  return {
    signal: controller.signal,
    get lost() { check(); return lostError; },
    throwIfLost() { check(); if (lostError) throw lostError; },
    guard(operation) { check(); return withReadingSignal(operation, controller.signal); },
    async stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(watchdog);
      controller.abort(new Error('READING_CONSUMER_STOPPED'));
      await busyDone;
    },
  };
}


function summary(value, documentVersionId, runRef) {
  if (value?.documentVersionId !== documentVersionId || value.runRef !== runRef || !id(value.parseRunId) ||
      !Number.isSafeInteger(value.semanticRevision) || value.semanticRevision < 1 ||
      !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 ||
      !['QUEUED','RUNNING','SAVED','RETRACTED','FAILED','CANCELLED','EXPIRED'].includes(value.status))
    throw new Error('READING_SUMMARY_INVALID');
  return value;
}
function savedReceipt(saved, state, expected) {
  const binding = saved?.sourceBinding;
  const original = binding?.original;
  if (saved?.schemaVersion !== 'wiselink.document.reading.v1' || saved.candidateOnly !== true ||
      saved.readingRunRef !== state.runRef || saved.readingRevision !== state.expectedRevision + 1 ||
      original?.documentVersionId !== state.documentVersionId || original.parseRunId !== state.parseRunId ||
      !Number.isSafeInteger(original.parseRevision) || original.parseRevision < 1 ||
      !nonempty(original.sourceArtifactId) || !nonempty(original.sourceSha256) ||
      !Number.isSafeInteger(original.sourceByteLength) || original.sourceByteLength < 0 ||
      binding.semanticRevision !== state.semanticRevision || !nonempty(saved.headline) || !nonempty(saved.brief?.text) ||
      !Array.isArray(saved.explanation) || !saved.explanation.length || !Array.isArray(saved.criticalConditions) ||
      !Array.isArray(saved.limitations) || !Array.isArray(saved.sourceAnchors) ||
      !['COMPLETE_DELIVERY','PARTIAL_DELIVERY'].includes(saved.readCoverage?.status) ||
      !nonempty(saved.producer?.modelVersion) || !nonempty(saved.producer?.skillVersion) || !Number.isFinite(Date.parse(saved.savedAt)))
    throw new Error('READING_SAVE_RECEIPT_INVALID');
  if (expected && (!isDeepStrictEqual(saved.sourceBinding, expected.sourceBinding) ||
      !isDeepStrictEqual(saved.producer, expected.producer) ||
      Object.keys(expected.candidate).some(key => !isDeepStrictEqual(saved[key], expected.candidate[key]))))
    throw new Error('READING_SAVE_RECEIPT_MISMATCH');
  return saved;
}

export async function consumeHostedDocumentReading(options, dependencies) {
  const { documentVersionId, runRef, leaseOwner } = options;
  if (!id(documentVersionId) || !id(runRef) || typeof leaseOwner !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/u.test(leaseOwner))
    throw new Error('READING_TARGET_REQUIRED');
  if (typeof dependencies.checkpointFactory !== 'function' || typeof dependencies.callTool !== 'function' ||
      typeof dependencies.invokeModel !== 'function') throw new Error('READING_DEPENDENCIES_REQUIRED');
  let lease;
  const call = (action, fields, requestOptions) => dependencies.callTool('document_reading', { action, ...fields },
    requestOptions ?? (lease ? { signal: lease.signal, timeout: HOST_READING_LEASE_MS } : undefined));
  const target = { documentVersionId, runRef };
  const getStatus = async () => summary(await call('READING_STATUS', target,
    { signal: AbortSignal.timeout(60_000), timeout: 60_000 }), documentVersionId, runRef);
  const state = await getStatus();
  if (!['QUEUED','RUNNING','SAVED'].includes(state.status)) return { status: state.status, modelInvocations: 0 };
  const identity = { ...target, parseRunId: state.parseRunId, semanticRevision: state.semanticRevision, expectedRevision: state.expectedRevision };
  const checkpoint = await dependencies.checkpointFactory(target);
  if (typeof checkpoint?.readOptional !== 'function' || typeof checkpoint?.write !== 'function')
    throw new Error('READING_CHECKPOINT_REQUIRED');
  const readCheckpoint = async name => {
    const record = await checkpoint.readOptional(name);
    if (record && (record.schemaVersion !== CHECKPOINT_SCHEMA || !isDeepStrictEqual(record.identity, identity)))
      throw new Error('READING_CHECKPOINT_BINDING_MISMATCH');
    return record?.value ?? null;
  };
  const write = (name, value) => checkpoint.write(name, { schemaVersion: CHECKPOINT_SCHEMA, identity, value });
  let source = await readCheckpoint('source.result');
  const modelStarted = await readCheckpoint('model.started');
  let model = await readCheckpoint('model.result');
  const saveStarted = await readCheckpoint('save.started');
  if (state.status === 'SAVED') return { status: 'READING_SAVED',
    saved: savedReceipt(state.result, state, saveStarted), modelResponse: readingModelResponse(model), modelInvocations: 0 };
  const failure = await readCheckpoint('failure');
  if (failure) return { status: 'REQUIRES_ATTENTION', ...target, errorCode: failure.errorCode,
    modelResponse: readingModelResponse(failure.modelResponse ? failure : model), modelInvocations: 0 };
  if (saveStarted) return { status: 'PENDING_SAVE_CONFIRMATION', ...target,
    modelResponse: readingModelResponse(model), modelInvocations: 0 };
  if (modelStarted && !model) return { status: 'PENDING_MODEL_CONFIRMATION', ...target, modelInvocations: 0 };
  if (model && (!source || !modelStarted)) throw new Error('READING_CHECKPOINT_INCOMPLETE');
  const claimedAt = Date.now();
  const claimed = summary(await call('READING_CLAIM', { ...target, leaseOwner }), documentVersionId, runRef);
  if (claimed.status === 'SAVED') {
    // Another lease owner may have persisted and committed since our first snapshot.
    const currentSave = await readCheckpoint('save.started');
    const currentSource = await readCheckpoint('source.result');
    const currentModel = await readCheckpoint('model.result');
    const expected = currentSave ?? (currentSource && currentModel ? {
      sourceBinding: currentSource.sourceBinding, candidate: currentModel.proposal,
      producer: { skillVersion: WISELINK_SKILL_VERSION, modelVersion: currentModel.modelVersion },
    } : null);
    return { status: 'READING_SAVED', saved: savedReceipt(claimed.result, state, expected),
      modelResponse: readingModelResponse(currentModel), modelInvocations: 0 };
  }
  const fence = claimed.fence;
  if (!fence || fence.leaseOwner !== leaseOwner || typeof fence.leaseToken !== 'string' ||
      !/^[0-9a-f-]{36}$/iu.test(fence.leaseToken) || !Number.isSafeInteger(fence.leaseGeneration) || fence.leaseGeneration < 1)
    throw new Error('READING_LEASE_UNAVAILABLE');
  if (claimed.parseRunId !== state.parseRunId || claimed.semanticRevision !== state.semanticRevision || claimed.expectedRevision !== state.expectedRevision)
    throw new Error('READING_CLAIM_BINDING_MISMATCH');
  const scope = { ...target, leaseOwner: fence.leaseOwner, leaseToken: fence.leaseToken, leaseGeneration: fence.leaseGeneration };
  lease = startReadingLease({ call, fence: scope, ...target, claimedAt, deadline: claimed.deadline, intervalMs: options.heartbeatIntervalMs });
  let modelDispatched = Boolean(modelStarted);
  let saveDispatched = false;
  let modelInvocations = 0;
  try {
    if (!source) {
      source = { ...identity, sourceBinding: null, units: [], anchors: [], deliveredRanges: [], sourceCoverage: null };
      let offset = 0;
      const maxPages = options.maxPages ?? 10_000;
      const limit = options.readLimit ?? 20;
      if (!Number.isSafeInteger(maxPages) || maxPages < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
        throw new Error('READING_PAGE_OPTIONS_INVALID');
      for (let page = 0; page < maxPages; page++) {
        const read = await lease.guard(() => call('READING_READ', { ...scope, offset, limit }));
        const binding = read?.sourceBinding;
        if (read?.runRef !== runRef || binding?.original?.documentVersionId !== documentVersionId ||
            binding.original.parseRunId !== state.parseRunId || binding.semanticRevision !== state.semanticRevision ||
            read.range?.offset !== offset || !Array.isArray(read.units) || !read.units.length || !Array.isArray(read.anchors) ||
            !isDeepStrictEqual(read.range.unitIds, read.units.map(unit => unit.unitId)) ||
            !isDeepStrictEqual(read.range.anchorIds, read.anchors.map(anchor => anchor.anchorId)) ||
            read.anchors.some(anchor => !read.range.unitIds.includes(anchor.sourceUnitId)) ||
            (source.sourceBinding && !isDeepStrictEqual(binding, source.sourceBinding))) throw new Error('READING_DELIVERY_MISMATCH');
        const next = read.range.nextOffset;
        if (next !== null && (!Number.isSafeInteger(next) || next !== offset + read.units.length)) throw new Error('READING_CURSOR_INVALID');
        source.sourceBinding = binding; source.sourceCoverage = read.sourceCoverage;
        source.units.push(...read.units); source.anchors.push(...read.anchors); source.deliveredRanges.push(read.range);
        if (next === null) break;
        offset = next;
      }
      await lease.guard(() => write('source.result', source));
    }
    if (source.sourceBinding?.original?.documentVersionId !== documentVersionId || source.sourceBinding.original.parseRunId !== state.parseRunId ||
        source.sourceBinding.semanticRevision !== state.semanticRevision) throw new Error('READING_SOURCE_CHECKPOINT_INVALID');
    if (!model) {
      await lease.guard(() => write('model.started', { sourceBinding: source.sourceBinding }));
      modelDispatched = true;
      modelInvocations++;
      model = await lease.guard(() => dependencies.invokeModel(source, { signal: lease.signal }));
      if (!nonempty(model?.modelVersion) || model?.proposal?.schemaVersion !== 'wiselink.document.reading.v1')
        throw new Error('READING_MODEL_RESULT_INVALID');
      await lease.guard(() => write('model.result', model));
    }
    if (!nonempty(model?.modelVersion) || model?.proposal?.schemaVersion !== 'wiselink.document.reading.v1')
      throw new Error('READING_MODEL_RESULT_INVALID');
    const producer = { skillVersion: WISELINK_SKILL_VERSION, modelVersion: model.modelVersion };
    const candidate = model.proposal;
    const expected = { sourceBinding: source.sourceBinding, producer, candidate };
    await lease.guard(() => write('save.started', expected));
    saveDispatched = true;
    try {
      const result = await lease.guard(() => call('READING_SAVE', { ...scope, candidate, producer }));
      return { status: 'READING_SAVED', saved: savedReceipt(result, state, expected),
        modelResponse: readingModelResponse(model), modelInvocations };
    } catch (saveError) {
      let recoveryError;
      try {
        const latest = await getStatus();
        if (latest.status === 'SAVED') return { status: 'READING_SAVED',
          saved: savedReceipt(latest.result, state, expected),
          modelResponse: readingModelResponse(model), modelInvocations };
        if (latest.status === 'RETRACTED') return { status: 'RETRACTED',
          modelResponse: readingModelResponse(model), modelInvocations };
      } catch (error) { recoveryError = error; }
      if (definiteError(recoveryError)) throw recoveryError;
      if (definiteError(saveError)) throw saveError;
      return { status: 'PENDING_SAVE_CONFIRMATION', ...target,
        modelResponse: readingModelResponse(model), modelInvocations };
    }
  } catch (error) {
    const errorCode = definiteError(error);
    if (errorCode) {
      const modelResponse = readingModelResponse(error.modelResponse ? error : model);
      await write('failure', { errorCode, modelResponse });
      return { status: 'REQUIRES_ATTENTION', ...target, errorCode, modelResponse, modelInvocations };
    }
    if (saveDispatched) return { status: 'PENDING_SAVE_CONFIRMATION', ...target,
      modelResponse: readingModelResponse(model), modelInvocations };
    if (modelDispatched) return { status: 'PENDING_MODEL_CONFIRMATION', ...target, modelInvocations };
    throw error;
  } finally { await lease.stop(); }
}

// Report bounded application validation codes, never raw transport details or credentials.
function definiteError(error) {
  const code = error?.hostErrorCode ?? error?.code ?? error?.message;
  return typeof code === 'string' && /^(?:DOCUMENT_READING_|READING_(?:MODEL_INPUT_|MODEL_RESULT_|SAVE_RECEIPT_|SOURCE_CHECKPOINT_))[A-Z0-9_]+$/u.test(code) ? code : null;
}
