import test from 'node:test';
import assert from 'node:assert/strict';
import { activityFailureDiagnostic, safeActivityDriverError } from '../scripts/document-activity-failure-diagnostic.mjs';

test('unknown wrapper preserves fixed provenance/HTTP/transport/tool/persist categories without raw private error', () => {
  for (const [cause, stage, category, code] of [
    [new Error('REVIEW_MODEL_PROVENANCE_UNREADABLE'), 'MODEL', 'PROVENANCE', 'REVIEW_MODEL_PROVENANCE_UNREADABLE'],
    [new Error('ACTIVITY_GATEWAY_HTTP_403'), 'MODEL', 'HTTP', 'HTTP_STATUS'],
    [Object.assign(new Error('private URL/body/headers'), { code: 'ECONNRESET' }), 'MODEL', 'TRANSPORT', 'ECONNRESET'],
    [new Error('ACTIVITY_MODEL_TOOL_CALL_INVALID'), 'MODEL', 'TOOL', 'ACTIVITY_MODEL_TOOL_CALL_INVALID'],
    [new Error('private disk error'), 'MODEL_PERSIST', 'PERSIST', null],
  ]) {
    const error = new Error('ACTIVITY_MODEL_OUTCOME_UNKNOWN', { cause });
    const result = activityFailureDiagnostic(error, stage);
    assert.equal(result.category, category); assert.equal(result.code, code);
    assert.equal(result.retryAuthorized, false); assert.equal(result.rawErrorIncluded, false);
    assert.equal(JSON.stringify(result).includes('private'), false);
    if (category === 'HTTP') assert.equal(result.httpStatus, 403);
  }
});

test('untrusted errors and provider-private text never become CLI errors or diagnostic codes', () => {
  const error = new Error('Authorization: PRIVATE_SECRET https://private/provider response body');
  error.activityDiagnostic = { raw: 'ignored by classifier' };
  const result = activityFailureDiagnostic(error, 'private stage');
  assert.deepEqual(result, { schemaVersion: 'wiselink.document.activity-failure-diagnostic.v1', stage: 'UNKNOWN',
    category: 'UNKNOWN', code: null, httpStatus: null, retryAuthorized: false, rawErrorIncluded: false });
  assert.equal(safeActivityDriverError(error), 'ACTIVITY_DRIVER_FAILED');
  assert.equal(safeActivityDriverError(new Error('ACTIVITY_PRIVATE_SECRET')), 'ACTIVITY_DRIVER_FAILED');
  assert.equal(safeActivityDriverError(new Error('ACTIVITY_QUOTE_SELECTION_TEXT_NOT_FOUND:STATEMENT_1:QUOTE_2')),
    'ACTIVITY_QUOTE_SELECTION_TEXT_NOT_FOUND:STATEMENT_1:QUOTE_2');
});
