import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@client/src/components/ui/button';
import RetainedWorkbenchPanel, { useWorkbenchPanelActive } from '@client/src/features/workbench/RetainedWorkbenchPanel';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import RevisionTimeline from '@client/src/features/review/RevisionTimeline';
import { writeReviewDraft } from '@client/src/features/review/review-draft-store';
import { useOverallRegeneration } from '@client/src/features/workitem/useOverallRegeneration';
import { useReviewOverallProjection } from '@client/src/features/workitem/useReviewOverallProjection';
import type { CanonicalDocumentParsingPageResponse, CanonicalLibraryQuicklookResponse,
  ConfirmReviewActionDraftResponse } from '@shared/api.interface';
import { useJobAidWorkingRead } from './useJobAidWorkingRead';
import { useDocumentAssessmentPage } from './useDocumentAssessmentPage';
import { documentAssessmentAeoEligible, useDocumentAssessmentActions } from './useDocumentAssessmentActions';
import { DOCUMENT_ASSESSMENT_TABS, readDocumentAssessmentTab, type DocumentAssessmentTab } from './document-workbench-panel';
import { resolveAssessmentRuleSelection } from './assessment-rule-presentation';
import DocumentAssessmentOverview from './DocumentAssessmentOverview';
import DocumentAssessmentReview from './DocumentAssessmentReview';
import DocumentAssessmentAeo from './DocumentAssessmentAeo';
import JobAidProblemWorkspace from './JobAidProblemWorkspace';
import { AssessmentProcessDetails } from './WorkItemProcessWorkspace';
import { EngineeringReasoningTrail } from './EngineeringReasoningTrail';
import WorkItemRuntimeDiagnostic from './runtime-monitor/WorkItemRuntimeDiagnostic';
import './document-assessment-workspace.css';

export type AssessmentSourceSelection = Pick<DocumentAssessmentEvidence,
  'workItemId' | 'documentVersionId' | 'sourceRefId'> & { locator?: string };

