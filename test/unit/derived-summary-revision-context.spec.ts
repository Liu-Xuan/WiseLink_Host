import type {
  DerivedSummaryMember, DerivedSummaryMemberReading, DerivedSummaryPreviousSummary,
  DerivedSummaryPurpose, DerivedSummaryRevision, DerivedSummaryRevisionContext,
  RequestDerivedSummaryUpdate,
} from '@shared/derived-summary.interface';
import { spawnSync } from 'node:child_process';
import { canonicalJson } from '../../server/modules/action-attempt/action-attempt-envelope';
import {
  assertPreviousSummarySnapshot, buildSummaryRevisionContext, previousSummarySnapshot,
} from '../../server/modules/canonical-host/derived-summary-revision-context';

type UpdateInput = RequestDerivedSummaryUpdate & { purpose?: DerivedSummaryPurpose };
const observedAt = '2026-10-08T00:00:00.000Z';
const scope = { kind: 'ATA4' as const, title: 'Synthetic selection', fleetFamilyId: 'SYNTHETIC',
  fleetModelIds: ['SYN-A', 'SYN-B'], ata2: '00', ata4: '00-01', selectionReason: 'Synthetic candidate only' };
const work = (id: string, issueKeys: string[] = ['a', 'b']): Extract<DerivedSummaryMember, { kind: 'WORK_ITEM_WORK' }> => ({
  kind: 'WORK_ITEM_WORK', workItemId: `WI-${id}`, documentVersionId: `DV-${id}`,
  workRef: `WR-${id}`, workRevision: 1, issueKeys,
});
const reading = (member: DerivedSummaryMember, resolved = member.kind === 'DERIVED_SUMMARY' ? [] : member.issueKeys): DerivedSummaryMemberReading => ({
  member, evidenceRef: `member-${member.kind === 'WORK_ITEM_WORK' ? member.workRef : member.kind === 'MATTER_WORK' ? member.workRef : member.summaryRef}`,
  headline: 'Synthetic saved work', body: 'Complete synthetic saved work body',
  issues: resolved.map(issueKey => ({ issueKey, issueRef: `issue-${issueKey}`, question: `Question ${issueKey}`,
    body: `Full candidate explanation ${issueKey}`, riskScenarios: [], measures: [], otherClassifications: [],
    openQuestions: [], requirementHandling: [], sourceDependencies: [], premiseRefs: [] })),
  evidence: [], rootRefs: [], limitations: ['candidate only'], current: true,
  overviewStatus: 'CURRENT', leaves: [member],
});
const saved = (members = [reading(work('old'))]): DerivedSummaryRevision => ({
  summaryId: 'DS-synthetic', summaryRef: 'DSR-synthetic-1', revision: 1, scope,
  classificationStatus: 'CANDIDATE', members,
  content: { headline: 'Prior synthetic candidate', listBrief: 'Prior complete brief',
    body: 'Exact full prior candidate body', limitations: ['prior limitation'] },
  evidence: [], usedEvidenceRefs: [], coverage: [], requestId: 'request-prior',
  attemptRef: 'AQ-prior', createdAt: observedAt, candidateOnly: true,
});
const request = (overrides: Partial<UpdateInput> = {}): UpdateInput => ({
  requestId: 'request-next', expectedSummaryRevision: 1, purpose: 'REVISE_SAVED_SUMMARY',
  scope, members: [work('old')], instruction: 'Revise this synthetic candidate',
  modelRef: 'synthetic-model-label-no-dispatch', ...overrides,
});
const context = (input = request(), prior = saved(), current = [reading(work('old'))], fresh = prior.members) =>
  buildSummaryRevisionContext(input, prior, fresh, current, observedAt);

const validatorScript = `
import { validateDerivedSummaryRevisionContext } from './openclaw/skills/wiselink-research-and-synthesize/scripts/derived-summary-revision-context.mjs';
import { assertSummaryExactKeys, validateDerivedSummaryMember, validateDerivedSummaryModelInput } from './openclaw/skills/wiselink-research-and-synthesize/scripts/derived-summary-shape.mjs';
let bytes = ''; for await (const chunk of process.stdin) bytes += chunk;
const input = JSON.parse(bytes);
const validators = { assertSummaryExactKeys, validateDerivedSummaryMember,
  validateScope: scope => validateDerivedSummaryModelInput({ scope, classificationStatus: 'CANDIDATE',
    instruction: input.instruction, members: input.members, evidence: input.evidence, limitations: [] }) };
validateDerivedSummaryRevisionContext(input, validators);
process.stdout.write('VALID');
`;
function validateOffline(input: UpdateInput, current: DerivedSummaryMemberReading[], revisionContext: DerivedSummaryRevisionContext) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', validatorScript], {
    cwd: process.cwd(), encoding: 'utf8',
    input: JSON.stringify({ scope: input.scope, classificationStatus: 'CANDIDATE', instruction: input.instruction,
      purpose: input.purpose, revisionContext, members: current, evidence: current.flatMap(item => item.evidence), limitations: [] }),
  });
}

