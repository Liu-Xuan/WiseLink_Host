import { useCallback } from 'react';
import { getCanonicalHostClientSessionGeneration, readSavedDocumentReading } from '@client/src/api/canonical-host';
import { useAuthorizedSummaryResource } from '@client/src/features/derived-summary/useAuthorizedSummaryResource';
import type { CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import type { DocumentReadingQuote, DocumentReadingResponse, DocumentReadingRevision, DocumentReadingStatement } from '@shared/document-reading.interface';
import { libraryDateLabel, projectLibraryDocumentReading } from '../WorkspaceHomePage/library-document-presentation';
import { documentReadingLimitations } from '../DocumentParsingPage/document-reading-presentation';

export function savedDocumentReadingSourceRoute(reading: DocumentReadingRevision, quote?: DocumentReadingQuote): string | null {
  const binding = reading.sourceBinding.original;
  const params = new URLSearchParams({ parseRunId: binding.parseRunId });
  if (quote) {
    const anchor = reading.sourceAnchors.find(item => item.anchorId === quote.anchorId);
    if (!anchor || !anchor.sourceRefIds.length) return null;
    params.set('sourceRef', anchor.sourceRefIds[0]);
  }
  return `/document-versions/${encodeURIComponent(binding.documentVersionId)}?${params}`;
}

export function SavedDocumentReadingBody({ reading, onOpenSource }: {
  reading: DocumentReadingRevision; onOpenSource: (route: string) => void;
}) {
  const limitations = documentReadingLimitations(reading.limitations);
  const sourceRanges = reading.readCoverage.sourceCoverage.unresolvedRanges;
  const statement = (value: DocumentReadingStatement, key: string) => <div key={key}>
    <p className="whitespace-pre-wrap">{value.text}</p>
    {value.quotes.length ? <details><summary>依据</summary>
      {value.quotes.map((quote, index) => {
        const route = savedDocumentReadingSourceRoute(reading, quote);
        return route ? <button type="button" key={`${quote.anchorId}:${index}`}
          onClick={() => onOpenSource(route)}>“{quote.text}”</button> : <span key={index}>{quote.text}</span>;
      })}
    </details> : null}
  </div>;
  return <>
    <h2>{reading.headline}</h2>
    {statement(reading.brief, 'brief')}
    {reading.explanation.map((value, index) => statement(value, `explanation-${index}`))}
    {reading.criticalConditions.length ? <section className="knowledge-prose"><h2>关键条件</h2>
      {reading.criticalConditions.map((value, index) => statement(value, `condition-${index}`))}</section> : null}
    {limitations.length ? <section className="knowledge-prose"><h2>阅读补充</h2>
      {limitations.map((value, index) => <p key={index}>{value}</p>)}</section> : null}
    {sourceRanges.length ? <details className="knowledge-prose" aria-label="原文差异与缺项">
      <summary>原文差异与缺项（{sourceRanges.length} 项）</summary>
      <ul>{sourceRanges.map((range, index) => <li key={index}>
        {range.pageIndexes.length ? `第 ${range.pageIndexes.map(page => page + 1).join('、')} 页：` : ''}{range.message}
      </li>)}</ul>
    </details> : null}
    <details className="knowledge-prose"><summary>保存与来源</summary>
      <p>保存时间：{libraryDateLabel(reading.savedAt)}</p>
      <p>来源解析版本：{reading.sourceBinding.original.parseRevision}</p>
      <p>已读取 {reading.readCoverage.deliveredUnitIds.length} / {reading.readCoverage.totalUnitCount} 个来源单元</p>
      <button type="button" onClick={() => onOpenSource(savedDocumentReadingSourceRoute(reading)!)}>查看原文</button>
    </details>
  </>;
}

export default function SavedDocumentReadingArticle({ version, onOpenSource }: {
  version: CanonicalLibraryDocumentVersionSummary; onOpenSource: (route: string) => void;
}) {
  const preview = version.documentReading && ['AVAILABLE', 'SOURCE_CHANGED'].includes(version.documentReading.status)
    ? version.documentReading.reading : null;
  const identity = JSON.stringify([version.documentVersionId, preview?.sourceBinding,
    preview?.readingRunRef, preview?.readingRevision]);
  const load = useCallback(async (signal: AbortSignal): Promise<DocumentReadingResponse> => {
    if (!preview || preview.sourceBinding.original.documentVersionId !== version.documentVersionId)
      throw new Error('DOCUMENT_READING_BINDING_MISMATCH');
    const result = await readSavedDocumentReading({ documentVersionId: version.documentVersionId,
      parseRunId: preview.sourceBinding.original.parseRunId, semanticRevision: preview.sourceBinding.semanticRevision,
      readingRevision: preview.readingRevision }, signal);
    const matches = (binding: DocumentReadingRevision['sourceBinding']): boolean =>
      binding.semanticRevision === preview.sourceBinding.semanticRevision &&
        (Object.keys(preview.sourceBinding.original) as Array<keyof DocumentReadingRevision['sourceBinding']['original']>)
          .every(key => binding.original[key] === preview.sourceBinding.original[key]);
    if (!matches(result.sourceBinding) || (result.reading &&
      (result.reading.readingRunRef !== preview.readingRunRef || result.reading.readingRevision !== preview.readingRevision ||
        !matches(result.reading.sourceBinding))))
      throw new Error('DOCUMENT_READING_BINDING_MISMATCH');
    return result;
  }, [identity]);
  const resource = useAuthorizedSummaryResource(identity, getCanonicalHostClientSessionGeneration(), load,
    { enabled: Boolean(preview) });
  const current = resource.data;
  const error = resource.error;
  const showPreview = resource.authorized && !resource.withheld && !current && (!error || resource.temporaryError);
  const projected = projectLibraryDocumentReading(version);
  return <>
    {resource.loading && !current ? <p role="status">正在读取文档解读…</p> : null}
    {error ? <div role="alert"><p>解读读取失败。{resource.retainedAfterError && current?.reading ? '保留同版正文。' : ''}
      <button type="button" onClick={() => { void resource.refresh(); }}>重试</button></p>
      <details><summary>错误详情</summary>{error}</details></div> : null}
    {current?.status === 'AVAILABLE' && current.reading
      ? <SavedDocumentReadingBody reading={current.reading} onOpenSource={onOpenSource} /> : <>
    <h2>{showPreview ? projected.headline || projected.fileTitle : projected.fileTitle}</h2>
    {showPreview && projected.brief ? <p className="article-lead">{projected.brief}</p> : null}
    {showPreview && projected.conditionLines.length ? <section className="knowledge-prose"><h2>关键条件与说明</h2>
      <ul>{projected.conditionLines.map((line, index) => <li key={index}>{line}</li>)}</ul></section> : null}
    {!error && (current?.status === 'RETRACTED' || projected.status === 'RETRACTED') ? <p>解读已撤回。</p> : null}
    {!error && (current?.status === 'NOT_GENERATED' || (!preview && projected.status !== 'RETRACTED')) ? <p>暂无已保存解读。</p> : null}
    </>}
  </>;
}
