import { useEffect, useState } from 'react';
import { getDocumentParsingPage } from '@client/src/api/canonical-host';
import type { CanonicalTimelineProjection } from '@shared/api.interface';

/**
 * Timeline event from the canonical host API
 * Maps to CanonicalTimelineEvent from shared/api.interface.ts
 */
export interface TimelineEvent {
  id: string;
  sequence: number;
  kind:
    | 'WORKITEM_REVISION'
    | 'DOCUMENT_VERSION_BOUND'
    | 'PACKAGE_READBACK'
    | 'READER_QUERY'
    | 'DYNAMIC_EVALUATION'
    | 'ENGINEER_REVIEW'
    | 'OVERALL_SYNTHESIS'
    | 'OVERALL_CONFIRMATION'
    | 'AEO_CANDIDATE'
    | 'FAILURE';
  label: string;
  status: string;
  detail: string;
  occurredAt: string | null;
  revision: number | null;
  artifactRef: string | null;
  actionAttemptId: string | null;
}

export type TimelineProjection = CanonicalTimelineProjection;

interface UseTimelineDataOptions {
  /** Work item ID to fetch timeline for */
  workItemId: string;
  /** Enable auto-refresh polling (default: false) */
  autoRefresh?: boolean;
  /** Refresh interval in milliseconds (default: 30000 = 30s) */
  refreshInterval?: number;
}

interface UseTimelineDataResult {
  timeline: TimelineProjection | null;
  events: TimelineEvent[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch timeline data from the canonical host API
 *
 * Fetches from: GET /api/canonical-host/work-items/:workItemId/document-parsing
 * Returns the `timeline` field from CanonicalDocumentParsingPageResponse
 *
 * @example
 * ```tsx
 * const { events, isLoading, error } = useTimelineData({
 *   workItemId: 'app_17bzc551rsg',
 *   autoRefresh: true
 * });
 * ```
 */
export function useTimelineData({
  workItemId,
  autoRefresh = false,
  refreshInterval = 30000,
}: UseTimelineDataOptions): UseTimelineDataResult {
  const [timeline, setTimeline] = useState<TimelineProjection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTimeline = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const data = await getDocumentParsingPage(workItemId, '');
      setTimeline(data.timeline);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTimeline();

    if (autoRefresh && refreshInterval > 0) {
      const interval = setInterval(fetchTimeline, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [workItemId, autoRefresh, refreshInterval]);

  return {
    timeline,
    events: timeline?.events ?? [],
    isLoading,
    error,
    refetch: fetchTimeline,
  };
}
