import type {
  CanonicalOverallRegenerationExecutionStatus,
  ReviewTurnReadModel,
} from '@shared/api.interface';

interface ExecutionCopy {
  label: string;
  description: string;
  tone: 'neutral' | 'progress' | 'warning' | 'error' | 'success';
  active: boolean;
}

export interface ReviewExecutionPresentation extends ExecutionCopy {
  status: CanonicalOverallRegenerationExecutionStatus | null;
  attemptRef: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

const EXECUTION_COPY: Record<
  CanonicalOverallRegenerationExecutionStatus,
  ExecutionCopy
> = {
  REQUESTED: {
    label: '已请求执行',
    description: '执行请求已保存，等待开始。',
    tone: 'progress',
    active: true,
  },
  QUEUED: {
    label: '排队等待',
    description: '本回合已进入队列，尚未开始执行。',
    tone: 'progress',
    active: true,
  },
  RUNNING: {
    label: '正在执行',
    description: '系统正在处理本回合，具体读取活动尚未返回。',
    tone: 'progress',
    active: true,
  },
  RETRY_SCHEDULED: {
    label: '等待重试',
    description: '系统已安排重试，尚未重新开始。',
    tone: 'progress',
    active: true,
  },
  COMMITTING: {
    label: '正在保存结果',
    description: '本回合结果正在保存，尚未读回完成结果。',
    tone: 'progress',
    active: true,
  },
  SUCCEEDED: {
    label: '执行已完成',
    description: '本回合执行已结束；候选结果仍需工程师核对。',
    tone: 'success',
    active: false,
  },
  WAITING_INPUT: {
    label: '等待补充信息',
    description: '请查看本回合缺失输入，补充信息后继续讨论。',
    tone: 'warning',
    active: false,
  },
  FAILED: {
    label: '执行失败',
    description: '本回合未能完成，已保存的输入仍可查看。',
    tone: 'error',
    active: false,
  },
  TIMED_OUT: {
    label: '执行超时',
    description: '本回合执行已超时，输入和已有结果保留。',
    tone: 'error',
    active: false,
  },
  CANCELLED: {
    label: '执行已取消',
    description: '本回合已停止执行，输入记录保留。',
    tone: 'neutral',
    active: false,
  },
  CONFLICT: {
    label: '版本冲突',
    description: '执行结果与当前版本冲突，请重新读取并核对上下文。',
    tone: 'warning',
    active: false,
  },
  OBSOLETE: {
    label: '执行已过期',
    description: '本回合基于旧上下文，不能视作当前版本的结果。',
    tone: 'warning',
    active: false,
  },
};

/** Display-only adapter for optional Host execution readback; never infers activity from age. */
export function reviewExecutionPresentation(
  turn: ReviewTurnReadModel,
): ReviewExecutionPresentation {
  // Older Hosts and this independently cherry-pickable client baseline may omit execution.
  const raw = 'execution' in turn ? turn.execution : undefined;
  const execution = record(raw);
  const reportedStatus = stringField(execution, 'status');
  const status =
    reportedStatus &&
    Object.prototype.hasOwnProperty.call(EXECUTION_COPY, reportedStatus)
      ? (reportedStatus as CanonicalOverallRegenerationExecutionStatus)
      : null;
  const error = record(execution?.error);
  const copy: ExecutionCopy = status
    ? EXECUTION_COPY[status]
    : {
        label: raw === null ? '尚未请求执行' : '未返回执行状态',
        description:
          raw === null
            ? '当前回合没有已记录的执行请求。'
            : '当前服务未返回可识别的执行记录，不能据此判断是否正在运行。',
        tone: 'neutral',
        active: false,
      };
  return {
    ...copy,
    ...(status === 'SUCCEEDED' && !turn.assistantCandidate
      ? {
          description: '执行已完成，但候选尚未读回；可重新读取讨论查看结果。',
        }
      : {}),
    status,
    attemptRef: stringField(execution, 'attemptRef'),
    requestedAt: stringField(execution, 'requestedAt'),
    startedAt: stringField(execution, 'startedAt'),
    updatedAt: stringField(execution, 'updatedAt'),
    completedAt: stringField(execution, 'completedAt'),
    errorCode: stringField(error, 'code'),
    errorMessage: stringField(error, 'message'),
  };
}

export function reviewConversationHasActiveExecution(
  turns: ReviewTurnReadModel[],
): boolean {
  return turns.some((turn) => reviewExecutionPresentation(turn).active);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  value: Record<string, unknown> | null,
  key: string,
): string | null {
  const field = value?.[key];
  return typeof field === 'string' && field.trim() ? field.trim() : null;
}
