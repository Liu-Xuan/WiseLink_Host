import type { LcmCollectionContext } from '../../../shared/lcm-export-staging.interface';
import type { LcmNativeMatrix } from '@shared/lcm-native-matrix.interface';
import { canonicalJson, LcmStagingError } from './lcm-export.helpers';

export function requiredText(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value !== value.trim()
  ) {
    throw new LcmStagingError(
      'INPUT_TEXT_INVALID',
      'Expected a nonempty exact string.',
    );
  }
  return value;
}

export function requiredZonedTime(value: unknown): string {
  const text: string = requiredText(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(text) ||
    !Number.isFinite(Date.parse(text))
  ) {
    throw new LcmStagingError(
      'INPUT_TIME_INVALID',
      'Expected an explicit timestamp with timezone.',
    );
  }
  return new Date(text).toISOString();
}

export function requiredDay(value: unknown): string {
  const day: string = requiredText(value);
  const date: Date = new Date(`${day}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(day) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  ) {
    throw new LcmStagingError(
      'INPUT_DATE_INVALID',
      'Expected a real calendar date.',
    );
  }
  return day;
}

export function parseCollectionContext(bytes: Buffer): LcmCollectionContext {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new LcmStagingError(
      'COLLECTION_CONTEXT_INVALID',
      'Collection context must be JSON.',
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LcmStagingError(
      'COLLECTION_CONTEXT_INVALID',
      'Collection context must be an object.',
    );
  }
  const root: Record<string, unknown> = value as Record<string, unknown>;
  if (
    root.schemaVersion !== 'wiselink.lcm.collection_context.v1' ||
    !['local-file', 'user-confirmed-lcm-page'].includes(
      String(root.sourceOrigin),
    ) ||
    !root.filters ||
    typeof root.filters !== 'object' ||
    Array.isArray(root.filters)
  ) {
    throw new LcmStagingError(
      'COLLECTION_CONTEXT_INVALID',
      'Collection context schema or scope is invalid.',
    );
  }
  const filters: Record<string, string | null> = Object.create(null);
  Object.entries(root.filters).forEach(([key, filter]: [string, unknown]) => {
    filters[requiredText(key)] = filter === null ? null : requiredText(filter);
  });
  const pageUrl: string | null =
    root.pageUrl === null ? null : requiredText(root.pageUrl);
  if (
    root.sourceOrigin === 'user-confirmed-lcm-page' &&
    pageUrl !==
      'http://lcm.airchina.com.cn/gate/swInstallStatis/efbNumberListByTailNo'
  ) {
    throw new LcmStagingError(
      'COLLECTION_CONTEXT_INVALID',
      'Confirmed LCM context requires the explicitly confirmed page.',
    );
  }
  const context: LcmCollectionContext = {
    schemaVersion: 'wiselink.lcm.collection_context.v1',
    collectionId: requiredText(root.collectionId),
    sourceOrigin: root.sourceOrigin as LcmCollectionContext['sourceOrigin'],
    pageUrl,
    filters,
    observedAt:
      root.observedAt === null ? null : requiredZonedTime(root.observedAt),
    sourceEvidence: requiredText(root.sourceEvidence),
  };
  if (root.systemStateDate !== undefined) {
    if (
      root.systemStateTimeZone !== 'Asia/Shanghai' ||
      root.systemStateDateBasis !== 'user-confirmed-system-state'
    ) {
      throw new LcmStagingError(
        'COLLECTION_CONTEXT_INVALID',
        'Day precision needs the explicitly confirmed timezone and basis.',
      );
    }
    context.systemStateDate = requiredDay(root.systemStateDate);
    context.systemStateTimeZone = 'Asia/Shanghai';
    context.systemStateDateBasis = 'user-confirmed-system-state';
    if (context.observedAt !== null) {
      const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat(
        'en-CA',
        {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        },
      ).formatToParts(new Date(context.observedAt));
      const values: Record<string, string> = Object.fromEntries(
        parts.map((part: Intl.DateTimeFormatPart) => [part.type, part.value]),
      );
      if (
        `${values.year}-${values.month}-${values.day}` !==
        context.systemStateDate
      ) {
        throw new LcmStagingError(
          'COLLECTION_DATE_CONFLICT',
          'Exact observation timestamp conflicts with the confirmed local system date.',
        );
      }
    }
  }
  return context;
}

export function collectionScope(
  parsed: LcmNativeMatrix,
  context: LcmCollectionContext | null,
): string {
  const model: string = parsed.aircraftModel;
  if (
    context?.filters.aircraftModel &&
    context.filters.aircraftModel !== model
  ) {
    throw new LcmStagingError(
      'COLLECTION_SCOPE_CONFLICT',
      'Source filter model disagrees with explicit import model.',
    );
  }
  return canonicalJson({
    kind: parsed.kind,
    aircraftModel: model,
    // Query scope is explicit. Matrix output tail columns do not define that scope.
    detailTail: null,
    sourceOrigin: context?.sourceOrigin ?? 'local-file',
    pageUrl: context?.pageUrl ?? null,
    filters: context?.filters ?? null,
  });
}
