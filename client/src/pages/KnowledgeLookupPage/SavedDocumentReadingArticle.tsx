import { useEffect, useState } from 'react';
import { readSavedDocumentReading } from '@client/src/api/canonical-host';
import { isRevokedMatterError } from '@client/src/features/matter/matter-read-error';
import type { CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import type { DocumentReadingQuote, DocumentReadingResponse, DocumentReadingRevision, DocumentReadingStatement } from '@shared/document-reading.interface';
import { libraryDateLabel, projectLibraryDocumentReading } from '../WorkspaceHomePage/library-document-presentation';

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
  const sourceLimitations = reading.readCoverage.sourceCoverage.unresolvedRanges
    .filter(item => item.readingImpact !== 'DIAGNOSTIC').map(item => item.message);
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
    {reading.limitations.length || sourceLimitations.length ? <section className="knowledge-prose"><h2>阅读补充</h2>
      {[...reading.limitations, ...sourceLimitations].map((value, index) => <p key={index}>{value}</p>)}</section> : null}
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
  const identity = JSON.stringify([version.documentVersionId, preview?.readingRunRef, preview?.readingRevision]);
  const [saved, setSaved] = useState<{ identity: string; status: DocumentReadingResponse['status']; reading: DocumentReadingRevision | null } | null>(null);
  const [error, setError] = useState<{ detail: string; hidesContent: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    setSaved(null); setError(null);
    if (!preview || preview.sourceBinding.original.documentVersionId !== version.documentVersionId) return;
    void readSavedDocumentReading({ documentVersionId: version.documentVersionId,
      parseRunId: preview.sourceBinding.original.parseRunId, semanticRevision: preview.sourceBinding.semanticRevision,
      readingRevision: preview.readingRevision }, request.signal).then(result => {
      if (request.signal.aborted) return;
      if (result.reading && (result.reading.readingRunRef !== preview.readingRunRef || result.reading.readingRevision !== preview.readingRevision ||
          result.reading.sourceBinding.semanticRevision !== preview.sourceBinding.semanticRevision ||
          (Object.keys(preview.sourceBinding.original) as Array<keyof DocumentReadingRevision['sourceBinding']['original']>)
            .some(key => result.reading!.sourceBinding.original[key] !== preview.sourceBinding.original[key])))
        throw new Error('DOCUMENT_READING_BINDING_MISMATCH');
      setSaved({ identity, status: result.status, reading: result.status === 'AVAILABLE' ? result.reading : null });
    }).catch(reason => {
      if (request.signal.aborted) return;
      const detail = reason instanceof Error ? reason.message : '文档解读读取失败';
      setError({ detail, hidesContent: isRevokedMatterError(reason) || detail === 'DOCUMENT_READING_BINDING_MISMATCH' || detail === 'DOCUMENT_READING_OBSOLETE' });
    });
    return () => request.abort();
  }, [identity, retry]);
  const current = saved?.identity === identity ? saved : null;
  if (current?.reading) return <SavedDocumentReadingBody reading={current.reading} onOpenSource={onOpenSource} />;
  const projected = projectLibraryDocumentReading(version);
  return <>
    <h2>{current || error?.hidesContent ? projected.fileTitle : projected.headline || projected.fileTitle}</h2>
    {!current && projected.brief && !error?.hidesContent ? <p className="article-lead">{projected.brief}</p> : null}
    {!current && !error?.hidesContent && projected.conditionLines.length ? <section className="knowledge-prose"><h2>关键条件与说明</h2>
      <ul>{projected.conditionLines.map((line, index) => <li key={index}>{line}</li>)}</ul></section> : null}
    {error ? <div role="alert"><p>解读读取失败。<button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></p>
      <details><summary>错误详情</summary>{error.detail}</details></div> : null}
    {!error && (current?.status === 'RETRACTED' || projected.status === 'RETRACTED') ? <p>解读已撤回。</p> : null}
    {!error && (current?.status === 'NOT_GENERATED' || (!preview && projected.status !== 'RETRACTED')) ? <p>暂无已保存解读。</p> : null}
  </>;
}
