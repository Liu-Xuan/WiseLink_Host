import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { derivedSummarySparseRevisionModelView, validateDerivedSummarySparseRevisionModelView,
  hostBoundPriorDerivedSummaryRefs, validateDerivedSummarySparseContent } from '../scripts/derived-summary-incremental-revision.mjs';
import { createDerivedSummarySparseDeliveredView, projectDerivedSummarySparseReadReceipt } from '../scripts/derived-summary-read-projection.mjs';
import { derivedSummaryRegistry } from '../scripts/derived-summary-shape.mjs';
import { canonicalJson } from '../scripts/validate-payload.mjs';
const sealed = JSON.parse(await readFile(new URL('./fixtures/derived-summary-r1-sealed.json', import.meta.url), 'utf8'));
const full = basis => JSON.parse(sealed.groups.find(g => g.name === 'revision').variants.find(v =>
  JSON.parse(v.taskEnvelopeJson).modelInput.revisionContext.inputChanges.basis === basis).taskEnvelopeJson).modelInput;
const intent = (action, evidenceRefs) => ({ action, evidenceRefs, purpose: 'Synthetic exact-body delivery' });
const project = (receipt, step, registry, delivered, round = 0) => projectDerivedSummarySparseReadReceipt(receipt, step, registry, delivered, { round, messageIndex: 3 + round * 2 });
for (const basis of ['SAME_SELECTION', 'CHANGED_SELECTION']) test(`sparse ${basis} is detached exact directories and deterministic own-body preload`, () => {
  const input = full(basis); const before = canonicalJson(input); const view = derivedSummarySparseRevisionModelView(input);
  assert.equal(view.evidence.length, 0); assert.equal(view.membersDirectory.length, input.members.length);
  assert.equal(view.revisionContext.inputChanges.eligibleMaterialStrategy, 'FULL_CURRENT_MATERIAL');
  assert.equal(Object.hasOwn(view.revisionContext.inputChanges, 'materialStrategy'), false);
  for (const member of view.membersDirectory) {
    assert.equal(Object.hasOwn(member, 'body'), false); assert.equal(Object.hasOwn(member, 'understanding'), false);
    assert.equal(Object.hasOwn(member, 'evidence'), false); assert.equal(member.issues.some(i => Object.hasOwn(i, 'body')), false);
  }
  assert.equal(view.evidenceDirectory.some(x => Object.hasOwn(x, 'excerpt')), false);
  if (basis === 'SAME_SELECTION') assert.equal(view.members.length, 0); else assert.ok(view.members.length);
  for (const member of view.members) { assert.ok(member.body || member.understanding); assert.equal(Object.hasOwn(member, 'evidence'), false); }
  validateDerivedSummarySparseRevisionModelView(JSON.parse(JSON.stringify(view)), input);
  assert.equal(canonicalJson(input), before);
});
for (const key of ['initialMemberRefs', 'initialSourceRefs']) for (const refs of [['foreign'], ['foreign', 'foreign']])
  test(`sparse explicit ${key} rejects foreign/duplicate refs ${refs.length}`, () => assert.throws(() => derivedSummarySparseRevisionModelView(full('SAME_SELECTION'), { [key]: refs }), /SPARSE_VIEW_BINDING_INVALID/u));

