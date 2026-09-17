import { useEffect, useMemo, useState } from 'react';
import { getEngineeringMatterWorkingRevision } from '@client/src/api/engineering-matter';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import useEngineeringMatter from '@client/src/features/matter/useEngineeringMatter';
import { selectMatterWorkRevision } from '@client/src/features/matter/matter-work-selection';
import { buildSuiteMatterGraph } from './suite-matter-graph';

/** Exact historical selection never falls back to current or survives an identity change. */
export function useSuiteMatterGraph(matterId: string, workRef: string, session: number, authenticationRequired: boolean) {
  const workspace = useEngineeringMatter(matterId, session, authenticationRequired);
  const key = JSON.stringify([matterId, workRef, session]);
  const [history, setHistory] = useState<{key: string; revision: EngineeringMatterWorkingRevisionReadModel | null; error: string | null} | null>(null);
  const current = workspace.data?.working.current ?? null;
  const needsHistory = Boolean(workRef && current?.matterWorkRevisionId !== workRef);
  useEffect(() => {
    if (!workspace.data || !needsHistory || authenticationRequired) return;
    const controller = new AbortController();
    setHistory(null);
    void getEngineeringMatterWorkingRevision(matterId, workRef, controller.signal).then(revision => {
      if (!controller.signal.aborted && getCanonicalHostClientSessionGeneration() === session) setHistory({key, revision, error: null});
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && getCanonicalHostClientSessionGeneration() === session) {
        setHistory({key, revision: null, error: cause instanceof Error ? cause.message : '读取指定工作失败。'});
      }
    });
    return () => controller.abort();
  }, [workspace.data, needsHistory, authenticationRequired, matterId, workRef, session, key]);
  const revision = selectMatterWorkRevision(workRef, current, history?.key === key ? history.revision : null);
  const projection = useMemo(() => {
    if (!workspace.data || workspace.error || authenticationRequired || (workRef && !revision)) return {graph: null, error: null};
    try {
      return {graph: buildSuiteMatterGraph(workspace.data, workRef ? {workRef, revision} : undefined), error: null};
    } catch (cause: unknown) {
      return {graph: null, error: cause instanceof Error ? cause.message : '图谱范围核对失败。'};
    }
  }, [workspace.data, workspace.error, authenticationRequired, workRef, revision]);
  const error = workspace.error ?? (needsHistory && history?.key === key ? history.error : null) ?? projection.error;
  return {
    graph: error ? null : projection.graph,
    revision: error || authenticationRequired ? null : revision,
    workspace: workspace.data,
    error,
    loading: workspace.loading || Boolean(workRef && !revision && !error),
    refresh: workspace.refresh,
  };
}
