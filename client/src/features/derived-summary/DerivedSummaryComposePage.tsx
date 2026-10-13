import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { CreateDerivedSummaryRequest, DerivedSummaryPurpose, DerivedSummaryReadModel, RequestDerivedSummaryUpdate } from '@shared/derived-summary.interface';
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
import { scopeFromParams, summaryMemberKey, summaryMemberVersionLabel, summaryMemberSavedRef, summaryMemberRoute, summaryScopeError } from './summary-selection';
import { useSummaryResource } from './useSummaryResource';
import { clearPendingSummaryRequest, readPendingSummaryRequest, storePendingSummaryRequest, summaryPendingKey, type PendingSummaryRequest } from './summary-pending-request';

export default function DerivedSummaryComposePage() {
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const { summaryId } = useParams();
  const load = useCallback(async (signal: AbortSignal) => {
    const [identity, head] = await Promise.all([getCanonicalHostIdentityContext(), summaryId ? readDerivedSummary(summaryId, signal) : Promise.resolve(null)]);
    const key = summaryPendingKey(identity.tenantId, identity.userId, summaryId);
    return { head, key, pending: readPendingSummaryRequest(key, summaryId) };
  }, [summaryId]);
  const target = useSummaryResource(summaryId ?? 'new', sessionGeneration, load);
  return <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8" aria-label="创建资料综合">
    <Link className="underline" to="/summaries">返回资料综合目录</Link>
    <h1 className="text-2xl font-semibold">{summaryId ? '更新资料综合' : '创建资料综合'}</h1>
    {authenticationRequired ? <p role="alert">请先登录。</p>
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
    headline: summaryMemberSavedRef(member), current: null }))
    ?? target?.current?.members.map(item => ({ member: item.member, headline: item.headline, current: item.current })) ?? []);
  const [purpose, setPurpose] = useState<DerivedSummaryPurpose>(pending?.purpose ?? 'SYNTHESIZE');
  const [instruction, setInstruction] = useState(pending?.instruction ?? '');
  const [modelRef, setModelRef] = useState(pending?.modelRef ?? 'miaoda/glm-5.3');
  const models = useTaskModelOptions();
  const [confirmed, setConfirmed] = useState(pending !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rejected, setRejected] = useState(false);
  const [submitted, setSubmitted] = useState<CreateDerivedSummaryRequest | RequestDerivedSummaryUpdate | null>(pending);
  const active = useRef(true);
  // React state does not update between synchronous clicks in the same event batch.
  const inFlight = useRef(false);
  const originalRequest = useRef<PendingSummaryRequest | null>(pending);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const locked = busy || submitted !== null;
  const exactSavedTarget = Boolean(target && target.classificationStatus === 'CANDIDATE' &&
    typeof target.currentSummaryRef === 'string' && target.currentSummaryRef.trim() &&
    Number.isSafeInteger(target.currentRevision) && target.currentRevision >= 1 && target.currentRevision < 2147483647 && target.current &&
    target.current.summaryId === target.summaryId && target.current.summaryRef === target.currentSummaryRef &&
    target.current.revision === target.currentRevision && target.current.candidateOnly === true &&
    target.current.classificationStatus === 'CANDIDATE');
  function add(value: SelectedSummaryMember) {
    if (locked) return;
    setMembers(prior => [...prior.filter(item => summaryMemberKey(item.member) !== summaryMemberKey(value.member)), value]);
    setConfirmed(false);
  }
  async function submit() {
    if (inFlight.current || busy || session !== getCanonicalHostClientSessionGeneration()) return;
    const replay = originalRequest.current;
    const validation = summaryScopeError(scope, members.map(item => item.member));
    if (!replay && purpose === 'REVISE_SAVED_SUMMARY' && !exactSavedTarget) {
      setError('没有可核权的准确保存概述，不能提交修改任务。请重新读取，或明确选择重新综合。'); return;
    }
    if (!replay && (validation || !instruction.trim() || !confirmed || !models.ready || !models.data?.options.some(option => option.modelRef === modelRef && option.available))) {
      setError(validation ?? '请填写生成要求、选择当前可用模型并确认实际范围。'); return;
    }
    const input = replay ?? { requestId: crypto.randomUUID(), purpose, scope, members: members.map(item => item.member), instruction: instruction.trim(), modelRef,
      ...(target ? { expectedSummaryRevision: target.currentRevision } : {}) };
    inFlight.current = true;
    try { storePendingSummaryRequest(pendingKey, input); }
    catch (reason) { inFlight.current = false; setError(reason instanceof Error ? reason.message : '无法保留请求，本次尚未发起。'); return; }
    originalRequest.current = input;
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
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  }
  return <div className="space-y-6">
    {pending ? <p role="status">已恢复尚待核对的原请求。成员、范围与执行模型保持原样，请用同一请求核对受理结果。</p> : null}
    <SummaryScopeFields scope={scope} disabled={locked} onChange={value => { setScope(value); setConfirmed(false); }} />
    {target ? <fieldset className="space-y-2 rounded-md border border-border p-3" disabled={locked}>
      <legend className="text-sm font-medium">本次任务</legend>
      <label className="flex items-start gap-2 text-sm"><input type="radio" name="summary-purpose" value="SYNTHESIZE" checked={purpose === 'SYNTHESIZE'}
        onChange={() => { setPurpose('SYNTHESIZE'); setConfirmed(false); }} />按当前完整选定材料重新综合</label>
      <label className="flex items-start gap-2 text-sm"><input type="radio" name="summary-purpose" value="REVISE_SAVED_SUMMARY" checked={purpose === 'REVISE_SAVED_SUMMARY'} disabled={!exactSavedTarget}
        onChange={() => { setPurpose('REVISE_SAVED_SUMMARY'); setConfirmed(false); }} />修改已有资料综合</label>
      <p className="text-sm">{pending && 'expectedSummaryRevision' in pending ? `原请求锁定保存修订 ${pending.expectedSummaryRevision}；目前指针为 ${target.currentRevision}，不会自动改用新版。` : `按保存修订 ${target.currentRevision} 核对受理。`}</p>
      {exactSavedTarget && (!pending || !('expectedSummaryRevision' in pending) || pending.expectedSummaryRevision === target.currentRevision)
        ? <Link className="text-sm underline" to={`/summaries/${encodeURIComponent(target.summaryId)}?${new URLSearchParams({ summaryRef: target.currentSummaryRef! })}`}>查看保存版本 {target.currentSummaryRef}</Link> : null}
    </fieldset> : null}
    {!locked ? <>
      <SavedWorkSelector session={session} candidateVersionIds={params.getAll('documentVersionId')} onAdd={add} />
      <ChildSummarySelector session={session} initialId={params.get('fromSummaryId') ?? ''} initialRef={params.get('fromSummaryRef') ?? ''} onAdd={add} />
    </> : null}
    <section className="space-y-3 border-t border-border pt-4" aria-label="实际选定成员">
      <h2 className="text-lg font-semibold">本次实际成员（{members.length}）</h2>
      {!members.length ? <p>尚未选定成员。</p> : null}
      <ul className="space-y-3">{members.map(item => <li className="rounded-md border border-border p-3" key={summaryMemberKey(item.member)}>
        <Link className="font-medium underline" to={summaryMemberRoute(item.member)}>{item.headline}</Link>
        <p className="text-sm">{summaryMemberVersionLabel(item.member)}</p>
        <p className="break-all text-xs text-muted-foreground">{summaryMemberSavedRef(item.member)}</p>
        {item.member.kind === 'WORK_ITEM_WORK' ? <p className="break-all text-xs">文档版本：{item.member.documentVersionId}</p> : null}
        {item.documentCurrent !== undefined ? <p className="text-sm">{item.documentCurrent ? '选取时为库内当前文档版本' : '选取历史文档版本，新版本未纳入'}</p> : null}
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => { setMembers(prior => prior.filter(value => summaryMemberKey(value.member) !== summaryMemberKey(item.member))); setConfirmed(false); }}>移出本次范围</Button>
      </li>)}</ul>
    </section>
    <label className="block space-y-2 text-sm">{purpose === 'REVISE_SAVED_SUMMARY' ? '本次修改目标' : '本次生成要求'}<Textarea value={instruction} disabled={locked} maxLength={4000} onChange={event => { setInstruction(event.target.value); setConfirmed(false); }} placeholder="说明需比较的前提、冲突、措施覆盖、未知和范围限制。" /></label>
    <TaskModelPicker id="derived-summary-model" label="生成模型" value={modelRef} onChange={value => { setModelRef(value); setConfirmed(false); }} catalog={models} disabled={locked} />
    <label className="flex items-start gap-2 text-sm"><Checkbox checked={confirmed} disabled={locked} onCheckedChange={value => setConfirmed(value === true)} />
      确认以上选定资料与问题。</label>
    {error ? <p role="alert">{error}</p> : null}
    {rejected ? <Button variant="outline" onClick={() => {
      clearPendingSummaryRequest(pendingKey); originalRequest.current = null; setSubmitted(null); setRejected(false); setError(''); setConfirmed(false);
      if (target) navigate(`/summaries/${encodeURIComponent(target.summaryId)}`);
    }}>重新读取并选择</Button> : null}
    <Button disabled={busy || (!submitted && !confirmed)} onClick={() => void submit()}>{busy ? '正在提交…' : submitted ? '用同一请求核对受理结果' : purpose === 'REVISE_SAVED_SUMMARY' ? '提交修改要求，更新资料综合' : '提交选定范围，生成资料综合'}</Button>
  </div>;
}
