import { useCallback } from 'react';
import type { DerivedSummaryContextStatus } from '@shared/derived-summary.interface';
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
        currentRevision: head.currentRevision, revision: head.current, memberNotices: head.memberNotices, contextStatus: head.contextStatus, scope: head.scope }));
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
      {value.status.savedSummaryRefs.map(ref => <Link className="mr-3 underline" key={ref} to={`/summaries/${encodeURIComponent(id)}?${new URLSearchParams({ summaryRef: ref, attemptRef: value.status!.attemptRef })}`}>阅读该次确切保存版本</Link>)}
    </section> : null}
    {value && !revision ? <><h1 className="text-2xl font-semibold">{value.reading.scope.title}</h1><p>尚无已保存的概述正文。可重新读取本次进度。</p>
      {value.status && ['FAILED', 'CANCELLED', 'CONFLICT'].includes(value.status.status)
        ? <Link className="underline" to={`/summaries/${encodeURIComponent(id)}/update`}>明确重新选取范围与成员，发起新请求</Link> : null}
    </> : null}
    {revision && value ? <article className="space-y-5" data-summary-ref={revision.summaryRef} data-summary-revision={revision.revision}>
      <SummaryContextStatus status={value.reading.contextStatus} />
      <header className="space-y-2"><h1 className="text-2xl font-semibold">{revision.content.headline}</h1>
        <p>{revision.scope.title} · {revision.scope.kind}</p>
        <details><summary>保存记录</summary>
          <p>{revision.summaryRef === value.reading.currentSummaryRef ? '当前保存修订' : '历史保存修订'} {revision.revision} · {new Date(revision.createdAt).toLocaleString('zh-CN')}</p>
          <p className="break-all text-xs text-muted-foreground">{revision.summaryRef}</p>
        </details>
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
        <ul className="list-disc space-y-1 pl-5">{revision.content.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
      </section>
      <section className="space-y-3" aria-label="确切成员与覆盖"><h2 className="text-lg font-semibold">成员、覆盖与根来源</h2>
        <p className="text-sm text-muted-foreground">相同根来源合并展示。</p>
        {revision.members.map(member => {
          const coverage = revision.coverage.find(item => summaryMemberKey(item.member) === summaryMemberKey(member.member));
          const notice = value.reading.memberNotices.find(item => summaryMemberKey(item.member) === summaryMemberKey(member.member));
          const coverageLimitation = coverage?.limitation === '成员已交付，但正文未直接引用；不能宣称已对该成员完成综合。'
            ? '正文未直接引用该成员工作。' : coverage?.limitation;
          return <div className="space-y-2 rounded-md border border-border p-3" key={summaryMemberKey(member.member)}>
            <Link className="font-semibold underline" to={summaryMemberRoute(member.member)}>{member.headline}</Link>
            <p>{member.member.kind === 'DERIVED_SUMMARY' ? `子概述修订 ${member.member.summaryRevision}` : `工作修订 ${member.member.workRevision} · 选取问题 ${member.member.issueKeys.join('、')}`}</p>
            {member.member.kind === 'WORK_ITEM_WORK' ? <DocumentVersionIdentityLabel documentVersionId={member.member.documentVersionId} session={session} /> : null}
            <p>{notice ? notice.current ? '当前成员工作' : '历史依据或成员工作已变化' : '成员现行性未能重新核对'} · 综合{member.overviewStatus === 'CURRENT' ? '已覆盖该工作' : member.overviewStatus === 'STALE' ? '待更新' : '尚未形成'}</p>
            <p>{coverage ? `${coverage.delivered ? 'Host已读取成员工作' : 'Host未读取成员工作'} · ${coverage.used ? '正文直接引用成员工作' : '正文未直接引用成员工作'}` : '覆盖记录不可用，不能扩大已覆盖范围'}</p>
            {coverageLimitation ? <p>{coverageLimitation}</p> : null}
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


const contextReasonLabels: Record<string, string> = {
  NO_SAVED_CONTEXT_BASIS: '此保存版本未记录上下文依据。',
  CHANGED_MEMBERNOTICES: '选取成员的状态或限制已变化。',
  CHANGED_SOURCES: '本地来源目录、解析或语义登记已变化。',
  CHANGED_WORKITEMS: '相关工作或结果状态已变化。',
  CHANGED_MATTERS: '事务工作、成员或更正记录已变化。',
  CHANGED_SUMMARIES: '子概述的保存指针已变化。',
  SELECTED_HISTORY_OR_INCOMPLETE_COVERAGE: '选取含历史依据或尚未完整覆盖的工作。',
  CORRECTION_REVIEW_PENDING: '存在待核对的更正或复核请求。',
  DOCUMENT_LIFECYCLE_NOT_FENCED: '文档生命周期变化尚未纳入此核对。',
  NATIVE_CURRENTNESS_NOT_CONNECTED: '原生来源现行性尚未接入此核对。',
  PUBLISHER_CURRENTNESS_UNKNOWN: '发布方现行有效状态未核。',
};
function SummaryContextStatus({ status }: { status?: DerivedSummaryContextStatus }) {
  const state = status?.state ?? 'LEGACY_UNCHECKED';
  const label = state === 'UNCHANGED_HOST_CONTEXT' ? '已记录的 Host 上下文未变化'
    : state === 'RECHECK_REQUIRED' ? '保存依据上下文需要重新核对' : '此保存版本的上下文依据尚未核对';
  return <section aria-label="保存依据上下文" className="space-y-2 border border-border p-3">
    <h2 className="font-semibold" role={state === 'RECHECK_REQUIRED' ? 'alert' : undefined}>{label}</h2>
    <p>来源为本地目录选取；发布方现行有效状态未核（UNKNOWN）。仅覆盖实际选取成员。</p>
    <p>保存指针与上下文核对分别判断；已有正文保留其确切版本。</p>
    <ul className="list-disc pl-5">{(status?.reasons ?? ['NO_SAVED_CONTEXT_BASIS']).map((reason, index) =>
      <li key={`${reason}:${index}`}>{contextReasonLabels[reason] ?? '另有尚未闭合的上下文限制，需重新核对。'}</li>)}</ul>
  </section>;
}
