import type {
  LcmMatrixBinding,
  LcmMatrixDetailRequest,
  LcmMatrixQuery,
} from '@shared/lcm-matrix.interface';
import { lcmReadingError } from './lcm-source-reading.port';

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key: string) => !keys.includes(key))
  )
    throw lcmReadingError('LCM_MATRIX_QUERY_INVALID', 400);
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum = 2048): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw lcmReadingError('LCM_MATRIX_QUERY_INVALID', 400);
  return value;
}

function texts(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw lcmReadingError('LCM_MATRIX_QUERY_INVALID', 400);
  const values: string[] = value.map((v: unknown) => text(v));
  if (new Set(values).size !== values.length)
    throw lcmReadingError('LCM_MATRIX_QUERY_INVALID', 400);
  return values;
}

export function lcmMatrixQuery(value: unknown): LcmMatrixQuery {
  const input = object(value, [
    'snapshotIds',
    'aircraftModel',
    'aircraftModels',
    'aircraftRefs',
    'search',
    'ata',
    'differencesOnly',
    'anchorSoftwareRef',
  ]);
  const query: LcmMatrixQuery = {
    snapshotIds: texts(input.snapshotIds, 20).sort(),
  };
  if (
    !query.snapshotIds.length ||
    query.snapshotIds.some((id: string) => !/^[a-f0-9]{64}$/u.test(id))
  )
    throw lcmReadingError('LCM_MATRIX_QUERY_INVALID', 400);
  for (const key of ['aircraftModel', 'search', 'ata'] as const)
    if (input[key] !== undefined) query[key] = text(input[key], 256);
  if (input.aircraftModels !== undefined) query.aircraftModels = texts(input.aircraftModels, 100).sort();
  if (input.aircraftRefs !== undefined)
    query.aircraftRefs = texts(input.aircraftRefs, 2000).sort();
  if (input.differencesOnly !== undefined) {
    if (typeof input.differencesOnly !== 'boolean')
      throw lcmReadingError('LCM_MATRIX_QUERY_INVALID', 400);
    query.differencesOnly = input.differencesOnly;
  }
  if (input.anchorSoftwareRef !== undefined)
    query.anchorSoftwareRef =
      input.anchorSoftwareRef === null ? null : text(input.anchorSoftwareRef);
  return query;
}

export function lcmMatrixBinding(value: unknown): LcmMatrixBinding {
  const keys: Array<keyof LcmMatrixBinding> = [
    'readSetRef',
    'projectionRevision',
    'scopeRef',
    'permissionRevision',
    'filterHash',
    'orderRef',
  ];
  const input = object(value, keys);
  return {
    readSetRef: text(input.readSetRef),
    projectionRevision: text(input.projectionRevision),
    scopeRef: text(input.scopeRef),
    permissionRevision: text(input.permissionRevision),
    filterHash: text(input.filterHash),
    orderRef: text(input.orderRef),
  };
}

export function lcmMatrixDetail(value: unknown): LcmMatrixDetailRequest {
  const input = object(value, [
    'query',
    'binding',
    'softwareRef',
    'aircraftRef',
    'partNumber',
    'after',
  ]);
  const result: LcmMatrixDetailRequest = {
    query: lcmMatrixQuery(input.query),
    binding: lcmMatrixBinding(input.binding),
  };
  for (const key of ['softwareRef', 'aircraftRef', 'after'] as const)
    if (input[key] !== undefined) result[key] = text(input[key]);
  if (!result.softwareRef && !result.aircraftRef)
    throw lcmReadingError('LCM_MATRIX_QUERY_INVALID', 400);
  if (input.partNumber !== undefined)
    result.partNumber =
      input.partNumber === null ? null : text(input.partNumber);
  return result;
}
