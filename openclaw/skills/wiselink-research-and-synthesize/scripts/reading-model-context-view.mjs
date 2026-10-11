import { canonicalJson } from './validate-payload.mjs';

export const READING_MODEL_VIEW_VERSION = 'wiselink.document.reading-model-view.v1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = value => typeof value === 'string' && value.trim().length > 0;
const reject = detail => { throw new Error(`READING_MODEL_INPUT_${detail}`); };

// RFC 6901 paths select the delivered unit itself. Never evaluate a path, search
// for similar text, or substitute another equal-text anchor.
function sourceTextAt(unit, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || /~(?![01])/u.test(path))
    reject('POINTER_INVALID');
  let value = unit;
  for (const encoded of path.slice(1).split('/')) {
    const key = encoded.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if ((!object(value) && !Array.isArray(value)) || !Object.hasOwn(value, key) ||
        (Array.isArray(value) && !/^(?:0|[1-9][0-9]*)$/u.test(key))) reject('POINTER_INVALID');
    value = value[key];
  }
  if (typeof value !== 'string' || !value.trim()) reject('POINTER_INVALID');
  return value;
}

function unitsById(units) {
  if (!Array.isArray(units) || !units.length) reject('INVALID');
  const result = new Map();
  for (const unit of units) {
    if (!object(unit) || !identity(unit.unitId) || result.has(unit.unitId)) reject('UNIT_INVALID');
    result.set(unit.unitId, unit);
  }
  return result;
}

/** A lossless wire view, never a new source/checkpoint or a saved interpretation.
 * Keep raw payloads, coverage, every identity and all unknown extension fields.
 * Only exact duplicates addressed by original pointers/references are omitted. */
export function readingModelContextView(input) {
  if (!object(input) || !object(input.sourceBinding) || !object(input.sourceCoverage) ||
      !Array.isArray(input.deliveredRanges) || !Array.isArray(input.anchors) || !input.anchors.length)
    reject('INVALID');
  const units = unitsById(input.units);
  const anchorIds = new Set();
  const locators = new Map();
  const anchors = input.anchors.map(anchor => {
    if (!object(anchor) || !identity(anchor.anchorId) || anchorIds.has(anchor.anchorId)) reject('INVALID');
    anchorIds.add(anchor.anchorId);
    const unit = units.get(anchor.sourceUnitId);
    if (!unit) reject('UNIT_MISSING');
    if (sourceTextAt(unit, anchor.payloadPath) !== anchor.sourceText) reject('POINTER_MISMATCH');
    if (!Array.isArray(anchor.sourceRefIds) || !anchor.sourceRefIds.length ||
        !Array.isArray(anchor.sourceLocators) || anchor.sourceLocators.length !== anchor.sourceRefIds.length)
      reject('LOCATOR_INVALID');
    anchor.sourceLocators.forEach((locator, index) => {
      const ref = anchor.sourceRefIds[index];
      if (!identity(ref) || !object(locator) || locator.sourceRefId !== ref ||
          !Array.isArray(unit.sourceRefIds) || !unit.sourceRefIds.includes(ref)) reject('LOCATOR_INVALID');
      if (locators.has(ref) && canonicalJson(locators.get(ref)) !== canonicalJson(locator))
        reject('LOCATOR_CONFLICT');
      locators.set(ref, locator);
    });
    const { sourceText: _text, sourceLocators: _locators, ...retained } = anchor;
    return retained;
  });
  const { sourceBinding, units: sourceUnits, anchors: _anchors, sourceCoverage, ...request } = input;
  const view = structuredClone({ schemaVersion: READING_MODEL_VIEW_VERSION,
    evidence: { sourceBinding, units: sourceUnits, anchors, sourceLocatorIndex: Object.fromEntries(locators), sourceCoverage },
    request });
  if (canonicalJson(restoreReadingModelInput(view)) !== canonicalJson(input)) reject('VIEW_ROUNDTRIP_MISMATCH');
  return view;
}

/** Used to check the serialization invariant; quotes still come from the original
 * delivered anchors, never from this reconstructed/model-visible view. */
export function restoreReadingModelInput(view) {
  if (!object(view) || view.schemaVersion !== READING_MODEL_VIEW_VERSION ||
      !object(view.evidence) || !object(view.request) || !object(view.evidence.sourceLocatorIndex) ||
      !Array.isArray(view.evidence.anchors)) reject('VIEW_INVALID');
  const { sourceBinding, units, anchors, sourceLocatorIndex, sourceCoverage } = view.evidence;
  const byId = unitsById(units);
  return structuredClone({ ...view.request, sourceBinding, units, sourceCoverage,
    anchors: anchors.map(anchor => {
      const unit = byId.get(anchor.sourceUnitId);
      if (!unit) reject('UNIT_MISSING');
      if (!Array.isArray(anchor.sourceRefIds)) reject('LOCATOR_INVALID');
      return { ...anchor, sourceText: sourceTextAt(unit, anchor.payloadPath),
        sourceLocators: anchor.sourceRefIds.map(ref => {
          if (!Object.hasOwn(sourceLocatorIndex, ref) || sourceLocatorIndex[ref]?.sourceRefId !== ref)
            reject('LOCATOR_MISSING');
          return sourceLocatorIndex[ref];
        }) };
    }) });
}
