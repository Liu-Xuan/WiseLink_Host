import { useCallback } from 'react';
import type { DerivedSummaryContextStatus } from '@shared/derived-summary.interface';
import { deduplicateSummaryNotices, summaryEngineeringProcessingRecords } from '@shared/derived-summary-engineering-content';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { readDerivedSummary, readDerivedSummaryRequest, readDerivedSummaryExact } from '@client/src/api/derived-summary';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { summaryMemberKey, summaryMemberVersionLabel, summaryMemberSavedRef, summaryMemberRoute, upperSummaryRoute, summaryReadingLimitations, summaryReadingRoute, summaryReadingHeadline, summaryReadingText } from './summary-selection';
import { useAuthorizedSummaryResource } from './useAuthorizedSummaryResource';
import DerivedSummaryBody from './DerivedSummaryBody';
import DocumentVersionIdentityLabel from './DocumentVersionIdentityLabel';
import { readingReturnTarget } from '@client/src/features/matter/reading-return';
import { summaryAdditionalMemberConditions, summaryReadingConditions, summaryWikiReadingConditions } from './summary-reading-presentation';
import { SummaryReadingConditions, SummaryReadingNavigation } from './SummaryReadingPresentation';

export default function DerivedSummaryReadingPage() {
  const { summaryId = '' } = useParams();
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const [params] = useSearchParams();
  const readingReturn = readingReturnTarget(params, undefined, null, undefined, undefined, `/summaries/${encodeURIComponent(summaryId)}`);
  const refs = params.getAll('summaryRef');
  const attempts = params.getAll('attemptRef');
  const invalid = refs.length > 1 || attempts.length > 1 || refs.some(ref => !ref.trim()) || attempts.some(ref => !ref.trim());
  return <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-8" aria-label="资料综合阅读">
    {readingReturn ? <Link className="underline" to={readingReturn.route}>{readingReturn.label}</Link>
      : <Link className="underline" to="/summaries">返回资料综合目录</Link>}
    {authenticationRequired ? <p role="alert">请先登录。</p>
      : invalid ? <p role="alert">版本或请求链接无效，请从目录重新进入。</p>
      : <SummaryReading key={`${sessionGeneration}:${summaryId}:${refs[0] ?? ''}:${attempts[0] ?? ''}`} id={summaryId} refPin={refs[0]} attempt={attempts[0]} session={sessionGeneration} />}
  </main>;
}
function SummaryReading({ id, refPin, attempt, session }: { id: string; refPin?: string; attempt?: string; session: number }) {
  const [params] = useSearchParams();
  const readingRoute = (route: string) => summaryReadingRoute(route, params);
  const load = useCallback(async (signal: AbortSignal) => {
    const selected = refPin
      ? readDerivedSummaryExact(id, refPin, signal).then(exact => ({ ...exact, scope: exact.revision.scope }))
      : readDerivedSummary(id, signal).then(head => ({ summaryId: head.summaryId, currentSummaryRef: head.currentSummaryRef,
        currentRevision: head.currentRevision, revision: head.current, memberNotices: head.memberNotices, contextStatus: head.contextStatus,
        scope: head.scope, currentBodyStatus: head.currentBodyStatus, automaticWiki: head.automaticWiki,
        matterCatalog: head.matterCatalog, parentSummaryId: head.parentSummaryId }));
    const [reading, status] = await Promise.all([selected,
      attempt ? readDerivedSummaryRequest(id, attempt, signal) : Promise.resolve(null)]);
    return { reading, status };
  }, [id, refPin, attempt]);
  const read = useAuthorizedSummaryResource(JSON.stringify([id, refPin, attempt]), session, load,
    { pollIntervalMs: refPin ? undefined : 15_000 });
  const value = read.data;
  const revision = value?.reading.revision;
  const automatic = value?.reading.automaticWiki;
  const displayedRevision = revision ? { ...revision,
    content: { ...revision.content, body: summaryReadingText(revision.content.body),
      listBrief: summaryReadingText(revision.content.listBrief) },
    members: revision.members.map(member => ({ ...member,
      headline: summaryReadingHeadline(member.headline), body: summaryReadingText(member.body) })),
  } : undefined;
  const conditionGroups = revision && automatic ? summaryWikiReadingConditions(revision) : null;
  const conditions = conditionGroups?.engineering ?? (revision ? summaryReadingConditions(revision) : []);
  const recordedConditions = conditionGroups?.records ?? [];
  const processingRecords = revision && automatic ? deduplicateSummaryNotices([
    ...summaryEngineeringProcessingRecords(revision.content.body),
    ...summaryEngineeringProcessingRecords(revision.content.listBrief),
  ]) : [];
  return <>
    <Button variant="outline" onClick={read.refresh}>刷新</Button>
    {read.loading ? <p role="status">正在读取资料综合…</p> : null}
    {read.error ? <p role="alert">{read.error}{read.retainedAfterError && revision ? ' 保留已读保存修订。' : ''}</p> : null}
    {value?.status ? <section aria-label="概述请求进度" className="space-y-2 border border-border p-3">
      <h2 className="font-semibold">生成进度：{value.status.status}</h2>
      {value.status.errorCode ? <p role="alert">本次执行未完成：{value.status.errorCode}。</p> : null}
      {value.status.savedSummaryRefs.map(ref => <Link className="mr-3 underline" key={ref} to={readingRoute(`/summaries/${encodeURIComponent(id)}?${new URLSearchParams({ summaryRef: ref, attemptRef: value.status!.attemptRef })}`)}>阅读该次确切保存版本</Link>)}
    </section> : null}
    {value && !revision ? <><h1 className="text-2xl font-semibold">{value.reading.scope.title}</h1><p>{'currentBodyStatus' in value.reading && value.reading.currentBodyStatus === 'UPDATING_SCOPE'
      ? '资料范围正在更新。' : '尚无已保存正文。'}</p>
      {value.reading.currentSummaryRef ? <Link className="underline" to={readingRoute(`/summaries/${encodeURIComponent(id)}?${new URLSearchParams({ summaryRef: value.reading.currentSummaryRef })}`)}>阅读已保存版本</Link> : null}
      {!automatic && value.status && ['FAILED', 'CANCELLED', 'CONFLICT'].includes(value.status.status)
        ? <Link className="underline" to={`/summaries/${encodeURIComponent(id)}/update`}>明确重新选取范围与成员，发起新请求</Link> : null}
    </> : null}
    {revision && value && displayedRevision ? <article className="space-y-5" data-summary-ref={revision.summaryRef} data-summary-revision={revision.revision}>
      <header className="space-y-2"><h1 className="text-2xl font-semibold">{automatic
        ? revision.scope.title : summaryReadingHeadline(revision.content.headline)}</h1>
        {!automatic ? <p>{revision.scope.title}</p> : null}
        <SummaryReadingNavigation revision={revision} parentSummaryId={value.reading.parentSummaryId} readingRoute={readingRoute} />
      </header>
      {value.reading.contextStatus?.state === 'RECHECK_REQUIRED' ? <SummaryContextStatus status={value.reading.contextStatus} /> : null}
      <DerivedSummaryBody key={revision.summaryRef} revision={displayedRevision} wikiCatalog={automatic}
        matterCatalog={value.reading.matterCatalog} processingRecords={processingRecords}
        conditions={automatic ? <SummaryReadingConditions conditions={conditions} records={recordedConditions} readingRoute={readingRoute} /> : undefined} />
      {!automatic ? <SummaryReadingConditions conditions={conditions} readingRoute={readingRoute} /> : null}
      <details className="space-y-3 rounded-md border border-border p-3" aria-label="阅读依据与记录">
        <summary className="cursor-pointer font-semibold">依据、版本与生成记录</summary>
        {value.reading.contextStatus?.state !== 'RECHECK_REQUIRED' ? <SummaryContextStatus status={value.reading.contextStatus} /> : null}
        <details><summary>保存记录</summary>
          <p>{read.retainedAfterError ? '上次读回的保存修订'
            : revision.summaryRef === value.reading.currentSummaryRef ? '当前保存修订' : '历史保存修订'} {revision.revision} · {new Date(revision.createdAt).toLocaleString('zh-CN')}</p>
          <p className="break-all text-xs text-muted-foreground">{revision.summaryRef}</p>
        </details>
        {value.reading.matterCatalog ? <details><summary>事项关联记录</summary>
          <p>{value.reading.matterCatalog.basis === 'SAVED_INPUT' ? '本次生成时封存的事项关联。'
            : '当前登记关系；此历史正文未封存事项关联。'}</p>
          <ul>{value.reading.matterCatalog.catalog.entries.map(entry => <li className="break-all" key={entry.matterId}>
            {entry.title} · {entry.matterId} · {entry.matterRevisionId}
          </li>)}</ul>
        </details> : null}
        <details><summary className="cursor-pointer text-sm">选定范围</summary><p className="whitespace-pre-wrap">{revision.scope.selectionReason}</p></details>
        {revision.producer ? <details><summary className="cursor-pointer text-sm">生成记录</summary>
          <p className="text-sm">本次捕获模型：{revision.producer.configuredModelRef} · 运行报告：{revision.producer.actualModel || '未报告实际模型'}</p>
        </details> : null}
        <details><summary className="cursor-pointer text-sm">版本与更新</summary><div className="flex flex-wrap gap-3 py-2"><Link className="underline" to={readingRoute(`/summaries/${encodeURIComponent(id)}`)}>阅读当前版本</Link>
          {automatic ? <Link className="underline" to="/summaries">查看分层更新状态、调整归属</Link> : <>
            <Link className="underline" to={`/summaries/${encodeURIComponent(id)}/update`}>更新选定资料</Link>
            <Link className="underline" to={upperSummaryRoute(id, revision.summaryRef, revision.scope)}>用此版本形成上层资料综合</Link></>}
          </div></details>
      </details>
      <details className="space-y-3 rounded-md border border-border p-3" aria-label="确切成员与覆盖">
        <summary className="cursor-pointer font-semibold">选定资料与来源</summary>
        {revision.members.map(member => {
          const coverage = revision.coverage.find(item => summaryMemberKey(item.member) === summaryMemberKey(member.member));
          const notice = value.reading.memberNotices.find(item => summaryMemberKey(item.member) === summaryMemberKey(member.member));
          const coverageLimitation = coverage?.limitation === '成员已交付，但正文未直接引用；不能宣称已对该成员完成综合。'
            ? '正文未直接引用该成员工作。' : coverage?.limitation;
          const savedConditions = summaryReadingLimitations(member.limitations);
          const additionalSavedConditions = summaryAdditionalMemberConditions(member, [...conditions, ...recordedConditions]);
          const memberLimitations = summaryReadingLimitations([...(coverageLimitation?.split(/\r?\n/u) ?? []),
            ...additionalSavedConditions, ...(notice?.limitations ?? [])]);
          return <div className="space-y-2 rounded-md border border-border p-3" key={summaryMemberKey(member.member)}>
            <Link className="font-semibold underline" to={readingRoute(summaryMemberRoute(member.member))}>{summaryReadingHeadline(member.headline)}</Link>
            <p>{summaryMemberVersionLabel(member.member)}</p>
            {member.member.kind === 'WORK_ITEM_WORK' ? <DocumentVersionIdentityLabel documentVersionId={member.member.documentVersionId} session={session} /> : null}
            <details><summary className="cursor-pointer">覆盖与来源</summary>
              <p>{notice ? notice.current ? '当前成员工作' : '历史依据或成员工作已变化' : '成员现行性未能重新核对'} · 综合{member.overviewStatus === 'CURRENT' ? '已覆盖该工作' : member.overviewStatus === 'STALE' ? '待更新' : '尚未形成'}</p>
              <p>{coverage ? `${coverage.delivered ? 'Host已读取成员工作' : 'Host未读取成员工作'} · ${coverage.used ? '正文直接引用成员工作' : '正文未直接引用成员工作'}` : '覆盖记录不可用，不能扩大已覆盖范围'}</p>
              <ul className="list-disc pl-5">{memberLimitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
              {additionalSavedConditions.length < savedConditions.length ? <p className="text-sm text-muted-foreground">同文保存条件已列入上文的工程条件或处理记录。</p> : null}
              <details><summary className="cursor-pointer">原始来源与下层资料</summary>
                <ul className="space-y-1 break-all text-xs">{member.rootRefs.map(root => <li key={root}>{root}</li>)}</ul>
                <ul>{member.leaves.map(leaf => <li key={summaryMemberKey(leaf)}><Link className="underline" to={readingRoute(summaryMemberRoute(leaf))}>叶子工作：{summaryMemberSavedRef(leaf)}</Link></li>)}</ul>
              </details>
            </details>
          </div>;
        })}
      </details>
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
  CHANGED_WIKIMATTERCATALOG: '正式事项与选定资料的关联已变化。',
  SELECTED_HISTORY_OR_INCOMPLETE_COVERAGE: '选取含历史依据或尚未完整覆盖的工作。',
  CORRECTION_REVIEW_PENDING: '存在待核对的更正或复核请求。',
  DOCUMENT_LIFECYCLE_NOT_FENCED: '文档生命周期变化尚未纳入此核对。',
  NATIVE_CURRENTNESS_NOT_CONNECTED: '原生来源现行性尚未接入此核对。',
  PUBLISHER_CURRENTNESS_UNKNOWN: '发布方现行有效状态未核。',
};
function SummaryContextStatus({ status }: { status?: DerivedSummaryContextStatus }) {
  const state = status?.state ?? 'LEGACY_UNCHECKED';
  const label = state === 'UNCHANGED_HOST_CONTEXT' ? '保存依据未变化'
    : state === 'RECHECK_REQUIRED' ? '保存依据需要核对' : '此版本的依据状态尚未核对';
  return <details aria-label="保存依据上下文" className="space-y-2 border border-border p-3" open={state === 'RECHECK_REQUIRED'}>
    <summary className="cursor-pointer font-semibold">来源与更新状态</summary>
    <p role={state === 'RECHECK_REQUIRED' ? 'alert' : undefined}>{label}</p>
    <ul className="list-disc pl-5">{(status?.reasons ?? ['NO_SAVED_CONTEXT_BASIS']).map((reason, index) =>
      <li key={`${reason}:${index}`}>{contextReasonLabels[reason] ?? '另有尚未闭合的上下文限制，需重新核对。'}</li>)}</ul>
  </details>;
}
