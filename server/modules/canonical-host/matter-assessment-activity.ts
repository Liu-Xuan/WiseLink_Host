import { BadRequestException } from '@nestjs/common';
import type {
  MatterAssessmentActivityItem,
  MatterAssessmentActivityPage,
  MatterAssessmentActivityQuery,
} from '@shared/matter-assessment-activity.interface';

type Scope = { tenantId: string; actorUserId: string; matterId: string };
export interface ActivityCursor {
  attemptRef: string;
  offset: number;
}
const id = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 255 &&
  value.trim() === value;
const natural = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function validateActivityQuery(
  query: MatterAssessmentActivityQuery,
): void {
  if (
    Object.keys(query).some(
      (key) => !['attemptRef', 'workRef', 'cursor', 'limit'].includes(key),
    ) ||
    (query.attemptRef !== undefined && !id(query.attemptRef)) ||
    (query.workRef !== undefined && !id(query.workRef)) ||
    (query.attemptRef !== undefined && query.workRef !== undefined) ||
    (query.limit !== undefined &&
      (!natural(query.limit) || query.limit < 1 || query.limit > 100))
  )
    throw new BadRequestException('MATTER_ACTIVITY_QUERY_INVALID');
}

function cursorScope(scope: Scope, query: MatterAssessmentActivityQuery) {
  return [
    scope.tenantId,
    scope.actorUserId,
    scope.matterId,
    query.attemptRef ?? null,
    query.workRef ?? null,
  ];
}

export function readActivityCursor(
  scope: Scope,
  query: MatterAssessmentActivityQuery,
): ActivityCursor | null {
  validateActivityQuery(query);
  if (query.cursor === undefined) return null;
  try {
    if (
      typeof query.cursor !== 'string' ||
      !query.cursor.length ||
      query.cursor.length > 4096 ||
      !/^[A-Za-z0-9_-]+$/u.test(query.cursor)
    )
      throw new Error();
    const value: unknown = JSON.parse(
      Buffer.from(query.cursor, 'base64url').toString('utf8'),
    );
    if (
      !record(value) ||
      value.v !== 1 ||
      !id(value.attemptRef) ||
      !natural(value.offset) ||
      JSON.stringify(value.scope) !==
        JSON.stringify(cursorScope(scope, query)) ||
      (query.attemptRef !== undefined && query.attemptRef !== value.attemptRef)
    )
      throw new Error();
    return { attemptRef: value.attemptRef, offset: value.offset };
  } catch {
    throw new BadRequestException('MATTER_ACTIVITY_CURSOR_INVALID');
  }
}

export function activityCursor(
  scope: Scope,
  query: MatterAssessmentActivityQuery,
  cursor: ActivityCursor,
): string {
  return Buffer.from(
    JSON.stringify({ v: 1, scope: cursorScope(scope, query), ...cursor }),
  ).toString('base64url');
}

