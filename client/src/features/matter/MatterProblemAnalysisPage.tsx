import MatterAssessmentActivity from './MatterAssessmentActivity';
import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, RefreshCw } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { getEngineeringMatterWorkingRevision } from '@client/src/api/engineering-matter';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';

import MatterProblemWork from './MatterProblemWork';
import MatterWorkingDetails from './MatterWorkingDetails';
import type { DocumentAssessmentEvidence } from './assessment-reading';
import { matterDocumentRoute, matterWorkRoute } from './matter-navigation';
import { selectMatterWorkRevision } from './matter-work-selection';
import useEngineeringMatter from './useEngineeringMatter';
import './matter-problem-analysis.css';

export default function MatterProblemAnalysisPage() {
  const { matterId = '' } = useParams<{matterId: string}>();
  const [params] = useSearchParams();
  const workRefs = params.getAll('workRef');
  const workRef = workRefs[0]?.trim() ?? '';
  const {sessionGeneration, authenticationRequired} = useCurrentUserSession();
  if (workRefs.length > 1 || (workRefs.length === 1 && !workRef)) {
    return <main className="matter-process-page"><p role="alert">指定工作身份无效，请从准确工作重新进入。</p></main>;
  }
  return <MatterProblemAnalysisContent key={JSON.stringify([matterId, workRef, sessionGeneration])} matterId={matterId} workRef={workRef} session={sessionGeneration} denied={authenticationRequired} />;
}

function MatterProblemAnalysisContent({matterId, workRef, session, denied}: {matterId: string; workRef: string; session: number; denied: boolean}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const workspace = useEngineeringMatter(matterId, session, denied);
  const current = workspace.data?.working.current ?? null;
  const [history, setHistory] = useState<EngineeringMatterWorkingRevisionReadModel | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const needsHistory = Boolean(workRef && current?.matterWorkRevisionId !== workRef);
  useEffect(() => {
    setHistory(null); setHistoryError(null);
    if (!needsHistory || !matterId || denied) return;
    const controller = new AbortController();
    void getEngineeringMatterWorkingRevision(matterId, workRef, controller.signal).then(value => {
      if (!controller.signal.aborted) setHistory(value);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : '指定工作读取失败。');
    });
    return () => controller.abort();
  }, [denied, matterId, needsHistory, workRef]);
  const revision = selectMatterWorkRevision(workRef, current, history);
  const error = workspace.error ?? historyError;
  const loading = workspace.loading || Boolean(needsHistory && !history && !historyError);
  const openDocument = (evidence: DocumentAssessmentEvidence) => {
    if (!revision) return;
    navigate(matterDocumentRoute(matterId, evidence, 'brief', revision.matterWorkRevisionId, searchParams));
  };
  if (!workspace.data) return <main className="matter-process-page" aria-busy={loading}><section className="matter-process-empty"><h1>{loading ? '正在读取问题分析…' : '暂时无法打开问题分析'}</h1>{error ? <p role="alert">{error}</p> : null}<Button variant="outline" onClick={() => navigate('/library?mode=matter')}><ArrowLeft />返回工程事项</Button></section></main>;
  const problem = revision?.state.problemWork;
  return <main className="matter-process-page">
    <header className="matter-process-head"><div><span>PROBLEM ANALYSIS</span><h1>问题与分析</h1><p>{workspace.data.matter.title} · 先读完整问题，再核查条件、方法和来源。</p></div><div><Button variant="outline" onClick={() => navigate(matterWorkRoute(matterId, revision?.matterWorkRevisionId ?? workRef))}><BookOpen />事项 Wiki</Button><Button variant="outline" disabled={loading} onClick={() => void workspace.refresh().catch(() => undefined)}><RefreshCw />{loading ? '正在读取' : '重新读取'}</Button></div></header>
    {error ? <p className="matter-process-banner" role="alert">{error} 当前保留已读回的保存版本。</p> : null}
    {workRef ? <p className="matter-process-banner">{revision ? `正在阅读指定工作修订 ${revision.workingRevision}，不会替换为当前工作。` : '指定工作尚未准确读回，不显示当前工作作为替代。'}</p> : null}
    <div className="matter-process-layout"><article className="matter-process-article">{revision && problem ? <MatterProblemWork revision={revision} onLocateDocument={openDocument} /> : <section className="matter-process-empty"><h2>当前工作没有已保存的问题正文</h2><p>这里不会从综合意见、待办或材料标题临时拼出问题分析。可返回事项 Wiki 阅读现有认识。</p></section>}</article><aside className="matter-process-aside"><MatterAssessmentActivity matterId={matterId} workRef={workRef} session={session} denied={denied || workspace.revoked} /><section><h2>认识更新状态</h2><strong>{problem?.overviewStatus === 'CURRENT' ? '已覆盖当前问题工作' : problem?.overviewStatus === 'STALE' ? '综合尚未覆盖本次更新' : '尚未形成综合'}</strong><p>{problem?.completionReason ?? '当前没有已保存的问题工作。'}</p></section>{revision ? <MatterWorkingDetails working={{matterId, currentMatterRevisionId: workspace.data.working.currentMatterRevisionId, currentWorkingRevision: revision.workingRevision, current: revision, pendingInputs: []}} members={workspace.data.matter.catalog.entries} /> : null}</aside></div>
  </main>;
}
