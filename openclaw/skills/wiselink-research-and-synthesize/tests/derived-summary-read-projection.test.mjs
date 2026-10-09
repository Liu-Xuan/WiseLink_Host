import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createDerivedSummaryDeliveredView, projectDerivedSummaryReadReceipt } from '../scripts/derived-summary-read-projection.mjs';
import { derivedSummaryModelView } from '../scripts/invoke-hosted-derived-summary-model.mjs';
import { completeDerivedSummaryWorkBody, derivedSummaryRegistry } from '../scripts/derived-summary-shape.mjs';
import { canonicalJson } from '../scripts/validate-payload.mjs';
const source = { evidenceRef: 'source-A', kind: 'DOCUMENT_PASSAGE', excerpt: 'Only if installed; absence does not establish zero events.', versionLabel: 'R1', locator: 'p4' };
const sourceB = { ...source, evidenceRef: 'source-B', versionLabel: 'R2' };
const member = { kind: 'WORK_ITEM_WORK', workItemId: 'WI-A', documentVersionId: 'DV-A', workRef: 'WR-A', workRevision: 3, issueKeys: ['condition'] };
const issues = [{ issueKey: 'condition', question: 'Applicability confirmed?', body: 'Unknown installation; proposed measure is not verified effective.',
  measures: [{ status: 'PROPOSED', limitations: ['Both conditions unverified'] }], riskScenarios: [{ likelihood: null, severity: { reason: 'Impact scope unverified' } }],
  openQuestions: [{ question: 'Self-test passes?', reason: 'No verification receipt' }] }];
const reading = { member, evidenceRef: 'member-A', headline: 'Conditional candidate', understanding: 'Complete saved understanding',
  body: completeDerivedSummaryWorkBody('Complete saved understanding', issues), issues, evidence: [source, sourceB],
  rootRefs: ['source-A', 'source-B'], leaves: [member], current: false, overviewStatus: 'STALE', limitations: ['Historical and selected scope only'] };
const input = { scope: { kind: 'ATA4', title: 'Exact subset', fleetFamilyId: 'F-A', fleetModelIds: ['MODEL-A'], ata2: '46', ata4: '46-00', selectionReason: 'Explicit' },
  classificationStatus: 'CANDIDATE', instruction: 'Keep conditions and unknowns', members: [reading], evidence: [source, sourceB], limitations: ['No connected fleet data'] };
const registry = () => derivedSummaryRegistry(input);
const intent = (action, evidenceRefs) => ({ action, evidenceRefs, purpose: 'Inspect exact selected content' });
const project = (receipt, step, delivered, round = 0) => projectDerivedSummaryReadReceipt(receipt, step, registry(), delivered,
  { round, messageIndex: 3 + round * 2 });

test('registered availability is never proof of source presentation: unseen full once then exact confirmation', () => {
  const delivered = createDerivedSummaryDeliveredView({ members: [], evidence: [] });
  const step = intent('READ_SOURCES', ['source-A']); const receipt = { evidence: [source] }; const original = canonicalJson(receipt);
  const first = project(receipt, step, delivered);
  assert.equal(first.items[0].status, 'DELIVERED_FULL_CONTENT'); assert.deepEqual(first.items[0].content, source);
  const second = project(receipt, step, delivered, 1);
  assert.equal(second.items[0].status, 'CONFIRMED_SAME_CONTENT'); assert.equal(Object.hasOwn(second.items[0], 'content'), false);
  assert.deepEqual(second.items[0].contentLocation, { messageIndex: 3, toolPointer: '/items/0/content' });
  assert.equal(canonicalJson(receipt), original);
});

test('member evidenceRefs alone do not establish fullsource; full member delivers actual nested source once', () => {
  const view = derivedSummaryModelView(input); view.evidence = [];
  const delivered = createDerivedSummaryDeliveredView(view);
  assert.equal(delivered.members.size, 0); assert.equal(delivered.evidence.size, 0);
  const first = project({ members: [reading] }, intent('READ_MEMBER_WORK', ['member-A']), delivered);
  assert.equal(first.items[0].status, 'DELIVERED_FULL_CONTENT'); assert.deepEqual(first.items[0].content, reading);
  assert.equal(delivered.evidence.size, 2);
  const sourceRead = project({ evidence: [source] }, intent('READ_SOURCES', ['source-A']), delivered, 1);
  assert.equal(sourceRead.items[0].status, 'CONFIRMED_SAME_CONTENT');
  assert.deepEqual(sourceRead.items[0].contentLocation, { messageIndex: 3, toolPointer: '/items/0/content/evidence/0' });
});

