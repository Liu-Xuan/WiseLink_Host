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
// (explicit v1/v2 schema); Host binding, anchors, coverage,
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
import { DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA, resolveSourceQuoteSelection } from './resolve-document-activity-quote-selection.mjs';
export { DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA } from './resolve-document-activity-quote-selection.mjs';
import { WISELINK_SKILL_VERSION, canonicalSha256 } from './validate-payload.mjs';
import { DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2, DOCUMENT_ACTIVITY_QUOTE_OFFSETS_SCHEMA,
  DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA, activityV2ProductionContract } from './document-activity-model-contract.mjs';
import { activitySourceContextInventory, mergeActivitySourceContexts, validateActivitySourceContext } from './merge-document-activity-source-context.mjs';
import { activityFailureDiagnostic } from './document-activity-failure-diagnostic.mjs';
export { DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2, DOCUMENT_ACTIVITY_QUOTE_OFFSETS_SCHEMA,
  DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA } from './document-activity-model-contract.mjs';

/** The only Host tool, per DocumentWorkRuntimeService/DocumentActivityRuntimeService. */
export const ACTIVITY_TOOL_NAME = 'document_work';

/** From shared/document-activity.interface.ts. */
export const DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA = 'wiselink.document.activity-candidate.v1';

/** Local checkpoint envelope schema for batch-B durable steps. */
export const ACTIVITY_CHECKPOINT_SCHEMA = 'wiselink.document.activity-checkpoint.v1';
export const ACTIVITY_CHECKPOINT_QUOTE_SELECTION_SCHEMA = 'wiselink.document.activity-quote-selection-checkpoint.v1';
export const ACTIVITY_CHECKPOINT_V2_SCHEMA = 'wiselink.document.activity-checkpoint.v2';

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
  'ACTIVITY_SAVE', 'ACTIVITY_SAVE_SELECTION', 'ACTIVITY_FAIL', 'ACTIVITY_HEARTBEAT',
]);

/** Exact request fields per Host documentActivityActionSchemas (zod
 * strictObject). Field-level validation mirrors the zod constraints. */
