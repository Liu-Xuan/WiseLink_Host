import { Suspense, useEffect, useState } from 'react';
import { Button } from '@client/src/components/ui/button';
import { useDocumentOriginalUrl } from '@client/src/utils/document-original-url';

import {
  LazyPdfDocumentViewer,
  loadPdfDocumentViewer,
} from './pdf-document-viewer-loader';

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
  const { url, busy, error, prepare } =
    useDocumentOriginalUrl(documentVersionId);

  const [requested, setRequested] = useState(false);
  const [moduleAttempt, setModuleAttempt] = useState(0);
  const [moduleReady, setModuleReady] = useState(false);
  const [moduleError, setModuleError] = useState<string | null>(null);

  useEffect(() => {
    if (!autoLoad && !requested) return;
    let active = true;
    setModuleError(null);
    void loadPdfDocumentViewer().then(
      () => {
        if (active) setModuleReady(true);
      },
      () => {
        if (active) setModuleError('PDF 阅读组件加载失败，请重试。');
      },
    );
    return () => {
      active = false;
    };
  }, [autoLoad, requested, moduleAttempt]);

  function openOriginal() {
    setRequested(true);
    if (!url) void prepare();
  }

  useEffect(() => {
    if (autoLoad && !url) void prepare();
    // prepare() has a controller guard; keep deps coarse so page/box changes do
    // not refetch the same authorized original.
  }, [autoLoad, documentVersionId]);

  if (!url || !moduleReady) {
    return (
      <section className="document-original-inline" aria-label="PDF 原件">
        <div className="document-original-inline-empty">
          <strong>原件按需读取</strong>
          <p>读取后在此显示同一 DocumentVersion 的受控 PDF。</p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={openOriginal}
          >
            {busy
              ? '正在读取原件…'
              : url
                ? '正在准备 PDF 阅读组件…'
                : '读取受控原件'}
          </Button>
          {error ? <p role="alert">{error}</p> : null}
          {moduleError ? (
            <div role="alert">
              <p>{moduleError}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setModuleAttempt((value) => value + 1)}
              >
                重试 PDF 阅读组件
              </Button>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="parse-pdf-viewer-state" role="status">
          正在打开受控 PDF 原件…
        </div>
      }
    >
      <LazyPdfDocumentViewer
        sourceUrl={url}
        sourceSupportsRange={false}
        targetPage={page}
        targetSignal={targetSignal}
        targetBoxes={targetBoxes}
      />
    </Suspense>
  );
}
