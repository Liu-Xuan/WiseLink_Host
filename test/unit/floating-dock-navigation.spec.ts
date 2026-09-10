import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';

jest.mock('../../client/src/features/navigation/floating-dock.css', () => ({}));
jest.mock('@client/src/app/providers/CurrentObjectContextProvider', () => ({
  useCurrentObjectContext: () => ({ currentObject: null }),
}));
jest.mock('@client/src/components/VisualModeControl', () => () => null);
jest.mock('@client/src/components/WiseLinkBrandMark', () => () => null);

import FloatingDock from '../../client/src/features/navigation/FloatingDock';

function globalNavigation(location: string): string {
  const html: string = renderToStaticMarkup(
    createElement(StaticRouter, { location }, createElement(FloatingDock)),
  );
  return html.match(/<nav[^>]*aria-label="全局导航"[\s\S]*?<\/nav>/)?.[0] ?? '';
}

describe('global library navigation', () => {
  it.each([
    '/',
    '/library',
    '/library?mode=matter',
    '/library?mode=document',
    '/library?mode=tasks',
  ])('keeps one library entry active at %s', (location: string) => {
    const html: string = globalNavigation(location);
    expect(html).toMatch(
      /<a(?=[^>]*class="wl-dock-item is-active")(?=[^>]*aria-label="资料库")(?=[^>]*aria-current="page")/,
    );
    expect(html).not.toContain('工程事项');
    expect(html).not.toContain('最近任务');
    expect(html).toContain('开放式对话');
  });

  it('does not highlight library outside its route', () => {
    expect(globalNavigation('/dialogues')).not.toMatch(
      /<a(?=[^>]*class="wl-dock-item is-active")(?=[^>]*aria-label="资料库")/,
    );
  });

  it('highlights search rather than both entries at the search anchor', () => {
    const html: string = globalNavigation('/library#library-search');
    expect(html).not.toMatch(
      /<a(?=[^>]*class="wl-dock-item is-active")(?=[^>]*aria-label="资料库")/,
    );
    expect(html).toMatch(
      /<a(?=[^>]*class="wl-dock-item is-active")(?=[^>]*aria-label="搜索")/,
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