test('split member confirmations point at real understanding/issues and top-level evidence slots', () => {
  const delivered = createDerivedSummaryDeliveredView(derivedSummaryModelView(input));
  const projected = project({ members: [reading] }, intent('READ_MEMBER_WORK', ['member-A']), delivered);
  assert.equal(projected.items[0].status, 'CONFIRMED_SAME_CONTENT');
  assert.deepEqual(projected.items[0].contentLocation.contentFields, ['understanding', 'issues']);
  assert.deepEqual(projected.items[0].contentLocation.evidenceLocations,
    [{ evidenceRef: 'source-A', messageIndex: 1, inputPointer: '/evidence/0' }, { evidenceRef: 'source-B', messageIndex: 1, inputPointer: '/evidence/1' }]);
  assert.equal(canonicalJson(projected).includes(reading.understanding), false);
  assert.equal(canonicalJson(projected).includes(issues[0].body), false);
});

test('same text under different refs/versions is never collapsed or substituted', () => {
  const delivered = createDerivedSummaryDeliveredView({ members: [], evidence: [source] });
  const step = intent('READ_SOURCES', ['source-A', 'source-B']);
  const projected = project({ evidence: [sourceB, source] }, step, delivered);
  assert.deepEqual(projected.items.map(item => [item.evidenceRef, item.status]),
    [['source-B', 'DELIVERED_FULL_CONTENT'], ['source-A', 'CONFIRMED_SAME_CONTENT']]);
  assert.equal(delivered.evidence.size, 2); assert.equal(projected.items[0].content.versionLabel, 'R2');
  assert.deepEqual(projected.requestedEvidenceRefs, step.evidenceRefs);
});

test('multi-topic exact member identities remain separate despite same professional text', () => {
  const other = { ...structuredClone(reading), evidenceRef: 'member-B', member: { ...member, workItemId: 'WI-B', workRef: 'WR-B' } };
  const selected = { ...input, members: [reading, other] };
  const delivered = createDerivedSummaryDeliveredView(derivedSummaryModelView(selected));
  const step = intent('READ_MEMBER_WORK', ['member-A', 'member-B']);
  const result = projectDerivedSummaryReadReceipt({ members: [reading, other] }, step, derivedSummaryRegistry(selected), delivered, { round: 0, messageIndex: 3 });
  assert.deepEqual(result.items.map(item => item.evidenceRef), ['member-A', 'member-B']);
  assert.deepEqual(result.items.map(item => item.contentLocation.inputPointer), ['/members/0', '/members/1']);
});

for (const [label, receipt, step] of [
  ['missing', { evidence: [] }, intent('READ_SOURCES', ['source-A'])],
  ['duplicate', { evidence: [source, source] }, intent('READ_SOURCES', ['source-A', 'source-B'])],
  ['foreign', { evidence: [{ ...source, evidenceRef: 'foreign' }] }, intent('READ_SOURCES', ['source-A'])],
  ['version drift', { evidence: [{ ...source, versionLabel: 'R-other' }] }, intent('READ_SOURCES', ['source-A'])],
  ['body drift', { members: [{ ...reading, body: reading.body + ' altered', understanding: undefined }] }, intent('READ_MEMBER_WORK', ['member-A'])],
  ['partial', { evidence: [source], status: 'PARTIAL' }, intent('READ_SOURCES', ['source-A'])],
  ['failed', { evidence: [source], status: 'FAILED' }, intent('READ_SOURCES', ['source-A'])],
  ['outcome unknown', { evidence: [source], status: 'OUTCOME_UNKNOWN' }, intent('READ_SOURCES', ['source-A'])],
  ['wrong payload kind', { members: [reading] }, intent('READ_SOURCES', ['source-A'])],
]) test(`invalid ${label} receipt cannot create or advance delivery`, () => {
  const delivered = createDerivedSummaryDeliveredView({ members: [], evidence: [] });
  assert.throws(() => project(receipt, step, delivered), /DERIVED_SUMMARY_/);
  assert.equal(delivered.members.size, 0); assert.equal(delivered.evidence.size, 0);
});

