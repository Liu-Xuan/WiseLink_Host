import { Link } from 'react-router-dom';
import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@client/src/components/ui/card';
import { exactDocumentSourceRoute } from '@client/src/features/matter/matter-navigation';
import type { TranslationSourceAnchorV2 } from '@shared/canonical-translation-v2.interface';
import type {
  DocumentActivityDeliveryRange, DocumentActivityQuote, DocumentActivityReadCoverage,
  DocumentActivityRevision, DocumentActivityStatement,
} from '@shared/document-activity.interface';
import type { DocumentOriginalBinding } from '@shared/document-original.interface';

export type ActivityReturnParamsFor = (
  binding: DocumentOriginalBinding,
  statementId?: string | null,
  anchorId?: string | null,
) => string | null;

export interface DocumentActivityReadingViewProps {
  binding: DocumentOriginalBinding;
  familyId: string;
  candidate: DocumentActivityRevision | null;
  selectedStatementId: string | null;
  selectedAnchorId: string | null;
  returnParamsFor?: ActivityReturnParamsFor;
  onSelectStatement?: (statementId: string) => void;
  onSelectAnchor?: (anchorId: string) => void;
}

/** Strict UTF-16 code-unit slice; offsets outside the source text are rejected, never clamped. */
export function sliceSourceText(sourceText: string, start: number, end: number): string | null {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  if (start < 0 || end < start || end > sourceText.length) return null;
  return sourceText.slice(start, end);
}

const UNRESOLVED_REASON_LABEL: Record<string, string> = {
  UNREAD: '未读取', TEXT_CONFLICT: '文本冲突', STRUCTURE_UNCERTAIN: '结构不确定', FIGURE_UNINTERPRETED: '图示未解释',
};

function impactLabel(readingImpact?: 'DIAGNOSTIC' | 'LIMITATION'): string {
  return readingImpact === 'DIAGNOSTIC' ? '诊断' : readingImpact === 'LIMITATION' ? '限制' : '未分类';
}

function unresolvedScope(range: { pageIndexes: number[]; unitIds: string[] }): string {
  return [
    range.pageIndexes.length > 0
      ? `第 ${range.pageIndexes.map((pageIndex: number) => pageIndex + 1).join('、')} 页`
      : null,
    range.unitIds.length > 0 ? `单元 ${range.unitIds.join('、')}` : null,
  ].filter(Boolean).join(' · ') || '未提供定位范围';
}

function sourceRefRoute(binding: DocumentOriginalBinding, sourceRefId: string): string | null {
  return exactDocumentSourceRoute({ documentVersionId: binding.documentVersionId, sourceRefId,
    locator: JSON.stringify({ parseRunId: binding.parseRunId, sourceRefId }) });
}

function SourceRefLinks({ sourceRefIds, binding, returnParamsFor }: {
  sourceRefIds: string[]; binding: DocumentOriginalBinding; returnParamsFor?: (binding: DocumentOriginalBinding) => string | null;
}) {
  if (sourceRefIds.length === 0) return <span className="text-xs text-muted-foreground">无来源标识</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {sourceRefIds.map((sourceRefId: string) => {
        const route = sourceRefRoute(binding, sourceRefId);
        const returnParams = returnParamsFor?.(binding) ?? null;
        const to = route && returnParams ? `${route}&${returnParams}` : route;
        if (!to) return <span key={sourceRefId} className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
          title="该来源无法构造精确定位链接，仅展示来源标识">来源 {sourceRefId}</span>;
        return <Link key={sourceRefId} to={to}
          className="rounded border border-border px-1.5 py-0.5 text-xs text-primary hover:bg-muted">原文 {sourceRefId}</Link>;
      })}
    </span>
  );
}

