export interface DiscoveredActivityIdentity {
  parseRunId: string | null;
  candidateRevision: number | null;
  runRef: string | null;
}

/**
 * Discovery replaces the URL with the exact pins it read; registering the read
 * result under the normalized identity prevents the URL change from triggering
 * a second read of the very same saved candidate.
 */
export function discoveredTimelineIdentity(
  documentVersionId: string,
  replaceQuery: string,
  blocker: string | null,
  sessionRevision: number,
): { identity: string; pins: DiscoveredActivityIdentity } {
  const discovered = new URLSearchParams(replaceQuery);
  const parseRunId = discovered.get('parseRunId');
  const revisionText = discovered.get('candidateRevision');
  const runRef = discovered.get('runRef');
  const candidateRevision =
    revisionText !== null && /^\d+$/.test(revisionText)
      ? Number(revisionText)
      : null;
  const pins: DiscoveredActivityIdentity = {
    parseRunId: parseRunId ?? null,
    candidateRevision,
    runRef: runRef ?? null,
  };
  return {
    identity: JSON.stringify([
      documentVersionId,
      pins.parseRunId,
      pins.candidateRevision,
      pins.runRef,
      blocker,
      sessionRevision,
    ]),
    pins,
  };
}
