import type { ReviewTurnReadModel } from '@shared/api.interface';
import { reviewExecutionPresentation } from './review-execution';

export default function ReviewExecutionStatus({
  turn,
}: {
  turn: ReviewTurnReadModel;
}) {
  const execution = reviewExecutionPresentation(turn);
  return (
    <section
      className="review-execution"
      data-tone={execution.tone}
      aria-label={`回合 ${turn.turnNo} 执行状态`}
    >
      <div role="status" className="review-execution-summary">
        <strong>{execution.label}</strong>
        <span>{execution.description}</span>
        {execution.updatedAt ? (
          <small>状态更新于 {formatTime(execution.updatedAt)}</small>
        ) : null}
      </div>
      {execution.status || execution.errorCode ? (
        <details>
          <summary>执行记录</summary>
          <dl>
            <div>
              <dt>输入版本</dt>
              <dd>{turn.inputRevision}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{execution.status ?? '未返回'}</dd>
            </div>
            {execution.attemptRef ? (
              <div>
                <dt>操作记录</dt>
                <dd>{execution.attemptRef}</dd>
              </div>
            ) : null}
            {execution.requestedAt ? (
              <div>
                <dt>请求时间</dt>
                <dd>{formatTime(execution.requestedAt)}</dd>
              </div>
            ) : null}
            {execution.startedAt ? (
              <div>
                <dt>开始时间</dt>
                <dd>{formatTime(execution.startedAt)}</dd>
              </div>
            ) : null}
            {execution.completedAt ? (
              <div>
                <dt>结束时间</dt>
                <dd>{formatTime(execution.completedAt)}</dd>
              </div>
            ) : null}
            {execution.errorCode ? (
              <div>
                <dt>错误码</dt>
                <dd>{execution.errorCode}</dd>
              </div>
            ) : null}
            {execution.errorMessage ? (
              <div>
                <dt>失败原因</dt>
                <dd>{execution.errorMessage}</dd>
              </div>
            ) : null}
          </dl>
        </details>
      ) : null}
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { hour12: false });
}
