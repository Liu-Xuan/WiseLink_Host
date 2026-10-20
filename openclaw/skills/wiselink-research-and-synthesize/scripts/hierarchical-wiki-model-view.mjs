import { canonicalJson } from './validate-payload.mjs';
import { derivedSummaryRegistry, validateDerivedSummaryModelInput } from './derived-summary-shape.mjs';
import { derivedSummarySparseMemberBody } from './derived-summary-incremental-revision.mjs';

export const isHierarchicalWikiParent = input => ['ATA2', 'FLEET'].includes(input?.wikiLevel);
const fail = () => { throw new Error('DERIVED_SUMMARY_WIKI_VIEW_BINDING_INVALID'); };
const noticesValid = item => typeof item?.current === 'boolean' &&
  ['CURRENT', 'STALE', 'NOT_AVAILABLE'].includes(item.overviewStatus) && Array.isArray(item.limitations) &&
  item.limitations.every(value => typeof value === 'string' && value.trim());

// These are citations inside this exact saved child, not fresh parent reads.
// Unknown refs and refs belonging only to another child remain visible.
const childOwnsSource = (child, ref, registry) => registry.has(ref) &&
  child.evidence.some(evidence => evidence.evidenceRef === ref);
const attributeChildCitations = (text, children, registry) => text.replace(/\[\[([^\]]+)\]\]/gu, (citation, ref) => {
  const owners = children.filter(child => childOwnsSource(child, ref, registry));
  return owners.length ? [...new Set(owners.map(child => `[[${child.evidenceRef}]]`))].join(' ') : citation;
});

/** Detached model text only; immutable Host work and the source registry stay exact. */
export function hierarchicalWikiParentMemberBody(reading, registry) {
  if (reading.member.kind !== 'DERIVED_SUMMARY') fail();
  const own = derivedSummarySparseMemberBody(reading, registry);
  return { ...own, headline: attributeChildCitations(own.headline, [reading], registry),
    body: attributeChildCitations(own.body, [reading], registry),
    limitations: own.limitations.map(text => attributeChildCitations(text, [reading], registry)) };
}

/** All exact child own-bodies, one root directory and no inherited root bodies.
 * The complete eligible registry stays sealed by Host for explicit READ_SOURCES. */
export function hierarchicalWikiParentModelView(modelInput) {
  validateDerivedSummaryModelInput(modelInput);
  if (!isHierarchicalWikiParent(modelInput)) fail();
  const view = structuredClone(modelInput);
  const registry = derivedSummaryRegistry(modelInput);
  view.modelViewStrategy = 'HIERARCHICAL_WIKI_PARENT_V2';
  view.members = modelInput.members.map(reading => hierarchicalWikiParentMemberBody(reading, registry.evidence));
  view.limitations = modelInput.limitations.map(text => attributeChildCitations(text,
    modelInput.members.filter(reading => reading.limitations.includes(text)), registry.evidence));
  view.membersDirectory = view.members.map(({ body, ...directory }) => structuredClone(directory));
  view.evidenceDirectory = [...registry.evidence.values()].map(evidence =>
    Object.fromEntries(['evidenceRef', 'kind', 'title', 'versionLabel', 'workItemId',
      'documentVersionId', 'sourceRefId', 'locator'].filter(key => Object.hasOwn(evidence, key))
      .map(key => [key, structuredClone(evidence[key])])));
  view.evidence = [];
  if (view.revisionContext) {
    const { materialStrategy, ...changes } = view.revisionContext.inputChanges;
    view.revisionContext.inputChanges = { ...changes, eligibleMaterialStrategy: materialStrategy };
  }
  return view;
}

/** Rebuild only from the full sealed input; directories cannot stand in for bodies. */
export function validateHierarchicalWikiParentModelView(view, modelInput, { restoring = false } = {}) {
  const expected = hierarchicalWikiParentModelView(modelInput);
  if (!Array.isArray(view?.members) || !Array.isArray(view.membersDirectory) ||
      [...view.members, ...view.membersDirectory].some(item => !noticesValid(item))) fail();
  const stable = value => {
    const result = structuredClone(value);
    if (restoring) for (const field of ['members', 'membersDirectory'])
      result[field] = result[field].map(({ current, overviewStatus, limitations, ...member }) => member);
    return result;
  };
  if (canonicalJson(stable(view)) !== canonicalJson(stable(expected))) fail();
  return view;
}