describe('isolated deterministic R1 context preparation', () => {
  it('retains the complete prior candidate, changes instruction, and keeps input objects immutable', () => {
    const prior = saved(); const input = request(); const before = canonicalJson({ prior, input });
    const result = context(input, prior);
    expect(result.previousSummary).toMatchObject({ summaryId: prior.summaryId, summaryRef: prior.summaryRef,
      revision: 1, candidateOnly: true, content: prior.content, noticesObservedAt: observedAt });
    expect(result.previousSummary.content).not.toBe(prior.content);
    expect(result.previousSummary).not.toHaveProperty('producer');
    expect(result.previousSummary).not.toHaveProperty('contextBasis');
    expect(result.requestedChange).toEqual({ instruction: input.instruction });
    expect(result.inputChanges).toMatchObject({ basis: 'SAME_SELECTION', materialStrategy: 'FULL_CURRENT_MATERIAL',
      addedMembers: [], removedMembers: [], replacedMembers: [], selectedIssueChanges: [], scope: { changedFields: [] } });
    expect(result.inputChanges.sources.observationKind).toBe('HOST_NOTICES_NOT_PUBLISHER_CHANGE_LOG');
    expect(canonicalJson({ prior, input })).toBe(before);
    result.previousSummary.content.body = 'Isolated local mutation';
    expect(prior.content.body).toBe('Exact full prior candidate body');
  });

  it('reports scope and source ref deltas without turning notices into publisher facts', () => {
    const prior = saved(); prior.members[0]!.rootRefs = ['root-old'];
    const source: Extract<DerivedSummaryMemberReading['evidence'][number], { kind: 'DOCUMENT_PASSAGE' }> = {
      kind: 'DOCUMENT_PASSAGE', evidenceRef: 'source-old', title: 'Synthetic source',
      versionLabel: null, excerpt: 'Synthetic excerpt', workItemId: null, documentVersionId: 'DV-old', sourceRefId: 'SR-old', locator: 'paragraph' };
    prior.evidence = [source];
    const current = reading(work('new')); current.rootRefs = ['root-new'];
    current.evidence = [{ ...source, evidenceRef: 'source-new', documentVersionId: 'DV-new' }];
    const input = request({ members: [current.member], scope: { ...scope, title: 'Changed synthetic scope',
      fleetModelIds: [...scope.fleetModelIds].reverse(), ata4: '00-02' } });
    const result = context(input, prior, [current]);
    expect(result.inputChanges).toMatchObject({ basis: 'CHANGED_SELECTION',
      addedMembers: [current.member], removedMembers: [prior.members[0]!.member],
      scope: { changedFields: ['ata4', 'title'] }, sources: { addedEvidenceRefs: ['source-new'],
        removedEvidenceRefs: ['source-old'], addedRootRefs: ['root-new'], removedRootRefs: ['root-old'] } });
    expect(result.previousSummary.members[0]!.member).toEqual(prior.members[0]!.member);
  });

  it('separates ALL-to-subset and selected issue changes from saved version replacements', () => {
    const prior = saved([reading(work('old', []), ['a', 'b'])]); const selected = work('old', ['a']);
    const result = context(request({ members: [selected] }), prior, [reading(selected)]);
    expect(result.inputChanges.selectedIssueChanges).toEqual([expect.objectContaining({
      previousSelections: [work('old', [])], currentSelections: [selected],
      previousResolvedIssueKeys: ['a', 'b'], currentResolvedIssueKeys: ['a'] })]);
    expect(result.inputChanges.replacedMembers).toEqual([]);
    const replaced: DerivedSummaryMember = { ...selected, workRef: 'WR-new', workRevision: 2 };
    const version = context(request({ members: [replaced] }), prior, [reading(replaced)]);
    expect(version.inputChanges.replacedMembers).toEqual([expect.objectContaining({
      previousMembers: [work('old', [])], currentMembers: [replaced] })]);
    expect(version.inputChanges.selectedIssueChanges).toEqual([]);
  });

  it('normalizes selected issue/model order and uses deterministic multilingual member ordering', () => {
    const reverse = work('old', ['b', 'a']);
    expect(context(request({ members: [reverse], scope: { ...scope, fleetModelIds: ['SYN-B', 'SYN-A'] } }),
      saved(), [reading(reverse)]).inputChanges.basis).toBe('SAME_SELECTION');
    const previous = saved([reading(work('阿')), reading(work('Latin'))]);
    const current = [reading(work('甲')), reading(work('alpha')), reading(work('阿', ['c']))];
    const input = request({ members: current.map(item => item.member) });
    const result = context(input, previous, current);
    const reordered = context({ ...input, members: [...input.members].reverse() }, previous, [...current].reverse());
    expect(canonicalJson(result.inputChanges)).toBe(canonicalJson(reordered.inputChanges));
    expect(result.inputChanges.selectedIssueChanges[0]!.currentResolvedIssueKeys).toEqual(['c']);
  });

  it('groups ambiguous same-subject versions and preserves exact child and Matter identities', () => {
    const a: DerivedSummaryMember = { kind: 'MATTER_WORK', matterId: 'M-synthetic', workRef: 'M-old', workRevision: 1, issueKeys: [] };
    const b: DerivedSummaryMember = { ...a, workRef: 'M-other', workRevision: 2 };
    const replacement: DerivedSummaryMember = { ...a, workRef: 'M-new', workRevision: 3 };
    const child: DerivedSummaryMember = { kind: 'DERIVED_SUMMARY', summaryId: 'DS-child', summaryRef: 'DSR-child-exact', summaryRevision: 4 };
    const prior = saved([reading(a), reading(b), reading(child)]);
    const current = [reading(replacement), reading(child)]; const result = context(request({ members: current.map(item => item.member) }), prior, current);
    expect(result.inputChanges.replacedMembers).toHaveLength(1);
    expect(result.inputChanges.replacedMembers[0]!.previousMembers).toHaveLength(2);
    expect(result.previousSummary.members[2]!.member).toEqual(child);
    expect(result.inputChanges.removedMembers).not.toContainEqual(child);
  });

  it('retains fresh notice observations separately from immutable prior snapshot data', () => {
    const prior = saved(); const snapshot = previousSummarySnapshot(prior, prior.members, observedAt);
    const fresh = [{ ...prior.members[0]!, current: false, overviewStatus: 'STALE' as const, limitations: ['fresh Host notice'] }];
    expect(() => assertPreviousSummarySnapshot(snapshot, prior, fresh)).not.toThrow();
    const changed = { ...prior, content: { ...prior.content, body: 'Changed exact saved body' } };
    expect(() => assertPreviousSummarySnapshot(snapshot, changed, fresh)).toThrow('DERIVED_SUMMARY_PRIOR_CONTENT_CHANGED');
    const unexpected: DerivedSummaryPreviousSummary & { surprise: true } = { ...snapshot, surprise: true };
    expect(() => assertPreviousSummarySnapshot(unexpected, prior, fresh)).toThrow('DERIVED_SUMMARY_PRIOR_CONTENT_CHANGED');
  });

  it.each([undefined, 'SYNTHESIZE'] as const)('rejects non-revision purpose %s without parser/service activation', purpose => {
    expect(() => context(request({ purpose }))).toThrow('DERIVED_SUMMARY_PRIOR_REQUIRED');
  });

  it('rejects wrong prior revision and missing fresh prior notices', () => {
    expect(() => context(request({ expectedSummaryRevision: 2 }))).toThrow('DERIVED_SUMMARY_PRIOR_REQUIRED');
    expect(() => context(request(), saved(), [reading(work('old'))], [])).toThrow('DERIVED_SUMMARY_PERSISTENCE_INVALID');
  });

  it.each(['same', 'changed', 'subset', 'multilingual', 'child'] as const)('JSON parity: TS %s output is accepted by independent MJS validator', kind => {
    const prior = kind === 'subset' ? saved([reading(work('old', []), ['a', 'b'])]) : saved();
    const member: DerivedSummaryMember = kind === 'changed' ? work('new') : kind === 'subset' ? work('old', ['a'])
      : kind === 'multilingual' ? work('甲', ['新问题']) : kind === 'child'
        ? { kind: 'DERIVED_SUMMARY', summaryId: 'DS-child', summaryRef: 'DSR-child', summaryRevision: 2 } : work('old');
    const current = [reading(member)]; const input = request({ members: [member] });
    const result = validateOffline(input, current, context(input, prior, current));
    expect(result.status).toBe(0); expect(result.stdout).toBe('VALID'); expect(result.stderr).toBe('');
  });

  it('independent MJS rejects a tampered deterministic delta from TS', () => {
    const input = request(); const current = [reading(work('old'))]; const result = context(input);
    result.inputChanges.sources.addedRootRefs.push('unregistered-root');
    const checked = validateOffline(input, current, result);
    expect(checked.status).not.toBe(0); expect(checked.stderr).toContain('DERIVED_SUMMARY_REVISION_CONTEXT_INVALID');
  });
});
