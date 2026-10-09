import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDerivedSummaryRevisionContext } from '../scripts/derived-summary-revision-context.mjs';
import { assertSummaryExactKeys, validateDerivedSummaryMember, validateDerivedSummaryModelInput } from '../scripts/derived-summary-shape.mjs';
import { canonicalJson } from '../scripts/validate-payload.mjs';

const scope = { kind: 'ATA4', title: 'Synthetic scope', fleetFamilyId: 'SYNTHETIC', fleetModelIds: ['SYN-A'],
  ata2: '00', ata4: '00-01', selectionReason: 'Synthetic candidate only' };
const member = { kind: 'WORK_ITEM_WORK', workItemId: 'WI-synthetic', documentVersionId: 'DV-synthetic',
  workRef: 'WR-synthetic', workRevision: 1, issueKeys: [] };
const reading = { member, evidenceRef: 'member-WR-synthetic', headline: 'Synthetic work', body: 'Complete synthetic work',
  issues: [], evidence: [], rootRefs: ['root-synthetic'], limitations: ['candidate only'], current: true, overviewStatus: 'CURRENT', leaves: [member] };
const source = { kind: 'DOCUMENT_PASSAGE', evidenceRef: 'source-synthetic', title: 'Synthetic source', versionLabel: null,
  excerpt: 'Synthetic source excerpt', workItemId: null, documentVersionId: 'DV-synthetic', sourceRefId: 'SR-synthetic', locator: 'paragraph' };
const currentNotice = { current: true, overviewStatus: 'CURRENT', limitations: ['candidate only'] };
const prior = { summaryId: 'DS-synthetic', summaryRef: 'DSR-exact-1', revision: 1, candidateOnly: true,
  content: { headline: 'Prior candidate', listBrief: 'Complete prior brief', body: 'Exact complete prior body', limitations: ['prior caveat'] },
  scope, members: [{ member, evidenceRef: reading.evidenceRef, resolvedIssueKeys: [], rootRefs: reading.rootRefs }],
  evidenceRefs: [source.evidenceRef], rootRefs: reading.rootRefs, usedEvidenceRefs: [source.evidenceRef],
  noticesObservedAt: '2026-10-08T00:00:00.000Z', memberNotices: [{ member, ...currentNotice }] };
const context = { previousSummary: prior, requestedChange: { instruction: 'Revise synthetic candidate' },
  inputChanges: { basis: 'SAME_SELECTION', materialStrategy: 'FULL_CURRENT_MATERIAL', addedMembers: [], removedMembers: [],
    replacedMembers: [], selectedIssueChanges: [], scope: { previous: scope, current: scope, changedFields: [] },
    sources: { addedEvidenceRefs: [], removedEvidenceRefs: [], addedRootRefs: [], removedRootRefs: [],
      observationKind: 'HOST_NOTICES_NOT_PUBLISHER_CHANGE_LOG', priorMemberNotices: [{ member, saved: currentNotice, current: currentNotice }] } } };
const model = () => structuredClone({ scope, classificationStatus: 'CANDIDATE', instruction: 'Revise synthetic candidate',
  purpose: 'REVISE_SAVED_SUMMARY', revisionContext: context, members: [reading], evidence: [source], limitations: [] });
function validate(input) {
  const validators = { assertSummaryExactKeys, validateDerivedSummaryMember,
    validateScope: scope => validateDerivedSummaryModelInput({ scope, classificationStatus: 'CANDIDATE',
      instruction: input.instruction, members: input.members, evidence: input.evidence, limitations: [] }) };
  return validateDerivedSummaryRevisionContext(input, validators);
}

test('ordinary synthesis with omitted or explicit purpose remains byte-identical and needs no revision context', () => {
  for (const purpose of [undefined, 'SYNTHESIZE']) {
    const input = model(); delete input.revisionContext;
    if (purpose === undefined) delete input.purpose; else input.purpose = purpose;
    const before = JSON.stringify(input); validate(input); assert.equal(JSON.stringify(input), before);
  }
});