/** One exact document/work association, one authorized page, one shared working read. */
export default function DocumentAssessmentWorkspace({ association, documentVersionId, sessionGeneration,
  associationRefreshing, wikiError, onRejected, onLocateDocument, onOpenReader, onOpenRelatedWork }: {
  association: CanonicalLibraryQuicklookResponse; documentVersionId: string; sessionGeneration: number;
  associationRefreshing: boolean; wikiError?: string | null; onRejected(message: string): void;
  onLocateDocument(evidence: AssessmentSourceSelection): void; onOpenReader(): void;
  onOpenRelatedWork(workItemId: string): void;
}) {
  const active: boolean = useWorkbenchPanelActive();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const selection = readDocumentAssessmentTab(params);
  const contentRef = useRef<HTMLFieldSetElement>(null);
  const scrollRestored = useRef(false);
  const workItemId: string = association.document.workItemId;
  const draftScopeKey: string = `document-assessment:${sessionGeneration}:${documentVersionId}:${workItemId}`;
  const rejected = useCallback((message: string): void => {
    writeReviewDraft(draftScopeKey, '', sessionGeneration);
    onRejected(message);
  }, [draftScopeKey, sessionGeneration, onRejected]);
  const full = useDocumentAssessmentPage({ association, documentVersionId, sessionGeneration,
    associationRefreshing, wikiError, onRejected: rejected });
  const workingRead = useJobAidWorkingRead(workItemId, full.page, Boolean(full.page));
  const workingRejected: boolean = Boolean(full.page &&
    (workingRead.error && !workingRead.temporaryError && !workingRead.baseFallbackAllowed ||
      workingRead.data?.current && workingRead.data.current.documentVersionId !== documentVersionId));
  useEffect(() => {
    if (workingRejected) full.reject(workingRead.error ?? '评估工作与所选文档版本不一致。');
  }, [workingRejected, workingRead.error, full.reject]);
  const page: CanonicalDocumentParsingPageResponse | null = workingRejected ? null : full.page;
  const refreshing: boolean = full.refreshing || !full.verified || workingRejected;
  const [receipt, setReceipt] = useState<ConfirmReviewActionDraftResponse['reviewAction'] | null>(null);
  const [reviewGeneration, setReviewGeneration] = useState(0);
  const criterion: string = resolveAssessmentRuleSelection(page?.engineerReviewContext?.items,
    params.get('assessmentCriterion')) ?? '';
  const choose = (tab: DocumentAssessmentTab, criterionId?: string): void => {
    const next: URLSearchParams = new URLSearchParams(params);
    next.set('panel', 'assessment'); next.set('assessmentTab', tab);
    if (criterionId) next.set('assessmentCriterion', criterionId);
    setParams(next, { replace: true });
  };
  const refresh = useCallback(async (): Promise<void> => { await full.refresh(); }, [full.refresh]);
  const accept = useCallback(async (fresh: CanonicalDocumentParsingPageResponse): Promise<void> => {
    await full.refresh(fresh);
  }, [full.refresh]);
  const regeneration = useOverallRegeneration({ workItemId, sessionGeneration, onSucceeded: accept });
  const projection = useReviewOverallProjection({ workItemId, sessionGeneration,
    workItemRevision: page?.workItem.revision ?? null, reviewRefreshGeneration: reviewGeneration, onSucceeded: accept });
  const actions = useDocumentAssessmentActions({ page, sessionGeneration, refreshing,
    selectedReviewCriterion: criterion, onRefresh: refresh, onRejected: full.reject });
  const showAeo: boolean = Boolean(page?.workItem.aeo) || documentAssessmentAeoEligible(page);
  const tab: DocumentAssessmentTab = selection.tab === 'aeo' && !showAeo ? 'overall' : selection.tab;
  useEffect(() => {
    if (!page || !active || scrollRestored.current) return;
    const value: string = params.get('assessmentScroll') ?? '';
    const panel = contentRef.current?.querySelector<HTMLElement>(':scope > .wl-retained-panel:not([hidden])');
    if (panel && /^\d{1,7}$/u.test(value)) panel.scrollTop = Number(value);
    scrollRestored.current = true;
  }, [page, active, tab, params]);

  return <section className="document-assessment-workspace" aria-label="文档版本评估工作区"
    data-assessment-scope={JSON.stringify([sessionGeneration, documentVersionId, workItemId])}>
    <header className="document-assessment-heading"><div><span>本版本关联评估</span><h2>判断、调查与复核</h2>
      <p>{association.document.documentCode} · 事项修订 {page?.workItem.revision ?? '正在核对'}</p></div>
      <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={full.refreshing}>刷新评估</Button></header>
    {selection.error ? <p role="alert">{selection.error}</p> : null}
    {full.error ? <p role="alert">{full.error}{page ? '。保留上次读回内容，重新核定前操作不可用。' : '。请重新核对本版本评估工作。'}</p> : null}
    {full.refreshing ? <p role="status">正在核对评估工作与当前读取权限…</p> : null}
    {workingRead.error ? <p role="alert">{workingRead.error}</p> : null}
    {actions.assessmentError ? <p role="alert">{actions.assessmentError}</p> : null}
    {page ? <>
      <nav className="document-assessment-tabs" aria-label="评估业务区签">
        {DOCUMENT_ASSESSMENT_TABS.filter(item => item.id !== 'aeo' || showAeo).map(item => <Button
          key={item.id} variant="ghost" size="sm" aria-pressed={tab === item.id} onClick={() => choose(item.id)}>{item.label}</Button>)}
      </nav>
      <fieldset ref={contentRef} className="document-assessment-content" disabled={refreshing} aria-busy={refreshing}>
        <RetainedWorkbenchPanel active={active && tab === 'overall'}>
          <DocumentAssessmentOverview page={page} working={workingRead.data} refreshing={refreshing}
            regeneration={regeneration} projection={projection} onRefresh={refresh} onReview={() => choose('review')}
            onLocateDocument={onLocateDocument} />
          {!showAeo ? <details className="document-assessment-aeo-note"><summary>AEO 候选条件</summary>
            <p>当前未形成可操作的 AEO 候选。仍需已确认的 SB、原逐项评估路径及未过期的当前整体候选。</p></details> : null}
        </RetainedWorkbenchPanel>
        <RetainedWorkbenchPanel active={active && tab === 'investigation'}>
          <JobAidProblemWorkspace workItemId={workItemId} workingRead={workingRead} baseRevision={page.workItem.revision}
            baseReadConfirmed={full.verified} baseReadProof={page} initialAnalysis={page.initialAnalysis}
            overall={page.workItem.integratedAssessment?.overallSynthesis} onUpdated={() => void refresh()}
            onLocateDocument={onLocateDocument} presentation="investigation" initialIssueKey={params.get('assessmentIssue')}
            onIssueSelect={issueKey => { const next = new URLSearchParams(params); next.set('assessmentIssue', issueKey); setParams(next, { replace: true }); }}>
            <p>此工作使用原逐项规则评估，判断与依据可在复核意见中展开。</p>
            <Button variant="outline" onClick={() => choose('review')}>查看实际规则与复核</Button>
          </JobAidProblemWorkspace>
        </RetainedWorkbenchPanel>
        <RetainedWorkbenchPanel active={active && tab === 'review'}>
          <DocumentAssessmentReview page={page} working={workingRead.data} refreshing={refreshing} criterion={criterion}
            onCriterionChange={value => choose('review', value)} actions={actions} receipt={receipt}
            draftScopeKey={draftScopeKey} onReceipt={setReceipt} onRefresh={refresh}
            onWorkingRefresh={async () => { await refresh(); setReviewGeneration(value => value + 1); }}
            onLocateDocument={onLocateDocument} onOpenReader={onOpenReader} onOpenRelatedWork={onOpenRelatedWork} />
        </RetainedWorkbenchPanel>
        <RetainedWorkbenchPanel active={active && tab === 'process'}>
          <AssessmentProcessDetails data={page} working={workingRead.data} onChanged={workingRead.refresh} />
          <WorkItemRuntimeDiagnostic read={workingRead} workItemId={workItemId} sessionGeneration={sessionGeneration}
            onOpenWorkRevision={workRef => navigate(`/knowledge?${new URLSearchParams({
              kind: 'works', subjectKind: 'WORK_ITEM', subjectId: workItemId, workRef,
            })}`)}
            onRefresh={() => void refresh()} onOpenPanel={panel => panel === 'reader' ? onOpenReader()
              : choose(panel === 'review' ? 'review' : 'overall')} />
          <details><summary>可解释过程与版本记录</summary><EngineeringReasoningTrail data={page} working={workingRead.data} />
            <RevisionTimeline timeline={page.timeline} /></details>
        </RetainedWorkbenchPanel>
        <RetainedWorkbenchPanel active={active && tab === 'aeo'}>
          <DocumentAssessmentAeo page={page} refreshing={refreshing} actions={actions} />
        </RetainedWorkbenchPanel>
      </fieldset>
    </> : !full.error && !full.refreshing ? <p>此评估工作尚未读回，请重新核对。</p> : null}
  </section>;
}
