import type {
  AeoEditingValidationFinding,
  AeoEditingValidationResult,
} from './aeo-editing-knowledge.types';

export function normalizeText(value: unknown): string {
  return (typeof value === 'string' ? value.trim() : '')
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

export function add(
  findings: AeoEditingValidationFinding[],
  code: string,
  path: string,
  message: string,
): void {
  findings.push({ code, path, message });
}

export function result(
  findings: AeoEditingValidationFinding[],
): AeoEditingValidationResult {
  return { valid: findings.length === 0, findings };
}

export function validateInputAuthorityBoundary(
  value: Record<string, unknown>,
  findings: AeoEditingValidationFinding[],
): void {
  const prohibitedAuthorityFields: string[] = [
    'approval',
    'approvalStatus',
    'approved',
    'issued',
    'current',
    'releaseStatus',
    'airworthiness',
    'completed',
    'signature',
  ];
  prohibitedAuthorityFields.forEach((field: string) => {
    if (field in value) {
      add(
        findings,
        'FORMAL_AUTHORITY_FIELD_FORBIDDEN',
        `$.${field}`,
        `Candidate editing input cannot carry formal authority field ${field}.`,
      );
    }
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
