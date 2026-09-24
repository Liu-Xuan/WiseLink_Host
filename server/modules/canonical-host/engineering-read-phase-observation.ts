import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

export interface EngineeringReadScope {
  windowIndex?: number;
  rootSlot?: number;
  readInstance?: number;
  parentReadInstance?: number;
  attempt?: number;
  depth?: number;
  memberGroup?: number;
}
type Outcome = 'ok' | 'error' | 'skip' | 'reuse';
type Phase = { count: number; totalMs: number; maxMs: number };
type Counts = { participants?: number; skipped?: number };
// phase index, scope index, request-relative start/end milliseconds, outcome,
// optional participants and skipped counts. No object or actor identifiers.
type TimelineEvent = [number, number, number, number, Outcome, number?, number?];
type WindowTiming = [number, number, number, Outcome];
interface Collector {
  started: number;
  phases: Map<string, Phase>;
  timeline: boolean;
  maxEvents: number;
  events: TimelineEvent[];
  names: string[];
  nameIndices: Map<string, number>;
  scopeIndices: Map<string, number>;
  scopes: Readonly<EngineeringReadScope>[];
  bytes: number;
  dropped: number;
  nextInstance: number;
  windows: WindowTiming[];
  droppedWindows: number;
}
const MAX_TIMELINE_BYTES = 48000;
// The hosted log body is truncated at 10 KiB. Base64 avoids JSON escaping
// amplifying a slice, and leaves room for the logger's surrounding fields.
const TIMELINE_LOG_SLICE_BYTES = 3072;

function engineeringReadLogParts<T extends object>(
  value: unknown, kind: 'TIMELINE' | 'WINDOWS', metadata: T,
) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const segmentCount = Math.ceil(bytes.length / TIMELINE_LOG_SLICE_BYTES);
  const manifest = {
    format: 'base64-json-utf8-v1' as const,
    byteLength: bytes.length,
    segmentCount,
    sha256,
    ...metadata,
  };
  const segments = Array.from({ length: segmentCount }, (_, segmentIndex) => ({
    event: `ENGINEERING_KNOWLEDGE_CATALOGUE_${kind}_SEGMENT`,
    format: manifest.format,
    segmentIndex,
    segmentCount,
    sha256,
    ...metadata,
    payloadBase64: bytes.subarray(
      segmentIndex * TIMELINE_LOG_SLICE_BYTES,
      (segmentIndex + 1) * TIMELINE_LOG_SLICE_BYTES,
    ).toString('base64'),
  }));
  return { manifest, segments };
}

export function engineeringReadTimelineLogParts(
  timeline: NonNullable<ReturnType<EngineeringReadPhaseObservation['timelineSnapshot']>>,
) {
  return engineeringReadLogParts(timeline, 'TIMELINE', {
    truncated: timeline.truncated, droppedEvents: timeline.droppedEvents,
  });
}

export function engineeringReadWindowLogParts(
  windows: ReturnType<EngineeringReadPhaseObservation['windowSnapshot']>,
) {
  return engineeringReadLogParts(windows, 'WINDOWS', {
    droppedWindows: windows.droppedWindows,
  });
}

/** Request-local telemetry. Scopes share storage, never mutable root context. */
export class EngineeringReadPhaseObservation {
  readonly context: Readonly<EngineeringReadScope>;
  private readonly collector: Collector;

