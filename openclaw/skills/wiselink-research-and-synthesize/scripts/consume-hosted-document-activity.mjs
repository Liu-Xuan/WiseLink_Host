// Deterministic offline consumer for Host document-activity runs.
//
// Authority: Host commit 7c86becbce15960a9cb9604534f0359591629e28, files
// server/modules/canonical-host/document-activity-runtime.service.ts,
// document-work-runtime.service.ts, document-activity-candidate.ts and
// shared/document-activity.interface.ts. The single Host tool is
// `document_work`; action request fields are copied verbatim from
// documentActivityActionSchemas and never guessed. The consumer only
// consumes runs that already exist: ACTIVITY_BEGIN belongs to the explicit
// acceptor, and document_work STATUS returns nextActivityRunRef only for a
// run an explicit BEGIN created. ACTIVITY_STATUS always carries an exact
// non-null runRef. The model returns a candidate proposal only
// (wiselink.document.activity-candidate.v1); Host binding, anchors, coverage,
// statementId, candidateRevision and producer are never backfilled by the
// model. A SAVE with an unknown outcome stays pending-confirmation even
// when the recovery STATUS itself fails: it is never FAILed and never
// reported as success.
//
// Batch B adds the real execution wiring: a durable per-run checkpoint
// (source/selection/fence, model dispatch before HTTP, model result with the
// actual modelVersion before SAVE, the complete SAVE command before
// dispatch) with strict recovery, and an independent lease heartbeat from
// CLAIM through READ/model/SAVE that never extends the fixed 1-hour run
// deadline. An unknown model or SAVE outcome never regenerates, re-dispatches
// or FAILs the run.

import { isDeepStrictEqual } from 'node:util';
import { WISELINK_SKILL_VERSION, canonicalSha256 } from './validate-payload.mjs';

/** The only Host tool, per DocumentWorkRuntimeService/DocumentActivityRuntimeService. */
export const ACTIVITY_TOOL_NAME = 'document_work';

/** From shared/document-activity.interface.ts. */
export const DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA = 'wiselink.document.activity-candidate.v1';

/** Local checkpoint envelope schema for batch-B durable steps. */
export const ACTIVITY_CHECKPOINT_SCHEMA = 'wiselink.document.activity-checkpoint.v1';

/** Host deadline is fixed at 1 hour and the lease at 2 minutes
 * (120_000 ms renewal inside DocumentWorkRuntimeService STEP). The consumer
 * reads both from the Host and never extends them. */
export const HOST_ACTIVITY_DEADLINE_MS = 60 * 60_000;
export const HOST_ACTIVITY_LEASE_MS = 2 * 60_000;

/** Actions the consumer may send. ACTIVITY_BEGIN belongs to the explicit
 * acceptor; ACTIVITY_CANCEL to the explicit owner path (exported separately).
 * Batch B orchestrates ACTIVITY_HEARTBEAT as the lease renewal from CLAIM
 * through READ/model/SAVE. */
export const CONSUMER_ACTIVITY_ACTIONS = Object.freeze([
  'ACTIVITY_STATUS', 'ACTIVITY_CLAIM', 'ACTIVITY_READ',
  'ACTIVITY_SAVE', 'ACTIVITY_FAIL', 'ACTIVITY_HEARTBEAT',
]);

/** Exact request fields per Host documentActivityActionSchemas (zod
 * strictObject). Field-level validation mirrors the zod constraints. */
export const REQUEST_FIELD_SCHEMAS = Object.freeze({
  ACTIVITY_BEGIN: ['documentVersionId', 'parseRunId', 'semanticRevision', 'requestId', 'expectedRevision', 'sectionIds'],
  ACTIVITY_STATUS: ['documentVersionId', 'runRef'],
  ACTIVITY_CANCEL: ['documentVersionId', 'runRef'],
  ACTIVITY_CLAIM: ['documentVersionId', 'runRef', 'leaseOwner'],
  ACTIVITY_HEARTBEAT: ['documentVersionId', 'runRef', 'leaseOwner', 'leaseToken', 'leaseGeneration'],
  ACTIVITY_READ: ['documentVersionId', 'runRef', 'leaseOwner', 'leaseToken', 'leaseGeneration', 'sectionId', 'offset', 'limit'],
  ACTIVITY_SAVE: ['documentVersionId', 'runRef', 'leaseOwner', 'leaseToken', 'leaseGeneration', 'candidate', 'producer'],
  ACTIVITY_FAIL: ['documentVersionId', 'runRef', 'leaseOwner', 'leaseToken', 'leaseGeneration', 'errorCode'],
});

const ID_PATTERN = /^[A-Za-z0-9_-]{1,96}$/u;
const LEASE_OWNER_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/u;
const UUID_PATTERN = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/u;
const ERROR_CODE_PATTERN = /^[A-Z0-9_:-]{1,160}$/u;
const STATEMENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const TIME_ROLES = ['TARGET', 'OCCURRED', 'SOURCE_PUBLICATION', 'EFFECTIVE', 'CONDITION', 'UNKNOWN'];
const TIME_PRECISIONS = ['YEAR', 'QUARTER', 'MONTH', 'DAY', 'UNKNOWN'];
const TIME_EXPRESSIONS = ['CALENDAR', 'TBD', 'RELATIVE', 'UNKNOWN'];
const PROPOSAL_KEYS = ['schemaVersion', 'statements'];
const STATEMENT_KEYS = ['statementKey', 'label', 'quotes', 'time', 'statusRaw', 'limitations'];
const QUOTE_KEYS = ['anchorId', 'start', 'end', 'text'];
const TIME_KEYS = ['role', 'precision', 'expression', 'raw', 'quoteIndex'];

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** typeof guard first: regexes coerce null/numbers to strings. */
function matchesPattern(pattern, value) {
  return typeof value === 'string' && pattern.test(value);
}

function exactKeys(value, keys) {
  const actual = Object.keys(value ?? {}).sort();
  return actual.length === keys.length && keys.every(key => actual.includes(key));
}

/** Build one activity request with exactly the Host-contract fields and
 * Host-contract value shapes. Structurally forbids ACTIVITY_BEGIN and any
 * null runRef discovery form. */
