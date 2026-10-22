import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { JSDOM } from 'jsdom';

let outputDirectory;
let SummaryMarkdown;
let SummaryEngineeringCatalog;
let SummaryReadingConditions;
let summaryWikiReadingConditions;
let parseSummaryContent;
let summaryCitations;
before(async () => {
  const root = resolve(import.meta.dirname, '../..');
  await mkdir(join(root, 'tmp'), { recursive: true });
  outputDirectory = await mkdtemp(join(root, 'tmp/wiki-reading-markdown-'));
  const output = join(outputDirectory, 'renderer.mjs');
  await build({ stdin: { contents: [
    "export { default as SummaryMarkdown } from './client/src/features/derived-summary/SummaryMarkdown.tsx';",
    "export { default as SummaryEngineeringCatalog } from './client/src/features/derived-summary/SummaryEngineeringCatalog.tsx';",
    "export { SummaryReadingConditions } from './client/src/features/derived-summary/SummaryReadingPresentation.tsx';",
    "export { summaryWikiReadingConditions } from './client/src/features/derived-summary/summary-reading-presentation.ts';",
    "export { parseSummaryContent, summaryCitations } from './server/modules/canonical-host/derived-summary.validation.ts';",
  ].join('\n'), resolveDir: root, sourcefile: 'wiki-reading-test.ts', loader: 'ts' },
    outfile: output, absWorkingDir: root, bundle: true, platform: 'node', format: 'esm',
    packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
  ({ SummaryMarkdown, SummaryEngineeringCatalog, SummaryReadingConditions, summaryWikiReadingConditions,
    parseSummaryContent, summaryCitations } = await import(pathToFileURL(output).href));
});
after(async () => { if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true }); });

function render(body, onCitation = () => {}) {
  return createElement(SummaryMarkdown, { body,
    citationLabel: reference => reference === 'SOURCE-A' ? 'Synthetic source A / revision 1.2' : undefined,
    onCitation });
}

function renderCatalog(body, onCitation = () => {}, headline = 'B787 ATA45-00 汇总：配置报告异常', matterIds = ['MAT-1']) {
  const revision = { scope: { kind: 'ATA4', fleetFamilyId: 'B787', ata2: '45', ata4: '45-00' },
    content: { headline, listBrief: '软件 1.2，SB TBD。', body, limitations: [] }, members: [] };
  summaryCitations(parseSummaryContent(revision.content), new Set(['SOURCE-A']));
  return createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, createElement(SummaryEngineeringCatalog, { revision,
    matterCatalog: { basis: body.includes('## 事项：') ? 'SAVED_INPUT' : 'CURRENT_RELATIONSHIPS',
      catalog: { schemaVersion: 'wiselink.wiki-matter-catalog.v1', entries: matterIds.map(matterId => ({ matterId,
        matterRevisionId: `MREV-${matterId}`, title: '配置报告异常', bindings: [{ memberRef: 'SOURCE-A',
          leaf: { kind: 'DOCUMENT_READING', documentVersionId: 'DV-1', parseRunId: 'PARSE-1', semanticRevision: 2,
            readingRunRef: 'DRR-1', readingRevision: 1 }, sourceRefs: ['SOURCE-A'], association: { kind: 'MATTER_WORK' } }] })), unbound: [] } },
    readingRoute: route => route, renderMarkdown: fragment => createElement(SummaryMarkdown, { body: fragment,
      citationBody: body, citationLabel: reference => reference === 'SOURCE-A' ? 'Exact saved revision 1.2' : undefined,
      onCitation, foldSupportingSections: true }) }));
}

