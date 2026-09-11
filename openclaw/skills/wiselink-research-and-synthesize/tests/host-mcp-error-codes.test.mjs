import assert from 'node:assert/strict';
import test from 'node:test';
import { readHostMcpJsonResult } from '../scripts/run-hosted-review-turn.mjs';
import { errorCode } from '../scripts/consume-hosted-work-item.mjs';

test('source rejection identifies only a reference already present in the submitted work', () => {
  const ref = 'DOCUMENT_VERSION:DV-one:page:1';
  const args = { operation: 'SAVE_WORK', workJson: JSON.stringify({ premises: [{ evidenceRef: ref }] }) };
  for (const rejected of [ref, 'private-unrelated-value']) {
    assert.throws(() => readHostMcpJsonResult({ isError: true, content: [{ type: 'text',
      text: `Error: JOBAID_SOURCE_NOT_DELIVERED:${rejected}` }] }, 'matter_action_attempt', args), error => {
      assert.equal(error.hostRejectedSourceRef, rejected === ref ? ref : undefined);
      assert.equal(error.message.includes(rejected), false);
      return true;
    });
  }
});

test('the observed Matter scope rejection retains both the call site and safe cause in cron diagnostics', () => {
  for (const text of ['Canonical API-key service scope is unavailable.',
    'Error: Canonical API-key service scope is unavailable.', 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE']) {
    assert.throws(() => readHostMcpJsonResult({ isError: true, content: [{ type: 'text', text }] },
      'next_matter_assessment'), (error) => {
      assert.equal(errorCode(error), 'REVIEW_HOST_MCP_TOOL_FAILED:next_matter_assessment:CANONICAL_SERVICE_SCOPE_UNAVAILABLE');
      return true;
    });
  }
  const privateText = 'Canonical API-key service scope is unavailable. token=fixture-private-token';
  assert.throws(() => readHostMcpJsonResult({ isError: true, content: [{ type: 'text', text: privateText }] },
    'next_matter_assessment'), (error) => {
    assert.equal(errorCode(error), 'REVIEW_HOST_MCP_TOOL_FAILED:next_matter_assessment');
    assert.equal(JSON.stringify(error).includes('fixture-private-token'), false);
    return true;
  });
  assert.equal(errorCode(new Error('REVIEW_HOST_MCP_TOOL_FAILED:private-url?token=fixture-private-token')),
    'REVIEW_HOST_MCP_TOOL_FAILED');
});

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