export function buildActivityRequest(action, fields) {
  const names = REQUEST_FIELD_SCHEMAS[action];
  if (!names) throw new Error(`ACTIVITY_ACTION_UNKNOWN:${action}`);
  if (!CONSUMER_ACTIVITY_ACTIONS.includes(action) && action !== 'ACTIVITY_CANCEL')
    throw new Error(`${action}_FORBIDDEN_FOR_CONSUMER`);
  const missing = names.filter(name => fields[name] === undefined);
  if (missing.length)
    throw new Error(`ACTIVITY_REQUEST_FIELDS_INVALID:${action}:${missing.join(',')}`);
  const request = { action };
  for (const name of names) request[name] = fields[name];
  if (!matchesPattern(ID_PATTERN, request.documentVersionId)) throw new Error('ACTIVITY_DOCUMENT_VERSION_INVALID');
  if (action !== 'ACTIVITY_BEGIN' && !matchesPattern(ID_PATTERN, request.runRef))
    throw new Error('ACTIVITY_RUN_REF_INVALID');
  if ('leaseOwner' in request && !matchesPattern(LEASE_OWNER_PATTERN, request.leaseOwner))
    throw new Error('ACTIVITY_LEASE_OWNER_INVALID');
  if ('leaseToken' in request && !matchesPattern(UUID_PATTERN, request.leaseToken))
    throw new Error('ACTIVITY_LEASE_TOKEN_INVALID');
  if ('leaseGeneration' in request &&
      (!Number.isSafeInteger(request.leaseGeneration) || request.leaseGeneration < 1))
    throw new Error('ACTIVITY_LEASE_GENERATION_INVALID');
  if ('sectionId' in request && !(typeof request.sectionId === 'string' &&
      request.sectionId.length >= 1 && request.sectionId.length <= 160))
    throw new Error('ACTIVITY_SECTION_INVALID');
  if ('offset' in request && (!Number.isSafeInteger(request.offset) || request.offset < 0))
    throw new Error('ACTIVITY_READ_OFFSET_INVALID');
  if ('limit' in request && (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 50))
    throw new Error('ACTIVITY_READ_LIMIT_INVALID');
  if ('errorCode' in request && !matchesPattern(ERROR_CODE_PATTERN, request.errorCode))
    throw new Error('ACTIVITY_ERROR_CODE_INVALID');
  if ('producer' in request) {
    const { skillVersion, modelVersion } = request.producer ?? {};
    if (!nonemptyString(skillVersion) || skillVersion.length > 160 ||
        !nonemptyString(modelVersion) || modelVersion.length > 160)
      throw new Error('ACTIVITY_PRODUCER_INVALID');
  }
  return request;
}

function consumerErrorCode(error) {
  return typeof error?.message === 'string' && /^ACTIVITY_[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'ACTIVITY_CONSUMER_FAILED';
}

/** Structural fence check (UUID token, positive generation, exact owner). */
function assertFence(fence, leaseOwner, code = 'ACTIVITY_CLAIM_FENCE_UNAVAILABLE') {
  if (fence == null || typeof fence !== 'object' ||
      !matchesPattern(UUID_PATTERN, fence.leaseToken) ||
      !Number.isSafeInteger(fence.leaseGeneration) || fence.leaseGeneration < 1 ||
      fence.leaseOwner !== leaseOwner)
    throw new Error(code);
  return fence;
}

/** Independent lease heartbeat from CLAIM through READ, model and SAVE. The
 * Host lease is 2 minutes (renewed well inside it) and the original run
 * deadline is a fixed 1 hour the consumer never extends: renewal stops at the
 * deadline. A failed renewal, a rejected fence or a passed deadline aborts
 * the model HTTP through a real AbortController, forbids SAVE, and is
 * reported as the specific failure instead of being masked. */
function withActivitySignal(operation, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); })
      .then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function startActivityLease({ call, fence, documentVersionId, runRef, deadline, claimedAt, intervalMs }) {
  const controller = new AbortController();
  const deadlineAt = Date.parse(deadline ?? '');
  let leaseExpiresAt = claimedAt + HOST_ACTIVITY_LEASE_MS;
  let lostError = null;
  let busy = false;
  let stopped = false;
  let watchdog;
  let busyDone = Promise.resolve();
  const interval = Math.min(
    Number.isSafeInteger(intervalMs) && intervalMs > 0 ? intervalMs : HOST_ACTIVITY_LEASE_MS / 2,
    HOST_ACTIVITY_LEASE_MS / 2);
  const lose = (error) => {
    if (lostError || stopped) return;
    lostError = error;
    controller.abort(error);
  };
  const check = () => {
    if (!Number.isFinite(deadlineAt) || Date.now() >= deadlineAt)
      lose(new Error('ACTIVITY_DEADLINE_EXCEEDED'));
    else if (Date.now() >= leaseExpiresAt)
      lose(new Error('ACTIVITY_LEASE_LOST'));
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
      controller.signal, AbortSignal.timeout(Math.max(1, Math.min(HOST_ACTIVITY_LEASE_MS / 2, deadlineAt - sentAt, leaseExpiresAt - sentAt))),
    ]);
    busyDone = withActivitySignal(() => call('ACTIVITY_HEARTBEAT',
      { ...fence, documentVersionId, runRef }, { signal: requestSignal, timeout: HOST_ACTIVITY_LEASE_MS }), requestSignal)
      .then((renewed) => {
        if (renewed?.runRef !== runRef || renewed?.renewed !== true)
          throw new Error('ACTIVITY_HEARTBEAT_REJECTED');
        // Conservatively date renewal from send, never from a delayed reply.
        leaseExpiresAt = sentAt + HOST_ACTIVITY_LEASE_MS;
        arm();
      })
      .catch((error) => { check(); lose(new Error('ACTIVITY_LEASE_LOST', { cause: error })); })
      .finally(() => { busy = false; });
  }, interval);
  return {
    signal: controller.signal,
    get lost() { check(); return lostError; },
    throwIfLost() { check(); if (lostError) throw lostError; },
    guard(operation) { check(); return withActivitySignal(operation, controller.signal); },
    async stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(watchdog);
      controller.abort(new Error('ACTIVITY_CONSUMER_STOPPED'));
      await busyDone;
    },
  };
}

