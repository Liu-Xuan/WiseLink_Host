import type { MineruReadingProjection } from './mineru-reading.interface';
import type { MineruRuntimeReadiness } from './mineru-runtime.interface';

export type DocumentParseStatus = 'RUNNING' | 'STAGING' | 'PUBLISHED' | 'FAILED';

export interface DocumentParseRunSummary {
  parseRunId: string;
  documentVersionId: string;
  parseRevision: number;
  status: DocumentParseStatus;
  verifiedArtifacts: number;
  errorCode: string | null;
  startedAt: string;
  deadlineAt: string;
  completedAt: string | null;
}

export interface DocumentParsingStatus {
  documentVersionId: string;
  originalFilename: string;
  latestRun: DocumentParseRunSummary | null;
  publishedRun: DocumentParseRunSummary | null;
  runtimeAvailable: boolean;
  runtime: MineruRuntimeReadiness;
}

export interface StartDocumentParseRequest {
  requestId: string;
  expectedPublishedRevision: number;
}

export interface DocumentParsedReading {
  documentVersionId: string;
  parseRunId: string;
  parseRevision: number;
  originalFilename: string;
  parser: { name: 'MinerU'; version: string; backend: string };
  titleEnhancement: { status: 'DISABLED' | 'NOT_APPLICABLE' | 'APPLIED' | 'FAILED'; code?: string };
  markdown: string;
  assets: Record<string, string>;
  projection: MineruReadingProjection;
}
