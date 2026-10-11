import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, canonicalSha256 } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';
import { readingModelContextView, restoreReadingModelInput,
  READING_MODEL_VIEW_VERSION } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/reading-model-context-view.mjs';

function fixture() {
  const locator = { sourceRefId: 'ref-one', kind: 'PDF_PAGE', pageStart: 0,
    quote: 'A distinct raw location.', bbox: null, extension: { preserve: true } };
  return { documentVersionId: 'DV', runRef: 'DRR', parseRunId: 'PR', semanticRevision: 2, expectedRevision: 1,
    sourceBinding: { original: { documentVersionId: 'DV', sourceSha256: 'a'.repeat(64) }, semanticRevision: 2 },
    units: [{ unitId: 'unit-one', sourceRefIds: [locator.sourceRefId], mapping: { sourcePointer: '/raw/0' },
      payload: { text: 'Same text.', rowGroups: [{ rows: [{ cells: [{ text: 'Same text.' }] }] }],
        'key/with/slash': { '~key': 'Escaped pointer.' }, rawMineruContent: { uniqueBusinessFact: 'Retain this raw fact.' } } },
    { unitId: 'unit-two', sourceRefIds: ['ref-two'], mapping: { pageIndex: 1 }, payload: { text: 'Same text.' } }],
    anchors: [
      { anchorId: 'anchor-one', sourceUnitId: 'unit-one', payloadPath: '/payload/text', sourceText: 'Same text.',
        sourceRefIds: ['ref-one'], sourceLocators: [locator], extension: 'Retain anchor extension.' },
      { anchorId: 'anchor-cell', sourceUnitId: 'unit-one', payloadPath: '/payload/rowGroups/0/rows/0/cells/0/text',
        sourceText: 'Same text.', sourceRefIds: ['ref-one'], sourceLocators: [structuredClone(locator)] },
      { anchorId: 'anchor-escaped', sourceUnitId: 'unit-one', payloadPath: '/payload/key~1with~1slash/~0key',
        sourceText: 'Escaped pointer.', sourceRefIds: ['ref-one'], sourceLocators: [structuredClone(locator)] },
      { anchorId: 'anchor-two', sourceUnitId: 'unit-two', payloadPath: '/payload/text', sourceText: 'Same text.',
        sourceRefIds: ['ref-two'], sourceLocators: [{ ...locator, sourceRefId: 'ref-two', pageStart: 1 }] },
    ], deliveredRanges: [{ offset: 0, unitIds: ['unit-one', 'unit-two'], nextOffset: null }],
    sourceCoverage: { knownPageCount: 2, readPageIndexes: [0, 1], unresolvedRanges: [
      { reason: 'TEXT_CONFLICT', message: 'Retain the entire raw warning.', unitIds: ['unit-two'], pageIndexes: [1] },
    ] }, extension: { preserveUnknownRequestFields: true } };
}

test('wire view round trips every source/coverage/raw/extension field without merging equal text identities', () => {
  const input = fixture(), before = structuredClone(input);
  const view = readingModelContextView(input);
  assert.equal(view.schemaVersion, READING_MODEL_VIEW_VERSION);
  assert.deepEqual(restoreReadingModelInput(view), input);
  assert.deepEqual(input, before);
  assert.deepEqual(view.evidence.units, input.units);
  assert.deepEqual(view.evidence.sourceCoverage, input.sourceCoverage);
  assert.deepEqual(view.evidence.sourceBinding, input.sourceBinding);
  assert.deepEqual(view.evidence.anchors.map(anchor => anchor.anchorId), input.anchors.map(anchor => anchor.anchorId));
  assert.equal(Object.keys(view.evidence.sourceLocatorIndex).length, 2);
  assert.ok(view.evidence.anchors.every(anchor => !Object.hasOwn(anchor, 'sourceText') && !Object.hasOwn(anchor, 'sourceLocators')));
  view.evidence.units[0].payload.text = 'changed view';
  assert.deepEqual(input, before);
});

test('view is deterministic and places source evidence before request-specific identities', () => {
  const input = fixture(), other = { ...input, runRef: 'DRR-next', expectedRevision: 2 };
  const first = readingModelContextView(input), second = readingModelContextView(other);
  assert.equal(canonicalSha256(first), canonicalSha256(readingModelContextView(input)));
  assert.equal(canonicalJson(first.evidence), canonicalJson(second.evidence));
  assert.notEqual(canonicalSha256(first), canonicalSha256(second));
  const wire = canonicalJson(first);
  assert.ok(wire.indexOf('"evidence":') < wire.indexOf('"request":'));
  assert.equal(canonicalJson(restoreReadingModelInput(first)), canonicalJson(input));
});

test('missing/unequal pointers and conflicting/missing/reordered locators fail explicitly', () => {
  for (const [code, mutate] of [
    ['POINTER_INVALID', input => { input.anchors[0].payloadPath = '/payload/missing'; }],
    ['POINTER_INVALID', input => { input.anchors[0].payloadPath = '/payload/~2'; }],
    ['POINTER_MISMATCH', input => { input.anchors[0].sourceText = 'Not the delivered text.'; }],
    ['UNIT_MISSING', input => { input.anchors[0].sourceUnitId = 'missing'; }],
    ['LOCATOR_INVALID', input => { input.anchors[0].sourceLocators = []; }],
    ['LOCATOR_INVALID', input => { input.anchors[0].sourceLocators[0].sourceRefId = 'other'; }],
    ['LOCATOR_CONFLICT', input => { input.anchors[1].sourceLocators[0].pageStart = 9; }],
    ['UNIT_INVALID', input => { input.units.push(structuredClone(input.units[0])); }],
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => readingModelContextView(input), new RegExp(`READING_MODEL_INPUT_${code}$`, 'u'));
  }
  const view = readingModelContextView(fixture());
  delete view.evidence.sourceLocatorIndex['ref-two'];
  assert.throws(() => restoreReadingModelInput(view), /READING_MODEL_INPUT_LOCATOR_MISSING/u);
});

test('multiple references retain locator order and their complete independent identities', () => {
  const input = fixture();
  const second = { sourceRefId: 'ref-extra', kind: 'PDF_PAGE', pageStart: 0, quote: 'Other passage.' };
  input.units[0].sourceRefIds.push(second.sourceRefId);
  input.anchors[0].sourceRefIds.push(second.sourceRefId);
  input.anchors[0].sourceLocators.push(second);
  const view = readingModelContextView(input);
  assert.deepEqual(restoreReadingModelInput(view).anchors[0], input.anchors[0]);
  input.anchors[0].sourceLocators.reverse();
  assert.throws(() => readingModelContextView(input), /READING_MODEL_INPUT_LOCATOR_INVALID/u);
});
