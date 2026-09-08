import assert from 'node:assert/strict';
import test from 'node:test';
import { readHostMcpJsonResult } from '../scripts/run-hosted-review-turn.mjs';

test('retains initial-analysis Host error codes while filtering error bodies and unstructured messages', () => {
  const toolName = 'begin_dynamic_evaluation';
  const errorPrefix = `REVIEW_HOST_MCP_TOOL_FAILED:${toolName}`;
  const secret = 'fixture-private-response-body';
  const readError = (text) => readHostMcpJsonResult({
    isError: true,
    content: [{ type: 'text', text }],
  }, toolName);
  const codes = [
    'JOBAID_SOURCE_AUTHORIZATION_CHANGED',
    'DYNAMIC_EVALUATION_REQUIRES_CONFIRMED_SB',
    'CONFIGURATION_REEVALUATION_APPLICABILITY_STAGE_REQUIRED',
    'TRANSLATION_SAVED_PROVENANCE_INVALID',
    'COMMON_CONTEXT_WORK_ITEM_NOT_VISIBLE',
    'PACKAGE_ARTIFACT_JSON_INVALID',
    'SOURCE_CONTEXT_REFS_INVALID',
    'SOURCE_PAGE_INVALID',
  ];

  for (const code of codes) {
    for (const text of [code, `Error: ${code}:${secret} contains private text`]) {
      assert.throws(() => readError(text), (error) => {
        assert.equal(error.hostErrorCode, code);
        assert.equal(error.receivedHostToolError, true);
        assert.equal(error.message, `${errorPrefix}:${code}`);
        assert.equal(error.message.includes(secret), false);
        return true;
      });
    }
    assert.throws(() => readError(`${code} ${secret}`), (error) => {
      assert.equal(error.hostErrorCode, null);
      assert.equal(error.message, errorPrefix);
      return true;
    });
  }

  for (const text of [
    `${secret} JOBAID_SOURCE_AUTHORIZATION_CHANGED`,
    `UNRECOGNIZED_HOST_FAILURE:${secret}`,
    `JOBAID_source_authorization_changed:${secret}`,
    `JOBAID_:${secret}`,
    `JOBAID_${'A'.repeat(160)}:${secret}`,
  ]) {
    assert.throws(() => readError(text), (error) => {
      assert.equal(error.hostErrorCode, null);
      assert.equal(error.message, errorPrefix);
      assert.equal(error.receivedHostToolError, true);
      return true;
    });
  }
});
