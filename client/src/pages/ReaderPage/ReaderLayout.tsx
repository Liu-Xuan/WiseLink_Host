import { useRef, useEffect, useCallback } from 'react';
import type { ReaderDocument, ReaderViewMode, OutlineType } from './index';
import ReaderOutline from './ReaderOutline';
import ReaderTextPane from './ReaderTextPane';
import ReaderPdfPane from './ReaderPdfPane';
import ReaderSplitter from './ReaderSplitter';

interface ReaderLayoutProps {
  document: ReaderDocument;
  mode: ReaderViewMode;
  outline: boolean;
  outlineType: OutlineType;
  split: number;
  selectedBlockId: string;
  pdfPage: number;
  pdfZoom: number;
  sync: boolean;
  mobileSide: 'left' | 'right';
  onOutlineTypeChange: (type: OutlineType) => void;
  onSplitChange: (split: number) => void;
  onBlockSelect: (blockId: string) => void;
  onPdfPageChange: (page: number) => void;
  onPdfZoomChange: (zoom: number) => void;
}

export default function ReaderLayout({
  document,
  mode,
  outline,
  outlineType,
  split,
  selectedBlockId,
  pdfPage,
  pdfZoom,
  sync,
  mobileSide,
  onOutlineTypeChange,
  onSplitChange,
  onBlockSelect,
  onPdfPageChange,
  onPdfZoomChange,
}: ReaderLayoutProps) {
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const scrollLockRef = useRef(false);

  const isDoublePane = mode === 'original-pdf' || mode === 'bilingual';
  const leftLanguage = mode === 'chinese' ? 'zh' : 'en';

  // 滚动联动
  const handleScrollSync = useCallback(
    (sourcePane: 'left' | 'right') => {
      if (!sync || scrollLockRef.current) return;

      const sourceRef = sourcePane === 'left' ? leftPaneRef : rightPaneRef;
      const targetRef = sourcePane === 'left' ? rightPaneRef : leftPaneRef;

      if (!sourceRef.current) return;

      const blocks = sourceRef.current.querySelectorAll('[data-block-id]');
      const sourceTop = sourceRef.current.getBoundingClientRect().top;

      // 找到第一个可见的块
      let visibleBlock: Element | null = null;
      for (const block of Array.from(blocks)) {
        const rect = block.getBoundingClientRect();
        if (rect.bottom > sourceTop + 70) {
          visibleBlock = block;
          break;
        }
      }

      if (!visibleBlock) return;

      const blockId = visibleBlock.getAttribute('data-block-id');
      if (!blockId) return;

      // 更新选中状态
      onBlockSelect(blockId);

      // 同步到另一侧（仅在双栏模式且目标面板存在时）
      if (mode === 'bilingual' && targetRef.current) {
        const targetBlock = targetRef.current.querySelector(
          `[data-block-id="${blockId}"]`
        );
        if (targetBlock) {
          scrollLockRef.current = true;
          targetRef.current.scrollTop =
            (targetBlock as HTMLElement).offsetTop -
            targetRef.current.offsetTop -
            16;
          setTimeout(() => {
            scrollLockRef.current = false;
          }, 100);
        }
      }
    },
    [sync, mode, onBlockSelect]
  );

  // 块选择处理（从目录或点击）
  const handleBlockSelectWithScroll = useCallback(
    (blockId: string) => {
      onBlockSelect(blockId);

      scrollLockRef.current = true;

      // 滚动左侧面板
      if (leftPaneRef.current) {
        const leftBlock = leftPaneRef.current.querySelector(
          `[data-block-id="${blockId}"]`
        );
        if (leftBlock) {
          leftPaneRef.current.scrollTo({
            top:
              (leftBlock as HTMLElement).offsetTop -
              leftPaneRef.current.offsetTop -
              16,
            behavior: 'smooth',
          });
        }
      }

      // 滚动右侧面板
      if (rightPaneRef.current && isDoublePane) {
        const rightBlock = rightPaneRef.current.querySelector(
          `[data-block-id="${blockId}"]`
        );
        if (rightBlock) {
          rightPaneRef.current.scrollTo({
            top:
              (rightBlock as HTMLElement).offsetTop -
              rightPaneRef.current.offsetTop -
              16,
            behavior: 'smooth',
          });
        }
      }

      setTimeout(() => {
        scrollLockRef.current = false;
      }, 500);
    },
    [onBlockSelect, isDoublePane]
  );

  // 初始滚动到选中块
  useEffect(() => {
    const timer = setTimeout(() => {
      handleBlockSelectWithScroll(selectedBlockId);
    }, 130);
    return () => clearTimeout(timer);
  }, []); // 仅在挂载时执行

  return (
    <section
      className={`reader-layout ${outline ? '' : 'no-outline'} mobile-${mobileSide}`}
    >
      {outline && (
        <ReaderOutline
          document={document}
          outlineType={outlineType}
          selectedBlockId={selectedBlockId}
          onOutlineTypeChange={onOutlineTypeChange}
          onBlockSelect={handleBlockSelectWithScroll}
        />
      )}

      <div
        className={`reader-panes ${isDoublePane ? 'double' : 'single'}`}
        style={{
          gridTemplateColumns: isDoublePane
            ? `minmax(0, ${split}fr) 8px minmax(0, ${100 - split}fr)`
            : 'minmax(0, 1fr)',
        }}
      >
        {/* 左侧面板 */}
        {mode === 'pdf' ? (
          <ReaderPdfPane
            document={document}
            page={pdfPage}
            zoom={pdfZoom}
            selectedBlockId={selectedBlockId}
            onPageChange={onPdfPageChange}
            onZoomChange={onPdfZoomChange}
          />
        ) : (
          <ReaderTextPane
            ref={leftPaneRef}
            document={document}
            language={leftLanguage}
            selectedBlockId={selectedBlockId}
            scrollKey={`reader-left-${document.id}`}
            onScroll={() => handleScrollSync('left')}
            onBlockClick={handleBlockSelectWithScroll}
          />
        )}

        {/* 分隔条和右侧面板（仅双栏模式） */}
        {isDoublePane && (
          <>
            <ReaderSplitter value={split} onChange={onSplitChange} />

            {mode === 'bilingual' ? (
              <ReaderTextPane
                ref={rightPaneRef}
                document={document}
                language="zh"
                selectedBlockId={selectedBlockId}
                scrollKey={`reader-right-${document.id}`}
                onScroll={() => handleScrollSync('right')}
                onBlockClick={handleBlockSelectWithScroll}
              />
            ) : (
              <ReaderPdfPane
                document={document}
                page={pdfPage}
                zoom={pdfZoom}
                selectedBlockId={selectedBlockId}
                onPageChange={onPdfPageChange}
                onZoomChange={onPdfZoomChange}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
