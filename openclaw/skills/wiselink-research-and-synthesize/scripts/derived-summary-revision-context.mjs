import { canonicalJson } from './validate-payload.mjs';

const fail = () => { throw new Error('DERIVED_SUMMARY_REVISION_CONTEXT_INVALID'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const texts = value => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
const sorted = values => [...new Set(values)].sort();
const key = member => canonicalJson(!('issueKeys' in member) ? member : { ...member, issueKeys: sorted(member.issueKeys) });
const ordered = members => [...members].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
const subjectKey = member => canonicalJson({ kind: member.kind, subjectId: member.kind === 'WORK_ITEM_WORK'
  ? member.workItemId : member.kind === 'MATTER_WORK' ? member.matterId :
    member.kind === 'DOCUMENT_READING' ? member.documentVersionId : member.summaryId });
const savedKey = member => { const { issueKeys, ...identity } = member; return canonicalJson(identity); };
const group = (members, by) => { const result = new Map();
  for (const member of ordered(members)) result.set(by(member), [...(result.get(by(member)) ?? []), member]); return result; };
const selectionsEqual = (a, b) => canonicalJson(a.map(key).sort()) === canonicalJson(b.map(key).sort());
const notices = value => object(value) && typeof value.current === 'boolean' &&
  ['CURRENT', 'STALE', 'NOT_AVAILABLE'].includes(value.overviewStatus) && Array.isArray(value.limitations) && value.limitations.every(text);

/** Prior is never registered as a READ/SAVE source. Validate deterministic identity changes. */
export function validateDerivedSummaryRevisionContext(modelInput, validators) {
  const { assertSummaryExactKeys: exact, validateDerivedSummaryMember: member, validateScope } = validators;
  const purpose = modelInput.purpose ?? 'SYNTHESIZE';
  if (!['SYNTHESIZE', 'REVISE_SAVED_SUMMARY'].includes(purpose)) fail();
  if (purpose === 'SYNTHESIZE') { if (Object.hasOwn(modelInput, 'revisionContext')) fail(); return; }
  const context = modelInput.revisionContext;
  exact(context, ['previousSummary', 'requestedChange', 'inputChanges'], 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID');
  exact(context.requestedChange, ['instruction'], 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID');
  if (context.requestedChange.instruction !== modelInput.instruction || !text(context.requestedChange.instruction)) fail();
  const prior = context.previousSummary;
  exact(prior, ['summaryId', 'summaryRef', 'revision', 'candidateOnly', 'content', 'scope', 'members',
    'evidenceRefs', 'rootRefs', 'usedEvidenceRefs', 'noticesObservedAt', 'memberNotices'], 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID');
  if (!text(prior.summaryId) || !text(prior.summaryRef) || !Number.isSafeInteger(prior.revision) || prior.revision < 1 ||
    prior.candidateOnly !== true || !Number.isFinite(Date.parse(prior.noticesObservedAt)) || !Array.isArray(prior.members) ||
    !prior.members.length || !texts(prior.evidenceRefs) || !texts(prior.rootRefs) || !texts(prior.usedEvidenceRefs) ||
    !Array.isArray(prior.memberNotices) || prior.memberNotices.length !== prior.members.length) fail();
  exact(prior.content, ['headline', 'listBrief', 'body', 'limitations'], 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID');
  if (![prior.content.headline, prior.content.listBrief, prior.content.body].every(text) ||
    !Array.isArray(prior.content.limitations) || !prior.content.limitations.every(text)) fail();
  validateScope(prior.scope);
  for (const [index, item] of prior.members.entries()) {
    exact(item, ['member', 'evidenceRef', 'resolvedIssueKeys', 'rootRefs'], 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID');
    member(item.member);
    if (!text(item.evidenceRef) || !texts(item.resolvedIssueKeys) || !texts(item.rootRefs)) fail();
    const fresh = prior.memberNotices[index];
    exact(fresh, ['member', 'current', 'overviewStatus', 'limitations'], 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID');
    member(fresh.member); if (!notices(fresh) || canonicalJson(fresh.member) !== canonicalJson(item.member)) fail();
  }
  const priorRefs = new Set([...prior.evidenceRefs, ...prior.members.map(item => item.evidenceRef)]);
  if (new Set(prior.members.map(item => item.evidenceRef)).size !== prior.members.length ||
    prior.usedEvidenceRefs.some(ref => !priorRefs.has(ref)) ||
    canonicalJson(prior.rootRefs) !== canonicalJson(sorted(prior.members.flatMap(item => item.rootRefs)))) fail();
  const changes = context.inputChanges;
  exact(changes, ['basis', 'materialStrategy', 'addedMembers', 'removedMembers', 'replacedMembers',
    'selectedIssueChanges', 'scope', 'sources'], 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID');
  exact(changes.scope, ['previous', 'current', 'changedFields'], 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID');
  const sources = changes.sources;
  exact(sources, ['addedEvidenceRefs', 'removedEvidenceRefs', 'addedRootRefs', 'removedRootRefs',
    'observationKind', 'priorMemberNotices'], 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID');
  if (sources.observationKind !== 'HOST_NOTICES_NOT_PUBLISHER_CHANGE_LOG' || !Array.isArray(sources.priorMemberNotices) ||
    sources.priorMemberNotices.length !== prior.members.length) fail();
  for (const [index, item] of sources.priorMemberNotices.entries()) {
    exact(item, ['member', 'saved', 'current'], 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID');
    exact(item.saved, ['current', 'overviewStatus', 'limitations'], 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID');
    exact(item.current, ['current', 'overviewStatus', 'limitations'], 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID');
    const { member: _member, ...fresh } = prior.memberNotices[index];
    if (!notices(item.saved) || !notices(item.current) || canonicalJson(item.member) !== canonicalJson(prior.members[index].member) ||
      canonicalJson(item.current) !== canonicalJson(fresh)) fail();
  }
  const before = prior.members.map(item => item.member); const after = modelInput.members.map(item => item.member);
  const beforeSet = new Set(before.map(key)); const afterSet = new Set(after.map(key));
  const oldSubjects = group(before, subjectKey); const newSubjects = group(after, subjectKey);
  const replaced = [...oldSubjects.keys()].filter(key => newSubjects.has(key)).sort().flatMap(key => {
    const previousMembers = oldSubjects.get(key); const currentMembers = newSubjects.get(key);
    return canonicalJson(sorted(previousMembers.map(savedKey))) === canonicalJson(sorted(currentMembers.map(savedKey)))
      ? [] : [{ subjectKey: key, previousMembers, currentMembers }];
  });
  const oldSaved = group(before, savedKey); const newSaved = group(after, savedKey);
  const issues = [...oldSaved.keys()].filter(key => newSaved.has(key)).sort().flatMap(identity => {
    const previousSelections = oldSaved.get(identity); const currentSelections = newSaved.get(identity);
    if (selectionsEqual(previousSelections, currentSelections)) return [];
    return [{ savedMemberKey: identity, previousSelections, currentSelections,
      previousResolvedIssueKeys: sorted(prior.members.filter(item => savedKey(item.member) === identity).flatMap(item => item.resolvedIssueKeys)),
      currentResolvedIssueKeys: sorted(modelInput.members.filter(item => savedKey(item.member) === identity).flatMap(item => item.issues.map(issue => issue.issueKey))) }];
  });
  const changedFields = Object.keys(prior.scope).sort().filter(field => canonicalJson(field === 'fleetModelIds'
    ? sorted(prior.scope.fleetModelIds) : prior.scope[field]) !== canonicalJson(field === 'fleetModelIds'
    ? sorted(modelInput.scope.fleetModelIds) : modelInput.scope[field]));
  const evidence = sorted(modelInput.evidence.map(item => item.evidenceRef)); const roots = sorted(modelInput.members.flatMap(item => item.rootRefs));
  const expected = { basis: selectionsEqual(before, after) && !changedFields.length ? 'SAME_SELECTION' : 'CHANGED_SELECTION',
    materialStrategy: 'FULL_CURRENT_MATERIAL', addedMembers: ordered(after.filter(item => !beforeSet.has(key(item)))),
    removedMembers: ordered(before.filter(item => !afterSet.has(key(item)))), replacedMembers: replaced, selectedIssueChanges: issues,
    scope: { previous: prior.scope, current: modelInput.scope, changedFields }, sources: {
      addedEvidenceRefs: evidence.filter(ref => !prior.evidenceRefs.includes(ref)), removedEvidenceRefs: prior.evidenceRefs.filter(ref => !evidence.includes(ref)),
      addedRootRefs: roots.filter(ref => !prior.rootRefs.includes(ref)), removedRootRefs: prior.rootRefs.filter(ref => !roots.includes(ref)),
      observationKind: sources.observationKind, priorMemberNotices: sources.priorMemberNotices } };
  if (canonicalJson(changes) !== canonicalJson(expected)) fail();
}
