import test from 'node:test';
import assert from 'node:assert/strict';
import { activityFailureDiagnostic, safeActivityDriverError } from '../scripts/document-activity-failure-diagnostic.mjs';
import { validateActivityQuoteSelection } from '../scripts/consume-hosted-document-activity.mjs';
import { DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2, DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA } from '../scripts/document-activity-model-contract.mjs';
import { DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA } from '../scripts/resolve-document-activity-quote-selection.mjs';

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

test('bounded evidence failures have only a fixed pre-dispatch source category, never raw private suffixes', () => {
  const error = new Error('ACTIVITY_MODEL_EVIDENCE_POINTER_OR_LOCATOR_INVALID');
  assert.deepEqual(activityFailureDiagnostic(error, 'MODEL_INPUT'), {
    schemaVersion: 'wiselink.document.activity-failure-diagnostic.v1', stage: 'MODEL_INPUT',
    category: 'SOURCE', code: error.message, httpStatus: null, retryAuthorized: false, rawErrorIncluded: false,
  });
  assert.equal(safeActivityDriverError(error), error.message);
  const privateError = new Error(`${error.message}: private source URL`);
  assert.equal(activityFailureDiagnostic(privateError, 'MODEL_INPUT').code, null);
  assert.equal(safeActivityDriverError(privateError), 'ACTIVITY_DRIVER_FAILED');
});

test('technical-ID quote rejection keeps its fixed code through an unknown wrapper', () => {
  const cause = new Error('ACTIVITY_TECHNICAL_ID_NOT_QUOTED');
  for (const error of [cause, new Error('ACTIVITY_MODEL_OUTCOME_UNKNOWN', { cause })]) {
    assert.deepEqual(activityFailureDiagnostic(error, 'PROPOSAL_VALIDATION'), {
      schemaVersion: 'wiselink.document.activity-failure-diagnostic.v1',
      stage: 'PROPOSAL_VALIDATION', category: 'TOOL', code: cause.message, httpStatus: null,
      retryAuthorized: false, rawErrorIncluded: false,
    });
  }
  assert.equal(safeActivityDriverError(cause), cause.message);
});

test('a raw identifier elsewhere in the anchor cannot repair its selected quote', () => {
  // Synthetic text only. The original proposal must remain rejected; the
  // diagnostic records that rejection without rewriting cues or quotations.
  const binding = { original: { documentVersionId: 'DV-diagnostic', parseRunId: 'PR-diagnostic', parseRevision: 1,
    sourceArtifactId: 'SRC-diagnostic', sourceSha256: 'a'.repeat(64), sourceByteLength: 123 }, semanticRevision: 1 };
  const anchors = [{ anchorId: 'a-diagnostic', sourceUnitId: 'u-diagnostic',
    sourceText: 'Unit (TAG) A-123 is installed. TAG A-123 is cited later.' }];
  const context = { sourceBinding: binding, expectedSourceBinding: binding,
    units: [{ unitId: 'u-diagnostic' }], sectionIds: ['section-diagnostic'],
    deliveredRanges: [{ sectionId: 'section-diagnostic', offset: 0, unitIds: ['u-diagnostic'], anchorIds: ['a-diagnostic'], nextOffset: null }],
    sourceContext: { schemaVersion: DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA, sourceBinding: binding,
      profile: { profileRef: 'generic.author-sections.v1', selectionBasis: 'NOT_RECORDED', family: null, issuer: null },
      sections: [{ sectionId: 'section-diagnostic', parentSectionId: null, titleRaw: null, roleKey: null,
        headingUnitId: null, deliveredUnitIds: ['u-diagnostic'], contextForSectionIds: [] }], organizationWarnings: [] } };
  const proposal = { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2,
    quoteSelectionSchemaVersion: DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA, statements: [{
      statementKey: 'constructed-identifier', label: 'Constructed identifier',
      quotes: [{ anchorId: 'a-diagnostic', text: 'Unit (TAG) A-123 is installed.' }],
      subject: null, action: null, modality: null, status: null, times: [],
      technicalIds: [{ raw: 'TAG A-123', quoteIndex: 0, kind: 'TECHNICAL_LABEL' }],
      scope: { sectionIds: ['section-diagnostic'], conditions: [], completeness: 'DELIVERED_SCOPE_ONLY' }, limitations: [],
    }] };
  const before = JSON.stringify({ proposal, anchors, context });
  assert.equal(anchors[0].sourceText.includes(proposal.statements[0].technicalIds[0].raw), true);
  assert.throws(() => validateActivityQuoteSelection(proposal, anchors, context), error => {
    assert.equal(error.message, 'ACTIVITY_TECHNICAL_ID_NOT_QUOTED');
    assert.equal(activityFailureDiagnostic(error, 'PROPOSAL_VALIDATION').code, error.message);
    assert.equal(safeActivityDriverError(error), error.message);
    return true;
  });
  assert.equal(JSON.stringify({ proposal, anchors, context }), before);
  const control = structuredClone(proposal);
  control.statements[0].technicalIds[0].raw = '(TAG) A-123';
  assert.equal(validateActivityQuoteSelection(control, anchors, context), control);
});

test('technical-ID lookalikes and private suffixes never widen the fixed-code allowlist', () => {
  for (const message of ['ACTIVITY_TECHNICAL_ID_NOT_QUOTED: PRIVATE_SECRET',
    ' ACTIVITY_TECHNICAL_ID_NOT_QUOTED', 'ACTIVITY_TECHNICAL_ID_NOT_QUOTED ',
    'ACTIVITY_TECHNICAL_ID_NOT_QUOTED https://private/provider', 'ACTIVITY_TIME_NOT_QUOTED']) {
    const error = Object.assign(new Error(message), { code: 'ACTIVITY_TECHNICAL_ID_NOT_QUOTED' });
    assert.deepEqual(activityFailureDiagnostic(error, 'PROPOSAL_VALIDATION'), {
      schemaVersion: 'wiselink.document.activity-failure-diagnostic.v1',
      stage: 'PROPOSAL_VALIDATION', category: 'UNKNOWN', code: null, httpStatus: null,
      retryAuthorized: false, rawErrorIncluded: false,
    });
    assert.equal(safeActivityDriverError(error), 'ACTIVITY_DRIVER_FAILED');
  }
});
