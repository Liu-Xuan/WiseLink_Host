/**
 * Explicit failure type for the professional-input pure pipeline.
 *
 * Every malformed or unsupported input condition surfaces as this error with
 * a stable machine-readable code — the pipeline never silently degrades and
 * never fabricates a synthetic success result.
 */
export class ProfessionalInputPureError extends Error {
  readonly code: string;
  readonly diagnostic: Readonly<ProfessionalInputPureDiagnostic>;

  constructor(
    code: string,
    message: string,
    diagnostic: ProfessionalInputPureDiagnostic = {},
  ) {
    super(`[${code}] ${message}`);
    this.name = 'ProfessionalInputPureError';
    this.code = code;
    this.diagnostic = Object.freeze({ ...diagnostic });
  }
}

export type ProfessionalInputPureDiagnosticValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[];

export type ProfessionalInputPureDiagnostic = Record<
  string,
  ProfessionalInputPureDiagnosticValue
>;