/** A persisted checkpoint record must bind to exactly this document version
 * and run; anything else is a binding mismatch, never silently reused. */
function assertCheckpointBinding(record, documentVersionId, runRef) {
  if (record == null) return;
  if (record.schemaVersion !== ACTIVITY_CHECKPOINT_SCHEMA ||
      record.documentVersionId !== documentVersionId || record.runRef !== runRef)
    throw new Error('ACTIVITY_CHECKPOINT_BINDING_MISMATCH');
}

/** The fence of a recorded SAVE command is bound to that attempt's lease; a
 * later recovery compares everything the candidate actually depends on. */
function fenceFreeSave(command) {
  const { action, documentVersionId, runRef, candidate, producer } = command ?? {};
  return { action, documentVersionId, runRef, candidate, producer };
}

/** Validate the model's candidate proposal against the Host's
 * document-activity-candidate.ts proposalSchema plus the quote/time/status
 * cross-checks that Host validateDocumentActivityCandidate performs, using
 * only anchors the Host actually delivered. */
export function validateActivityProposal(proposal, deliveredAnchors) {
  if (proposal == null || typeof proposal !== 'object' || Array.isArray(proposal) ||
      !exactKeys(proposal, PROPOSAL_KEYS) || proposal.schemaVersion !== DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA ||
      !Array.isArray(proposal.statements))
    throw new Error('ACTIVITY_PROPOSAL_SHAPE_INVALID');
  const anchors = new Map();
  for (const anchor of deliveredAnchors) {
    if (anchor == null || typeof anchor !== 'object' || !nonemptyString(anchor.anchorId))
      throw new Error('ACTIVITY_DELIVERED_ANCHOR_INVALID');
    if (anchors.has(anchor.anchorId)) throw new Error('ACTIVITY_ANCHOR_DUPLICATE');
    anchors.set(anchor.anchorId, anchor);
  }
  const keys = new Set();
  for (const statement of proposal.statements) {
    if (statement == null || typeof statement !== 'object' || !exactKeys(statement, STATEMENT_KEYS))
      throw new Error('ACTIVITY_PROPOSAL_SHAPE_INVALID');
    if (!nonemptyString(statement.label) || typeof statement.statementKey !== 'string' ||
        !STATEMENT_KEY_PATTERN.test(statement.statementKey))
      throw new Error('ACTIVITY_PROPOSAL_SHAPE_INVALID');
    if (keys.has(statement.statementKey)) throw new Error('ACTIVITY_STATEMENT_KEY_DUPLICATE');
    keys.add(statement.statementKey);
    if (!Array.isArray(statement.quotes) || statement.quotes.length < 1)
      throw new Error('ACTIVITY_PROPOSAL_SHAPE_INVALID');
    for (const quote of statement.quotes) {
      if (quote == null || typeof quote !== 'object' || !exactKeys(quote, QUOTE_KEYS) ||
          !nonemptyString(quote.anchorId) || !Number.isSafeInteger(quote.start) || quote.start < 0 ||
          !Number.isSafeInteger(quote.end) || !nonemptyString(quote.text))
        throw new Error('ACTIVITY_PROPOSAL_SHAPE_INVALID');
      const anchor = anchors.get(quote.anchorId);
      if (!anchor) throw new Error('ACTIVITY_QUOTE_NOT_DELIVERED');
      if (quote.end <= quote.start || quote.end > anchor.sourceText.length ||
          anchor.sourceText.slice(quote.start, quote.end) !== quote.text)
        throw new Error('ACTIVITY_QUOTE_MISMATCH');
    }
    const time = statement.time;
    if (time !== null) {
      if (time == null || typeof time !== 'object' || !exactKeys(time, TIME_KEYS) ||
          !TIME_ROLES.includes(time.role) || !TIME_PRECISIONS.includes(time.precision) ||
          !TIME_EXPRESSIONS.includes(time.expression) || !nonemptyString(time.raw) ||
          !Number.isSafeInteger(time.quoteIndex) || time.quoteIndex < 0)
        throw new Error('ACTIVITY_PROPOSAL_SHAPE_INVALID');
      if (!statement.quotes[time.quoteIndex]?.text.includes(time.raw))
        throw new Error('ACTIVITY_TIME_NOT_QUOTED');
      if (time.expression !== 'CALENDAR' && time.precision !== 'UNKNOWN')
        throw new Error('ACTIVITY_TIME_PRECISION_INVALID');
    }
    if (statement.statusRaw !== null && !nonemptyString(statement.statusRaw))
      throw new Error('ACTIVITY_PROPOSAL_SHAPE_INVALID');
    if (statement.statusRaw !== null &&
        !statement.quotes.some(quote => quote.text.includes(statement.statusRaw)))
      throw new Error('ACTIVITY_STATUS_NOT_QUOTED');
    if (!Array.isArray(statement.limitations) || statement.limitations.some(item => !nonemptyString(item)))
      throw new Error('ACTIVITY_PROPOSAL_SHAPE_INVALID');
  }
  return proposal;
}

/** Validate the READ receipt shape from DocumentActivityRuntimeService:
 * runRef, sourceBinding{original, semanticRevision}, selection, units,
 * anchors, range{sectionId, offset, unitIds, anchorIds, nextOffset} and
 * sourceCoverage. There is no top-level `original`. */
