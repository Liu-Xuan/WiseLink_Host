import type { TranslationStructuredSource } from './canonical-translation-v2.interface';

/** Exact Host identities; extraction and translation cannot manufacture these. */
export interface DocumentOriginalBinding {
  documentVersionId: string;
  parseRunId: string;
  parseRevision: number;
  sourceArtifactId: string;
  sourceSha256: string;
  sourceByteLength: number;
}

export interface DocumentOriginalCoverage {
  knownPageCount: number | null;
  /** Zero-based physical PDF pages. A read text layer does not imply understood figures. */
  readPageIndexes: number[];
  unresolvedRanges: Array<{
    pageIndexes: number[];
    unitIds: string[];
    reason: 'UNREAD' | 'TEXT_CONFLICT' | 'STRUCTURE_UNCERTAIN' | 'FIGURE_UNINTERPRETED';
    message: string;
  }>;
}

export interface DocumentOriginalResult {
  schemaVersion: 'wiselink.document.original.v1';
  binding: DocumentOriginalBinding;
  producer: {
    kind: 'OFFICIAL_PLUGIN_HYBRID';
    instanceId: string;
    pluginVersion: string;
    actionKey: string;
    concreteModel: string | null;
    extractedAt: string | null;
  };
  /** Reuses the V2 source vocabulary, including native selectors and full grid cells. */
  source: TranslationStructuredSource;
  locations: Array<{
    sourceRefId: string;
    precision: 'TEXT_ITEM' | 'PAGE' | 'NATIVE_SELECTOR' | 'UNRESOLVED';
    coordinateSpace: 'PDF_VIEWPORT_TOP_LEFT' | null;
    pageIndex: number | null;
    viewportWidth: number | null;
    viewportHeight: number | null;
    boxes: Array<[number, number, number, number]>;
  }>;
  coverage: DocumentOriginalCoverage;
  markdown: string;
}

/** Invoked only after M has claimed and authorized the existing durable parse run. */
export interface DocumentOriginalStepInput {
  binding: DocumentOriginalBinding;
  expectedPublishedRevision: number;
  parseRunId: string;
}
export interface DocumentOriginalStepResult {
  parseRunId: string;
  parseRevision: number;
  status: 'STAGING' | 'PUBLISHED';
  coverage: DocumentOriginalCoverage;
  changedUnitIds: string[];
  changedSourceRefIds?: string[];
  previousParseRunId?: string | null;
  changeKind: 'INITIAL' | 'LOCATOR_ONLY' | 'SOURCE_CONTENT' | 'IMPACT_UNRESOLVED';
}

/** Generic file descriptor; roles reused by parseRun JSONB without MinerU payloads. */
export interface DocumentOriginalArtifact {
  role: 'RAW_MARKDOWN' | 'MANIFEST';
  relativePath: string;
  bucketId: string;
  filePath: string;
  providerObjectId: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  readback: 'UPLOADED' | 'VERIFIED';
}
