import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { CreateDerivedSummaryRequest, DerivedSummaryReadModel, RequestDerivedSummaryUpdate } from '@shared/derived-summary.interface';
import { createDerivedSummary, readDerivedSummary, updateDerivedSummary } from '@client/src/api/derived-summary';
import { getCanonicalHostClientSessionGeneration, getCanonicalHostIdentityContext } from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { Textarea } from '@client/src/components/ui/textarea';
import { Checkbox } from '@client/src/components/ui/checkbox';
import TaskModelPicker, { useTaskModelOptions } from '@client/src/features/review/TaskModelPicker';
import SavedWorkSelector, { type SelectedSummaryMember } from './SavedWorkSelector';
import ChildSummarySelector from './ChildSummarySelector';
import SummaryScopeFields from './SummaryScopeFields';
import { scopeFromParams, summaryMemberKey, summaryMemberRoute, summaryScopeError } from './summary-selection';
import { useSummaryResource } from './useSummaryResource';
import { clearPendingSummaryRequest, readPendingSummaryRequest, storePendingSummaryRequest, summaryPendingKey, type PendingSummaryRequest } from './summary-pending-request';

export default function DerivedSummaryComposePage() {
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const { summaryId } = useParams();
  const load = useCallback(async (signal: AbortSignal) => {
    const [identity, head] = await Promise.all([getCanonicalHostIdentityContext(), summaryId ? readDerivedSummary(summaryId, signal) : Promise.resolve(null)]);
    const key = summaryPendingKey(identity.tenantId, identity.userId, summaryId);
    return { head, key, pending: readPendingSummaryRequest(key) };
  }, [summaryId]);
  const target = useSummaryResource(summaryId ?? 'new', sessionGeneration, load);
  return <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8" aria-label="形成派生概述">
    <Link className="underline" to="/summaries">返回派生概述目录</Link>
    <h1 className="text-2xl font-semibold">{summaryId ? '更新选定范围的概述' : '形成选定范围的概述'}</h1>
    {authenticationRequired ? <p role="alert">请先登录，再选择获权保存工作。</p>
      : target.error ? <p role="alert">{target.error}</p>
      : target.loading ? <p role="status">正在读取选定范围…</p>
      : target.data ? <SummaryComposeForm key={`${sessionGeneration}:${summaryId ?? 'new'}:${target.data.head?.currentRevision ?? 0}`} session={sessionGeneration}
        target={target.data.head} pending={target.data.pending} pendingKey={target.data.key} /> : null}
  </main>;
}

