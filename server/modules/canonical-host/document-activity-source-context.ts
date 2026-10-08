import {
  DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA,
  type DocumentActivityDeliveryRange,
  type DocumentActivitySelection,
  type DocumentActivitySourceBinding,
  type DocumentActivitySourceContext,
} from '@shared/document-activity.interface';
import type { DocumentOriginalResult } from '@shared/document-original.interface';
import type { DocumentSemanticMap } from '@shared/document-semantic-map.interface';
import {
  assertDocumentSemanticMap,
  selectDocumentSemanticSection,
} from '../document-management/src/hosted/nest/document-semantic-map';

export interface DocumentActivitySourceContextInput {
  original: DocumentOriginalResult;
  semanticMap: DocumentSemanticMap;
  /** The immutable run's expected original and semantic revision, not a latest lookup. */
  sourceBinding: DocumentActivitySourceBinding;
  selection: DocumentActivitySelection;
  /** A single actual READ page, or the run's cumulative persisted delivery receipts. */
  deliveredRanges: DocumentActivityDeliveryRange[];
}

function fail(code: string): never {
  throw new Error(`DOCUMENT_ACTIVITY_SOURCE_CONTEXT_${code}`);
}

/** Compare DTO values across execution realms, keeping every own key and array position. */
function sameSourceValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  }
  const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every(key =>
    Object.prototype.hasOwnProperty.call(right, key) &&
    sameSourceValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/**
 * Project saved author organization onto actual delivery, without interpreting source prose.
 * Shape/source validation cannot prove the meaning of a candidate or a saved role assignment.
 * The caller owns authorization, the READ receipts' origin, and immutable run/source fences.
 */
export function buildDocumentActivitySourceContext(
  input: DocumentActivitySourceContextInput,
): DocumentActivitySourceContext {
  const { original, semanticMap: map, sourceBinding, selection, deliveredRanges } = input;
  if (original.schemaVersion !== 'wiselink.document.original.v1' ||
      !sameSourceValue(map.binding, original.binding) ||
      !sameSourceValue(sourceBinding.original, original.binding) ||
      sourceBinding.semanticRevision !== map.semanticRevision) fail('BINDING_MISMATCH');
  assertDocumentSemanticMap(map, original);
  if (!selection.sectionIds.length ||
      new Set(selection.sectionIds).size !== selection.sectionIds.length) fail('SELECTION_INVALID');

  const sections = new Map(map.sections.map(section => [section.sectionId, section]));
  const units = new Map(original.source.units.map(unit => [unit.unitId, unit]));
  const selectedSectionIds = new Set(selection.sectionIds);
  const availableBySection = new Map<string, string[]>();
  const ancestorsBySection = new Map<string, Set<string>>();
  if (selection.sectionIds.some(sectionId => !sections.has(sectionId))) fail('SELECTION_INVALID');
  const prepareSelection = (sectionId: string): void => {
    if (availableBySection.has(sectionId)) return;
    const selected = selectDocumentSemanticSection(original, map, sectionId);
    const allowed = new Set([...selected.unitIds, ...selected.contextUnitIds]);
    // ACTIVITY_READ slices the original structured source's existing array order.
    // Do not normalize text, reinterpret headings, or silently reorder that inventory.
    availableBySection.set(sectionId, original.source.units
      .filter(unit => allowed.has(unit.unitId)).map(unit => unit.unitId));
    ancestorsBySection.set(sectionId, new Set(selected.ancestorSectionIds));
  };

  const delivered = new Set<string>();
  const contextTargets = new Map<string, Set<string>>();
  const pages = new Set<string>();
  for (const range of deliveredRanges) {
    if (!selectedSectionIds.has(range.sectionId)) fail('DELIVERY_RANGE_INVALID');
    prepareSelection(range.sectionId);
    const available = availableBySection.get(range.sectionId);
    if (!available || !Number.isSafeInteger(range.offset) || range.offset < 0 ||
        range.offset >= available.length || !range.unitIds.length ||
        new Set(range.unitIds).size !== range.unitIds.length ||
        range.unitIds.some(id => !units.has(id)) ||
        new Set(range.anchorIds).size !== range.anchorIds.length ||
        range.anchorIds.some(id => typeof id !== 'string' || !id.trim())) fail('DELIVERY_RANGE_INVALID');
    const pageKey = JSON.stringify([range.sectionId, range.offset]);
    if (pages.has(pageKey)) fail('DELIVERY_RANGE_DUPLICATE');
    pages.add(pageKey);
    const end = range.offset + range.unitIds.length;
    if (end > available.length ||
        !sameSourceValue(range.unitIds, available.slice(range.offset, end)) ||
        range.nextOffset !== (end < available.length ? end : null)) fail('DELIVERY_RANGE_CHANGED');
    for (const id of range.unitIds) delivered.add(id);
    const pageUnits = new Set(range.unitIds);
    for (const ancestorId of ancestorsBySection.get(range.sectionId)!) {
      const ancestor = sections.get(ancestorId)!;
      if (!pageUnits.has(ancestor.headingUnitId) &&
          !ancestor.bodyUnitIds.some(id => pageUnits.has(id))) continue;
      const targets = contextTargets.get(ancestorId) ?? new Set<string>();
      targets.add(range.sectionId);
      contextTargets.set(ancestorId, targets);
    }
  }

  const projectedSections: DocumentActivitySourceContext['sections'] = map.sections.flatMap(section => {
    const ownUnits = new Set([section.headingUnitId, ...section.bodyUnitIds]);
    const deliveredUnitIds = original.source.units
      .filter(unit => ownUnits.has(unit.unitId) && delivered.has(unit.unitId))
      .map(unit => unit.unitId);
    if (!deliveredUnitIds.length) return [];
    const headingDelivered = delivered.has(section.headingUnitId);
    return [{
      sectionId: section.sectionId,
      parentSectionId: section.parentSectionId,
      titleRaw: headingDelivered ? section.titleRaw : null,
      roleKey: section.roleKey,
      headingUnitId: headingDelivered ? section.headingUnitId : null,
      deliveredUnitIds,
      contextForSectionIds: selection.sectionIds
        .filter(id => contextTargets.get(section.sectionId)?.has(id)),
    }];
  });
  const supportedSections = new Set(projectedSections.map(section => section.sectionId));
  const organizationWarnings = map.organizationWarnings.flatMap(warning => {
    const sectionIds = warning.sectionIds.filter(id => supportedSections.has(id));
    const unitIds = warning.unitIds.filter(id => delivered.has(id));
    return sectionIds.length && unitIds.length ? [{ code: warning.code, sectionIds, unitIds }] : [];
  });
  // Read the exact saved receipt, including historical policy/reason and raw registry inputs.
  // Missing provenance stays missing. Never query or reclassify against today's registry.
  // Evidence refs describe the selection basis, not delivered source units or expanded coverage.
  const result: DocumentActivitySourceContext = {
    schemaVersion: DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA,
    sourceBinding,
    profile: map.profileSelection === undefined
      ? { profileRef: map.profileRef, selectionBasis: 'NOT_RECORDED', family: null, issuer: null }
      : { profileRef: map.profileRef, selectionBasis: 'RECORDED',
          selectionSchemaVersion: 'wiselink.document.semantic-profile-selection.v1',
          selection: map.profileSelection },
    sections: projectedSections,
    organizationWarnings,
  };
  return structuredClone(result);
}
