import type {
  DerivedSummaryMember,
  DerivedSummaryScopeSelection,
} from '@shared/derived-summary.interface';
import type { HierarchicalWikiStatus } from '@shared/hierarchical-wiki.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

export type WikiVersions = Record<string, DerivedSummaryMember>;
export interface WikiDemand {
  schemaVersion: 1;
  desiredGeneration: number;
  completedGeneration: number;
  firstDirtyAt: string | null;
  dueAt: string | null;
  priority: 'ORDINARY' | 'IMPORTANT';
  versions: WikiVersions;
  delivered: WikiVersions;
  lastGenerated: WikiVersions;
  /** Explicit one-off rebuild, separate from the actual saved body's scope. */
  forceGeneration?: number | null;
  waiting: HierarchicalWikiStatus['waiting'];
  active: {
    requestId: string;
    attemptRef: string;
    generation: number;
    versions: WikiVersions;
    waiting: HierarchicalWikiStatus['waiting'];
  } | null;
  blocked: string | null;
  /** Retain the last exact failure while the existing retry window is pending. */
  lastAttemptErrorCode?: string | null;
  retryCount: number;
  lastCheckedAt: string | null;
  pendingEvents: {
    untilSeq: string;
    changes: Array<{ kind: string; subjectId: string; important: boolean }>;
    cursor: string | null;
  } | null;
}

const minute = 60_000;
const windows = {
  ATA4: [15, 2, 120],
  ATA2: [30, 5, 240],
  FLEET: [60, 10, 480],
} as const;

export function emptyWikiDemand(): WikiDemand {
  return {
    schemaVersion: 1,
    desiredGeneration: 0,
    completedGeneration: 0,
    firstDirtyAt: null,
    dueAt: null,
    priority: 'ORDINARY',
    versions: {},
    delivered: {},
    lastGenerated: {},
    forceGeneration: null,
    waiting: [],
    active: null,
    blocked: null,
    lastAttemptErrorCode: null,
    retryCount: 0,
    lastCheckedAt: null,
    pendingEvents: null,
  };
}

export function wikiScopeKey(scope: DerivedSummaryScopeSelection): string {
  if (scope.fleetModelIds.length > 1)
    throw new Error('WIKI_SINGLE_FLEET_SCOPE_REQUIRED');
  return JSON.stringify([
    scope.fleetFamilyId.trim().toUpperCase(),
    scope.fleetModelIds[0]?.trim().toUpperCase() ?? null,
    scope.kind,
    scope.ata4 ?? scope.ata2 ?? null,
  ]);
}

export function wikiMemberSubject(member: DerivedSummaryMember): string {
  if (member.kind === 'DOCUMENT_READING')
    return `DOCUMENT:${member.documentVersionId}`;
  if (member.kind === 'MATTER_WORK') return `MATTER:${member.matterId}`;
  if (member.kind === 'WORK_ITEM_WORK') return `WORK_ITEM:${member.workItemId}`;
  return `SUMMARY:${member.summaryId}`;
}

const same = (a: unknown, b: unknown): boolean =>
  canonicalJson(a) === canonicalJson(b);

/** Called only for actual semantic input changes. Dependency completion releases
 * the existing deadline instead of starting another debounce window. */
export function mergeWikiDemand(
  state: WikiDemand,
  input: {
    versions: WikiVersions;
    waiting: WikiDemand['waiting'];
    kind: DerivedSummaryScopeSelection['kind'];
    now: string;
    important?: boolean;
    dependencyCompleted?: boolean;
  },
): WikiDemand {
  const changed =
    !same(state.versions, input.versions) ||
    !same(state.waiting, input.waiting);
  if (!changed) return { ...state, lastCheckedAt: input.now };
  const [ordinary, important, maximum] = windows[input.kind];
  const firstDirtyAt = state.firstDirtyAt ?? input.now;
  const now = Date.parse(input.now);
  const initial = !Object.keys(state.delivered).length
    ? { ATA4: 5, ATA2: 10, FLEET: 15 }[input.kind]
    : ordinary;
  let due = Math.min(
    now + (input.important ? important : initial) * minute,
    Date.parse(firstDirtyAt) + maximum * minute,
  );
  if (
    (input.dependencyCompleted || state.priority === 'IMPORTANT') &&
    state.dueAt
  )
    due = Math.min(due, Date.parse(state.dueAt));
  const resolvedWithoutNewBody =
    !state.active &&
    !state.forceGeneration &&
    !input.waiting.length &&
    same(input.versions, state.delivered);
  return {
    ...state,
    versions: structuredClone(input.versions),
    waiting: structuredClone(input.waiting),
    desiredGeneration: state.desiredGeneration + 1,
    firstDirtyAt,
    dueAt: new Date(due).toISOString(),
    ...(resolvedWithoutNewBody
      ? {
          completedGeneration: state.desiredGeneration + 1,
          firstDirtyAt: null,
          dueAt: null,
        }
      : {}),
    priority:
      input.important || state.priority === 'IMPORTANT'
        ? 'IMPORTANT'
        : 'ORDINARY',
    blocked: null,
    lastAttemptErrorCode: null,
    retryCount: 0,
    lastCheckedAt: input.now,
  };
}

