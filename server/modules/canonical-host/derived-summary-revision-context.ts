import type {
  DerivedSummaryMember, DerivedSummaryMemberReading, DerivedSummaryPreviousSummary, DerivedSummaryRevision,
  DerivedSummaryRevisionContext, DerivedSummaryScopeSelection, DerivedSummaryPurpose, RequestDerivedSummaryUpdate,
} from '@shared/derived-summary.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { summaryError } from './derived-summary.validation';

const sorted = (values: string[]) => [...new Set(values)].sort();
const selectionKey = (member: DerivedSummaryMember) => canonicalJson(member.kind === 'DERIVED_SUMMARY'
  ? member : { ...member, issueKeys: sorted(member.issueKeys) });
const ordered = (members: DerivedSummaryMember[]) => [...members].sort((a, b) => (selectionKey(a) < selectionKey(b) ? -1 : selectionKey(a) > selectionKey(b) ? 1 : 0));
const subjectKey = (member: DerivedSummaryMember) => canonicalJson({ kind: member.kind, subjectId:
  member.kind === 'WORK_ITEM_WORK' ? member.workItemId : member.kind === 'MATTER_WORK' ? member.matterId : member.summaryId });
const savedMemberKey = (member: DerivedSummaryMember) => {
  if (member.kind === 'DERIVED_SUMMARY') return canonicalJson(member);
  const { issueKeys: _issues, ...identity } = member;
  return canonicalJson(identity);
};
const notice = (member: DerivedSummaryMemberReading) => ({ current: member.current,
  overviewStatus: member.overviewStatus, limitations: [...member.limitations] });
const grouped = (members: DerivedSummaryMember[], key: (member: DerivedSummaryMember) => string) => {
  const result = new Map<string, DerivedSummaryMember[]>();
  for (const member of ordered(members)) result.set(key(member), [...(result.get(key(member)) ?? []), member]);
  return result;
};
const resolvedIssues = (readings: DerivedSummaryMemberReading[], key: string) => sorted(readings
  .filter(item => savedMemberKey(item.member) === key).flatMap(item => item.issues.map(issue => issue.issueKey)));
const equalSelections = (before: DerivedSummaryMember[], after: DerivedSummaryMember[]) =>
  canonicalJson(before.map(selectionKey).sort()) === canonicalJson(after.map(selectionKey).sort());

/** Snapshot carries the complete prior candidate once, source identities only. */
export function previousSummarySnapshot(saved: DerivedSummaryRevision, fresh: DerivedSummaryMemberReading[],
  observedAt: string): DerivedSummaryPreviousSummary {
  if (fresh.length !== saved.members.length || saved.classificationStatus !== 'CANDIDATE' || saved.candidateOnly !== true)
    throw summaryError('DERIVED_SUMMARY_PERSISTENCE_INVALID');
  return structuredClone({ summaryId: saved.summaryId, summaryRef: saved.summaryRef, revision: saved.revision,
    candidateOnly: true as const, content: saved.content, scope: saved.scope,
    members: saved.members.map(item => ({ member: item.member, evidenceRef: item.evidenceRef,
      resolvedIssueKeys: sorted(item.issues.map(issue => issue.issueKey)), rootRefs: sorted(item.rootRefs) })),
    evidenceRefs: sorted(saved.evidence.map(item => item.evidenceRef)),
    rootRefs: sorted(saved.members.flatMap(item => item.rootRefs)), usedEvidenceRefs: sorted(saved.usedEvidenceRefs),
    noticesObservedAt: observedAt, memberNotices: fresh.map(item => ({ member: item.member, ...notice(item) })) });
}

/** Compare immutable prior data; fresh currentness may change after request sealing. */
export function assertPreviousSummarySnapshot(previous: DerivedSummaryPreviousSummary, saved: DerivedSummaryRevision,
  fresh: DerivedSummaryMemberReading[]): void {
  const immutable = ({ memberNotices: _notices, noticesObservedAt: _at, ...value }: DerivedSummaryPreviousSummary) => value;
  if (canonicalJson(immutable(previous)) !== canonicalJson(immutable(previousSummarySnapshot(saved, fresh, previous.noticesObservedAt))))
    throw summaryError('DERIVED_SUMMARY_PRIOR_CONTENT_CHANGED');
}

