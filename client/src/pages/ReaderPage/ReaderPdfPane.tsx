import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import type { ReaderDocument } from './index';

interface ReaderPdfPaneProps {
  document: ReaderDocument;
  page: number;
  zoom: number;
  selectedBlockId: string;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
}

export default function ReaderPdfPane({
  document,
  page,
  zoom,
  selectedBlockId,
  onPageChange,
  onZoomChange,
}: ReaderPdfPaneProps) {
  const pdf = document.pdf;
  const currentBlock = document.blocks.find((b) => b.id === selectedBlockId);
  const location = currentBlock && document.locations?.[selectedBlockId];

  // PDF 不可用状态
  if (!pdf || document.pdfState !== 'available') {
    return (
      <div className="reader-pdf-pane panel">
        <div className="pdf-empty">
          <h3>
            {document.pdfState === 'native'
              ? '此来源为原生记录'
              : '原件暂不可用'}
          </h3>
          <p>
            {document.pdfState === 'native'
              ? '可继续阅读原始记录及其字段。'
              : '已取得的原文仍可阅读；原件就绪后再对照。'}
          </p>
        </div>
      </div>
    );
  }

  const canGoPrev = page > 0;
  const canGoNext = pdf && page < pdf.pageCount - 1;

  return (
    <div className="reader-pdf-pane">
      <div className="pdf-toolbar">
        <b>原件页图</b>

        <div className="pdf-nav">
          <button
            className="btn btn-sm btn-icon"
            disabled={!canGoPrev}
            onClick={() => canGoPrev && onPageChange(page - 1)}
            aria-label="上一页"
          >
            <ChevronLeft size={16} />
          </button>

          <span className="pdf-page-indicator">
            {page + 1} / {pdf.pageCount}
          </span>

          <button
            className="btn btn-sm btn-icon"
            disabled={!canGoNext}
            onClick={() => canGoNext && onPageChange(page + 1)}
            aria-label="下一页"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="pdf-zoom">
          <button
            className="btn btn-sm btn-icon"
            disabled={zoom <= 70}
            onClick={() => onZoomChange(Math.max(70, zoom - 10))}
            aria-label="缩小"
          >
            <Minus size={16} />
          </button>

          <span className="pdf-zoom-indicator">{zoom}%</span>

          <button
            className="btn btn-sm btn-icon"
            disabled={zoom >= 160}
            onClick={() => onZoomChange(Math.min(160, zoom + 10))}
            aria-label="放大"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div className="pdf-scroll scroll-region" data-scroll-key={`pdf-${document.id}`}>
        <div className="pdf-paper" style={{ width: `${zoom}%` }}>
          {pdf.pages?.[page] ? (
            <img
              src={pdf.pages[page]}
              alt={`${document.familyId} ${document.version} 原件第${page + 1}页`}
            />
          ) : (
            <div className="pdf-placeholder">
              <p>PDF 页面 {page + 1}</p>
              <small>原件渲染待接入</small>
            </div>
          )}

          {/* PDF 区域高亮 */}
          {location &&
            location.precision === 'REGION' &&
            location.pageIndex === page && (
              <div
                className="pdf-locate"
                style={{
                  left: `${(location.rect[0] / location.pageWidth) * 100}%`,
                  top: `${(location.rect[1] / location.pageHeight) * 100}%`,
                  width: `${(location.rect[2] / location.pageWidth) * 100}%`,
                  height: `${(location.rect[3] / location.pageHeight) * 100}%`,
                }}
              />
            )}
        </div>
      </div>
    </div>
  );
}
