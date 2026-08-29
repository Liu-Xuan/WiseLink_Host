import type { AeoEditingValidationFinding } from './aeo-editing-knowledge.types';
import { add, normalizeText } from './aeo-editing-knowledge.validation.utils';

export function isAeoCurrentProducerInput(
  value: Record<string, unknown>,
): boolean {
  return (
    value.recordType === 'local-aeo-editing-knowledge' &&
    'status' in value &&
    typeof value.sampleRef === 'string' &&
    !('documentIdentity' in value)
  );
}

export function validateAeoCurrentProducerInput(
  value: Record<string, unknown>,
  provenanceValue: unknown,
  findings: AeoEditingValidationFinding[],
): void {
  const provenance: Record<string, unknown> | null =
    recordOrNull(provenanceValue);
  if (
    !provenance ||
    provenance.recordType !== 'local-aeo-sample-provenance' ||
    provenance.status !== 'CANDIDATE_ONLY'
  ) {
    add(
      findings,
      'CURRENT_PRODUCER_MANIFEST_REQUIRED',
      '$provenance',
      'Current producer knowledge requires its candidate-only source manifest.',
    );
    return;
  }
  const sources: Record<string, unknown>[] = records(provenance.sources);
  const sourceMap: Map<string, Record<string, unknown>> = new Map();
  sources.forEach((source: Record<string, unknown>, index: number) => {
    const sourceId: string = text(source.sourceId);
    if (!sourceId || sourceMap.has(sourceId)) {
      add(
        findings,
        sourceId ? 'DUPLICATE_SOURCE_ID' : 'SOURCE_ID_MISSING',
        `$provenance.sources[${index}].sourceId`,
        sourceId ? `Duplicate sourceId ${sourceId}.` : 'sourceId is required.',
      );
    }
    sourceMap.set(sourceId, source);
  });
  validatePrimaryIdentity(value, provenance, sourceMap, findings);
  validateCompactSourceRefs(value, sourceMap, findings);
  validateProducerActions(value, findings);
}

function validatePrimaryIdentity(
  value: Record<string, unknown>,
  provenance: Record<string, unknown>,
  sourceMap: Map<string, Record<string, unknown>>,
  findings: AeoEditingValidationFinding[],
): void {
  const primarySourceId: string = text(value.sampleRef);
  const primary: Record<string, unknown> | undefined =
    sourceMap.get(primarySourceId);
  if (!primary) {
    add(
      findings,
      'PRIMARY_SOURCE_MISSING',
      '$.sampleRef',
      `Primary source ${primarySourceId || '<missing>'} is not declared.`,
    );
    return;
  }
  const sample: Record<string, unknown> = recordOrNull(provenance.sample) ?? {};
  const expectedHeader: string = `${text(sample.aeoNo)}-${text(
    sample.revision,
  )}`;
  if (
    !text(primary.role).includes('AEO') ||
    !Number.isInteger(primary.bytes) ||
    Number(primary.bytes) <= 0
  ) {
    add(
      findings,
      'PRIMARY_SOURCE_IDENTITY_INCOMPLETE',
      '$provenance.sources',
      'Primary source requires AEO role and positive actual bytes.',
    );
  }
  if (
    !expectedHeader ||
    normalizeText(primary.observedIdentity) !== normalizeText(expectedHeader)
  ) {
    add(
      findings,
      'PRIMARY_SOURCE_IDENTITY_MISMATCH',
      '$provenance.sources',
      'Primary source observed identity must match manifest AEO and revision.',
    );
  }
}

function validateCompactSourceRefs(
  value: unknown,
  sourceMap: Map<string, Record<string, unknown>>,
  findings: AeoEditingValidationFinding[],
  path: string = '$',
): void {
  if (Array.isArray(value)) {
    value.forEach((item: unknown, index: number) =>
      validateCompactSourceRefs(item, sourceMap, findings, `${path}[${index}]`),
    );
    return;
  }
  const record: Record<string, unknown> | null = recordOrNull(value);
  if (!record) {
    return;
  }
  Object.entries(record).forEach(([key, child]: [string, unknown]) => {
    const childPath: string = `${path}.${key}`;
    if (key === 'sourceRefs' && Array.isArray(child)) {
      child.forEach((ref: unknown, index: number) => {
        const compactRef: string = text(ref);
        const separator: number = compactRef.indexOf('#');
        const sourceId: string = compactRef.slice(0, separator);
        if (separator <= 0 || separator === compactRef.length - 1) {
          add(
            findings,
            'SOURCE_REF_INVALID',
            `${childPath}[${index}]`,
            `Compact SourceRef ${compactRef || '<missing>'} is invalid.`,
          );
        } else if (!sourceMap.has(sourceId)) {
          add(
            findings,
            'UNKNOWN_SOURCE_REF',
            `${childPath}[${index}]`,
            `SourceRef ${sourceId} is not declared by the manifest.`,
          );
        }
      });
      return;
    }
    validateCompactSourceRefs(child, sourceMap, findings, childPath);
  });
}

function validateProducerActions(
  value: Record<string, unknown>,
  findings: AeoEditingValidationFinding[],
): void {
  const items: Set<number> = new Set<number>();
  records(value.actions).forEach(
    (action: Record<string, unknown>, index: number) => {
      const item: number = Number(action.item);
      if (!Number.isInteger(item) || item <= 0 || items.has(item)) {
        add(
          findings,
          items.has(item) ? 'DUPLICATE_ACTION_SEQUENCE' : 'ACTION_ITEM_INVALID',
          `$.actions[${index}].item`,
          `Action item ${String(action.item)} must be unique and positive.`,
        );
      }
      items.add(item);
      if (!text(action.zh) && !text(action.en)) {
        add(
          findings,
          'ACTION_BODY_MISSING',
          `$.actions[${index}]`,
          'A current producer action requires editable text.',
        );
      }
      if (!Array.isArray(action.sourceRefs) || action.sourceRefs.length === 0) {
        add(
          findings,
          'ACTION_SOURCE_REF_MISSING',
          `$.actions[${index}].sourceRefs`,
          'Every current producer action requires a SourceRef.',
        );
      }
    },
  );
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        const record: Record<string, unknown> | null = recordOrNull(item);
        return record ? [record] : [];
      })
    : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
