// Pure consumer-side mirror of Host actual-delivered source-context metadata.
// Merging never reads a semantic map or supplies undelivered text.
import { isDeepStrictEqual } from 'node:util';
import { canonicalSha256 } from './validate-payload.mjs';
import { DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA } from './document-activity-model-contract.mjs';

const keys = (value, expected) => value != null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const ids = value => Array.isArray(value) && value.every(nonempty) && new Set(value).size === value.length;
const invalid = () => { throw new Error('ACTIVITY_SOURCE_CONTEXT_INVALID'); };

// A receipt is the saved selector's account of template inputs, not current classification.
// Historical policy strings remain opaque; the consumer never reruns a selector.
function validProfile(profile) {
  if (profile?.selectionBasis === 'NOT_RECORDED') return keys(profile, ['profileRef', 'selectionBasis', 'family', 'issuer']) &&
    nonempty(profile.profileRef) && profile.family === null && profile.issuer === null;
  if (!keys(profile, ['profileRef', 'selectionBasis', 'selectionSchemaVersion', 'selection']) ||
      !nonempty(profile.profileRef) || profile.selectionBasis !== 'RECORDED' ||
      profile.selectionSchemaVersion !== 'wiselink.document.semantic-profile-selection.v1') return false;
  const selection = profile.selection;
  return keys(selection, ['policyVersion', 'reason', 'registeredIdentity', 'evidenceSourceRefIds']) &&
    nonempty(selection.policyVersion) &&
    ['REGISTERED_FAMILY_ISSUER', 'REGISTERED_METADATA_TEMPLATE', 'UNKNOWN_FAMILY', 'UNSUPPORTED_FAMILY',
      'UNKNOWN_ISSUER', 'UNSUPPORTED_ISSUER', 'IDENTITY_CONFLICT', 'UNSUPPORTED_LAYOUT'].includes(selection.reason) &&
    keys(selection.registeredIdentity, ['family', 'issuer']) &&
    [selection.registeredIdentity.family, selection.registeredIdentity.issuer].every(value => value === null || typeof value === 'string') &&
    ids(selection.evidenceSourceRefIds);
}

export function validateActivitySourceContext(context, { sourceBinding, units, deliveredRanges, selectedSectionIds } = {}) {
  if (!keys(context, ['schemaVersion', 'sourceBinding', 'profile', 'sections', 'organizationWarnings']) ||
      context.schemaVersion !== DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA ||
      !keys(context.sourceBinding, ['original', 'semanticRevision']) ||
      context.sourceBinding.original == null || typeof context.sourceBinding.original !== 'object' ||
      !Number.isSafeInteger(context.sourceBinding.semanticRevision) || context.sourceBinding.semanticRevision < 1 ||
      !validProfile(context.profile) ||
      !Array.isArray(context.sections) || !Array.isArray(context.organizationWarnings)) invalid();
  if (sourceBinding !== undefined && !isDeepStrictEqual(context.sourceBinding, sourceBinding))
    throw new Error('ACTIVITY_SOURCE_CONTEXT_BINDING_MISMATCH');
  const actualIds = deliveredRanges === undefined ? null : new Set(deliveredRanges.flatMap(range => range.unitIds));
  const actualUnitIds = units === undefined ? null : new Set(units.map(unit => unit?.unitId));
  const seenSections = new Set(), seenUnits = new Set();
  for (const section of context.sections) {
    if (!keys(section, ['sectionId', 'parentSectionId', 'titleRaw', 'roleKey', 'headingUnitId', 'deliveredUnitIds', 'contextForSectionIds']) ||
        !nonempty(section.sectionId) || seenSections.has(section.sectionId) ||
        (section.parentSectionId !== null && (!nonempty(section.parentSectionId) || section.parentSectionId === section.sectionId)) ||
        (section.titleRaw !== null && typeof section.titleRaw !== 'string') ||
        (section.roleKey !== null && !nonempty(section.roleKey)) ||
        (section.headingUnitId !== null && !nonempty(section.headingUnitId)) ||
        !ids(section.deliveredUnitIds) || !section.deliveredUnitIds.length || !ids(section.contextForSectionIds) ||
        section.contextForSectionIds.includes(section.sectionId) ||
        (selectedSectionIds !== undefined && section.contextForSectionIds.some(id => !selectedSectionIds.includes(id))) ||
        (section.headingUnitId === null && section.titleRaw !== null) ||
        (section.headingUnitId !== null && (!section.deliveredUnitIds.includes(section.headingUnitId) || section.titleRaw === null))) invalid();
    seenSections.add(section.sectionId);
    for (const unitId of section.deliveredUnitIds) {
      if (seenUnits.has(unitId) || (actualIds !== null && !actualIds.has(unitId)) ||
          (actualUnitIds !== null && !actualUnitIds.has(unitId))) invalid();
      seenUnits.add(unitId);
    }
  }
  if ((actualIds !== null && (actualIds.size !== seenUnits.size || [...actualIds].some(id => !seenUnits.has(id)))) ||
      (actualUnitIds !== null && (actualUnitIds.size !== seenUnits.size || [...actualUnitIds].some(id => !seenUnits.has(id))))) invalid();
  for (const warning of context.organizationWarnings) {
    if (!keys(warning, ['code', 'sectionIds', 'unitIds']) ||
        warning.code !== 'EMPTY_ROLE_FOLLOWED_BY_UNCLASSIFIED_HEADING' ||
        !ids(warning.sectionIds) || !warning.sectionIds.length || !ids(warning.unitIds) || !warning.unitIds.length ||
        warning.sectionIds.some(id => !seenSections.has(id)) || warning.unitIds.some(id => !seenUnits.has(id))) invalid();
  }
  return context;
}

