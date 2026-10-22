import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { summaryEntryCatalog } from '@client/src/features/derived-summary/summary-entry-catalog';
import SummaryEngineeringCatalog from '@client/src/features/derived-summary/SummaryEngineeringCatalog';
import { wikiLayerInstruction } from '@server/modules/canonical-host/hierarchical-wiki-generation';
import { summaryRevision } from './fixtures/derived-summary';
import type { DerivedSummaryMatterCatalogProjection } from '@shared/derived-summary.interface';

jest.mock('@client/src/features/derived-summary/summary-reading.css', () => ({}));

function matterProjection(ids: string[]): DerivedSummaryMatterCatalogProjection {
  const selected = summaryRevision().members[0];
  return { basis: 'SAVED_INPUT', catalog: { schemaVersion: 'wiselink.wiki-matter-catalog.v1',
    entries: ids.map((id, index) => ({ matterId: id, matterRevisionId: `MREV-${id}`, title: `正式事项 ${index + 1}`,
      bindings: [{ memberRef: selected.evidenceRef, leaf: selected.member, sourceRefs: [], association: { kind: 'WORK_ITEM_LINK', workItemId: 'WI-1' } }] })),
    unbound: [] } };
}

test('a parent keeps every explicit engineering entry, its own status, documents and complete detail', () => {
  const content = summaryRevision().content;
  content.body = [
    '## 条目：配置报告无法更新',
    '### 当前状态\n仍在调查，未记载关闭。 [[child-r1]]',
    '### FTD / SL / SB\nFTD 已发布；SL 未记载；SB TBD。 [[child-r1]]',
    '### 背景\n仅 OSS 1.2 构型，12 项中第 3 项触发。 [[child-r1]]',
    '### 临时措施\n避免该请求；重启副作用未核。 [[child-r1]]',
    '### 最终措施\nOPS 更新日期未定。 [[child-r1]]',
    '## 条目：独立电源故障',
    '### 当前状态\n文件记载已关闭。 [[child-r2]]',
    '### FTD / SL / SB\nSL-2 已发布；不适用于构型 B。 [[child-r2]]',
    '### 分析\n只涉及电源，不继承前一条的软件措施。 [[child-r2]]',
  ].join('\n\n');
  const before: string = JSON.stringify(content);
  const catalog = summaryEntryCatalog(content);
  expect(catalog.structured).toBe(true);
  expect(catalog.entries.map(entry => entry.title)).toEqual(['配置报告无法更新', '独立电源故障']);
  expect(catalog.entries[0].previews.map(preview => preview.body)).toEqual([
    '仍在调查，未记载关闭。 [[child-r1]]', 'FTD 已发布；SL 未记载；SB TBD。 [[child-r1]]',
  ]);
  expect(catalog.entries[0].body).toContain('仅 OSS 1.2 构型，12 项中第 3 项触发。 [[child-r1]]');
  expect(catalog.entries[0].body).toContain('重启副作用未核。 [[child-r1]]');
  expect(catalog.entries[0].body).not.toContain('SL-2');
  expect(catalog.entries[1].body).not.toContain('重启');
  expect(JSON.stringify(content)).toBe(before);
});

test('fenced examples and generic report headings cannot manufacture entry or status structure', () => {
  const content = summaryRevision().content;
  content.body = '```markdown\n## 条目：示例不可作条目\n### 当前状态\n已关闭\n```\n\n'
    + '## 背景\n\n正文未记载关闭。\n\n## 临时措施\n\n措施编号 1.2，不保证成功。';
  const catalog = summaryEntryCatalog(content);
  expect(catalog.structured).toBe(false);
  expect(catalog.entries).toHaveLength(1);
  expect(catalog.entries[0].previews).toEqual([]);
  expect(catalog.entries[0].body).toBe(content.body);
});

test('an old combined status paragraph is shown verbatim once without guessing release or closure', () => {
  const content = summaryRevision().content;
  const status: string = '生产与实验室识别；未收到在役报告；SB TBD，OPS 无设定日期。 [[exact-child]]';
  content.body = '**背景**：设备无法创建新报告。 [[exact-child]]\n\n**Status 与最终措施**：' + status
    + '\n\n**临时措施**：配置 B 不适用；12 项尚未核对。 [[exact-child]]';
  const entry = summaryEntryCatalog(content).entries[0];
  expect(entry.previews).toEqual([{ label: 'Status 与最终措施', body: status }]);
  expect(entry.body).not.toContain(status);
  expect(entry.body).toContain('配置 B 不适用；12 项尚未核对。 [[exact-child]]');
  expect(entry.previews[0].body).not.toContain('已关闭');
  expect(entry.previews[0].body).not.toContain('SB 已发布');
});

