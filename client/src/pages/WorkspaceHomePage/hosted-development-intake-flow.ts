import type {
  CanonicalDevelopmentWorkItemRunRequest,
  CanonicalPdfVerticalRunResponse,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

export interface HostedUploadSelection {
  bucketId: string;
  filePath: string;
  developmentRunToken: string;
}

export type HostedIntakeSource<TFile = File> =
  | {
      kind: 'existing';
      selection: HostedUploadSelection;
    }
  | {
      kind: 'local';
      file: TFile;
      cachedUpload: HostedUploadSelection | null;
    };

export interface ResolvedHostedIntakeSelection<TFile = File> {
  selection: HostedUploadSelection;
  uploadedNow: boolean;
  localFile: TFile | null;
}

export async function resolveHostedIntakeSelection<TFile>(
  source: HostedIntakeSource<TFile>,
  dependencies: {
    createToken(): string;
    upload(
      file: TFile,
      token: string,
    ): Promise<{
      bucketId: string;
      filePath: string;
    }>;
  },
): Promise<ResolvedHostedIntakeSelection<TFile>> {
  if (source.kind === 'existing') {
    return {
      selection: source.selection,
      uploadedNow: false,
      localFile: null,
    };
  }

  if (source.cachedUpload) {
    return {
      selection: source.cachedUpload,
      uploadedNow: false,
      localFile: source.file,
    };
  }

  const uploadToken = dependencies.createToken();
  const uploaded = await dependencies.upload(source.file, uploadToken);
  return {
    selection: {
      ...uploaded,
      developmentRunToken: dependencies.createToken(),
    },
    uploadedNow: true,
    localFile: source.file,
  };
}

export function developmentWorkItemRequest(
  selection: HostedUploadSelection,
  modelRef?: string,
): CanonicalDevelopmentWorkItemRunRequest {
  return {
    selection: {
      bucketId: selection.bucketId,
      filePath: selection.filePath,
    },
    developmentRunToken: selection.developmentRunToken,
    query: 'applicability',
    ...(modelRef ? { modelRef } : {}),
  };
}

export interface HostedIntakeSubmissionGate {
  current: boolean;
}

export function beginHostedIntakeSubmission(
  gate: HostedIntakeSubmissionGate,
): boolean {
  if (gate.current) return false;
  gate.current = true;
  return true;
}

export function endHostedIntakeSubmission(
  gate: HostedIntakeSubmissionGate,
): void {
  gate.current = false;
}

/** Called only after the same-user readback has matched the submitted source. */
export function hostedIntakeCompletionError(
  status: CanonicalPdfVerticalRunResponse['status'],
  workItem: Pick<
    CanonicalWorkItemProjection,
    'phase' | 'failure' | 'recordingFailure'
  >,
): (Error & { recordedFailure?: true }) | null {
  if (
    status === 'CANDIDATE_VERTICAL_VERIFIED' &&
    workItem.phase === 'CANDIDATE_READBACK_VERIFIED'
  )
    return null;

  if (
    (status === 'FAILED' && workItem.phase === 'FAILED') ||
    (status === 'RECORDING_FAILED' && workItem.phase === 'RECORDING_FAILED')
  ) {
    const code =
      status === 'RECORDING_FAILED'
        ? 'CANONICAL_INTAKE_RECORDING_FAILED'
        : 'CANONICAL_INTAKE_PARSE_FAILED';
    return Object.assign(new Error(code), {
      code,
      recordedFailure: true as const,
      diagnosticCode: safeFailureCode(
        workItem.recordingFailure?.originalFailureCode ??
          workItem.failure?.failureCode,
      ),
    });
  }
  return new Error('CANONICAL_SAME_USER_READBACK_MISMATCH');
}

function safeFailureCode(value: unknown): string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.test(value)
    ? value
    : '';
}

export function hostedIntakeError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message.trim() : '';
  const error =
    typeof reason === 'object' && reason !== null
      ? (reason as {
          code?: unknown;
          statusCode?: unknown;
          diagnosticCode?: unknown;
        })
      : {};
  const code = typeof error.code === 'string' ? error.code : '';
  if (
    code === 'CANONICAL_INTAKE_RECORDING_FAILED' ||
    code === 'CANONICAL_INTAKE_PARSE_FAILED'
  ) {
    const diagnostic = safeFailureCode(error.diagnosticCode);
    const failure =
      code === 'CANONICAL_INTAKE_RECORDING_FAILED'
        ? '解析失败，且失败报告未能保存'
        : '解析失败';
    return `事项已登记，但${failure}${diagnostic ? `（${diagnostic}）` : ''}。请打开已登记事项查看失败详情并处理；此入口不会重复创建事项。`;
  }
  if (
    error.statusCode === 401 ||
    /CANONICAL_IDENTITY|LOGIN|OAUTH|401|UNAUTHORIZED/iu.test(message)
  ) {
    return '请先完成飞书授权，再上传并创建工程事项。';
  }
  if (error.statusCode === 403) {
    return '当前账户无权受理这份资料；请核对文件归属与访问权限，不会跳过授权核验。';
  }
  if (
    /^DM_PDF_(?:IDENTITY|FAMILY|VERSION_IDENTITY|TEXT_IDENTITY|PAGE_COUNT)/u.test(
      code,
    )
  ) {
    return `尚未从 PDF 正文核实出版物身份或版本（${code}）。请保留原文件并检查识别规则，不会用文件名代替正文证据。`;
  }
  if (/^DOCUMENT_STORAGE_(?:BUCKET|METADATA)_READ_FAILED$/u.test(code)) {
    return `受控文件空间核验失败（${code}），尚未完成受理；请保留已上传文件，待服务恢复后使用同一请求重试。`;
  }
  if (/SAME_USER_READBACK_MISMATCH/iu.test(message)) {
    return '文件已上传，但事项校验尚未完成。请保留当前文件后重试；未通过校验的结果不会作为当前事项。';
  }
  if (/BROWSER_(RANDOM_UUID|SHA256)_UNAVAILABLE/iu.test(message)) {
    return '当前浏览器缺少安全校验能力，请使用最新版飞书或受支持浏览器重试。';
  }
  return '工程事项创建失败，请保留当前文件后重试。';
}