/** Union only observed sections, units, relationships and warnings. A later
 * page may deliver a previously absent heading, but cannot change its text.
 * All other shared structural/profile metadata must agree exactly. */
export function mergeActivitySourceContexts(contexts, options = {}) {
  if (!Array.isArray(contexts) || !contexts.length) invalid();
  const merged = structuredClone(validateActivitySourceContext(contexts[0], { sourceBinding: options.sourceBinding, selectedSectionIds: options.selectedSectionIds }));
  const sectionById = new Map(merged.sections.map(section => [section.sectionId, section]));
  const warningByHash = new Map(merged.organizationWarnings.map(warning => [canonicalSha256(warning), warning]));
  for (const context of contexts.slice(1)) {
    validateActivitySourceContext(context, { sourceBinding: merged.sourceBinding, selectedSectionIds: options.selectedSectionIds });
    if (!isDeepStrictEqual(context.profile, merged.profile))
      throw new Error('ACTIVITY_SOURCE_CONTEXT_PROFILE_MISMATCH');
    for (const section of context.sections) {
      const previous = sectionById.get(section.sectionId);
      if (previous === undefined) {
        const copy = structuredClone(section); sectionById.set(section.sectionId, copy); merged.sections.push(copy); continue;
      }
      if (previous.parentSectionId !== section.parentSectionId || previous.roleKey !== section.roleKey ||
          (previous.headingUnitId !== null && section.headingUnitId !== null && previous.headingUnitId !== section.headingUnitId) ||
          (previous.titleRaw !== null && section.titleRaw !== null && previous.titleRaw !== section.titleRaw))
        throw new Error('ACTIVITY_SOURCE_CONTEXT_SECTION_MISMATCH');
      if (previous.headingUnitId === null && section.headingUnitId !== null) {
        previous.headingUnitId = section.headingUnitId; previous.titleRaw = section.titleRaw;
      }
      previous.deliveredUnitIds = [...new Set([...previous.deliveredUnitIds, ...section.deliveredUnitIds])];
      previous.contextForSectionIds = [...new Set([...previous.contextForSectionIds, ...section.contextForSectionIds])];
    }
    for (const warning of context.organizationWarnings) {
      const hash = canonicalSha256(warning);
      if (!warningByHash.has(hash)) { const copy = structuredClone(warning); warningByHash.set(hash, copy); merged.organizationWarnings.push(copy); }
    }
  }
  return validateActivitySourceContext(merged, options);
}

/** Readback may coalesce per-page warnings. Sections and actual relationship
 * inventories must remain exact, regardless of presentation order. */
export function activitySourceContextInventory(context) {
  validateActivitySourceContext(context);
  return { schemaVersion: context.schemaVersion, sourceBinding: context.sourceBinding, profile: context.profile,
    sections: context.sections.map(section => ({ ...section,
      deliveredUnitIds: [...section.deliveredUnitIds].sort(), contextForSectionIds: [...section.contextForSectionIds].sort(),
    })).sort((a, b) => a.sectionId.localeCompare(b.sectionId)) };
}
