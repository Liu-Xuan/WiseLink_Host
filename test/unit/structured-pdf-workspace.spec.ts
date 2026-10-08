import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as ts from 'typescript';

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
    // The unchanged target effect also follows exact reading-scope changes.
    // Compare its complete dependency contract, not source formatting.
    expect(targetEffectDependencies(viewer)).toEqual([
      ['pdfDocument', 'targetPage', 'targetSignal', 'positionKey'],
    ]);
    // Target scrolling and late geometry are exercised by the real React
    // consumer in pdf-viewer-target-layout.spec.ts, not source spelling.
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

function targetEffectDependencies(viewer: string): string[][] {
  const file = ts.createSourceFile('PdfDocumentViewer.tsx', viewer,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects: string[][] = [];
  function callsTarget(node: ts.Node): boolean {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'requestPdfPage') return true;
    return ts.forEachChild(node, callsTarget) ?? false;
  }
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'useEffect' && node.arguments[0]
      && callsTarget(node.arguments[0])) {
      const dependencies = node.arguments[1];
      effects.push(dependencies && ts.isArrayLiteralExpression(dependencies)
        ? dependencies.elements.map(item => item.getText(file)) : []);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return effects;
}
