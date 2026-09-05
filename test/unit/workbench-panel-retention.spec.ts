import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import RetainedWorkbenchPanel, {
  useWorkbenchPanelActive,
} from '../../client/src/features/workbench/RetainedWorkbenchPanel';

const source = (path: string): string =>
  readFileSync(resolve(__dirname, '../../client/src', path), 'utf8');

describe('visited workbench panels', () => {
  it('does not mount an unvisited heavy child', () => {
    const heavy = jest.fn(() => createElement('p', null, 'heavy content'));
    expect(
      renderToStaticMarkup(
        createElement(RetainedWorkbenchPanel, {
          active: false,
          children: createElement(heavy),
        }),
      ),
    ).toBe('');
    expect(heavy).not.toHaveBeenCalled();
  });

  it('mounts the first active panel and exposes its activity without hiding its editor', () => {
    function Child() {
      return createElement(
        'p',
        null,
        useWorkbenchPanelActive() ? 'active' : 'hidden',
      );
    }
    const html = renderToStaticMarkup(
      createElement(RetainedWorkbenchPanel, {
        active: true,
        children: createElement(Child),
      }),
    );
    expect(html).toContain('<p>active</p>');
    expect(html).not.toContain('hidden=""');
    expect(html).not.toContain('inert=""');
  });

  it('resets retained instances with the authorized session/object shell and hides inactive DOM from interaction', () => {
    const page = source('pages/DocumentParsingPage/DocumentParsingPage.tsx');
    const panel = source('features/workbench/RetainedWorkbenchPanel.tsx');
    const css = source('features/workbench/workbench-shell.css');
    expect(page).toMatch(
      /<WorkbenchShell\s*key=\{`\$\{sessionGeneration\}:\$\{workItemId\}`\}/u,
    );
    for (const node of ['package', 'reader', 'assessment', 'review']) {
      expect(page).toContain(
        `<RetainedWorkbenchPanel active={activeNode === '${node}'}>`,
      );
    }
    expect(panel).toContain('(_previous, next) => !next.active');
    expect(panel).toContain('hidden={!active} inert={!active}');
    expect(css).toMatch(/\.wl-retained-panel\[hidden\]\s*\{\s*display: none;/u);
  });

  it('pauses hidden review polling and PDF observer/page rendering without destroying the loaded PDF document on a tab change', () => {
    const review = source('features/review/ContinuousReviewPanel.tsx');
    const pdf = source('pages/DocumentParsingPage/PdfDocumentViewer.tsx');
    expect(review).toMatch(/if \(\s*!panelActive \|\|\s*!hasActiveExecution/u);
    expect(review).toContain('return () => window.clearTimeout(timer)');
    expect(pdf).toContain('[pageCount, pdfDocument, panelActive]');
    expect(pdf).toContain(
      '[document, highlighted, pageNumber, renderRequested, zoom, panelActive]',
    );
    expect(pdf).toContain('[preview.supportsRange, previewUrl]');
    expect(pdf).toContain('appliedScrollRequestRef.current === scrollRequest');
  });

  it('restores per-tab scroll and does not repeat first-visit scroll on every activation', () => {
    const shell = source('features/workbench/WorkbenchShell.tsx');
    const page = source('pages/DocumentParsingPage/DocumentParsingPage.tsx');
    expect(shell).toContain('tabScrollRef.current.get(activeTab)');
    expect(shell).toContain('event.target !== event.currentTarget');
    expect(page).toContain('scrolledNodesRef.current.clear()');
    expect(page).toContain('scrolledNodesRef.current.has(destination)');
    expect(page).toContain('useReaderRequestScope(');
  });
});
