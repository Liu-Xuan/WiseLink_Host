import { useEffect, useState } from 'react';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import {
  getCanonicalHostClientSessionGeneration,
  getCanonicalLibraryFleetCatalog,
} from '@client/src/api/canonical-host';
import { libraryReadErrorPresentation } from './library-read-error';

export interface LibraryFleetRead {
  catalog: CanonicalLibraryFleetCatalog | null;
  loading: boolean;
  error: string | null;
}

export function useLibraryFleetCatalog(
  sessionGeneration: number,
  enabled: boolean,
  refreshRevision: number,
): LibraryFleetRead {
  const [read, setRead] = useState<
    (LibraryFleetRead & { generation: number }) | null
  >(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setRead({
      generation: sessionGeneration,
      catalog: null,
      loading: true,
      error: null,
    });
    const current = () =>
      !controller.signal.aborted &&
      getCanonicalHostClientSessionGeneration() === sessionGeneration;
    void getCanonicalLibraryFleetCatalog(controller.signal)
      .then((catalog) => {
        if (current())
          setRead({
            generation: sessionGeneration,
            catalog,
            loading: false,
            error: null,
          });
      })
      .catch((reason: unknown) => {
        if (current())
          setRead({
            generation: sessionGeneration,
            catalog: null,
            loading: false,
            error: libraryReadErrorPresentation(reason).message,
          });
      });
    return () => controller.abort();
  }, [sessionGeneration, enabled, refreshRevision]);
  return enabled && read?.generation === sessionGeneration
    ? read
    : { catalog: null, loading: enabled, error: null };
}
