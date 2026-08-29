import { sha256Hex } from '../pure/canonical-hash';
import { ProfessionalInputPureError } from '../pure/professional-input-pure.error';
import type {
  ParsedPdfLayout,
  ProfessionalInputDocumentIdentityInput,
  ProfessionalInputPipelineInput,
  ProfessionalInputLineageInput,
  ProfessionalInputSourceArtifactInput,
  SourceUnitSet,
  StructuredParsePackage,
  U0StrictValidationInput,
} from '../pure/professional-input-pure.types';
import {
  MissingPdfLayoutExtractor,
  type PdfLayoutExtractorPort,
} from '../parser/pdf-layout.extractor.port';
import { buildSourceUnitSet } from './source-unit-set.builder';
import { buildStructuredParsePackage } from './structured-parse-package.builder';

export { buildSourceUnitSet } from './source-unit-set.builder';
export { buildStructuredParsePackage } from './structured-parse-package.builder';
export {
  MissingPdfLayoutExtractor,
  type PdfLayoutExtractorPort,
} from '../parser/pdf-layout.extractor.port';

/**
 * The professional-input pure pipeline:
 *
 *   injected extractor(bytes) -> ParsedLayout -> SourceUnitSet
 *     -> StructuredParsePackage -> U0 strict validation input.
 *
 * The pipeline never parses PDF syntax itself — stage 1 is delegated to an
 * injected mature extractor (D3 binds the pdfjs-dist-class adapter).
 * Deterministic by construction: identical bytes and identical declared
 * inputs produce byte-identical JSON and identical ids. No clock, no
 * randomness, no I/O, no Nest/runtime dependencies. Results are
 * CANDIDATE_ONLY until the hosted U0 frozen.2 strict validator accepts them.
 */
export function runProfessionalInputPipeline(
  input: ProfessionalInputPipelineInput,
  options: { extractor?: PdfLayoutExtractorPort } = {},
): {
  layout: ParsedPdfLayout;
  unitSet: SourceUnitSet;
  pkg: StructuredParsePackage;
  u0Input: U0StrictValidationInput;
} {
  const extractor = options.extractor ?? new MissingPdfLayoutExtractor();
  const layout = extractor.extractLayout(input.pdfBytes);
  return runProfessionalInputPipelineFromLayout(layout, {
    artifact: input.artifact,
    document: input.document,
    lineage: input.lineage,
  });
}

/**
 * Continue the single professional-input pipeline from an already extracted
 * layout. The canonical producer uses this seam so profile recognition and
 * packaging consume the same pdfjs result rather than parsing the PDF twice.
 */
export function runProfessionalInputPipelineFromLayout(
  layout: ParsedPdfLayout,
  input: {
    artifact: ProfessionalInputSourceArtifactInput;
    document: ProfessionalInputDocumentIdentityInput;
    lineage: ProfessionalInputLineageInput;
  },
): {
  layout: ParsedPdfLayout;
  unitSet: SourceUnitSet;
  pkg: StructuredParsePackage;
  u0Input: U0StrictValidationInput;
} {
  const unitSet = buildSourceUnitSet(layout, {
    documentCode: input.document.documentCode,
    artifact: input.artifact,
  });
  const pkg = buildStructuredParsePackage({
    layout,
    unitSet,
    artifact: input.artifact,
    document: input.document,
    lineage: input.lineage,
  });
  return {
    layout,
    unitSet,
    pkg,
    u0Input: toU0StrictValidationInput(pkg),
  };
}

/**
 * Stage 4: serialize the package to exact JSON bytes and bind them into the
 * U0 strict validation input shape ({artifact, bytes, packageId}).
 */
export function toU0StrictValidationInput(
  pkg: StructuredParsePackage,
): U0StrictValidationInput {
  const bytes = packageJsonBytes(pkg);
  // UnifiedArtifactStoreCandidate descriptors use the Host's raw 64-hex
  // digest contract. Hashes inside the frozen.2 package remain prefixed.
  const artifactSha = sha256Hex(bytes);
  return {
    artifact: {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${artifactSha}`,
      sha256: artifactSha,
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    },
    bytes,
    packageId: pkg.packageId,
  };
}

/** Deterministic serialization: two-space JSON, UTF-8, trailing newline. */
export function packageJsonBytes(pkg: StructuredParsePackage): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(pkg, null, 2)}\n`);
}

/**
 * Parse U0 input bytes back into a package and assert the packageId binding
 * matches the payload hash identity — the read-side counterpart of
 * toU0StrictValidationInput, used to prove byte-identity round trips.
 */
export function u0InputBytesToPackage(
  input: U0StrictValidationInput,
): StructuredParsePackage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(input.bytes),
    );
  } catch {
    throw new ProfessionalInputPureError(
      'U0_INPUT_JSON_INVALID',
      'U0 input bytes are not valid UTF-8 JSON.',
    );
  }
  const pkg = parsed as StructuredParsePackage;
  if (pkg.packageId !== input.packageId) {
    throw new ProfessionalInputPureError(
      'U0_INPUT_PACKAGE_ID_MISMATCH',
      `Input packageId ${input.packageId} does not match payload packageId ${pkg.packageId}.`,
    );
  }
  return pkg;
}
