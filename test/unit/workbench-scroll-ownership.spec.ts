import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postcss from 'postcss';

const root = resolve(__dirname, '../..');

async function source(path: string): Promise<string> {
  return readFile(resolve(root, path), 'utf8');
}

describe('workbench scroll ownership', () => {
  it('allocates the viewport in AppShell and lets the workbench fill the remaining body', async () => {
    const [appShellStyles, pageStyles, workbenchStyles, layout] = await Promise.all([
      source('client/src/components/app-shell.css'),
      source('client/src/pages/DocumentParsingPage/document-parsing.css'),
      source('client/src/features/workbench/workbench-shell.css'),
      source('client/src/components/Layout.tsx'),
    ]);

    // Read each exact selector in its actual media scope. Declarations on an
    // unrelated later rule cannot satisfy the height/scroll ownership contract.
    function declarations(css: string, selector: string, media?: string): Record<string, string> {
      const values: Record<string, string> = {};
      let matches = 0;
      postcss.parse(css).walkRules(rule => {
        const parent = rule.parent;
        const inScope = media === undefined ? parent?.type === 'root'
          : parent?.type === 'atrule' && parent.name === 'media' && parent.params === media;
        if (!inScope || !rule.selectors.includes(selector)) return;
        matches += 1;
        rule.walkDecls(declaration => { values[declaration.prop] = declaration.value; });
      });
      expect(matches).toBeGreaterThan(0);
      return values;
    }
    expect(declarations(appShellStyles, '.wiselink-app-shell')).toMatchObject({
      display: 'grid', height: '100dvh', 'min-height': '0', overflow: 'hidden',
    });
    expect(declarations(appShellStyles, '.wiselink-app-main')).toMatchObject({
      display: 'flex', 'flex-direction': 'column', 'min-height': '0',
    });
    expect(declarations(appShellStyles, '.wl-topbar')).toMatchObject({ 'flex-shrink': '0' });
    expect(declarations(appShellStyles, '.wiselink-app-shell .wl-topbar')).toMatchObject({
      height: '60px', 'min-height': '60px', margin: '0',
    });
    expect(declarations(appShellStyles, '.wiselink-app-shell .wl-topbar', '(max-width: 760px)')).toMatchObject({
      height: '58px', 'min-height': '58px',
    });
    expect(declarations(appShellStyles, '.wiselink-app-body')).toMatchObject({
      flex: '1', 'min-height': '0', overflow: 'auto',
    });
    expect(declarations(appShellStyles, '.wiselink-app-shell.is-immersive')).toMatchObject({
      'grid-template-columns': 'minmax(0, 1fr)',
    });
    for (const selector of ['.wiselink-app-shell.is-immersive .wl-sidebar', '.wiselink-app-shell.is-immersive .wl-topbar'])
      expect(declarations(appShellStyles, selector)).toMatchObject({ display: 'none' });
    expect(layout).toContain("immersive ? ' is-immersive' : ''");
    const main = layout.match(/<div className="wiselink-app-main">[\s\S]*?<\/div>/u)?.[0];
    expect(main).toContain('<TopBar');
    expect(main).toContain('className="wiselink-app-body"');
    expect(main).toContain('id="main-content"');
    expect(main).toContain('data-reading-scroll-container');
    expect(main).toContain('<Outlet />');
    expect(main!.indexOf('<TopBar')).toBeLessThan(main!.indexOf('className="wiselink-app-body"'));
    expect(main!.indexOf('className="wiselink-app-body"')).toBeLessThan(main!.indexOf('<Outlet />'));
    expect(pageStyles).toMatch(
      /\.parse-shell\.parse-shell--workbench\s*\{[\s\S]*?height: 100%;[\s\S]*?min-height: 0;[\s\S]*?padding: 0;/,
    );
    expect(pageStyles).not.toContain('grid-template-rows: minmax(0, 1fr)');
    expect(pageStyles).not.toMatch(
      /body\[data-wl-immersive='true'\][\s\S]*?\.wiselink-app-body/,
    );
    expect(workbenchStyles).toMatch(
      /\.wl-workbench-toolbar\s*\{[\s\S]*?flex: 0 0 auto;/,
    );
    expect(declarations(pageStyles, '.parse-shell.parse-shell--workbench')).toMatchObject({ overflow: 'hidden' });
    expect(declarations(workbenchStyles, '.wl-workbench-shell')).toMatchObject({
      height: '100%', 'min-height': '0', overflow: 'hidden',
    });
  });

  it('separates flow pages from fixed desktop workspaces', async () => {
    const [shell, shellStyles, page, pageStyles] = await Promise.all([
      source('client/src/features/workbench/WorkbenchShell.tsx'),
      source('client/src/features/workbench/workbench-shell.css'),
      source('client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx'),
      source('client/src/pages/DocumentParsingPage/document-parsing.css'),
    ]);

    expect(shell).toContain('data-content-mode={contentMode}');
    expect(shell).toContain('data-content-layout={contentLayout}');
    expect(shell).toContain("tabIndex={contentMode === 'flow' ? 0 : -1}");
    expect(shellStyles).toMatch(
      /\.wl-workbench-main\.is-workspace\s*\{[\s\S]*?overflow: hidden;/,
    );
    expect(page).toContain(
      "activeNode === 'package' || activeNode === 'reader'",
    );
    const structuredLocateHandler = page.match(
      /function locateStructuredSourceRef\([\s\S]*?\n  }/,
    )?.[0];
    expect(structuredLocateHandler).toContain('setPdfLocateSignal');
    expect(structuredLocateHandler).not.toContain('setEvidenceSignal');
    expect(page).toContain('locateSignal={pdfLocateSignal}');
    expect(pageStyles).toMatch(
      /> :is\(\.parse-reader-split, \.parse-structured-split\)\s*\{[\s\S]*?flex: 1 1 auto;[\s\S]*?overflow: hidden;/,
    );
  });

  it('keeps one keyboard-scrollable owner inside each professional pane', async () => {
    const [reader, pageStyles, structured, structuredStyles, pdf, pdfStyles] =
      await Promise.all([
        source(
          'client/src/pages/DocumentParsingPage/DocumentReaderWorkspace.tsx',
        ),
        source('client/src/pages/DocumentParsingPage/document-parsing.css'),
        source(
          'client/src/pages/DocumentParsingPage/StructuredContentBrowser.tsx',
        ),
        source(
          'client/src/pages/DocumentParsingPage/structured-content-browser.css',
        ),
        source('client/src/pages/DocumentParsingPage/PdfDocumentViewer.tsx'),
        source('client/src/pages/DocumentParsingPage/pdf-source-pane.css'),
      ]);

    expect(reader).toContain('aria-label="结构化原文结果"');
    expect(reader).toContain('tabIndex={0}');
    expect(pageStyles).toMatch(
      /\.wl-workbench-main\.is-workspace \.parse-results\s*\{[\s\S]*?max-height: none;[\s\S]*?flex: 1;/,
    );

    expect(structured).toContain('aria-label="结构化正文与已加载章节"');
    expect(structuredStyles).toMatch(
      /\.structured-browser-layout\s*\{[\s\S]*?overflow: auto;[\s\S]*?overscroll-behavior: contain;/,
    );
    expect(structuredStyles).toMatch(
      /\.structured-browser-outline\s*\{[\s\S]*?overflow: visible;/,
    );

    expect(pdf).toContain('aria-label="PDF 页面"');
    expect(pdf).toContain('data-pdf-page={pageNumber}');
    expect(pdf).toContain('followPdfPageTarget(container, scrollRequest.page');
    expect(pdf).toContain('onScroll={handlePagesScroll}');
    expect(pdf).toContain('pageAtReadingLine');
    expect(pdf).toContain('panelActive && renderRequested');
    expect(pdf).toContain("? 'requested' : 'deferred'");
    expect(pdfStyles).toMatch(
      /\.wl-workbench-main\.is-workspace \.parse-pdf-pages\s*\{[\s\S]*?max-height: none;[\s\S]*?min-height: 0;/,
    );
  });
});
