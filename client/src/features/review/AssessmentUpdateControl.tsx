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

  function buildPreview(): Preview {
    const turns = assessmentDiscussionTurns(props.conversation);
    return {
      conversation: props.conversation,
      turns,
      ids: turns.map((turn) => turn.reviewTurnId),
      scope: props.reviewScope ? { ...props.reviewScope } : undefined,
      modelRef: props.modelRef,
      modelLabel: props.modelLabel,
      selectedEvaluationItemId: props.selectedEvaluationItemId,
    };
  }

  function showPreview(): void {
    if (!pending) {
      setNotice('');
      setMustReopen(false);
      setPreview(buildPreview());
    }
    setOpen(true);
  }

  async function submit(): Promise<void> {
    const currentPreview = pending && preview ? preview : buildPreview();
    if (currentPreview.ids.length > 100) {
      setPreview(currentPreview);
      setNotice('待纳入讨论超过单次 100 条上限；本次未提交，也未截断内容。');
      setOpen(true);
      return;
    }
    if (submittingRef.current || props.disabled || mustReopen) return;
    setPreview(currentPreview);
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
          currentPreview.conversation,
          currentPreview.ids,
          currentPreview.modelRef,
          currentPreview.scope,
          currentPreview.selectedEvaluationItemId,
        );
      setPending(request);
      const response = await canonicalHost.appendReviewTextTurn(
        currentPreview.conversation.workItemId,
        currentPreview.conversation.reviewConversationId,
        request,
      );
      if (!current()) return;
      assertReviewConversationScope(
        response.conversation,
        currentPreview.conversation.workItemId,
        currentPreview.conversation.reviewScope ?? undefined,
      );
      props.onResult(response.conversation);
      setPending(null);
      setPreview(null);
      setOpen(false);
    } catch (reason) {
      if (current()) {
        setOpen(true);
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
        onClick={() => void submit()}
      >
        {submitting
          ? '正在请求更新…'
          : pending
            ? '重试更新评估'
            : '更新评估'}
      </Button>
      <div className="flex items-center gap-3 text-sm">
        <span>已保存的新讨论自动汇集。正式采用仍须单独确认。</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={submitting}
          onClick={showPreview}
        >
          查看本次输入
        </Button>
      </div>
      {preview ? (
        <AssessmentUpdatePreview
          open={open}
          onOpenChange={(value: boolean) => {
            if (!submitting) setOpen(value);
          }}
          turns={preview.turns}
          selectedIds={preview.ids}
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
              ? '范围已有新版本，点击更新时将自动使用当前版本。'
              : notice
          }
          disabled={
            props.disabled ||
            mustReopen ||
            submitting ||
            preview.ids.length > 100
          }
          onConfirm={() => void submit()}
        />
      ) : null}
      {changed && !pending ? (
        <p role="alert">范围已有新版本，点击更新时将自动使用当前版本。</p>
      ) : null}
      {preview && preview.ids.length > 100 ? (
        <p role="alert">
          待纳入讨论超过单次 100 条上限；本次未提交，也未截断内容。
        </p>
      ) : null}
    </div>
  );
}
