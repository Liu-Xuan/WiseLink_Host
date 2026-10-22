import { useCallback, useEffect, useMemo } from 'react';
import { authorizeLcmNativeMatrix, readLcmNativeMatrix } from '@client/src/api/canonical-host';
import { buildLcmNativeIndex } from '@shared/lcm-native-matrix-core';
import { useLcmMatrixResource } from './useLcmMatrixResource';

/** Body identity contains only the read set and session, never local view controls. */
export function useLcmNativeMatrix(snapshotIds: string[], sessionGeneration: number, refresh: number,
  enabled: boolean, onLost: (error?: unknown) => void) {
  const idsKey: string = JSON.stringify(snapshotIds);
  const load = useCallback(async (signal: AbortSignal) => ({
    data: await readLcmNativeMatrix({ snapshotIds: JSON.parse(idsKey) as string[] }, signal),
    observedAt: new Date().toISOString(),
  }), [idsKey]);
  const resource = useLcmMatrixResource(JSON.stringify(['native', sessionGeneration, idsKey, refresh]),
    enabled, load, onLost);
  const index = useMemo(() => resource.value ? buildLcmNativeIndex(resource.value.data) : null, [resource.value]);

  useEffect(() => {
    if (!index || !enabled) return;
    const controller: AbortController = new AbortController();
    let pending: boolean = false;
    const recheck = (): void => {
      if (pending || document.visibilityState !== 'visible') return;
      pending = true;
      void authorizeLcmNativeMatrix({ snapshotIds: JSON.parse(idsKey) as string[],
        binding: index.data.binding }, controller.signal)
        .catch((error: unknown) => { if (!controller.signal.aborted) onLost(error); })
        .finally(() => { pending = false; });
    };
    const timer: ReturnType<typeof setInterval> = setInterval(recheck, 30000);
    window.addEventListener('focus', recheck);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', recheck); };
  }, [index, idsKey, enabled, onLost]);
  return { index, observedAt: resource.value?.observedAt ?? null, loading: resource.loading, error: resource.error };
}
