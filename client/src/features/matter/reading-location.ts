import {
  getCanonicalHostClientSessionGeneration,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';

import type { AssessmentClaimSelection } from './assessment-reading';

export interface ReadingLocation {
  scrollY: number;
  claim: AssessmentClaimSelection | null;
  focusClaimId: string | null;
  discussionClaimId: string | null;
  expandedIssueRefs?: string[];
  expandedDirectoryKeys?: string[];
}

// Navigation metadata only; saved business content and authority never enter this map.
const readingLocations: Map<string, ReadingLocation> = new Map();
subscribeCanonicalHostClientSession(() => readingLocations.clear());

export function readReadingLocation(scopeKey: string): ReadingLocation | null {
  return readingLocations.get(scopeKey) ?? null;
}

export function saveReadingLocation(
  scopeKey: string,
  location: ReadingLocation,
  session: number,
): void {
  if (session === getCanonicalHostClientSessionGeneration())
    readingLocations.set(scopeKey, location);
}

export function clearReadingLocation(scopeKey: string): void {
  readingLocations.delete(scopeKey);
}

export function matterReadingScope(matterId: string, workRef = ''): string {
  const base = `matter:${encodeURIComponent(matterId)}`;
  return workRef ? `${base}:work:${encodeURIComponent(workRef)}` : base;
}

export function clearMatterReadingLocations(matterId: string): void {
  const base = matterReadingScope(matterId);
  for (const key of readingLocations.keys()) {
    if (key === base || key.startsWith(`${base}:work:`))
      readingLocations.delete(key);
  }
}
