import { FileSearch, Languages, LocateFixed, Search, X } from 'lucide-react';

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
  return '缺失投影';
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

  return (
    <article
      className="parse-panel parse-query-card parse-reader-workspace"
      id="workspace-reader"
    >
      <div className="parse-panel-label">
        <FileSearch /> 同一 Reader 查询 · 受控视图
      </div>
      <div
        className="parse-reader-modes"
        role="tablist"
        aria-label="Reader 视图"
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
              type="button"
              role="tab"
              aria-selected={readerMode === capability.mode}
              className={`parse-reader-mode${
                readerMode === capability.mode ? ' is-active' : ''
              }`}
              key={capability.mode}
              onClick={() => onReaderModeChange(capability.mode)}
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
        <span>Host projection · CURRENT_WORKITEM_ONLY</span>
      </div>

      {readerMode === 'source' ? (
        <section className="parse-reader-source-view" aria-label="PDF 原文绑定">
          <div>
            <span>DOCUMENTVERSION SOURCE</span>
            <strong>{data.workItem.source.documentVersionId}</strong>
            <p>
              文件标识：{data.workItem.source.sourceArtifactId} ·{' '}
              {data.workItem.source.sourceByteLength.toLocaleString()} bytes
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
                {data.readerProjection?.pdfPreview.reason ??
                  'PDF_PREVIEW_PROJECTION_MISSING'}
                。不会用本地文件或猜测位置替代受控来源。
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {readerMode === 'bilingual' ? (
        <section className="parse-reader-missing-state" aria-label="双语视图">
          <Languages aria-hidden="true" />
          <div>
            <strong>{translationView?.headline ?? '中英文对照暂不可用'}</strong>
            <p>
              {translationView?.detail ?? 'TRANSLATION_PROJECTION_MISSING'}
              。页面不会推断或补造译文，两条消费轴由 Host 派生。
            </p>
            {translationView ? (
              <small>
                原文轴：
                {translationView.ownerSourceReaderConsumptionAllowed
                  ? '开放'
                  : '关闭'}{' '}
                · 双语轴：
                {translationView.bilingualTranslationConsumptionAllowed
                  ? '开放'
                  : '关闭'}
              </small>
            ) : null}
          </div>
        </section>
      ) : null}

      {readerMode === 'structured' ? (
        <>
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
                <span>SELECTED SOURCE REF</span>
                <strong title={requestedSourceRef}>{requestedSourceRef}</strong>
                <small>
                  {selectedReaderResult
                    ? `unit · ${selectedReaderResult.unitId}`
                    : 'SOURCE_REF_NOT_IN_CURRENT_QUERY'}
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
                  <span>{result.kind}</span>
                  <p>{result.text}</p>
                  <small>
                    {result.sourceRefIds.length} 个 sourceRef ·{' '}
                    {result.sourceLocators.length} 个 locator · {result.unitId}
                  </small>
                  <div
                    className="parse-result-source-refs"
                    aria-label={`${result.unitId} 来源引用`}
                  >
                    {result.sourceRefIds.map((sourceRef: string) => (
                      <button
                        type="button"
                        className={
                          requestedSourceRef === sourceRef ? 'is-selected' : ''
                        }
                        key={sourceRef}
                        title={sourceRef}
                        onClick={() =>
                          onSourceRefSelect(result.unitId, sourceRef)
                        }
                      >
                        <LocateFixed aria-hidden="true" />
                        {sourceRef}
                      </button>
                    ))}
                  </div>
                  {result.sourceLocators.length > 0 ? (
                    <div
                      className="parse-reader-locators"
                      aria-label={`${result.unitId} 受控来源定位`}
                    >
                      {result.sourceLocators.map((locator) => (
                        <div
                          className="parse-reader-locator"
                          key={`${result.unitId}-${locator.sourceRefId}`}
                        >
                          <span>{locator.sourceRefId}</span>
                          <p>
                            {locator.pageStart !== null
                              ? `页 ${locator.pageStart}${locator.pageEnd && locator.pageEnd !== locator.pageStart ? `-${locator.pageEnd}` : ''}`
                              : '页码未投影'}
                            {' · '}
                            {locator.charStart !== null
                              ? `字符 ${locator.charStart}${locator.charEnd !== null ? `-${locator.charEnd}` : ''}`
                              : '字符区间未投影'}
                          </p>
                          <small
                            title={
                              locator.normalizedPath ??
                              locator.xpath ??
                              locator.elementId ??
                              undefined
                            }
                          >
                            {locator.normalizedPath ??
                              locator.xpath ??
                              locator.elementId ??
                              locator.quote ??
                              '结构路径未投影'}
                            {locator.bbox
                              ? ` · bbox ${locator.bbox.join(',')}`
                              : ''}
                          </small>
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
        </>
      ) : null}
    </article>
  );
}

export type { DocumentReaderWorkspaceProps };
