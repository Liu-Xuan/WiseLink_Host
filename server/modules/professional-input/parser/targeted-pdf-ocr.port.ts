import type {
  ParsedPdfLayout,
  ParsedPdfTextRun,
} from '../pure/professional-input-pure.types';

/** Private dependency of the one PdfLayoutExtractorPort composite. */
export interface PdfOcrTarget {
  targetId: string;
  page: number;
  reason: 'TEXT_LAYER_EMPTY' | 'UNRESOLVED_REQUIRED_RASTER_REGION';
  scope: 'FULL_PAGE' | 'RASTER_REGION';
  pdfUserSpaceBbox: readonly [number, number, number, number];
  requiredLanguages: readonly string[];
}

export interface PdfOcrConfidenceMetrics {
  characterWeightedMean: number;
  wordsBelow60Ratio: number;
  wordCount: number;
}

export interface PdfOcrTargetSuccess {
  targetId: string;
  page: number;
  status: 'EXTRACTED';
  lines: readonly ParsedPdfTextRun[];
  confidence: PdfOcrConfidenceMetrics;
}

export interface PdfOcrTargetFailure {
  targetId: string;
  page: number;
  status: 'FAILED';
  reason:
    | 'OCR_LANGUAGE_ASSET_MISSING'
    | 'OCR_RASTER_GEOMETRY_MISMATCH'
    | 'OCR_TARGET_RESULT_INCOMPLETE'
    | 'OCR_EMPTY_REQUIRED_REGION'
    | 'OCR_LOW_CONFIDENCE'
    | 'OCR_TSV_MALFORMED'
    | 'OCR_PROVIDER_TIMEOUT'
    | 'OCR_PROVIDER_FAILED';
  diagnostic: string;
  missingLanguages?: readonly string[];
}

export type PdfOcrTargetResult = PdfOcrTargetSuccess | PdfOcrTargetFailure;

export interface PdfOcrRuntimePreflight {
  status: 'READY' | 'UNAVAILABLE';
  providerId: string;
  rendererVersion: string | null;
  engineVersion: string | null;
  tessdataRevision: string | null;
  installedLanguages: readonly string[];
  missingLanguages: readonly string[];
  reasons: readonly string[];
}

export interface TargetedPdfOcrResult {
  sourceSha256: string;
  sourceByteLength: number;
  pageCount: number;
  providerId: string;
  targets: readonly PdfOcrTargetResult[];
}

export interface TargetedPdfOcrProvider {
  readonly providerId: string;
  preflight(): PdfOcrRuntimePreflight;
  recognize(input: {
    bytes: Uint8Array;
    layout: ParsedPdfLayout;
    targets: readonly PdfOcrTarget[];
  }): TargetedPdfOcrResult;
}
