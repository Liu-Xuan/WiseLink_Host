import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('../../client/src/features/trinity/trinity.css', () => ({}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/badge', () => ({ Badge: 'span' }));
jest.mock('@client/src/components/ui/select', () => ({
  Select: 'div', SelectTrigger: 'button', SelectValue: 'span',
  SelectContent: 'div', SelectItem: 'div',
}));
jest.mock('@client/src/app/providers/ThemeProvider', () => ({
  useWlTheme: () => ({
    theme: 'light', visualMode: 'default', motionEnabled: true,
    motionPausedByUser: false, systemReducedMotion: false,
    documentHidden: false, setVisualMode: jest.fn(), toggleTheme: jest.fn(),
    toggleMotion: jest.fn(),
  }),
}));

import TrinitySituationView from '../../client/src/features/trinity/TrinitySituationView';
import { TRINITY_SAMPLE_FIXTURE } from '../../client/src/features/trinity/trinity-fixture';

function render(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(TrinitySituationView, {
    data: TRINITY_SAMPLE_FIXTURE, ...props,
  }));
}

describe('source aggregation situation view', () => {
  it('renders the authoritative 1100 x 660 two-ring geometry', () => {
    const html = render();
    expect(html).toContain('viewBox="0 0 1100 660"');
    expect(html).toContain('cx="550" cy="330" rx="465" ry="257"');
    expect(html).toContain('cx="550" cy="330" rx="253" ry="154"');
  });

  it('renders six source categories and six assessment steps on both layouts', () => {
    const html = render();
    expect((html.match(/data-stage="/g) ?? [])).toHaveLength(12);
    expect((html.match(/data-source-category="/g) ?? [])).toHaveLength(12);
    for (const stage of TRINITY_SAMPLE_FIXTURE.stages)
      expect(html).toContain(`data-stage="${stage.id}"`);
    for (const source of TRINITY_SAMPLE_FIXTURE.sourceCategories)
      expect(html).toContain(`data-source-category="${source.id}"`);
    expect(html).not.toContain('发现与接收');
    expect(html).not.toContain('获取来源');
  });

  it('shows deduplicated scope metrics without completion inference', () => {
    const html = render();
    expect(html).toContain('工程事项');
    expect(html).toContain('可查来源');
    expect(html).toContain('待核事项');
    expect(html).toContain('综合待更新');
    expect(html).not.toContain('完成率');
  });

  it('shows current understanding first in focused mode', () => {
    const html = render({ level: 'focus', focusMatterId: 'm1' });
    expect(html).toContain('目前怎样理解');
    expect(html).toContain('会改变判断的条件');
    expect(html).toContain('阅读完整认识');
    expect(html).toContain('已有相关工作');
  });

  it('shows actual source items and explicit unconnected categories', () => {
    expect(render({ selectedSourceId: 'documents' })).toContain('SB-A');
    const empty = render({ level: 'focus', focusMatterId: 'm2',
      selectedSourceId: 'configuration' });
    expect(empty).toContain('当前授权读取未取得这一类材料');
    expect(empty).toContain('缺少记录不表示该类信息不存在');
  });

  it('keeps unknown values unknown when data is unavailable', () => {
    const html = renderToStaticMarkup(createElement(TrinitySituationView, {
      data: null,
    }));
    expect(html).toContain('正在取得授权资料');
    expect(html).toContain('viewBox="0 0 1100 660"');
    expect(html).toContain('>—</b>');
  });
});

describe('situation motion and responsive CSS evidence', () => {
  const css = readFileSync(join(
    __dirname, '../../client/src/features/trinity/trinity.css',
  ), 'utf8');

  it('supports shared visual modes, paused motion and reduced motion', () => {
    expect(css).toContain('[data-wl-visual-mode="ultra"]');
    expect(css).toContain("[data-wl-visual-mode='compatible']");
    expect(css).toContain("[data-motion='paused']");
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('uses the reference aspect ratio and mobile source-before-stage layout', () => {
    expect(css).toContain('aspect-ratio: 1100 / 660');
    expect(css).toContain('.mobile-source-grid');
    expect(css).toContain('@media (max-width: 740px)');
  });
});

describe('coverage isolation', () => {
  it.each(['denied', 'failed', 'loading'])('clears old focus content for %s',
    (availability) => {
      const html = render({ data: { ...TRINITY_SAMPLE_FIXTURE, availability },
        level: 'focus', focusMatterId: 'm1' });
      expect(html).not.toContain(TRINITY_SAMPLE_FIXTURE.matters[0].brief);
      expect(html).toContain('评估关联未取得');
    });

  it('does not turn partial empty reads into zeros', () => {
    const html = render({ data: { ...TRINITY_SAMPLE_FIXTURE,
      availability: 'partial',
      coverage: {
        ...TRINITY_SAMPLE_FIXTURE.coverage,
        matterTotal: 'partial',
        matters: 'partial',
        assessment: 'partial',
        sources: 'partial',
      },
      matters: [], sources: [], knowledge: [], events: [] },
      selectedStageId: 'analysis' });
    expect(html).not.toContain('0 项关联事项');
    expect(html).toContain('评估关联尚未完整取得');
  });
});
