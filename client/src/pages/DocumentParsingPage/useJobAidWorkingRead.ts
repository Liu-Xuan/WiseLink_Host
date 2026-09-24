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
    previous.latestAttempt?.attemptId === next.latestAttempt?.attemptId &&
    previous.latestAttempt?.status === next.latestAttempt?.status &&
    previous.executionStatus === next.executionStatus &&
    JSON.stringify(previous.activity) === JSON.stringify(next.activity) &&
    previous.currentInputChanged === next.currentInputChanged &&
    previous.overallStatus === next.overallStatus &&
    previous.overallBasedOnWorkRevisionRef ===
      next.overallBasedOnWorkRevisionRef
    ? previous
    : next;
}

export function jobAidReadAfterFailure(
  previous: JobAidWorkingReadModel | null,
  failure: Pick<CanonicalHostClientError, 'statusCode' | 'code'>,
): JobAidWorkingReadModel | null {
  return isTemporaryJobAidReadFailure(failure) ? previous : null;
}

/** Only a transport interruption or server failure may show a prior read. */
export function isTemporaryJobAidReadFailure(
  failure: Pick<CanonicalHostClientError, 'statusCode' | 'code'>,
): boolean {
  if (typeof failure.statusCode === 'number')
    return failure.statusCode >= 500 && failure.statusCode < 600;
  return ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'].includes(
    failure.code ?? '',
  );
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

export function useJobAidWorkingRead(
  workItemId: string,
  baseReadProof: object | null = null,
) {
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
  const stopped = useRef<{
    key: string;
    baseReadProof: object | null;
    failed: boolean;
  }>({
    key,
    baseReadProof,
    failed: false,
  });
  const [state, setState] = useState<{
    key: string;
    data: JobAidWorkingReadModel | null;
    error: string | null;
    temporaryError: boolean;
    /** A rejected JobAid read cannot regain base fallback by retrying JobAid. */
    revokedBaseReadProof: object | null | undefined;
  }>({
    key,
    data: null,
    error: null,
    temporaryError: false,
    revokedBaseReadProof: undefined,
  });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (
      stopped.current.key !== key ||
      stopped.current.baseReadProof !== baseReadProof
    )
      stopped.current = { key, baseReadProof, failed: false };
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
          throw Object.assign(new Error('返回内容不属于当前文档对象'), {
            code: 'JOBAID_READ_OBJECT_MISMATCH',
          });
        setState((previous) => ({
          key,
          data: preserveJobAidRead(
            previous.key === key ? previous.data : null,
            result,
          ),
          error: null,
          temporaryError: false,
          revokedBaseReadProof:
            previous.key === key ? previous.revokedBaseReadProof : undefined,
        }));
        if (shouldPollJobAidRead(result))
          timer = setTimeout(() => void read(), 6000);
      } catch (caught) {
        if (obsolete()) return;
        stopped.current = { key, baseReadProof, failed: true };
        const failure = caught as CanonicalHostClientError;
        const temporaryError = isTemporaryJobAidReadFailure(failure);
        setState((previous) => ({
          key,
          data: jobAidReadAfterFailure(
            previous.key === key ? previous.data : null,
            failure,
          ),
          error:
            caught instanceof Error ? caught.message : '已保存评估暂时无法读取',
          temporaryError,
          revokedBaseReadProof: temporaryError
            ? previous.key === key
              ? previous.revokedBaseReadProof
              : undefined
            : baseReadProof,
        }));
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [workItemId, key, session, active, visible, retry, baseReadProof]);
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : null,
    temporaryError: state.key === key && state.temporaryError,
    baseFallbackAllowed:
      state.key === key &&
      (state.revokedBaseReadProof === undefined ||
        state.revokedBaseReadProof !== baseReadProof),
    refresh: () => {
      stopped.current = { key, baseReadProof, failed: false };
      setRetry((value) => value + 1);
    },
  };
}
