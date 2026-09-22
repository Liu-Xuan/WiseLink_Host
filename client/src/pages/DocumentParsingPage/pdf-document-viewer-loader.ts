import { lazy } from 'react';

type ViewerModule = typeof import('./PdfDocumentViewer');
let viewerPromise: Promise<ViewerModule> | null = null;

export function loadPdfDocumentViewer(): Promise<ViewerModule> {
  if (!viewerPromise) {
    viewerPromise = import('./PdfDocumentViewer').catch((reason: unknown) => {
      viewerPromise = null;
      throw reason;
    });
  }
  return viewerPromise;
}

// Mount only after preloading succeeds: React.lazy must never retain a failed
// preload. A manual retry then uses the same entry and a fresh import promise.
export const LazyPdfDocumentViewer = lazy(loadPdfDocumentViewer);
