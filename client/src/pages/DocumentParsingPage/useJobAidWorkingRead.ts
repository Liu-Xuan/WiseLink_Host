import { useEffect, useState } from 'react';
import {
  getCanonicalHostClientSessionGeneration,
  readJobAidAssessmentWork,
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

export function useJobAidWorkingRead(workItemId: string) {
  const active: boolean = useWorkbenchPanelActive();
  const [data, setData] = useState<JobAidWorkingReadModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<number>(0);
  useEffect(() => {
    if (!active) return;
    const session: number = getCanonicalHostClientSessionGeneration();
    let cancelled: boolean = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (): Promise<void> => {
      try {
        const result = await readJobAidAssessmentWork(workItemId);
        if (cancelled || session !== getCanonicalHostClientSessionGeneration())
          return;
        if (
          result.workItemId !== workItemId ||
          (result.current && result.current.workItemId !== workItemId)
        )
          throw new Error('返回内容不属于当前文档对象');
        setData((previous) => preserveJobAidRead(previous, result));
        setError(null);
        if (result.enabled) timer = setTimeout(() => void read(), 6000);
      } catch (caught) {
        if (cancelled || session !== getCanonicalHostClientSessionGeneration())
          return;
        const failure = caught as CanonicalHostClientError;
        setData((previous) => jobAidReadAfterFailure(previous, failure));
        // A read/network failure does not erase an already saved work revision.
        setError(
          caught instanceof Error ? caught.message : '已保存评估暂时无法读取',
        );
      }
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workItemId, active, retry]);
  return { data, error, refresh: () => setRetry((value) => value + 1) };
}
