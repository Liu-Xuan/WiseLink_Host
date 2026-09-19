import { lazy, Suspense, useEffect } from 'react';
import { Button } from '@client/src/components/ui/button';
import { useDocumentOriginalUrl } from '@client/src/utils/document-original-url';

const PdfDocumentViewer = lazy(() => import('./PdfDocumentViewer'));

interface PdfBoxTarget {
  boxes: ReadonlyArray<[number, number, number, number]>;
  viewportWidth: number;
  viewportHeight: number;
}

interface DocumentOriginalCanvasPreviewProps {
  documentVersionId: string;
  page: number;
  autoLoad?: boolean;
  targetSignal?: string;
  targetBoxes?: PdfBoxTarget | null;
}

/**
 * Controlled PDF canvas for the document-version reader. The blob is still
 * obtained through the existing documentVersionId authorization chain; this
 * component only changes rendering from an iframe to the shared PDF canvas so
 * saved source boxes can be drawn without exposing a new URL.
 */
export default function DocumentOriginalCanvasPreview({
  documentVersionId,
  page,
  autoLoad = false,
  targetSignal = '',
  targetBoxes = null,
}: DocumentOriginalCanvasPreviewProps) {
  const { url, busy, error, prepare } = useDocumentOriginalUrl(documentVersionId);

  useEffect(() => {
    if (autoLoad && !url) void prepare();
  // prepare() has a controller guard; keep deps coarse so page/box changes do
  // not refetch the same authorized original.
  }, [autoLoad, documentVersionId]);

  if (!url) {
    return (
      <section className="document-original-inline" aria-label="PDF 原件">
        <div className="document-original-inline-empty">
          <strong>原件按需读取</strong>
          <p>读取后在此显示同一 DocumentVersion 的受控 PDF。</p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => { void prepare(); }}
          >
            {busy ? '正在读取原件…' : '读取受控原件'}
          </Button>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <Suspense fallback={<div className="parse-pdf-viewer-state" role="status">正在打开受控 PDF 原件…</div>}>
      <PdfDocumentViewer
        sourceUrl={url}
        sourceSupportsRange={false}
        targetPage={page}
        targetSignal={targetSignal}
        targetBoxes={targetBoxes}
      />
    </Suspense>
  );
}
