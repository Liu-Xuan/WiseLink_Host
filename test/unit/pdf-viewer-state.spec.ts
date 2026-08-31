import {
  clampPdfPage,
  parsePdfTargetPage,
  resolvePdfTargetPage,
  visiblePdfPages,
} from '../../client/src/pages/DocumentParsingPage/pdf-viewer-state';

describe('PDF viewer page navigation', () => {
  it('clamps SourceRef pageStart to the actual PDF page count', () => {
    expect(clampPdfPage(17, 42)).toBe(17);
    expect(clampPdfPage(0, 42)).toBe(1);
    expect(clampPdfPage(99, 42)).toBe(42);
  });

  it('exposes a continuous desktop page list for scroll reading', () => {
    const pages: number[] = visiblePdfPages(17, 42, false);
    expect(pages).toHaveLength(42);
    expect(pages.slice(0, 3)).toEqual([1, 2, 3]);
    expect(pages.slice(-3)).toEqual([40, 41, 42]);
  });

  it('keeps continuous pages inside the 390px single-panel PDF stage', () => {
    expect(visiblePdfPages(17, 4, true)).toEqual([1, 2, 3, 4]);
  });

  it('uses a sanitized structured pageStart when the Reader query is empty', () => {
    const emptyQueryUnits: Array<{ pageStart: number | null }> = [];
    const structuredLocator = {
      pageStart: parsePdfTargetPage('22'),
      pageEnd: 22,
      quote: 'browser-safe excerpt',
    };
    const viewerInput = {
      targetPage: resolvePdfTargetPage(
        structuredLocator.pageStart,
        emptyQueryUnits[0]?.pageStart,
      ),
    };

    expect(viewerInput).toEqual({ targetPage: 22 });
    expect(JSON.stringify(viewerInput)).not.toMatch(
      /documentVersionId|sourceArtifactId|artifactId|bucketId|filePath/u,
    );
  });

  it('rejects malformed or non-positive deep-link pages', () => {
    expect(parsePdfTargetPage('22')).toBe(22);
    expect(parsePdfTargetPage(' 22 ')).toBe(22);
    expect(parsePdfTargetPage('22x')).toBeNull();
    expect(parsePdfTargetPage('0')).toBeNull();
    expect(parsePdfTargetPage('-1')).toBeNull();
    expect(parsePdfTargetPage(null)).toBeNull();
  });
});
