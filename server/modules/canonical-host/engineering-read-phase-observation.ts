import { performance } from 'node:perf_hooks';

/** Request-local durations only. Never attach actor, object IDs, or read bodies. */
export class EngineeringReadPhaseObservation {
  private readonly phases = new Map<string, { count: number; totalMs: number; maxMs: number }>();

  async measure<T>(phase: string, read: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await read();
    } finally {
      this.record(phase, performance.now() - started);
    }
  }

  measureSync<T>(phase: string, read: () => T): T {
    const started = performance.now();
    try {
      return read();
    } finally {
      this.record(phase, performance.now() - started);
    }
  }

  private record(phase: string, elapsed: number): void {
    const elapsedMs = Math.round(elapsed);
    const previous = this.phases.get(phase);
    this.phases.set(phase, {
      count: (previous?.count ?? 0) + 1,
      totalMs: (previous?.totalMs ?? 0) + elapsedMs,
      maxMs: Math.max(previous?.maxMs ?? 0, elapsedMs),
    });
  }

  snapshot(): Record<string, { count: number; totalMs: number; maxMs: number }> {
    return Object.fromEntries(this.phases);
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