function SummaryComposeForm({ session, target, pending, pendingKey }: { session: number; target: DerivedSummaryReadModel | null; pending: PendingSummaryRequest | null; pendingKey: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [scope, setScope] = useState(() => pending?.scope ?? target?.scope ?? scopeFromParams(params));
  const [members, setMembers] = useState<SelectedSummaryMember[]>(() => pending?.members.map(member => ({ member,
    headline: member.kind === 'DERIVED_SUMMARY' ? member.summaryRef : member.workRef, current: null }))
    ?? target?.current?.members.map(item => ({ member: item.member, headline: item.headline, current: item.current })) ?? []);
  const [instruction, setInstruction] = useState(pending?.instruction ?? '');
  const [modelRef, setModelRef] = useState(pending?.modelRef ?? 'miaoda/glm-5.3');
  const models = useTaskModelOptions();
  const [confirmed, setConfirmed] = useState(pending !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rejected, setRejected] = useState(false);
  const [submitted, setSubmitted] = useState<CreateDerivedSummaryRequest | RequestDerivedSummaryUpdate | null>(pending);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const locked = busy || submitted !== null;
  function add(value: SelectedSummaryMember) {
    if (locked) return;
    setMembers(prior => [...prior.filter(item => summaryMemberKey(item.member) !== summaryMemberKey(value.member)), value]);
    setConfirmed(false);
  }
  async function submit() {
    if (busy || session !== getCanonicalHostClientSessionGeneration()) return;
    const validation = summaryScopeError(scope, members.map(item => item.member));
    if (!submitted && (validation || !instruction.trim() || !confirmed || !models.ready || !models.data?.options.some(option => option.modelRef === modelRef && option.available))) {
      setError(validation ?? '请填写生成要求、选择当前可用模型并确认实际范围。'); return;
    }
    const input = submitted ?? { requestId: crypto.randomUUID(), scope, members: members.map(item => item.member), instruction: instruction.trim(), modelRef,
      ...(target ? { expectedSummaryRevision: target.currentRevision } : {}) };
    try { storePendingSummaryRequest(pendingKey, input); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法保留请求，本次尚未发起。'); return; }
    setSubmitted(input); setBusy(true); setError(''); setRejected(false);
    try {
      const receipt = target ? await updateDerivedSummary(target.summaryId, input as RequestDerivedSummaryUpdate) : await createDerivedSummary(input);
      if (!active.current || session !== getCanonicalHostClientSessionGeneration()) return;
      clearPendingSummaryRequest(pendingKey);
      navigate(`/summaries/${encodeURIComponent(receipt.summaryId)}?${new URLSearchParams({ attemptRef: receipt.attemptRef })}`);
    } catch (reason) {
      if (active.current && session === getCanonicalHostClientSessionGeneration()) {
        const detail = reason as { statusCode?: number; code?: string } | null;
        const definitive = detail?.statusCode === 400 || detail?.code === 'DERIVED_SUMMARY_REVISION_CONFLICT';
        setRejected(definitive);
        setError(`${reason instanceof Error ? reason.message : '请求结果未知。'} ${definitive ? '请求未受理，可明确重新读取并选择。' : '原请求已保留，可用同一请求核对受理结果。'}`);
      }
    } finally { if (active.current) setBusy(false); }
  }
  return <div className="space-y-6">
    {pending ? <p role="status">已恢复尚待核对的原请求。成员、范围与执行模型保持原样，请用同一请求核对受理结果。</p> : null}
    <SummaryScopeFields scope={scope} disabled={locked} onChange={value => { setScope(value); setConfirmed(false); }} />
    {target ? <p className="text-sm">按当前概述修订 {target.currentRevision} 受理更新；现有确切成员列在下方，可明确移除或替换。</p> : null}
    {!locked ? <>
      <SavedWorkSelector session={session} candidateVersionIds={params.getAll('documentVersionId')} onAdd={add} />
      <ChildSummarySelector session={session} initialId={params.get('fromSummaryId') ?? ''} initialRef={params.get('fromSummaryRef') ?? ''} onAdd={add} />
    </> : null}
    <section className="space-y-3 border-t border-border pt-4" aria-label="实际选定成员">
      <h2 className="text-lg font-semibold">本次实际成员（{members.length}）</h2>
      {!members.length ? <p>尚未选定成员。</p> : null}
      <ul className="space-y-3">{members.map(item => <li className="rounded-md border border-border p-3" key={summaryMemberKey(item.member)}>
        <Link className="font-medium underline" to={summaryMemberRoute(item.member)}>{item.headline}</Link>
        <p className="text-sm">{item.member.kind === 'DERIVED_SUMMARY' ? `子概述确切修订 ${item.member.summaryRevision}` : `${item.member.kind === 'WORK_ITEM_WORK' ? '评估任务' : '工程事项'} · ${item.current === null ? '按保留确切身份核对' : item.current ? '选取时为当前工作' : '选取历史工作'} · 修订 ${item.member.workRevision} · 问题 ${item.member.issueKeys.join('、')}`}</p>
        <p className="break-all text-xs text-muted-foreground">{item.member.kind === 'DERIVED_SUMMARY' ? item.member.summaryRef : item.member.workRef}</p>
        {item.member.kind === 'WORK_ITEM_WORK' ? <p className="break-all text-xs">文档版本：{item.member.documentVersionId}</p> : null}
        {item.documentCurrent !== undefined ? <p className="text-sm">{item.documentCurrent ? '选取时为库内当前文档版本' : '选取历史文档版本，新版本未纳入'}</p> : null}
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => { setMembers(prior => prior.filter(value => summaryMemberKey(value.member) !== summaryMemberKey(item.member))); setConfirmed(false); }}>移出本次范围</Button>
      </li>)}</ul>
    </section>
    <label className="block space-y-2 text-sm">本次生成要求<Textarea value={instruction} disabled={locked} maxLength={4000} onChange={event => { setInstruction(event.target.value); setConfirmed(false); }} placeholder="说明需比较的前提、冲突、措施覆盖、未知和范围限制。" /></label>
    <TaskModelPicker id="derived-summary-model" label="本次概述执行模型" value={modelRef} onChange={value => { setModelRef(value); setConfirmed(false); }} catalog={models} disabled={locked} />
    <p className="text-sm text-muted-foreground">本次明确选定 Hosted 模型，不改变全局默认。</p>
    <label className="flex items-start gap-2 text-sm"><Checkbox checked={confirmed} disabled={locked} onCheckedChange={value => setConfirmed(value === true)} />
      仅采用上方确切成员和选定问题；其他资料与新变化未自动纳入，输出保持候选意见。</label>
    {error ? <p role="alert">{error}</p> : null}
    {rejected ? <Button variant="outline" onClick={() => {
      clearPendingSummaryRequest(pendingKey); setSubmitted(null); setRejected(false); setError(''); setConfirmed(false);
      if (target) navigate(`/summaries/${encodeURIComponent(target.summaryId)}`);
    }}>重新读取并选择</Button> : null}
    <Button disabled={busy || (!submitted && !confirmed)} onClick={() => void submit()}>{busy ? '正在核对受理…' : submitted ? '用同一请求核对受理结果' : '提交选定范围，形成候选概述'}</Button>
  </div>;
}
