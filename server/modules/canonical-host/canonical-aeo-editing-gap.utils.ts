import type { CanonicalAeoEditingSourceRef } from '@shared/api.interface';
import type { AeoEditingSourceRef } from '../aeo-authoring/aeo-editing-knowledge';

export function evidenceSourceRefs(
  value: unknown,
  missingLocator: string,
): CanonicalAeoEditingSourceRef[] {
  const refs = collectSourceRefs(value);
  return refs.length > 0 ? refs : [missingSourceRef(missingLocator)];
}

export function evidenceLabel(value: unknown, fallback: number): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `#${fallback}`;
  }
  const record = value as Record<string, unknown>;
  const identity = record.figure ?? record.control ?? record.class;
  return typeof identity === 'string' || typeof identity === 'number'
    ? JSON.stringify(identity)
    : `#${fallback}`;
}

export function missingSourceRef(
  locator: string,
): CanonicalAeoEditingSourceRef {
  return { sourceId: 'MISSING_SOURCE', locator };
}

function collectSourceRefs(value: unknown): CanonicalAeoEditingSourceRef[] {
  const found: CanonicalAeoEditingSourceRef[] = [];
  visit(value, found);
  const unique = new Map(
    found.map((ref) => [`${ref.sourceId}#${ref.locator}`, ref] as const),
  );
  return Array.from(unique.values());
}

function visit(value: unknown, found: CanonicalAeoEditingSourceRef[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, found));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    if (key === 'sourceRefs' && Array.isArray(child)) {
      child.forEach((ref) => {
        const parsed = compactSourceRef(ref);
        if (parsed) found.push(parsed);
      });
      return;
    }
    visit(child, found);
  });
}

function compactSourceRef(value: unknown): AeoEditingSourceRef | null {
  if (typeof value !== 'string') return null;
  const separator = value.indexOf('#');
  return separator > 0 && separator < value.length - 1
    ? {
        sourceId: value.slice(0, separator),
        locator: value.slice(separator + 1),
      }
    : null;
}
