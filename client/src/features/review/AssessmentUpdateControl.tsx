import { useEffect, useRef, useState } from 'react';
import type {
  AppendMatterReviewScope,
  AppendReviewTextTurnRequest,
  ReviewConversationReadModel,
  ReviewTurnReadModel,
} from '@shared/api.interface';
import { canonicalHost } from '@client/src/api';
import { Button } from '@client/src/components/ui/button';
import { createRequestCorrelationId } from '@client/src/utils/request-correlation-id';
import { assertReviewConversationScope } from './review-scope';
import {
  assessmentDiscussionTurns,
  assessmentUpdateRequest,
} from './review-submission';
import AssessmentUpdatePreview from './AssessmentUpdatePreview';
import { reviewOperationErrorPresentation } from './continuous-review-state';

interface Props {
  conversation: ReviewConversationReadModel;
  reviewScope?: AppendMatterReviewScope;
  selectedEvaluationItemId: string | null;
  modelRef?: string;
  modelLabel: string;
  disabled: boolean;
  hasUnsentDraft: boolean;
  materialTitle?: string;
  documentVersionId?: string;
  onBusy(busy: boolean): void;
  onResult(conversation: ReviewConversationReadModel): void;
  onError(reason: unknown): void;
}

interface Preview {
  conversation: ReviewConversationReadModel;
  turns: ReviewTurnReadModel[];
  ids: string[];
  scope?: AppendMatterReviewScope;
  modelRef?: string;
  modelLabel: string;
  selectedEvaluationItemId: string | null;
}

export default function AssessmentUpdateControl(props: Props) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState<AppendReviewTextTurnRequest | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [mustReopen, setMustReopen] = useState(false);
  const epoch = useRef(0);
  const submittingRef = useRef(false);
  useEffect(
    () => () => {
      epoch.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (
      pending &&
      props.conversation.turns.some(
        (turn: ReviewTurnReadModel) => turn.requestId === pending.requestId,
      )
    ) {
      setPending(null);
      setPreview(null);
      setOpen(false);
    }
  }, [pending, props.conversation]);
  const changed: boolean = Boolean(
    preview &&
    (preview.conversation.currentWorkItemRevision !==
      props.conversation.currentWorkItemRevision ||
      preview.scope?.expectedWorkingRevision !==
        props.reviewScope?.expectedWorkingRevision),
  );

  function showPreview(): void {
    if (!pending) {
      setNotice('');
      setMustReopen(false);
      const turns: ReviewTurnReadModel[] = assessmentDiscussionTurns(
        props.conversation,
      );
      setPreview({
        conversation: props.conversation,
        turns,
        ids: turns
          .slice(0, 100)
          .map((turn: ReviewTurnReadModel) => turn.reviewTurnId),
        scope: props.reviewScope ? { ...props.reviewScope } : undefined,
        modelRef: props.modelRef,
        modelLabel: props.modelLabel,
        selectedEvaluationItemId: props.selectedEvaluationItemId,
      });
    }
    setOpen(true);
  }

  async function submit(): Promise<void> {
    if (
      !preview ||
      submittingRef.current ||
      props.disabled ||
      mustReopen ||
      (!pending && changed) ||
      preview.ids.length > 100
    )
      return;
    const requestEpoch: number = epoch.current;
    submittingRef.current = true;
    const session: number =
      canonicalHost.getCanonicalHostClientSessionGeneration();
    const current = (): boolean =>
      requestEpoch === epoch.current &&
      session === canonicalHost.getCanonicalHostClientSessionGeneration();
    setSubmitting(true);
    props.onBusy(true);
    try {
      const request: AppendReviewTextTurnRequest =
        pending ??
        assessmentUpdateRequest(
          createRequestCorrelationId(),
          preview.conversation,
          preview.ids,
          preview.modelRef,
          preview.scope,
          preview.selectedEvaluationItemId,
        );
      setPending(request);
      const response = await canonicalHost.appendReviewTextTurn(
        preview.conversation.workItemId,
        preview.conversation.reviewConversationId,
        request,
      );
      if (!current()) return;
      assertReviewConversationScope(
        response.conversation,
        preview.conversation.workItemId,
        preview.conversation.reviewScope ?? undefined,
      );
      props.onResult(response.conversation);
      setPending(null);
      setPreview(null);
      setOpen(false);
    } catch (reason) {
      if (current()) {
        const failure = reviewOperationErrorPresentation(reason);
        setNotice(`${failure.message} 错误码：${failure.code ?? '未返回'}。`);
        if (
          failure.retryable === false ||
          /REVISION|STALE|CONFLICT/u.test(failure.code ?? '')
        ) {
          setPending(null);
          setMustReopen(true);
          setNotice(
            `${failure.message} 请关闭预览，重新读取并核对范围后再提交。`,
          );
        }
        props.onError(reason);
      }
    } finally {
      submittingRef.current = false;
      if (current()) {
        setSubmitting(false);
        props.onBusy(false);
      }
    }
  }

  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={props.disabled || submitting}
        onClick={showPreview}
      >
        {submitting
          ? '正在请求更新…'
          : pending
            ? '核对更新评估请求'
            : '更新评估'}
      </Button>
      <small>先自由讨论；点击更新评估才重算。正式采用仍须单独确认。</small>
      {preview ? (
        <AssessmentUpdatePreview
          open={open}
          onOpenChange={(value: boolean) => {
            if (!submitting) setOpen(value);
          }}
          turns={preview.turns}
          selectedIds={preview.ids}
          onSelectionChange={(ids: string[]) => {
            if (!pending) setPreview({ ...preview, ids });
          }}
          revision={preview.conversation.currentWorkItemRevision}
          workingRevision={preview.scope?.expectedWorkingRevision}
          materialTitle={props.materialTitle}
          documentVersionId={props.documentVersionId}
          modelLabel={preview.modelLabel}
          focusLabel={
            preview.scope
              ? `事项 ${preview.scope.matterId}${preview.scope.targetClaimId ? ` · 问题 ${preview.scope.targetClaimId}` : ' · 当前事项'}`
              : `${preview.conversation.workItemId}${preview.selectedEvaluationItemId ? ` · 评估项 ${preview.selectedEvaluationItemId}` : ' · 当前任务'}`
          }
          hasUnsentDraft={props.hasUnsentDraft}
          pending={Boolean(pending)}
          notice={
            changed && !pending
              ? '范围版本已变化，请关闭预览后重新打开核对。'
              : notice
          }
          disabled={
            props.disabled ||
            mustReopen ||
            submitting ||
            (!pending && changed) ||
            preview.ids.length > 100
          }
          onConfirm={() => void submit()}
        />
      ) : null}
      {changed && !pending ? (
        <p role="alert">范围版本已变化，请关闭预览后重新打开核对。</p>
      ) : null}
      {preview && preview.ids.length > 100 ? (
        <p role="alert">单次最多纳入 100 条对话，请减少选择。</p>
      ) : null}
    </div>
  );
}
