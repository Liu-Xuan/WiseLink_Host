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

import { canonicalPdfPreviewUrl, getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import { useWorkbenchPanelActive } from '@client/src/features/workbench/RetainedWorkbenchPanel';
import type { CanonicalPdfPreviewProjection } from '@shared/api.interface';
import {
  buildPdfDocumentRequest,
  resolvePdfWorkerUrl,
} from './pdf-viewer-request';
import { clampPdfPage, PDF_RENDER_OVERSCAN_PX, visiblePdfPages } from './pdf-viewer-state';
import { loadPdfJsRuntime } from './pdfjs-runtime';
import { followPdfPageTarget } from './pdf-page-target';
import { readPdfPosition, savePdfPosition } from './pdf-reading-position';

const PDF_WORKER_SRC: string = resolvePdfWorkerUrl(
  pdfWorkerUrl,
  import.meta.url,
);

export interface PdfBoxTarget {
  boxes: ReadonlyArray<[number, number, number, number]>;
  viewportWidth: number;
  viewportHeight: number;
}

type PdfDocumentViewerProps = {
  readingScope?: string;
  onVisiblePageChange?: (page: number) => void;
  targetPage: number | null;
  targetSignal: string;
  targetBoxes?: PdfBoxTarget | null;
} & (
  | {
      workItemId: string;
      preview: Extract<CanonicalPdfPreviewProjection, { status: 'AVAILABLE' }>;
      sourceUrl?: never;
      sourceSupportsRange?: never;
    }
  | {
      sourceUrl: string;
      sourceSupportsRange?: boolean;
      workItemId?: never;
      preview?: never;
    }
);

interface PdfCanvasPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  highlighted: boolean;
  renderRequested: boolean;
  frameWidth: number;
  targetBoxes?: PdfBoxTarget | null;
}

interface PdfScrollRequest {
  offsetRatio?: number;
  page: number;
  sequence: number;
}

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.75;
const ZOOM_STEP = 0.25;