/** Deterministic selected identities and Host observations, never a manufacturer text diff. */
export function buildSummaryRevisionContext(input: RequestDerivedSummaryUpdate & { purpose?: DerivedSummaryPurpose }, saved: DerivedSummaryRevision,
  freshPrior: DerivedSummaryMemberReading[], current: DerivedSummaryMemberReading[], observedAt: string): DerivedSummaryRevisionContext {
  if (input.purpose !== 'REVISE_SAVED_SUMMARY' || saved.revision !== input.expectedSummaryRevision)
    throw summaryError('DERIVED_SUMMARY_PRIOR_REQUIRED', 400);
  const before = saved.members.map(item => item.member);
  const after = current.map(item => item.member);
  const beforeKeys = new Set(before.map(selectionKey)); const afterKeys = new Set(after.map(selectionKey));
  const oldSubjects = grouped(before, subjectKey); const newSubjects = grouped(after, subjectKey);
  const replacedMembers = [...oldSubjects.keys()].filter(key => newSubjects.has(key)).sort().flatMap(key => {
    const previousMembers = oldSubjects.get(key)!; const currentMembers = newSubjects.get(key)!;
    if (canonicalJson(sorted(previousMembers.map(savedMemberKey))) === canonicalJson(sorted(currentMembers.map(savedMemberKey)))) return [];
    return [{ subjectKey: key, previousMembers, currentMembers }];
  });
  const oldSaved = grouped(before, savedMemberKey); const newSaved = grouped(after, savedMemberKey);
  const selectedIssueChanges = [...oldSaved.keys()].filter(key => newSaved.has(key)).sort().flatMap(key => {
    const previousSelections = oldSaved.get(key)!; const currentSelections = newSaved.get(key)!;
    if (equalSelections(previousSelections, currentSelections)) return [];
    return [{ savedMemberKey: key, previousSelections, currentSelections,
      previousResolvedIssueKeys: resolvedIssues(saved.members, key), currentResolvedIssueKeys: resolvedIssues(current, key) }];
  });
  const changedFields = (Object.keys(saved.scope) as Array<keyof DerivedSummaryScopeSelection>).sort().filter(key =>
    canonicalJson(key === 'fleetModelIds' ? sorted(saved.scope.fleetModelIds) : saved.scope[key]) !==
    canonicalJson(key === 'fleetModelIds' ? sorted(input.scope.fleetModelIds) : input.scope[key]));
  const previousEvidence = sorted(saved.evidence.map(item => item.evidenceRef));
  const currentEvidence = sorted(current.flatMap(item => item.evidence.map(source => source.evidenceRef)));
  const previousRoots = sorted(saved.members.flatMap(item => item.rootRefs)); const currentRoots = sorted(current.flatMap(item => item.rootRefs));
  return structuredClone({ previousSummary: previousSummarySnapshot(saved, freshPrior, observedAt),
    requestedChange: { instruction: input.instruction }, inputChanges: {
      basis: equalSelections(before, after) && !changedFields.length ? 'SAME_SELECTION' : 'CHANGED_SELECTION',
      materialStrategy: 'FULL_CURRENT_MATERIAL',
      addedMembers: ordered(after.filter(member => !beforeKeys.has(selectionKey(member)))),
      removedMembers: ordered(before.filter(member => !afterKeys.has(selectionKey(member)))), replacedMembers, selectedIssueChanges,
      scope: { previous: saved.scope, current: input.scope, changedFields },
      sources: { addedEvidenceRefs: currentEvidence.filter(ref => !previousEvidence.includes(ref)),
        removedEvidenceRefs: previousEvidence.filter(ref => !currentEvidence.includes(ref)),
        addedRootRefs: currentRoots.filter(ref => !previousRoots.includes(ref)), removedRootRefs: previousRoots.filter(ref => !currentRoots.includes(ref)),
        observationKind: 'HOST_NOTICES_NOT_PUBLISHER_CHANGE_LOG',
        priorMemberNotices: saved.members.map((item, index) => ({ member: item.member, saved: notice(item), current: notice(freshPrior[index]!) })) },
    } });
}
