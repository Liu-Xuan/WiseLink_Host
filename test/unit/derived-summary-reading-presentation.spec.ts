import { summaryRevision } from './fixtures/derived-summary';
import { summaryAdditionalMemberConditions, summaryReadingBrief, summaryReadingConditions } from
  '@client/src/features/derived-summary/summary-reading-presentation';

test('all inherited conditions stay visible with every exact saved-member reference', () => {
  const revision = summaryRevision();
  const first = revision.members[0];
  first.limitations = ['配置未取得，不能确认适用。'];
  const second = { ...structuredClone(first), evidenceRef: 'MEMBER-2', member: {
    kind: 'DERIVED_SUMMARY' as const, summaryId: 'DS-child', summaryRef: 'DSR-child-r4', summaryRevision: 4,
  } };
  revision.members.push(second);
  revision.content.limitations = ['配置未取得，不能确认适用。', '未覆盖其他来源。'];
  const before = JSON.stringify(revision);
  const conditions = summaryReadingConditions(revision);
  expect(conditions.map(condition => condition.text)).toEqual(revision.content.limitations);
  expect(conditions[0].inheritedFrom.map(member => member.member)).toEqual([first.member, second.member]);
  expect(conditions[1].inheritedFrom).toEqual([]);
  expect(JSON.stringify(revision)).toBe(before);
});

test('negation, versions, quantities and different source claims are never approximately merged', () => {
  const revision = summaryRevision();
  const texts = ['版本1.2未确认适用。', '版本1.3未确认适用。', '版本1.2已确认适用。',
    '来源A仅取得12项。', '来源A仅取得13项。', '来源B仅取得12项。', '尚未取得其他来源。'];
  revision.members[0].limitations = [texts[0]];
  revision.content.limitations = texts;
  const conditions = summaryReadingConditions(revision);
  expect(conditions.map(condition => condition.text)).toEqual(texts);
  expect(conditions.map(condition => condition.inheritedFrom.length)).toEqual([1, 0, 0, 0, 0, 0, 0]);
});

test('the coverage panel omits only exact saved text bound to that same member', () => {
  const revision = summaryRevision();
  revision.content.limitations = ['版本1.2 未覆盖其他来源。'];
  revision.members[0].limitations = [' 版本1.2\n未覆盖其他来源。 ', '版本1.3 未覆盖其他来源。'];
  const conditions = summaryReadingConditions(revision);
  expect(summaryAdditionalMemberConditions(revision.members[0], conditions)).toEqual(['版本1.3 未覆盖其他来源。']);
  const otherSource = { ...structuredClone(revision.members[0]), evidenceRef: 'MEMBER-other', member: {
    ...revision.members[0].member, workRef: 'JAWR-another-source',
  } };
  expect(summaryAdditionalMemberConditions(otherSource, conditions)).toEqual([
    '版本1.2\n未覆盖其他来源。', '版本1.3 未覆盖其他来源。',
  ]);
});

test('saved brief is promoted unless it exactly repeats the opening or headline', () => {
  const content = summaryRevision().content;
  content.listBrief = '版本1.2未确认适用，须核对12项。';
  content.body = '## 结论与主要影响\n\n版本1.2未确认适用，须核对12项。\n\n其余条件仍保留。';
  const before = JSON.stringify(content);
  expect(summaryReadingBrief(content)).toBeNull();
  expect(JSON.stringify(content)).toBe(before);
  expect(summaryReadingBrief({ ...content, listBrief: '版本1.2 未确认适用。', body: '版本1.2\n未确认适用。' })).toBeNull();
  expect(summaryReadingBrief({ ...content, body: '版本1.2未确认适用，\n须核对12项。' })).toBe(content.listBrief);
  expect(summaryReadingBrief({ ...content, headline: content.listBrief, body: '不同正文。' })).toBeNull();
  for (const body of ['版本1.3未确认适用，须核对12项。', '版本1.2已确认适用，须核对12项。',
    '版本1.2未确认适用，须核对13项。']) {
    expect(summaryReadingBrief({ ...content, body })).toBe(content.listBrief);
  }
});
