import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import { jobAidReadingResult, type JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';
import { getCanonicalHostClientSessionGeneration, readJobAidAssessmentWork } from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import SavedAssessmentReading from './SavedAssessmentReading';
import { matterDocumentRoute } from './matter-navigation';
import { compactReadingSummary } from './compact-reading-summary';

interface Props {
  matterId: string;
  members: EngineeringMatterCatalogEntry[];
  sessionGeneration: number;
}
interface ReadState {
  identity: string;
  data: JobAidWorkingReadModel | null;
  error: string | null;
  loading: boolean;
}

/** A single selected member is read at a time; saved Matter work stays separate. */
export default function MemberSavedAssessmentReading({ matterId, members, sessionGeneration }: Props) {
  const navigate = useNavigate();
  const [selection, setSelection] = useState<{ matterId: string; workItemId: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [read, setRead] = useState<ReadState | null>(null);
  const selected = members.find(member => selection?.matterId === matterId && member.workItemId === selection.workItemId)
    ?? members.find(member => member.relationRole === 'PRIMARY') ?? members[0];
  const workItemId = selected?.workItemId ?? '';
  const documentVersionId = selected?.document.documentVersionId ?? '';
  const identity = JSON.stringify([matterId, workItemId, documentVersionId, selected?.currentWorkItemRevision, sessionGeneration]);
  useEffect(() => {
    if (!workItemId || sessionGeneration !== getCanonicalHostClientSessionGeneration()) return;
    const controller = new AbortController();
    const active = (): boolean => !controller.signal.aborted &&
      sessionGeneration === getCanonicalHostClientSessionGeneration();
    setRead({ identity, data: null, error: null, loading: true });
    void readJobAidAssessmentWork(workItemId, controller.signal).then(data => {
      if (!active()) return;
      if (data.workItemId !== workItemId || (data.current &&
        (data.current.workItemId !== workItemId || data.current.documentVersionId !== documentVersionId))) {
        throw new Error('成员评估的来源与当前资料不一致，请重新读取。');
      }
      setRead({ identity, data, error: null, loading: false });
    }).catch((error: unknown) => {
      if (!active()) return;
      setRead({ identity, data: null, loading: false,
        error: error instanceof Error ? error.message : '成员评估读取失败，请重新读取。' });
    });
    return () => controller.abort();
  }, [identity, workItemId, documentVersionId, sessionGeneration, refresh]);
  if (!selected || sessionGeneration !== getCanonicalHostClientSessionGeneration()) return null;
  const visible = read?.identity === identity ? read : null;
  const data = visible?.data;
  const current = data?.current;
  const limitations = current ? [...new Set(current.content.issues.flatMap(issue => [
    ...issue.riskScenarios.flatMap(scenario => scenario.limitations),
    ...issue.openQuestions.map(question => question.question),
    ...issue.measures.flatMap(measure => measure.limitations),
  ]).concat(current.content.historyReview.limitation ? [current.content.historyReview.limitation] : [],
    current.content.capabilities.filter(capability => capability.status !== 'AVAILABLE').map(capability => capability.impact))) ] : [];
  const exactRoute = current ? `/knowledge?${new URLSearchParams({ subjectKind: 'WORK_ITEM',
    subjectId: current.workItemId, workRef: current.workRevisionRef })}` : '';
  return <section className="my-6 space-y-4 border-t border-border pt-5" aria-label="成员资料已保存评估">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-base font-semibold">成员资料已保存评估</h3>
      <Button variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}>重新读取</Button>
    </header>
    <p className="text-sm text-muted-foreground">以下为成员资料的候选意见，事项综合仍按自身保存范围阅读。</p>
    {members.length > 1 ? <nav className="flex flex-wrap gap-2" aria-label="选择成员资料">
      {members.map(member => <Button key={member.workItemId} variant={member.workItemId === workItemId ? 'default' : 'outline'}
        size="sm" aria-pressed={member.workItemId === workItemId}
        onClick={() => setSelection({ matterId, workItemId: member.workItemId })}>
        {member.document.documentCode} · {member.document.businessRevision || '版本待核'}
      </Button>)}
    </nav> : <p className="text-sm text-muted-foreground">{selected.document.documentCode} · {selected.document.businessRevision || '版本待核'}</p>}
    {!visible || visible.loading ? <p role="status">正在读取成员已保存的评估…</p> : null}
    {visible?.error ? <p role="alert">{visible.error}</p> : null}
    {data && !current ? <p>这份资料尚无已保存的评估。稍后可重新读取。</p> : null}
    {current && data ? <div className="space-y-3" data-work-revision-ref={current.workRevisionRef}>
      <h4 className="font-medium">{current.content.headline}</h4>
      <p className="whitespace-pre-wrap text-sm leading-7">{compactReadingSummary(current.content.headline, current.content.listBrief)}</p>
      <p className="text-sm text-muted-foreground">{data.overallStatus === 'CURRENT' ? '该成员综合已覆盖当前保存工作'
        : data.overallStatus === 'STALE' ? '该成员综合待更新' : '该成员问题分析已保存，综合尚未形成'}
        {current.content.roundCompletion === 'IN_PROGRESS' ? ' · 分析仍在进行' : ''}</p>
      {data.currentInputChanged ? <p role="note" className="text-sm">资料输入已有变化，以下按原保存范围阅读。</p> : null}
      {limitations.length ? <ul className="list-disc space-y-1 pl-5 text-sm leading-7">
        {limitations.slice(0, 2).map(limitation => <li key={limitation}>{limitation}</li>)}
      </ul> : null}
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm font-medium">展开完整正文与依据</summary>
        {limitations.length > 2 ? <ul className="list-disc space-y-1 pl-5 text-sm leading-7">
          {limitations.slice(2).map(limitation => <li key={limitation}>{limitation}</li>)}
        </ul> : null}
        <SavedAssessmentReading key={current.workRevisionRef} result={jobAidReadingResult(current)} depth="full"
          onLocateDocument={source => navigate(matterDocumentRoute(matterId, source))} />
        <Link className="text-sm underline" to={exactRoute}>阅读此成员的确切保存版本</Link>
      </details>
    </div> : null}
  </section>;
}