test('saved Matter prose follows its progress directly while its source records fold independently', () => {
  const revision = summaryRevision();
  revision.content.body = '仅构型 A；构型 B 不适用，12 项尚未核。\n\n## 事项：MAT-1 | 软件配置异常\n\n### 当前状态\n未关闭。 [[child-r4]]'
    + '\n\n### FTD / SL / SB\nFTD 已发布，SB TBD。 [[child-r4]]'
    + '\n\n### 背景\n仅版本 1.2。 [[child-r4]]\n\n## 事项：MAT-2 | 电源异常\n\n### 分析\n尚未核对。';
  const html: string = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SummaryEngineeringCatalog, {
    revision, readingRoute: (route: string) => route,
    matterCatalog: matterProjection(['MAT-1', 'MAT-2']),
    renderMarkdown: (body: string): ReactNode => createElement('div', { 'data-markdown': true }, body),
    conditions: createElement('section', { 'data-engineering-conditions': true }, '构型差异未核，不能保证适用。'),
  })));
  expect(html).toContain('aria-label="工程事项目录"');
  expect(html.indexOf('仅构型 A；构型 B 不适用，12 项尚未核。')).toBeLessThan(html.indexOf('### 正式事项 1'));
  expect(html).toContain('### 正式事项 1');
  expect(html).toContain('aria-label="保存正文标题"');
  expect(html).toContain('#### 软件配置异常');
  expect(html).toContain('FTD 已发布，SB TBD。 [[child-r4]]');
  expect(html).not.toContain('<dt>当前状态</dt><dd>—</dd>');
  expect(html.match(/<details /gu)).toHaveLength(2);
  expect(html).not.toContain(' open');
  expect(html).toContain('仅版本 1.2。 [[child-r4]]');
  expect(html.indexOf('仅版本 1.2。')).toBeLessThan(html.indexOf('<details '));
  expect(html).toContain('事项资料与关联');
  expect(html).toContain('构型差异未核，不能保证适用。');
  expect(html).toContain('summary-entry-progress-content line-clamp-3');
  expect(html).toContain('aria-expanded="false"');
});

test('a legacy chapter remains exact navigation plus complete saved prose', () => {
  const revision = summaryRevision();
  revision.scope.kind = 'ATA2'; revision.scope.ata4 = null;
  revision.content.headline = 'B787 ATA 46 综合';
  revision.members[0].headline = 'B787 ATA 46-00 子层综合';
  revision.members[0].member = { kind: 'DERIVED_SUMMARY', summaryId: 'DS-child', summaryRef: 'DSR-child-r4', summaryRevision: 4 };
  const html: string = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SummaryEngineeringCatalog, {
    revision, readingRoute: (route: string) => route + '&returnWikiGuideQuery=preserved',
    renderMarkdown: (body: string): ReactNode => createElement('div', null, body),
  })));
  expect(html).toContain('事项关联尚未提供。');
  expect(html).toContain('summaryRef=DSR-child-r4&amp;returnWikiGuideQuery=preserved');
  expect(html).toContain('本层已保存正文');
  expect(html).not.toContain('data-matter-id=');
});

test('a legacy parent report cannot collapse several child topics into its headline topic', () => {
  const revision = summaryRevision();
  revision.scope.kind = 'ATA2'; revision.scope.ata4 = null;
  revision.content.headline = 'B787 ATA 46 综合：软件配置异常';
  revision.members = ['软件配置异常', '电源异常'].map((title: string, index: number) => ({
    ...revision.members[0], headline: `B787 ATA 46-0${index} 汇总：${title}`,
    member: { kind: 'DERIVED_SUMMARY' as const, summaryId: `DS-child-${index}`, summaryRef: `DSR-child-${index}`, summaryRevision: 1 },
  }));
  const html: string = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SummaryEngineeringCatalog, {
    revision, readingRoute: (route: string) => route,
    renderMarkdown: (body: string): ReactNode => createElement('div', null, body),
  })));
  expect(html).toContain('事项关联尚未提供。');
  expect(html).toContain('summaryRef=DSR-child-0');
  expect(html).toContain('summaryRef=DSR-child-1');
  expect(html).not.toContain('data-matter-id=');
});

