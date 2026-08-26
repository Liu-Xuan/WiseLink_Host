import { FileSearch, Languages, LocateFixed, Search, X } from 'lucide-react';
import { useId, type KeyboardEvent } from 'react';

import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import type {
  CanonicalReaderProjection,
  CanonicalDocumentParsingPageResponse,
} from '@shared/api.interface';

import {
  buildReaderCapabilities,
  describeTranslationProjection,
  type ReaderCapability,
  type ReaderViewMode,
} from './workbench-projection';

interface DocumentReaderWorkspaceProps {
  data: Pick<
    CanonicalDocumentParsingPageResponse,
    'workItem' | 'entry' | 'readerProjection'
  >;
  query: string;
  requestedSourceRef: string;
  selectedReaderResult: CanonicalReaderProjection['units'][number] | undefined;
  readerMode: ReaderViewMode;
  onQueryChange: (value: string) => void;
  onQuerySubmit: () => void;
  onReaderModeChange: (mode: ReaderViewMode) => void;
  onSourceRefSelect: (unitId: string, sourceRef: string) => void;
  onClearSourceRef: () => void;
}

function statusLabel(status: ReaderCapability['status']): string {
  if (status === 'AVAILABLE') return '可用';
  if (status === 'LIMITED') return '受限';
  return '暂不可用';
}

function unitKindLabel(kind: string): string {
  const normalized = kind.trim().toUpperCase();
  if (normalized.includes('TITLE') || normalized.includes('HEADING')) {
    return '标题';
  }
  if (normalized.includes('TABLE')) return '表格内容';
  if (normalized.includes('LIST')) return '列表内容';
  if (normalized.includes('PARAGRAPH') || normalized.includes('TEXT')) {
    return '正文';
  }
  return '结构化内容';
}

