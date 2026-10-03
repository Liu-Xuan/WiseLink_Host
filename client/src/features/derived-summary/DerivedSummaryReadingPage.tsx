import { useCallback } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { readDerivedSummary, readDerivedSummaryRequest, readDerivedSummaryExact } from '@client/src/api/derived-summary';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { summaryMemberKey, summaryMemberRoute, upperSummaryRoute } from './summary-selection';
import { useSummaryResource } from './useSummaryResource';
import DerivedSummaryBody from './DerivedSummaryBody';
import DocumentVersionIdentityLabel from './DocumentVersionIdentityLabel';

export default function DerivedSummaryReadingPage() {
  const { summaryId = '' } = useParams();
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const [params] = useSearchParams();
  const refs = params.getAll('summaryRef');
  const attempts = params.getAll('attemptRef');
  const invalid = refs.length > 1 || attempts.length > 1 || refs.some(ref => !ref.trim()) || attempts.some(ref => !ref.trim());
  return <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-8" aria-label="派生概述阅读">
    <Link className="underline" to="/summaries">返回派生概述目录</Link>
    {authenticationRequired ? <p role="alert">请先登录，再核对概述及其保留来源。</p>
      : invalid ? <p role="alert">确切版本或请求链接无效，请从概述目录重新进入。</p>
      : <SummaryReading key={`${sessionGeneration}:${summaryId}:${refs[0] ?? ''}:${attempts[0] ?? ''}`} id={summaryId} refPin={refs[0]} attempt={attempts[0]} session={sessionGeneration} />}
  </main>;
}
function SummaryReading({ id, refPin, attempt, session }: { id: string; refPin?: string; attempt?: string; session: number }) {
  const load = useCallback(async (signal: AbortSignal) => {
    const selected = refPin
      ? readDerivedSummaryExact(id, refPin, signal).then(exact => ({ ...exact, scope: exact.revision.scope }))
      : readDerivedSummary(id, signal).then(head => ({ summaryId: head.summaryId, currentSummaryRef: head.currentSummaryRef,
        currentRevision: head.currentRevision, revision: head.current, memberNotices: head.memberNotices, scope: head.scope }));
    const [reading, status] = await Promise.all([selected,
      attempt ? readDerivedSummaryRequest(id, attempt, signal) : Promise.resolve(null)]);
    return { reading, status };
  }, [id, refPin, attempt]);
  const read = useSummaryResource(JSON.stringify([id, refPin, attempt]), session, load);
  const value = read.data;
  const revision = value?.reading.revision;
  return <>
    <Button variant="outline" onClick={read.refresh}>重新核权并读取正文 / 进度</Button>
    {read.loading ? <p role="status">正在读取概述、确切成员与保留来源…</p> : null}
    {read.error ? <p role="alert">{read.error}</p> : null}
    {value?.status ? <section aria-label="概述请求进度" className="space-y-2 border border-border p-3">
      <h2 className="font-semibold">生成进度：{value.status.status}</h2>
      {value.status.errorCode ? <p role="alert">本次执行未完成：{value.status.errorCode}。已有保存修订按自身范围阅读。</p> : null}
      <p className="text-sm">保存正文与本次执行结束分别核对。</p>
      {value.status.savedSummaryRefs.map(ref => <Link className="mr-3 underline" key={ref} to={`/summaries/${encodeURIComponent(id)}?${new URLSearchParams({ summaryRef: ref, attemptRef: value.status!.attemptRef })}`}>阅读该次确切保存版本</Link>)}
    </section> : null}
    {value && !revision ? <><h1 className="text-2xl font-semibold">{value.reading.scope.title}</h1><p>尚无已保存的概述正文。可重新读取本次进度。</p></> : null}
    {revision && value ? <article className="space-y-5" data-summary-ref={revision.summaryRef} data-summary-revision={revision.revision}>
      <header className="space-y-2"><h1 className="text-2xl font-semibold">{revision.content.headline}</h1>
        <p>{revision.scope.title} · {revision.scope.kind} · 分类候选待核 · 正文候选</p>
        <p>{revision.summaryRef === value.reading.currentSummaryRef ? '当前保存修订' : '历史保存修订'} {revision.revision} · {new Date(revision.createdAt).toLocaleString('zh-CN')}</p>
        <p className="break-all text-xs text-muted-foreground">确切 summaryRef：{revision.summaryRef}</p>
        <p className="whitespace-pre-wrap">{revision.scope.selectionReason}</p>
        {revision.producer ? <details><summary className="cursor-pointer text-sm">生成记录</summary>
          <p className="text-sm">本次捕获模型：{revision.producer.configuredModelRef} · 运行报告：{revision.producer.actualModel || '未报告实际模型'}</p>
        </details> : null}
        <div className="flex flex-wrap gap-3"><Link className="underline" to={`/summaries/${encodeURIComponent(id)}`}>按当前指针阅读</Link>
          <Link className="underline" to={`/summaries/${encodeURIComponent(id)}/update`}>明确更新成员与范围</Link>
          <Link className="underline" to={upperSummaryRoute(id, revision.summaryRef, revision.scope)}>用此确切版本形成上层有限综合</Link></div>
      </header>
      <DerivedSummaryBody key={revision.summaryRef} revision={revision} />
      <section className="space-y-2" aria-label="概述限制"><h2 className="text-lg font-semibold">限制与未覆盖范围</h2>
        <p>仅覆盖下方实际选取成员，不代表完整 ATA 或机型范围。</p>
        <ul className="list-disc space-y-1 pl-5">{revision.content.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
      </section>
      <section className="space-y-3" aria-label="确切成员与覆盖"><h2 className="text-lg font-semibold">成员、覆盖与根来源</h2>
        <p className="text-sm text-muted-foreground">子概述是派生工作；相同根来源不作为多份独立证据。</p>
        {revision.members.map(member => {
          const coverage = revision.coverage.find(item => summaryMemberKey(item.member) === summaryMemberKey(member.member));
          const notice = value.reading.memberNotices.find(item => summaryMemberKey(item.member) === summaryMemberKey(member.member));
          return <div className="space-y-2 rounded-md border border-border p-3" key={summaryMemberKey(member.member)}>
            <Link className="font-semibold underline" to={summaryMemberRoute(member.member)}>{member.headline}</Link>
            <p>{member.member.kind === 'DERIVED_SUMMARY' ? `子概述修订 ${member.member.summaryRevision}` : `工作修订 ${member.member.workRevision} · 选取问题 ${member.member.issueKeys.join('、')}`}</p>
            {member.member.kind === 'WORK_ITEM_WORK' ? <DocumentVersionIdentityLabel documentVersionId={member.member.documentVersionId} session={session} /> : null}
            <p>{notice ? notice.current ? '当前成员工作' : '历史依据或成员工作已变化' : '成员现行性未能重新核对'} · 综合{member.overviewStatus === 'CURRENT' ? '已覆盖该工作' : member.overviewStatus === 'STALE' ? '待更新' : '尚未形成'}</p>
            <p>{coverage ? `${coverage.delivered ? '已交付输入' : '未交付完整输入'} · ${coverage.used ? '正文实际使用' : '正文未使用'}` : '覆盖记录不可用，不能扩大已覆盖范围'}</p>
            {coverage?.limitation ? <p>{coverage.limitation}</p> : null}
            <ul className="list-disc pl-5">{[...member.limitations, ...(notice?.limitations ?? [])].map((item, index) => <li key={index}>{item}</li>)}</ul>
            <details><summary className="cursor-pointer">根来源与子概述叶子工作</summary>
              <ul className="space-y-1 break-all text-xs">{member.rootRefs.map(root => <li key={root}>{root}</li>)}</ul>
              <ul>{member.leaves.map(leaf => <li key={summaryMemberKey(leaf)}><Link className="underline" to={summaryMemberRoute(leaf)}>叶子工作：{leaf.kind === 'DERIVED_SUMMARY' ? leaf.summaryRef : leaf.workRef}</Link></li>)}</ul>
            </details>
          </div>;
        })}
      </section>
    </article> : null}
  </>;
}
