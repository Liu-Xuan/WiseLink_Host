import test from 'node:test';
import assert from 'node:assert/strict';
import { activityModelEvidenceView, restoreActivityModelEvidenceView,
  ACTIVITY_MODEL_EVIDENCE_LIMITS } from '../scripts/activity-model-evidence-view.mjs';
import { canonicalJson, canonicalSha256 } from '../scripts/validate-payload.mjs';
import { activityV2UserContent, ACTIVITY_MODEL_V2_RECOVERED_USER_PREFIX,
  ACTIVITY_MODEL_V2_SOURCE_CONTEXT_SELECTION_PROMPT_VERSION as OLD } from '../scripts/document-activity-model-contract.mjs';
import { activityEvidenceInput } from './fixtures/activity-model-evidence-input.mjs';

const restore = (view, input) => restoreActivityModelEvidenceView(view, canonicalSha256(input));
const encoded = (root, values = []) => ({ schemaVersion: 'wiselink.document.activity-model-evidence-view.v1',
  inputHash: 'a'.repeat(64), root, values });
const reject = view => assert.throws(() => restoreActivityModelEvidenceView(view, view.inputHash), /ACTIVITY_MODEL_EVIDENCE_/u);

test('complete 13-field input conserves distinct equal-text identities, raw tables, geometry, order and unknowns', () => {
  const input = activityEvidenceInput(); const before = canonicalJson(input), hash = canonicalSha256(input);
  const view = activityModelEvidenceView(input), restored = restore(view, input);
  assert.equal(Object.keys(input).length, 13); assert.equal(view.inputHash, hash);
  assert.equal(canonicalJson(restored), before); assert.equal(canonicalJson(input), before);
  assert.notEqual(restored.units[0], restored.units[1]);
  assert.equal(restored.units[0].text, restored.units[1].text);
  assert.deepEqual(restored.anchors.map(anchor => anchor.anchorId), ['anchor-1', 'anchor-2', 'anchor-3']);
  assert.equal(restored.anchors[0].sourceText, input.units[0].text);
  assert.deepEqual(restored.anchors[2].sourceLocators[0].textIndexes, [4, 5]);
  assert.match(canonicalJson(view), /P\/N 560/u); assert.match(canonicalJson(view), /P\/N 760/u);
  assert.ok(view.values.length > 0); assert.ok(Buffer.byteLength(canonicalJson(view)) < Buffer.byteLength(before));
  assert.deepEqual(restored.sourceCoverage.unresolvedRanges[0].physicalPages, [9, 10]);
});

test('deterministic key order and safely escaped literal reserved keys roundtrip without interpretation', () => {
  const input = activityEvidenceInput();
  const literal = JSON.parse('{"$value":0,"$literal":[["$value",12]],"__proto__":{"data":"literal prototype key"}}');
  input.units[0].extension = [literal, structuredClone(literal), { $value: 2 }, { $literal: [] }];
  // Unknown original input fields, including a name also used by the wire view,
  // remain request data and may never be silently overwritten on restoration.
  input.sourceLocatorIndex = { originalExtension: literal };
  const view = activityModelEvidenceView(input);
  assert.equal(canonicalJson(restore(view, input)), canonicalJson(input));
  assert.equal(Object.getPrototypeOf(restore(view, input).units[0].extension[0]), Object.prototype);
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  assert.equal(canonicalJson(activityModelEvidenceView(reordered)), canonicalJson(view));
  assert.match(canonicalJson(view), /\$literal/u);
});

test('old pin retains full exact INPUT; unknown or inconsistent new pins cannot fall back', () => {
  const old = activityEvidenceInput(OLD);
  assert.equal(activityV2UserContent(old), `${ACTIVITY_MODEL_V2_RECOVERED_USER_PREFIX}INPUT:\n${canonicalJson(old)}`);
  const fresh = activityEvidenceInput();
  const view = JSON.parse(activityV2UserContent(fresh).split('INPUT:\n')[1]);
  assert.equal(canonicalJson(restore(view, fresh)), canonicalJson(fresh));
  for (const key of ['promptVersion', 'quoteTransportVersion', 'toolSchemaSha256', 'sourceContextVersion']) {
    const bad = structuredClone(fresh); bad.productionContract[key] = 'unknown';
    assert.throws(() => activityV2UserContent(bad), /ACTIVITY_PRODUCTION_CONTRACT_INVALID/u);
  }
});