function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes.toLocaleString('zh-CN')} 字节`;
}

export function DocumentReaderWorkspace({
  data,
  query,
  requestedSourceRef,
  selectedReaderResult,
  readerMode,
  onQueryChange,
  onQuerySubmit,
  onReaderModeChange,
  onSourceRefSelect,
  onClearSourceRef,
}: DocumentReaderWorkspaceProps) {
  const capabilities: ReaderCapability[] = buildReaderCapabilities({
    readerProjection: data.readerProjection ?? null,
  });
  const translationView = data.readerProjection
    ? describeTranslationProjection(data.readerProjection.translation)
    : null;
  const activeCapability: ReaderCapability =
    capabilities.find(
      (capability: ReaderCapability) => capability.mode === readerMode,
    ) ?? capabilities[1];
  const selectedLocator = selectedReaderResult?.sourceLocators.find(
    (locator) => locator.sourceRefId === requestedSourceRef,
  );
  const idPrefix = useId().replace(/:/gu, '');
  const panelId = `${idPrefix}-panel`;

  function handleModeKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentMode: ReaderViewMode,
  ): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = capabilities.findIndex(
      (capability) => capability.mode === currentMode,
    );
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? capabilities.length - 1
          : event.key === 'ArrowRight'
            ? (currentIndex + 1) % capabilities.length
            : (currentIndex - 1 + capabilities.length) % capabilities.length;
    const next = capabilities[nextIndex];
    onReaderModeChange(next.mode);
    window.requestAnimationFrame(() => {
      document.getElementById(`${idPrefix}-${next.mode}`)?.focus();
    });
  }

  return (
    <article
      className="parse-panel parse-query-card parse-reader-workspace"
      id="workspace-reader"
    >
      <div className="parse-panel-label">
        <FileSearch aria-hidden="true" /> 原文与解析
      </div>
      <div
        className="parse-reader-modes"
        role="tablist"
        aria-label="原文视图"
      >
        {capabilities.map((capability: ReaderCapability) => {
          const Icon =
            capability.mode === 'source'
              ? FileSearch
              : capability.mode === 'bilingual'
                ? Languages
                : Search;
          return (
            <button
              id={`${idPrefix}-${capability.mode}`}
              type="button"
              role="tab"
              aria-selected={readerMode === capability.mode}
              aria-controls={panelId}
              tabIndex={readerMode === capability.mode ? 0 : -1}
              className={`parse-reader-mode${
                readerMode === capability.mode ? ' is-active' : ''
              }`}
              key={capability.mode}
              onClick={() => onReaderModeChange(capability.mode)}
              onKeyDown={(event) =>
                handleModeKeyDown(event, capability.mode)
              }
            >
              <Icon aria-hidden="true" />
              <span>{capability.label}</span>
              <small>{statusLabel(capability.status)}</small>
            </button>
          );
        })}
      </div>
      <div className="parse-reader-capability-strip" aria-live="polite">
        <strong>{activeCapability.note}</strong>
        <span>当前事项 · 可追溯来源</span>
      </div>

      {readerMode === 'source' ? (
        <section
          id={panelId}
          className="parse-reader-source-view"
          role="tabpanel"
          aria-labelledby={`${idPrefix}-source`}
        >
          <div>
            <span>受控文件来源</span>
            <strong>已绑定当前文件版本</strong>
            <p>
              {fileSizeLabel(data.workItem.source.sourceByteLength)}
            </p>
          </div>
          <div className="parse-reader-missing-state">
            <FileSearch aria-hidden="true" />
            <div>
              <strong>
                {data.readerProjection?.pdfPreview.status === 'UNAVAILABLE'
                  ? '暂不能预览 PDF 页面'
                  : 'PDF 原文预览状态未知'}
              </strong>
              <p>
                当前受控读取链尚未提供 PDF 页面画布。你仍可使用结构化原文和页码定位。
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {readerMode === 'bilingual' ? (
        <section
          id={panelId}
          className="parse-reader-missing-state"
          role="tabpanel"
          aria-labelledby={`${idPrefix}-bilingual`}
        >
          <Languages aria-hidden="true" />
          <div>
            <strong>{translationView?.headline ?? '中英文对照暂不可用'}</strong>
            <p>
              {translationView?.detail ??
                '当前事项尚无可核验的译文。'}
            </p>
          </div>
        </section>
      ) : null}

      {readerMode === 'structured' ? (
        <section
          id={panelId}
          className="parse-reader-structured-view"
          role="tabpanel"
          aria-labelledby={`${idPrefix}-structured`}
        >
          <form
            className="parse-reader-query-form"
            onSubmit={(event) => {
              event.preventDefault();
              onQuerySubmit();
            }}
          >
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              aria-label="解析单元查询"
            />
            <Button type="submit" size="sm" data-ai-section-type="button">
              查询 <Search aria-hidden="true" />
            </Button>
          </form>
          {requestedSourceRef ? (
            <div
              className={`parse-reader-focus${
                selectedReaderResult ? '' : ' is-missing'
              }`}
              role="status"
            >
              <LocateFixed aria-hidden="true" />
              <div>
                <span>当前来源定位</span>
                <strong>
                  {selectedLocator?.pageStart !== null &&
                  selectedLocator?.pageStart !== undefined
                    ? `第 ${selectedLocator.pageStart} 页${selectedLocator.pageEnd && selectedLocator.pageEnd !== selectedLocator.pageStart ? `–${selectedLocator.pageEnd} 页` : ''}`
                    : '已选择一条原文依据'}
                </strong>
                <small>
                  {selectedReaderResult
                    ? '已在当前结构化原文中定位'
                    : '当前查询未返回这条依据，可清除定位后重新查询'}
                </small>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="清除来源定位"
                aria-label="清除来源定位"
                onClick={onClearSourceRef}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ) : null}
          <div className="parse-results" data-ai-section-type="card-list">
            {data.readerProjection?.units.length ? (
              data.readerProjection.units.map((result) => (
                <article
                  className={`parse-result${
                    selectedReaderResult?.unitId === result.unitId
                      ? ' is-selected'
                      : ''
                  }`}
                  key={result.unitId}
                >
                  <span>{unitKindLabel(result.kind)}</span>
                  <p>{result.text}</p>
                  <small>
                    {result.sourceRefIds.length} 条依据 ·{' '}
                    {result.sourceLocators.length} 个页码定位
                  </small>
                  <div
                    className="parse-result-source-refs"
                    aria-label="原文依据"
                  >
                    {result.sourceRefIds.map((sourceRef: string, index) => (
                      <button
                        type="button"
                        className={
                          requestedSourceRef === sourceRef ? 'is-selected' : ''
                        }
                        key={sourceRef}
                        aria-label={`定位第 ${index + 1} 条原文依据`}
                        onClick={() =>
                          onSourceRefSelect(result.unitId, sourceRef)
                        }
                      >
                        <LocateFixed aria-hidden="true" />
                        依据 {index + 1}
                      </button>
                    ))}
                  </div>
                  {result.sourceLocators.length > 0 ? (
                    <div
                      className="parse-reader-locators"
                      aria-label="受控来源定位"
                    >
                      {result.sourceLocators.map((locator, index) => (
                        <div
                          className="parse-reader-locator"
                          key={`${result.unitId}-${locator.sourceRefId}`}
                        >
                          <span>来源位置 {index + 1}</span>
                          <p>
                            {locator.pageStart !== null
                              ? `页 ${locator.pageStart}${locator.pageEnd && locator.pageEnd !== locator.pageStart ? `-${locator.pageEnd}` : ''}`
                              : '页码未投影'}
                          </p>
                          <small>{locator.quote ?? '当前来源未返回可展示引文'}</small>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="parse-empty">没有匹配的来源绑定单元。</p>
            )}
          </div>
        </section>
      ) : null}
    </article>
  );
}

export type { DocumentReaderWorkspaceProps };