function validateReadReceipt(read, documentVersionId, runRef, sectionId, offset, claim) {
  if (read == null || typeof read !== 'object' || read.runRef !== runRef ||
      read.sourceBinding == null || typeof read.sourceBinding !== 'object' ||
      read.sourceBinding.original == null || typeof read.sourceBinding.original !== 'object' ||
      !Number.isSafeInteger(read.sourceBinding.semanticRevision) || read.sourceBinding.semanticRevision < 1 ||
      read.selection == null || typeof read.selection !== 'object' ||
      !Array.isArray(read.units) || !Array.isArray(read.anchors) ||
      read.sourceCoverage == null || typeof read.sourceCoverage !== 'object' ||
      read.range == null || typeof read.range !== 'object')
    throw new Error('ACTIVITY_READ_RECEIPT_INVALID');
  if ('original' in read) throw new Error('ACTIVITY_READ_TOP_LEVEL_ORIGINAL_FORBIDDEN');
  const { range } = read;
  if (range.sectionId !== sectionId || range.offset !== offset ||
      !Array.isArray(range.unitIds) || !Array.isArray(range.anchorIds) ||
      (range.nextOffset !== null && (!Number.isSafeInteger(range.nextOffset) || range.nextOffset <= offset)))
    throw new Error('ACTIVITY_READ_RANGE_INVALID');
  const original = read.sourceBinding.original;
  if (original.documentVersionId !== documentVersionId || original.parseRunId !== claim.parseRunId ||
      read.sourceBinding.semanticRevision !== claim.semanticRevision ||
      !Number.isSafeInteger(original.parseRevision) || original.parseRevision < 1 ||
      !nonemptyString(original.sourceArtifactId) || !nonemptyString(original.sourceSha256) ||
      !Number.isSafeInteger(original.sourceByteLength) || original.sourceByteLength < 0)
    throw new Error('ACTIVITY_READ_BINDING_MISMATCH');
  if (read.selection.sectionId !== sectionId || !claim.selection.sectionIds.includes(sectionId) ||
      !Array.isArray(read.selection.unitIds) || !Array.isArray(read.selection.contextUnitIds))
    throw new Error('ACTIVITY_READ_SELECTION_MISMATCH');
  const selected = new Set([...read.selection.unitIds, ...read.selection.contextUnitIds]);
  if (!isDeepStrictEqual(range.unitIds, read.units.map(unit => unit?.unitId)) ||
      new Set(range.unitIds).size !== range.unitIds.length ||
      range.unitIds.some(id => !nonemptyString(id) || !selected.has(id)) ||
      !isDeepStrictEqual(range.anchorIds, read.anchors.map(anchor => anchor?.anchorId)) ||
      new Set(range.anchorIds).size !== range.anchorIds.length ||
      read.anchors.some(anchor => !range.unitIds.includes(anchor?.sourceUnitId)))
    throw new Error('ACTIVITY_READ_RANGE_INVALID');
  return read;
}

/** Validate a summary() object from DocumentActivityRuntimeService:
 * identity (runRef/documentVersionId) plus the parseRunId, semanticRevision
 * and known expectedRevision the run was begun with. A partial or malformed
 * summary is rejected instead of being consumed. */
function validateRunSummary(summary, documentVersionId, runRef) {
  if (summary == null || typeof summary !== 'object' || summary.runRef !== runRef ||
      summary.documentVersionId !== documentVersionId ||
      !nonemptyString(summary.parseRunId) ||
      !Number.isSafeInteger(summary.semanticRevision) || summary.semanticRevision < 1 ||
      (summary.expectedRevision !== undefined && summary.expectedRevision !== null &&
        (!Number.isSafeInteger(summary.expectedRevision) || summary.expectedRevision < 0)) ||
      summary.selection == null || typeof summary.selection !== 'object' ||
      !Array.isArray(summary.selection.sectionIds) ||
      summary.selection.sectionIds.some(id => typeof id !== 'string' || !id))
    throw new Error('ACTIVITY_RUN_SUMMARY_INVALID');
  return summary;
}

/** Validate a saved DocumentActivityRevision readback, unified across the
 * initial ACTIVITY_STATUS early return, the ACTIVITY_CLAIM early return and
 * the post-SAVE recovery. A partial or malformed receipt ({} or missing
 * fields) is always rejected, never accepted as success. When the receipt
 * comes from this run's own SAVE (sourceBinding/producer/statementCount
 * known) every field is compared deeply; for an early return from an
 * earlier consumption the run summary's parseRunId/semanticRevision are
 * cross-checked instead. The expected documentVersionId is always required:
 * sourceBinding.original must strictly match it and carry the public fields
 * of shared/document-original.interface.ts. */
function validateSavedReceipt(saved, {
  documentVersionId, runRef, parseRunId, semanticRevision, sourceBinding, producer, statementCount,
}) {
  if (saved == null || typeof saved !== 'object' || Array.isArray(saved) ||
      typeof saved.runRef !== 'string' || !saved.runRef)
    throw new Error('ACTIVITY_SAVE_RECEIPT_INVALID');
  if (saved.runRef !== runRef) throw new Error('ACTIVITY_SAVE_RECEIPT_RUN_REF_MISMATCH');
  if (!Number.isSafeInteger(saved.candidateRevision) || saved.candidateRevision < 1)
    throw new Error('ACTIVITY_SAVE_RECEIPT_REVISION_INVALID');
  if (saved.candidateOnly !== true) throw new Error('ACTIVITY_SAVE_RECEIPT_CANDIDATE_ONLY_INVALID');
  if (saved.schemaVersion !== DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA)
    throw new Error('ACTIVITY_SAVE_RECEIPT_SCHEMA_INVALID');
  if (typeof saved.savedAt !== 'string' || !Number.isFinite(Date.parse(saved.savedAt)))
    throw new Error('ACTIVITY_SAVE_RECEIPT_SAVED_AT_INVALID');
  const binding = saved.sourceBinding;
  if (binding == null || typeof binding !== 'object' ||
      binding.original == null || typeof binding.original !== 'object' ||
      !Number.isSafeInteger(binding.semanticRevision) || binding.semanticRevision < 1)
    throw new Error('ACTIVITY_SAVE_RECEIPT_SOURCE_BINDING_MISMATCH');
  if (documentVersionId !== undefined) {
    // Strictly the public fields of shared/document-original.interface.ts,
    // no more: identity must match the requested documentVersionId, and the
    // parse provenance plus source artifact descriptors must be present and
    // well-formed. A missing or wrong documentVersionId is rejected.
    const { original } = binding;
    if (original.documentVersionId !== documentVersionId ||
        !nonemptyString(original.parseRunId) ||
        !Number.isSafeInteger(original.parseRevision) || original.parseRevision < 1 ||
        !nonemptyString(original.sourceArtifactId) ||
        !nonemptyString(original.sourceSha256) ||
        !Number.isSafeInteger(original.sourceByteLength) || original.sourceByteLength < 0)
      throw new Error('ACTIVITY_SAVE_RECEIPT_SOURCE_BINDING_MISMATCH');
  }
  if (parseRunId !== undefined &&
      (typeof binding.original.parseRunId !== 'string' || binding.original.parseRunId !== parseRunId))
    throw new Error('ACTIVITY_SAVE_RECEIPT_SOURCE_BINDING_MISMATCH');
  if (semanticRevision !== undefined && binding.semanticRevision !== semanticRevision)
    throw new Error('ACTIVITY_SAVE_RECEIPT_SOURCE_BINDING_MISMATCH');
  if (sourceBinding !== undefined && !isDeepStrictEqual(binding, sourceBinding))
    throw new Error('ACTIVITY_SAVE_RECEIPT_SOURCE_BINDING_MISMATCH');
  const receiptProducer = saved.producer;
  if (receiptProducer == null || typeof receiptProducer !== 'object' ||
      !nonemptyString(receiptProducer.skillVersion) || receiptProducer.skillVersion.length > 160 ||
      !nonemptyString(receiptProducer.modelVersion) || receiptProducer.modelVersion.length > 160)
    throw new Error('ACTIVITY_SAVE_RECEIPT_PRODUCER_MISMATCH');
  if (producer !== undefined && !isDeepStrictEqual(receiptProducer, producer))
    throw new Error('ACTIVITY_SAVE_RECEIPT_PRODUCER_MISMATCH');
  if (!Array.isArray(saved.statements) ||
      saved.statements.some(statement => typeof statement?.statementId !== 'string' || !statement.statementId))
    throw new Error('ACTIVITY_SAVE_RECEIPT_STATEMENTS_INVALID');
  if (statementCount !== undefined && saved.statements.length !== statementCount)
    throw new Error('ACTIVITY_SAVE_RECEIPT_STATEMENTS_INVALID');
  return saved;
}

