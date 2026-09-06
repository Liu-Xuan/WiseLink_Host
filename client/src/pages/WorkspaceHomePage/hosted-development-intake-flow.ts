import type { CanonicalDevelopmentWorkItemRunRequest } from '@shared/api.interface';

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

export function hostedIntakeError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message.trim() : '';
  const error =
    typeof reason === 'object' && reason !== null
      ? (reason as { code?: unknown; statusCode?: unknown })
      : {};
  const code = typeof error.code === 'string' ? error.code : '';
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