test('a legacy saved headline retains its condition and exact citation in separate default history reading', () => {
  const body = '**Status 与最终措施**：SB TBD，未关闭。 [[SOURCE-A]]\n\n'
    + '[doc]: https://synthetic.invalid/original?parseRunId=PARSE-r1&semanticRevision=2';
  const headline = '仅版本 1.2，构型 B 不适用，SB 尚未发布。 [[SOURCE-A]] [原件][doc]';
  const dom = new JSDOM(renderToStaticMarkup(renderCatalog(body, () => {}, headline)));
  const originalTitle = dom.window.document.querySelector('.summary-saved-reading h3');
  assert.match(originalTitle?.textContent ?? '', /仅版本 1\.2，构型 B 不适用，SB 尚未发布/);
  assert.equal(originalTitle?.querySelector('button.summary-citation')?.textContent, '[1]');
  assert.equal(originalTitle?.querySelector('a')?.getAttribute('href'), 'https://synthetic.invalid/original?parseRunId=PARSE-r1&semanticRevision=2');
  assert.doesNotMatch(originalTitle?.textContent ?? '', /\[\[SOURCE-A\]\]/);
  assert.equal(dom.window.document.querySelectorAll('[data-matter-id]').length, 1);
  dom.window.close();
});

function defaultReadingText(node) {
  if (node.nodeType === 3) return node.textContent;
  const children = node.tagName === 'DETAILS' && !node.open
    ? [node.querySelector(':scope > summary')].filter(Boolean) : [...node.childNodes];
  return children.map(defaultReadingText).join('');
}

test('legacy facts are visible before current navigation; the same DVI can still navigate two distinct Matters', () => {
  const body = '**背景**：单系统配置上行影响 ACARS 与 BROADBAND；所有系统请求不受影响。 [[SOURCE-A]]'
    + '\n\n**Status 与最终措施**：仅生产与实验室识别，未收到在役报告；SB TBD，OPS 无设定日期。 [[SOURCE-A]]'
    + '\n\n**临时措施**：GPM 重启；副作用未核。 [[SOURCE-A]]';
  const dom = new JSDOM(renderToStaticMarkup(renderCatalog(body, () => {}, '历史保存认识', ['MAT-A', 'MAT-B'])));
  const document = dom.window.document;
  const visible = defaultReadingText(document.body);
  assert.match(visible, /SB TBD，OPS 无设定日期/);
  assert.match(visible, /所有系统请求不受影响/);
  assert.match(visible, /GPM 重启；副作用未核/);
  assert.doesNotMatch(visible, /当前状态|配置报告异常/);
  assert.equal(document.querySelector('.summary-saved-reading')?.closest('details'), null);
  assert.equal(document.querySelectorAll('[data-matter-id]').length, 2);
  assert.equal(document.querySelectorAll('a[href="/matters/MAT-A"]').length, 1);
  assert.equal(document.querySelectorAll('a[href="/matters/MAT-B"]').length, 1);
  const sources = [...document.querySelectorAll('a[href^="/document-versions/"]')];
  assert.equal(sources.length, 2);
  assert.equal(sources[0].getAttribute('href'), sources[1].getAttribute('href'));
  assert.match(sources[0].getAttribute('href'), /readingRunRef=DRR-1/);
  assert.equal(document.querySelector('[aria-label="事项导航"]')?.open, false);
  assert.equal(document.querySelector('.summary-saved-reading [data-matter-id]'), null);
  dom.window.close();
});

test('saved Matter background and measures are default reading while only its sources fold', () => {
  const body = '## 事项：MAT-1 | 配置异常\n\n### 当前进展\n未关闭，SB TBD。 [[SOURCE-A]]'
    + '\n\n### 背景\n仅版本 1.2；1.3 未核。 [[SOURCE-A]]\n\n### 分析\n12 项不等于 13 项。'
    + '\n\n### 临时措施\n构型 B 不适用。\n\n### 最终措施\nOPS 更新无设定日期。'
    + '\n\n### 依据与来源\n同一根原文。 [[SOURCE-A]]';
  const dom = new JSDOM(renderToStaticMarkup(renderCatalog(body)));
  const document = dom.window.document;
  const visible = defaultReadingText(document.body);
  for (const text of ['未关闭，SB TBD', '仅版本 1.2；1.3 未核', '12 项不等于 13 项', '构型 B 不适用', 'OPS 更新无设定日期'])
    assert.ok(visible.includes(text), text);
  assert.doesNotMatch(visible, /同一根原文/);
  assert.equal(document.querySelector('.summary-entry-body')?.closest('details'), null);
  assert.ok(document.querySelector('[data-matter-id="MAT-1"] .summary-entry-detail'));
  assert.equal(document.querySelectorAll('.summary-citation').length, 3);
  dom.window.close();
});

