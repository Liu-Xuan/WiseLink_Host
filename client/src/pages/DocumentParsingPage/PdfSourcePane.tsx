import { useEffect, useRef, useState } from 'react';
import { FileSearch, LocateFixed } from 'lucide-react';

import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalStructuredContentSourceLocator,
} from '@shared/api.interface';

import './pdf-source-pane.css';

export interface PdfSourcePaneProps {
  data: Pick<
    CanonicalDocumentParsingPageResponse,
    'workItem' | 'readerProjection'
  >;
  /** 当前定位的 sourceRef（来自深链） */
  requestedSourceRef: string;
  /** Sanitized locator supplied by full-content browsing when no query is active. */
  structuredLocator?: CanonicalStructuredContentSourceLocator | null;
  /** 点击页码定位：跳回 Reader 结构化视图 */
  onLocate: (unitId: string, sourceRef: string) => void;
}

function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes.toLocaleString('zh-CN')} 字节`;
}

/**
 * 中右 PDF 原文面板（Spec R01 §4.2）。
 * 与左侧结构化解析结果并排；展示 DocumentVersion 绑定与受控 PDF 预览状态。
 * PDF 页面预览不可用时明确显示原因，不用本地文件替代（§11.3 不伪造）。
 */
export default function PdfSourcePane({
  data,
  requestedSourceRef,
  structuredLocator = null,
  onLocate,
}: PdfSourcePaneProps) {
  const pdfPreview = data.readerProjection?.pdfPreview ?? null;
  const translation = data.readerProjection?.translation ?? null;
  const units = data.readerProjection?.units ?? [];

  // 当前定位 sourceRef 对应的页码 locators（用于「PDF 定位到正确页码」）
  const queryLocatedPages = requestedSourceRef
    ? units.flatMap((unit) =>
        unit.sourceLocators
          .filter((locator) => locator.sourceRefId === requestedSourceRef)
          .map((locator) => ({
            unitId: unit.unitId,
            sourceRefId: locator.sourceRefId,
            pageStart: locator.pageStart,
            pageEnd: locator.pageEnd,
            quote: locator.quote ?? null,
          })),
      )
    : [];
  const locatedPages =
    queryLocatedPages.length > 0
      ? queryLocatedPages
      : structuredLocator?.sourceRefId === requestedSourceRef
        ? [
            {
              unitId: '',
              sourceRefId: structuredLocator.sourceRefId,
              pageStart: structuredLocator.pageStart,
              pageEnd: structuredLocator.pageEnd,
              quote: structuredLocator.quote,
            },
          ]
        : [];

  /* §06 原文定位：SourceRef 点击后 PDF 区域一次性淡入高亮 900ms。
   * 定位目标变化时重新触发一次动画（remove → reflow → add）。 */
  const locateCardRef = useRef<HTMLDivElement | null>(null);
  const prevSourceRefRef = useRef<string>('');
  useEffect(() => {
    if (requestedSourceRef && requestedSourceRef !== prevSourceRefRef.current) {
      const card = locateCardRef.current;
      if (card) {
        card.classList.remove('wl-source-flash');
        // 强制 reflow 以重新触发一次性动画
        void card.offsetWidth;
        card.classList.add('wl-source-flash');
      }
    }
    prevSourceRefRef.current = requestedSourceRef;
  }, [requestedSourceRef]);

  // §10.2 屏幕阅读器播报：已定位到第 N 页 + 引文
  const locateAnnouncement =
    requestedSourceRef && locatedPages.length > 0
      ? `已定位到${locatedPages
          .map(
            (loc) =>
              `第 ${loc.pageStart ?? '?'} 页${
                loc.pageEnd && loc.pageEnd !== loc.pageStart
                  ? `至第 ${loc.pageEnd} 页`
                  : ''
              }`,
          )
          .join('、')}${
          locatedPages[0]?.quote ? `，${locatedPages[0].quote}` : ''
        }`
      : null;

  return (
    <article className="parse-panel parse-pdf-pane" aria-label="PDF 原文与定位">
      <div className="parse-panel-label">
        <FileSearch aria-hidden="true" /> PDF 原文
      </div>

      <div className="parse-pdf-binding">
        <span>受控文件来源</span>
        <strong>已绑定当前文件版本</strong>
        <p>{fileSizeLabel(data.workItem.source.sourceByteLength)}</p>
      </div>

      {requestedSourceRef && locatedPages.length > 0 ? (
        <div
          className="parse-pdf-located"
          ref={locateCardRef}
          role="status"
          aria-live="polite"
        >
          <LocateFixed aria-hidden="true" />
          <div>
            <span>当前定位</span>
            <strong>
              {locatedPages
                .map(
                  (loc) =>
                    `页 ${loc.pageStart ?? '?'}${loc.pageEnd && loc.pageEnd !== loc.pageStart ? `-${loc.pageEnd}` : ''}`,
                )
                .join(' · ')}
            </strong>
            {locatedPages[0]?.quote ? (
              <small>“{locatedPages[0].quote}”</small>
            ) : null}
          </div>
        </div>
      ) : null}
      {/* §10.2 屏幕阅读器定位播报（视觉隐藏） */}
      {locateAnnouncement ? (
        <p className="wl-visually-hidden" role="status">
          {locateAnnouncement}
        </p>
      ) : null}

      <div className="parse-pdf-canvas" role="note">
        <FileSearch aria-hidden="true" />
        <div>
          <strong>
            {pdfPreview?.status === 'UNAVAILABLE'
              ? '暂不能预览 PDF 页面'
              : 'PDF 页面预览尚未提供'}
          </strong>
          <p>
            当前受控读取链尚未提供可连续滚动与缩放的 PDF 页面画布。
            可先使用左侧结构化原文和页码定位。
          </p>
        </div>
      </div>

      {translation ? (
        <small className="parse-pdf-translation">
          {translation.status === 'UNAVAILABLE'
            ? '中英文对照尚未提供'
            : '可在中英文对照视图查看已核验译文'}
        </small>
      ) : null}

      {locatedPages.some((location) => location.unitId !== '') ? (
        <footer className="parse-pdf-located-actions">
          {locatedPages
            .filter((location) => location.unitId !== '')
            .map((loc, index) => (
              <button
                type="button"
                key={`${loc.unitId}-${loc.sourceRefId}`}
                onClick={() => onLocate(loc.unitId, loc.sourceRefId)}
              >
                在结构化原文中查看依据 {index + 1}
              </button>
            ))}
        </footer>
      ) : null}
    </article>
  );
}