export function wikiDue(
  state: WikiDemand,
  kind: DerivedSummaryScopeSelection['kind'],
  now: string,
): boolean {
  if (
    state.active ||
    state.blocked ||
    !state.dueAt ||
    Date.parse(state.dueAt) > Date.parse(now) ||
    !Object.keys(state.versions).length ||
    (same(state.versions, state.lastGenerated) && !state.forceGeneration)
  )
    return false;
  return (
    !state.waiting.length ||
    Boolean(
      state.firstDirtyAt &&
      Date.parse(now) >=
        Date.parse(state.firstDirtyAt) + windows[kind][2] * minute,
    )
  );
}

export function completeWikiDemand(
  state: WikiDemand,
  requestId: string,
  covered: WikiVersions,
  now: string,
): WikiDemand {
  const active = state.active;
  if (!active || active.requestId !== requestId)
    throw new Error('WIKI_ATTEMPT_BINDING_MISMATCH');
  const fulfilled = !active.waiting.length && same(active.versions, covered);
  const completedGeneration = fulfilled
    ? Math.max(state.completedGeneration, active.generation)
    : state.completedGeneration;
  const current = fulfilled && state.desiredGeneration === active.generation;
  return {
    ...state,
    completedGeneration,
    delivered: structuredClone(covered),
    lastGenerated: structuredClone(active.versions),
    forceGeneration:
      state.forceGeneration && state.forceGeneration > active.generation
        ? state.forceGeneration
        : null,
    active: null,
    firstDirtyAt: current ? null : state.firstDirtyAt,
    dueAt: current ? null : state.dueAt,
    priority: current ? 'ORDINARY' : state.priority,
    blocked: null,
    lastAttemptErrorCode: null,
    retryCount: 0,
    lastCheckedAt: now,
  };
}

export function wikiDemandState(
  state: WikiDemand,
  attemptStatus?: string,
): HierarchicalWikiStatus['state'] {
  if (state.blocked) return 'BLOCKED';
  if (state.active) {
    if (['RUNNING', 'COMMITTING'].includes(attemptStatus ?? ''))
      return 'RUNNING';
    if (['QUEUED', 'RETRY_SCHEDULED'].includes(attemptStatus ?? ''))
      return 'QUEUED';
    return 'PENDING';
  }
  if (state.waiting.length)
    return same(state.versions, state.lastGenerated) && !state.forceGeneration
      ? 'PARTIAL'
      : 'WAITING_UPSTREAM';
  if (!Object.keys(state.versions).length) return 'EMPTY';
  return state.firstDirtyAt
    ? same(state.versions, state.lastGenerated) && !state.forceGeneration
      ? 'PARTIAL'
      : 'PENDING'
    : 'CURRENT';
}

/** An exact terminal request releases its reservation, never its saved body. */
export function retryWikiDemand(
  state: WikiDemand,
  errorCode: string,
  now: string,
): WikiDemand {
  const retryCount: number = state.retryCount + 1;
  return {
    ...state,
    active: null,
    retryCount,
    lastAttemptErrorCode: errorCode,
    blocked: retryCount >= 3 ? errorCode : null,
    dueAt: new Date(
      Date.parse(now) + [5, 15, 60][Math.min(retryCount - 1, 2)]! * minute,
    ).toISOString(),
    lastCheckedAt: now,
  };
}
