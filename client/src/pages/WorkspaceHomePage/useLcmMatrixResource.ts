import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTdmsReadResource } from '@client/src/features/tdms-source/useTdmsReadResource';
import { lcmMatrixAccessLost } from './lcm-matrix-route';

export const LCM_MATRIX_QUERY_ROOT = ['lcm-matrix'] as const;

/** Uses the existing QueryClient with generation-bound reads; no persisted raw/derived browser cache. */
export function useLcmMatrixResource<T>(key: string, enabled: boolean,
  load: (signal: AbortSignal) => Promise<T>, onLost: () => void) {
  const queryClient = useQueryClient();
  const scopedLoad = useCallback(async (signal: AbortSignal): Promise<T> => {
    try {
      return await queryClient.fetchQuery({ queryKey: [...LCM_MATRIX_QUERY_ROOT, key],
        queryFn: () => load(signal), staleTime: 0, gcTime: 0, retry: false });
    } catch (error) {
      if (!signal.aborted && lcmMatrixAccessLost(error)) onLost();
      throw error;
    }
  }, [key, load, onLost, queryClient]);
  useEffect(() => () => {
    void queryClient.cancelQueries({ queryKey: [...LCM_MATRIX_QUERY_ROOT, key] });
    queryClient.removeQueries({ queryKey: [...LCM_MATRIX_QUERY_ROOT, key] });
  }, [key, queryClient]);
  return useTdmsReadResource(key, enabled, scopedLoad, onLost);
}
