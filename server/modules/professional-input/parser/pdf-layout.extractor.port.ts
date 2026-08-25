import { ProfessionalInputPureError } from '../pure/professional-input-pure.error';
import type { ParsedPdfLayout } from '../pure/professional-input-pure.types';

/**
 * Extractor port for stage 1 of the professional-input pure pipeline.
 *
 * The pipeline never parses PDF syntax itself. Actual PDF bytes are handed
 * to an injected, mature extractor implementation (D3 will bind a
 * pdfjs-dist-class adapter). The port contract is:
 *
 *   - deterministic: identical bytes yield an identical ParsedLayout value;
 *   - explicit: malformed or unsupported bytes throw ProfessionalInputPureError
 *     with a stable code — never degraded or synthetic output.
 */
export interface PdfLayoutExtractorPort {
  readonly extractorId: string;
  extractLayout(bytes: Uint8Array): ParsedPdfLayout;
}

/**
 * Fail-closed placeholder used when no extractor was injected. A real call
 * through this port throws — the pipeline must never fabricate a layout.
 */
export class MissingPdfLayoutExtractor implements PdfLayoutExtractorPort {
  readonly extractorId = 'missing-pdf-layout-extractor' as const;

  extractLayout(_bytes: Uint8Array): ParsedPdfLayout {
    throw new ProfessionalInputPureError(
      'PDF_LAYOUT_EXTRACTOR_NOT_BOUND',
      'No mature PDF layout extractor was injected; the pure pipeline refuses to parse PDF bytes itself (D3 integration binds the real adapter).',
    );
  }
}
