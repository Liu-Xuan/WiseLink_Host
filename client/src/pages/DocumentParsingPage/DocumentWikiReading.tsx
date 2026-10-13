import { useCallback } from 'react';
import type { DocumentReadingStatement } from '@shared/document-reading.interface';
import { readDocumentWiki } from '@client/src/api/document-wiki';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useSummaryResource } from '@client/src/features/derived-summary/useSummaryResource';
import { Button } from '@client/src/components/ui/button';
import { documentReadingLimitations } from './document-reading-presentation';

/** An exact saved independent reading; it never substitutes the latest reading
 * or raw source page when a pinned result has been withdrawn. */
export default function DocumentWikiReading({
  documentVersionId,
  parseRunId,
  semanticRevision,
  readingRevision,
  readingRunRef,
  onAccessRejected,
  onLocate,
}: {
  documentVersionId: string;
  parseRunId: string;
  semanticRevision: number;
  readingRevision: number;
  readingRunRef?: string;
  onAccessRejected(): void;
  onLocate(unitId: string): void;
}) {
  const { sessionGeneration } = useCurrentUserSession();
  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const result = await readDocumentWiki(
          { documentVersionId, parseRunId, semanticRevision, readingRevision },
          signal,
        );
        if (
          result.reading &&
          readingRunRef &&
          result.reading.readingRunRef !== readingRunRef
        )
          throw new Error('文档 Wiki 版本不一致。');
        return result;
      } catch (reason) {
        if (
          !signal.aborted &&
          typeof reason === 'object' &&
          reason !== null &&
          'statusCode' in reason &&
          [401, 403, 404].includes(Number(reason.statusCode))
        )
          onAccessRejected();
        throw reason;
      }
    },
    [
      documentVersionId,
      parseRunId,
      semanticRevision,
      readingRevision,
      readingRunRef,
      onAccessRejected,
    ],
  );
  const resource = useSummaryResource(
    JSON.stringify([
      documentVersionId,
      parseRunId,
      semanticRevision,
      readingRevision,
      readingRunRef,
    ]),
    sessionGeneration,
    load,
  );
  const reading = resource.data?.reading;
  const limitations = documentReadingLimitations(reading?.limitations ?? []);
  const sourceRanges = reading?.readCoverage.sourceCoverage.unresolvedRanges ?? [];
  const statement = (value: DocumentReadingStatement, key: string) => (
    <div key={key} className="space-y-2">
      <p className="whitespace-pre-wrap">{value.text}</p>
      {value.quotes.map((quote, index) => {
        const anchor = reading?.sourceAnchors.find(
          (item) => item.anchorId === quote.anchorId,
        );
        return (
          <details key={`${quote.anchorId}:${index}`}>
            <summary className="cursor-pointer text-sm">原文依据</summary>
            <blockquote className="whitespace-pre-wrap border-l-2 p-2">
              {quote.text}
            </blockquote>
            {anchor ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onLocate(anchor.sourceUnitId)}
              >
                定位原文
              </Button>
            ) : null}
          </details>
        );
      })}
    </div>
  );
  return (
    <section
      className="space-y-4 border border-border p-4"
      aria-label="文档解读"
    >
      {resource.loading ? (
        <p role="status">正在读取文档解读…</p>
      ) : null}
      {resource.error ? <p role="alert">{resource.error}</p> : null}
      {resource.data?.status === 'RETRACTED' ? (
        <p role="alert">该文档 Wiki 已撤回。</p>
      ) : null}
      {resource.data?.status === 'NOT_GENERATED' ? (
        <p>尚无保存的文档解读。</p>
      ) : null}
      {reading ? (
        <>
          <h2 className="text-xl font-semibold">{reading.headline}</h2>
          <p className="text-sm">
            文档解读修订 {reading.readingRevision}
          </p>
          {statement(reading.brief, 'brief')}
          {reading.explanation.map((item, index) =>
            statement(item, `explanation:${index}`),
          )}
          {reading.criticalConditions.length ? (
            <div className="space-y-3">
              <h3 className="font-semibold">关键条件</h3>
              {reading.criticalConditions.map((item, index) =>
                statement(item, `condition:${index}`),
              )}
            </div>
          ) : null}
          <details>
            <summary className="cursor-pointer text-sm">原文读取范围</summary>
            <p>
              {reading.readCoverage.deliveredUnitIds.length} /{' '}
              {reading.readCoverage.totalUnitCount}
              {reading.readCoverage.status === 'PARTIAL_DELIVERY'
                ? '，仍有未读取内容。'
                : null}
            </p>
          </details>
          {limitations.length ? <div className="space-y-2">
            <h3 className="font-semibold">阅读补充</h3>
            {limitations.map((item, index) => <p key={index}>{item}</p>)}
          </div> : null}
          {sourceRanges.length ? <details aria-label="原文差异与缺项">
            <summary className="cursor-pointer text-sm">原文差异与缺项（{sourceRanges.length} 项）</summary>
            <ul>{sourceRanges.map((range, index) => <li key={index}>
              {range.pageIndexes.length ? `第 ${range.pageIndexes.map(page => page + 1).join('、')} 页：` : ''}{range.message}
            </li>)}</ul>
          </details> : null}
        </>
      ) : null}
      <Button variant="outline" size="sm" onClick={resource.refresh}>
        刷新
      </Button>
    </section>
  );
}
