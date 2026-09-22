import { useCallback, useMemo } from 'react';

import useEngineeringMatter, {
  useEngineeringMatterWorkingRevision,
} from '@client/src/features/matter/useEngineeringMatter';
import { selectMatterWorkRevision } from '@client/src/features/matter/matter-work-selection';
import { buildSuiteMatterGraph } from './suite-matter-graph';

/** Exact historical selection never falls back to current or survives an identity change. */
export function useSuiteMatterGraph(
  matterId: string,
  workRef: string,
  session: number,
  authenticationRequired: boolean,
) {
  const workspace = useEngineeringMatter(
    matterId,
    session,
    authenticationRequired,
  );
  const current = workspace.data?.working.current ?? null;
  const needsHistory = Boolean(
    workRef && current?.matterWorkRevisionId !== workRef,
  );
  const historical = useEngineeringMatterWorkingRevision(
    matterId,
    workRef,
    session,
    authenticationRequired,
    needsHistory,
    workspace.revoked,
  );
  const revision = selectMatterWorkRevision(workRef, current, historical.data);
  const projection = useMemo(() => {
    if (
      !workspace.data ||
      workspace.revoked ||
      authenticationRequired ||
      (workRef && !revision)
    ) {
      return { graph: null, error: null };
    }
    try {
      return {
        graph: buildSuiteMatterGraph(
          workspace.data,
          workRef ? { workRef, revision } : undefined,
        ),
        error: null,
      };
    } catch (cause: unknown) {
      return {
        graph: null,
        error: cause instanceof Error ? cause.message : '图谱范围核对失败。',
      };
    }
  }, [
    authenticationRequired,
    revision,
    workRef,
    workspace.data,
    workspace.revoked,
  ]);
  const readError = workspace.error ?? historical.error;
  const blockingError =
    workspace.revoked ||
    historical.revoked ||
    !workspace.data ||
    (needsHistory && !revision) ||
    (!projection.graph && Boolean(projection.error))
      ? (readError ?? projection.error)
      : null;
  const warning =
    blockingError === null ? (readError ?? projection.error ?? null) : null;
  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([
      workspace.refresh(),
      needsHistory ? historical.refresh() : Promise.resolve(),
    ]);
  }, [historical.refresh, needsHistory, workspace.refresh]);
  return {
    graph: blockingError ? null : projection.graph,
    revision: blockingError || authenticationRequired ? null : revision,
    workspace: blockingError ? null : workspace.data,
    error: blockingError,
    warning,
    loading:
      workspace.loading || (needsHistory && historical.loading && !revision),
    refresh,
  };
}
