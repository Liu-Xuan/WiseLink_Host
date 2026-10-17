import { ArrowLeft, Expand, List, Minimize } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@client/src/components/ui/button';
import RetainedWorkbenchPanel, {
  useWorkbenchPanelActive,
} from '@client/src/features/workbench/RetainedWorkbenchPanel';
import type { DocumentOriginalResult } from '@shared/document-original.interface';
import { DocumentOriginalReader } from './DocumentOriginalReader';
import DocumentOriginalCanvasPreview from './DocumentOriginalCanvasPreview';
import { originalUnitPages } from './original-reading';
import type { DocumentWorkbenchPanel } from './document-workbench-panel';

export type DocumentSourceReaderMode = 'dual' | 'bilingual' | 'translation' | 'original' | 'pdf';

interface Props {
  original: DocumentOriginalResult;
  documentVersionId: string;
  mode: DocumentSourceReaderMode;
  onModeChange: (mode: DocumentSourceReaderMode) => void;
  bilingualContent: ReactNode;
  returnRoute: string;
  returnLabel: string;
  title: string;
  initialPage?: number;
  initialUnitId?: string;
  initialLocationRequest?: number;
  onLocationSelect?: (page: number, unitId: string) => void;
  renderPdfPreview?: (page: number) => ReactNode;
  activePanel?: DocumentWorkbenchPanel;
  savedPanels?: ReactNode;
  /** Standalone document reading shares its identity/actions with this toolbar. */
  toolbar?: {
    identity: ReactNode;
    links?: ReactNode;
    more?: ReactNode;
    notices?: ReactNode;
  };
}

const READER_MODES: Array<{ value: DocumentSourceReaderMode; label: string }> = [
  { value: 'dual', label: '原文＋原件' }, { value: 'bilingual', label: '中英对照' },
  { value: 'translation', label: '中文阅读' }, { value: 'original', label: '仅原文' },
  { value: 'pdf', label: '仅原件' },
];

