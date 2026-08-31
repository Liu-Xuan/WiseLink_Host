import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root: string = resolve(__dirname, '../..');

describe('structured PDF workspace wiring', () => {
  it('keeps inline PDF location separate from evidence-panel activity', async () => {
    const page: string = await source(
      'client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx',
    );

    expect(page).toContain('setPdfLocateSignal((value) => value + 1)');
    expect(page).toContain(
      'structuredSourceDeepLink(sourceRef, locator?.pageStart)',
    );
    expect(page).toContain('const evidenceContextActive: boolean =');
    expect(page).toContain(
      'evidenceContextActive ? structuredSourceLocator : null',
    );
    expect(page).toContain('evidenceActive={evidenceContextActive}');
    expect(page).not.toContain("evidenceActive={requestedSourceRef !== ''}");
    expect(page).toContain('evidenceSignal={evidenceSignal}');
  });

  it('uses one parent observer for every continuous page frame', async () => {
    const viewer: string = await source(
      'client/src/pages/DocumentParsingPage/PdfDocumentViewer.tsx',
    );

    expect(viewer.match(/new IntersectionObserver\(/gu)).toHaveLength(1);
    expect(viewer).toContain(
      "container.querySelectorAll<HTMLElement>('[data-pdf-page]')",
    );
    expect(viewer).toContain(
      'pageFrames.forEach((frame: HTMLElement) => observer.observe(frame))',
    );
    expect(viewer).toContain('[pdfDocument, targetPage, targetSignal]');
    expect(viewer).toContain('`[data-pdf-page="${scrollRequest.page}"]`');
    expect(viewer).toContain('container.scrollTo({');
    expect(viewer).not.toContain('root: frame.parentElement');
  });

  it('renders a requested 390px SourceRef page as the current page frame', async () => {
    const viewer: string = await source(
      'client/src/pages/DocumentParsingPage/PdfDocumentViewer.tsx',
    );

    expect(viewer).toContain(
      'visiblePdfPages(currentPage, pageCount, isMobile)',
    );
    expect(viewer).toContain('requestPdfPage(nextPage);');
    expect(viewer).toContain('setCurrentPage(nextPage);');
    expect(viewer).toContain('return new Set(current).add(nextPage);');
    expect(viewer).toContain(
      '{visiblePages.map((pageNumber: number) => (',
    );
  });
});

function source(relative: string): Promise<string> {
  return readFile(resolve(root, relative), 'utf8');
}
