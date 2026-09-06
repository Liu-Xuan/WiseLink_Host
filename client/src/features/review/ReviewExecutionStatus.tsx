import type { ReviewTurnReadModel } from '@shared/api.interface';
import { reviewExecutionPresentation } from './review-execution';
import { reviewSourceRefLabel } from './continuous-review-state';

export default function ReviewExecutionStatus({
  turn,
  onLocateSourceRef,
}: {
  turn: ReviewTurnReadModel;
  onLocateSourceRef?: (sourceRef: string) => void;
}) {
  const execution = reviewExecutionPresentation(turn);
  const activity = turn.execution?.evidenceActivity;
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
      {activity ? (
        <details className="review-evidence-activity">
          <summary>取证活动 · {activity.items.length} 条</summary>
          <p>
            以下是 Host
            实际准备上下文与取回片段的记录，不代表模型已读全文、已引用或已正式采用。
          </p>
          {activity.error ? (
            <p role="alert">
              {activity.error.message}（{activity.error.code}）
            </p>
          ) : null}
          {activity.omittedEarlierCount > 0 ? (
            <p>
              显示最近 {activity.items.length} 条；另有{' '}
              {activity.omittedEarlierCount} 条更早记录保存在本回合。
            </p>
          ) : null}
          <ol>
            {activity.items.map((item, index) => (
              <li key={`${item.observedAt}-${index}`}>
                <strong>
                  {item.kind === 'CONTEXT_PREPARED'
                    ? '已准备本轮上下文'
                    : `已取回 ${item.sourceRefIds.length} 个片段`}
                </strong>
                <small>{formatTime(item.observedAt)}</small>
                {item.kind === 'CONTEXT_PREPARED' ? (
                  <p>
                    来源目录包含 {item.sourceCatalogCount}{' '}
                    项，可按问题继续取证。
                  </p>
                ) : null}
                {item.sourceRefIds.length ? (
                  <div className="review-evidence-source-links">
                    {item.sourceRefIds.map((ref, refIndex) =>
                      onLocateSourceRef ? (
                        <button
                          key={ref}
                          type="button"
                          title={ref}
                          onClick={() => onLocateSourceRef(ref)}
                        >
                          {reviewSourceRefLabel(ref, refIndex)}
                        </button>
                      ) : (
                        <span key={ref} title={ref}>
                          {reviewSourceRefLabel(ref, refIndex)}
                        </span>
                      ),
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : (
        <small>本回合尚无可读回的逐次取证记录。</small>
      )}
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
