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
  // Only the saved association snapshot can bind prose to a formal Matter.
  // Fresh navigation relationships cannot retrospectively assign old prose,
  // including when the current catalogue happens to contain just one Matter.
  const boundStructure: boolean = savedStructure && catalog.structured && catalog.entries.every(entry =>
    Boolean(entry.matterId && formal?.entries.some(matter => matter.matterId === entry.matterId)));
  const legacyEntry = !catalog.structured ? catalog.entries[0] : undefined;
  const unboundBody = savedStructure ? summaryUnboundBody(revision.content) : '';
  return <section className="summary-engineering-catalog" aria-label="工程事项目录">
    {boundStructure ? <>
      <h2 className="text-lg font-semibold">工程事项</h2>
      {brief ? <div className="summary-entry-intro">{renderMarkdown(brief)}</div> : null}
      {catalog.intro ? <div className="summary-entry-intro">{renderMarkdown(catalog.intro)}</div> : null}
      <ul>{formal?.entries.map((matter: DerivedSummaryMatterCatalog['entries'][number]) => {
      const entry: SummaryEngineeringEntry | undefined = catalog.entries.find(item => item.matterId === matter.matterId);
      return <li className="summary-engineering-entry" key={matter.matterId} data-matter-id={matter.matterId}>
      <div className="summary-entry-title">{renderMarkdown(`### ${matter.title}`)}</div>
      {entry?.previews.length ? <dl className="summary-entry-progress">{entry.previews.map((preview, position: number) =>
        <div key={position}><dt>{preview.label}</dt><dd><SummaryProgressText preview={preview}
          renderMarkdown={renderMarkdown} /></dd></div>)}</dl> : null}
      {entry?.matterId && entry.title && entry.title !== matter.title ? <div aria-label="保存正文标题">
          <p className="text-sm text-muted-foreground">保存正文标题</p>
          {renderMarkdown(`#### ${entry.title}`)}
        </div> : null}
      {entry?.body ? <div className="summary-entry-body">{renderMarkdown(entry.body)}</div>
        : !entry ? <p className="text-sm text-muted-foreground">此保存版本未记录该事项正文。</p> : null}
      <details className="summary-entry-detail"><summary>事项资料与关联</summary>
        <Link className="underline" to={readingRoute(`/matters/${encodeURIComponent(matter.matterId)}`)}>打开工程事项</Link>
        <MatterBindings bindings={matter.bindings} revision={revision} readingRoute={readingRoute} />
        <MatterBindingContext bindings={matter.bindings} />
      </details>
    </li>; })}</ul>
      {unboundBody ? <section aria-label="未归属资料正文">
        <h2 className="text-lg font-semibold">未归属资料</h2>{renderMarkdown(unboundBody)}
      </section> : null}
    </> : <section className="summary-saved-reading" aria-label="本层已保存正文">
      <h2 className="text-lg font-semibold">本层已保存正文</h2>
      <p className="mb-4 text-sm text-muted-foreground">按原保存范围阅读；事项导航另列于下方。</p>
      {renderMarkdown(`### ${summaryReadingHeadline(revision.content.headline)}`)}
      {brief ? renderMarkdown(brief) : null}
      {legacyEntry?.previews.length ? <dl className="summary-entry-progress">{legacyEntry.previews.map((preview, position: number) =>
        <div key={position}><dt>{preview.label}</dt><dd><SummaryProgressText preview={preview}
          renderMarkdown={renderMarkdown} /></dd></div>)}</dl> : null}
      {renderMarkdown(legacyEntry ? legacyEntry.body : summaryReadingText(revision.content.body))}
    </section>}
    {conditions}
    {!boundStructure ? <details className="summary-entry-detail" aria-label="事项导航">
      <summary>当前事项导航{formal?.entries.length ? `（${formal.entries.length}）` : ''}</summary>
      {matterCatalog?.basis === 'CURRENT_RELATIONSHIPS'
        ? <p className="text-sm text-muted-foreground">当前登记关系；此保存正文未封存事项归属。</p> : null}
      {!formal ? <p>事项关联尚未提供。</p> : !formal.entries.length ? <p>暂无正式事项关联。</p> : null}
      <ul className="space-y-4 py-2">{formal?.entries.map(matter => <li key={matter.matterId} data-matter-id={matter.matterId}>
        <Link className="font-semibold underline" to={readingRoute(`/matters/${encodeURIComponent(matter.matterId)}`)}>{matter.title}</Link>
        <MatterBindings bindings={matter.bindings} revision={revision} readingRoute={readingRoute} />
        <MatterBindingContext bindings={matter.bindings} />
      </li>)}</ul>
      {!formal ? <ul>{revision.members.map(member => <li key={summaryMemberKey(member.member)}>
        <Link className="underline" to={readingRoute(summaryMemberRoute(member.member))}>
          {summaryReadingHeadline(member.headline)}</Link></li>)}</ul> : null}
    </details> : null}
    {formal?.unbound.length ? <details className="summary-entry-detail"><summary>未归属资料与来源</summary>
      <MatterBindings bindings={formal.unbound} revision={revision} readingRoute={readingRoute} />
    </details> : null}
  </section>;
}

function MatterBindingContext({ bindings }: { bindings: DerivedSummaryMatterCatalog['entries'][number]['bindings'] }) {
  const contexts: string[] = bindings.flatMap(binding =>
    binding.association.kind === 'MEMBER_MATERIAL' || binding.association.kind === 'REFERENCE_CONTEXT'
      ? [binding.association.material.scope, binding.association.material.contribution] : [])
    .filter((value: string, index: number, values: string[]) => Boolean(value) && values.indexOf(value) === index);
  return <>{contexts.map((value: string, index: number) => <p className="whitespace-pre-wrap" key={index}>{value}</p>)}</>;
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
