import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

async function source(path: string): Promise<string> {
  return readFile(resolve(root, path), 'utf8');
}

describe('workbench scroll ownership', () => {
  it('gives AppShell sole ownership of the header offset and workspace height', async () => {
    const [appShellStyles, pageStyles, workbenchStyles] = await Promise.all([
      source('client/src/components/app-shell.css'),
      source('client/src/pages/DocumentParsingPage/document-parsing.css'),
      source('client/src/features/workbench/workbench-shell.css'),
    ]);

    expect(appShellStyles).toContain(
      '--wl-app-safe-block-start: env(safe-area-inset-top, 0px)',
    );
    expect(appShellStyles).toContain('--wl-app-header-block-size: 72px');
    expect(appShellStyles).toMatch(
      /--wl-workspace-block-size:\s*calc\([\s\S]*?100dvh[\s\S]*?var\(--wl-app-safe-block-start\)[\s\S]*?var\(--wl-app-header-block-size\)[\s\S]*?\);/,
    );
    expect(appShellStyles).toMatch(
      /\.wiselink-app-shell\.is-workbench-route\s*\{[\s\S]*?padding-block-start: var\(--wl-app-safe-block-start\);/,
    );
    expect(appShellStyles).toMatch(
      /grid-template-rows:\s*var\(--wl-app-header-block-size\)\s*minmax\(0, var\(--wl-workspace-block-size\)\);/,
    );
    expect(appShellStyles).toMatch(
      /\.wiselink-app-shell\.is-workbench-route \.wiselink-app-chrome\s*\{[\s\S]*?position: relative;[\s\S]*?top: auto;[\s\S]*?margin-block: 0;/,
    );
    expect(appShellStyles).toMatch(
      /body\[data-wl-immersive='true'\][\s\S]*?\.wiselink-app-shell\.is-workbench-route\s*\{\s*--wl-app-header-block-size: 0px;/,
    );
    expect(appShellStyles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.wiselink-app-shell\.is-workbench-route\s*\{\s*--wl-app-header-block-size: 0px;/,
    );
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
    expect(pdf).toContain('container.scrollTo');
    expect(pdf).toContain('onScroll={handlePagesScroll}');
    expect(pdf).toContain('pageAtReadingLine');
    expect(pdf).toContain('renderRequested || highlighted');
    expect(pdf).toContain("? 'requested' : 'deferred'");
    expect(pdfStyles).toMatch(
      /\.wl-workbench-main\.is-workspace \.parse-pdf-pages\s*\{[\s\S]*?max-height: none;[\s\S]*?min-height: 0;/,
    );
  });
});
