import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeDerivedSummaryCachePrefix } from '../scripts/derived-summary-cache-prefix.mjs';
import { canonicalJson, canonicalSha256 } from '../scripts/validate-payload.mjs';

const member = index => ({ evidenceRef: `member-${index}`,
  member: { kind: 'WORK_ITEM_WORK', workRef: `WR-${index}`, workRevision: 2,
    issueKeys: ['second', 'first'], workItemId: `WI-${index}`, documentVersionId: 'DV-exact' },
  headline: '条件与未知', understanding: '完整认识，包含否定与条件\n',
  issues: [{ issueKey: 'second', body: 'No installation proof; measure is only proposed.' },
    { issueKey: 'first', body: 'Do not infer zero events from unavailable data.' }],
  evidenceRefs: ['source-2', 'source-1'], rootRefs: ['source-2', 'source-1'], leaves: [],
  current: false, overviewStatus: 'STALE', limitations: ['Historical work', 'Not approval'] });
const view = { instruction: '比较条件；完整保留未知', scope: { kind: 'ATA4', title: 'Selected scope',
  fleetFamilyId: 'F-exact', fleetModelIds: ['MODEL-B', 'MODEL-A'], ata2: '46', ata4: '46-00', selectionReason: 'Explicit choice' },
  classificationStatus: 'CANDIDATE', members: [member(1), member(2)],
  evidence: [{ evidenceRef: 'source-2', excerpt: 'Only if installed\n条件', versionLabel: 'R2', locator: '/sections/3/paragraphs/2' },
    { evidenceRef: 'source-1', excerpt: 'No applicability receipt', versionLabel: 'R1', locator: 'p. 4, table 2' }],
  limitations: ['No fleet data', 'Candidate only'] };
const serialize = serializeDerivedSummaryCachePrefix;
const utf8Lcp = (left, right) => {
  const a = Buffer.from(left); const b = Buffer.from(right); let index = 0;
  while (index < Math.min(a.length, b.length) && a[index] === b[index]) index++;
  return index;
};

test('explicit layout preserves parsed values, complete bytes, canonical identity and locator paths', () => {
  const before = structuredClone(view); const baseline = canonicalJson(view);
  const taskHash = canonicalSha256({ modelInput: view, leaseGeneration: 3 });
  const serialized = serialize(view); const parsed = JSON.parse(serialized);
  assert.equal(canonicalJson(parsed), baseline);
  assert.equal(Buffer.byteLength(serialized), Buffer.byteLength(baseline));
  assert.equal(canonicalSha256({ modelInput: view, leaseGeneration: 3 }), taskHash);
  assert.deepEqual(view, before);
  assert.deepEqual(Object.keys(parsed), ['evidence', 'members', 'classificationStatus', 'scope', 'limitations', 'instruction']);
  assert.deepEqual(Object.keys(parsed.members[0]), ['evidenceRef', 'member', 'headline', 'understanding',
    'issues', 'evidenceRefs', 'rootRefs', 'leaves', 'current', 'overviewStatus', 'limitations']);
  for (let index = 0; index < view.members.length; index++) assert.deepEqual(parsed.members[index], view.members[index]);
  for (let index = 0; index < view.evidence.length; index++) assert.deepEqual(parsed.evidence[index], view.evidence[index]);
});

test('ordering is deterministic across construction order and nested values remain canonical', () => {
  const reordered = value => Array.isArray(value) ? value.map(reordered) : !value || typeof value !== 'object' ? value
    : Object.fromEntries(Object.entries(value).reverse().map(([key, field]) => [key, reordered(field)]));
  assert.equal(serialize(view), serialize(reordered(view)));
  assert.equal(canonicalSha256(view), canonicalSha256(reordered(view)));
  const extended = { ...view, zExtra: { z: ['b', 'a'], a: '值' }, aExtra: 'extra' };
  extended.members[0] = { ...extended.members[0], zExtra: 2, aExtra: { z: 1, a: 2 } };
  const parsed = JSON.parse(serialize(extended));
  assert.deepEqual(Object.keys(parsed).slice(-2), ['aExtra', 'zExtra']);
  assert.deepEqual(Object.keys(parsed.members[0]).slice(-2), ['aExtra', 'zExtra']);
  assert.deepEqual(Object.keys(parsed.zExtra), ['a', 'z']);
  assert.deepEqual(parsed, extended);
});

