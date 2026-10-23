import SavedAssessmentReading from '@client/src/features/matter/SavedAssessmentReading';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import OverallAssessmentHero from '@client/src/features/workitem/OverallAssessmentHero';
import type { OverallRegenerationControl } from '@client/src/features/workitem/useOverallRegeneration';
import { toWorkItemView } from '@client/src/services/viewModelMappers';
import { Button } from '@client/src/components/ui/button';
import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';
import type { JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';
import ApplicabilitySelectionPanel from './ApplicabilitySelectionPanel';

export default function DocumentAssessmentOverview({ page, working, refreshing, regeneration,
  projection, onRefresh, onReview, onLocateDocument }: {
  page: CanonicalDocumentParsingPageResponse; working: JobAidWorkingReadModel | null;
  refreshing: boolean; regeneration: OverallRegenerationControl;
  projection: { visible: boolean; busy: boolean; message: string | null; run(): Promise<void> };
  onRefresh(): Promise<void>; onReview(): void; onLocateDocument(evidence: Pick<DocumentAssessmentEvidence, 'workItemId' | 'documentVersionId' | 'sourceRefId'>): void;
}) {
  const overall = page.workItem.integratedAssessment?.overallSynthesis;
  const currentWork = working?.current;
  const currentOverall: boolean = Boolean(overall?.readingResult &&
    overall.status === 'CANDIDATE_ONLY' && overall.staleReason === null &&
    (working?.enabled ? currentWork && overall.basedOnJobAidWorkRevisionRef === currentWork.workRevisionRef &&
      working.overallStatus === 'CURRENT' && working.overallBasedOnWorkRevisionRef === currentWork.workRevisionRef
      : working?.enabled === false));
  return <div className="document-assessment-overview">
    <section aria-label="综合评估意见">
      <header><h2>综合评估</h2><p>按准确保存工作核对的候选认识，正式采用仍由工程师决定。</p></header>
      {overall?.readingResult ? <>
        <p role="status">{currentOverall ? '与本工作版本一致的综合意见' : '此前保存的综合意见 · 当前基础版本尚未匹配'}
          {overall.staleReason ? ` · ${overall.staleReason}` : ''}</p>
        <SavedAssessmentReading result={overall.readingResult} depth="full" locationSuffix="document-assessment:overall"
          onLocateDocument={onLocateDocument} />
      </> : <OverallAssessmentHero view={toWorkItemView(page)}
        regeneration={{ ...regeneration, disabled: refreshing || regeneration.disabled }}
        onOpenWorkbench={onReview} onViewEvidence={sourceRefId => sourceRefId ? onLocateDocument({
          workItemId: page.workItem.workItemId, documentVersionId: page.workItem.source.documentVersionId, sourceRefId }) : onReview()} />}
      {projection.visible ? <div className="document-assessment-action">
        <Button disabled={refreshing || projection.busy} onClick={() => void projection.run()}>
          {projection.busy ? '正在更新综合…' : '从已保存评估更新综合'}</Button>
        <p>只根据已保存工作更新综合候选，不重新分析正文。</p>
      </div> : null}
      {projection.message ? <p role="status">{projection.message}</p> : null}
      {regeneration.message ? <p role="status">{regeneration.message}</p> : null}
    </section>
    <section aria-label="当前工作完成范围"><h3>当前工作与范围</h3>
      {currentWork ? <><p>保存工作修订 {currentWork.workRevision} · {currentWork.content.roundCompletion}</p>
        <p>{currentWork.content.completionReason}</p>
        {working?.currentInputChanged ? <p>输入已有变化，原工作条件与依据保持，需继续核对。</p> : null}</>
        : <p>尚未读到已保存的调查工作；运行状态和既有综合各自保留。</p>}
    </section>
    <ApplicabilitySelectionPanel workItemId={page.workItem.workItemId} workItemRevision={page.workItem.revision}
      workItemRefreshing={refreshing} onOpenInteractiveReview={onReview} onConfigurationEvidenceAdopted={onRefresh} />
  </div>;
}
