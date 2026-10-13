import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listDerivedSummaries } from '@client/src/api/derived-summary';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { useSummaryResource } from './useSummaryResource';
import HierarchicalWikiDirectory from './HierarchicalWikiDirectory';

export default function DerivedSummaryListPage() {
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  return <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-8" aria-label="分层 Wiki 与资料综合目录">
    <Link className="underline" to="/library">返回资料库</Link>
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">分层 Wiki 与资料综合</h1>
      <Button asChild><Link to="/summaries/new">创建资料综合</Link></Button></header>
    {authenticationRequired ? <p role="alert">请先登录。</p> : <SummaryDirectory key={sessionGeneration} session={sessionGeneration} />}
  </main>;
}
function SummaryDirectory({ session }: { session: number }) {
  const [params] = useSearchParams();
  const load = useCallback((signal: AbortSignal) => listDerivedSummaries(signal), []);
  const directory = useSummaryResource('summary-directory', session, load);
  const filtered = directory.data?.filter(item => !item.automaticWiki && (!params.get('ata4') || item.scope.ata4 === params.get('ata4'))
    && (!params.get('fleetFamilyId') || item.scope.fleetFamilyId === params.get('fleetFamilyId')));
  return <>
    <HierarchicalWikiDirectory key={session} session={session} />
    <h2 className="text-xl font-semibold">资料综合</h2>
    {params.get('ata4') ? <p>ATA {params.get('ata4')}<Link className="ml-3 underline" to="/summaries">查看全部资料综合</Link></p> : null}
    <Button variant="outline" onClick={directory.refresh}>刷新</Button>
    {directory.loading ? <p role="status">正在读取资料综合…</p> : null}
    {directory.error ? <p role="alert">{directory.error}</p> : null}
    {filtered && !filtered.length ? <p>本范围尚无资料综合。</p> : null}
    <ul className="space-y-3">{filtered?.map(item => <li className="space-y-2 rounded-md border border-border p-4" key={item.summaryId}>
      <Link className="text-lg font-semibold underline" to={`/summaries/${encodeURIComponent(item.summaryId)}${item.currentSummaryRef ? `?${new URLSearchParams({ summaryRef: item.currentSummaryRef })}` : ''}`}>{item.scope.title}</Link>
      <p>{item.scope.fleetFamilyId} · {item.scope.ata4 || item.scope.ata2 ? `ATA ${item.scope.ata4 || item.scope.ata2}` : '机型范围'}</p>
      <p className="text-sm text-muted-foreground">{item.currentSummaryRef ? `保存修订 ${item.currentRevision}` : '尚无保存正文'}</p>
      <details><summary className="cursor-pointer text-sm">选定范围</summary><p className="whitespace-pre-wrap text-sm">{item.scope.selectionReason}</p></details>
    </li>)}</ul>
  </>;
}
