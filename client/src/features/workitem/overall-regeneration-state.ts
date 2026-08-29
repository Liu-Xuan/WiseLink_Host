import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalOverallRegenerationExecutionStatus,
  CanonicalOverallRegenerationReadModel,
  RequestCanonicalOverallRegenerationRequest,
} from '@shared/api.interface';

export type OverallRegenerationTone =
  | 'neutral'
  | 'progress'
  | 'success'
  | 'warning'
  | 'error';

export interface OverallRegenerationPresentation {
  label: string;
  message: string | null;
  tone: OverallRegenerationTone;
  busy: boolean;
  disabled: boolean;
  retryMode: 'none' | 'post' | 'poll' | 'new';
}

export interface StableOverallRegenerationRequest {
  workItemId: string;
  input: RequestCanonicalOverallRegenerationRequest;
  polling: boolean;
}

export interface OverallRegenerationWorkItemReset {
  request: null;
  view: OverallRegenerationPresentation;
}

export const OVERALL_REGENERATION_IDLE: OverallRegenerationPresentation = {
  label: '重新生成工程摘要',
  message: null,
  tone: 'neutral',
  busy: false,
  disabled: false,
  retryMode: 'none',
};

export function resetOverallRegenerationForWorkItem(): OverallRegenerationWorkItemReset {
  return {
    request: null,
    view: OVERALL_REGENERATION_IDLE,
  };
}

const ACTIVE_STATUSES = new Set<CanonicalOverallRegenerationExecutionStatus>([
  'REQUESTED',
  'QUEUED',
  'RUNNING',
  'RETRY_SCHEDULED',
  'COMMITTING',
]);

export function overallRegenerationInput(
  page: CanonicalDocumentParsingPageResponse,
  requestId: string,
  expectedWorkItemId?: string,
): RequestCanonicalOverallRegenerationRequest {
  if (
    expectedWorkItemId !== undefined &&
    page.workItem.workItemId !== expectedWorkItemId
  ) {
    throw new Error('OVERALL_REGENERATION_SOURCE_CONTEXT_CHANGED');
  }
  const source = page.workItem.source;
  const pkg = page.workItem.package;
  if (!pkg) throw new Error('OVERALL_REGENERATION_SOURCE_NOT_READY');
  return {
    requestId,
    expectedRevision: page.workItem.revision,
    sourceIdentity: {
      documentVersionId: source.documentVersionId,
      sourceArtifactId: source.sourceArtifactId,
      sourceFileSha256: source.sourceFileSha256,
      packageId: pkg.packageId,
      packageArtifactSha256: pkg.artifact.sha256,
    },
  };
}

export function isOverallRegenerationActive(
  status: CanonicalOverallRegenerationExecutionStatus,
): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function reusableOverallRegenerationRequest(
  stable: StableOverallRegenerationRequest | null,
  workItemId: string,
  retryMode: OverallRegenerationPresentation['retryMode'],
): StableOverallRegenerationRequest | null {
  if (retryMode !== 'post' && retryMode !== 'poll') return null;
  if (stable?.workItemId !== workItemId) return null;
  return stable;
}

export function overallRegenerationPresentation(
  regeneration: CanonicalOverallRegenerationReadModel,
): OverallRegenerationPresentation {
  switch (regeneration.status) {
    case 'REQUESTED':
      return progress('正在提交工程摘要任务…');
    case 'QUEUED':
      return progress('任务已排队，等待开始处理…');
    case 'RUNNING':
      return progress('正在结合当前原文依据生成工程摘要…');
    case 'RETRY_SCHEDULED':
      return progress('处理暂未完成，系统将继续尝试…');
    case 'COMMITTING':
      return progress('摘要已形成，正在保存并核对最新版本…');
    case 'SUCCEEDED':
      return {
        label: '工程摘要已更新',
        message: '新的候选工程摘要已形成，等待工程师复核。',
        tone: 'success',
        busy: false,
        disabled: true,
        retryMode: 'none',
      };
    case 'WAITING_INPUT':
      return {
        label: '仍需补充资料',
        message:
          '当前还缺少受控资料；系统已保留现有结果，不会把缺失信息当作完成。',
        tone: 'warning',
        busy: false,
        disabled: true,
        retryMode: 'none',
      };
    case 'CONFLICT':
    case 'OBSOLETE':
      return {
        label: '刷新后重试',
        message: '事项已产生新版本，请刷新当前资料后重新生成。',
        tone: 'warning',
        busy: false,
        disabled: false,
        retryMode: 'new',
      };
    case 'FAILED':
    case 'TIMED_OUT':
    case 'CANCELLED':
      return {
        label: '重新尝试',
        message: '本次生成未完成；现有结果没有被改写，可基于最新资料重新尝试。',
        tone: 'error',
        busy: false,
        disabled: false,
        retryMode: 'new',
      };
  }
}

export function overallRegenerationClientFailure(input: {
  hasStableRequest: boolean;
  polling: boolean;
  conflict: boolean;
  sourceUnavailable: boolean;
}): OverallRegenerationPresentation {
  if (input.conflict) {
    return {
      label: '刷新后重试',
      message: '事项已产生新版本，请刷新当前资料后重新生成。',
      tone: 'warning',
      busy: false,
      disabled: false,
      retryMode: 'new',
    };
  }
  if (input.sourceUnavailable) {
    return {
      label: '暂不能重新生成',
      message: '当前解析资料尚未就绪，请先完成原文解析。',
      tone: 'warning',
      busy: false,
      disabled: true,
      retryMode: 'none',
    };
  }
  if (input.hasStableRequest) {
    return {
      label: input.polling ? '继续检查进度' : '重试提交',
      message: input.polling
        ? '暂时无法读取进度；继续检查不会重复创建任务。'
        : '提交结果暂未确认；重试会沿用同一次请求，不会重复创建任务。',
      tone: 'error',
      busy: false,
      disabled: false,
      retryMode: input.polling ? 'poll' : 'post',
    };
  }
  return {
    label: '重新尝试',
    message: '暂时无法发起生成，请稍后重试。',
    tone: 'error',
    busy: false,
    disabled: false,
    retryMode: 'new',
  };
}

function progress(message: string): OverallRegenerationPresentation {
  return {
    label: '正在重新生成…',
    message,
    tone: 'progress',
    busy: true,
    disabled: true,
    retryMode: 'none',
  };
}