export function DocumentSourceReadingWorkspace({
  original,
  documentVersionId,
  mode,
  onModeChange,
  bilingualContent,
  returnRoute,
  returnLabel,
  title,
  initialPage,
  initialUnitId,
  initialLocationRequest = 0,
  onLocationSelect,
  renderPdfPreview,
  toolbar,
  activePanel = 'reader',
  savedPanels,
}: Props) {
  const workspaceActive: boolean = useWorkbenchPanelActive();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const textScrollRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(50);
  const [page, setPage] = useState(initialPage ?? 1);
  const [visiblePdfPage, setVisiblePdfPage] = useState(initialPage ?? 1);
  const [tocOpen, setTocOpen] = useState(() => typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 761px)').matches);
  const [activeUnitId, setActiveUnitId] = useState<string | null>(initialUnitId ?? null);
  const [pdfLocationRequest, setPdfLocationRequest] = useState(0);
  const [pdfLocationIdentity, setPdfLocationIdentity] = useState(() =>
    initialPage ? JSON.stringify([initialUnitId ?? '', initialLocationRequest]) : '');
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenMessage, setFullscreenMessage] = useState<string | null>(null);
  const headings = useMemo(
    () =>
      original.source.units.filter(
        (unit) =>
          unit.kind === 'heading' &&
          unit.mapping.pageFurniture !== true &&
          String(unit.payload.text ?? '').trim().length > 0,
      ),
    [original],
  );

  useEffect(() => {
    if (initialPage) {
      setPage(initialPage);
      setPdfLocationIdentity(JSON.stringify([initialUnitId ?? '', initialLocationRequest]));
      setPdfLocationRequest((value: number) => value + 1);
    }
  }, [initialPage, initialUnitId, initialLocationRequest]);

  useEffect(() => {
    if (initialUnitId) setActiveUnitId(initialUnitId);
  }, [initialUnitId, initialLocationRequest]);

  useEffect(() => {
    if (!initialUnitId || activeUnitId !== initialUnitId || (mode !== 'dual' && mode !== 'original')) return;
    const frame: number = window.requestAnimationFrame(() => scrollToUnit(initialUnitId, 'center'));
    return () => window.cancelAnimationFrame(frame);
  }, [initialUnitId, initialLocationRequest, mode, activeUnitId]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === workspaceRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  function scrollToUnit(unitId: string, align: 'start' | 'center'): void {
    const container: HTMLDivElement | null = textScrollRef.current;
    if (!container || container.clientHeight === 0) return;
    const target: HTMLElement | undefined = Array.from(
      container.querySelectorAll<HTMLElement>('[data-unit-id]'),
    ).find((element: HTMLElement) => element.dataset.unitId === unitId);
    if (!target) return;
    const targetRect: DOMRect = target.getBoundingClientRect();
    const inset: number = align === 'center'
      ? Math.max(0, (container.clientHeight - targetRect.height) / 2) : 0;
    container.scrollTo({ top: Math.max(0, container.scrollTop + targetRect.top
      - container.getBoundingClientRect().top - inset), behavior: 'auto' });
  }

  function locateUnit(pageIndex: number, unitId: string, revealPdf: boolean = true): void {
    setPage(pageIndex);
    setActiveUnitId(unitId);
    setPdfLocationIdentity(JSON.stringify([unitId, initialLocationRequest]));
    setPdfLocationRequest((value: number) => value + 1);
    onLocationSelect?.(pageIndex, unitId);
    if (revealPdf && mode === 'original') onModeChange('dual');
  }

  function focusHeading(unitId: string): void {
    if (mode === 'bilingual' || mode === 'translation' || mode === 'pdf') onModeChange('original');
    setActiveUnitId(unitId);
    const pages: number[] = originalUnitPages(original, unitId);
    if (pages.length === 1) locateUnit(pages[0], unitId, false);
    window.requestAnimationFrame(() => scrollToUnit(unitId, 'start'));
    if (window.innerWidth <= 760) setTocOpen(false);
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const container = event.currentTarget.parentElement;
    if (!container) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const resize = (clientX: number) => {
      const bounds = container.getBoundingClientRect();
      setSplit(Math.max(32, Math.min(68, ((clientX - bounds.left) / bounds.width) * 100)));
    };
    const move = (moveEvent: PointerEvent) => resize(moveEvent.clientX);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  async function toggleFullscreen(): Promise<void> {
    setFullscreenMessage(null);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (workspaceRef.current?.requestFullscreen) await workspaceRef.current.requestFullscreen();
      else setFullscreenMessage('当前浏览器不支持全屏，可继续在当前页面阅读。');
    } catch (reason: unknown) {
      setFullscreenMessage(reason instanceof Error ? `全屏未开启：${reason.message}` : '全屏未开启，可继续在当前页面阅读。');
    }
  }

  const columnStyle = {
    '--reader-split': `${split}%`,
  } as CSSProperties;
  const showText = mode === 'dual' || mode === 'original';
  const showPdf = mode === 'dual' || mode === 'pdf';
  const pdfActive = workspaceActive && activePanel === 'reader' && showPdf;
  const showTranslation = mode === 'bilingual' || mode === 'translation';
  const targetBoxes = useMemo(() => {
    if (!activeUnitId) return null;
    const unit = original.source.units.find((item) => item.unitId === activeUnitId);
    if (!unit) return null;
    const locations = original.locations.filter((location) =>
      unit.sourceRefIds.includes(location.sourceRefId)
      && location.pageIndex === page - 1
      && location.boxes.length > 0
      && location.viewportWidth !== null
      && location.viewportHeight !== null
      && location.viewportWidth > 0
      && location.viewportHeight > 0,
    );
    if (locations.length === 0) return null;
    const first = locations[0];
    if (!first || first.viewportWidth === null || first.viewportHeight === null) return null;
    return {
      boxes: locations.flatMap((location) => location.boxes),
      viewportWidth: first.viewportWidth,
      viewportHeight: first.viewportHeight,
    };
  }, [activeUnitId, original, page]);

  const directoryControl = <Button type="button" size="sm" variant="ghost" aria-expanded={tocOpen}
    onClick={() => setTocOpen(value => !value)}><List aria-hidden="true" />目录</Button>;
  const modeControls = <div className="source-reader-mode-tabs" aria-label="阅读模式">
    {READER_MODES.map(item => <button key={item.value} type="button" aria-pressed={mode === item.value}
      onClick={() => onModeChange(item.value)}>{item.label}</button>)}
  </div>;

  return (
    <div className={`source-reader-workspace${toolbar ? ' has-compact-toolbar' : ''}${tocOpen ? '' : ' no-toc'}`}
      ref={workspaceRef}>
      <header className="source-reader-toolbar">
        {toolbar?.identity ?? <div className="source-reader-identity"><strong>{title}</strong><span>阅读版本 {original.binding.parseRevision}</span></div>}
        {toolbar ? <div className="source-reader-primary-tools" hidden={activePanel !== 'reader'}>{directoryControl}{modeControls}</div>
          : <>{directoryControl}{modeControls}</>}
        {toolbar?.links}
        {toolbar ? <div className="source-reader-window-tools">
          <Button type="button" size="sm" variant="ghost" aria-label={fullscreen ? '退出全屏' : '全屏'}
            onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Minimize aria-hidden="true" /> : <Expand aria-hidden="true" />}
            <span className="source-reader-fullscreen-label">{fullscreen ? '退出全屏' : '全屏'}</span>
          </Button>
          <Button asChild size="sm" variant="outline" className="source-reader-return">
            <Link to={returnRoute} title={returnLabel}><ArrowLeft aria-hidden="true" />
              <span className="source-reader-return-label">{returnLabel}</span></Link>
          </Button>
          {toolbar.more}
        </div> : <>
        <Button type="button" size="sm" variant="ghost" onClick={() => void toggleFullscreen()}>
          {fullscreen ? <Minimize aria-hidden="true" /> : <Expand aria-hidden="true" />}{fullscreen ? '退出全屏' : '全屏'}
        </Button>
        <Button asChild size="sm" variant="outline" className="source-reader-return">
          <Link to={returnRoute}><ArrowLeft aria-hidden="true" />{returnLabel}</Link>
        </Button>
        </>}
      </header>
      {toolbar?.notices}
      {fullscreenMessage ? <p className="source-reader-fullscreen-message" role="status">{fullscreenMessage}</p> : null}

      <div className="source-reader-layout" hidden={activePanel !== 'reader'} inert={activePanel !== 'reader'}>
      {tocOpen ? <aside className="source-reader-toc">
        <div className="source-reader-toc-modes" aria-label="目录类型">
          <button type="button" aria-pressed="true">作者章节</button>
          <button type="button" disabled title="当前读取合同尚未提供业务主题目录">业务主题</button>
        </div>
        <nav aria-label="作者章节目录">
          {headings.length ? (
            headings.map((heading) => {
              const pages = originalUnitPages(original, heading.unitId);
              return <button key={heading.unitId} type="button" className={activeUnitId === heading.unitId ? 'is-selected' : undefined}
                onClick={() => focusHeading(heading.unitId)}><span>{String(heading.payload.text ?? '')}</span>
                {pages.length === 1 ? <small>P{pages[0]}</small> : null}</button>;
            })
          ) : (
            <p>当前原文没有可用的作者章节标题。</p>
          )}
        </nav>
        {toolbar && !toolbar.more ? <div className="source-reader-toc-boundary">
          <span>阅读版本 {original.binding.parseRevision}</span>
        </div> : null}
      </aside> : null}

      <section className={`source-reader-stage mode-${mode}`}>
        <div className="source-reader-translation" hidden={!showTranslation}>
          <div className="source-reader-pane-title"><strong>{mode === 'translation' ? '中文阅读' : '中英对照'}</strong></div>
          <div className="source-reader-bilingual">{bilingualContent}</div>
        </div>
        <div
          className={`source-reader-columns${showText && showPdf ? '' : ' is-single'}`}
          style={columnStyle}
          hidden={showTranslation}
        >
            <div className="source-reader-primary" hidden={!showText}>
              <div className="source-reader-pane-title"><strong>连续结构化原文</strong></div>
              <div className="source-reader-pane-scroll" ref={textScrollRef}><DocumentOriginalReader original={original}
                activeUnitId={activeUnitId} onUnitLocate={locateUnit} /></div>
            </div>
            <div
              className="source-reader-splitter"
              role="separator"
              tabIndex={showText && showPdf ? 0 : -1}
              hidden={!(showText && showPdf)}
              aria-label="调整阅读分栏"
              aria-orientation="vertical"
              aria-valuemin={32}
              aria-valuemax={68}
              aria-valuenow={Math.round(split)}
              onPointerDown={startResize}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                setSplit((value) => Math.max(32, Math.min(68, value + (event.key === 'ArrowLeft' ? -2 : 2))));
              }}
            />
            <div className="source-reader-pdf-pane" hidden={!showPdf}>
              <div className="source-reader-pane-title"><strong>PDF 原件</strong><span>第 {visiblePdfPage} 页</span></div>
              <RetainedWorkbenchPanel active={pdfActive}>
                {renderPdfPreview ? renderPdfPreview(page) : <DocumentOriginalCanvasPreview
                  documentVersionId={documentVersionId}
                  readingScope={JSON.stringify([original.binding.documentVersionId,
                    original.binding.parseRunId, original.binding.parseRevision,
                    original.binding.sourceArtifactId, original.binding.sourceSha256])}
                  onVisiblePageChange={setVisiblePdfPage}
                  page={page}
                  autoLoad
                  targetSignal={JSON.stringify([pdfLocationIdentity, pdfLocationRequest])}
                  targetBoxes={targetBoxes}
                />}
              </RetainedWorkbenchPanel>
            </div>
        </div>
      </section>
      </div>
      <div className="source-reader-saved-panels" hidden={activePanel === 'reader'}>
        {savedPanels}
      </div>
    </div>
  );
}
