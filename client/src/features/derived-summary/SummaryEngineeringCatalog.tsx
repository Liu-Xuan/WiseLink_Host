import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DerivedSummaryMatterCatalog, DerivedSummaryMatterCatalogProjection,
  DerivedSummaryRevision } from '@shared/derived-summary.interface';
import { Button } from '@client/src/components/ui/button';
import { summaryMemberKey, summaryMemberRoute, summaryReadingHeadline, summaryReadingText } from './summary-selection';
import { summaryEntryCatalog, summaryUnboundBody, type SummaryEngineeringEntry,
  type SummaryEntryPreview } from './summary-entry-catalog';
import './summary-reading.css';

interface SummaryEngineeringCatalogProps {
  revision: DerivedSummaryRevision;
  readingRoute: (route: string) => string;
  renderMarkdown: (body: string) => ReactNode;
  conditions?: ReactNode;
  brief?: string | null;
  matterCatalog?: DerivedSummaryMatterCatalogProjection;
}

export default function SummaryEngineeringCatalog({ revision, readingRoute, renderMarkdown,
  conditions, brief, matterCatalog }: SummaryEngineeringCatalogProps) {
  const catalog = summaryEntryCatalog(revision.content);
  const formal = matterCatalog?.catalog;
  const savedStructure: boolean = matterCatalog?.basis === 'SAVED_INPUT';
  // A complete legacy report may be shown within its one formal Matter only
  // when every selected leaf is bound there. Chapter/title similarity is unused.
  const oneMatter: boolean = formal?.entries.length === 1 && formal.unbound.length === 0;
  const legacyEntry = !catalog.structured && oneMatter ? catalog.entries[0] : undefined;
  const unboundBody = savedStructure ? summaryUnboundBody(revision.content) : '';
  return <section className="summary-engineering-catalog" aria-label="工程事项目录">
    <h2 className="text-lg font-semibold">工程事项</h2>
    {savedStructure && brief ? <div className="summary-entry-intro">{renderMarkdown(brief)}</div> : null}
    {matterCatalog?.basis === 'CURRENT_RELATIONSHIPS'
      ? <p className="text-sm text-muted-foreground">按当前登记事项导航；正文保留原保存版本。</p> : null}
    {!formal ? <p>事项关联尚未提供。</p> : !formal.entries.length ? <p>暂无正式事项关联。</p> : null}
    <ul>{formal?.entries.map((matter: DerivedSummaryMatterCatalog['entries'][number]) => {
      const entry: SummaryEngineeringEntry | undefined = savedStructure
        ? catalog.entries.find(item => item.matterId === matter.matterId) : legacyEntry;
      return <li className="summary-engineering-entry" key={matter.matterId} data-matter-id={matter.matterId}>
      <div className="summary-entry-title">{renderMarkdown(`### ${matter.title}`)}</div>
      <dl className="summary-entry-progress">{entry?.previews.length ? entry.previews.map((preview, position: number) =>
        <div key={position}><dt>{preview.label}</dt><dd><SummaryProgressText preview={preview}
          renderMarkdown={renderMarkdown} /></dd></div>)
        : <div><dt>当前状态</dt><dd>—</dd></div>}</dl>
      <details className="summary-entry-detail"><summary>展开事项详情</summary>
        {entry?.matterId && entry.title && entry.title !== matter.title ? <div aria-label="保存正文标题">
          <p className="text-sm text-muted-foreground">保存正文标题</p>
          {renderMarkdown(`#### ${entry.title}`)}
        </div> : null}
        {legacyEntry ? renderMarkdown(`#### ${summaryReadingHeadline(revision.content.headline)}`) : null}
        {legacyEntry && brief ? renderMarkdown(brief) : null}
        {entry?.body ? renderMarkdown(entry.body) : null}
        {legacyEntry ? conditions : null}
        <Link className="underline" to={readingRoute(`/matters/${encodeURIComponent(matter.matterId)}`)}>打开工程事项</Link>
        <MatterBindings bindings={matter.bindings} revision={revision} readingRoute={readingRoute} />
        {matter.bindings.map(binding => binding.association.kind === 'MEMBER_MATERIAL' || binding.association.kind === 'REFERENCE_CONTEXT'
          ? [binding.association.material.scope, binding.association.material.contribution] : [])
          .flat().filter((value, index, values) => value && values.indexOf(value) === index)
          .map((value, index) => <p className="whitespace-pre-wrap" key={index}>{value}</p>)}
      </details>
    </li>; })}</ul>
    {formal?.unbound.length ? <details className="summary-entry-detail"><summary>未归属资料</summary>
      {unboundBody ? renderMarkdown(unboundBody) : null}
      <MatterBindings bindings={formal.unbound} revision={revision} readingRoute={readingRoute} />
    </details> : null}
    {!legacyEntry ? conditions : null}
    {!savedStructure && !legacyEntry ? <details className="summary-entry-detail"><summary>本层已保存正文</summary>
      {renderMarkdown(`### ${summaryReadingHeadline(revision.content.headline)}`)}
      {brief ? renderMarkdown(brief) : null}
      {renderMarkdown(summaryReadingText(revision.content.body))}
      {!formal ? <ul>{revision.members.map(member => <li key={summaryMemberKey(member.member)}>
        <Link className="underline" to={readingRoute(summaryMemberRoute(member.member))}>
          {summaryReadingHeadline(member.headline)}</Link></li>)}</ul> : null}
    </details> : null}
  </section>;
}

function MatterBindings({ bindings, revision, readingRoute }: {
  bindings: Array<Pick<DerivedSummaryMatterCatalog['entries'][number]['bindings'][number], 'memberRef' | 'leaf'> &
    Partial<Pick<DerivedSummaryMatterCatalog['entries'][number]['bindings'][number], 'association'>>>;
  revision: DerivedSummaryRevision; readingRoute: (route: string) => string;
}) {
  const unique = [...new Map(bindings.map(binding => [summaryMemberKey(binding.leaf), binding])).values()];
  return <ul className="space-y-2 py-2" aria-label="事项资料">{unique.map(binding => {
    const reading = revision.members.find(member => member.evidenceRef === binding.memberRef);
    return <li key={summaryMemberKey(binding.leaf)} data-association={binding.association?.kind}>
      {binding.association?.kind === 'REFERENCE_CONTEXT' ? <span>参考资料 · </span> : null}<Link className="underline"
      to={readingRoute(summaryMemberRoute(binding.leaf))}>{reading && reading.member.kind !== 'DERIVED_SUMMARY'
        ? summaryReadingHeadline(reading.headline) : binding.leaf.kind === 'DOCUMENT_READING' ? '文件解读'
          : binding.leaf.kind === 'WORK_ITEM_WORK' ? '评估与历史工作' : '事项工作'}</Link>
      {reading?.member.kind === 'DERIVED_SUMMARY' ? <Link className="ml-3 underline"
        to={readingRoute(summaryMemberRoute(reading.member))}>阅读下层保存版本</Link> : null}</li>;
  })}</ul>;
}

function SummaryProgressText({ preview, renderMarkdown }: {
  preview: SummaryEntryPreview; renderMarkdown: (body: string) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId: string = useId();
  return <>
    <div id={contentId} className={`summary-entry-progress-content${expanded ? '' : ' line-clamp-3'}`}
      onFocusCapture={() => setExpanded(true)}>{renderMarkdown(preview.body)}</div>
    <Button type="button" variant="ghost" size="sm" className="text-primary" aria-controls={contentId}
      aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起进展' : '展开完整进展'}</Button>
  </>;
}
