import { useEffect, useId, useRef, useState } from 'react';
import { canonicalHost } from '@client/src/api';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import { Textarea } from '@client/src/components/ui/textarea';
import { createRequestCorrelationId } from '@client/src/utils/request-correlation-id';
import type {
  AppendMatterReviewScope,
  ReviewConversationReadModel,
} from '@shared/api.interface';
import { assertReviewConversationScope, sameReviewScope } from './review-scope';
import {
  automaticReviewAvailable,
  reviewChatSendIntent,
  type ReviewChatSendIntent,
} from './review-submission';
import { reviewOperationErrorPresentation } from './continuous-review-state';

interface Props {
  conversation: ReviewConversationReadModel;
  reviewScope?: AppendMatterReviewScope;
  message: string;
  pending: ReviewChatSendIntent | null;
  disabled: boolean;
  editorDisabled: boolean;
  onMessageChange(message: string): void;
  onPendingChange(pending: ReviewChatSendIntent | null): void;
  onBusy(busy: boolean): void;
  onResult(conversation: ReviewConversationReadModel): void;
  onError(reason: unknown): void;
}

/** Only CHAT is submitted here; assessment updates retain their own control. */
export default function ReviewChatComposer(props: Props) {
  const inputId = useId();
  const [submitting, setSubmitting] = useState(false);
  const sendingRef = useRef(false);
  const epochRef = useRef(0);
  useEffect(
    () => () => {
      epochRef.current += 1;
    },
    [],
  );

  const bound =
    !props.pending ||
    (props.pending.workItemId === props.conversation.workItemId &&
      props.pending.reviewConversationId ===
        props.conversation.reviewConversationId &&
      sameReviewScope(
        props.pending.request.reviewScope,
        props.conversation.reviewScope,
      ));
  // STALE_CONTEXT is a read projection of a stored ACTIVE conversation. The Host
  // checks the original requestId before freezing a new Matter basis. Keep its
  // current owner/OAuth/executor capability requirement; only an existing intent
  // can use this path, with its original body and identifier.
  const available =
    automaticReviewAvailable(props.conversation) ||
    Boolean(
      props.pending &&
      bound &&
      props.conversation.status === 'STALE_CONTEXT' &&
      props.conversation.automaticExecutionAvailable === true,
    );

  useEffect(() => {
    const pending = props.pending;
    if (
      !pending ||
      !bound ||
      !props.conversation.turns.some(
        (turn) =>
          turn.requestId === pending.request.requestId &&
          turn.purpose === 'CHAT' &&
          sameReviewScope(turn.reviewScope, pending.request.reviewScope),
      )
    )
      return;
    props.onPendingChange(null);
    if (props.message.trim() === pending.request.userMessage)
      props.onMessageChange('');
  }, [
    bound,
    props.pending,
    props.conversation,
    props.message,
    props.onPendingChange,
    props.onMessageChange,
  ]);

  async function send(): Promise<void> {
    if (
      sendingRef.current ||
      props.disabled ||
      !available ||
      !bound ||
      (!props.pending && !props.message.trim())
    )
      return;
    const epoch = epochRef.current;
    const session = getCanonicalHostClientSessionGeneration();
    const current = (): boolean =>
      epoch === epochRef.current &&
      session === getCanonicalHostClientSessionGeneration();
    sendingRef.current = true;
    setSubmitting(true);
    props.onBusy(true);
    try {
      const intent =
        props.pending ??
        reviewChatSendIntent(
          createRequestCorrelationId(),
          props.conversation,
          props.message,
          props.reviewScope,
        );
      // Retain the exact payload before I/O, including when the component unmounts.
      props.onPendingChange(intent);
      const response = await canonicalHost.appendReviewTextTurn(
        intent.workItemId,
        intent.reviewConversationId,
        intent.request,
      );
      if (!current()) return;
      assertReviewConversationScope(
        response.conversation,
        intent.workItemId,
        intent.request.reviewScope,
      );
      if (
        response.conversation.reviewConversationId !==
          intent.reviewConversationId ||
        response.turn.requestId !== intent.request.requestId ||
        response.turn.purpose !== 'CHAT' ||
        !sameReviewScope(response.turn.reviewScope, intent.request.reviewScope)
      )
        throw new Error('REVIEW_CHAT_RECEIPT_NOT_FOUND');
      props.onResult(response.conversation);
      props.onPendingChange(null);
      if (props.message.trim() === intent.request.userMessage)
        props.onMessageChange('');
    } catch (reason) {
      if (current()) {
        const failure = reviewOperationErrorPresentation(reason);
        if (
          !props.pending &&
          (failure.retryable === false ||
            /REVIEW_AUTOMATIC_EXECUTION_UNAVAILABLE|REVISION|STALE/u.test(
              failure.code ?? '',
            ))
        )
          props.onPendingChange(null);
        props.onError(reason);
      }
    } finally {
      sendingRef.current = false;
      if (current()) {
        setSubmitting(false);
        props.onBusy(false);
      }
    }
  }

  return (
    <div className="continuous-review-composer">
      <label htmlFor={inputId}>继续讨论</label>
      <Textarea
        id={inputId}
        aria-label="对话消息"
        maxLength={20000}
        value={props.pending?.request.userMessage ?? props.message}
        readOnly={Boolean(props.pending)}
        disabled={props.editorDisabled || submitting}
        onChange={(event) => props.onMessageChange(event.target.value)}
        placeholder="围绕当前资料提出问题，或补充需要核对的情况"
      />
      {props.pending && !submitting ? (
        <p role="status">
          {bound
            ? '上次发送结果未知，可重新读取或沿原请求号和原内容重试这条消息。'
            : '上次发送属于此前对话，请重新读取核对发送结果。'}
        </p>
      ) : null}
      {!available ? (
        <p role="status">当前事项暂不能自动回复，请重新读取以确认可用状态。</p>
      ) : null}
      <div className="continuous-review-compose-row">
        <Button
          type="button"
          disabled={
            props.disabled ||
            submitting ||
            !available ||
            !bound ||
            (!props.pending && !props.message.trim())
          }
          onClick={() => void send()}
        >
          {submitting
            ? '正在发送…'
            : props.pending
              ? '原样重试发送'
              : '发送消息'}
        </Button>
      </div>
    </div>
  );
}
