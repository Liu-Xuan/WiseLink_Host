import { Link } from 'react-router-dom';
import type { DerivedSummaryRevision } from '@shared/derived-summary.interface';
import type { SummaryReadingCondition } from './summary-reading-presentation';
import { summaryMemberKey, summaryMemberRoute, summaryMemberVersionLabel, summaryReadingHeadline } from './summary-selection';

interface ReadingPresentationProps { readingRoute: (route: string) => string }

export function SummaryReadingNavigation({ revision, parentSummaryId, readingRoute }: ReadingPresentationProps & {
  revision: DerivedSummaryRevision; parentSummaryId?: string | null;
}) {
  const children = revision.members.filter(member => member.member.kind === 'DERIVED_SUMMARY');
  return <nav aria-label="Wiki上下层导航" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border px-3 py-2 text-sm">
    <Link className="underline" to="/summaries">目录</Link>
    {parentSummaryId ? <Link className="underline" to={readingRoute(`/summaries/${encodeURIComponent(parentSummaryId)}`)}>阅读上层 Wiki</Link> : null}
    <span aria-current="page">本层 · {revision.scope.kind === 'FLEET' ? '机型' : revision.scope.ata4 ?? revision.scope.ata2}</span>
    {children.length ? <details className="min-w-0 max-w-full"><summary className="cursor-pointer">下层资料（{children.length}）</summary>
      <ul className="space-y-2 py-2">{children.map(member => <li key={summaryMemberKey(member.member)}>
        <Link className="break-words underline" to={readingRoute(summaryMemberRoute(member.member))}>{summaryReadingHeadline(member.headline)} · {summaryMemberVersionLabel(member.member)}</Link>
      </li>)}</ul>
    </details> : null}
  </nav>;
}

export function SummaryReadingConditions({ conditions, readingRoute }: ReadingPresentationProps & {
  conditions: SummaryReadingCondition[];
}) {
  return conditions.length ? <section className="space-y-2" aria-label="概述限制">
    <h2 className="text-lg font-semibold">工程条件与待核事项</h2>
    <ul className="list-disc space-y-3 pl-5">{conditions.map((condition: SummaryReadingCondition, index: number) => <li key={index}>
      <p>{condition.text}</p>
      {condition.inheritedFrom.length ? <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">同文出处（{condition.inheritedFrom.length}份已保存成员）</summary>
        <ul>{condition.inheritedFrom.map(member => <li key={summaryMemberKey(member.member)}><Link className="break-words underline"
          to={readingRoute(summaryMemberRoute(member.member))}>{summaryReadingHeadline(member.headline)} · {summaryMemberVersionLabel(member.member)}</Link></li>)}</ul>
      </details> : null}
    </li>)}</ul>
  </section> : null;
}
