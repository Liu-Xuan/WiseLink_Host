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
import type { DocumentOriginalResult } from '@shared/document-original.interface';
import { DocumentOriginalInlinePreview } from '../WorkspaceHomePage/DocumentOriginalPreview';
import { DocumentOriginalReader } from './DocumentOriginalReader';
import { originalUnitPages } from './original-reading';

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
  renderPdfPreview?: (page: number) => ReactNode;
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
  renderPdfPreview,
}: Props) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(50);
  const [page, setPage] = useState(initialPage ?? 1);
  const [tocOpen, setTocOpen] = useState(() => typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 900px)').matches);
  const [mobileSecondary, setMobileSecondary] = useState(false);
  const [originalRequested, setOriginalRequested] = useState(false);
  const [activeUnitId, setActiveUnitId] = useState<string | null>(initialUnitId ?? null);
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
    if (initialPage) { setPage(initialPage); setOriginalRequested(true); }
  }, [initialPage]);

  useEffect(() => {
    if (initialUnitId) {
      setActiveUnitId(initialUnitId);
      window.requestAnimationFrame(() => {
        document.getElementById(initialUnitId)?.scrollIntoView({ block: 'center' });
      });
    }
  }, [initialUnitId, initialLocationRequest]);

  useEffect(() => {
    setOriginalRequested(Boolean(initialPage));
  }, [documentVersionId]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === workspaceRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  function locateUnit(pageIndex: number, unitId: string): void {
    setPage(pageIndex);
    setActiveUnitId(unitId);
    setOriginalRequested(true);
    if (mode === 'original') onModeChange('dual');
  }

  function focusHeading(unitId: string): void {
    if (mode === 'bilingual' || mode === 'translation' || mode === 'pdf') onModeChange('original');
    setActiveUnitId(unitId);
    window.requestAnimationFrame(() => {
      document.getElementById(unitId)?.scrollIntoView({ block: 'start' });
    });
    if (window.innerWidth < 900) setTocOpen(false);
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
  const showTranslation = mode === 'bilingual' || mode === 'translation';

  return (
    <div className={`source-reader-workspace${tocOpen ? '' : ' no-toc'}`} ref={workspaceRef}>
      <header className="source-reader-toolbar">
        <div className="source-reader-identity"><strong>{title}</strong><span>阅读版本 {original.binding.parseRevision}</span></div>
        <Button type="button" size="sm" variant="ghost" aria-expanded={tocOpen} onClick={() => setTocOpen(value => !value)}>
          <List aria-hidden="true" />目录
        </Button>
        <div className="source-reader-mode-tabs" aria-label="阅读模式">
          {READER_MODES.map(item => <button key={item.value} type="button" aria-pressed={mode === item.value}
            onClick={() => { setMobileSecondary(false); onModeChange(item.value); }}>{item.label}</button>)}
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => void toggleFullscreen()}>
          {fullscreen ? <Minimize aria-hidden="true" /> : <Expand aria-hidden="true" />}{fullscreen ? '退出全屏' : '全屏'}
        </Button>
        <Button asChild size="sm" variant="outline" className="source-reader-return">
          <Link to={returnRoute}><ArrowLeft aria-hidden="true" />{returnLabel}</Link>
        </Button>
        {mode === 'dual' ? <Button type="button" size="sm" variant="outline" className="source-reader-mobile-switch"
          onClick={() => setMobileSecondary(value => !value)}>{mobileSecondary ? '查看原文' : '查看原件'}</Button> : null}
      </header>
      {fullscreenMessage ? <p className="source-reader-fullscreen-message" role="status">{fullscreenMessage}</p> : null}

      <div className="source-reader-layout">
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
        <div className="source-reader-toc-boundary">
          <strong>固定解析版本</strong>
          <span>阅读版本 {original.binding.parseRevision}</span>
          <span>业务主题目录暂不可用。</span>
        </div>
      </aside> : null}

      <section className={`source-reader-stage mode-${mode}`}>
        {showTranslation ? (
          <div className="source-reader-translation">
            <div className="source-reader-pane-title"><strong>{mode === 'translation' ? '中文阅读' : '中英对照'}</strong>
              <span>完整语义与原文来源保持关联</span></div>
            <div className="source-reader-bilingual">{bilingualContent}</div>
          </div>
        ) : (
          <div
            className={`source-reader-columns${showText && showPdf ? '' : ' is-single'}${mobileSecondary ? ' show-secondary' : ''}`}
            style={columnStyle}
          >
            {showText ? <div className="source-reader-primary">
              <div className="source-reader-pane-title"><strong>连续结构化原文</strong><span>源文顺序与完整语义保留</span></div>
              <div className="source-reader-pane-scroll"><DocumentOriginalReader original={original}
                activeUnitId={activeUnitId} onUnitLocate={locateUnit} /></div>
            </div> : null}
            {showText && showPdf ? (
              <>
                <div
                  className="source-reader-splitter"
                  role="separator"
                  tabIndex={0}
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
                <div className="source-reader-pdf-pane">
                  <div className="source-reader-pane-title"><strong>PDF 原件</strong><span>受控读取 · 第 {page} 页</span></div>
                  {renderPdfPreview ? renderPdfPreview(page) : <DocumentOriginalInlinePreview documentVersionId={documentVersionId} page={page} autoLoad={originalRequested} />}
                </div>
              </>
            ) : showPdf ? <div className="source-reader-pdf-pane">
              <div className="source-reader-pane-title"><strong>PDF 原件</strong><span>受控读取 · 第 {page} 页</span></div>
              {renderPdfPreview ? renderPdfPreview(page) : <DocumentOriginalInlinePreview documentVersionId={documentVersionId} page={page} />}
            </div> : null}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
