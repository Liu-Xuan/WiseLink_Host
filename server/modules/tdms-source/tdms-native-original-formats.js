// Pure contract from frozen TDMS 0.2.54; no runtime or source authority.
// Native Format Name is source data. A filename suffix never selects a format.
// Ambiguous application names and unsupported source formats remain unclassified.
export const NATIVE_ORIGINAL_FORMATS = Object.freeze({
  PDF: Object.freeze({ format: 'PDF', mediaType: 'application/pdf' }),
  ZIP: Object.freeze({ format: 'ZIP', mediaType: 'application/zip' }),
  DOCX: Object.freeze({
    format: 'DOCX',
    mediaType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }),
  XLSX: Object.freeze({
    format: 'XLSX',
    mediaType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }),
  PPTX: Object.freeze({
    format: 'PPTX',
    mediaType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }),
});
const aliases = Object.freeze(
  Object.fromEntries(
    Object.values(NATIVE_ORIGINAL_FORMATS)
      .flatMap((v) => [
        [v.format, v],
        [v.mediaType.toUpperCase(), v],
      ])
      .concat([['APPLICATION/X-ZIP-COMPRESSED', NATIVE_ORIGINAL_FORMATS.ZIP]]),
  ),
);
export const COMPLETE_ORIGINAL_MEDIA_TYPES = Object.freeze(
  Object.values(NATIVE_ORIGINAL_FORMATS).map((v) => v.mediaType),
);
export function nativeOriginalFormat(raw) {
  return typeof raw === 'string'
    ? aliases[raw.replace(/\s+/gu, ' ').trim().toUpperCase()] || null
    : null;
}