test('processing records retain their exact saved source pin while engineering conditions stay visible', () => {
  const parser = '文档解析采用 PDFJS_TEXT_LAYER 提取；"Other Model(s)" 为空白，无法判定其他机型相关性；-8/-9/-10。';
  const dependency = '本次尚未完成的下层依赖：三份 DOCUMENT 类保存评估仍为 SAVED_ASSESSMENT_NOT_READY'
    + '（subjectId family_fixture，requestId 含 JA-save-first、JA-save-second 等），不得宣称已覆盖这些新工作。';
  const revision = { content: { limitations: [parser, dependency, 'SB TBD，11/04/2027 不是实际完成日。'] },
    members: [{ limitations: [parser, dependency], headline: '确切子层', member: {
      kind: 'DERIVED_SUMMARY', summaryId: 'DS-child', summaryRef: 'DSR-r4', summaryRevision: 4,
    } }] };
  const before = JSON.stringify(revision);
  const groups = summaryWikiReadingConditions(revision);
  const dom = new JSDOM(renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(SummaryReadingConditions, { conditions: groups.engineering, records: groups.records,
      readingRoute: route => route + '&returnWikiGuideQuery=preserved' }))));
  const document = dom.window.document;
  const visible = defaultReadingText(document.body);
  assert.match(visible, /无法判定其他机型相关性；-8\/-9\/-10/);
  assert.match(visible, /SB TBD，11\/04\/2027 不是实际完成日/);
  assert.doesNotMatch(visible, /PDFJS_TEXT_LAYER|SAVED_ASSESSMENT_NOT_READY|JA-save-first/);
  const records = document.querySelector('[aria-label="处理与范围记录"]');
  assert.equal(records.open, false);
  assert.match(records.textContent, /JA-save-first、JA-save-second/);
  assert.ok(records.querySelector('a')?.getAttribute('href')?.includes('summaryRef=DSR-r4&returnWikiGuideQuery=preserved'));
  assert.equal(JSON.stringify(revision), before);
  dom.window.close();
});

test('the saved heading keeps its accepted exact citation while the formal name stays Host-owned', () => {
  const body = '## 事项：MAT-1 | 配置报告异常 [[SOURCE-A]]\n\n### 当前状态\n未关闭，SB 未发布。'
    + '\n\n### 工程条件与待核事项\n仅 OPS 1.2，OPS 1.3 未确认适用。';
  const dom = new JSDOM(renderToStaticMarkup(renderCatalog(body)));
  assert.equal(dom.window.document.querySelector('.summary-entry-title h3')?.textContent, '配置报告异常');
  const title = dom.window.document.querySelector('[aria-label="保存正文标题"] h4');
  assert.equal(title?.querySelector('button.summary-citation')?.textContent, '[1]');
  assert.doesNotMatch(title?.textContent ?? '', /\[\[SOURCE-A\]\]/);
  assert.match(dom.window.document.body.textContent, /OPS 1\.3 未确认适用/);
  dom.window.close();
});

test('an accepted model heading cannot rename a formal Matter or promote its false closure label into status', () => {
  const exactSource = 'https://synthetic.invalid/original?parseRunId=PARSE-r1&semanticRevision=2';
  const title = '另一个事项的名称（已关闭）；仅版本 1.2，构型 B 不适用。 [原件][doc] [[SOURCE-A]]';
  const body = `## 事项：MAT-1 | ${title}\n\n### 当前状态\n未关闭；SB TBD。 [[SOURCE-A]]\n\n`
    + `### 依据与来源\n[doc]: <${exactSource}>`;
  const before = body;
  const dom = new JSDOM(renderToStaticMarkup(renderCatalog(body)));
  const row = dom.window.document.querySelector('[data-matter-id="MAT-1"]');
  assert.equal(row?.querySelector('.summary-entry-title')?.textContent, '配置报告异常');
  assert.doesNotMatch(row?.querySelector('.summary-entry-progress')?.textContent ?? '', /已关闭|另一个事项/);
  assert.match(row?.querySelector('.summary-entry-progress')?.textContent ?? '', /未关闭；SB TBD/);
  const savedTitle = row?.querySelector('[aria-label="保存正文标题"]');
  assert.match(savedTitle?.textContent ?? '', /另一个事项的名称（已关闭）；仅版本 1\.2，构型 B 不适用/);
  assert.equal(savedTitle?.querySelector('button.summary-citation')?.textContent, '[1]');
  assert.equal(savedTitle?.querySelector('a')?.getAttribute('href'), exactSource);
  assert.equal([...row.querySelectorAll('a')].find(link => link.textContent === '打开工程事项')?.getAttribute('href'), '/matters/MAT-1');
  assert.equal(body, before);
  dom.window.close();
});