/** Consume one already-begun document-activity run.
 *
 * Order: document_work STATUS (nextActivityRunRef is the only discovery of
 * an existing run; an explicit options.runRef addresses that old run
 * directly and never drifts to a newer pending run) → ACTIVITY_STATUS with
 * the exact runRef (a persisted result returns the strictly validated saved
 * receipt with zero model work) → ACTIVITY_CLAIM
 * (real returned fence; a null fence cannot continue) → READ every delivered
 * sectionId page by page until range.nextOffset is null → one model
 * invocation returning a proposal only → ACTIVITY_SAVE with exactly the
 * proposal as candidate. A SAVE with an unknown outcome is checked only via
 * ACTIVITY_STATUS; unconfirmed stays pending and is never FAILed. */
export async function consumeHostedDocumentActivity(options, dependencies) {
  const documentVersionId = options.documentVersionId;
  if (!matchesPattern(ID_PATTERN, documentVersionId))
    throw new Error('ACTIVITY_DOCUMENT_VERSION_INVALID');
  const tool = options.activityTool ?? ACTIVITY_TOOL_NAME;
  const callTool = dependencies.callTool;
  if (typeof callTool !== 'function') throw new Error('ACTIVITY_CALL_TOOL_REQUIRED');
  let lease;
  const call = (action, fields, requestOptions) => {
    const options = requestOptions ?? (lease ? { signal: lease.signal, timeout: HOST_ACTIVITY_LEASE_MS } : undefined);
    const operation = () => callTool(tool, buildActivityRequest(action, fields), options);
    return options?.signal ? withActivitySignal(operation, options.signal) : operation();
  };

  const recoverStatus = (runRef) => call('ACTIVITY_STATUS', { documentVersionId, runRef },
    { signal: AbortSignal.timeout(60_000), timeout: 60_000 });

  // Discovery: document_work STATUS. Only its nextActivityRunRef stands for
  // a run that an explicit BEGIN already created. An explicit options.runRef
  // always addresses that old run directly: a nextActivityRunRef pointing
  // at a newer pending run never switches the target and is never a drift
  // error. ACTIVITY_STATUS never uses runRef:null.
  const state = await callTool(tool, { action: 'STATUS', documentVersionId });
  const pending = state?.nextActivityRunRef ?? null;
  if (pending !== null && !matchesPattern(ID_PATTERN, pending))
    throw new Error('ACTIVITY_STATUS_PENDING_INVALID');
  const runRef = options.runRef ?? pending;
  if (runRef == null) return { status: 'IDLE', documentVersionId, modelInvocations: 0 };
  if (!matchesPattern(ID_PATTERN, runRef)) throw new Error('ACTIVITY_RUN_REF_INVALID');

  const summary = validateRunSummary(
    await call('ACTIVITY_STATUS', { documentVersionId, runRef }), documentVersionId, runRef);
  if (summary.result != null) {
    return { status: 'ACTIVITY_WORK_SAVED', documentVersionId, runRef,
      saved: validateSavedReceipt(summary.result, {
        documentVersionId, runRef,
        parseRunId: summary.parseRunId, semanticRevision: summary.semanticRevision }),
      recoveredFromStatus: true, modelInvocations: 0, candidateOnly: true };
  }

  const leaseOwner = options.leaseOwner;
  if (!matchesPattern(LEASE_OWNER_PATTERN, leaseOwner))
    throw new Error('ACTIVITY_LEASE_OWNER_REQUIRED');
  const claimedAt = Date.now();
  const claim = await call('ACTIVITY_CLAIM', { documentVersionId, runRef, leaseOwner });
  validateRunSummary(claim, documentVersionId, runRef);
  if (claim.result != null) {
    return { status: 'ACTIVITY_WORK_SAVED', documentVersionId, runRef,
      saved: validateSavedReceipt(claim.result, {
        documentVersionId, runRef,
        parseRunId: claim.parseRunId, semanticRevision: claim.semanticRevision }),
      recoveredFromClaim: true, modelInvocations: 0, candidateOnly: true };
  }
  // Use exactly the fence the Host returned. A null fence must not continue:
  // no READ/SAVE/FAIL can be authorized without it.
  const fence = assertFence(claim.fence ?? null, leaseOwner);

  lease = startActivityLease({ call, fence, documentVersionId, runRef,
    claimedAt, deadline: claim.deadline, intervalMs: options.heartbeatIntervalMs });
  let saveDispatched = false;
  let priorSaveDispatched = false;
  let modelDispatched = false;
  let checkpointReadComplete = false;
  let definitiveModelError = false;
  try {
    lease.throwIfLost();
  const sectionIds = claim.selection.sectionIds;
  const limit = options.readLimit ?? 20;
  const maxPages = options.maxPagesPerSection ?? 10_000;

  // Durable per-run checkpoint. The factory owns the private directory
  // layout (0700/0600, keyed by endpoint origin+path without any token,
  // documentVersionId and runRef). Recovery reuses only strictly bound
  // persisted steps and never regenerates or re-dispatches an unknown one.
  const checkpoint = typeof dependencies.checkpointFactory === 'function'
    ? await lease.guard(() => dependencies.checkpointFactory({ documentVersionId, runRef }))
    : null;
  const writeCheckpoint = (name, record) => checkpoint
    ? lease.guard(() => checkpoint.write(name, record)) : Promise.resolve();
  if (checkpoint != null && typeof checkpoint.readOptional !== 'function')
    throw new Error('ACTIVITY_CHECKPOINT_STORE_INVALID');
  const persisted = checkpoint ? {
    source: await lease.guard(() => checkpoint.readOptional('source.result')),
    modelStarted: await lease.guard(() => checkpoint.readOptional('model.started')),
    modelResult: await lease.guard(() => checkpoint.readOptional('model.result')),
    saveStarted: await lease.guard(() => checkpoint.readOptional('save.started')),
  } : {};
  checkpointReadComplete = true;
  modelDispatched = persisted.modelStarted != null || persisted.modelResult != null;
  for (const record of Object.values(persisted))
    assertCheckpointBinding(record, documentVersionId, runRef);
  if (persisted.saveStarted != null && persisted.modelResult == null)
    throw new Error('ACTIVITY_CHECKPOINT_STATE_INVALID');
  if (persisted.modelResult != null && persisted.source == null)
    throw new Error('ACTIVITY_CHECKPOINT_STATE_INVALID');
  if (persisted.modelStarted != null && persisted.modelResult == null) {
    // The model dispatch already went out, so the model may hold work we
    // cannot see. Before keeping the outcome unknown, check the original
    // run's ACTIVITY_STATUS once: another attempt may have completed the
    // SAVE, and only that exact result is returned as-is. No second model
    // call, no FAIL, no fake success; anything else stays unknown and the
    // run stays pending-confirmation for its owner.
    let recoveredSaved;
    try {
      const recovered = validateRunSummary(
        await recoverStatus(runRef), documentVersionId, runRef);
      const result = recovered.result ?? null;
      if (result != null)
        recoveredSaved = { ...validateSavedReceipt(result, {
          documentVersionId, runRef, parseRunId: claim.parseRunId,
          semanticRevision: claim.semanticRevision, sourceBinding: persisted.source?.sourceBinding,
        }), replayed: true };
    } catch { /* The recovery itself failed: the outcome stays unknown. */ }
    if (recoveredSaved !== undefined)
      return { status: 'ACTIVITY_WORK_SAVED', documentVersionId, runRef, saved: recoveredSaved,
        modelInvocations: 0, candidateOnly: true, recoveredFromUnknownModel: true };
    throw new Error('ACTIVITY_MODEL_OUTCOME_UNKNOWN');
  }
  priorSaveDispatched = persisted.saveStarted != null;

    if (!sectionIds.length) throw new Error('ACTIVITY_SELECTION_EMPTY');
    let sourceBinding;
    const deliveredAnchors = [];
    const anchorById = new Map();
    const deliveredRanges = [];
    const units = [];
    let sourceCoverage;
    if (persisted.source != null) {
      // Strict recovery of a prior delivery: it must bind to this exact run
      // through the fresh claim's parseRunId/semanticRevision/selection, and
      // carry a structurally valid fence. The persisted fence authorized
      // that delivery only; every new request below uses the current fence.
      if (persisted.source.parseRunId !== claim.parseRunId ||
          persisted.source.semanticRevision !== claim.semanticRevision ||
          !isDeepStrictEqual(persisted.source.selection, claim.selection) ||
          persisted.source.sourceBinding?.original?.parseRunId !== claim.parseRunId ||
          persisted.source.sourceBinding?.semanticRevision !== claim.semanticRevision)
        throw new Error('ACTIVITY_CHECKPOINT_BINDING_MISMATCH');
      assertFence(persisted.source.fence, leaseOwner, 'ACTIVITY_CHECKPOINT_FENCE_INVALID');
      if (!Array.isArray(persisted.source.units) ||
          !Array.isArray(persisted.source.anchors) ||
          !Array.isArray(persisted.source.deliveredRanges) ||
          !persisted.source.deliveredRanges.length ||
          persisted.source.sourceCoverage == null || typeof persisted.source.sourceCoverage !== 'object')
        throw new Error('ACTIVITY_CHECKPOINT_STATE_INVALID');
      const original = persisted.source.sourceBinding.original;
      if (original.documentVersionId !== documentVersionId ||
          !Number.isSafeInteger(original.parseRevision) || original.parseRevision < 1 ||
          !nonemptyString(original.sourceArtifactId) || !nonemptyString(original.sourceSha256) ||
          !Number.isSafeInteger(original.sourceByteLength) || original.sourceByteLength < 0)
        throw new Error('ACTIVITY_CHECKPOINT_BINDING_MISMATCH');
      for (const range of persisted.source.deliveredRanges) {
        if (!claim.selection.sectionIds.includes(range.sectionId) ||
            !Array.isArray(range.unitIds) || !Array.isArray(range.anchorIds) ||
            !Number.isSafeInteger(range.offset) || range.offset < 0 ||
            (range.nextOffset !== null && (!Number.isSafeInteger(range.nextOffset) || range.nextOffset <= range.offset)) ||
            range.unitIds.some(id => !persisted.source.units.some(unit => unit?.unitId === id)) ||
            range.anchorIds.some(id => !persisted.source.anchors.some(anchor =>
              anchor?.anchorId === id && range.unitIds.includes(anchor.sourceUnitId))))
          throw new Error('ACTIVITY_CHECKPOINT_STATE_INVALID');
      }
      if (persisted.source.anchors.some(anchor => !persisted.source.deliveredRanges.some(range => range.anchorIds.includes(anchor?.anchorId))) ||
          persisted.source.units.some(unit => !persisted.source.deliveredRanges.some(range => range.unitIds.includes(unit?.unitId))))
        throw new Error('ACTIVITY_CHECKPOINT_STATE_INVALID');
      sourceBinding = persisted.source.sourceBinding;
      units.push(...persisted.source.units);
      deliveredRanges.push(...persisted.source.deliveredRanges);
      sourceCoverage = persisted.source.sourceCoverage;
      for (const anchor of persisted.source.anchors) {
        if (anchor == null || typeof anchor !== 'object' || !nonemptyString(anchor.anchorId))
          throw new Error('ACTIVITY_DELIVERED_ANCHOR_INVALID');
        if (anchorById.has(anchor.anchorId)) throw new Error('ACTIVITY_ANCHOR_DUPLICATE');
        anchorById.set(anchor.anchorId, anchor);
        deliveredAnchors.push(anchor);
      }
    } else for (const sectionId of sectionIds) {
      let offset = 0; let pages = 0;
      for (;;) {
        lease.throwIfLost();
        const read = validateReadReceipt(
          await call('ACTIVITY_READ', { ...fence, documentVersionId, runRef, sectionId, offset, limit }),
          documentVersionId, runRef, sectionId, offset, claim);
        if (sourceBinding === undefined) sourceBinding = read.sourceBinding;
        else if (!isDeepStrictEqual(read.sourceBinding, sourceBinding))
          throw new Error('ACTIVITY_READ_BINDING_MISMATCH');
        if (sourceCoverage === undefined) sourceCoverage = read.sourceCoverage;
        else if (!isDeepStrictEqual(read.sourceCoverage, sourceCoverage))
          throw new Error('ACTIVITY_READ_COVERAGE_MISMATCH');
        units.push(...read.units);
        deliveredRanges.push(read.range);
        for (const anchor of read.anchors) {
          if (anchor == null || typeof anchor !== 'object' || !nonemptyString(anchor.anchorId))
            throw new Error('ACTIVITY_DELIVERED_ANCHOR_INVALID');
          if (anchorById.has(anchor.anchorId)) {
            if (!isDeepStrictEqual(anchorById.get(anchor.anchorId), anchor))
              throw new Error('ACTIVITY_ANCHOR_DUPLICATE');
          } else {
            anchorById.set(anchor.anchorId, anchor);
            deliveredAnchors.push(anchor);
          }
        }
        const { nextOffset } = read.range;
        if (nextOffset == null) break;
        offset = nextOffset;
        if (++pages >= maxPages) throw new Error('ACTIVITY_READ_PAGES_EXCEEDED');
      }
    }
    if (!deliveredRanges.length) throw new Error('ACTIVITY_DELIVERY_EMPTY');
    // Durable source: the delivery, selection and fence are persisted before
    // any model work so a later attempt never re-reads a changed delivery.
    await writeCheckpoint('source.result', {
      schemaVersion: ACTIVITY_CHECKPOINT_SCHEMA, documentVersionId, runRef,
      parseRunId: claim.parseRunId, semanticRevision: claim.semanticRevision,
      sourceBinding, selection: claim.selection, units, anchors: deliveredAnchors,
      deliveredRanges, sourceCoverage, fence,
    });

    // Mirror Host anchor-source checks with the delivered fields we hold:
    // every anchor keeps non-empty sourceRefIds covered by its locators.
    for (const anchor of deliveredAnchors) {
      if (!Array.isArray(anchor.sourceRefIds) || !anchor.sourceRefIds.length ||
          !Array.isArray(anchor.sourceLocators) ||
          anchor.sourceRefIds.some(ref => !anchor.sourceLocators.some(
            locator => locator?.sourceRefId === ref)))
        throw new Error('ACTIVITY_ANCHOR_SOURCE_INVALID');
    }

    // Exactly one model invocation per run. The model returns a proposal
    // only; Host binding, anchors, coverage, statementId, candidateRevision
    // and producer are never backfilled by it. A persisted model result is
    // reused as-is with its recorded actual modelVersion (zero regeneration);
    // a dispatched model with no persisted result keeps an unknown outcome.
    const modelInput = {
      documentVersionId, runRef, sectionIds,
      sourceBinding, selection: claim.selection, units, anchors: deliveredAnchors,
      deliveredRanges, sourceCoverage,
    };
    const inputHash = canonicalSha256(modelInput);
    let proposal;
    let modelVersion;
    let modelInvocations = 0;
    if (persisted.modelResult != null) {
      if (persisted.modelResult.inputHash !== inputHash)
        throw new Error('ACTIVITY_CHECKPOINT_BINDING_MISMATCH');
      proposal = persisted.modelResult.proposal;
      modelVersion = persisted.modelResult.modelVersion;
    } else {
      if (typeof dependencies.invokeModel !== 'function')
        throw new Error('ACTIVITY_MODEL_EXECUTOR_REQUIRED');
      lease.throwIfLost();
      // Model dispatch BEFORE HTTP: once this marker exists, only a result
      // checkpoint may clear the unknown outcome.
      await writeCheckpoint('model.started', {
        schemaVersion: ACTIVITY_CHECKPOINT_SCHEMA, step: 'model',
        documentVersionId, runRef, inputHash, startedAt: new Date().toISOString() });
      lease.throwIfLost();
      let modelResult;
      try {
        modelDispatched = true;
        modelResult = await lease.guard(() => dependencies.invokeModel(modelInput, { signal: lease.signal }));
      } catch (error) {
        // The dispatch may have reached the model: the outcome is unknown.
        // No second model call, no FAIL, no fake success. A lease loss is
        // reported as its own specific failure.
        throw lease.lost ?? new Error('ACTIVITY_MODEL_OUTCOME_UNKNOWN', { cause: error });
      }
      proposal = modelResult?.proposal;
      modelVersion = modelResult?.modelVersion;
      modelInvocations = 1;
    }
    try {
    if (typeof modelVersion !== 'string' || !modelVersion.trim() ||
        modelVersion.length > 160) throw new Error('ACTIVITY_MODEL_VERSION_INVALID');
    validateActivityProposal(proposal, deliveredAnchors);
    } catch (error) { definitiveModelError = true; throw error; }
    // Model result with the actual modelVersion BEFORE SAVE:
    try {
    await writeCheckpoint('model.result', {
      schemaVersion: ACTIVITY_CHECKPOINT_SCHEMA, step: 'model',
      documentVersionId, runRef, inputHash, modelVersion, proposal,
      finishedAt: new Date().toISOString() });
    } catch (error) { throw new Error('ACTIVITY_MODEL_OUTCOME_UNKNOWN', { cause: error }); }

    // The SAVE candidate is exactly the proposal. Host strictObject rejects
    // any extra field, so nothing else is ever attached here.
    const candidate = { schemaVersion: proposal.schemaVersion, statements: proposal.statements };
    const producer = { skillVersion: options.skillVersion ?? WISELINK_SKILL_VERSION, modelVersion };
    const saveFields = { ...fence, documentVersionId, runRef, candidate, producer };

    let saved;
    lease.throwIfLost();
    if (priorSaveDispatched) {
      // A prior attempt already recorded this exact SAVE command before its
      // dispatch. Never re-dispatch: only the original run's ACTIVITY_STATUS
      // result may confirm the outcome; unconfirmed stays unknown.
      if (!isDeepStrictEqual(
            fenceFreeSave(persisted.saveStarted.saveCommand),
            fenceFreeSave(buildActivityRequest('ACTIVITY_SAVE', saveFields))))
        throw new Error('ACTIVITY_CHECKPOINT_BINDING_MISMATCH');
      try {
        const recovered = validateRunSummary(
          await recoverStatus(runRef), documentVersionId, runRef);
        const result = recovered.result ?? null;
        if (result != null && (typeof result.runRef !== 'string' || result.runRef === runRef))
          saved = { ...result, replayed: true };
      } catch { /* The recovery itself failed: the SAVE outcome stays unknown. */ }
      if (saved === undefined)
        throw new Error('ACTIVITY_SAVE_UNCONFIRMED');
    } else {
      // The complete SAVE command BEFORE dispatch:
      await writeCheckpoint('save.started', {
        schemaVersion: ACTIVITY_CHECKPOINT_SCHEMA, step: 'save',
        documentVersionId, runRef, inputHash,
        saveCommand: buildActivityRequest('ACTIVITY_SAVE', saveFields),
        startedAt: new Date().toISOString() });
      saveDispatched = true;
      try {
        // Dispatch is already durable. A later heartbeat loss cannot erase a
        // successful receipt; bound this in-flight response independently.
        saved = await call('ACTIVITY_SAVE', saveFields,
          { signal: AbortSignal.timeout(HOST_ACTIVITY_LEASE_MS), timeout: HOST_ACTIVITY_LEASE_MS });
      } catch (error) {
        // The SAVE dispatch already went out, so the Host may have persisted
        // it. Only the original ACTIVITY_STATUS.result may confirm the
        // outcome. If that recovery STATUS itself fails, returns nothing or
        // returns a result for another run, the outcome stays unknown: no
        // FAIL, no retry, no fake success, no second model call.
        try {
          const recovered = validateRunSummary(
            await recoverStatus(runRef), documentVersionId, runRef);
          const result = recovered.result ?? null;
          if (result != null && (typeof result.runRef !== 'string' || result.runRef === runRef))
            saved = { ...result, replayed: true };
        } catch { /* The recovery itself failed: the SAVE outcome stays unknown. */ }
        if (saved === undefined)
          throw new Error('ACTIVITY_SAVE_UNCONFIRMED', { cause: error });
      }
    }
    validateSavedReceipt(saved, {
      documentVersionId, runRef, sourceBinding, producer, statementCount: proposal.statements.length });
    return { status: 'ACTIVITY_WORK_SAVED', documentVersionId, runRef,
      saved, producer, modelInvocations, candidateOnly: true };
  } catch (error) {
    // Local, deterministic failures are isolated to this run through a fenced
    // ACTIVITY_FAIL. Once the SAVE has been dispatched the outcome may be
    // persisted Host-side: every unconfirmed path — a failing or malformed
    // recovery STATUS, a malformed receipt — is never FAILed, never retried
    // and never reported as success. An unknown model outcome and a lost
    // lease never FAIL either: the run stays pending for its owner.
    if (checkpointReadComplete && (!modelDispatched || definitiveModelError) &&
        !saveDispatched && !priorSaveDispatched && lease.lost == null &&
        error?.message !== 'ACTIVITY_MODEL_OUTCOME_UNKNOWN') {
      try { await call('ACTIVITY_FAIL', { ...fence, documentVersionId, runRef, errorCode: consumerErrorCode(error) }); }
      catch { /* Never mask the original error; failure stays isolated to this run. */ }
    }
    throw error;
  } finally {
    // Clear the heartbeat timer and wait for any in-flight heartbeat before
    // the attempt ends: nothing of this attempt outlives the call.
    await lease.stop();
  }
}

/** Explicit owner-path cancellation through the same document_work tool.
 * Not called by the consumer itself. */
export async function cancelHostedDocumentActivity(options, dependencies) {
  const { documentVersionId, runRef } = options ?? {};
  const tool = options.activityTool ?? ACTIVITY_TOOL_NAME;
  const request = buildActivityRequest('ACTIVITY_CANCEL', { documentVersionId, runRef });
  const cancelled = await dependencies.callTool(tool, request);
  if (cancelled?.runRef !== undefined && cancelled.runRef !== runRef)
    throw new Error('ACTIVITY_CANCEL_RECEIPT_MISMATCH');
  return cancelled;
}
