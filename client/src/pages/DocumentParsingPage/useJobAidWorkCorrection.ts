import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getCanonicalHostClientSessionGeneration,
  getCanonicalHostIdentityContext,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';
import {
  jobAidCorrectionFailureMessage,
  jobAidCorrectionStorageKey,
  readPendingJobAidCorrection,
  resolveJobAidCorrection,
  writePendingJobAidCorrection,
  type PendingJobAidCorrection,
} from './jobaid-work-correction';

interface CorrectionScope {
  session: number;
  workItemId: string;
  storageKey: string;
  live: boolean;
}
interface CorrectionState {
  ready: boolean;
  busy: boolean;
  pending: PendingJobAidCorrection | null;
  message: string;
  failed: boolean;
  missing: boolean;
}
const JOBAID_CORRECTION_INITIAL: CorrectionState = {
  ready: false, busy: false, pending: null, message: '', failed: false, missing: false,
};

export function useJobAidWorkCorrection(workItemId: string, enabled: boolean, onConfirmed: () => void) {
  const session: number = useSyncExternalStore(subscribeCanonicalHostClientSession,
    getCanonicalHostClientSessionGeneration, getCanonicalHostClientSessionGeneration);
  const [identityRetry, setIdentityRetry] = useState(0);
  const [state, setState] = useState<CorrectionState>(JOBAID_CORRECTION_INITIAL);
  const scope = useRef<CorrectionScope | null>(null);
  const submitting = useRef(false);
  const confirmed = useRef(onConfirmed);
  confirmed.current = onConfirmed;
  const current = (value: CorrectionScope): boolean => value.live &&
    scope.current === value && value.session === getCanonicalHostClientSessionGeneration();

  async function run(value: CorrectionScope, pending: PendingJobAidCorrection, action: 'READ' | 'SEND' | 'RETRY') {
    if (!current(value) || submitting.current) return;
    submitting.current = true;
    setState({ ready: true, busy: true, pending, message: '正在核对保存结果…', failed: false, missing: false });
    try {
      const result = await resolveJobAidCorrection(pending, action, () => current(value));
      if (!current(value)) return;
      if ('receipt' in result) {
        writePendingJobAidCorrection(value.storageKey, null);
        setState({ ready: true, busy: false, pending: null, failed: false, missing: false,
          message: result.receipt.status === 'SAVED'
            ? `已确认工作修订 ${result.receipt.workRevision} 的更正。整体意见仍需按该工作版本更新。`
            : `已核对工作修订 ${result.receipt.workRevision}，文案未变化。` });
        confirmed.current();
      } else {
        if (result.rejected) writePendingJobAidCorrection(value.storageKey, null);
        setState({ ready: true, busy: false, pending: result.rejected ? null : pending,
          message: result.missing && !pending.command
            ? '尚未查到原请求回执，请继续核对保存结果。'
            : jobAidCorrectionFailureMessage(result.error), failed: true, missing: result.missing });
        if (result.rejected) confirmed.current();
      }
    } catch (caught: unknown) {
      if (current(value)) setState({ ready: false, busy: false, pending, failed: true, missing: false,
        message: caught instanceof Error ? caught.message : '本标签页无法保留保存恢复记录，请核对原请求。' });
    } finally {
      submitting.current = false;
    }
  }

  useEffect(() => {
    if (!enabled) return;
    const value: CorrectionScope = { session, workItemId, storageKey: '', live: true };
    scope.current = value;
    setState(JOBAID_CORRECTION_INITIAL);
    void (async () => {
      try {
        const identity = await getCanonicalHostIdentityContext();
        if (!current(value)) return;
        value.storageKey = jobAidCorrectionStorageKey(identity, workItemId);
        const pending = readPendingJobAidCorrection(value.storageKey);
        if (pending && pending.workItemId !== workItemId) throw new Error('待核对记录不属于当前事项。');
        setState({ ...JOBAID_CORRECTION_INITIAL, ready: true, pending });
        if (pending) await run(value, pending, 'READ');
      } catch (caught: unknown) {
        if (current(value)) setState({ ...JOBAID_CORRECTION_INITIAL, failed: true,
          message: '更正入口暂时无法核对当前身份或保存恢复记录，请重新核对。' });
      }
    })();
    return () => { value.live = false; };
    // This scope follows the native session and WorkItem; work/read refreshes do not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, workItemId, enabled, identityRetry]);

  async function submit(pending: PendingJobAidCorrection): Promise<void> {
    const value: CorrectionScope | null = scope.current;
    if (!value || !current(value) || !state.ready || state.pending || submitting.current) return;
    try {
      const existing = readPendingJobAidCorrection(value.storageKey);
      if (existing) {
        await run(value, existing, 'READ');
        return;
      }
      // Persist identity before HTTP. The full payload remains only in this live component.
      writePendingJobAidCorrection(value.storageKey, pending);
    } catch {
      setState({ ...state, failed: true, message: '本标签页无法保留保存恢复记录，本次未发送。' });
      return;
    }
    await run(value, pending, 'SEND');
  }
  return { ...state, submit, recheck: () => setIdentityRetry((value) => value + 1),
    recover: (retry: boolean = false) => {
      if (scope.current && state.pending) void run(scope.current, state.pending, retry ? 'RETRY' : 'READ');
    } };
}