function AnchorBlock({ anchor, binding, statementId, returnParamsFor, highlighted, onSelectAnchor }: {
  anchor: TranslationSourceAnchorV2; binding: DocumentOriginalBinding; statementId: string | null; returnParamsFor?: ActivityReturnParamsFor;
  highlighted: boolean; onSelectAnchor?: (anchorId: string) => void;
}) {
  return (
    <details open={highlighted} className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        锚点 {anchor.anchorId}
        {onSelectAnchor ? <button type="button" className="ml-2 text-primary hover:underline"
          onClick={(event) => { event.preventDefault(); onSelectAnchor(anchor.anchorId); }}>固定此锚点</button> : null}
      </summary>
      <p className="mt-2 whitespace-pre-wrap text-sm" data-testid="anchor-source-text">{anchor.sourceText}</p>
      <p className="mt-1 text-xs text-muted-foreground">单元 {anchor.sourceUnitId} · 载荷路径 {anchor.payloadPath}</p>
      <div className="mt-1">
        <SourceRefLinks sourceRefIds={anchor.sourceRefIds} binding={binding}
          returnParamsFor={returnParamsFor ? (bound: DocumentOriginalBinding) => returnParamsFor(bound, statementId, anchor.anchorId) : undefined} />
      </div>
      {anchor.sourceLocators.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {anchor.sourceLocators.map((locator, index: number) => <li key={`${locator.sourceRefId}-${index}`}>
              定位 {locator.kind} · 来源 {locator.sourceRefId}
              {`${locator.pageStart !== null
                ? ` · 第 ${locator.pageStart + 1}${locator.pageEnd !== null && locator.pageEnd !== locator.pageStart ? `–${locator.pageEnd + 1}` : ''} 页` : ''}${locator.normalizedPath ? ` · ${locator.normalizedPath}` : ''}`}
          </li>)}
        </ul>
      ) : null}
    </details>
  );
}

function QuoteBlock({ quote, candidate }: { quote: DocumentActivityQuote; candidate: DocumentActivityRevision }) {
  const anchor = candidate.sourceAnchors.find((item: TranslationSourceAnchorV2) => item.anchorId === quote.anchorId) ?? null;
  const sliced = anchor ? sliceSourceText(anchor.sourceText, quote.start, quote.end) : null;
  return (
    <li className="text-sm">
      {anchor === null ? <span className="text-xs text-muted-foreground">无法定位引用锚点 {quote.anchorId}，不会改用其他锚点。</span>
        : sliced !== null ? <span className="whitespace-pre-wrap">{sliced}</span> : (
          <>
            <span className="whitespace-pre-wrap">{quote.text}</span>
            <span className="ml-1 text-xs text-muted-foreground">（引用区间超出锚点原文范围，显示已保存引文）</span>
          </>
        )}
      <span className="ml-1 text-xs text-muted-foreground">（{quote.anchorId} · {quote.start}–{quote.end}）</span>
    </li>
  );
}

