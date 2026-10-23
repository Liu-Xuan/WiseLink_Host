import { useEffect, useRef, useState } from 'react';
import { canonicalHost } from '@client/src/api';
import { getCanonicalHostClientSessionGeneration, requireCanonicalHostClientAuthentication } from '@client/src/api/canonical-host';
import type { CanonicalDocumentParsingPageResponse, CanonicalEngineerReviewDecision } from '@shared/api.interface';
import { isJobAidProblemProjection } from '@shared/jobaid-problem-assessment.interface';

export function assessmentActionError(reason: unknown): string {
  const message: string = reason instanceof Error ? reason.message : String(reason ?? '');
  if (/CRITERION_AND_COMMENT_REQUIRED/iu.test(message)) return '请选择评估项并填写说明。';
  if (/FORBIDDEN|UNAUTHORIZED|ACCESS_DENIED|401|403/iu.test(message)) return '当前账户没有执行此操作的权限。';
  if (/NOT_FOUND|404/iu.test(message)) return '当前事项或评估内容已不可用，请返回资料库重新进入。';
  if (/REVISION|CONFLICT|STALE|409|VERSION/iu.test(message)) return '当前事项已产生新版本，请刷新后基于最新结果继续。';
  return '操作未完成，请刷新当前事项后重试。';
}

export function documentAssessmentAeoEligible(page: CanonicalDocumentParsingPageResponse | null): boolean {
  const assessment = page?.workItem.integratedAssessment;
  return Boolean(page?.workItem.classification.status === 'CONFIRMED' &&
    page.workItem.classification.normalizedFamily === 'SB' && assessment &&
    !isJobAidProblemProjection(assessment.baseRules) &&
    assessment.overallSynthesis?.status === 'CANDIDATE_ONLY' && assessment.overallSynthesis.staleReason === null);
}

/** Existing explicit legacy-review and AEO operations, shared by both entry layouts. */
export function useDocumentAssessmentActions(input: {
  page: CanonicalDocumentParsingPageResponse | null;
  sessionGeneration: number; refreshing: boolean; selectedReviewCriterion: string;
  onRefresh(): Promise<void>; onRejected?(message: string): void;
}) {
  const [assessmentAction, setAssessmentAction] = useState<'CONFIRM_OVERALL_FOR_AEO' | 'GENERATE_AEO_CANDIDATE' | null>(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<CanonicalEngineerReviewDecision>('deferred');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewPreviewOpen, setReviewPreviewOpen] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const scope: string = JSON.stringify([input.sessionGeneration, input.page?.workItem.workItemId,
    input.page?.workItem.source.documentVersionId]);
  const epoch = useRef(0);
  const latestScope = useRef(scope);
  latestScope.current = scope;
  useEffect(() => {
    epoch.current++; setAssessmentAction(null); setAssessmentError(null); setReviewSubmitting(false);
    setReviewPreviewOpen(false); setConflictMessage(null); setReviewComment(''); setReviewDecision('deferred');
    return () => { epoch.current++; };
  }, [scope]);

  async function perform(kind: 'CONFIRM_OVERALL_FOR_AEO' | 'GENERATE_AEO_CANDIDATE' | 'REVIEW'): Promise<void> {
    const page: CanonicalDocumentParsingPageResponse | null = input.page;
    if (!page || input.refreshing || assessmentAction || reviewSubmitting) return;
    const workItemId: string = page.workItem.workItemId;
    const overall = page.workItem.integratedAssessment?.overallSynthesis;
    if (kind !== 'REVIEW' && (!documentAssessmentAeoEligible(page) || !overall)) return;
    if (kind === 'GENERATE_AEO_CANDIDATE' && !page.workItem.integratedAssessment?.overallForAeoConfirmation) return;
    if (kind === 'REVIEW' && (!reviewComment.trim() ||
      !page.engineerReviewContext?.items.some(item => item.criterionId === input.selectedReviewCriterion))) {
      setAssessmentError('请选择评估项并填写说明。'); return;
    }
    const actionEpoch: number = epoch.current;
    const current = (): boolean => epoch.current === actionEpoch && latestScope.current === scope &&
      input.sessionGeneration === getCanonicalHostClientSessionGeneration();
    setAssessmentError(null); setConflictMessage(null);
    if (kind === 'REVIEW') setReviewSubmitting(true); else setAssessmentAction(kind);
    try {
      if (kind === 'REVIEW') await canonicalHost.recordEngineerReview(workItemId, {
        expectedRevision: page.workItem.revision, criterionId: input.selectedReviewCriterion,
        decision: reviewDecision, comment: reviewComment.trim(),
      });
      else if (kind === 'CONFIRM_OVERALL_FOR_AEO' && overall) await canonicalHost.confirmIntegratedOverallForAeo(workItemId, {
        expectedRevision: page.workItem.revision, expectedOverallRevision: overall.revision,
        expectedOverallArtifactRef: overall.artifact.ref,
      });
      else await canonicalHost.generateAeoCandidate(workItemId);
      if (!current()) return;
      if (kind === 'REVIEW') { setReviewComment(''); setReviewPreviewOpen(false); }
      await input.onRefresh();
    } catch (reason: unknown) {
      if (!current()) return;
      const failure = reason as { statusCode?: number };
      const message: string = reason instanceof Error ? reason.message : 'ENGINEER_REVIEW_FAILED';
      if (failure.statusCode === 401) requireCanonicalHostClientAuthentication(input.sessionGeneration);
      else if ([403, 404].includes(failure.statusCode ?? 0)) input.onRejected?.(assessmentActionError(reason));
      if (/revision|conflict|409|version/iu.test(message)) setConflictMessage(message);
      else setAssessmentError(assessmentActionError(reason));
    } finally {
      if (current()) { setReviewSubmitting(false); setAssessmentAction(null); }
    }
  }

  return { assessmentAction, assessmentError, setAssessmentError, reviewDecision, setReviewDecision,
    reviewComment, setReviewComment, reviewSubmitting, reviewPreviewOpen, setReviewPreviewOpen,
    conflictMessage, setConflictMessage,
    recordEngineerReview: () => perform('REVIEW'),
    confirmOverallForAeo: () => perform('CONFIRM_OVERALL_FOR_AEO'),
    generateAeoCandidate: () => perform('GENERATE_AEO_CANDIDATE') };
}

export type DocumentAssessmentActions = ReturnType<typeof useDocumentAssessmentActions>;
