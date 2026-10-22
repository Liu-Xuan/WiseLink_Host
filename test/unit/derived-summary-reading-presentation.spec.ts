import { summaryRevision } from './fixtures/derived-summary';
import { summaryAdditionalMemberConditions, summaryReadingBrief, summaryReadingConditions, summaryWikiReadingConditions } from
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

test('observed Wiki processing records unfold separately from their complete engineering qualifiers', () => {
  const revision = summaryRevision();
  const parser = '文档解析采用 PDFJS_TEXT_LAYER 提取；"Other Model(s)" 对应单元格在原 PDF 中为空白，'
    + '无法据此判定其他机型是否相关，仅能确认主适用为 787、次要型号 -8/-9/-10。';
  const offset = '本次解读仅基于本次交付的 offset 0-40 范围（共 41 个 source unit）以及对应锚点，'
    + '未覆盖文件未读取的其他范围（如未来可能补充的修订段落等）。';
  const dependency = '本次尚未完成的下层依赖：三份 DOCUMENT 类保存评估仍为 SAVED_ASSESSMENT_NOT_READY'
    + '（subjectId family_fixture，requestId 含 JA-save-first、JA-save-second 等），不得宣称已覆盖这些新工作。';
  const sameSource = '仅覆盖显式选取的三份成员（一份文件解读 DRR-exact、两份工程事项 WI-first/WI-second），'
    + '全部溯源同一 FTD 原文，为同一来源派生复用而非独立佐证；未选成员、其他 ATA 与其他机型未覆盖。';
  const engineering = [
    'Production Incorporation 与 BCA Service Bulletin Available 均 TBD，CMCF OPS 更新无设定日期。',
    '机型表述差异未在原文层交叉验证：-8/-9/-10 与 "All 787 Aircrafts." 并存。',
    '具体 MSN 装机清单、装机 OSS/CMCF 软件版本、机队可靠性数据未取得，"零起在役报告"不构成零可能性的证据。',
    '来源A仅取得12项。', '来源A仅取得13项。', '来源B仅取得12项。',
  ];
  revision.content.limitations = [offset, parser, sameSource, dependency, ...engineering,
    '这是派生候选摘要，不是新增独立证据。仅覆盖已保存的精确成员。'];
  revision.members[0].limitations = [parser, offset, ...engineering];
  const before = JSON.stringify(revision);
  const groups = summaryWikiReadingConditions(revision);
  expect(groups.engineering.map(condition => condition.text)).toEqual([
    parser.slice(parser.indexOf('；') + 1), ...engineering,
  ]);
  expect(groups.records.map(condition => condition.text)).toEqual([
    offset, '文档解析采用 PDFJS_TEXT_LAYER 提取；', sameSource, dependency,
    '这是派生候选摘要，不是新增独立证据。仅覆盖已保存的精确成员。',
  ]);
  expect(groups.engineering[0].inheritedFrom.map(member => member.member)).toEqual([revision.members[0].member]);
  expect(groups.records[0].inheritedFrom.map(member => member.member)).toEqual([revision.members[0].member]);
  expect(summaryAdditionalMemberConditions(revision.members[0], [...groups.engineering, ...groups.records])).toEqual([]);
  expect(JSON.stringify(revision)).toBe(before);
});

test('an added engineering qualifier makes an unknown process-shaped sentence stay in the reading surface', () => {
  const revision = summaryRevision();
  const conditions = [
    '本次尚未完成的下层依赖：三份 DOCUMENT 类保存评估仍为 SAVED_ASSESSMENT_NOT_READY；OPS 1.2 不适用。',
    '文档解析采用 PDFJS_TEXT_LAYER，但警告段落缺失，不能确认构型 B 适用。',
    '仅覆盖显式选取的三份成员，其中修订 1.3 不适用于构型 B。',
    '本次解读仅基于 offset 0-40；第 41 项有未核实的适用例外。',
  ];
  revision.content.limitations = conditions;
  const groups = summaryWikiReadingConditions(revision);
  expect(groups.engineering.map(condition => condition.text)).toEqual(conditions);
  expect(groups.records).toEqual([]);
});

test('observed parent inheritance records stay separate while a mixed reference-row gap remains visible', () => {
  const revision = summaryRevision();
  const inheritance = '本层仅综合唯一已保存的 ATA 45-00 子层候选（DS-child）；该子层下的三份成员全部溯源同一 '
    + 'FTD 787-FTD-45-25001 原文，为同一来源派生复用而非独立佐证；未选成员、其他 ATA 与其他机型未覆盖。';
  const dependency = '本次尚未完成的下层依赖：DS-child 子层的 SUMMARY 仍为 PARTIAL，且三份 DOCUMENT 类保存评估仍为 '
    + 'SAVED_ASSESSMENT_NOT_READY（subjectId family_fixture），不得宣称已覆盖这些新工作。';
  const rowGap = 'u35 Reference Categories 仅披露首行，其余行未呈读';
  const range = '原件交付范围 COMPLETE_DELIVERY，41/41，解读仅基于 offset 0-40。';
  revision.content.limitations = [inheritance, dependency, rowGap + '；' + range];
  const groups = summaryWikiReadingConditions(revision);
  expect(groups.records.map(condition => condition.text)).toEqual([inheritance, dependency, range]);
  expect(groups.engineering.map(condition => condition.text)).toEqual([rowGap]);
  revision.content.limitations = [inheritance.replace('（DS-child）', '（DS-child；仅 OSS 1.2）')];
  expect(summaryWikiReadingConditions(revision).engineering[0].text).toBe(revision.content.limitations[0]);
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
