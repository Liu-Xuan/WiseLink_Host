import type { CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import type { DocumentReadingPreview } from '@shared/document-reading.interface';

type LibraryDocumentReading = NonNullable<DocumentReadingPreview['reading']>;
type LibraryDocumentReadingCoverage = LibraryDocumentReading['coverageStatus'];
type LibraryDocumentReadingSourceBinding = LibraryDocumentReading['sourceBinding'];

export const LIBRARY_PHASE_LABELS: Record<string, string> = {
  PARSE_REQUESTED: '等待解析',
  PARSING: '解析中',
  CANDIDATE_READBACK_VERIFIED: '解析已完成',
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

export function libraryVersionLabel(version: {
  businessRevision: string;
  sourceGeneratedDate?: string;
}): string {
  return (
    version.businessRevision ||
    (version.sourceGeneratedDate
      ? `生成日期 ${version.sourceGeneratedDate}`
      : '版本未标注')
  );
}

export type LibraryDocumentReadingStatus =
  | 'AVAILABLE'
  | 'SOURCE_CHANGED'
  | 'NOT_GENERATED'
  | 'NOT_RETURNED';

export interface LibraryDocumentReadingProjection {
  fileTitle: string;
  status: LibraryDocumentReadingStatus;
  headline: string | null;
  brief: string | null;
  criticalConditions: string[];
  limitations: string[];
  sourceLimitations: string[];
  coverageStatus: LibraryDocumentReadingCoverage | null;
  deliveredUnitCount: number | null;
  totalUnitCount: number | null;
  readingRunRef: string | null;
  readingRevision: number | null;
  sourceBinding: LibraryDocumentReadingSourceBinding | null;
  note: string;
  conditionLines: string[];
}

export function projectLibraryDocumentReading(
  version: CanonicalLibraryDocumentVersionSummary,
): LibraryDocumentReadingProjection {
  const metadataTitle =
    version.extractedMetadata?.title.observations
      .map((observation) => observation.value)
      .join('；')
      .trim() ?? '';
  const fileTitle =
    metadataTitle || version.originalFilename || '文件标题待核';
  const empty: LibraryDocumentReadingProjection = {
    fileTitle,
    status: 'NOT_RETURNED',
    headline: null,
    brief: null,
    criticalConditions: [],
    limitations: [],
    sourceLimitations: [],
    coverageStatus: null,
    deliveredUnitCount: null,
    totalUnitCount: null,
    readingRunRef: null,
    readingRevision: null,
    sourceBinding: null,
    note: '当前接口未返回该版本解读',
    conditionLines: [],
  };
  const preview: DocumentReadingPreview | undefined = version.documentReading;
  if (!preview) {
    return empty;
  }
  const binding: LibraryDocumentReadingSourceBinding | null =
    preview.reading?.sourceBinding ?? null;
  const provenance = {
    readingRunRef: preview.reading?.readingRunRef ?? null,
    readingRevision: preview.reading?.readingRevision ?? null,
    sourceBinding: binding,
  };
  if (preview.status === 'SOURCE_CHANGED') {
    return {
      ...empty,
      ...provenance,
      status: 'SOURCE_CHANGED',
      note: '来源已变化，已有解读不代表此版本认识',
    };
  }
  if (preview.status === 'NOT_GENERATED' || !preview.reading) {
    return {
      ...empty,
      ...provenance,
      status: 'NOT_GENERATED',
      note: '该版本尚无已保存解读',
    };
  }
  const reading = preview.reading;
  const conditionLines: string[] = [];
  if (reading.coverageStatus === 'PARTIAL_DELIVERY') {
    conditionLines.push(
      `部分覆盖：已送达 ${reading.deliveredUnitCount}/${reading.totalUnitCount}，仅代表已送达范围，不代表完整理解`,
    );
  }
  conditionLines.push(...reading.criticalConditions);
  conditionLines.push(...reading.limitations);
  for (const sourceLimitation of reading.sourceLimitations) {
    conditionLines.push(sourceLimitation);
  }
  return {
    fileTitle,
    status: 'AVAILABLE',
    headline: reading.headline,
    brief: reading.brief,
    criticalConditions: reading.criticalConditions,
    limitations: reading.limitations,
    sourceLimitations: reading.sourceLimitations,
    coverageStatus: reading.coverageStatus,
    deliveredUnitCount: reading.deliveredUnitCount,
    totalUnitCount: reading.totalUnitCount,
    ...provenance,
    note: '',
    conditionLines,
  };
}