test('ordinary synthesis rejects revision context, and unknown purpose is never inferred', () => {
  for (const purpose of ['SYNTHESIZE', 'unknown']) {
    const input = model(); input.purpose = purpose;
    assert.throws(() => validate(input), { message: 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID' });
  }
});

test('exact full prior candidate survives JSON transport without mutation or source registry expansion', () => {
  const input = JSON.parse(JSON.stringify(model())); const before = canonicalJson(input);
  validate(input); assert.equal(canonicalJson(input), before);
  assert.equal(input.revisionContext.previousSummary.content.body, 'Exact complete prior body');
  assert.deepEqual(input.evidence.map(item => item.evidenceRef), ['source-synthetic']);
  assert.equal(input.revisionContext.inputChanges.sources.observationKind, 'HOST_NOTICES_NOT_PUBLISHER_CHANGE_LOG');
});

test('fresh notice changes remain Host observations independent from immutable prior content', () => {
  const input = model(); const current = { current: false, overviewStatus: 'STALE', limitations: ['new Host notice'] };
  input.revisionContext.previousSummary.memberNotices[0] = { member, ...current };
  input.revisionContext.inputChanges.sources.priorMemberNotices[0].current = current;
  validate(input); assert.equal(input.revisionContext.previousSummary.content.body, prior.content.body);
  assert.deepEqual(input.revisionContext.inputChanges.sources.priorMemberNotices[0].saved, currentNotice);
});

test('changed source/scope selection has exact deterministic added and removed refs', () => {
  const input = model(); const nextScope = { ...scope, title: 'Changed scope' };
  const nextMember = { ...member, workRef: 'WR-next', workRevision: 2 };
  input.scope = nextScope; input.members = [{ ...reading, member: nextMember, evidenceRef: 'member-WR-next', rootRefs: ['root-next'], leaves: [nextMember] }];
  input.evidence = [{ ...source, evidenceRef: 'source-next' }];
  const changes = input.revisionContext.inputChanges;
  changes.basis = 'CHANGED_SELECTION'; changes.addedMembers = [nextMember]; changes.removedMembers = [member];
  changes.replacedMembers = [{ subjectKey: canonicalJson({ kind: member.kind, subjectId: member.workItemId }), previousMembers: [member], currentMembers: [nextMember] }];
  changes.scope = { previous: scope, current: nextScope, changedFields: ['title'] };
  Object.assign(changes.sources, { addedEvidenceRefs: ['source-next'], removedEvidenceRefs: ['source-synthetic'], addedRootRefs: ['root-next'], removedRootRefs: ['root-synthetic'] });
  validate(input);
  assert.deepEqual(input.revisionContext.previousSummary.members[0].member, member);
});

const malformed = [
  ['missing revision context', value => { delete value.revisionContext; }],
  ['unexpected context field', value => { value.revisionContext.extra = true; }],
  ['nested prior context', value => { value.revisionContext.previousSummary.revisionContext = {}; }],
  ['wrong prior candidate marker', value => { value.revisionContext.previousSummary.candidateOnly = false; }],
  ['zero prior revision', value => { value.revisionContext.previousSummary.revision = 0; }],
  ['fractional prior revision', value => { value.revisionContext.previousSummary.revision = 1.5; }],
  ['missing exact prior body', value => { delete value.revisionContext.previousSummary.content.body; }],
  ['invalid notice timestamp', value => { value.revisionContext.previousSummary.noticesObservedAt = 'not-a-time'; }],
  ['foreign notice member', value => { value.revisionContext.previousSummary.memberNotices[0].member = { ...member, workRef: 'WR-foreign' }; }],
  ['invalid notice enum', value => { value.revisionContext.previousSummary.memberNotices[0].overviewStatus = 'APPROVED'; }],
  ['notice mismatch', value => { value.revisionContext.inputChanges.sources.priorMemberNotices[0].current.current = false; }],
  ['unregistered prior use ref', value => { value.revisionContext.previousSummary.usedEvidenceRefs.push('foreign-use'); }],
  ['invented prior root union', value => { value.revisionContext.previousSummary.rootRefs.push('foreign-root'); }],
  ['duplicate resolved issue keys', value => { value.revisionContext.previousSummary.members[0].resolvedIssueKeys = ['a', 'a']; }],
  ['incorrect same-selection basis', value => { value.revisionContext.inputChanges.basis = 'CHANGED_SELECTION'; }],
  ['sparse material strategy', value => { value.revisionContext.inputChanges.materialStrategy = 'SPARSE'; }],
  ['invented source delta', value => { value.revisionContext.inputChanges.sources.addedEvidenceRefs.push('foreign-source'); }],
  ['unknown sources field', value => { value.revisionContext.inputChanges.sources.providerAuthority = 'verified'; }],
  ['instruction drift', value => { value.revisionContext.requestedChange.instruction = 'Different instruction'; }],
];
for (const [name, mutate] of malformed) {
  test(`rejects ${name} before any runtime activation`, () => {
    const input = model(); mutate(input);
    assert.throws(() => validate(input), { message: 'DERIVED_SUMMARY_REVISION_CONTEXT_INVALID' });
  });
}
