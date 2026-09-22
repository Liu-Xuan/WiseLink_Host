import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getCanonicalHostClientSessionGeneration,
  readJobAidAssessmentWork,
  subscribeCanonicalHostClientSession,
  type CanonicalHostClientError,
} from '@client/src/api/canonical-host';
import { useWorkbenchPanelActive } from '@client/src/features/workbench/RetainedWorkbenchPanel';
import type { JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';

export function preserveJobAidRead(
  previous: JobAidWorkingReadModel | null,
  next: JobAidWorkingReadModel,
): JobAidWorkingReadModel {
  return previous?.workItemId === next.workItemId &&
    previous.enabled === next.enabled &&
    previous.current?.workRevisionRef === next.current?.workRevisionRef &&
    previous.executionStatus === next.executionStatus &&
    previous.currentInputChanged === next.currentInputChanged &&
    previous.overallStatus === next.overallStatus &&
    previous.overallBasedOnWorkRevisionRef ===
      next.overallBasedOnWorkRevisionRef
    ? previous
    : next;
}

export function jobAidReadAfterFailure(
  previous: JobAidWorkingReadModel | null,
  failure: Pick<CanonicalHostClientError, 'statusCode'>,
): JobAidWorkingReadModel | null {
  return [401, 403, 404].includes(failure.statusCode ?? 0) ? null : previous;
}

function subscribeVisibility(changed: () => void): () => void {
  document.addEventListener('visibilitychange', changed);
  return () => document.removeEventListener('visibilitychange', changed);
}

export function shouldPollJobAidRead(value: JobAidWorkingReadModel): boolean {
  return (
    value.enabled &&
    ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(
      value.executionStatus ?? '',
    )
  );
}

export function useJobAidWorkingRead(workItemId: string) {
  const active = useWorkbenchPanelActive();
  const session = useSyncExternalStore(
    subscribeCanonicalHostClientSession,
    getCanonicalHostClientSessionGeneration,
    getCanonicalHostClientSessionGeneration,
  );
  const visible = useSyncExternalStore(
    subscribeVisibility,
    () => !document.hidden,
    () => true,
  );
  const key = JSON.stringify([session, workItemId]);
  const stopped = useRef<{ key: string; failed: boolean }>({
    key,
    failed: false,
  });
  const [state, setState] = useState<{
    key: string;
    data: JobAidWorkingReadModel | null;
    error: string | null;
  }>({ key, data: null, error: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (stopped.current.key !== key) stopped.current = { key, failed: false };
    if (!active || !visible || stopped.current.failed) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const obsolete = () =>
      controller.signal.aborted ||
      session !== getCanonicalHostClientSessionGeneration();
    const read = async (): Promise<void> => {
      try {
        const result = await readJobAidAssessmentWork(
          workItemId,
          controller.signal,
        );
        if (obsolete()) return;
        if (
          result.workItemId !== workItemId ||
          (result.current && result.current.workItemId !== workItemId)
        )
          throw new Error('返回内容不属于当前文档对象');
        setState((previous) => ({
          key,
          data: preserveJobAidRead(
            previous.key === key ? previous.data : null,
            result,
          ),
          error: null,
        }));
        if (shouldPollJobAidRead(result))
          timer = setTimeout(() => void read(), 6000);
      } catch (caught) {
        if (obsolete()) return;
        stopped.current = { key, failed: true };
        const failure = caught as CanonicalHostClientError;
        setState((previous) => ({
          key,
          data: jobAidReadAfterFailure(
            previous.key === key ? previous.data : null,
            failure,
          ),
          error:
            caught instanceof Error ? caught.message : '已保存评估暂时无法读取',
        }));
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [workItemId, key, session, active, visible, retry]);
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : null,
    refresh: () => {
      stopped.current = { key, failed: false };
      setRetry((value) => value + 1);
    },
  };
}
