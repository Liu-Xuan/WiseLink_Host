export const LIBRARY_PHASE_LABELS: Record<string, string> = {
  PARSE_REQUESTED: '等待解析',
  PARSING: '解析中',
  CANDIDATE_READBACK_VERIFIED: '候选待复核',
  FAILED: '解析失败',
  RECORDING_FAILED: '记录失败',
};

export function byteLabel(bytes: number): string {
  if (!Number.isFinite(bytes)) return '未返回';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes.toLocaleString('zh-CN')} 字节`;
}

export function documentLabel(document: {
  documentCode: string;
  originalFilename?: string;
}): string {
  return document.documentCode || document.originalFilename || '未命名工程资料';
}

export function libraryDateLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', { hour12: false })
    : value || '未标注';
}