test('same exact ref changed against actually delivered initial text fails before mutation even if registry has other content', () => {
  const delivered = createDerivedSummaryDeliveredView({ members: [], evidence: [{ ...source, excerpt: 'Different actually delivered content' }] });
  const before = canonicalJson([...delivered.evidence]);
  assert.throws(() => project({ evidence: [source] }, intent('READ_SOURCES', ['source-A']), delivered), /READ_PROJECTION_BINDING_INVALID/);
  assert.equal(canonicalJson([...delivered.evidence]), before);
});


const r1Sealed = JSON.parse(await readFile(new URL('./fixtures/derived-summary-r1-sealed.json', import.meta.url), 'utf8'));
assert.equal(r1Sealed.schemaVersion, 'wiselink.derived-summary-r1-sealed-fixtures.v1');
const r1RevisionEntries = r1Sealed.groups.find(group => group.name === 'revision').variants;
for (const entry of r1RevisionEntries) test(`R1 actual sealed ${entry.name} keeps full current material in INPUT and projects only current READ confirmations`, () => {
  const raw = entry.taskEnvelopeJson; const selected = JSON.parse(raw).modelInput; const view = derivedSummaryModelView(selected);
  const actualRegistry = derivedSummaryRegistry(selected); const delivered = createDerivedSummaryDeliveredView(view);
  assert.equal(delivered.members.size, selected.members.length);
  for (const [index, member] of selected.members.entries()) {
    const reconstructed = delivered.members.get(member.evidenceRef);
    assert.equal(reconstructed.value.body, member.body); assert.deepEqual(reconstructed.value.issues, member.issues);
    assert.deepEqual(reconstructed.value.evidence, member.evidence); assert.deepEqual(reconstructed.value.leaves, member.leaves);
    const projection = projectDerivedSummaryReadReceipt({ members: [member] }, intent('READ_MEMBER_WORK', [member.evidenceRef]),
      actualRegistry, delivered, { round: index, messageIndex: 3 + index * 2 });
    assert.equal(projection.items[0].status, 'CONFIRMED_SAME_CONTENT');
    assert.equal(projection.items[0].contentLocation.messageIndex, 1);
    assert.equal(projection.items[0].contentLocation.inputPointer, `/members/${index}`);
    assert.equal(Object.hasOwn(projection.items[0], 'content'), false);
    assert.equal(projection.receiptCheckpointKey, `summary-round-${index}-read`);
  }
  assert.deepEqual(view.revisionContext, selected.revisionContext); assert.equal(entry.taskEnvelopeJson, raw);
});

test('R1 removed prior dependencies are neither delivered current content nor registered READ sources', () => {
  const entry = r1RevisionEntries.find(item => JSON.parse(item.taskEnvelopeJson).modelInput.revisionContext.inputChanges.basis === 'CHANGED_SELECTION');
  const selected = JSON.parse(entry.taskEnvelopeJson).modelInput; const view = derivedSummaryModelView(selected);
  const actualRegistry = derivedSummaryRegistry(selected); const delivered = createDerivedSummaryDeliveredView(view);
  const prior = selected.revisionContext.previousSummary;
  const removedMembers = prior.members.filter(member => !actualRegistry.members.has(member.evidenceRef));
  const removedSources = prior.evidenceRefs.filter(ref => !actualRegistry.evidence.has(ref));
  assert.ok(removedMembers.length + removedSources.length > 0);
  for (const member of removedMembers) assert.equal(delivered.members.has(member.evidenceRef), false);
  for (const ref of removedSources) assert.equal(delivered.evidence.has(ref), false);
  assert.equal(delivered.members.has(prior.summaryRef), false); assert.equal(delivered.evidence.has(prior.summaryRef), false);
  assert.equal(delivered.evidence.size, actualRegistry.evidence.size);
  for (const member of selected.members) {
    const location = delivered.members.get(member.evidenceRef).location;
    assert.equal(location.messageIndex, 1); assert.equal(location.inputPointer.includes('revisionContext'), false);
  }
});

