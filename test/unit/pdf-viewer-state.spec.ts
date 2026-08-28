import {
  clampPdfPage,
  visiblePdfPages,
} from '../../client/src/pages/DocumentParsingPage/pdf-viewer-state';

describe('PDF viewer page navigation', () => {
  it('clamps SourceRef pageStart to the actual PDF page count', () => {
    expect(clampPdfPage(17, 42)).toBe(17);
    expect(clampPdfPage(0, 42)).toBe(1);
    expect(clampPdfPage(99, 42)).toBe(42);
  });

  it('keeps the current and adjacent pages at desktop width', () => {
    expect(visiblePdfPages(17, 42, false)).toEqual([16, 17, 18]);
    expect(visiblePdfPages(1, 42, false)).toEqual([1, 2]);
  });

  it('renders one fit-width page for the 390px single-panel mode', () => {
    expect(visiblePdfPages(17, 42, true)).toEqual([17]);
  });
});
