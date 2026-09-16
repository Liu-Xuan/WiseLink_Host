import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../../client/src/features/trinity/trinity.css', () => ({}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/badge', () => ({ Badge: 'span' }));
jest.mock('@client/src/components/ui/select', () => ({
  Select: 'div',
  SelectTrigger: 'button',
  SelectValue: 'span',
  SelectContent: 'div',
  SelectItem: 'div',
}));

import TrinitySituationView from '../../client/src/features/trinity/TrinitySituationView';
import { TRINITY_SAMPLE_FIXTURE } from '../../client/src/features/trinity/trinity-fixture';

function render(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(TrinitySituationView, { data: TRINITY_SAMPLE_FIXTURE, ...props }),
  );
}

describe('Trinity situation view static render', () => {
  it('renders the dual-ring board with the contracted SVG geometry', () => {
    const html = render();
    expect(html).toContain('viewBox="0 0 1000 610"');
    expect(html).toContain('cx="500" cy="305" rx="378" ry="234"');
    expect(html).toContain('cx="500" cy="305" rx="210" ry="136"');
    expect(html).toContain('data-geometry="ring-board"');
    expect(html).toContain('data-geometry="agent-core"');
  });

  it('renders 8 lifecycle stages and 6 knowledge nodes on desktop and mobile', () => {
    const html = render();
    expect((html.match(/data-stage="/g) ?? []).length).toBe(16);
    expect((html.match(/data-kstage="/g) ?? []).length).toBe(12);
    for (const stage of TRINITY_SAMPLE_FIXTURE.stages) {
      expect(html).toContain(`data-stage="${stage.id}"`);
    }
    for (const k of TRINITY_SAMPLE_FIXTURE.knowledgeStages) {
      expect(html).toContain(`data-kstage="${k.id}"`);
    }
  });

  it('shows deduplicated totals, never approval or completion rates', () => {
    const html = render();
    expect(html).toContain('<b>16</b>');
    expect(html).toContain('class="warm-number">6</b>');
    expect(html).toContain('可见工程事项');
    expect(html).toContain('有条件需继续核对');
    expect(html).toContain('已有知识工作');
    expect(html).toContain('有关效果观察');
    expect(html).not.toContain('审批');
    expect(html).not.toContain('完成率');
  });

  it('keeps per-stage association counts separate from totals', () => {
    const html = render();
    expect(html).toContain('4 项关联事项');
    expect(html).toContain('3 项关联事项');
    expect(html).toContain('同一事项可在多个环节并行，阶段数量不相加作总数。');
  });

  it('renders the three view entries in the page head', () => {
    const html = render();
    expect(html).toContain('data-view="situation"');
    expect(html).toContain('data-view="timeline"');
    expect(html).toContain('data-view="graph"');
    expect(html).toContain('工程态势');
  });

  it('switches to the focus strip and per-matter stage labels at focus level', () => {
    const html = render({ level: 'focus', focusMatterId: 'm1' });
    expect(html).toContain('EM-26-001 · 显示系统间歇复位与验证资料跟踪');
    expect(html).toContain('查看历程');
    expect(html).toContain('阅读事项');
    expect(html).toContain('当前有工作在此环节');
    expect(html).toContain('无当前阶段记录');
    expect(html).not.toContain('class="metrics"');
  });

  it('shows the stage panel with associated matters when a stage is selected', () => {
    const html = render({ selectedStageId: 'track' });
    expect(html).toContain('ring-bridge on');
    expect(html).toContain('跟踪与界定');
    expect(html).toContain('当前关联事项');
    expect(html).toContain('表格查看');
    expect(html).toContain('查看知识产出');
  });

  it('shows the knowledge ring panel when a knowledge node is selected', () => {
    const html = render({ selectedKnowledgeId: 'acquire' });
    expect(html).toContain('知识环 · 来自业务，反哺业务');
    expect(html).toContain('外部系统、知识库、工程文档和原生记录，以实际授权及源身份取得。');
    expect(html).toContain('不是第二套知识审批');
    expect(html).toContain('进入统一知识查阅');
  });

  it('renders recent events and knowledge works with real fixture text', () => {
    const html = render();
    expect(html).toContain('最近的工程进展');
    expect(html).toContain('问题工作已更新，综合待接续');
    expect(html).toContain('示例资料截至 2026-09-16');
    expect(html).toContain('工作形成的知识');
    expect(html).toContain(TRINITY_SAMPLE_FIXTURE.knowledge[0].title);
  });

  it('renders an honest empty state without fabricating numbers when data is absent', () => {
    const html = renderToStaticMarkup(createElement(TrinitySituationView, { data: null }));
    expect(html).toContain('正在取得授权资料，当前只展示固定环结构。');
    expect(html).toContain('data-geometry="ring-board"');
    expect(html).toMatch(/data-geometry="ring-board"[\s\S]*viewBox="0 0 1000 610"/);
    expect(html).toContain('—');
  });
});

describe('Trinity motion and theme adaptation (css evidence)', () => {
  const css = readFileSync(
    join(__dirname, '../../client/src/features/trinity/trinity.css'),
    'utf8',
  );

  it('respects reduced motion and reduced transparency', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation: none !important');
    expect(css).toContain('[data-wl-transparency="reduce"]');
  });

  it('adapts the three effect tiers through the shared theme attributes', () => {
    expect(css).toContain('[data-wl-visual-mode="ultra"]');
    expect(css).toContain('[data-wl-visual-mode="compatible"]');
    expect(css).toContain('--tr-core-glow');
  });

  it('collapses the ring board into the linear mobile layout under 640px', () => {
    expect(css).toContain('@media (max-width: 639px)');
    expect(css).toContain('.trinity-situation .ring-board { display: none; }');
    expect(css).toContain('.trinity-situation .mobile-rings { display: block;');
    expect(css).toContain('@media (max-width: 1199px)');
    expect(css).toContain('.trinity-situation .situation-grid { grid-template-columns: 1fr; }');
  });

  it('maps trinity tokens to the wl design tokens instead of hardcoded palette', () => {
    expect(css).toContain('--tr-ring-inner: #a4c1b7');
    expect(css).toContain('var(--wl-amber-ink)');
    expect(css).toContain('var(--wl-accent)');
    expect(css).toContain('var(--wl-sheet)');
    expect(css).not.toContain('#5b8def');
  });
});


describe('Trinity data coverage isolation', () => {
  it.each(['denied', 'failed', 'loading'])('clears old focus content when availability becomes %s', (availability) => {
    const html = render({data: {...TRINITY_SAMPLE_FIXTURE, availability}, level: 'focus', focusMatterId: 'm1'});
    expect(html).not.toContain(TRINITY_SAMPLE_FIXTURE.matters[0].title);
    expect(html).not.toContain(TRINITY_SAMPLE_FIXTURE.matters[0].brief);
    expect(html).not.toContain('当前有工作在此环节');
    expect(html).not.toContain('无当前阶段记录');
    expect(html).toContain('阶段关联未取得');
  });
  it('blocks independently denied knowledge in metrics and both reading panels', () => {
    const data = {...TRINITY_SAMPLE_FIXTURE, coverage: {knowledge: 'denied'}};
    for (const selectedKnowledgeId of ['', 'acquire']) {
      const html = render({data, selectedKnowledgeId});
      for (const item of data.knowledge) expect(html).not.toContain(item.title);
      expect(html).toContain('<b>—</b>');
      expect(html).toContain('<b>16</b>');
    }
  });
  it('blocks failed events without hiding readable knowledge', () => {
    const data = {...TRINITY_SAMPLE_FIXTURE, coverage: {events: 'failed'}};
    const html = render({data});
    for (const item of data.events) expect(html).not.toContain(item.title);
    expect(html).toContain(data.knowledge[0].title);
    expect(html).toContain('进展记录尚未完整取得');
  });
  it('does not present partial empty scope as known zeros or a complete total', () => {
    const html = render({data: {...TRINITY_SAMPLE_FIXTURE, availability: 'partial', matters: [], knowledge: [], events: []}, selectedStageId: 'assess'});
    expect(html).not.toContain('<b>0</b>');
    expect(html).not.toContain('0 项关联事项');
    expect(html).not.toContain('去重后的当前范围');
    expect(html).toContain('阶段关联尚未完整取得');
  });
});
