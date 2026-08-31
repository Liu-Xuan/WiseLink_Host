import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from 'pdfjs-dist';
// Vite resolves this asset query to the bundled pdf.js worker URL.
// eslint-disable-next-line import/no-unresolved
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';

import { canonicalPdfPreviewUrl } from '@client/src/api/canonical-host';
import type { CanonicalPdfPreviewProjection } from '@shared/api.interface';
import {
  buildPdfDocumentRequest,
  resolvePdfWorkerUrl,
} from './pdf-viewer-request';
import { clampPdfPage, visiblePdfPages } from './pdf-viewer-state';
import { loadPdfJsRuntime } from './pdfjs-runtime';

const PDF_WORKER_SRC: string = resolvePdfWorkerUrl(
  pdfWorkerUrl,
  import.meta.url,
);

interface PdfDocumentViewerProps {
  workItemId: string;
  preview: Extract<CanonicalPdfPreviewProjection, { status: 'AVAILABLE' }>;
  targetPage: number | null;
  targetSignal: string;
}

interface PdfCanvasPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  highlighted: boolean;
  renderRequested: boolean;
}

interface PdfScrollRequest {
  page: number;
  sequence: number;
}

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.75;
const ZOOM_STEP = 0.25;

export default function PdfDocumentViewer({
  workItemId,
  preview,
  targetPage,
  targetSignal,
}: PdfDocumentViewerProps) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>('1');
  const [zoom, setZoom] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  const [renderedPages, setRenderedPages] = useState<ReadonlySet<number>>(
    () => new Set([targetPage ?? 1]),
  );
  const [scrollRequest, setScrollRequest] = useState<PdfScrollRequest>(() => ({
    page: targetPage ?? 1,
    sequence: 0,
  }));
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const isMobile: boolean = usePdfMobileViewport();
  const previewUrl: string = useMemo(
    () => canonicalPdfPreviewUrl(workItemId, preview.opaqueLocator),
    [preview.opaqueLocator, workItemId],
  );

  useEffect(() => {
    const initialPage: number = targetPage ?? 1;
    setScrollRequest((current: PdfScrollRequest) => ({
      page: initialPage,
      sequence: current.sequence + 1,
    }));
  }, [previewUrl]);

  useEffect(() => {
    let active = true;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setLoading(true);
    setError(false);
    setPdfDocument(null);
    setPageCount(0);
    setRenderedPages(new Set([targetPage ?? 1]));
    void loadPdfJsRuntime(PDF_WORKER_SRC)
      .then((runtime) => {
        if (!active) return null;
        loadingTask = runtime.getDocument(
          buildPdfDocumentRequest(previewUrl, preview.supportsRange),
        );
        return loadingTask.promise;
      })
      .then((document: PDFDocumentProxy | null) => {
        if (!document) return;
        if (!active) {
          void document.destroy();
          return;
        }
        const initialPage: number = clampPdfPage(
          targetPage ?? 1,
          document.numPages,
        );
        setPdfDocument(document);
        setPageCount(document.numPages);
        setCurrentPage(initialPage);
        setPageInput(String(initialPage));
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      active = false;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [preview.supportsRange, previewUrl]);

  useEffect(() => {
    if (!pdfDocument || targetPage === null) return;
    const nextPage: number = clampPdfPage(targetPage, pdfDocument.numPages);
    requestPdfPage(nextPage);
  }, [pdfDocument, targetPage, targetSignal]);

  const visiblePages: number[] = useMemo(
    () => visiblePdfPages(currentPage, pageCount, isMobile),
    [currentPage, isMobile, pageCount],
  );
  const sourceTargetPage: number | null =
    targetPage === null ? null : clampPdfPage(targetPage, pageCount);

  useEffect(() => {
    const container: HTMLDivElement | null = pagesRef.current;
    if (!container || !pdfDocument || pageCount <= 0) return;
    const pageFrames: HTMLElement[] = Array.from(
      container.querySelectorAll<HTMLElement>('[data-pdf-page]'),
    );
    if (pageFrames.length === 0) return;

    if (typeof IntersectionObserver === 'undefined') {
      setRenderedPages(
        new Set(
          pageFrames.map((frame: HTMLElement) =>
            Number(frame.getAttribute('data-pdf-page')),
          ),
        ),
      );
      return;
    }

    const observer = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        const intersectingPages: number[] = entries
          .filter((entry: IntersectionObserverEntry) => entry.isIntersecting)
          .map((entry: IntersectionObserverEntry) =>
            Number(entry.target.getAttribute('data-pdf-page')),
          )
          .filter((pageNumber: number) => Number.isSafeInteger(pageNumber));
        if (intersectingPages.length === 0) return;
        setRenderedPages((current: ReadonlySet<number>) => {
          const next: Set<number> = new Set(current);
          intersectingPages.forEach((pageNumber: number) =>
            next.add(pageNumber),
          );
          return next.size === current.size ? current : next;
        });
      },
      { root: container, rootMargin: '900px 0px' },
    );
    pageFrames.forEach((frame: HTMLElement) => observer.observe(frame));
    return () => observer.disconnect();
  }, [pageCount, pdfDocument]);

  useLayoutEffect(() => {
    const container = pagesRef.current;
    if (!container || pageCount <= 0) return;
    const target = container.querySelector<HTMLElement>(
      `[data-pdf-page="${scrollRequest.page}"]`,
    );
    if (!target) return;
    const containerRect: DOMRect = container.getBoundingClientRect();
    const targetRect: DOMRect = target.getBoundingClientRect();
    container.scrollTo({
      top: Math.max(
        0,
        container.scrollTop + targetRect.top - containerRect.top,
      ),
      behavior: 'auto',
    });
  }, [pageCount, scrollRequest]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

  function requestPdfPage(page: number): void {
    const nextPage: number = clampPdfPage(page, pageCount);
    setCurrentPage(nextPage);
    setPageInput(String(nextPage));
    setRenderedPages((current: ReadonlySet<number>) => {
      if (current.has(nextPage)) return current;
      return new Set(current).add(nextPage);
    });
    setScrollRequest((current: PdfScrollRequest) => ({
      page: nextPage,
      sequence: current.sequence + 1,
    }));
  }

  function movePage(offset: number): void {
    const nextPage: number = clampPdfPage(currentPage + offset, pageCount);
    requestPdfPage(nextPage);
  }

  function commitPageInput(): void {
    const parsed: number = Number.parseInt(pageInput, 10);
    const nextPage: number = clampPdfPage(parsed, pageCount);
    requestPdfPage(nextPage);
  }

  function handlePagesScroll(): void {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const container: HTMLDivElement | null = pagesRef.current;
      if (!container) return;
      const pages: HTMLElement[] = Array.from(
        container.querySelectorAll<HTMLElement>('[data-pdf-page]'),
      );
      if (pages.length === 0) return;
      const containerRect: DOMRect = container.getBoundingClientRect();
      const readingLine: number =
        containerRect.top + Math.min(container.clientHeight * 0.32, 180);
      const pageAtReadingLine: HTMLElement | undefined = pages.find(
        (page: HTMLElement) => {
          const rect: DOMRect = page.getBoundingClientRect();
          return rect.top <= readingLine && rect.bottom > readingLine;
        },
      );
      const visiblePage: HTMLElement =
        pageAtReadingLine ??
        pages.reduce((nearest: HTMLElement, candidate: HTMLElement) => {
          const nearestDistance: number = Math.abs(
            nearest.getBoundingClientRect().top - readingLine,
          );
          const candidateDistance: number = Math.abs(
            candidate.getBoundingClientRect().top - readingLine,
          );
          return candidateDistance < nearestDistance ? candidate : nearest;
        });
      const nextPage: number = Number(
        visiblePage.getAttribute('data-pdf-page'),
      );
      if (!Number.isSafeInteger(nextPage) || nextPage === currentPage) return;
      setCurrentPage(nextPage);
      setPageInput(String(nextPage));
    });
  }

  if (loading) {
    return (
      <div className="parse-pdf-viewer-state" role="status">
        <RefreshCw className="parse-pdf-loading-icon" aria-hidden="true" />
        <strong>正在打开受控 PDF 原文</strong>
        <span>文件内容仅通过当前登录用户的同源读取链加载。</span>
      </div>
    );
  }
  if (error || !pdfDocument) {
    return (
      <div className="parse-pdf-viewer-state is-error" role="alert">
        <RefreshCw aria-hidden="true" />
        <strong>PDF 原文暂时无法打开</strong>
        <span>结构化原文仍可使用；刷新页面可申请新的短期读取凭据。</span>
      </div>
    );
  }

  return (
    <section
      className="parse-pdf-viewer"
      data-wl-material="g4"
      aria-label="受控 PDF 阅读器"
    >
      <header className="parse-pdf-toolbar" data-wl-material="g3-soft">
        <div className="parse-pdf-page-controls">
          <button
            type="button"
            onClick={() => movePage(-1)}
            disabled={currentPage <= 1}
            aria-label="上一页"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <label>
            <span className="wl-visually-hidden">当前页码</span>
            <input
              inputMode="numeric"
              value={pageInput}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setPageInput(event.target.value)
              }
              onBlur={commitPageInput}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitPageInput();
              }}
              aria-label={`当前页，共 ${pageCount} 页`}
            />
          </label>
          <span>/ {pageCount}</span>
          <button
            type="button"
            onClick={() => movePage(1)}
            disabled={currentPage >= pageCount}
            aria-label="下一页"
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
        <div className="parse-pdf-zoom-controls">
          <button
            type="button"
            onClick={() =>
              setZoom((value: number) => Math.max(MIN_ZOOM, value - ZOOM_STEP))
            }
            disabled={zoom <= MIN_ZOOM}
            aria-label="缩小 PDF"
          >
            <Minus aria-hidden="true" />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() =>
              setZoom((value: number) => Math.min(MAX_ZOOM, value + ZOOM_STEP))
            }
            disabled={zoom >= MAX_ZOOM}
            aria-label="放大 PDF"
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      </header>
      <div
        ref={pagesRef}
        className="parse-pdf-pages"
        aria-live="polite"
        aria-label="PDF 页面"
        tabIndex={0}
        onScroll={handlePagesScroll}
      >
        {visiblePages.map((pageNumber: number) => (
          <PdfCanvasPage
            key={`${pageNumber}-${
              pageNumber === sourceTargetPage ? targetSignal : 'page'
            }`}
            document={pdfDocument}
            pageNumber={pageNumber}
            zoom={zoom}
            renderRequested={renderedPages.has(pageNumber)}
            highlighted={
              pageNumber === sourceTargetPage && Boolean(targetSignal)
            }
          />
        ))}
      </div>
    </section>
  );
}

