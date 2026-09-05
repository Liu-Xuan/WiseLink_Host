import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reviewUiTurn } from './fixtures/review-ui';
import {
  reviewConversationHasActiveExecution,
  reviewExecutionPresentation,
} from '../../client/src/features/review/review-execution';
import ReviewExecutionStatus from '../../client/src/features/review/ReviewExecutionStatus';
import { shouldAutoRefreshReviewTurn } from '../../client/src/features/review/continuous-review-state';

describe('Host review execution readback', () => {
  it.each(['REQUESTED', 'QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'])(
    'polls a persisted %s even after five minutes, without inventing a deadline',
    (status) => {
      const turn = Object.assign(reviewUiTurn(), {
        execution: execution(status),
      });
      expect(shouldAutoRefreshReviewTurn(turn, Date.now() + 600_000)).toBe(
        true,
      );
    },
  );

  it.each([
    'SUCCEEDED',
    'WAITING_INPUT',
    'FAILED',
    'TIMED_OUT',
    'CANCELLED',
    'CONFLICT',
    'OBSOLETE',
  ])('stops polling the terminal or input-waiting %s record', (status) => {
    expect(
      shouldAutoRefreshReviewTurn(
        Object.assign(reviewUiTurn(), { execution: execution(status) }),
      ),
    ).toBe(false);
  });

  it('does not manufacture execution for legacy, null or future unrecognized states', () => {
    const legacy = reviewUiTurn();
    expect(reviewExecutionPresentation(legacy)).toMatchObject({
      status: null,
      active: false,
      label: '未返回执行状态',
    });
    expect(
      reviewExecutionPresentation(
        Object.assign(reviewUiTurn(), { execution: null }),
      ),
    ).toMatchObject({ status: null, active: false, label: '尚未请求执行' });
    expect(
      reviewExecutionPresentation(
        Object.assign(reviewUiTurn(), { execution: execution('FUTURE_STATE') }),
      ),
    ).toMatchObject({ status: null, active: false });
  });

  it('continues reading an older running turn when a newer saved turn has no execution', () => {
    const running = Object.assign(reviewUiTurn(1), {
      execution: execution('RUNNING'),
    });
    const latest = Object.assign(reviewUiTurn(2), { execution: null });
    expect(reviewConversationHasActiveExecution([running, latest])).toBe(true);
    expect(reviewConversationHasActiveExecution([latest])).toBe(false);
  });

  it('distinguishes an execution success from a candidate that has actually been read back', () => {
    const turn = Object.assign(reviewUiTurn(), {
      execution: execution('SUCCEEDED'),
    });
    const html = renderToStaticMarkup(
      createElement(ReviewExecutionStatus, { turn }),
    );
    expect(html).toContain('执行已完成，但候选尚未读回');
    expect(html).not.toContain('候选已生成');
    expect(html).not.toContain('已采用');
  });

  it('renders only real failure details and timestamps, and keeps candidate content independently available', () => {
    const turn = Object.assign(reviewUiTurn(1, true), {
      execution: {
        ...execution('FAILED'),
        error: { code: 'TOOL_UNAVAILABLE', message: '授权查询暂不可用。' },
      },
    });
    const html = renderToStaticMarkup(
      createElement(ReviewExecutionStatus, { turn }),
    );
    expect(html).toContain('执行失败');
    expect(html).toContain('TOOL_UNAVAILABLE');
    expect(html).toContain('授权查询暂不可用。');
    expect(html).toContain('ATT-TEST');
    expect(html).not.toContain('开始时间');
    expect(turn.assistantCandidate?.answer).toBe('保留已有候选，等待核对。');
  });
});

function execution(status: string) {
  return {
    status,
    attemptRef: 'ATT-TEST',
    requestedAt: '2026-09-05T03:00:00Z',
    startedAt: null,
    updatedAt: '2026-09-05T03:01:00Z',
    completedAt: null,
    error: null,
  };
}