export default function PdfDocumentViewer(props: PdfDocumentViewerProps) {
  const { targetPage, targetSignal, targetBoxes } = props;
  const [positionSession] = useState(getCanonicalHostClientSessionGeneration);
  const positionKey = props.readingScope
    ? JSON.stringify([props.readingScope, targetPage, targetSignal]) : null;
  const [initialPositionKey] = useState(positionKey);
  const capturePositionRef = useRef<() => void>(() => undefined);
  const [initialPosition] = useState(() => readPdfPosition(positionKey, positionSession));
  const initialPositionUsed = useRef(false);
  const userControlsPosition = useRef(false);
  const panelActive: boolean = useWorkbenchPanelActive();
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>('1');
  const [zoom, setZoom] = useState<number>(initialPosition?.zoom ?? 1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  const [pageFrameWidth, setPageFrameWidth] = useState<number>(0);
  const [renderedPages, setRenderedPages] = useState<ReadonlySet<number>>(
    () => new Set([targetPage ?? 1]),
  );
  const [scrollRequest, setScrollRequest] = useState<PdfScrollRequest>(() => ({
    page: targetPage ?? 1,
    sequence: 0,
  }));
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const savedScrollTopRef = useRef<number>(0);
  const appliedScrollRequestRef = useRef<PdfScrollRequest | null>(null);
  const isMobile: boolean = usePdfMobileViewport();
  const previewUrl: string = useMemo(
    () => 'sourceUrl' in props
      ? props.sourceUrl
      : canonicalPdfPreviewUrl(props.workItemId, props.preview.opaqueLocator),
    'sourceUrl' in props
      ? [props.sourceUrl]
      : [props.workItemId, props.preview.opaqueLocator],
  );
  const supportsRange: boolean = 'sourceUrl' in props
    ? props.sourceSupportsRange ?? false
    : props.preview.supportsRange;

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
          buildPdfDocumentRequest(previewUrl, supportsRange),
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
  }, [previewUrl, supportsRange]);

  useEffect(() => {
    if (!pdfDocument || targetPage === null) return;
    // Only mount restoration may consume remembered metadata. Every subsequent
    // explicit source/page signal wins, even if that target has older memory.
    const saved = initialPositionUsed.current || positionKey !== initialPositionKey ? null : initialPosition;
    initialPositionUsed.current = true;
    userControlsPosition.current = false;
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    requestPdfPage(clampPdfPage(saved?.page ?? targetPage, pdfDocument.numPages), saved?.offsetRatio);
  }, [pdfDocument, targetPage, targetSignal, positionKey]);

  useEffect(() => {
    if (pdfDocument && panelActive) props.onVisiblePageChange?.(currentPage);
  }, [pdfDocument, panelActive, currentPage, props.onVisiblePageChange]);

  const visiblePages: number[] = useMemo(
    () => visiblePdfPages(currentPage, pageCount, isMobile),
    [currentPage, isMobile, pageCount],
  );
  const sourceTargetPage: number | null =
    targetPage === null ? null : clampPdfPage(targetPage, pageCount);

  // Keep lightweight desktop frames mounted for continuous scroll and exact
  // source/return positioning. Only nearby pages retain canvas backing pixels.
  const mobilePage: number | null = isMobile ? currentPage : null;
  useEffect(() => {
    if (!panelActive) return;
    const container: HTMLDivElement | null = pagesRef.current;
    if (!container || !pdfDocument || pageCount <= 0) return;
    const pageFrames: HTMLElement[] = Array.from(
      container.querySelectorAll<HTMLElement>('[data-pdf-page]'),
    );
    if (pageFrames.length === 0) return;
    let frame: number | null = null;
    const publish = (next: ReadonlySet<number>): void => {
      setRenderedPages((current: ReadonlySet<number>) =>
        current.size === next.size && [...current].every((page: number) => next.has(page))
          ? current : next,
      );
    };
    const nearbyPages: Set<number> = new Set();
    const measure = (): void => {
      setPageFrameWidth(pageFrames[0].clientWidth);
      const bounds: DOMRect = container.getBoundingClientRect();
      nearbyPages.clear();
      for (const page of pageFrames) {
        const rect: DOMRect = page.getBoundingClientRect();
        if (rect.bottom >= bounds.top - PDF_RENDER_OVERSCAN_PX &&
            rect.top <= bounds.bottom + PDF_RENDER_OVERSCAN_PX) {
          nearbyPages.add(Number(page.dataset.pdfPage));
        }
      }
      publish(new Set(nearbyPages));
    };
    const scheduleMeasure = (): void => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => { frame = null; measure(); });
    };
    measure();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(container);
    pageFrames.forEach((page: HTMLElement) => resizeObserver?.observe(page));
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        for (const entry of entries) {
          const page: number = Number(entry.target.getAttribute('data-pdf-page'));
          if (!Number.isSafeInteger(page)) continue;
          if (entry.isIntersecting) nearbyPages.add(page);
          else nearbyPages.delete(page);
        }
        publish(new Set(nearbyPages));
      },
      { root: container, rootMargin: `${PDF_RENDER_OVERSCAN_PX}px 0px` },
    );
    pageFrames.forEach((page: HTMLElement) => observer?.observe(page));
    // The no-IntersectionObserver path must stay bounded too.
    if (!observer) container.addEventListener('scroll', scheduleMeasure, { passive: true });
    return () => {
      observer?.disconnect();
      resizeObserver?.disconnect();
      container.removeEventListener('scroll', scheduleMeasure);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [pageCount, pdfDocument, panelActive, mobilePage, targetSignal, sourceTargetPage]);

  useLayoutEffect(() => {
    if (!panelActive) {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
      return;
    }
    const container = pagesRef.current;
    if (!container || pageCount <= 0) return;
    if (appliedScrollRequestRef.current === scrollRequest) {
      container.scrollTop = savedScrollTopRef.current;
      return;
    }
    appliedScrollRequestRef.current = scrollRequest;
    return followPdfPageTarget(container, scrollRequest.page, (scrollTop) => {
      savedScrollTopRef.current = scrollTop;
    }, scrollRequest.offsetRatio);

  }, [pageCount, scrollRequest, panelActive]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

  function requestPdfPage(page: number, offsetRatio?: number): void {
    const nextPage: number = clampPdfPage(page, pageCount);
    setCurrentPage(nextPage);
    setPageInput(String(nextPage));
    // currentPage requests the jump target immediately; the observer owns the
    // nearby window, including neighbors with no new intersection transition.
    setScrollRequest((current: PdfScrollRequest) => ({
      page: nextPage,
      offsetRatio,
      sequence: current.sequence + 1,
    }));
  }

  function movePage(offset: number): void {
    userControlsPosition.current = true;
    const nextPage: number = clampPdfPage(currentPage + offset, pageCount);
    requestPdfPage(nextPage);
  }

  function commitPageInput(): void {
    userControlsPosition.current = true;
    const parsed: number = Number.parseInt(pageInput, 10);
    const nextPage: number = clampPdfPage(parsed, pageCount);
    requestPdfPage(nextPage);
  }

  useLayoutEffect(() => () => capturePositionRef.current(), []);

  function reportPagesPosition(updateUi = true): void {
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
    if (!Number.isSafeInteger(nextPage)) return;
    if (userControlsPosition.current) {
      const rect = visiblePage.getBoundingClientRect();
      if (rect.height > 0) savePdfPosition(positionKey, {
        page: nextPage, offsetRatio: (containerRect.top - rect.top) / rect.height, zoom,
      }, positionSession);
    }
    if (!updateUi || nextPage === currentPage) return;
    setCurrentPage(nextPage);
    setPageInput(String(nextPage));
  }
  capturePositionRef.current = () => reportPagesPosition(false);

  function handlePagesScroll(): void {
    if (!panelActive) return;
    savedScrollTopRef.current = pagesRef.current?.scrollTop ?? 0;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      reportPagesPosition();
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
            onClick={() => {
              userControlsPosition.current = true;
              setZoom((value: number) => Math.max(MIN_ZOOM, value - ZOOM_STEP));
            }}
            disabled={zoom <= MIN_ZOOM}
            aria-label="缩小 PDF"
          >
            <Minus aria-hidden="true" />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => {
              userControlsPosition.current = true;
              setZoom((value: number) => Math.min(MAX_ZOOM, value + ZOOM_STEP));
            }}
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
        onWheelCapture={() => { userControlsPosition.current = true; }}
        onTouchStartCapture={() => { userControlsPosition.current = true; }}
        onPointerDownCapture={() => { userControlsPosition.current = true; }}
        onKeyDownCapture={(event) => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
            userControlsPosition.current = true;
        }}
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
            frameWidth={pageFrameWidth}
            renderRequested={currentPage === pageNumber || renderedPages.has(pageNumber)}
            highlighted={
              pageNumber === sourceTargetPage && Boolean(targetSignal)
            }
            targetBoxes={pageNumber === sourceTargetPage ? targetBoxes : null}
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
  frameWidth,
  targetBoxes,
}: PdfCanvasPageProps) {
  const panelActive: boolean = useWorkbenchPanelActive();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const completionRef = useRef<Promise<void>>(Promise.resolve());
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [renderError, setRenderError] = useState<boolean>(false);
  const activeRender: boolean = panelActive && renderRequested;
  const cssScale: number = pageSize ? Math.max(1, frameWidth - 18) / pageSize.width * zoom : 0;
  const cssWidth: number = pageSize ? Math.floor(pageSize.width * cssScale) : 0;
  const cssHeight: number = pageSize ? Math.floor(pageSize.height * cssScale) : 0;

  useEffect(() => {
    if (!activeRender || frameWidth <= 0) return;
    const canvas: HTMLCanvasElement | null = canvasRef.current;
    if (!canvas) return;
    let active = true;
    let page: PDFPageProxy | null = null;
    let cancelRender: (() => void) | null = null;
    const precedingRender: Promise<void> = completionRef.current;
    const releasePixels = (): void => {
      canvas.width = 0;
      canvas.height = 0;
    };

    async function render(): Promise<void> {
      try {
        // A cancelled pdf.js task must settle before this canvas can be reused.
        await precedingRender;
        if (!active || !canvas) return;
        page = await document.getPage(pageNumber);
        if (!active) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale: number = Math.max(1, frameWidth - 18) / baseViewport.width * zoom;
        const viewport = page.getViewport({ scale });
        const outputScale: number = Math.min(window.devicePixelRatio || 1, 2);
        const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
        if (!context) throw new Error('PDF_CANVAS_CONTEXT_UNAVAILABLE');
        setPageSize({ width: baseViewport.width, height: baseViewport.height });
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        // Preserve the exact CSS geometry even when the backing pixels are freed.
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        cancelRender = () => renderTask.cancel();
        await renderTask.promise;
        if (active) setRenderError(false);
      } catch (error) {
        if (active && !isCancelledRender(error)) setRenderError(true);
      } finally {
        if (!active) {
          releasePixels();
          page?.cleanup();
        }
      }
    }

    completionRef.current = render();
    return () => {
      active = false;
      cancelRender?.();
      releasePixels();
      page?.cleanup();
    };
  }, [document, pageNumber, activeRender, zoom, frameWidth]);

  return (
    <article
      ref={frameRef}
      className={`parse-pdf-page${highlighted ? ' is-source-target' : ''}`}
      data-pdf-page={pageNumber}
      data-page-measured={pageSize ? 'true' : undefined}
      data-render-state={activeRender ? 'requested' : 'deferred'}
      aria-label={`PDF 第 ${pageNumber} 页`}
      aria-busy={!activeRender}
    >
      <span className="parse-pdf-page-number">第 {pageNumber} 页</span>
      {!activeRender ? (
        <span className="parse-pdf-page-placeholder" aria-hidden="true">
          滚动到附近时加载页面
        </span>
      ) : null}
      {renderError && activeRender ? (
        <div className="parse-pdf-page-error" role="alert">
          当前页渲染失败，请切换页码或刷新后重试。
        </div>
      ) : null}
      <canvas
        ref={canvasRef}
        width={0}
        height={0}
        style={pageSize ? { width: `${cssWidth}px`, height: `${cssHeight}px` } : undefined}
        role="img"
        aria-label={`PDF 第 ${pageNumber} 页画布`}
      />
      {targetBoxes && pageSize ? targetBoxes.boxes.map((box, index) => (
        <span
          key={`${pageNumber}-${index}`}
          className="parse-pdf-source-box"
          style={{
            left: `${Math.max(0, (frameWidth - pageSize.width * cssScale) / 2)
              + box[0] * cssScale * pageSize.width / targetBoxes.viewportWidth}px`,
            top: `${4 + box[1] * cssScale * pageSize.height / targetBoxes.viewportHeight}px`,
            width: `${box[2] * cssScale * pageSize.width / targetBoxes.viewportWidth}px`,
            height: `${box[3] * cssScale * pageSize.height / targetBoxes.viewportHeight}px`,
          }}
          aria-hidden="true"
        />
      )) : null}
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