  constructor(options: { timeline?: boolean; maxEvents?: number } = {},
    collector?: Collector, context: EngineeringReadScope = {}) {
    this.collector = collector ?? {
      started: performance.now(), phases: new Map(), timeline: options.timeline === true,
      maxEvents: Math.min(2048, Math.max(0, Math.floor(options.maxEvents ?? 1024))),
      events: [], names: [], scopes: [], nameIndices: new Map(), scopeIndices: new Map(),
      bytes: 512, dropped: 0, nextInstance: 0, windows: [], droppedWindows: 0,
    };
    // Explicit numeric allowlist also prevents accidental payloads reaching logs.
    const safe: EngineeringReadScope = {};
    for (const key of ['windowIndex', 'rootSlot', 'readInstance', 'parentReadInstance',
      'attempt', 'depth', 'memberGroup'] as const) {
      const value = context[key];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) safe[key] = value;
    }
    this.context = Object.freeze(safe);
  }

  scope(patch: EngineeringReadScope): EngineeringReadPhaseObservation {
    return new EngineeringReadPhaseObservation({}, this.collector, { ...this.context, ...patch });
  }

  nextReadInstance(): number { return this.collector.nextInstance++; }

  async measure<T>(phase: string, read: () => Promise<T>): Promise<T> {
    const started = performance.now();
    let outcome: Outcome = 'error';
    try {
      const result = await read();
      outcome = 'ok';
      return result;
    } finally {
      this.record(phase, started, outcome);
    }
  }

  measureSync<T>(phase: string, read: () => T): T {
    const started = performance.now();
    let outcome: Outcome = 'error';
    try {
      const result = read();
      outcome = 'ok';
      return result;
    } finally {
      this.record(phase, started, outcome);
    }
  }

  mark(phase: string, outcome: Outcome = 'ok', counts: Counts = {}): void {
    const now = performance.now();
    this.append(phase, now, now, outcome, counts);
  }

  private record(phase: string, started: number, outcome: Outcome): void {
    const ended = performance.now();
    const elapsedMs = Math.round(ended - started);
    const previous = this.collector.phases.get(phase);
    this.collector.phases.set(phase, {
      count: (previous?.count ?? 0) + 1,
      totalMs: (previous?.totalMs ?? 0) + elapsedMs,
      maxMs: Math.max(previous?.maxMs ?? 0, elapsedMs),
    });
    if (phase === 'read_group_wait' && this.context.windowIndex !== undefined) {
      const c = this.collector;
      if (c.windows.length < 200) c.windows.push([this.context.windowIndex,
        Math.round((started - c.started) * 100) / 100,
        Math.round((ended - c.started) * 100) / 100, outcome]);
      else c.droppedWindows++;
    }
    this.append(phase, started, ended, outcome);
  }

  private append(phase: string, started: number, ended: number, outcome: Outcome, counts: Counts = {}): void {
    const c = this.collector;
    if (!c.timeline) return;
    if (c.events.length >= c.maxEvents) { c.dropped++; return; }
    // Stage names are code constants, never free-form errors or SQL.
    if (!/^[a-z][a-z0-9_]{0,79}$/u.test(phase)) { c.dropped++; return; }
    const nameIndex = c.nameIndices.get(phase);
    const scopeJson = JSON.stringify(this.context);
    const scopeIndex = c.scopeIndices.get(scopeJson);
    const relative = (value: number) => Math.round((value - c.started) * 100) / 100;
    const event: TimelineEvent = [nameIndex === undefined ? c.names.length : nameIndex,
      scopeIndex === undefined ? c.scopes.length : scopeIndex, relative(started), relative(ended), outcome];
    if (counts.participants !== undefined || counts.skipped !== undefined) {
      event.push(counts.participants ?? 0, counts.skipped ?? 0);
    }
    const bytes = JSON.stringify(event).length + 1 + (nameIndex === undefined ? phase.length + 3 : 0)
      + (scopeIndex === undefined ? scopeJson.length + 1 : 0);
    if (c.bytes + bytes > MAX_TIMELINE_BYTES) { c.dropped++; return; }
    if (nameIndex === undefined) { c.nameIndices.set(phase, c.names.length); c.names.push(phase); }
    if (scopeIndex === undefined) { c.scopeIndices.set(scopeJson, c.scopes.length); c.scopes.push(this.context); }
    c.events.push(event);
    c.bytes += bytes;
  }

  snapshot(): Record<string, Phase> { return Object.fromEntries(this.collector.phases); }

  elapsedMs(): number { return Math.round((performance.now() - this.collector.started) * 100) / 100; }

  windowSnapshot() {
    return { columns: ['windowIndex', 'start', 'end', 'waitOutcome'],
      timings: [...this.collector.windows], droppedWindows: this.collector.droppedWindows };
  }

  timelineSnapshot() {
    const c = this.collector;
    if (!c.timeline) return undefined;
    return { version: 1, unit: 'ms',
      columns: ['phase', 'scope', 'start', 'end', 'outcome', 'participants', 'skipped'],
      names: [...c.names], scopes: [...c.scopes], events: [...c.events],
      truncated: c.dropped > 0, droppedEvents: c.dropped,
      maxEvents: c.maxEvents, maxBytes: MAX_TIMELINE_BYTES };
  }
}

export async function observeEngineeringRead<T>(
  observation: EngineeringReadPhaseObservation | undefined,
  phase: string,
  read: () => Promise<T>,
): Promise<T> {
  return observation ? observation.measure(phase, read) : read();
}

export function observeEngineeringReadSync<T>(
  observation: EngineeringReadPhaseObservation | undefined,
  phase: string,
  read: () => T,
): T {
  return observation ? observation.measureSync(phase, read) : read();
}