test('status, titles and detail retain full-document multiline and nested reference definitions with original precedence', () => {
  const source = 'https://synthetic.invalid/original?parseRunId=PARSE-r1&semanticRevision=2';
  const nested = 'https://synthetic.invalid/nested?version=1.2';
  const body = '## 事项：MAT-1 | [配置报告异常][doc] [[SOURCE-A]]\n\n### 当前状态\n未关闭；按[准确原件修订1.2][doc]和[nested]核对。 [[SOURCE-A]]'
    + '\n\n### 背景\n配置 B 不适用。\n\n### 依据与来源\n'
    + `[doc]: <${source}>\n  "Exact revision 1.2"\n\n`
    + `> 来源侧一次说明。\n>\n> [nested]: ${nested}\n\n`
    + '[doc]: https://synthetic.invalid/wrong-later-duplicate\n\n'
    + '```markdown\n[nested]: https://synthetic.invalid/wrong-code-example\n```';
  const dom = new JSDOM(renderToStaticMarkup(renderCatalog(body)));
  const document = dom.window.document;
  const links = [...document.querySelectorAll('a')];
  assert.equal(document.querySelector('[aria-label="保存正文标题"] a')?.getAttribute('href'), source);
  assert.equal(document.querySelector('dd a')?.getAttribute('href'), source);
  assert.equal(document.querySelector('dd a')?.getAttribute('title'), 'Exact revision 1.2');
  assert.equal(links.filter(link => link.getAttribute('href') === nested).length, 1);
  assert.equal(links.filter(link => link.getAttribute('href')?.includes('wrong-')).length, 0);
  assert.equal((document.body.textContent.match(/来源侧一次说明/gu) ?? []).length, 1);
  assert.equal(document.querySelectorAll('button.summary-citation').length, 2);
  assert.doesNotMatch(document.querySelector('dd')?.textContent ?? '', /\[doc\]|\[nested\]/);
  dom.window.close();
});

test('an incomplete code block in the visible fragment cannot consume earlier full-document definitions', () => {
  const context = '[doc]: https://synthetic.invalid/exact\n\n## 事项：MAT-1 | 配置异常\n\n### 当前状态\n未关闭；按[原件][doc]核对。 [[SOURCE-A]]'
    + '\n\n### 背景\n```text\nunclosed code';
  const dom = new JSDOM(renderToStaticMarkup(createElement(SummaryMarkdown, {
    body: '未关闭；按[原件][doc]核对。 [[SOURCE-A]]\n\n```text\nunclosed code', citationBody: context,
    citationLabel: () => 'Exact source', onCitation: () => {},
  })));
  assert.equal(dom.window.document.querySelector('a')?.getAttribute('href'), 'https://synthetic.invalid/exact');
  assert.equal(dom.window.document.querySelector('button.summary-citation')?.textContent, '[1]');
  assert.equal(dom.window.document.querySelector('code')?.textContent, 'unclosed code\n');
  dom.window.close();
});

