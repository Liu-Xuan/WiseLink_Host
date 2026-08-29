import { useEffect, useMemo, useRef } from 'react';
import { FileSearch2, Link2, LocateFixed, PanelTop } from 'lucide-react';

import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalStructuredContentSourceLocator,
} from '@shared/api.interface';

import { summarizeWorkbenchEvidence } from './evidence-summary';

import './evidence-panel.css';

export interface EvidencePanelProps {
  data: CanonicalDocumentParsingPageResponse;
  /** 深链中的 sourceRef（用户当前定位的证据） */
  activeSourceRef: string;
  /** 深链中的 unit */
  activeReaderUnit: string;
  activeStructuredLocator?: CanonicalStructuredContentSourceLocator | null;
  /** 点击证据：跳转到 Reader 定位 */
  onLocate: (unitId: string, sourceRef: string) => void;
  /** 清除定位 */
  onClear: () => void;
}

/**
 * 证据面板（Spec R01 §4.2 底部证据栏 / §7 EvidencePanel）。
 * SourceRef 双向联动的“证据侧”：列出当前 Reader 查询返回的内容单元，
 * 点击任一 sourceRef 高亮并联动 Reader；被定位的条目播放一次定位动画。
 */
export default function EvidencePanel({
  data,
  activeSourceRef,
  activeReaderUnit,
  activeStructuredLocator = null,
  onLocate,
  onClear,
}: EvidencePanelProps) {
  const units = data.readerProjection?.units ?? [];
  const listRef = useRef<HTMLDivElement>(null);

  // 定位变化时滚动到目标条目并播放一次高亮
  useEffect(() => {
    if (!activeSourceRef) return;
    const target = listRef.current?.querySelector<HTMLElement>(
      `[data-evidence-ref="${CSS.escape(activeSourceRef)}"]`,
    );
    if (target) {
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      target.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'nearest',
      });
      if (!reduceMotion) {
        target.classList.remove('wl-source-flash');
        // 强制 reflow 重启动画
        void target.offsetWidth;
        target.classList.add('wl-source-flash');
      }
    }
  }, [activeSourceRef, activeReaderUnit, units.length]);

  const stats = useMemo(
    () => summarizeWorkbenchEvidence(units, activeStructuredLocator),
    [activeStructuredLocator, units],
  );

  return (
    <div className="wl-evidence-panel">
      <header className="wl-evidence-head">
        <div className="wl-evidence-title">
          <PanelTop aria-hidden="true" />
          <strong>原文依据</strong>
          <span>
            {stats.unitCount} 个内容单元 · {stats.referenceCount} 条来源引用
          </span>
        </div>
        {activeSourceRef ? (
          <button type="button" className="wl-evidence-clear" onClick={onClear}>
            <Link2 aria-hidden="true" />
            清除定位
          </button>
        ) : (
          <span className="wl-evidence-hint">点击依据可定位到原文位置</span>
        )}
      </header>

      <div className="wl-evidence-list" ref={listRef}>
        {units.length === 0 && activeStructuredLocator ? (
          <article
            className="wl-evidence-item is-target-unit"
            data-evidence-ref={activeStructuredLocator.sourceRefId}
          >
            <header>
              <FileSearch2 aria-hidden="true" />
              <strong>结构化内容来源</strong>
              <span>
                {activeStructuredLocator.pageStart === null
                  ? '原文定位'
                  : `PDF 第 ${activeStructuredLocator.pageStart} 页`}
              </span>
            </header>
            <p>
              {activeStructuredLocator.quote ??
                '当前来源已绑定到受控文件版本。'}
            </p>
          </article>
        ) : units.length === 0 ? (
          <p className="wl-evidence-empty">当前尚无可定位的原文依据。</p>
        ) : (
          units.map((unit, unitIndex) => {
            const isTargetUnit = unit.unitId === activeReaderUnit;
            return (
              <article
                key={unit.unitId}
                className={[
                  'wl-evidence-item',
                  isTargetUnit ? 'is-target-unit' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <header>
                  <FileSearch2 aria-hidden="true" />
                  <strong>内容 {unitIndex + 1}</strong>
                  <span>{evidenceKindLabel(unit.kind)}</span>
                </header>
                <p>{unit.text}</p>
                <footer>
                  {unit.sourceRefIds.length > 0 ? (
                    unit.sourceRefIds.map((ref, refIndex) => {
                      const isActive = ref === activeSourceRef;
                      return (
                        <button
                          key={ref}
                          type="button"
                          data-evidence-ref={ref}
                          className={`wl-evidence-ref${isActive ? ' is-active' : ''}`}
                          onClick={() => onLocate(unit.unitId, ref)}
                          aria-label={`定位内容 ${unitIndex + 1} 的第 ${refIndex + 1} 条依据`}
                        >
                          <LocateFixed aria-hidden="true" />
                          <span>依据 {refIndex + 1}</span>
                        </button>
                      );
                    })
                  ) : (
                    <span className="wl-evidence-no-ref">尚未关联原文位置</span>
                  )}
                </footer>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

function evidenceKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    SECTION: '章节',
    PARAGRAPH: '段落',
    TABLE_ROW: '表格行',
    NOTE: '注释',
  };
  return labels[kind] ?? '内容';
}
