/**
 * Core data contracts for the professional-input pure pipeline:
 *
 *   PDF bytes -> ParsedLayout -> SourceUnitSet -> StructuredParsePackage
 *             -> U0 strict validation input
 *
 * Every type here is a plain serializable value. The pipeline that produces
 * them is deterministic: identical bytes and identical declared inputs yield
 * identical ids and hashes, and SourceRef provenance is preserved through
 * every stage.
 */

export const PROFESSIONAL_INPUT_PURE_CONTRACT_ID =
  'techpub.parsed-package.v1' as const;
export const PROFESSIONAL_INPUT_PURE_CONTRACT_REVISION = 'frozen.2' as const;
export const PROFESSIONAL_INPUT_PURE_SCHEMA_ID =
  'urn:techpub:schema:v1:parsed-package:frozen-2' as const;

/** Deterministic pipeline revision identifier (no clock, no randomness). */
export const PROFESSIONAL_INPUT_PURE_PIPELINE_VERSION =
  'professional-input-pure.v1.candidate.1' as const;

/* ------------------------------------------------------------------ *
 * Stage 1 output: ParsedLayout — the raw structural reading of bytes.
 * ------------------------------------------------------------------ */

/** Text run extracted from a PDF content stream. */
export interface ParsedPdfTextRun {
  /** 1-based page number in reading order of the page tree. */
  page: number;
  /** Font resource name in effect for the run (e.g. "F1", "F2"). */
  fontName: string;
  /** True when the run's font is one of the bold variants declared in /F1,/F2 style resources. */
  bold: boolean;
  /** Font size in user-space units as declared by the active Tf operator. */
  fontSize: number;
  /** Text position (x, y) in user-space units from the last text matrix. */
  x: number;
  y: number;
  /** Decoded literal text content of the run. */
  text: string;
}

export interface ParsedPdfDocumentMetadata {
  title: string | null;
}

export interface ParsedPdfPageBox {
  page: number;
  mediaBox: readonly [number, number, number, number];
}

export interface ParsedPdfLayout {
  kind: 'pdf';
  pdfVersion: string;
  pageCount: number;
  pageBoxes: readonly ParsedPdfPageBox[];
  metadata: ParsedPdfDocumentMetadata;
  textRuns: readonly ParsedPdfTextRun[];
  /** Source sha256 over the exact input bytes. */
  sourceSha256: string;
  sourceByteLength: number;
}

export type ParsedLayout = ParsedPdfLayout;

/* ------------------------------------------------------------------ *
 * Stage 2 output: SourceUnitSet — ordered, hashed source segments plus
 * the source refs they are anchored to (the future frozen.2 sourceRefs).
 * ------------------------------------------------------------------ */

export type SourceUnitKind =
  | 'source_metadata'
  | 'text_block'
  | 'list_item'
  | 'residual_text';

export type SourceUnitSemantic = 'metadata' | 'heading' | 'text' | 'reference';

/** PDF-anchored source reference (frozen.2 pdfSourceRef shape). */
export interface PdfSourceRefValue {
  sourceRefId: string;
  kind: 'pdf';
  artifactId: string;
  pageStart: number;
  pageEnd: number;
  bbox: readonly [number, number, number, number];
  quote: string;
  anchorTextHash: string;
}

export interface SourceUnit {
  sourceUnitId: string;
  continuityKey: string;
  kind: SourceUnitKind;
  expectedSemantic: SourceUnitSemantic;
  order: number;
  sourceRefIds: readonly string[];
  unitHash: string;
  text: string;
}

export interface SourceUnitSet {
  sourceUnitSetId: string;
  sourceUnitSetHash: string;
  segmentationProfileId: string;
  segmentationProfileHash: string;
  sourceRefs: readonly PdfSourceRefValue[];
  units: readonly SourceUnit[];
}

/* ------------------------------------------------------------------ *
 * Stage 3 output: StructuredParsePackage — the frozen.2 package value
 * (CANDIDATE_ONLY until U0 strict validation passes).
 * ------------------------------------------------------------------ */

export interface StructuredParsePackage {
  readonly $schema: typeof PROFESSIONAL_INPUT_PURE_SCHEMA_ID;
  readonly schemaVersion: typeof PROFESSIONAL_INPUT_PURE_CONTRACT_ID;
  readonly contractRevision: typeof PROFESSIONAL_INPUT_PURE_CONTRACT_REVISION;
  readonly packageId: string;
  readonly integrity: {
    hashSpecVersion: 'techpub.hash.v1';
    canonicalization: 'RFC8785-JCS';
    digestAlgorithm: 'SHA-256';
    contentHash: string;
    semanticHash: string;
    provenanceHash: string;
    coverageHash: string;
  };
  readonly result: {
    status: 'complete' | 'partial';
    accountingComplete: boolean;
    contentPreserved: boolean;
    structuredCoverageComplete: boolean;
  };
  readonly artifacts: readonly unknown[];
  readonly source: Readonly<Record<string, unknown>>;
  readonly profile: Readonly<Record<string, unknown>>;
  readonly lineage: Readonly<Record<string, unknown>>;
  readonly document: Readonly<Record<string, unknown>>;
  readonly publicationStructures: readonly unknown[];
  readonly modules: readonly unknown[];
  readonly sourceRefs: readonly PdfSourceRefValue[];
  readonly sourceSegments: readonly unknown[];
  readonly contentUnits: readonly unknown[];
  readonly references: readonly unknown[];
  readonly assets: readonly unknown[];
  readonly applicability: Readonly<Record<string, unknown>>;
  readonly coverage: Readonly<Record<string, unknown>>;
  readonly findings: readonly unknown[];
  readonly extensions: readonly unknown[];
}

/* ------------------------------------------------------------------ *
 * Stage 4 output: U0 strict validation input.
 * ------------------------------------------------------------------ */

export interface U0StrictValidationInput {
  artifact: {
    storeRole: 'UnifiedArtifactStoreCandidate';
    ref: string;
    sha256: string;
    byteLength: number;
    mediaType: 'application/json';
  };
  bytes: Uint8Array;
  packageId: string;
}

/* ------------------------------------------------------------------ *
 * Pipeline-level declared inputs (all caller-supplied, deterministic).
 * ------------------------------------------------------------------ */

export interface ProfessionalInputSourceArtifactInput {
  /** Logical artifact reference (no filesystem semantics). */
  artifactRef: string;
  normalizedPath: string;
}

export interface ProfessionalInputDocumentIdentityInput {
  documentCode: string;
  documentType: 'service_bulletin' | 'oem_reference';
  language: string;
}

export interface ProfessionalInputLineageInput {
  /** RFC 3339 timestamp supplied by the caller (pipeline adds no clock). */
  generatedAt: string;
  producerName: string;
  producerVersion: string;
}

export interface ProfessionalInputPipelineInput {
  pdfBytes: Uint8Array;
  artifact: ProfessionalInputSourceArtifactInput;
  document: ProfessionalInputDocumentIdentityInput;
  lineage: ProfessionalInputLineageInput;
}