test('instruction change preserves preceding complete selected material and remains visible', () => {
  const changed = structuredClone(view); changed.instruction += ' 更短';
  const original = serialize(view); const next = serialize(changed);
  assert.ok(utf8Lcp(original, next) >= Buffer.byteLength(original.slice(0, original.indexOf('"instruction":'))));
  assert.ok(utf8Lcp(original, next) > utf8Lcp(canonicalJson(view), canonicalJson(changed)));
  assert.deepEqual(JSON.parse(next), changed);
});

for (const [label, mutate, boundary] of [
  ['scope', value => { value.scope.title += ' current'; }, '"scope":'],
  ['root limitation', value => { value.limitations[0] += ' observed'; }, '"limitations":["No fleet data"'],
  ['member currentness', value => { value.members[0].current = true; }, '"current":'],
  ['member notice', value => { value.members[0].limitations.push('New observed notice'); }, '"limitations":["Historical work"'],
]) test(`long complete evidence prefix stays stable before a changed ${label}`, () => {
  const originalView = structuredClone(view);
  originalView.evidence[0].excerpt = 'Only when installed AND self-test passes; proposed, not verified. 条件与未知。\n'.repeat(1000)
    + 'TAIL PREMISE: no installation or effectiveness receipt.';
  const changed = structuredClone(originalView); mutate(changed);
  const original = serialize(originalView); const next = serialize(changed);
  assert.notEqual(original, next); assert.deepEqual(JSON.parse(next), changed);
  assert.ok(utf8Lcp(original, next) >= Buffer.byteLength(original.slice(0, original.indexOf(boundary))));
  assert.ok(next.includes('TAIL PREMISE: no installation or effectiveness receipt.'));
  assert.equal(JSON.parse(next).evidence[0].excerpt, originalView.evidence[0].excerpt);
});

for (const [label, mutate] of [
  ['evidence text', value => { value.evidence[0].excerpt += ' new condition'; }],
  ['evidence ref', value => { value.evidence[0].evidenceRef = 'different-exact-ref'; }],
  ['source version', value => { value.evidence[0].versionLabel = 'R3'; }],
  ['work version', value => { value.members[0].member.workRevision = 3; }],
  ['selected issues', value => { value.members[0].member.issueKeys.reverse(); }],
  ['issue condition', value => { value.members[0].issues[0].body += ' verified? unknown'; }],
  ['root identities', value => { value.members[0].rootRefs.reverse(); }],
  ['leaf identity', value => { value.members[0].leaves.push({ summaryRef: 'SUMR-child', summaryRevision: 2 }); }],
  ['evidence array order', value => { value.evidence.reverse(); }],
  ['member array order', value => { value.members.reverse(); }],
]) test(`serialization never suppresses ${label}`, () => {
  const changed = structuredClone(view); mutate(changed);
  assert.notEqual(serialize(view), serialize(changed));
  assert.deepEqual(JSON.parse(serialize(changed)), changed);
  assert.equal(Buffer.byteLength(serialize(changed)), Buffer.byteLength(canonicalJson(changed)));
});

test('optional fields and fallback body retain JSON undefined omission without defaults', () => {
  const changed = structuredClone(view);
  delete changed.members[0].understanding; changed.members[0].body = 'Complete fallback body\n条件';
  changed.members[1].body = undefined; changed.aExtra = undefined;
  const parsed = JSON.parse(serialize(changed));
  assert.equal(canonicalJson(parsed), canonicalJson(changed));
  assert.equal(Object.hasOwn(parsed, 'aExtra'), false);
  assert.equal(Object.hasOwn(parsed.members[1], 'body'), false);
  assert.equal(parsed.members[0].body, changed.members[0].body);
  assert.equal(canonicalJson(JSON.parse(serialize({ ...view, members: undefined }))), canonicalJson({ ...view, members: undefined }));
});
