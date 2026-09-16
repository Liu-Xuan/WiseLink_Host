export const RETRYABLE_PARSE_FAILURE_CODES = [
  'SOURCE_BINDING_FAILED',
  'PDF_OCR_REQUIRED_UNSUPPORTED',
  'PACKAGE_SEMANTIC_VALIDATION_FAILED',
  'FAILURE_REPORT_RECORDING_FAILED',
] as const;

export type RetryableParseFailureCode =
  (typeof RETRYABLE_PARSE_FAILURE_CODES)[number];

export function isRetryableParseFailureCode(
  value: unknown,
): value is RetryableParseFailureCode {
  return (
    typeof value === 'string' &&
    RETRYABLE_PARSE_FAILURE_CODES.some((code) => code === value)
  );
}
