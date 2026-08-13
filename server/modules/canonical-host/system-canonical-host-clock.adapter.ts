import type { CanonicalHostClockPort } from './canonical-host.types';

export class SystemCanonicalHostClockAdapter implements CanonicalHostClockPort {
  nowIso(): string {
    return new Date().toISOString();
  }
}