export const REQUEST_FIELD_SCHEMAS = Object.freeze({
  ACTIVITY_BEGIN: ['documentVersionId', 'parseRunId', 'semanticRevision', 'requestId', 'expectedRevision', 'sectionIds', 'candidateSchemaVersion', 'productionContract'],
  ACTIVITY_STATUS: ['documentVersionId', 'runRef'],
  ACTIVITY_CANCEL: ['documentVersionId', 'runRef'],
  ACTIVITY_CLAIM: ['documentVersionId', 'runRef', 'leaseOwner'],
  ACTIVITY_HEARTBEAT: ['documentVersionId', 'runRef', 'leaseOwner', 'leaseToken', 'leaseGeneration'],
  ACTIVITY_READ: ['documentVersionId', 'runRef', 'leaseOwner', 'leaseToken', 'leaseGeneration', 'sectionId', 'offset', 'limit'],
  ACTIVITY_SAVE: ['documentVersionId', 'runRef', 'leaseOwner', 'leaseToken', 'leaseGeneration', 'candidate', 'producer'],
  ACTIVITY_SAVE_SELECTION: ['documentVersionId', 'runRef', 'leaseOwner', 'leaseToken', 'leaseGeneration', 'candidate', 'producer'],
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
  if (typeof error?.message === 'string' && error.message.length <= 160 &&
      /^ACTIVITY_QUOTE_SELECTION_(?:SELECTION_INVALID|HOST_CONTEXT_INVALID|SOURCE_BINDING_MISMATCH|UNKNOWN_ANCHOR|ANCHOR_NOT_ALLOWED|EMPTY_TEXT|TEXT_NOT_FOUND|TEXT_AMBIGUOUS):STATEMENT_[0-9]+:QUOTE_[0-9]+$/.test(error.message)) return error.message;
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
      controller.signal, AbortSignal.timeout(Math.max(1, Math.min(HOST_ACTIVITY_LEASE_MS / 2, leaseExpiresAt - sentAt))),
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
function assertCheckpointBinding(record, documentVersionId, runRef, checkpointSchema = ACTIVITY_CHECKPOINT_SCHEMA, pins = {}) {
  if (record == null) return;
  if (record.schemaVersion !== checkpointSchema ||
      record.documentVersionId !== documentVersionId || record.runRef !== runRef ||
      Object.entries(pins).some(([key, value]) => !isDeepStrictEqual(record[key], value)))
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
/** Transport-specific validation; local exact ranges are not submitted as a replacement proposal. */
export function validateActivityQuoteSelection(proposal, deliveredAnchors, context) {
  canonicalActivityQuoteSelection(proposal, deliveredAnchors, context);
  return proposal;
}

function canonicalActivityQuoteSelection(proposal, deliveredAnchors, context) {
  if (proposal == null || typeof proposal !== 'object' || Array.isArray(proposal) ||
      !exactKeys(proposal, [...PROPOSAL_KEYS, 'quoteSelectionSchemaVersion']) ||
      proposal.quoteSelectionSchemaVersion !== DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA ||
      ![DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2].includes(proposal.schemaVersion) || !Array.isArray(proposal.statements))
    throw new Error('ACTIVITY_QUOTE_SELECTION_SHAPE_INVALID');
  const host = { sourceBinding: context?.sourceBinding, expectedSourceBinding: context?.expectedSourceBinding,
    anchors: deliveredAnchors, allowedAnchorIds: [...new Set(context?.deliveredRanges?.flatMap(range => range.anchorIds) ?? [])] };
  const statements = proposal.statements.map((statement, statementIndex) => {
    if (statement == null || typeof statement !== 'object' || Array.isArray(statement) || !Array.isArray(statement.quotes))
      throw new Error('ACTIVITY_QUOTE_SELECTION_SHAPE_INVALID');
    return { ...statement, quotes: statement.quotes.map((selection, quoteIndex) => {
      const result = resolveSourceQuoteSelection(selection, host);
      if (result.status === 'UNRESOLVED') {
        const error = new Error(`ACTIVITY_QUOTE_SELECTION_${result.reason}:STATEMENT_${statementIndex}:QUOTE_${quoteIndex}`);
        Object.assign(error, { statementIndex, quoteIndex, unresolvedReason: result.reason });
        throw error;
      }
      return result.quote;
    }) };
  });
  return validateActivityProposal({ schemaVersion: proposal.schemaVersion, statements }, deliveredAnchors, context);
}

export function validateActivityProposal(proposal, deliveredAnchors, context = {}) {
  if (proposal?.schemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2)
    return validateActivityProposalV2(proposal, deliveredAnchors, context);
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

const V2_STATEMENT_KEYS = ['statementKey', 'label', 'quotes', 'subject', 'action', 'modality', 'status', 'times', 'technicalIds', 'scope', 'limitations'];
const MODALITY_MEANINGS = ['REQUIRED', 'RECOMMENDED', 'PLANNED', 'POSSIBLE', 'REPORTED', 'UNKNOWN'];
const STATUS_MEANINGS = ['PLANNED', 'IN_PROGRESS', 'SOURCE_REPORTED_COMPLETED', 'ON_HOLD', 'CANCELLED', 'UNKNOWN'];
const TECHNICAL_ID_KINDS = ['AIRCRAFT_LINE_NUMBER', 'PART_NUMBER', 'SERIAL_NUMBER', 'PUBLICATION_ID', 'TECHNICAL_LABEL', 'UNKNOWN'];
const CONDITION_KINDS = ['CONDITION', 'EXCEPTION', 'PREREQUISITE', 'LIMITATION'];
const CONDITION_TARGETS = ['STATEMENT', 'SECTION', 'DOCUMENT', 'UNRESOLVED'];
const SCOPE_COMPLETENESS = ['DELIVERED_SCOPE_ONLY', 'PARTIAL', 'UNRESOLVED'];
const plainObject = value => value != null && typeof value === 'object' && !Array.isArray(value);
const stringArray = value => Array.isArray(value) && value.every(nonemptyString);
const uniqueArray = value => new Set(value).size === value.length;

function validateActivityProposalV2(proposal, deliveredAnchors, context) {
  const shapeInvalid = () => { throw new Error('ACTIVITY_PROPOSAL_SHAPE_INVALID'); };
  if (!plainObject(proposal) || !exactKeys(proposal, PROPOSAL_KEYS) || !Array.isArray(proposal.statements)) shapeInvalid();
  if (context.sourceContext == null || context.sourceContext.schemaVersion !== DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA)
    throw new Error('ACTIVITY_SOURCE_CONTEXT_REQUIRED');
  validateActivitySourceContext(context.sourceContext, { sourceBinding: context.sourceBinding,
    ...(context.units ? { units: context.units } : {}),
    ...(context.deliveredRanges ? { deliveredRanges: context.deliveredRanges } : {}),
    ...(context.sectionIds ? { selectedSectionIds: context.sectionIds } : {}) });
  const anchors = new Map();
  for (const anchor of deliveredAnchors) {
    if (!plainObject(anchor) || !nonemptyString(anchor.anchorId) || typeof anchor.sourceText !== 'string')
      throw new Error('ACTIVITY_DELIVERED_ANCHOR_INVALID');
    if (anchors.has(anchor.anchorId)) throw new Error('ACTIVITY_ANCHOR_DUPLICATE');
    anchors.set(anchor.anchorId, anchor);
  }
  const sections = new Map(context.sourceContext.sections.map(section => [section.sectionId, section]));
  const statementKeys = new Set();
  for (const statement of proposal.statements) {
    if (!plainObject(statement) || !exactKeys(statement, V2_STATEMENT_KEYS) ||
        !matchesPattern(STATEMENT_KEY_PATTERN, statement.statementKey) || !nonemptyString(statement.label) ||
        !Array.isArray(statement.quotes) || !statement.quotes.length || !stringArray(statement.limitations)) shapeInvalid();
    if (statementKeys.has(statement.statementKey)) throw new Error('ACTIVITY_STATEMENT_KEY_DUPLICATE');
    statementKeys.add(statement.statementKey);
    for (const quote of statement.quotes) {
      if (!plainObject(quote) || !exactKeys(quote, QUOTE_KEYS) || !nonemptyString(quote.anchorId) ||
          !Number.isSafeInteger(quote.start) || quote.start < 0 || !Number.isSafeInteger(quote.end) || quote.end < 1 ||
          !nonemptyString(quote.text)) shapeInvalid();
      const anchor = anchors.get(quote.anchorId);
      if (!anchor) throw new Error('ACTIVITY_QUOTE_NOT_DELIVERED');
      if (quote.end <= quote.start || quote.end > anchor.sourceText.length || anchor.sourceText.slice(quote.start, quote.end) !== quote.text)
        throw new Error('ACTIVITY_QUOTE_MISMATCH');
    }
    const checkCue = (cue, extraKeys, code, nullable = true) => {
      if (nullable && cue === null) return;
      if (!plainObject(cue) || !exactKeys(cue, ['raw', 'quoteIndex', ...extraKeys]) ||
          !nonemptyString(cue.raw) || !Number.isSafeInteger(cue.quoteIndex) || cue.quoteIndex < 0) shapeInvalid();
      if (!statement.quotes[cue.quoteIndex]?.text.includes(cue.raw)) throw new Error(`ACTIVITY_${code}_NOT_QUOTED`);
    };
    checkCue(statement.subject, [], 'SUBJECT'); checkCue(statement.action, [], 'ACTION');
    checkCue(statement.modality, ['meaning', 'negationQuoteIndexes'], 'MODALITY');
    if (statement.modality !== null) {
      if (!MODALITY_MEANINGS.includes(statement.modality.meaning) || !Array.isArray(statement.modality.negationQuoteIndexes) ||
          statement.modality.negationQuoteIndexes.some(index => !Number.isSafeInteger(index) || index < 0)) shapeInvalid();
      if (!uniqueArray(statement.modality.negationQuoteIndexes) ||
          statement.modality.negationQuoteIndexes.some(index => !statement.quotes[index])) throw new Error('ACTIVITY_NEGATION_INDEX_INVALID');
    }
    checkCue(statement.status, ['meaning'], 'STATUS');
    if (statement.status !== null && !STATUS_MEANINGS.includes(statement.status.meaning)) shapeInvalid();
    if (!Array.isArray(statement.times) || !Array.isArray(statement.technicalIds)) shapeInvalid();
    for (const time of statement.times) {
      checkCue(time, ['role', 'precision', 'expression'], 'TIME', false);
      if (!TIME_ROLES.includes(time.role) || !TIME_PRECISIONS.includes(time.precision) || !TIME_EXPRESSIONS.includes(time.expression)) shapeInvalid();
      if (time.expression !== 'CALENDAR' && time.precision !== 'UNKNOWN') throw new Error('ACTIVITY_TIME_PRECISION_INVALID');
    }
    for (const identifier of statement.technicalIds) {
      checkCue(identifier, ['kind'], 'TECHNICAL_ID', false);
      if (!TECHNICAL_ID_KINDS.includes(identifier.kind)) shapeInvalid();
    }
    const scope = statement.scope;
    if (!plainObject(scope) || !exactKeys(scope, ['sectionIds', 'conditions', 'completeness']) ||
        !stringArray(scope.sectionIds) || !Array.isArray(scope.conditions) || !SCOPE_COMPLETENESS.includes(scope.completeness)) shapeInvalid();
    if (!uniqueArray(scope.sectionIds) || scope.sectionIds.some(id => !sections.has(id))) throw new Error('ACTIVITY_SCOPE_NOT_DELIVERED');
    for (const condition of scope.conditions) {
      checkCue(condition, ['kind', 'appliesTo', 'sectionIds'], 'CONDITION', false);
      if (!CONDITION_KINDS.includes(condition.kind) || !CONDITION_TARGETS.includes(condition.appliesTo) || !stringArray(condition.sectionIds)) shapeInvalid();
      if (!uniqueArray(condition.sectionIds) || (condition.appliesTo === 'SECTION' ? !condition.sectionIds.length : condition.sectionIds.length > 0))
        throw new Error('ACTIVITY_CONDITION_SCOPE_INVALID');
      if (condition.appliesTo === 'SECTION') {
        const anchor = anchors.get(statement.quotes[condition.quoteIndex].anchorId);
        if (condition.sectionIds.some(target => !scope.sectionIds.includes(target) || !sections.has(target) ||
            !context.sourceContext.sections.some(section => section.deliveredUnitIds.includes(anchor.sourceUnitId) &&
              (section.sectionId === target || section.contextForSectionIds.includes(target)))))
          throw new Error('ACTIVITY_CONDITION_SCOPE_UNSUPPORTED');
      }
    }
  }
  return proposal;
}

/** v1 legacy rows have no recorded production provenance. New v2 runs must
 * match one exact locally supported prompt/tool/context/transport identity. */
function activityRunContract(summary) {
  const candidateSchemaVersion = summary.candidateSchemaVersion ?? DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA;
  const productionContract = summary.productionContract ?? null;
  if (candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA) {
    if (productionContract !== null) throw new Error('ACTIVITY_PRODUCTION_CONTRACT_INVALID');
  } else if (candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2) {
    if (!plainObject(productionContract) || !exactKeys(productionContract, ['promptVersion', 'toolSchemaSha256', 'sourceContextVersion', 'quoteTransportVersion']) ||
        !isDeepStrictEqual(productionContract, activityV2ProductionContract(productionContract.quoteTransportVersion)))
      throw new Error('ACTIVITY_PRODUCTION_CONTRACT_INVALID');
  } else throw new Error('ACTIVITY_RUN_SCHEMA_INVALID');
  return { candidateSchemaVersion, productionContract };
}

function assertRunContract(summary, expected) {
  const contract = activityRunContract(summary);
  if (!isDeepStrictEqual(contract, expected)) throw new Error('ACTIVITY_RUN_CONTRACT_MISMATCH');
  return contract;
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
  assertRunContract(read, activityRunContract(claim));
  if (claim.candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2)
    validateActivitySourceContext(read.sourceContext, { sourceBinding: read.sourceBinding, units: read.units,
      deliveredRanges: [range], selectedSectionIds: [sectionId] });
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
  const contract = activityRunContract(summary);
  if (contract.candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 &&
      (!summary.selection.sectionIds.length || !uniqueArray(summary.selection.sectionIds)))
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
  candidateSchemaVersion = DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, sourceContext, expectedStatements, expectedAnchors, expectedReadCoverage,
}) {
  if (saved == null || typeof saved !== 'object' || Array.isArray(saved) ||
      typeof saved.runRef !== 'string' || !saved.runRef)
    throw new Error('ACTIVITY_SAVE_RECEIPT_INVALID');
  if (saved.runRef !== runRef) throw new Error('ACTIVITY_SAVE_RECEIPT_RUN_REF_MISMATCH');
  if (!Number.isSafeInteger(saved.candidateRevision) || saved.candidateRevision < 1)
    throw new Error('ACTIVITY_SAVE_RECEIPT_REVISION_INVALID');
  if (saved.candidateOnly !== true) throw new Error('ACTIVITY_SAVE_RECEIPT_CANDIDATE_ONLY_INVALID');
  if (saved.schemaVersion !== candidateSchemaVersion)
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
  if (candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2) {
    if (!Array.isArray(saved.sourceAnchors) || saved.readCoverage?.status !== 'DELIVERED_RANGES_ONLY' ||
        !Array.isArray(saved.readCoverage?.deliveredRanges) || !saved.readCoverage.deliveredRanges.length ||
        !Array.isArray(saved.readCoverage?.selection?.sectionIds) || !saved.readCoverage.selection.sectionIds.length ||
        !uniqueArray(saved.readCoverage.selection.sectionIds) || saved.readCoverage.selection.sectionIds.some(id => !nonemptyString(id)) ||
        new Set(saved.statements.map(statement => statement.statementId)).size !== saved.statements.length ||
        (expectedAnchors !== undefined && !isDeepStrictEqual(saved.sourceAnchors, expectedAnchors)) ||
        (expectedReadCoverage !== undefined && !isDeepStrictEqual(saved.readCoverage, expectedReadCoverage)))
      throw new Error('ACTIVITY_SAVE_RECEIPT_STATEMENTS_INVALID');
    const anchorById = new Map(saved.sourceAnchors.map(anchor => [anchor?.anchorId, anchor]));
    const allowedAnchors = new Set();
    if (anchorById.size !== saved.sourceAnchors.length) throw new Error('ACTIVITY_SAVE_RECEIPT_STATEMENTS_INVALID');
    for (const range of saved.readCoverage.deliveredRanges) {
      if (!saved.readCoverage.selection.sectionIds.includes(range?.sectionId) || !Number.isSafeInteger(range.offset) || range.offset < 0 ||
          (range.nextOffset !== null && (!Number.isSafeInteger(range.nextOffset) || range.nextOffset <= range.offset)) ||
          !stringArray(range.unitIds) || !uniqueArray(range.unitIds) || !stringArray(range.anchorIds) || !uniqueArray(range.anchorIds) ||
          range.anchorIds.some(id => !anchorById.has(id) || !range.unitIds.includes(anchorById.get(id).sourceUnitId)))
        throw new Error('ACTIVITY_SAVE_RECEIPT_STATEMENTS_INVALID');
      for (const id of range.anchorIds) allowedAnchors.add(id);
    }
    if (saved.sourceAnchors.some(anchor => !nonemptyString(anchor?.anchorId) || !allowedAnchors.has(anchor.anchorId) ||
        !Array.isArray(anchor.sourceRefIds) || !anchor.sourceRefIds.length || !Array.isArray(anchor.sourceLocators) ||
        anchor.sourceRefIds.some(ref => !anchor.sourceLocators.some(locator => locator?.sourceRefId === ref))))
      throw new Error('ACTIVITY_SAVE_RECEIPT_STATEMENTS_INVALID');
    validateActivitySourceContext(saved.sourceContext, { sourceBinding: binding,
      deliveredRanges: saved.readCoverage.deliveredRanges, selectedSectionIds: saved.readCoverage.selection.sectionIds });
    if (sourceContext !== undefined && !isDeepStrictEqual(activitySourceContextInventory(saved.sourceContext), activitySourceContextInventory(sourceContext)))
      throw new Error('ACTIVITY_SAVE_RECEIPT_SOURCE_CONTEXT_MISMATCH');
    const statements = saved.statements.map(({ statementId: _hostId, ...statement }) => statement);
    validateActivityProposal({ schemaVersion: candidateSchemaVersion, statements }, saved.sourceAnchors, {
      sourceBinding: binding, sourceContext: saved.sourceContext, deliveredRanges: saved.readCoverage.deliveredRanges,
      sectionIds: saved.readCoverage.selection.sectionIds,
    });
    if (expectedStatements !== undefined && !isDeepStrictEqual(statements, expectedStatements))
      throw new Error('ACTIVITY_SAVE_RECEIPT_STATEMENTS_INVALID');
  }
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
  const candidateSchemaVersion = options.candidateSchemaVersion ?? DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA;
  if (![DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2].includes(candidateSchemaVersion))
    throw new Error('ACTIVITY_RUN_SCHEMA_INVALID');
  const quoteSelectionSchemaVersion = options.quoteSelectionSchemaVersion;
  if (quoteSelectionSchemaVersion !== undefined && quoteSelectionSchemaVersion !== DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA)
    throw new Error('ACTIVITY_QUOTE_SELECTION_SCHEMA_INVALID');
  const selectionMode = quoteSelectionSchemaVersion === DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA;
  const nativeRecoveryMode = options.recoverNativeResult === true;
  if (nativeRecoveryMode && (!options.runRef || candidateSchemaVersion !== DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 ||
      !selectionMode || typeof dependencies.recoverNativeResult !== 'function'))
    throw new Error('ACTIVITY_NATIVE_RECOVERY_UNVERIFIED');
  const saveAction = selectionMode ? 'ACTIVITY_SAVE_SELECTION' : 'ACTIVITY_SAVE';
  const checkpointSchema = candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 ? ACTIVITY_CHECKPOINT_V2_SCHEMA
    : selectionMode ? ACTIVITY_CHECKPOINT_QUOTE_SELECTION_SCHEMA : ACTIVITY_CHECKPOINT_SCHEMA;
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
  const runContract = activityRunContract(summary);
  if (runContract.candidateSchemaVersion !== candidateSchemaVersion ||
      (candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 && runContract.productionContract.quoteTransportVersion !==
        (selectionMode ? DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA : DOCUMENT_ACTIVITY_QUOTE_OFFSETS_SCHEMA)) ||
      (options.productionContract !== undefined && !isDeepStrictEqual(options.productionContract, runContract.productionContract)))
    throw new Error('ACTIVITY_RUN_CONTRACT_MISMATCH');
  if (summary.result != null) {
    return { status: 'ACTIVITY_WORK_SAVED', documentVersionId, runRef,
      saved: validateSavedReceipt(summary.result, {
        documentVersionId, runRef,
        parseRunId: summary.parseRunId, semanticRevision: summary.semanticRevision, candidateSchemaVersion }),
      recoveredFromStatus: true, modelInvocations: 0, candidateOnly: true };
  }

  const leaseOwner = options.leaseOwner;
  if (!matchesPattern(LEASE_OWNER_PATTERN, leaseOwner))
    throw new Error('ACTIVITY_LEASE_OWNER_REQUIRED');
  const claimedAt = Date.now();
  const claim = await call('ACTIVITY_CLAIM', { documentVersionId, runRef, leaseOwner });
  validateRunSummary(claim, documentVersionId, runRef);
  assertRunContract(claim, runContract);
  if (candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 &&
      ['parseRunId', 'semanticRevision', 'selection', 'expectedRevision', 'requestId', 'deadline'].some(key => !isDeepStrictEqual(claim[key], summary[key])))
    throw new Error('ACTIVITY_RUN_BINDING_MISMATCH');
  if (claim.result != null) {
    return { status: 'ACTIVITY_WORK_SAVED', documentVersionId, runRef,
      saved: validateSavedReceipt(claim.result, {
        documentVersionId, runRef,
        parseRunId: claim.parseRunId, semanticRevision: claim.semanticRevision, candidateSchemaVersion }),
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
  let checkpoint;
  let diagnosticStage = 'CHECKPOINT_READ';
  let nativeRecovery;
  try {
    lease.throwIfLost();
  const sectionIds = claim.selection.sectionIds;
  const limit = options.readLimit ?? 20;
  const maxPages = options.maxPagesPerSection ?? 10_000;
  const checkpointPins = candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 ? {
    candidateSchemaVersion, productionContract: runContract.productionContract,
    sourceContextVersion: runContract.productionContract.sourceContextVersion,
    quoteTransportVersion: runContract.productionContract.quoteTransportVersion,
    parseRunId: claim.parseRunId, semanticRevision: claim.semanticRevision,
  } : {};

  // Durable per-run checkpoint. The factory owns the private directory
  // layout (0700/0600, keyed by endpoint origin+path without any token,
  // documentVersionId and runRef). Recovery reuses only strictly bound
  // persisted steps and never regenerates or re-dispatches an unknown one.
  checkpoint = typeof dependencies.checkpointFactory === 'function'
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
    assertCheckpointBinding(record, documentVersionId, runRef, checkpointSchema, checkpointPins);
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
      assertRunContract(recovered, runContract);
      const result = recovered.result ?? null;
      if (result != null)
        recoveredSaved = { ...validateSavedReceipt(result, {
          documentVersionId, runRef, parseRunId: claim.parseRunId,
          semanticRevision: claim.semanticRevision, sourceBinding: persisted.source?.sourceBinding, candidateSchemaVersion,
        }), replayed: true };
    } catch { /* The recovery itself failed: the outcome stays unknown. */ }
    if (recoveredSaved !== undefined)
      return { status: 'ACTIVITY_WORK_SAVED', documentVersionId, runRef, saved: recoveredSaved,
        modelInvocations: 0, candidateOnly: true, recoveredFromUnknownModel: true };
    if (!nativeRecoveryMode || persisted.source == null)
      throw new Error('ACTIVITY_MODEL_OUTCOME_UNKNOWN');
  }
  // Explicit recovery can never become a new model invocation if the original
  // durable dispatch marker is absent. Default consumers still stop above.
  if (nativeRecoveryMode && persisted.modelStarted == null && persisted.modelResult == null)
    throw new Error('ACTIVITY_NATIVE_RECOVERY_UNVERIFIED');
  priorSaveDispatched = persisted.saveStarted != null;

    diagnosticStage = 'SOURCE';
    if (!sectionIds.length) throw new Error('ACTIVITY_SELECTION_EMPTY');
    let sourceBinding;
    const deliveredAnchors = [];
    const anchorById = new Map();
    const deliveredRanges = [];
    const units = [];
    let sourceCoverage;
    let sourceContext;
    const sourceContexts = [];
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
      if (candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2) {
        sourceContext = validateActivitySourceContext(persisted.source.sourceContext, { sourceBinding,
          units, deliveredRanges, selectedSectionIds: sectionIds });
      }
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
        if (candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2) sourceContexts.push(read.sourceContext);
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
    // Context is page-dependent: union only what each READ actually delivered.
    // Repeated units can arise from shared ancestors; keep a single exact unit.
    if (candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2) {
      const uniqueUnits = new Map();
      for (const unit of units) {
        if (uniqueUnits.has(unit.unitId) && !isDeepStrictEqual(uniqueUnits.get(unit.unitId), unit))
          throw new Error('ACTIVITY_READ_UNIT_MISMATCH');
        uniqueUnits.set(unit.unitId, unit);
      }
      units.splice(0, units.length, ...uniqueUnits.values());
      if (sourceContext === undefined) sourceContext = mergeActivitySourceContexts(sourceContexts, {
        sourceBinding, units, deliveredRanges, selectedSectionIds: sectionIds });
    }
    // Durable source: the delivery, selection and fence are persisted before
    // any model work so a later attempt never re-reads a changed delivery.
    if (!nativeRecoveryMode) await writeCheckpoint('source.result', {
      schemaVersion: checkpointSchema, documentVersionId, runRef, ...checkpointPins,
      parseRunId: claim.parseRunId, semanticRevision: claim.semanticRevision,
      sourceBinding, selection: claim.selection, units, anchors: deliveredAnchors,
      deliveredRanges, sourceCoverage, fence, ...(sourceContext ? { sourceContext } : {}),
    });

    if (nativeRecoveryMode && persisted.modelResult == null) {
      // Host READ independently rechecks current actor/member/source authority
      // under this fresh fence. Reuse no package claims or old authorization.
      const currentUnits = new Map(), currentAnchors = new Map();
      const currentRanges = [], currentContexts = [];
      for (const sectionId of sectionIds) {
        let offset = 0, pages = 0;
        for (;;) {
          const read = validateReadReceipt(await call('ACTIVITY_READ', {
            ...fence, documentVersionId, runRef, sectionId, offset, limit,
          }), documentVersionId, runRef, sectionId, offset, claim);
          if (!isDeepStrictEqual(read.sourceBinding, sourceBinding) || !isDeepStrictEqual(read.sourceCoverage, sourceCoverage))
            throw new Error('ACTIVITY_NATIVE_RECOVERY_SOURCE_CHANGED');
          for (const [values, target, key] of [[read.units, currentUnits, 'unitId'], [read.anchors, currentAnchors, 'anchorId']]) {
            for (const value of values) {
              if (target.has(value[key]) && !isDeepStrictEqual(target.get(value[key]), value))
                throw new Error('ACTIVITY_NATIVE_RECOVERY_SOURCE_CHANGED');
              target.set(value[key], value);
            }
          }
          currentRanges.push(read.range); currentContexts.push(read.sourceContext);
          if (read.range.nextOffset === null) break;
          offset = read.range.nextOffset;
          if (++pages >= maxPages) throw new Error('ACTIVITY_READ_PAGES_EXCEEDED');
        }
      }
      const currentContext = mergeActivitySourceContexts(currentContexts, { sourceBinding,
        units: [...currentUnits.values()], deliveredRanges: currentRanges, selectedSectionIds: sectionIds });
      if (!isDeepStrictEqual([...currentUnits.values()], units) || !isDeepStrictEqual([...currentAnchors.values()], deliveredAnchors) ||
          !isDeepStrictEqual(currentRanges, deliveredRanges) || !isDeepStrictEqual(currentContext, sourceContext))
        throw new Error('ACTIVITY_NATIVE_RECOVERY_SOURCE_CHANGED');
    }

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
      ...(selectionMode ? { quoteSelectionSchemaVersion } : {}),
      ...(candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 ? { candidateSchemaVersion,
        productionContract: runContract.productionContract, sourceContext } : {}),
      documentVersionId, runRef, sectionIds,
      sourceBinding, selection: claim.selection, units, anchors: deliveredAnchors,
      deliveredRanges, sourceCoverage,
    };
    const inputHash = canonicalSha256(modelInput);
    let proposal;
    let modelVersion;
    let modelProvenance;
    let modelInvocations = 0;
    if (persisted.modelResult != null) {
      if (persisted.modelResult.inputHash !== inputHash)
        throw new Error('ACTIVITY_CHECKPOINT_BINDING_MISMATCH');
      proposal = persisted.modelResult.proposal;
      modelVersion = persisted.modelResult.modelVersion;
      modelProvenance = persisted.modelResult.provenance;
      nativeRecovery = persisted.modelResult.nativeRecovery;
    } else if (nativeRecoveryMode) {
      diagnosticStage = 'NATIVE_RECOVERY';
      if (persisted.modelStarted.inputHash !== inputHash)
        throw new Error('ACTIVITY_CHECKPOINT_BINDING_MISMATCH');
      const recovered = await lease.guard(() => dependencies.recoverNativeResult({
        input: modelInput, modelStarted: persisted.modelStarted, deadline: claim.deadline,
      }));
      proposal = recovered?.proposal; modelVersion = recovered?.modelVersion;
      modelProvenance = recovered?.provenance; nativeRecovery = recovered?.nativeRecovery;
      if (nativeRecovery?.protocolAdaptation !== true || nativeRecovery.originalHttpWireRecovered !== false ||
          nativeRecovery.modelInvocations !== 0 || nativeRecovery.inputHash !== inputHash ||
          nativeRecovery.runRef !== runRef || nativeRecovery.documentVersionId !== documentVersionId ||
          nativeRecovery.startedAt !== persisted.modelStarted.startedAt || nativeRecovery.deadline !== claim.deadline ||
          nativeRecovery.proposalSha256 !== canonicalSha256(proposal))
        throw new Error('ACTIVITY_NATIVE_RECOVERY_UNVERIFIED');
    } else {
      if (typeof dependencies.invokeModel !== 'function')
        throw new Error('ACTIVITY_MODEL_EXECUTOR_REQUIRED');
      lease.throwIfLost();
      // Model dispatch BEFORE HTTP: once this marker exists, only a result
      // checkpoint may clear the unknown outcome.
      await writeCheckpoint('model.started', {
        schemaVersion: checkpointSchema, step: 'model', ...checkpointPins,
        documentVersionId, runRef, inputHash, startedAt: new Date().toISOString() });
      lease.throwIfLost();
      let modelResult;
      diagnosticStage = 'MODEL';
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
      modelProvenance = modelResult?.provenance;
      modelInvocations = 1;
    }
    diagnosticStage = 'PROPOSAL_VALIDATION';
    try {
    if (typeof modelVersion !== 'string' || !modelVersion.trim() ||
        modelVersion.length > 160) throw new Error('ACTIVITY_MODEL_VERSION_INVALID');
    if (candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 &&
        !isDeepStrictEqual(modelProvenance, { modelVersion, ...runContract.productionContract, inputHash }))
      throw new Error('ACTIVITY_MODEL_PROVENANCE_MISMATCH');
    if (proposal?.schemaVersion !== candidateSchemaVersion) throw new Error('ACTIVITY_MODEL_SCHEMA_INVALID');
    if (selectionMode) validateActivityQuoteSelection(proposal, deliveredAnchors, { deliveredRanges, sourceBinding, sourceContext, units, sectionIds,
      expectedSourceBinding: { original: { ...sourceBinding.original, documentVersionId, parseRunId: claim.parseRunId }, semanticRevision: claim.semanticRevision } });
    else validateActivityProposal(proposal, deliveredAnchors, { sourceBinding, sourceContext, units, deliveredRanges, sectionIds });
    } catch (error) { definitiveModelError = true; throw error; }
    // Model result with the actual modelVersion BEFORE SAVE:
    diagnosticStage = 'MODEL_PERSIST';
    try {
    if (!(nativeRecoveryMode && persisted.modelResult != null)) await writeCheckpoint('model.result', {
      schemaVersion: checkpointSchema, step: 'model', ...checkpointPins,
      documentVersionId, runRef, inputHash, modelVersion, proposal,
      ...(candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 ? { provenance: modelProvenance } : {}),
      ...(nativeRecovery ? { nativeRecovery } : {}),
      finishedAt: new Date().toISOString() });
    } catch (error) { throw new Error('ACTIVITY_MODEL_OUTCOME_UNKNOWN', { cause: error }); }

    // The SAVE candidate is exactly the proposal. Host strictObject rejects
    // any extra field, so nothing else is ever attached here.
    const candidate = { schemaVersion: proposal.schemaVersion, statements: proposal.statements, ...(selectionMode ? { quoteSelectionSchemaVersion } : {}) };
    const canonicalProposal = structuredClone(selectionMode ? canonicalActivityQuoteSelection(proposal, deliveredAnchors, {
      deliveredRanges, sourceBinding, expectedSourceBinding: sourceBinding, sourceContext, units, sectionIds,
    }) : proposal);
    const producer = { skillVersion: options.skillVersion ?? WISELINK_SKILL_VERSION, modelVersion };
    const saveFields = { ...fence, documentVersionId, runRef, candidate, producer };

    let saved;
    diagnosticStage = 'SAVE';
    lease.throwIfLost();
    if (priorSaveDispatched) {
      // A prior attempt already recorded this exact SAVE command before its
      // dispatch. Never re-dispatch: only the original run's ACTIVITY_STATUS
      // result may confirm the outcome; unconfirmed stays unknown.
      if (!isDeepStrictEqual(
            fenceFreeSave(persisted.saveStarted.saveCommand),
            fenceFreeSave(buildActivityRequest(saveAction, saveFields))))
        throw new Error('ACTIVITY_CHECKPOINT_BINDING_MISMATCH');
      try {
        const recovered = validateRunSummary(
          await recoverStatus(runRef), documentVersionId, runRef);
        assertRunContract(recovered, runContract);
        const result = recovered.result ?? null;
        if (result != null && (typeof result.runRef !== 'string' || result.runRef === runRef))
          saved = { ...result, replayed: true };
      } catch { /* The recovery itself failed: the SAVE outcome stays unknown. */ }
      if (saved === undefined)
        throw new Error('ACTIVITY_SAVE_UNCONFIRMED');
    } else {
      // The complete SAVE command BEFORE dispatch:
      await writeCheckpoint('save.started', {
        schemaVersion: checkpointSchema, step: 'save', ...checkpointPins,
        documentVersionId, runRef, inputHash,
        saveCommand: buildActivityRequest(saveAction, saveFields),
        startedAt: new Date().toISOString() });
      saveDispatched = true;
      try {
        // Dispatch is already durable. A later heartbeat loss cannot erase a
        // successful receipt; bound this in-flight response independently.
        saved = await call(saveAction, saveFields,
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
          assertRunContract(recovered, runContract);
          const result = recovered.result ?? null;
          if (result != null && (typeof result.runRef !== 'string' || result.runRef === runRef))
            saved = { ...result, replayed: true };
        } catch { /* The recovery itself failed: the SAVE outcome stays unknown. */ }
        if (saved === undefined)
          throw new Error('ACTIVITY_SAVE_UNCONFIRMED', { cause: error });
      }
    }
    diagnosticStage = 'SAVE_READBACK';
    validateSavedReceipt(saved, {
      documentVersionId, runRef, sourceBinding, producer, statementCount: proposal.statements.length,
      candidateSchemaVersion, sourceContext, expectedStatements: canonicalProposal.statements,
      expectedAnchors: deliveredAnchors, expectedReadCoverage: { status: 'DELIVERED_RANGES_ONLY',
        selection: claim.selection, deliveredRanges, sourceCoverage } });
    return { status: 'ACTIVITY_WORK_SAVED', documentVersionId, runRef,
      saved, producer, modelInvocations, candidateOnly: true,
      ...(nativeRecovery ? { nativeRecovery } : {}) };
  } catch (error) {
    const diagnostic = activityFailureDiagnostic(error, diagnosticStage);
    if (error && typeof error === 'object') error.activityDiagnostic = diagnostic;
    if (checkpoint) {
      try { await checkpoint.write('failure.diagnostic', diagnostic); }
      catch { /* Diagnostics never authorize retry or mask the original error. */ }
    }
    // Local, deterministic failures are isolated to this run through a fenced
    // ACTIVITY_FAIL. Once the SAVE has been dispatched the outcome may be
    // persisted Host-side: every unconfirmed path — a failing or malformed
    // recovery STATUS, a malformed receipt — is never FAILed, never retried
    // and never reported as success. An unknown model outcome and a lost
    // lease never FAIL either: the run stays pending for its owner.
    if (!nativeRecoveryMode && checkpointReadComplete && (!modelDispatched || definitiveModelError) &&
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
