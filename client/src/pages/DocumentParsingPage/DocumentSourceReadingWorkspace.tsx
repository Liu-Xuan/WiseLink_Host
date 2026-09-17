import { ArrowLeft, Expand, List } from 'lucide-react';
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

export type DocumentSourceReaderMode = 'dual' | 'bilingual' | 'original';

interface Props {
  original: DocumentOriginalResult;
  documentVersionId: string;
  mode: DocumentSourceReaderMode;
  onModeChange: (mode: DocumentSourceReaderMode) => void;
  bilingualContent: ReactNode;
  returnRoute: string;
  returnLabel: string;
  initialPage?: number;
}

export function DocumentSourceReadingWorkspace({
  original,
  documentVersionId,
  mode,
  onModeChange,
  bilingualContent,
  returnRoute,
  returnLabel,
  initialPage,
}: Props) {
  const stageRef = useRef<HTMLElement>(null);
  const [split, setSplit] = useState(50);
  const [page, setPage] = useState(initialPage ?? 1);
  const [tocOpen, setTocOpen] = useState(false);
  const [mobileSecondary, setMobileSecondary] = useState(false);
  const [originalRequested, setOriginalRequested] = useState(false);
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
    if (initialPage) setPage(initialPage);
  }, [initialPage]);

  useEffect(() => {
    setOriginalRequested(false);
  }, [documentVersionId]);

  function locateUnit(pageIndex: number): void {
    setPage(pageIndex);
    setOriginalRequested(true);
    if (mode === 'original') onModeChange('dual');
  }

  function focusHeading(unitId: string): void {
    if (mode === 'bilingual') onModeChange('dual');
    window.requestAnimationFrame(() => {
      document.getElementById(unitId)?.scrollIntoView({ block: 'start' });
    });
    setTocOpen(false);
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
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      // Some embedded browsers deny fullscreen. The reader remains usable in place.
    }
  }

  const columnStyle = {
    '--reader-split': `${split}%`,
  } as CSSProperties;

  return (
    <div className="source-reader-layout">
      <aside className={`source-reader-toc${tocOpen ? ' is-open' : ''}`}>
        <div className="source-reader-toc-modes" aria-label="目录类型">
          <button type="button" aria-pressed="true">作者章节</button>
          <button type="button" disabled title="当前读取合同尚未提供业务主题目录">业务主题</button>
        </div>
        <nav aria-label="作者章节目录">
          {headings.length ? (
            headings.map((heading) => (
              <button key={heading.unitId} type="button" onClick={() => focusHeading(heading.unitId)}>
                {String(heading.payload.text ?? '')}
              </button>
            ))
          ) : (
            <p>当前原文没有可用的作者章节标题。</p>
          )}
        </nav>
        <div className="source-reader-toc-boundary">
          <strong>固定解析版本</strong>
          <span>parse revision {original.binding.parseRevision}</span>
          <span>业务主题目录尚未取得，不由标题文字猜测。</span>
        </div>
      </aside>

      <section className="source-reader-stage" ref={stageRef}>
        <header className="source-reader-toolbar">
          <div className="source-reader-mode-tabs" aria-label="阅读模式">
            <button type="button" aria-pressed={mode === 'dual'} onClick={() => onModeChange('dual')}>原文＋原件</button>
            <button type="button" aria-pressed={mode === 'bilingual'} onClick={() => onModeChange('bilingual')}>中英对照</button>
            <button type="button" aria-pressed={mode === 'original'} onClick={() => onModeChange('original')}>仅原文</button>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => setTocOpen((value) => !value)}>
            <List aria-hidden="true" />目录
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void toggleFullscreen()}>
            <Expand aria-hidden="true" />全屏
          </Button>
          <Button asChild size="sm" variant="outline" className="source-reader-return">
            <Link to={returnRoute}><ArrowLeft aria-hidden="true" />{returnLabel}</Link>
          </Button>
          {mode === 'dual' ? (
            <Button type="button" size="sm" variant="outline" className="source-reader-mobile-switch" onClick={() => setMobileSecondary((value) => !value)}>
              {mobileSecondary ? '查看原文' : '查看原件'}
            </Button>
          ) : null}
        </header>

        {mode === 'bilingual' ? (
          <div className="source-reader-bilingual">{bilingualContent}</div>
        ) : (
          <div
            className={`source-reader-columns${mode === 'original' ? ' is-single' : ''}${mobileSecondary ? ' show-secondary' : ''}`}
            style={columnStyle}
          >
            <div className="source-reader-primary">
              <DocumentOriginalReader original={original} onUnitLocate={locateUnit} />
            </div>
            {mode === 'dual' ? (
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
                <DocumentOriginalInlinePreview documentVersionId={documentVersionId} page={page} autoLoad={originalRequested} />
              </>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
