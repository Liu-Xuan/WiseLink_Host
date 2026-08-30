import type { ReviewConversationReadModel } from '@shared/api.interface';

export type ContinuousReviewState =
  | 'NOT_STARTED'
  | 'ACTIVE'
  | 'STALE_CONTEXT'
  | 'CLOSED';

export interface ContinuousReviewPresentation {
  state: ContinuousReviewState;
  stateLabel: string;
  stateClassName: '' | ' is-active' | ' is-stale' | ' is-closed';
  composerEnabled: boolean;
  canStartOrSync: boolean;
  contextTitle: string | null;
  contextMessage: string | null;
}

const NOT_STARTED: ContinuousReviewPresentation = {
  state: 'NOT_STARTED',
  stateLabel: '尚未开始',
  stateClassName: '',
  composerEnabled: false,
  canStartOrSync: true,
  contextTitle: null,
  contextMessage: null,
};

export function continuousReviewPresentation(
  conversation: ReviewConversationReadModel | null,
): ContinuousReviewPresentation {
  if (!conversation) return NOT_STARTED;

  if (conversation.status === 'CLOSED') {
    return {
      state: 'CLOSED',
      stateLabel: '本轮已结束',
      stateClassName: ' is-closed',
      composerEnabled: false,
      canStartOrSync: false,
      contextTitle: '本轮复核已结束',
      contextMessage: '讨论记录已保留，不能再补充或同步。',
    };
  }

  if (
    conversation.status === 'STALE_CONTEXT' ||
    !conversation.currentRevisionSynced
  ) {
    return {
      state: 'STALE_CONTEXT',
      stateLabel: '上下文待同步',
      stateClassName: ' is-stale',
      composerEnabled: false,
      canStartOrSync: true,
      contextTitle: '事项已更新',
      contextMessage: '请先同步讨论上下文，再基于最新事项继续补充。',
    };
  }

  return {
    state: 'ACTIVE',
    stateLabel: '讨论进行中',
    stateClassName: ' is-active',
    composerEnabled: true,
    canStartOrSync: false,
    contextTitle: null,
    contextMessage: null,
  };
}