function PdfCanvasPage({
  document,
  pageNumber,
  zoom,
  highlighted,
  renderRequested,
}: PdfCanvasPageProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderError, setRenderError] = useState<boolean>(false);

  useEffect(() => {
    if (!renderRequested && !highlighted) return;
    const frame: HTMLDivElement | null = frameRef.current;
    const canvas: HTMLCanvasElement | null = canvasRef.current;
    if (!frame || !canvas) return;
    let active = true;
    let page: PDFPageProxy | null = null;
    let cancelRender: (() => void) | null = null;

    async function render(): Promise<void> {
      try {
        page = await document.getPage(pageNumber);
        if (!active || !frame || !canvas) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth: number = Math.max(240, frame.clientWidth - 18);
        const cssScale: number = (availableWidth / baseViewport.width) * zoom;
        const viewport = page.getViewport({ scale: cssScale });
        const outputScale: number = Math.min(window.devicePixelRatio || 1, 2);
        const context: CanvasRenderingContext2D | null =
          canvas.getContext('2d');
        if (!context) throw new Error('PDF_CANVAS_CONTEXT_UNAVAILABLE');
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const renderTask = page.render({
          canvasContext: context,
          viewport,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
        });
        cancelRender = () => renderTask.cancel();
        await renderTask.promise;
        if (active) setRenderError(false);
      } catch (error) {
        if (!active || isCancelledRender(error)) return;
        setRenderError(true);
      }
    }

    const observer = new ResizeObserver(() => {
      cancelRender?.();
      void render();
    });
    observer.observe(frame);
    void render();
    return () => {
      active = false;
      observer.disconnect();
      cancelRender?.();
      page?.cleanup();
    };
  }, [document, highlighted, pageNumber, renderRequested, zoom]);

  return (
    <article
      ref={frameRef}
      className={`parse-pdf-page${highlighted ? ' is-source-target' : ''}`}
      data-pdf-page={pageNumber}
      data-render-state={
        renderRequested || highlighted ? 'requested' : 'deferred'
      }
      aria-label={`PDF 第 ${pageNumber} 页`}
      aria-busy={!renderRequested && !highlighted}
    >
      <span className="parse-pdf-page-number">第 {pageNumber} 页</span>
      {!renderRequested && !highlighted ? (
        <span className="parse-pdf-page-placeholder" aria-hidden="true">
          滚动到附近时加载页面
        </span>
      ) : null}
      {renderError ? (
        <div className="parse-pdf-page-error" role="alert">
          当前页渲染失败，请切换页码或刷新后重试。
        </div>
      ) : null}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`PDF 第 ${pageNumber} 页画布`}
      />
    </article>
  );
}

function usePdfMobileViewport(): boolean {
  const [mobile, setMobile] = useState<boolean>(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia('(max-width: 720px)').matches,
  );
  useEffect(() => {
    const query: MediaQueryList = window.matchMedia('(max-width: 720px)');
    const update = (): void => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

function isCancelledRender(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'RenderingCancelledException' ||
      error.message.includes('Rendering cancelled'))
  );
}