test('pointer mismatch, foreign or conflicting locator, duplicate identity and missing unit fail before serialization', () => {
  for (const mutate of [
    input => input.anchors[0].sourceText += ' changed',
    input => input.anchors[0].payloadPath = '/raw/html',
    input => input.anchors[0].sourceLocators[0].sourceRefId = 'foreign',
    input => input.anchors[0].sourceRefIds[0] = 'foreign',
    input => input.units[0].unitId = input.units[1].unitId,
    input => input.anchors[1].anchorId = input.anchors[0].anchorId,
    input => input.anchors[0].sourceUnitId = 'missing',
    input => { input.anchors[1].sourceRefIds = ['ref-one']; input.units[1].sourceRefIds = ['ref-one'];
      input.anchors[1].sourceLocators = [{ ...input.anchors[0].sourceLocators[0], physicalPage: 99 }]; },
  ]) {
    const input = activityEvidenceInput(); mutate(input);
    assert.throws(() => activityModelEvidenceView(input), /ACTIVITY_MODEL_EVIDENCE_POINTER_OR_LOCATOR_INVALID/u);
  }
});

test('untrusted JSON rejects cycles, accessors, sparse arrays, nonfinite/non-JSON values and bounded depth/bytes/nodes', () => {
  const cyclic = {}; cyclic.self = cyclic;
  const accessor = Object.defineProperty({}, 'getter', { enumerable: true, get() { assert.fail('must not read an accessor'); } });
  let deep = null; for (let n = 0; n < ACTIVITY_MODEL_EVIDENCE_LIMITS.depth + 1; n++) deep = [deep];
  for (const extension of [cyclic, accessor, new Date(), [undefined], [, 1], { x: Infinity }, { x: -0 },
    { x: 1n }, deep, 'a'.repeat(ACTIVITY_MODEL_EVIDENCE_LIMITS.bytes + 1),
    Array(ACTIVITY_MODEL_EVIDENCE_LIMITS.nodes + 1).fill(null)]) {
    const input = activityEvidenceInput(); input.extension = extension;
    assert.throws(() => activityModelEvidenceView(input), /ACTIVITY_MODEL_EVIDENCE_(?:CYCLE|JSON_INVALID|LIMIT_EXCEEDED)/u);
  }
});

test('missing, cyclic, ambiguous, unreachable, malformed or colliding references fail closed', () => {
  for (const view of [
    encoded({ $value: 0 }), encoded({ $value: -1 }, ['x']), encoded({ $value: 0.5 }, ['x']),
    encoded({ $value: 0, extra: true }, ['x']), encoded({ $value: 0, $literal: [] }, ['x']),
    encoded({ $value: 0 }, [{ $value: 0 }]), encoded({ $value: 0 }, [{ $value: 1 }, { $value: 0 }]),
    encoded([{ $value: 0 }, { $value: 1 }], ['equal', 'equal']), encoded(null, ['unreachable']),
    encoded({ $literal: [['$value', 0], ['$value', 1]] }), encoded({ $literal: [['ordinary', 1]] }),
    encoded({ $literal: [['$value', 0]], extra: true }),
  ]) reject(view);
  const input = activityEvidenceInput(), view = activityModelEvidenceView(input);
  assert.throws(() => restoreActivityModelEvidenceView(view, 'b'.repeat(64)), /VIEW_INVALID/u);
  view.inputHash = 'b'.repeat(64);
  assert.throws(() => restoreActivityModelEvidenceView(view, view.inputHash), /ROUNDTRIP_MISMATCH/u);
});

test('reference graph fan-out is bounded before an expanded tree can exhaust memory', () => {
  const values = ['a'.repeat(1024)];
  for (let n = 0; n < 20; n++) values.push([{ $value: n }, { $value: n }]);
  assert.throws(() => restoreActivityModelEvidenceView(encoded({ $value: 20 }, values), 'a'.repeat(64)),
    /ACTIVITY_MODEL_EVIDENCE_LIMIT_EXCEEDED/u);
});

test('repeated locator node fan-out is bounded before the source restorer clones it', () => {
  const input = activityEvidenceInput();
  const { sourceBinding, units: _units, anchors: _anchors, sourceCoverage, ...request } = input;
  const root = { request, evidence: { sourceBinding, sourceCoverage,
    units: [{ unitId: 'unit-synthetic', text: 'exact', sourceRefIds: ['ref-synthetic'] }],
    anchors: Array.from({ length: 1100 }, (_, index) => ({ anchorId: `a-${index}`, sourceUnitId: 'unit-synthetic',
      payloadPath: '/text', sourceRefIds: ['ref-synthetic'] })),
    sourceLocatorIndex: { 'ref-synthetic': { sourceRefId: 'ref-synthetic', nodes: Array(300).fill(null) } } } };
  assert.throws(() => restoreActivityModelEvidenceView(encoded(root), 'a'.repeat(64)),
    /ACTIVITY_MODEL_EVIDENCE_LIMIT_EXCEEDED/u);
});

test('unbound locator data cannot disappear inside a view accepted against an original hash', () => {
  const input = activityEvidenceInput(), view = activityModelEvidenceView(input);
  // Decode/restore is also a strict input boundary, not merely a hash check:
  // adding otherwise ignored locator evidence is rejected before restoration.
  view.root.evidence.sourceLocatorIndex.extra = { sourceRefId: 'extra', text: 'unbound authority' };
  assert.throws(() => restore(view, input), /LOCATOR_UNREACHABLE/u);
});
