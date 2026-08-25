import { useEffect, useRef, useState } from 'react';
import { FileSearch, LocateFixed } from 'lucide-react';

import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';

import './pdf-source-pane.css';

export interface PdfSourcePaneProps {
  data: Pick<
    CanonicalDocumentParsingPageResponse,
    'workItem' | 'readerProjection'
  >;
  /** 当前定位的 sourceRef（来自深链） */
  requestedSourceRef: string;
  /** 点击页码定位：跳回 Reader 结构化视图 */
  onLocate: (unitId: string, sourceRef: string) => void;
}

/**
 * 中右 PDF 原文面板（Spec R01 §4.2）。
 * 与左侧结构化解析结果并排；展示 DocumentVersion 绑定与受控 PDF 预览状态。
 * PDF 页面预览不可用时明确显示原因，不用本地文件替代（§11.3 不伪造）。
 */
export default function PdfSourcePane({
  data,
  requestedSourceRef,
  onLocate,
}: PdfSourcePaneProps) {
  const pdfPreview = data.readerProjection?.pdfPreview ?? null;
  const translation = data.readerProjection?.translation ?? null;
  const translationDetail =
    translation?.status === 'UNAVAILABLE'
      ? translation.reason
      : translation
        ? `原文轴 ${translation.axes.ownerSourceReaderConsumptionAllowed ? '开放' : '关闭'} / 双语轴 ${translation.axes.bilingualTranslationConsumptionAllowed ? '开放' : '关闭'}`
        : null;
  const units = data.readerProjection?.units ?? [];

  // 当前定位 sourceRef 对应的页码 locators（用于「PDF 定位到正确页码」）
  const locatedPages = requestedSourceRef
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
        <FileSearch /> PDF 原文 · 中右栏
      </div>

      <div className="parse-pdf-binding">
        <span>受控文件来源</span>
        <strong>已绑定当前文件版本</strong>
        <p>{data.workItem.source.sourceByteLength.toLocaleString()} bytes</p>
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

      {pdfPreview ? (
        <div className="parse-reader-missing-state">
          <FileSearch aria-hidden="true" />
          <div>
            <strong>
              {pdfPreview.status === 'UNAVAILABLE'
                ? '暂不能预览 PDF 页面'
                : 'PDF 原文预览状态未知'}
            </strong>
            <p>
              {pdfPreview.reason ?? 'PDF_PREVIEW_PROJECTION_MISSING'}。
              不会用本地文件或猜测位置替代受控来源。
            </p>
          </div>
        </div>
      ) : null}

      {translation ? (
        <small className="parse-pdf-translation">
          双语投影：{translation.status}
          {translationDetail ? ` · ${translationDetail}` : ''}
        </small>
      ) : null}

      {locatedPages.length > 0 ? (
        <footer className="parse-pdf-located-actions">
          {locatedPages.map((loc) => (
            <button
              type="button"
              key={`${loc.unitId}-${loc.sourceRefId}`}
              onClick={() => onLocate(loc.unitId, loc.sourceRefId)}
            >
              在结构化解析中查看 {loc.sourceRefId.slice(0, 18)}…
            </button>
          ))}
        </footer>
      ) : null}
    </article>
  );
}
