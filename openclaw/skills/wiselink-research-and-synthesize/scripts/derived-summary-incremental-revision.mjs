import { summaryNativeReceiptFields, summaryEvidenceRefs } from './derived-summary-native-evidence.mjs';
import { canonicalJson } from './validate-payload.mjs';
import { completeDerivedSummaryWorkBody, derivedSummaryRegistry, validateDerivedSummaryContent,
  validateDerivedSummaryModelInput, validateDerivedSummaryReading } from './derived-summary-shape.mjs';

const fail = () => { throw new Error('DERIVED_SUMMARY_SPARSE_VIEW_BINDING_INVALID'); };
const sorted = values => [...new Set(values)].sort();
const memberKey = member => canonicalJson(member.kind === 'DERIVED_SUMMARY'
  ? member : { ...member, issueKeys: sorted(member.issueKeys) });
const noticesValid = item => typeof item?.current === 'boolean' &&
  ['CURRENT', 'STALE', 'NOT_AVAILABLE'].includes(item.overviewStatus) && Array.isArray(item.limitations) &&
  item.limitations.every(value => typeof value === 'string' && value.trim());

/** Complete saved own-body, with references only. Root delivery is independent. */
export function derivedSummarySparseMemberBody(reading) {
  validateDerivedSummaryReading(reading);
  const { evidence, body, ...member } = reading;
  return { ...member, ...(!Object.hasOwn(reading, 'understanding') ? { body } : {}),
    evidenceRefs: summaryEvidenceRefs(evidence), ...summaryNativeReceiptFields(evidence) };
}

/** No target guessing, truncation, first-N or instruction-keyword selection.
 * Exact additions/replacements/issue changes plus explicitly supplied refs are
 * the only initial bodies. Ordinary same-selection free text starts at prior. */
export function derivedSummarySparseRevisionModelView(modelInput, { initialMemberRefs = [], initialSourceRefs = [] } = {}) {
  validateDerivedSummaryModelInput(modelInput);
  if (modelInput.purpose !== 'REVISE_SAVED_SUMMARY') fail();
  const registry = derivedSummaryRegistry(modelInput);
  for (const [refs, allowed] of [[initialMemberRefs, registry.members], [initialSourceRefs, registry.evidence]]) {
    if (!Array.isArray(refs) || new Set(refs).size !== refs.length || refs.some(ref => !allowed.has(ref))) fail();
  }
  const changes = modelInput.revisionContext.inputChanges;
  const changedKeys = new Set([...changes.addedMembers,
    ...changes.replacedMembers.flatMap(item => item.currentMembers),
    ...changes.selectedIssueChanges.flatMap(item => item.currentSelections)].map(memberKey));
  const selected = new Set(initialMemberRefs);
  const view = structuredClone(modelInput);
  view.modelViewStrategy = 'SPARSE_REVISION_V1';
  const { materialStrategy, ...inputChanges } = view.revisionContext.inputChanges;
  view.revisionContext.inputChanges = { ...inputChanges, eligibleMaterialStrategy: materialStrategy };
  view.membersDirectory = modelInput.members.map(reading => {
    const { body, understanding, evidence, issues, ...directory } = reading;
    return { ...structuredClone(directory), issues: issues.map(issue => ({ issueKey: issue.issueKey,
      ...(Object.hasOwn(issue, 'issueRef') ? { issueRef: issue.issueRef } : {}), question: issue.question })),
      evidenceRefs: summaryEvidenceRefs(evidence), ...summaryNativeReceiptFields(evidence) };
  });
  view.evidenceDirectory = [...registry.evidence.values()].map(({ excerpt, ...directory }) => structuredClone(directory));
  view.members = modelInput.members.filter(reading => selected.has(reading.evidenceRef) ||
    changedKeys.has(memberKey(reading.member))).map(derivedSummarySparseMemberBody);
  view.evidence = initialSourceRefs.map(ref => structuredClone(registry.evidence.get(ref)));
  return view;
}

