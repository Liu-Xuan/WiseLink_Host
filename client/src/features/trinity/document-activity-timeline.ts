import type {
  DocumentActivityRevision,
  DocumentActivityStatement,
  DocumentActivityTime,
} from '@shared/document-activity.interface';

export type ActivityTimelineLane = 'materials' | 'execution' | 'observation' | 'knowledge';

export type ActivityTimelineWindow = 'all' | 'current-year';

export const ACTIVITY_TIMELINE_WINDOWS: ReadonlyArray<{
  id: ActivityTimelineWindow;
  label: string;
}> = [
  { id: 'all', label: '全部保存时间' },
  { id: 'current-year', label: '本年' },
];

/** Inclusive start/end in UTC milliseconds over a continuous, multi-year axis. */
export interface ActivityCalendarSpan {
  start: number;
  end: number;
  precision: 'DAY' | 'MONTH' | 'QUARTER' | 'YEAR';
}

export interface ActivityTimelineItem {
  statement: DocumentActivityStatement;
  lane: ActivityTimelineLane;
  time: DocumentActivityTime | null;
  displayTime: string;
  span: ActivityCalendarSpan | null;
}

export const ACTIVITY_TIMELINE_LANES: ReadonlyArray<{
  id: ActivityTimelineLane;
  label: string;
}> = [
  { id: 'materials', label: '资料与厂家进展' },
  { id: 'execution', label: '我方工程执行' },
  { id: 'observation', label: '运行观察' },
  { id: 'knowledge', label: '认识知识更新' },
];

function laneFor(_time: DocumentActivityTime | null): ActivityTimelineLane {
  // The current activity DTO carries source declarations only. A role is a
  // property of the wording, not evidence of execution or runtime observation.
  return 'materials';
}

const DAY_CALENDAR = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/u;
const MONTH_CALENDAR = /^(\d{4})[-/.年](\d{1,2})月?$/u;
const QUARTER_PREFIX = /^(\d{4})\s*年?\s*第?\s*([1-4]|一|二|三|四)\s*季度$/u;
const QUARTER_Q = /^(\d{4})\s*[Qq]\s*([1-4])$/u;
const QUARTER_Q_REVERSED = /^[Qq]\s*([1-4])\s*(?:of\s+)?(\d{4})$/u;
const YEAR_CALENDAR = /^(\d{4})年?$/u;
const CN_QUARTER: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4 };

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function spanFromParts(
  year: number,
  precision: ActivityCalendarSpan['precision'],
  month = 1,
  day = 1,
): ActivityCalendarSpan {
  if (precision === 'DAY')
    return { start: Date.UTC(year, month - 1, day), end: Date.UTC(year, month - 1, day + 1) - 1, precision };
  if (precision === 'MONTH')
    return { start: Date.UTC(year, month - 1, 1), end: Date.UTC(year, month, 1) - 1, precision };
  if (precision === 'QUARTER')
    return { start: Date.UTC(year, (month - 1) * 3, 1), end: Date.UTC(year, month * 3, 1) - 1, precision };
  return { start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) - 1, precision };
}

/**
 * Conservative calendar placement: only CALENDAR wording whose precision matches a
 * fully explicit pattern (year always present) becomes a closed interval. Missing
 * years, TBD, RELATIVE and UNKNOWN keep their raw wording and are never placed; no
 * midpoint day is ever invented.
 */
export function calendarSpan(time: DocumentActivityTime | null): ActivityCalendarSpan | null {
  if (!time || time.expression !== 'CALENDAR') return null;
  const raw = time.raw.trim();
  if (time.precision === 'DAY') {
    const match = raw.match(DAY_CALENDAR);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > daysInUtcMonth(year, month)) return null;
    return spanFromParts(year, 'DAY', month, day);
  }
  if (time.precision === 'MONTH') {
    const match = raw.match(MONTH_CALENDAR);
    if (!match) return null;
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return spanFromParts(Number(match[1]), 'MONTH', month);
  }
  if (time.precision === 'QUARTER') {
    let match = raw.match(QUARTER_PREFIX);
    if (match)
      return spanFromParts(Number(match[1]), 'QUARTER', CN_QUARTER[match[2]] ?? Number(match[2]));
    match = raw.match(QUARTER_Q);
    if (match) return spanFromParts(Number(match[1]), 'QUARTER', Number(match[2]));
    match = raw.match(QUARTER_Q_REVERSED);
    if (match) return spanFromParts(Number(match[2]), 'QUARTER', Number(match[1]));
    return null;
  }
  if (time.precision === 'YEAR') {
    const match = raw.match(YEAR_CALENDAR);
    if (!match) return null;
    return spanFromParts(Number(match[1]), 'YEAR');
  }
  return null;
}

export function spanIntersects(span: ActivityCalendarSpan, start: number, end: number): boolean {
  return span.start <= end && span.end >= start;
}

export function timelineItems(candidate: DocumentActivityRevision | null): ActivityTimelineItem[] {
  if (!candidate) return [];
  return candidate.statements.map((statement) => ({
    statement,
    lane: laneFor(statement.time),
    time: statement.time,
    displayTime: statement.time?.raw ?? '时间未提取',
    span: calendarSpan(statement.time),
  }));
}

export function timelineLaneItems(
  candidate: DocumentActivityRevision | null,
  lane: ActivityTimelineLane,
): ActivityTimelineItem[] {
  return timelineItems(candidate).filter((item) => item.lane === lane);
}

/** Placed items in ascending interval order; never uses savedAt as a coordinate. */
export function timelinePlacedItems(items: ActivityTimelineItem[]): ActivityTimelineItem[] {
  return items
    .filter((item) => item.span !== null)
    .sort((a, b) => a.span!.start - b.span!.start);
}
