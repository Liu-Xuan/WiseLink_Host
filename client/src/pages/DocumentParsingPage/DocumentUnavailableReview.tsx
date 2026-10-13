import { useCallback, useEffect, useRef, useState } from 'react';

import { canonicalHost } from '@client/src/api';
import { Button } from '@client/src/components/ui/button';
import ReviewConversationTurn from '@client/src/features/review/ReviewConversationTurn';
import {
  reviewErrorRevokesReadback,
  reviewOperationErrorPresentation,
  reviewReadbackMessage,
  reviewTurnGroups,
} from '@client/src/features/review/continuous-review-state';
import type {
  CurrentReviewConversationResponse,
  ReviewTurnReadModel,
} from '@shared/api.interface';
import { runSavedReviewReadback } from './saved-review-readback';

import '@client/src/features/review/continuous-review-panel.css';

interface DocumentUnavailableReviewProps {
  workItemId: string;
  sessionGeneration: number;
  onRetryDocument(): void;
  onBack(): void;
}

export default function DocumentUnavailableReview({
  workItemId,
  sessionGeneration,
  onRetryDocument,
  onBack,
}: DocumentUnavailableReviewProps) {
  const [readback, setReadback] =
    useState<CurrentReviewConversationResponse | null>(null);
  const [reading, setReading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const readEpoch = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const epoch: number = ++readEpoch.current;
    setReading(true);
    await runSavedReviewReadback({
      workItemId,
      isCurrent: () =>
        readEpoch.current === epoch &&
        canonicalHost.getCanonicalHostClientSessionGeneration() ===
          sessionGeneration,
      read: canonicalHost.getCurrentReviewConversation,
      onFresh: (response: CurrentReviewConversationResponse) => {
        setReadback(response);
        setError(null);
      },
      onError: (cause: unknown) => {
        if (reviewErrorRevokesReadback(cause)) setReadback(null);
        setError(cause);
      },
      onSettled: () => setReading(false),
    });
  }, [sessionGeneration, workItemId]);

  useEffect(() => {
    void reload();
    return () => {
      readEpoch.current += 1;
    };
  }, [reload]);

  return (
    <SavedReviewReadbackView
      readback={readback}
      reading={reading}
      error={error}
      onReload={() => void reload()}
      onRetryDocument={onRetryDocument}
      onBack={onBack}
    />
  );
}

export function SavedReviewReadbackView({
  readback,
  reading,
  error,
  onReload,
  onRetryDocument,
  onBack,
}: {
  readback: CurrentReviewConversationResponse | null;
  reading: boolean;
  error: unknown;
  onReload(): void;
  onRetryDocument(): void;
  onBack(): void;
}) {
  const denied: boolean = reviewErrorRevokesReadback(error);
  const conversation = denied ? null : readback?.conversation;
  const turns = reviewTurnGroups(conversation?.turns ?? []);
  const ordered: ReviewTurnReadModel[] = turns.current
    ? [turns.current, ...turns.history.slice().reverse()]
    : [];
  const readbackMessage: string | null = readback
    ? reviewReadbackMessage(reading, error !== null)
    : null;
  const failure = error
    ? reviewOperationErrorPresentation(error, 'refresh')
    : null;

  return (
    <main className="parse-shell parse-saved-review">
      <section className="continuous-review" aria-label="已保存讨论与执行记录">
        <header className="continuous-review-header">
          <div>
            <h1>{denied ? '当前事项不可访问' : '原文暂时无法读取'}</h1>
            <p role="alert">
              {denied
                ? '当前事项不可访问。'
                : '原文与来源定位暂不可用，可继续查看已保存讨论。'}
            </p>
          </div>
          <div className="continuous-review-toolbar">
            <Button type="button" variant="outline" onClick={onBack}>
              返回资料库
            </Button>
            {!denied ? (
              <Button type="button" variant="outline" onClick={onRetryDocument}>
                重新读取原文
              </Button>
            ) : null}
            <Button type="button" disabled={reading} onClick={onReload}>
              {reading ? '正在读取讨论…' : '重新读取讨论'}
            </Button>
          </div>
        </header>
        {!denied ? (
          <>
            {readback ? (
              <p>讨论接口读回的事项版本 {readback.currentWorkItemRevision}</p>
            ) : null}
            {readbackMessage ? <p role="status">{readbackMessage}</p> : null}
            {reading && !readback ? (
              <p role="status">正在独立读取已保存讨论与执行记录…</p>
            ) : null}
            {conversation && readback ? (
              <div className="continuous-review-turns">
                {ordered.map((turn: ReviewTurnReadModel, index: number) => (
                  <div key={turn.reviewTurnId}>
                    <div className="continuous-review-current-label">
                      <span>{index === 0 ? '最近保存回合' : '历史回合'}</span>
                      <strong>Turn {turn.turnNo}</strong>
                    </div>
                    <ReviewConversationTurn
                      readOnly
                      turn={turn}
                      conversation={conversation}
                      currentRevision={readback.currentWorkItemRevision}
                      isCurrent={index === 0}
                    />
                  </div>
                ))}
                {!ordered.length ? <p>当前讨论没有已保存回合。</p> : null}
              </div>
            ) : readback ? (
              <p>独立接口未返回已保存讨论。</p>
            ) : null}
          </>
        ) : null}
        {failure ? (
          <div className="continuous-review-error" role="alert">
            <div>
              <strong>{failure.title}</strong>
              <span>{failure.message}</span>
              <span>错误码：{failure.code ?? '未返回'}</span>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