test('engineering footnotes stay available when their definition is outside the status fragment', () => {
  const body = '## 事项：MAT-1 | 配置异常\n\n### 当前状态\n仅构型 A[^condition]。 [[SOURCE-A]]'
    + '\n\n### 依据与来源\n[^condition]: 构型 B 不适用，12 项不是 13 项。';
  const dom = new JSDOM(renderToStaticMarkup(renderCatalog(body)));
  const status = dom.window.document.querySelector('.summary-entry-progress-content');
  assert.ok(status?.querySelector('sup a'), status?.outerHTML);
  assert.match(status?.textContent ?? '', /构型 B 不适用，12 项不是 13 项/);
  assert.doesNotMatch(status?.textContent ?? '', /\[\^condition\]/);
  dom.window.close();
});

test('a long progress paragraph is visually compact and expands unchanged with its exact citation', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://synthetic.invalid/' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const container = dom.window.document.getElementById('root');
  const root = createRoot(container);
  const status = 'SB TBD，OPS 无设定日期；11/04/2027 不是实际完成日；版本 1.2 未关闭，版本 1.3 未确认适用。 '
    + 'Reference Categories 保留原文。文件生成时间及出口声明保留。 [[SOURCE-A]]';
  const body = '**Status 与最终措施**：' + status + '\n\n**背景**：仅配置 A。';
  const selected = [];
  try {
    await act(async () => root.render(renderCatalog(body, reference => selected.push(reference))));
    const progress = container.querySelector('.summary-entry-progress-content');
    const toggle = container.querySelector('button[aria-controls]');
    const before = progress.textContent;
    assert.equal(progress.classList.contains('line-clamp-3'), true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(toggle.getAttribute('aria-controls'), progress.id);
    assert.match(before, /版本 1\.2 未关闭，版本 1\.3 未确认适用/);
    assert.equal(progress.querySelectorAll('button.summary-citation').length, 1);
    await act(async () => toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(progress.classList.contains('line-clamp-3'), false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(progress.textContent, before);
    await act(async () => toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(progress.classList.contains('line-clamp-3'), true);
    await act(async () => progress.querySelector('.summary-citation')
      .dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true })));
    assert.equal(progress.classList.contains('line-clamp-3'), false);
    await act(async () => progress.querySelector('.summary-citation')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.deepEqual(selected, ['SOURCE-A']);
    assert.equal(progress.textContent, before);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('actual Streamdown renders headings, paragraphs, emphasis and GFM tables without altering prose', () => {
  const body = '# Synthetic reading\n\n**Required condition**: version 1.2 is unverified. [[SOURCE-A]]\n\n'
    + 'Version 1.3 differs; 12 does not mean 13.\n\n| Source | State |\n| --- | --- |\n| A | Unknown |\n| B | Not read |';
  const dom = new JSDOM(renderToStaticMarkup(render(body)));
  assert.equal(dom.window.document.querySelector('h1')?.textContent, 'Synthetic reading');
  assert.equal(dom.window.document.querySelector('strong')?.textContent, 'Required condition');
  assert.equal(dom.window.document.querySelectorAll('p').length, 2);
  assert.equal(dom.window.document.querySelectorAll('table tbody tr').length, 2);
  assert.match(dom.window.document.body.textContent, /1\.2 is unverified/);
  assert.match(dom.window.document.body.textContent, /1\.3 differs; 12 does not mean 13/);
  assert.equal(dom.window.document.querySelector('button')?.textContent, '[1]');
  assert.match(body, /\*\*Required condition\*\*/);
  dom.window.close();
});

test('repeated exact citations remain clickable; code stays literal and missing refs remain explicit', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://synthetic.invalid/' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const container = dom.window.document.getElementById('root');
  const root = createRoot(container);
  const selected = [];
  try {
    await act(async () => root.render(render('**Condition [[SOURCE-A]]**; again [[SOURCE-A]]. '
      + '`[[SOURCE-A]]` stays literal. [[MISSING]]', reference => selected.push(reference))));
    const buttons = [...container.querySelectorAll('button')];
    assert.equal(buttons.length, 2);
    assert.deepEqual(buttons.map(button => button.textContent), ['[1]', '[1]']);
    assert.equal(container.querySelector('code')?.textContent, '[[SOURCE-A]]');
    assert.equal(container.querySelector('[role="alert"]')?.textContent, '［依据无法读回］');
    await act(async () => buttons[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.deepEqual(selected, ['SOURCE-A']);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('sanitization keeps scripts, event handlers, unsafe links and remote images out of the DOM', () => {
  const body = '<script>throw Error("bad")</script>\n\n<img src="https://remote.invalid/pixel" onerror="alert(1)">'
    + '\n\n![Synthetic diagram](https://remote.invalid/image.png)\n\n[x](javascript:alert(1))'
    + '\n\n<iframe src="https://remote.invalid/frame"></iframe>';
  const dom = new JSDOM(renderToStaticMarkup(render(body)));
  assert.equal(dom.window.document.querySelectorAll('script,iframe,img,object,embed').length, 0);
  assert.equal(dom.window.document.querySelectorAll('[onerror],[onclick],[onload]').length, 0);
  assert.equal([...dom.window.document.querySelectorAll('a')].some(link =>
    link.getAttribute('href')?.startsWith('javascript:')), false);
  assert.match(dom.window.document.body.textContent, /Synthetic diagram/);
  dom.window.close();
});

test('explicit supporting sections fold after full Markdown parsing; engineering headings stay outside', () => {
  const body = '## 结论与主要影响\n\n版本1.2未确认适用。 [原文][doc] [[SOURCE-A]]\n\n'
    + '## 建议行动\n\n先核对12项；13项是另一范围。\n\n'
    + '## 依据与来源\n\n根来源A；同源复用。 [[SOURCE-A]]\n\n'
    + '[doc]: https://synthetic.invalid/original\n\n'
    + '### 工程条件与分歧\n\n软件1.3并未确认；来源B仍未取得。\n\n'
    + '## 生成记录\n\n已保存修订2。';
  const dom = new JSDOM(renderToStaticMarkup(createElement(SummaryMarkdown, { body,
    foldSupportingSections: true, citationLabel: () => 'Synthetic source A', onCitation: () => {} })));
  const document = dom.window.document;
  const details = [...document.querySelectorAll('details')];
  assert.deepEqual(details.map(value => value.querySelector('summary')?.textContent), ['依据与来源', '生成记录']);
  assert.ok(details.every(value => !value.open));
  const condition = [...document.querySelectorAll('p')].find(value => value.textContent.includes('软件1.3'));
  assert.equal(condition?.closest('details'), null);
  assert.equal(document.querySelector('a')?.getAttribute('href'), 'https://synthetic.invalid/original');
  assert.deepEqual([...document.querySelectorAll('button')].map(value => value.textContent), ['[1]', '[1]']);
  assert.match(document.body.textContent, /12项；13项是另一范围/);
  dom.window.close();
});

test('unlabelled legacy paragraphs, bold labels and engineering negations stay visible in their original order', () => {
  const paragraphs = ['本层汇总来源A和来源B。', '**故障机理与触发条件**：只在软件1.2且安装件号P-12时发生。',
    '**恢复与预防措施**：措施尚未实施。', '**方法条款约束**：不能把零报告当成零可能。',
    '**决定性条件**：来源B未取得，软件1.3不在本次范围。'];
  const body = paragraphs.join('\n\n');
  const dom = new JSDOM(renderToStaticMarkup(createElement(SummaryMarkdown, { body,
    foldSupportingSections: true, citationLabel: () => undefined, onCitation: () => {} })));
  assert.equal(dom.window.document.querySelector('details'), null);
  assert.deepEqual([...dom.window.document.querySelectorAll('p')].map(value => value.textContent),
    paragraphs.map(value => value.replaceAll('**', '')));
  dom.window.close();
});

test('actual summary body opens the selected saved member and retains its exact route; unmount removes the preview', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://synthetic.invalid/', pretendToBeVisual: true,
  });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const container = dom.window.document.getElementById('root');
  let root;
  try {
    const project = resolve(import.meta.dirname, '../..');
    const output = join(outputDirectory, 'summary-body.mjs');
    await build({ entryPoints: [join(project, 'client/src/features/derived-summary/DerivedSummaryBody.tsx')],
      outfile: output, absWorkingDir: project, bundle: true, platform: 'node', format: 'esm',
      packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent', plugins: [{
        name: 'deny-original-dialog-io-in-component-test',
        setup(builder) {
          builder.onResolve({ filter: /MatterDocumentSourceDialog$/ }, () => ({ path: 'original-dialog', namespace: 'deny-io' }));
          builder.onLoad({ filter: /.*/, namespace: 'deny-io' }, () => ({
            contents: 'export default function OriginalDialog(){throw Error("UNEXPECTED_ORIGINAL_IO");}', loader: 'js',
          }));
        },
      }] });
    const Body = (await import(pathToFileURL(output).href)).default;
    const revision = { content: { headline: 'Synthetic parent', listBrief: '**Main impact** [[MEMBER-A]]',
      body: '**Parent condition** [[MEMBER-A]]' }, evidence: [], members: [{
      member: { kind: 'DERIVED_SUMMARY', summaryId: 'DS-child', summaryRef: 'DSR-child-r4', summaryRevision: 4 },
      evidenceRef: 'MEMBER-A', headline: 'Synthetic saved child', body: '**Exact child**: version 1.2 is unverified.', evidence: [],
    }] };
    const before = JSON.stringify(revision);
    root = createRoot(container);
    await act(async () => root.render(createElement(MemoryRouter, {
      initialEntries: ['/summaries/DS-parent?summaryRef=DSR-parent-r2'],
      future: { v7_startTransition: true, v7_relativeSplatPath: true },
    }, createElement(Body, { revision }))));
    assert.equal(container.querySelector('.summary-reading-brief strong')?.textContent, 'Main impact');
    assert.deepEqual([...container.querySelectorAll('.summary-citation')].map(value => value.textContent), ['[1]', '[1]']);
    assert.ok(container.textContent.indexOf('Main impact') < container.textContent.indexOf('Parent condition'));
    await act(async () => container.querySelector('.summary-citation')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    const dialog = dom.window.document.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.equal(dialog.querySelector('strong')?.textContent, 'Exact child');
    const link = [...dialog.querySelectorAll('a')].find(value => value.textContent === '阅读确切成员版本');
    assert.equal(link?.getAttribute('href'), '/summaries/DS-child?summaryRef=DSR-child-r4');
    assert.equal(JSON.stringify(revision), before);
    await act(async () => root.render(createElement(MemoryRouter, {
      future: { v7_startTransition: true, v7_relativeSplatPath: true },
    }, createElement(Body, { key: 'exact-opening', revision: { ...revision,
      content: { ...revision.content, listBrief: revision.content.body } } }))));
    assert.equal(container.querySelector('.summary-reading-brief'), null);
    assert.equal(container.querySelectorAll('.summary-citation').length, 1);
    await act(async () => root.render(createElement(MemoryRouter, {
      future: { v7_startTransition: true, v7_relativeSplatPath: true },
    }, createElement(Body, { key: 'wiki-processing-record', revision, wikiCatalog: true,
      processingRecords: ['本层为派生候选，非新增独立证据。 [[MEMBER-A]]'] }))));
    const processing = container.querySelector('[aria-label="正文处理记录"]');
    assert.equal(processing?.open, false);
    assert.doesNotMatch(defaultReadingText(container), /本层为派生候选/);
    assert.equal(processing?.querySelector('.summary-citation')?.textContent, '[1]');
    await act(async () => processing.querySelector('.summary-citation')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.match(dom.window.document.querySelector('[role="dialog"]')?.textContent ?? '', /Exact child/);
    assert.match(dom.window.document.querySelector('[role="dialog"] a')?.getAttribute('href') ?? '', /summaryRef=DSR-child-r4/);
    assert.equal(JSON.stringify(revision), before);
    await act(async () => root.render(null));
    assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
    assert.doesNotMatch(dom.window.document.body.textContent, /Exact child/);
  } finally {
    await act(async () => root?.unmount());
    // Radix restores focus in a deferred unmount callback; keep this DOM's Event constructors alive until it runs.
    await act(async () => { await new Promise(resolveTimer => setTimeout(resolveTimer, 0)); });
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