/** Field-by-field allowlist. No purpose, context, reading, proposal or checkpoint leaves this function. */
function projectItem(
  raw: unknown,
  sequence: number,
): MatterAssessmentActivityItem | 'unknown' | null {
  if (!record(raw) || typeof raw.kind !== 'string') return null;
  const kinds = {
    MATTER_REGISTERED_SOURCES_READ: 'REGISTERED_SOURCES_READ',
    MATTER_SOURCE_PAGES_READ: 'SOURCE_PAGES_READ',
    MATTER_ORIGINAL_BOUND: 'ORIGINAL_BOUND',
    MATTER_ORIGINAL_READ: 'ORIGINAL_READ',
    MATTER_JOBAID_WORK_SAVED: 'WORK_SAVED',
    MATTER_ISSUE_CORRECTION_STARTED: 'CORRECTION_STARTED',
    MATTER_ISSUE_CORRECTION_GENERATED: 'CORRECTION_GENERATED',
    MATTER_CORRECTION_UNCHANGED: 'CORRECTION_UNCHANGED',
  } as const;
  if (!Object.hasOwn(kinds, raw.kind)) return 'unknown';
  const kind = kinds[raw.kind as keyof typeof kinds];
  if (
    raw.observedAt !== undefined &&
    (typeof raw.observedAt !== 'string' ||
      !Number.isFinite(Date.parse(raw.observedAt)))
  )
    return null;
  const item: MatterAssessmentActivityItem = {
    sequence,
    kind,
    occurredAt:
      typeof raw.observedAt === 'string'
        ? new Date(raw.observedAt).toISOString()
        : null,
  };
  switch (kind) {
    case 'REGISTERED_SOURCES_READ':
      if (
        !Array.isArray(raw.sourceRefs) ||
        !raw.sourceRefs.every((ref) => typeof ref === 'string')
      )
        return null;
      return { ...item, sourceCount: raw.sourceRefs.length };
    case 'SOURCE_PAGES_READ': {
      const reading = raw.reading;
      if (
        !record(reading) ||
        !id(reading.documentVersionId) ||
        !Array.isArray(reading.pages) ||
        !reading.pages.length ||
        !reading.pages.every(
          (page) => record(page) && natural(page.page) && page.page > 0,
        )
      )
        return null;
      const pages = reading.pages as Array<{ page: number }>;
      if (pages.some((page, index) => page.page !== pages[0].page + index))
        return null;
      return {
        ...item,
        documentVersionId: reading.documentVersionId,
        pageStart: pages[0].page,
        pageEnd: pages[pages.length - 1].page,
      };
    }
    case 'ORIGINAL_BOUND':
      return id(raw.documentVersionId) && id(raw.parseRunId)
        ? {
            ...item,
            documentVersionId: raw.documentVersionId,
            parseRunId: raw.parseRunId,
          }
        : null;
    case 'ORIGINAL_READ': {
      const reading = raw.reading;
      if (
        !record(reading) ||
        !id(reading.documentVersionId) ||
        !record(reading.binding) ||
        !id(reading.binding.parseRunId) ||
        !natural(reading.offset) ||
        !Array.isArray(reading.units)
      )
        return null;
      return {
        ...item,
        documentVersionId: reading.documentVersionId,
        parseRunId: reading.binding.parseRunId,
        unitOffset: reading.offset,
        unitCount: reading.units.length,
      };
    }
    case 'WORK_SAVED':
    case 'CORRECTION_UNCHANGED':
      return id(raw.requestId) && id(raw.workRevisionRef)
        ? { ...item, requestId: raw.requestId, workRef: raw.workRevisionRef }
        : null;
    case 'CORRECTION_STARTED':
    case 'CORRECTION_GENERATED':
      return id(raw.requestId) ? { ...item, requestId: raw.requestId } : null;
  }
}

export function projectMatterActivity(
  stored: string | null | undefined,
  offset: number,
  limit: number,
): Pick<
  MatterAssessmentActivityPage,
  | 'items'
  | 'omittedEarlierCount'
  | 'unknownOmittedCount'
  | 'malformedCount'
  | 'duplicateOmittedCount'
  | 'error'
  | 'hasMore'
> & { nextOffset: number | null } {
  const empty = {
    items: [],
    omittedEarlierCount: offset,
    unknownOmittedCount: 0,
    malformedCount: 0,
    duplicateOmittedCount: 0,
    error: null,
    hasMore: false,
    nextOffset: null,
  };
  let raw: unknown;
  try {
    raw = JSON.parse(stored ?? '[]');
  } catch {
    return { ...empty, error: 'ACTIVITY_UNREADABLE' };
  }
  if (!Array.isArray(raw)) return { ...empty, error: 'ACTIVITY_UNREADABLE' };
  if (
    !natural(offset) ||
    offset > raw.length ||
    !natural(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new BadRequestException('MATTER_ACTIVITY_CURSOR_INVALID');
  const items: MatterAssessmentActivityItem[] = [];
  let unknownOmittedCount = 0;
  let malformedCount = 0;
  let duplicateOmittedCount = 0;
  const end = Math.min(raw.length, offset + limit);
  const saves = new Set<string>();
  for (let index = 0; index < offset; index++) {
    const previous = projectItem(raw[index], index + 1);
    if (previous && previous !== 'unknown' && previous.kind === 'WORK_SAVED')
      saves.add(JSON.stringify([previous.requestId, previous.workRef]));
  }
  // Stable raw windows: each raw receipt is visited once, even when not displayable.
  for (let index = offset; index < end; index++) {
    const item = projectItem(raw[index], index + 1);
    if (item === 'unknown') {
      unknownOmittedCount++;
      continue;
    }
    if (!item) {
      malformedCount++;
      continue;
    }
    if (item.kind === 'WORK_SAVED') {
      const key = JSON.stringify([item.requestId, item.workRef]);
      if (saves.has(key)) {
        duplicateOmittedCount++;
        continue;
      }
      saves.add(key);
    }
    items.push(item);
  }
  return {
    items,
    omittedEarlierCount: offset,
    unknownOmittedCount,
    malformedCount,
    duplicateOmittedCount,
    error: malformedCount ? 'ACTIVITY_ITEMS_UNREADABLE' : null,
    hasMore: end < raw.length,
    nextOffset: end < raw.length ? end : null,
  };
}