function StatementCard({ statement, candidate, binding, selected, returnParamsFor, selectedAnchorId, onSelectStatement, onSelectAnchor }: {
  statement: DocumentActivityStatement; candidate: DocumentActivityRevision; binding: DocumentOriginalBinding; selected: boolean;
  returnParamsFor?: ActivityReturnParamsFor; selectedAnchorId: string | null; onSelectStatement?: (statementId: string) => void;
  onSelectAnchor?: (anchorId: string) => void;
}) {
  const quotedAnchorIds = statement.quotes.map((quote: DocumentActivityQuote) => quote.anchorId);
  const anchors = candidate.sourceAnchors.filter((anchor: TranslationSourceAnchorV2) => quotedAnchorIds.includes(anchor.anchorId));
  return (
    <Card data-testid={`statement-${statement.statementId}`}>
      <CardHeader>
        <CardTitle className="text-base">
          {statement.label}
        {onSelectStatement ? <button type="button" className="ml-2 align-middle text-xs font-normal text-primary hover:underline"
            onClick={() => onSelectStatement(statement.statementId)}>固定此声明</button> : null}
          {selected ? <Badge variant="secondary" className="ml-2 align-middle">当前选择</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-xs text-muted-foreground">声明标识 {statement.statementId}</p>
        {statement.time ? (
          <p>
            <span className="whitespace-pre-wrap">{statement.time.raw}</span>
            <Badge variant="outline" className="ml-2">{statement.time.role}</Badge>
            <Badge variant="outline" className="ml-1">精度 {statement.time.precision} · 表述 {statement.time.expression}</Badge>
          </p>
        ) : <p className="text-muted-foreground">时间未提取</p>}
        <p className="text-xs text-muted-foreground">状态原词：{statement.statusRaw ?? '（无状态原词）'}</p>
        {statement.quotes.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5">
            {statement.quotes.map((quote: DocumentActivityQuote, index: number) => <QuoteBlock key={`${quote.anchorId}-${index}`} quote={quote} candidate={candidate} />)}
          </ul>
        ) : <p className="text-xs text-muted-foreground">无引用。</p>}
        {statement.limitations.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {statement.limitations.map((limitation: string) => <li key={limitation}>限制：{limitation}</li>)}
          </ul>
        ) : null}
        <div className="space-y-2">
          {anchors.map((anchor: TranslationSourceAnchorV2) => (
            <AnchorBlock key={anchor.anchorId} anchor={anchor} binding={binding} statementId={statement.statementId}
              returnParamsFor={returnParamsFor} highlighted={selectedAnchorId === anchor.anchorId} onSelectAnchor={onSelectAnchor} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Every saved source anchor gets its own block (including anchors no statement quotes); a
 * candidate-level anchor never fabricates a statement. Host order kept; duplicated ids render once. */
function SourceAnchorSection({ candidate, binding, returnParamsFor, selectedAnchorId, onSelectAnchor }: {
  candidate: DocumentActivityRevision; binding: DocumentOriginalBinding; returnParamsFor?: ActivityReturnParamsFor;
  selectedAnchorId: string | null; onSelectAnchor?: (anchorId: string) => void;
}) {
  const anchors = candidate.sourceAnchors.filter(
    (anchor, index: number) => candidate.sourceAnchors.findIndex(
      (other: TranslationSourceAnchorV2) => other.anchorId === anchor.anchorId) === index);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">原文来源锚点</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          候选保存的全部来源锚点（含未被任何声明引用的锚点）；按 Host 返回顺序展示，重复标识只展示一次，不会为候选级锚点虚构声明。
        </p>
        {anchors.length === 0 ? <p className="text-sm text-muted-foreground">已保存的候选不包含任何来源锚点。</p>
          : anchors.map((anchor: TranslationSourceAnchorV2) => (
            <AnchorBlock key={anchor.anchorId} anchor={anchor} binding={binding} statementId={null} returnParamsFor={returnParamsFor}
              highlighted={selectedAnchorId === anchor.anchorId} onSelectAnchor={onSelectAnchor} />
          ))}
      </CardContent>
    </Card>
  );
}

function CoverageDetails({ coverage }: { coverage: DocumentActivityReadCoverage }) {
  const source = coverage.sourceCoverage;
  return (
    <details className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        范围明细（已送达 {coverage.deliveredRanges.length} 段 · 待核范围 {source.unresolvedRanges.length} 段）
      </summary>
      <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        {coverage.deliveredRanges.map((range: DocumentActivityDeliveryRange, index: number) => (
          <li key={`delivered-${range.sectionId}-${index}`}>
            已送达 · 章节 {range.sectionId} · 偏移 {range.offset} · 单元 {range.unitIds.join('、') || '（无）'} · 锚点 {range.anchorIds.join('、') || '（无）'} · 续读偏移 {range.nextOffset === null ? '（无）' : String(range.nextOffset)}
          </li>
        ))}
        {source.unresolvedRanges.map((range, index: number) => <li key={`unresolved-${range.reason}-${index}`}>
          覆盖记录 · {unresolvedScope(range)} · {UNRESOLVED_REASON_LABEL[range.reason] ?? range.reason} · {range.message} · {impactLabel(range.readingImpact)}
        </li>)}
      </ul>
    </details>
  );
}

function CoverageBlock({ coverage }: { coverage: DocumentActivityReadCoverage }) {
  const source = coverage.sourceCoverage;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">读取覆盖（仅按已送达范围）</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-xs text-muted-foreground">
          选择章节：{coverage.selection.sectionIds.length > 0 ? coverage.selection.sectionIds.join('、') : '（无章节）'} · 已送达范围 {coverage.deliveredRanges.length} 段：{coverage.deliveredRanges.map((range) => range.sectionId).join('、') || '（无）'}
        </p>
        <p className="text-xs text-muted-foreground">
          原件页数：{source.knownPageCount === null ? '未知' : String(source.knownPageCount)}；已读取第{' '}
          {source.readPageIndexes.length > 0 ? source.readPageIndexes.map((pageIndex: number) => pageIndex + 1).join('、') : '（无）'} 页。
        </p>
        {source.unresolvedRanges.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {source.unresolvedRanges.map((range, index: number) => <li key={`${range.reason}-${index}`}>
              {unresolvedScope(range)}：{UNRESOLVED_REASON_LABEL[range.reason] ?? range.reason} · {range.message} · {impactLabel(range.readingImpact)}
            </li>)}
          </ul>
        ) : null}
        <CoverageDetails coverage={coverage} />
        <p className="text-xs text-muted-foreground">
          覆盖按已送达范围展示；不宣称已读取全文，也不以未读取范围推导活动。
        </p>
      </CardContent>
    </Card>
  );
}

export default function DocumentActivityReadingView({ binding, familyId, candidate, selectedStatementId, selectedAnchorId, returnParamsFor, onSelectStatement, onSelectAnchor }: DocumentActivityReadingViewProps) {
  const selectedStatement = candidate && selectedStatementId ? candidate.statements.find(
    (statement: DocumentActivityStatement) => statement.statementId === selectedStatementId) ?? null : null;
  const selectedAnchor = candidate && selectedAnchorId ? candidate.sourceAnchors.find(
    (anchor: TranslationSourceAnchorV2) => anchor.anchorId === selectedAnchorId) ?? null : null;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">已保存活动候选（只读）</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            family {familyId} · 解析版本绑定 {binding.parseRunId}
            {candidate ? <> · 候选改版 {candidate.candidateRevision} · 运行标识 {candidate.runRef} · 产生者 {candidate.producer.skillVersion} / {candidate.producer.modelVersion} · 保存时间 {candidate.savedAt}（保存时间不是活动时间）</> : null}
          </p>
          <p className="text-xs text-muted-foreground">候选仅表示模型对原文引用的解读，不代表已验证的执行或采用；声明顺序按 Host 返回顺序展示，不按保存时间虚构活动时间。</p>
        </CardContent>
      </Card>
      {candidate === null ? (
        <Card>
          <CardHeader><CardTitle className="text-base">未保存候选</CardTitle></CardHeader>
          <CardContent>
            <p role="status" className="text-sm text-muted-foreground">
              该来源与解析版本没有已保存的活动候选。这不表示该文档没有活动，仅表示当前没有可读取的已保存结果。
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {selectedStatementId && !selectedStatement ? <p role="status" className="text-sm text-muted-foreground">
            无法定位声明 {selectedStatementId}，不会默认选择其他声明。</p> : null}
          {selectedAnchorId && !selectedAnchor ? <p role="status" className="text-sm text-muted-foreground">
            无法定位锚点 {selectedAnchorId}，不会默认选择其他锚点。</p> : null}
          {candidate.statements.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p role="status" className="text-sm text-muted-foreground">已保存的候选不包含任何声明；覆盖与锚点仍按下文保留展示。</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {candidate.statements.map((statement: DocumentActivityStatement) => (
                <StatementCard key={statement.statementId} statement={statement} candidate={candidate} binding={binding}
                  selected={selectedStatementId === statement.statementId} returnParamsFor={returnParamsFor}
                  selectedAnchorId={selectedAnchorId} onSelectStatement={onSelectStatement} onSelectAnchor={onSelectAnchor} />
              ))}
            </div>
          )}
          <SourceAnchorSection candidate={candidate} binding={binding} returnParamsFor={returnParamsFor}
            selectedAnchorId={selectedAnchorId} onSelectAnchor={onSelectAnchor} />
          <CoverageBlock coverage={candidate.readCoverage} />
        </>
      )}
    </div>
  );
}
