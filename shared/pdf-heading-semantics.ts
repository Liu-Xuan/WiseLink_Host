/** Existing frozen.2 reasonCode for a bold-line candidate with no source rank. */
export const PDF_HEADING_LEVEL_UNKNOWN_REASON = 'PDF_HEADING_LEVEL_UNKNOWN';
export const PDF_HEADING_LEVEL_UNKNOWN_FINDING = 'PDF.HEADING_LEVEL_UNKNOWN';

/** The legacy flag exists only in a Reader projection, never in a frozen package. */
export function isUnrankedPdfHeading(unit: {
  kind: string;
  payload: Record<string, unknown>;
  mapping?: Record<string, unknown>;
}): boolean {
  return (unit.kind === 'preserved_source' &&
    unit.payload.reasonCode === PDF_HEADING_LEVEL_UNKNOWN_REASON) ||
    (unit.kind === 'heading' && unit.mapping?.headingLevelStatus === 'unknown');
}
