import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listDerivedSummaries } from '@client/src/api/derived-summary';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { useSummaryResource } from './useSummaryResource';

export default function DerivedSummaryListPage() {
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  return <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-8" aria-label="派生概述目录">
    <Link className="underline" to="/library">返回资料库</Link>
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">选定范围的派生概述</h1>
      <Button asChild><Link to="/summaries/new">形成概述</Link></Button></header>
    <p className="text-sm text-muted-foreground">ATA4 短概述与 ATA2 / 机型有限综合，保留确切成员、覆盖和根来源。分类与正文均为候选。</p>
    {authenticationRequired ? <p role="alert">请先登录，再读取获权概述。</p> : <SummaryDirectory key={sessionGeneration} session={sessionGeneration} />}
  </main>;
}
function SummaryDirectory({ session }: { session: number }) {
  const [params] = useSearchParams();
  const load = useCallback((signal: AbortSignal) => listDerivedSummaries(signal), []);
  const directory = useSummaryResource('summary-directory', session, load);
  const filtered = directory.data?.filter(item => (!params.get('ata4') || item.scope.ata4 === params.get('ata4'))
    && (!params.get('fleetFamilyId') || item.scope.fleetFamilyId === params.get('fleetFamilyId')));
  return <>
    {params.get('ata4') ? <p>当前查看 ATA {params.get('ata4')} 的已保存概述。<Link className="ml-3 underline" to="/summaries">查看全部概述</Link></p> : null}
    <Button variant="outline" onClick={directory.refresh}>重新核权并读取</Button>
    {directory.loading ? <p role="status">正在读取本人概述目录…</p> : null}
    {directory.error ? <p role="alert">{directory.error}</p> : null}
    {filtered && !filtered.length ? <p>本范围尚无本人派生概述。可从资料库 ATA4 节点选择确切工作。</p> : null}
    <ul className="space-y-3">{filtered?.map(item => <li className="space-y-2 rounded-md border border-border p-4" key={item.summaryId}>
      <Link className="text-lg font-semibold underline" to={`/summaries/${encodeURIComponent(item.summaryId)}${item.currentSummaryRef ? `?${new URLSearchParams({ summaryRef: item.currentSummaryRef })}` : ''}`}>{item.scope.title}</Link>
      <p>{item.scope.kind} · {item.scope.fleetFamilyId} · {item.scope.ata4 || item.scope.ata2 || '机型范围'} · 候选待核</p>
      <p>{item.currentSummaryRef ? '已有保存修订，正文与成员来源在打开时重新核权。' : '尚无保存正文'}</p>
      <p className="text-sm text-muted-foreground">当前指针修订 {item.currentRevision} · 目录只显示本人对象信息，正文仅覆盖明确选定资料</p>
    </li>)}</ul>
  </>;
}
