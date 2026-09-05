import type {
  ReviewConversationReadModel,
  ReviewTurnReadModel,
} from '@shared/api.interface';

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

export interface ReviewTurnGroups {
  current: ReviewTurnReadModel | null;
  history: ReviewTurnReadModel[];
}

export interface ReviewOperationErrorPresentation {
  title: string;
  message: string;
  code: string | null;
  retryable: boolean | null;
  operatorAction: string | null;
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

export function reviewTurnGroups(
  turns: ReviewTurnReadModel[],
): ReviewTurnGroups {
  const ordered = [...turns].sort((left, right) => left.turnNo - right.turnNo);
  return {
    current: ordered.at(-1) ?? null,
    history: ordered.slice(0, -1),
  };
}

export function shouldAutoRefreshReviewTurn(
  _turn: ReviewTurnReadModel,
  _now = Date.now(),
): boolean {
  /* ReviewTurn 目前没有 Host-owned executionState。缺少候选只表示“尚未读回”，
   * 不能凭 createdAt + 五分钟窗口伪装成正在运行。待 Host 提供真实状态后再轮询。 */
  return false;
}

export function reviewSourceRefLabel(sourceRef: string, index: number): string {
  const normalized = sourceRef.trim();
  if (!normalized) return `SourceRef ${index + 1}`;
  if (normalized.length <= 42) return normalized;
  return `${normalized.slice(0, 23)}…${normalized.slice(-12)}`;
}

export function reviewOperationErrorPresentation(
  reason: unknown,
): ReviewOperationErrorPresentation {
  const error = errorRecord(reason);
  const message = errorMessage(reason);
  const code = recordString(error, 'code');
  const statusCode = recordNumber(error, 'statusCode');
  const searchable = `${code ?? ''} ${message} ${statusCode ?? ''}`;
  let userMessage = '本次复核操作未完成，当前输入仍保留。';
  if (/LOGIN|IDENTITY|OAUTH|UNAUTHORIZED|401/iu.test(searchable)) {
    userMessage = '请先完成飞书授权，再继续当前复核。';
  } else if (/NOT_FOUND|FORBIDDEN|403|404/iu.test(searchable)) {
    userMessage = '当前事项或复核讨论不可用，请返回资料库重新进入。';
  } else if (/REVISION|STALE|CONFLICT|409/iu.test(searchable)) {
    userMessage = '事项已经更新，请重新读取并同步到最新版本。';
  } else if (/ATTACHMENT/iu.test(searchable)) {
    userMessage = '补充资料未能受控接入，请保留文件并重试。';
  } else if (/BROWSER_RANDOM_UUID_UNAVAILABLE/iu.test(searchable)) {
    userMessage =
      '当前浏览器缺少安全请求标识能力，请使用受支持的飞书客户端或浏览器。';
  }
  return {
    title: '复核操作未完成',
    message: userMessage,
    code,
    retryable: recordBoolean(error, 'retryable'),
    operatorAction: recordString(error, 'operatorAction'),
  };
}

function errorRecord(reason: unknown): Record<string, unknown> | null {
  return typeof reason === 'object' && reason !== null
    ? (reason as Record<string, unknown>)
    : null;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason ?? '');
}

function recordString(
  value: Record<string, unknown> | null,
  key: string,
): string | null {
  const candidate = value?.[key];
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : null;
}

function recordNumber(
  value: Record<string, unknown> | null,
  key: string,
): number | null {
  const candidate = value?.[key];
  return typeof candidate === 'number' ? candidate : null;
}

function recordBoolean(
  value: Record<string, unknown> | null,
  key: string,
): boolean | null {
  const candidate = value?.[key];
  return typeof candidate === 'boolean' ? candidate : null;
}
