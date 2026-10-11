import { canonicalJson, canonicalSha256 } from './validate-payload.mjs';
import { readingModelContextView, restoreReadingModelInput, READING_MODEL_VIEW_VERSION } from './reading-model-context-view.mjs';

export const ACTIVITY_MODEL_EVIDENCE_VIEW_VERSION = 'wiselink.document.activity-model-evidence-view.v1';
export const ACTIVITY_MODEL_EVIDENCE_LIMITS = Object.freeze({
  bytes: 16 * 1024 * 1024, depth: 64, nodes: 250_000, values: 50_000,
  references: 250_000, signatures: 64 * 1024 * 1024,
});
const REF = '$value', LITERAL = '$literal';
const fail = code => { throw new Error(`ACTIVITY_MODEL_EVIDENCE_${code}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const byteLength = value => Buffer.byteLength(canonicalJson(value));
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => own(value, key));

function restoredSizeGuard(source) {
  const keys = ['sourceBinding', 'units', 'anchors', 'sourceLocatorIndex', 'sourceCoverage'];
  if (!exactKeys(source, ['evidence', 'request']) || !exactKeys(source.evidence, keys) || !object(source.request) ||
      ['sourceBinding', 'units', 'anchors', 'sourceCoverage'].some(key => own(source.request, key))) fail('VIEW_INVALID');
  boundedJson(source);
  const { units, anchors, sourceLocatorIndex } = source.evidence;
  if (!Array.isArray(units) || !Array.isArray(anchors) || !object(sourceLocatorIndex)) fail('VIEW_INVALID');
  const byId = new Map(units.map(unit => [unit?.unitId, unit]));
  if (byId.size !== units.length) fail('POINTER_OR_LOCATOR_INVALID');
  const usedLocators = new Set(), textSizes = new Map(), locatorSizes = new Map(), locatorNodes = new Map();
  let projected = byteLength(source.request) + byteLength(source.evidence.sourceBinding) +
    byteLength(units) + byteLength(source.evidence.sourceCoverage) + 128;
  let projectedNodes = boundedJson(source.request).nodes + boundedJson(source.evidence.sourceBinding).nodes +
    boundedJson(units).nodes + boundedJson(source.evidence.sourceCoverage).nodes + boundedJson(anchors).nodes;
  for (const anchor of anchors) {
    if (!object(anchor) || own(anchor, 'sourceText') || own(anchor, 'sourceLocators') ||
        typeof anchor.payloadPath !== 'string' || !anchor.payloadPath.startsWith('/') || /~(?![01])/u.test(anchor.payloadPath) ||
        !Array.isArray(anchor.sourceRefIds) || !anchor.sourceRefIds.length) fail('POINTER_OR_LOCATOR_INVALID');
    let text = byId.get(anchor.sourceUnitId);
    for (const part of anchor.payloadPath.slice(1).split('/')) {
      const key = part.replace(/~1/gu, '/').replace(/~0/gu, '~');
      if ((!object(text) && !Array.isArray(text)) || !own(text, key) ||
          (Array.isArray(text) && !/^(?:0|[1-9][0-9]*)$/u.test(key))) fail('POINTER_OR_LOCATOR_INVALID');
      text = text[key];
    }
    if (typeof text !== 'string' || !text.trim()) fail('POINTER_OR_LOCATOR_INVALID');
    if (!textSizes.has(text)) textSizes.set(text, byteLength(text));
    projected += byteLength(anchor) + textSizes.get(text) + 40;
    projectedNodes += 2; // Reconstructed sourceText and sourceLocators array.
    for (const ref of anchor.sourceRefIds) {
      if (!own(sourceLocatorIndex, ref) || sourceLocatorIndex[ref]?.sourceRefId !== ref) fail('POINTER_OR_LOCATOR_INVALID');
      usedLocators.add(ref);
      if (!locatorSizes.has(ref)) {
        locatorSizes.set(ref, byteLength(sourceLocatorIndex[ref]));
        locatorNodes.set(ref, boundedJson(sourceLocatorIndex[ref]).nodes);
      }
      projected += locatorSizes.get(ref) + 1;
      projectedNodes += locatorNodes.get(ref);
    }
    // Guard the duplicate-text/locator fan-out before structuredClone in the
    // existing restorer. Never allocate an arbitrarily expanded source tree.
    if (projected > ACTIVITY_MODEL_EVIDENCE_LIMITS.bytes || projectedNodes > ACTIVITY_MODEL_EVIDENCE_LIMITS.nodes) fail('LIMIT_EXCEEDED');
  }
  if (usedLocators.size !== Object.keys(sourceLocatorIndex).length) fail('LOCATOR_UNREACHABLE');
}

// Validate before canonical serialization/cloning. No accessors, non-JSON values,
// cycles or unbounded expansion may enter the model-visible representation.
function boundedJson(value) {
  let nodes = 0, approximateBytes = 0;
  const active = new Set();
  const visit = (item, depth) => {
    if (++nodes > ACTIVITY_MODEL_EVIDENCE_LIMITS.nodes || depth > ACTIVITY_MODEL_EVIDENCE_LIMITS.depth) fail('LIMIT_EXCEEDED');
    if (typeof item === 'string') approximateBytes += Buffer.byteLength(item);
    else if (item === null || typeof item === 'boolean') approximateBytes += 5;
    else if (typeof item === 'number' && Number.isFinite(item) && !Object.is(item, -0)) approximateBytes += 24;
    else if (typeof item === 'object') {
      if (active.has(item)) fail('CYCLE');
      if ((!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) ||
          Object.getOwnPropertySymbols(item).length) fail('JSON_INVALID');
      active.add(item);
      if (Array.isArray(item)) {
        if (Object.keys(item).length !== item.length) fail('JSON_INVALID');
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !own(descriptor, 'value')) fail('JSON_INVALID');
          visit(descriptor.value, depth + 1);
        }
      } else for (const key of Object.keys(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !own(descriptor, 'value')) fail('JSON_INVALID');
        approximateBytes += Buffer.byteLength(key);
        visit(descriptor.value, depth + 1);
      }
      active.delete(item);
    } else fail('JSON_INVALID');
    if (approximateBytes > ACTIVITY_MODEL_EVIDENCE_LIMITS.bytes) fail('LIMIT_EXCEEDED');
  };
  visit(value, 0);
  if (byteLength(value) > ACTIVITY_MODEL_EVIDENCE_LIMITS.bytes) fail('LIMIT_EXCEEDED');
  return { nodes };
}

/** Wire-only view. Complete source/checkpoint values and identities stay owned
 * by Host. Equal values share storage; units/anchors are never merged by text. */
export function activityModelEvidenceView(input) {
  boundedJson(input);
  const inputHash = canonicalSha256(input);
  let pointerView;
  try { pointerView = readingModelContextView(input); }
  catch { fail('POINTER_OR_LOCATOR_INVALID'); }
  const { schemaVersion: _readingTag, ...source } = pointerView;
  // Canonical key traversal makes the value table independent of insertion order.
  const rootSource = JSON.parse(canonicalJson(source));
  const occurrences = new Map();
  let signatureBytes = 0;
  const keyOf = value => {
    const key = canonicalJson(value);
    signatureBytes += Buffer.byteLength(key);
    if (signatureBytes > ACTIVITY_MODEL_EVIDENCE_LIMITS.signatures) fail('LIMIT_EXCEEDED');
    return key;
  };
  const collect = value => {
    if (typeof value === 'string' || value !== null && typeof value === 'object') {
      const key = keyOf(value), previous = occurrences.get(key);
      occurrences.set(key, { count: (previous?.count ?? 0) + 1, bytes: Buffer.byteLength(key) });
    }
    if (value !== null && typeof value === 'object') for (const child of Object.values(value)) collect(child);
  };
  collect(rootSource);
  const values = [], indexes = new Map();
  let references = 0;
  const encode = (value, literal = false) => {
    const shareable = typeof value === 'string' || value !== null && typeof value === 'object';
    const key = shareable ? keyOf(value) : null;
    const count = key === null ? null : occurrences.get(key);
    if (!literal && count?.count > 1 && count.bytes >= (typeof value === 'string' ? 32 : 128)) {
      if (++references > ACTIVITY_MODEL_EVIDENCE_LIMITS.references) fail('LIMIT_EXCEEDED');
      if (!indexes.has(key)) {
        if (values.length >= ACTIVITY_MODEL_EVIDENCE_LIMITS.values) fail('LIMIT_EXCEEDED');
        const index = values.length;
        indexes.set(key, index); values.push(null);
        values[index] = encode(value, true);
      }
      return { [REF]: indexes.get(key) };
    }
    if (Array.isArray(value)) return value.map(child => encode(child));
    if (object(value)) {
      const pairs = Object.entries(value).map(([name, child]) => [name, encode(child)]);
      // Literal source keys are data, including actual "$value"/"$literal" keys.
      return own(value, REF) || own(value, LITERAL) ? { [LITERAL]: pairs } : Object.fromEntries(pairs);
    }
    return value;
  };
  const root = encode(rootSource);
  const view = { schemaVersion: ACTIVITY_MODEL_EVIDENCE_VIEW_VERSION, inputHash, values, root };
  boundedJson(view);
  const restored = restoreActivityModelEvidenceView(view, inputHash);
  if (canonicalJson(restored) !== canonicalJson(input)) fail('ROUNDTRIP_MISMATCH');
  return view;
}

/** Restore solely for conservation verification. No reconstructed view becomes
 * a new source/READ receipt or the quote-validation authority. */
export function restoreActivityModelEvidenceView(view, expectedInputHash) {
  boundedJson(view);
  if (!exactKeys(view, ['schemaVersion', 'inputHash', 'values', 'root']) ||
      view.schemaVersion !== ACTIVITY_MODEL_EVIDENCE_VIEW_VERSION ||
      !/^[a-f0-9]{64}$/u.test(expectedInputHash ?? '') || view.inputHash !== expectedInputHash ||
      !Array.isArray(view.values) || view.values.length > ACTIVITY_MODEL_EVIDENCE_LIMITS.values) fail('VIEW_INVALID');
  const active = new Set(), used = new Set(), signatures = new Map(), signatureOwners = new Map();
  let nodes = 0, references = 0, signatureBytes = 0, expandedStringBytes = 0;
  const decode = (value, depth = 0) => {
    if (++nodes > ACTIVITY_MODEL_EVIDENCE_LIMITS.nodes || depth > ACTIVITY_MODEL_EVIDENCE_LIMITS.depth) fail('LIMIT_EXCEEDED');
    if (object(value) && own(value, REF)) {
      if (!exactKeys(value, [REF]) || !Number.isSafeInteger(value[REF]) || value[REF] < 0 || value[REF] >= view.values.length) fail('REFERENCE_INVALID');
      if (++references > ACTIVITY_MODEL_EVIDENCE_LIMITS.references) fail('LIMIT_EXCEEDED');
      const index = value[REF];
      if (active.has(index)) fail('CYCLE');
      active.add(index); used.add(index);
      const restored = decode(view.values[index], depth + 1);
      active.delete(index);
      if (!signatures.has(index)) {
        const key = canonicalJson(restored);
        signatureBytes += Buffer.byteLength(key);
        if (signatureBytes > ACTIVITY_MODEL_EVIDENCE_LIMITS.signatures) fail('LIMIT_EXCEEDED');
        if (signatureOwners.has(key) && signatureOwners.get(key) !== index) fail('REFERENCE_AMBIGUOUS');
        signatures.set(index, key); signatureOwners.set(key, index);
      }
      // Decode each occurrence anew: distinct source records remain distinct.
      return restored;
    }
    if (object(value) && own(value, LITERAL)) {
      if (!exactKeys(value, [LITERAL]) || !Array.isArray(value[LITERAL])) fail('LITERAL_INVALID');
      const keys = new Set();
      const pairs = value[LITERAL].map(pair => {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || keys.has(pair[0])) fail('LITERAL_INVALID');
        keys.add(pair[0]);
        return [pair[0], decode(pair[1], depth + 1)];
      });
      if (!keys.has(REF) && !keys.has(LITERAL)) fail('LITERAL_INVALID');
      return Object.fromEntries(pairs);
    }
    if (Array.isArray(value)) return value.map(child => decode(child, depth + 1));
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decode(child, depth + 1)]));
    if (typeof value === 'string') {
      expandedStringBytes += Buffer.byteLength(value);
      if (expandedStringBytes > ACTIVITY_MODEL_EVIDENCE_LIMITS.bytes) fail('LIMIT_EXCEEDED');
    }
    return value;
  };
  const source = decode(view.root);
  if (used.size !== view.values.length) fail('REFERENCE_UNREACHABLE');
  restoredSizeGuard(source);
  let input;
  try { input = restoreReadingModelInput({ schemaVersion: READING_MODEL_VIEW_VERSION, ...source }); }
  catch { fail('POINTER_OR_LOCATOR_INVALID'); }
  boundedJson(input);
  if (canonicalSha256(input) !== expectedInputHash) fail('ROUNDTRIP_MISMATCH');
  return input;
}