/** Validate against the complete eligible registry, never invert a directory as
 * a full Reading. Restoring preserves original messages, including old notices. */
export function validateDerivedSummarySparseRevisionModelView(view, modelInput, options = {}) {
  const expected = derivedSummarySparseRevisionModelView(modelInput, options);
  if (!Array.isArray(view?.members) || !Array.isArray(view.membersDirectory) ||
      [...view.members, ...view.membersDirectory].some(item => !noticesValid(item))) fail();
  const stable = value => {
    const result = structuredClone(value);
    if (options.restoring) {
      for (const field of ['members', 'membersDirectory']) result[field] = result[field].map(
        ({ current, overviewStatus, limitations, ...member }) => member);
    }
    return result;
  };
  if (canonicalJson(stable(view)) !== canonicalJson(stable(expected))) fail();
  return view;
}

const citations = content => [...`${content.headline}\n${content.listBrief}\n${content.body}\n${content.limitations.join('\n')}`
  .matchAll(/\[\[([^\]]+)\]\]/gu)].map(match => match[1]);

/** This consumes trusted Host-sealed prior/current bindings. The existing Host
 * checkRevision/taskEvidence/mergeSummaryEvidence chain reauthorizes and rejects
 * same-ref source content drift; refs alone are not a new local version proof.
 * Member reuse additionally preserves exact selected immutable work and issues.
 * Reuse is derived prior context, never a claim of fresh source-body delivery. */
export function hostBoundPriorDerivedSummaryRefs(modelInput) {
  validateDerivedSummaryModelInput(modelInput);
  const refs = new Set();
  if (modelInput.purpose !== 'REVISE_SAVED_SUMMARY') return refs;
  const prior = modelInput.revisionContext.previousSummary;
  const registry = derivedSummaryRegistry(modelInput);
  const cited = new Set(citations(prior.content).filter(ref => prior.usedEvidenceRefs.includes(ref)));
  for (const old of prior.members) {
    const current = registry.members.get(old.evidenceRef);
    if (cited.has(old.evidenceRef) && current && memberKey(old.member) === memberKey(current.member) &&
        canonicalJson(sorted(old.resolvedIssueKeys)) === canonicalJson(sorted(current.issues.map(issue => issue.issueKey))) &&
        canonicalJson(sorted(old.rootRefs)) === canonicalJson(sorted(current.rootRefs))) refs.add(old.evidenceRef);
  }
  for (const ref of prior.evidenceRefs) if (cited.has(ref) && registry.evidence.has(ref)) refs.add(ref);
  return refs;
}

/** Registration/driver-body checks do not establish semantic correctness. A
 * factual edit still needs the main model's necessary work/root reads and eval. */
export function validateDerivedSummarySparseContent(content, modelInput, { delivered, priorReusableRefs }) {
  validateDerivedSummaryContent(content, modelInput);
  if (!delivered?.members || !delivered?.evidence || !(priorReusableRefs instanceof Set)) fail();
  for (const ref of citations(content)) if (!delivered.members.has(ref) && !delivered.evidence.has(ref) &&
      !priorReusableRefs.has(ref)) throw new Error('DERIVED_SUMMARY_CITATION_REQUIRES_READ');
  return content;
}

export function derivedSummarySparseDiagnostics(content, delivered, priorReusableRefs) {
  const reused = sorted(citations(content).filter(ref => priorReusableRefs.has(ref) &&
    !delivered.members.has(ref) && !delivered.evidence.has(ref)));
  return { effectiveInput: 'UNKNOWN', priorDerivedReuseRefs: reused,
    priorDerivedReuseIsNotFreshSourceRead: true,
    memberOwnBodyDelivered: [...delivered.members].map(([evidenceRef, item]) => ({ evidenceRef, contentLocation: structuredClone(item.location) })),
    sourceBodyDelivered: [...delivered.evidence].map(([evidenceRef, item]) => ({ evidenceRef, contentLocation: structuredClone(item.location) })) };
}