test('R1 current source READ confirmations use top-level current INPUT slots, never saved candidate text', () => {
  const selected = JSON.parse(r1RevisionEntries[0].taskEnvelopeJson).modelInput; const view = derivedSummaryModelView(selected);
  const actualRegistry = derivedSummaryRegistry(selected); const delivered = createDerivedSummaryDeliveredView(view);
  for (const [index, source] of view.evidence.entries()) {
    const projection = projectDerivedSummaryReadReceipt({ evidence: [actualRegistry.evidence.get(source.evidenceRef)] },
      intent('READ_SOURCES', [source.evidenceRef]), actualRegistry, delivered, { round: index, messageIndex: 3 + index * 2 });
    assert.equal(projection.items[0].status, 'CONFIRMED_SAME_CONTENT');
    assert.equal(projection.items[0].contentLocation.messageIndex, 1);
    assert.equal(projection.items[0].contentLocation.inputPointer, `/evidence/${index}`);
    assert.equal(Object.hasOwn(projection.items[0], 'content'), false);
  }
});


import { derivedSummarySparseRevisionModelView } from '../scripts/derived-summary-incremental-revision.mjs';
import { createDerivedSummarySparseDeliveredView, projectDerivedSummarySparseReadReceipt } from '../scripts/derived-summary-read-projection.mjs';
function sparseProjectionFixture() {
  const input = JSON.parse(r1RevisionEntries.find(x => JSON.parse(x.taskEnvelopeJson).modelInput.revisionContext.inputChanges.basis === 'SAME_SELECTION').taskEnvelopeJson).modelInput;
  const registry = derivedSummaryRegistry(input); return { input, registry,
    delivered: createDerivedSummarySparseDeliveredView(derivedSummarySparseRevisionModelView(input), registry) };
}
for (const [name, change] of [
  ['missing', x => { x.members = []; }], ['duplicate', x => { x.members.push(structuredClone(x.members[0])); }],
  ['foreign', x => { x.members[0].evidenceRef = 'foreign'; }], ['extra envelope', x => { x.partial = true; }],
  ['changed body', x => { x.members[0].body += ' drift'; }], ['changed source', x => { x.members[0].evidence[0].excerpt += ' drift'; }],
]) test(`sparse ${name} raw batch fails without any ledger pollution`, () => {
  const f = sparseProjectionFixture(); const before = canonicalJson([...f.delivered.members]); const nativeBefore = canonicalJson([...f.delivered.nativeReadReceipts ?? []]);
  const receipt = { members: structuredClone(f.input.members) }; change(receipt);
  assert.throws(() => projectDerivedSummarySparseReadReceipt(receipt, intent('READ_MEMBER_WORK', [...f.registry.members.keys()]), f.registry, f.delivered, { round: 0, messageIndex: 3 }), /DERIVED_SUMMARY_/u);
  assert.equal(canonicalJson([...f.delivered.members]), before); assert.equal(f.delivered.evidence.size, 0);
  assert.equal(canonicalJson([...f.delivered.nativeReadReceipts ?? []]), nativeBefore);
});
test('sparse confirmations point to actual prior own/source bodies independently', () => {
  const f = sparseProjectionFixture(); const step = intent('READ_MEMBER_WORK', [...f.registry.members.keys()]);
  const one = projectDerivedSummarySparseReadReceipt({ members: f.input.members }, step, f.registry, f.delivered, { round: 0, messageIndex: 3 });
  const two = projectDerivedSummarySparseReadReceipt({ members: f.input.members }, step, f.registry, f.delivered, { round: 1, messageIndex: 5 });
  assert.equal(one.items[0].status, 'DELIVERED_FULL_CONTENT'); assert.equal(two.items[0].status, 'CONFIRMED_SAME_CONTENT');
  assert.deepEqual(two.items[0].contentLocation, one.items[0].contentLocation); assert.equal(f.delivered.evidence.size, 0);
});
