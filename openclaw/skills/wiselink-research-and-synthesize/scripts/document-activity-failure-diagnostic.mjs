// Fixed categories only. Never copy a raw error, response body, URL or headers.
const CODES = new Map([
  ['REVIEW_MODEL_PROVENANCE_UNREADABLE', 'PROVENANCE'],
  ['ACTIVITY_MODEL_PROVENANCE_MISMATCH', 'PROVENANCE'],
  ['ACTIVITY_MODEL_VERSION_INVALID', 'PROVENANCE'],
  ['ACTIVITY_MODEL_TOOL_CALL_INVALID', 'TOOL'],
  ['ACTIVITY_MODEL_RESPONSE_INVALID', 'TOOL'],
  ['ACTIVITY_MODEL_SCHEMA_INVALID', 'TOOL'],
  ['ACTIVITY_QUOTE_SELECTION_SHAPE_INVALID', 'TOOL'],
  ['ACTIVITY_PROPOSAL_SHAPE_INVALID', 'TOOL'],
  ['ACTIVITY_QUOTE_MISMATCH', 'TOOL'],
  ['ACTIVITY_NATIVE_RECOVERY_UNVERIFIED', 'PROVENANCE'],
  ['ACTIVITY_NATIVE_RECOVERY_SOURCE_CHANGED', 'SOURCE'],
  ['ACTIVITY_CHECKPOINT_BINDING_MISMATCH', 'SOURCE'],
  ['ACTIVITY_RUN_BINDING_MISMATCH', 'SOURCE'],
  ['ACTIVITY_MODEL_ABORTED', 'TRANSPORT'],
  ['ACTIVITY_LEASE_LOST', 'TRANSPORT'],
  ['ACTIVITY_DEADLINE_EXCEEDED', 'TRANSPORT'],
  ['ACTIVITY_SAVE_UNCONFIRMED', 'PERSIST'],
]);
const STAGES = new Set(['CHECKPOINT_READ', 'SOURCE', 'MODEL', 'NATIVE_RECOVERY', 'PROPOSAL_VALIDATION', 'MODEL_PERSIST', 'SAVE', 'SAVE_READBACK']);
const TRANSPORT_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);
const QUOTE_ERROR = /^ACTIVITY_QUOTE_SELECTION_(?:SELECTION_INVALID|HOST_CONTEXT_INVALID|SOURCE_BINDING_MISMATCH|UNKNOWN_ANCHOR|ANCHOR_NOT_ALLOWED|EMPTY_TEXT|TEXT_NOT_FOUND|TEXT_AMBIGUOUS):STATEMENT_\d{1,8}:QUOTE_\d{1,8}$/u;
const DRIVER_CODES = new Set([...CODES.keys(), 'ACTIVITY_MODEL_OUTCOME_UNKNOWN', 'ACTIVITY_DRIVER_FAILED',
  'ACTIVITY_NATIVE_RECOVERY_OPT_IN_REQUIRED', 'ACTIVITY_DOCUMENT_VERSION_REQUIRED', 'ACTIVITY_RUN_REF_INVALID']);

export function activityFailureDiagnostic(error, stage) {
  let category = stage === 'MODEL_PERSIST' || stage === 'SAVE' ? 'PERSIST' : 'UNKNOWN';
  let code = null, httpStatus = null;
  const seen = new Set();
  for (let cause = error, depth = 0; cause && depth < 5 && !seen.has(cause); cause = cause.cause, depth++) {
    seen.add(cause);
    const value = cause.message;
    const http = typeof value === 'string' && /^ACTIVITY_GATEWAY_(HTTP|INVALID_JSON_HTTP)_([1-5]\d{2})$/u.exec(value);
    if (http) { category = 'HTTP'; code = http[1] === 'HTTP' ? 'HTTP_STATUS' : 'HTTP_RESPONSE_INVALID'; httpStatus = Number(http[2]); }
    else if (CODES.has(value)) { category = CODES.get(value); code = value; }
    else if (typeof value === 'string' && QUOTE_ERROR.test(value)) { category = 'TOOL'; code = value; }
    else if (TRANSPORT_CODES.has(cause.code)) { category = 'TRANSPORT'; code = cause.code; }
  }
  return { schemaVersion: 'wiselink.document.activity-failure-diagnostic.v1',
    stage: STAGES.has(stage) ? stage : 'UNKNOWN', category, code, httpStatus,
    retryAuthorized: false, rawErrorIncluded: false };
}

export function safeActivityDriverError(error) {
  const code = error?.message;
  return typeof code === 'string' && (DRIVER_CODES.has(code) || QUOTE_ERROR.test(code))
    ? code : 'ACTIVITY_DRIVER_FAILED';
}
