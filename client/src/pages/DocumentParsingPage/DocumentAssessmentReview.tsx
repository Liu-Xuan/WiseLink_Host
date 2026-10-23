import { Button } from '@client/src/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@client/src/components/ui/native-select';
import { Textarea } from '@client/src/components/ui/textarea';
import ContinuousReviewPanel from '@client/src/features/review/ContinuousReviewPanel';
import ReviewImpactPreview from '@client/src/features/review/ReviewImpactPreview';
import type { ReviewSourceBinding } from '@client/src/features/review/review-scope';
import { humanState } from '@client/src/features/navigation/treeMappers';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import type { CanonicalDocumentParsingPageResponse, CanonicalEngineerReviewDecision,
  ConfirmReviewActionDraftResponse } from '@shared/api.interface';
import type { JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';
import AssessmentRuleWorkspace from './AssessmentRuleWorkspace';
import { assessmentRuleName } from './assessment-rule-presentation';
import type { DocumentAssessmentActions } from './useDocumentAssessmentActions';
import { ReferenceMentionPreview } from './ReferenceMentionPreview';

const DECISIONS: Record<CanonicalEngineerReviewDecision, string> = {
  confirmed_pass: '确认通过', confirmed_fail: '确认不通过', returned_for_rework: '退回补充', deferred: '暂缓判断',
};

export default function DocumentAssessmentReview({ page, working, refreshing, criterion, onCriterionChange,
  actions, receipt, draftScopeKey, onReceipt, onRefresh, onWorkingRefresh, onLocateDocument, onOpenReader, onOpenRelatedWork }: {
  page: CanonicalDocumentParsingPageResponse; working: JobAidWorkingReadModel | null; refreshing: boolean;
  criterion: string; onCriterionChange(value: string): void; actions: DocumentAssessmentActions;
  receipt: ConfirmReviewActionDraftResponse['reviewAction'] | null; draftScopeKey: string;
  onReceipt(value: ConfirmReviewActionDraftResponse['reviewAction']): void;
  onRefresh(): Promise<void>; onWorkingRefresh(): Promise<void>;
  onLocateDocument(evidence: Pick<DocumentAssessmentEvidence, 'workItemId' | 'documentVersionId' | 'sourceRefId'>): void;
  onOpenReader(): void;
  onOpenRelatedWork(workItemId: string): void;
}) {
  const context = page.engineerReviewContext;
  const selected = context?.items.find(item => item.criterionId === criterion);
  const criterionLabel: string = selected ? assessmentRuleName(selected, context!.items.indexOf(selected)) : '当前判断规则';
  const locate = (sourceRefId: string): void => onLocateDocument({ workItemId: page.workItem.workItemId,
    documentVersionId: page.workItem.source.documentVersionId, sourceRefId });
  return <div className="document-assessment-review">
    {context?.items.length ? <section aria-label="逐项规则复核">
      <AssessmentRuleWorkspace items={context.items} selectedCriterionId={criterion}
        onSelectCriterion={onCriterionChange} onLocateSourceRef={locate} />
      <details className="document-assessment-legacy-review"><summary>记录必要的工程师修订 · {context.ledger?.reviewCount ?? 0} 条历史意见</summary>
        <p>仅在判断方向、依据或输入需要修正时记录，无需逐项确认。</p>
        <div className="document-assessment-review-form">
          <label>规则项<NativeSelect value={criterion} onChange={event => onCriterionChange(event.target.value)}>
            {context.items.map((item, index) => <NativeSelectOption key={item.criterionId} value={item.criterionId}>
              {assessmentRuleName(item, index)} · {humanState(item.dynamicResult) ?? '状态待确认'}</NativeSelectOption>)}
          </NativeSelect></label>
          <label>处理意见<NativeSelect value={actions.reviewDecision}
            onChange={event => actions.setReviewDecision(event.target.value as CanonicalEngineerReviewDecision)}>
            {Object.entries(DECISIONS).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
          </NativeSelect></label>
          <label className="document-assessment-review-comment">说明<Textarea value={actions.reviewComment}
            onChange={event => actions.setReviewComment(event.target.value)} maxLength={4000} placeholder="说明依据、异议或仍需补齐的输入" /></label>
          <Button disabled={refreshing || actions.reviewSubmitting} onClick={() => {
            if (!criterion || !actions.reviewComment.trim()) { actions.setAssessmentError('请选择评估项并填写说明。'); return; }
            actions.setAssessmentError(null); actions.setReviewPreviewOpen(true);
          }}>预览影响并保存工程师意见</Button>
        </div>
        {context.items.filter(item => item.latestReview).map((item, index) => <p key={item.criterionId}>
          {assessmentRuleName(item, index)} · {DECISIONS[item.latestReview!.decision]} · {item.latestReview!.comment}</p>)}
      </details>
      <ReviewImpactPreview open={actions.reviewPreviewOpen} criterionLabel={criterionLabel}
        criterionConclusion={selected?.candidateConclusion ?? '—'} decision={DECISIONS[actions.reviewDecision]}
        comment={actions.reviewComment.trim()} overallStatus={page.workItem.integratedAssessment?.overallSynthesis?.status ?? null}
        submitting={actions.reviewSubmitting} refreshing={refreshing} onCancel={() => actions.setReviewPreviewOpen(false)}
        onConfirm={() => void actions.recordEngineerReview()} />
    </section> : null}
    {actions.conflictMessage ? <p role="alert">{actions.conflictMessage}。请刷新读取新版本，当前说明已保留。</p> : null}
    <ContinuousReviewPanel workItemId={page.workItem.workItemId} workItemRevision={page.workItem.revision}
      draftScopeKey={draftScopeKey} workItemRefreshing={refreshing} selectedEvaluationItemId={criterion || null}
      jobAidIssues={working?.current?.content.issues.map(({ issueKey, question }) => ({ issueKey, question }))}
      confirmationReceipt={receipt} onConfirmationReceipt={onReceipt}
      onLocateSourceRef={locate} onLocateSourceBinding={(binding: ReviewSourceBinding) => onLocateDocument({
        workItemId: binding.workItemId, documentVersionId: binding.documentVersionId, sourceRefId: binding.originalSourceRefId,
      })} onWorkItemRefresh={onRefresh} onWorkingRefresh={onWorkingRefresh}
      materials={{ primary: { title: page.workItem.package?.documentIdentity?.documentCode ?? page.workItem.source.documentId,
        documentVersionId: page.workItem.source.documentVersionId, versionLabel: '当前所选文档版本' }, onOpenPrimary: onOpenReader,
        related: <ReferenceMentionPreview workItemId={page.workItem.workItemId} workItemRevision={page.workItem.revision}
          onLocateSourceRef={locate} onOpenTarget={onOpenRelatedWork} /> }} />
  </div>;
}
