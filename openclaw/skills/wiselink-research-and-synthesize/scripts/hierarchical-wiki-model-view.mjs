import { canonicalJson } from './validate-payload.mjs';
import { derivedSummaryRegistry, validateDerivedSummaryModelInput } from './derived-summary-shape.mjs';
import { derivedSummarySparseMemberBody } from './derived-summary-incremental-revision.mjs';

// The child-only prompt remains byte-identical for sealed tasks. ATA2 with
// direct saved leaves uses the existing full-material/revision consumer, whose
// prompt supports both leaf work and summaries without suppressing either.
export const isHierarchicalWikiParent = input => ['ATA2', 'FLEET'].includes(input?.wikiLevel) &&
  Array.isArray(input.members) && input.members.every(reading => reading.member.kind === 'DERIVED_SUMMARY');
const fail = () => { throw new Error('DERIVED_SUMMARY_WIKI_VIEW_BINDING_INVALID'); };
const noticesValid = item => typeof item?.current === 'boolean' &&
  ['CURRENT', 'STALE', 'NOT_AVAILABLE'].includes(item.overviewStatus) && Array.isArray(item.limitations) &&
  item.limitations.every(value => typeof value === 'string' && value.trim());

/** All exact child own-bodies, one root directory and no inherited root bodies.
 * The complete eligible registry stays sealed by Host for explicit READ_SOURCES. */
export function hierarchicalWikiParentModelView(modelInput) {
  validateDerivedSummaryModelInput(modelInput);
  if (!isHierarchicalWikiParent(modelInput)) fail();
  const view = structuredClone(modelInput);
  const registry = derivedSummaryRegistry(modelInput);
  view.modelViewStrategy = 'HIERARCHICAL_WIKI_PARENT_V1';
  view.members = modelInput.members.map(reading => derivedSummarySparseMemberBody(reading, registry.evidence));
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