test('sparse work READ does not deliver source body; explicit source READ permits a new decisive citation', () => {
  const input = full('SAME_SELECTION'); const registry = derivedSummaryRegistry(input); const view = derivedSummarySparseRevisionModelView(input);
  const delivered = createDerivedSummarySparseDeliveredView(view, registry); const refs = [...registry.evidence.keys()];
  const content = { headline: 'Conditional synthetic edit', listBrief: 'No verification claim', body: `Decisive exact condition [[${refs[0]}]]`, limitations: [] };
  const priorReusableRefs = hostBoundPriorDerivedSummaryRefs(input);
  assert.equal(delivered.members.size, 0); assert.equal(delivered.evidence.size, 0);
  assert.throws(() => validateDerivedSummarySparseContent(content, input, { delivered, priorReusableRefs }), /CITATION_REQUIRES_READ/u);
  const own = project({ members: input.members }, intent('READ_MEMBER_WORK', [...registry.members.keys()]), registry, delivered);
  assert.equal(delivered.members.size, input.members.length); assert.equal(delivered.evidence.size, 0);
  assert.equal(own.items[0].content.understanding, input.members[0].understanding);
  assert.equal(Object.hasOwn(own.items[0].content, 'evidence'), false);
  assert.throws(() => validateDerivedSummarySparseContent(content, input, { delivered, priorReusableRefs }), /CITATION_REQUIRES_READ/u);
  project({ evidence: [registry.evidence.get(refs[0])] }, intent('READ_SOURCES', [refs[0]]), registry, delivered, 1);
  validateDerivedSummarySparseContent(content, input, { delivered, priorReusableRefs });
});
for (const field of ['headline', 'listBrief', 'body', 'limitations']) test(`sparse citation gate checks ${field}`, () => {
  const input = full('SAME_SELECTION'); const registry = derivedSummaryRegistry(input); const sourceRef = [...registry.evidence.keys()][0];
  const content = { headline: 'Candidate', listBrief: 'Selected only', body: `Prior candidate [[${input.members[0].evidenceRef}]]`, limitations: [] };
  content[field] = field === 'limitations' ? [`Unread [[${sourceRef}]]`] : `Unread [[${sourceRef}]]`;
  assert.throws(() => validateDerivedSummarySparseContent(content, input, { delivered: createDerivedSummarySparseDeliveredView(derivedSummarySparseRevisionModelView(input), registry), priorReusableRefs: hostBoundPriorDerivedSummaryRefs(input) }), /CITATION_REQUIRES_READ/u);
});
test('pure reuse retains saved limitations-only used ref but excludes headline/listBrief-only ref', () => {
  const input = full('SAME_SELECTION'); const prior = input.revisionContext.previousSummary; const ref = input.evidence[0].evidenceRef;
  prior.content.headline = `Header [[${ref}]]`; prior.content.listBrief = `Brief [[${ref}]]`;
  assert.equal(hostBoundPriorDerivedSummaryRefs(input).has(ref), false);
  prior.content.limitations.push(`Retained source condition [[${ref}]]`); prior.usedEvidenceRefs.push(ref);
  assert.equal(hostBoundPriorDerivedSummaryRefs(input).has(ref), true);
  // Modified prior is a pure selection validator fixture, not a forged accepted Host seal or ACL proof.
});
for (const kind of ['workRevision', 'issueKeys', 'rootRefs']) test(`pure prior member reuse requires exact ${kind}`, () => {
  const input = full('SAME_SELECTION'); const prior = input.revisionContext.previousSummary;
  if (kind === 'workRevision') prior.members[0].member.workRevision += 1;
  if (kind === 'issueKeys') prior.members[0].resolvedIssueKeys = [];
  if (kind === 'rootRefs') prior.members[0].rootRefs = [];
  if (kind === 'issueKeys') assert.equal(hostBoundPriorDerivedSummaryRefs(input).has(prior.members[0].evidenceRef), false);
  else assert.throws(() => hostBoundPriorDerivedSummaryRefs(input), /REVISION_CONTEXT_INVALID/u);
});
test('sparse restoring keeps original notices and rejects immutable view drift', () => {
  const input = full('CHANGED_SELECTION'); const view = derivedSummarySparseRevisionModelView(input); const original = canonicalJson(view);
  const changed = structuredClone(input); changed.members[0].current = !changed.members[0].current;
  validateDerivedSummarySparseRevisionModelView(view, changed, { restoring: true }); assert.equal(canonicalJson(view), original);
  view.membersDirectory[0].headline += ' changed'; assert.throws(() => validateDerivedSummarySparseRevisionModelView(view, input, { restoring: true }), /SPARSE_VIEW_BINDING_INVALID/u);
});