test('even one current Matter cannot retrospectively own a legacy report or its status', () => {
  const revision = summaryRevision();
  revision.content.headline = '仅版本 1.2，构型 B 不适用，SB 尚未发布。 [[MEMBER-1]]';
  revision.content.body = '**Status 与最终措施**：未关闭，SB TBD；12 项未核，OPS 无设定日期。 [[MEMBER-1]]'
    + '\n\n**临时措施**：仅构型 A，构型 B 不适用。 [[MEMBER-1]]';
  const before = JSON.stringify(revision);
  const projection = matterProjection(['MAT-formal']); projection.basis = 'CURRENT_RELATIONSHIPS';
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SummaryEngineeringCatalog, {
    revision, matterCatalog: projection, readingRoute: (route: string) => route,
    renderMarkdown: (body: string): ReactNode => createElement('div', null, body),
  })));
  expect(html.match(/data-matter-id=/gu)).toHaveLength(1);
  expect(html).toContain('正式事项 1');
  expect(html).toContain('### 仅版本 1.2，构型 B 不适用，SB 尚未发布。 [[MEMBER-1]]');
  expect(html).toContain('未关闭，SB TBD；12 项未核，OPS 无设定日期。 [[MEMBER-1]]');
  expect(html).toContain('仅构型 A，构型 B 不适用。 [[MEMBER-1]]');
  expect(html).toContain('subjectId=WI-1&amp;workRef=JAWR-1');
  expect(html.indexOf('仅构型 A，构型 B 不适用。')).toBeLessThan(html.indexOf('aria-label="事项导航"'));
  expect(html).toContain('当前登记关系；此保存正文未封存事项归属。');
  expect(JSON.stringify(revision)).toBe(before);
});

test('current relations cannot retrospectively split an old mixed report or turn technical status into engineering closure', () => {
  const revision = summaryRevision();
  revision.content.body = '## 条目：旧文件标题\n\n### 当前状态\nFTD 已发布；另一问题未关闭，SB TBD。 [[MEMBER-1]]';
  const projection = matterProjection(['MAT-A', 'MAT-B']); projection.basis = 'CURRENT_RELATIONSHIPS';
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SummaryEngineeringCatalog, {
    revision, matterCatalog: projection, readingRoute: (route: string) => route,
    renderMarkdown: (body: string): ReactNode => createElement('div', null, body),
  })));
  expect(html.match(/data-matter-id=/gu)).toHaveLength(2);
  expect(html).not.toContain('<dt>当前状态</dt><dd>—</dd>');
  expect(html).toContain('本层已保存正文');
  expect(html.match(/另一问题未关闭，SB TBD/gu)).toHaveLength(1);
  expect(html).not.toContain('已关闭');
});

test('explicit progress precedes publication details without inventing a state for an unmentioned Matter', () => {
  const revision = summaryRevision();
  revision.content.body = '## 事项：MAT-A | 配置报告异常\n\n### FTD / SL / SB\nSB TBD。'
    + '\n\n### 当前进展\n未记载关闭。\n\n### 背景\n构型 B 不适用。';
  const before = JSON.stringify(revision);
  const entry = summaryEntryCatalog(revision.content).entries[0];
  expect(entry.previews.map(preview => preview.label)).toEqual(['当前进展', 'FTD / SL / SB']);
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SummaryEngineeringCatalog, {
    revision, matterCatalog: matterProjection(['MAT-A', 'MAT-B']), readingRoute: (route: string) => route,
    renderMarkdown: (body: string): ReactNode => createElement('div', null, body),
  })));
  expect(html).toContain('此保存版本未记录该事项正文。');
  expect(html).not.toContain('<dd>—</dd>');
  expect(html.indexOf('未记载关闭。')).toBeLessThan(html.indexOf('SB TBD。'));
  expect(JSON.stringify(revision)).toBe(before);
});

test.each(['ATA4', 'ATA2', 'FLEET'] as const)('the admitted %s task instruction feeds the existing body SAVE contract', level => {
  const instruction: string = wikiLayerInstruction(level);
  expect(instruction).toContain('## 事项：matterId | 事项名称');
  expect(instruction).toContain('不把每个文件或子Wiki各建一条');
  expect(instruction).toContain('### 当前状态');
  expect(instruction).toContain('### FTD / SL / SB');
  expect(instruction).toContain('已有FTD不代表问题关闭');
  expect(instruction).toContain('文档版本选择由Host已有算法决定');
  expect(instruction).not.toContain('body依次使用“## 结论与主要影响”');
});
