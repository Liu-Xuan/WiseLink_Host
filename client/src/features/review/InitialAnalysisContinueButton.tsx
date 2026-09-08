import { useRef, useState } from 'react';
import type { CanonicalInitialAnalysisContinuationRequest } from '@shared/api.interface';
import {
  requestInitialAnalysisContinuation,
  type CanonicalHostClientError,
} from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';

interface Props {
  workItemId: string;
  expectedRevision: number;
  operation: CanonicalInitialAnalysisContinuationRequest['operation'];
  blockIds?: string[];
  label: string;
  disabled?: boolean;
  onQueued: () => void;
  onAccessLost?: () => void;
}

/** A click submits a normal request. Reading/refreshing the page never does. */
export default function InitialAnalysisContinueButton(props: Props) {
  const key = `${props.workItemId}:${props.operation}:${JSON.stringify(props.blockIds ?? [])}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const pending = useRef<{
    key: string;
    input: CanonicalInitialAnalysisContinuationRequest;
  } | null>(null);
  const [state, setState] = useState({
    key,
    saving: false,
    message: '',
    failed: false,
  });
  const visible =
    state.key === key
      ? state
      : { key, saving: false, message: '', failed: false };
  async function send() {
    if (pending.current?.key !== key)
      pending.current = {
        key,
        input: {
          requestId: crypto.randomUUID(),
          expectedRevision: props.expectedRevision,
          operation: props.operation,
          ...(props.blockIds
            ? { retranslateBlockIds: [...props.blockIds] }
            : {}),
        },
      };
    setState({ key, saving: true, message: '', failed: false });
    try {
      const receipt = await requestInitialAnalysisContinuation(
        props.workItemId,
        pending.current.input,
      );
      if (currentKey.current !== key) return;
      pending.current = null;
      const active = [
        'QUEUED',
        'RUNNING',
        'RETRY_SCHEDULED',
        'COMMITTING',
      ].includes(receipt.status);
      setState({
        key,
        saving: false,
        failed: false,
        message: active
          ? '接续请求已保存，将沿用本事项的模型继续；已保存内容仍保留。'
          : receipt.status === 'SUCCEEDED'
            ? '已核对原请求的成功回执。'
            : '已核对原请求已结束。原记录保留，可再次发起新的接续。',
      });
      props.onQueued();
    } catch (error) {
      if (currentKey.current !== key) return;
      const failure = error as CanonicalHostClientError;
      const denied = [401, 403, 404].includes(failure.statusCode ?? 0);
      const knownRejection =
        denied || [400, 409].includes(failure.statusCode ?? 0);
      if (knownRejection) pending.current = null;
      setState({
        key,
        saving: false,
        failed: true,
        message: denied
          ? '当前事项已不可操作，请重新核对访问权限。'
          : knownRejection
            ? '当前版本或执行状态已变化，请刷新进度后再继续。'
            : '接续请求未确认。再次点击会核对同一请求，不会重复排队。',
      });
      if (denied) props.onAccessLost?.();
    }
  }
  return (
    <div className="wl-initial-continuation">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={props.disabled || visible.saving}
        onClick={() => {
          void send();
        }}
      >
        {visible.saving
          ? '正在保存请求…'
          : visible.failed && pending.current?.key === key
            ? '核对上次接续请求'
            : props.label}
      </Button>
      {visible.message ? (
        <p
          className="wl-initial-analysis-note"
          role={visible.failed ? 'alert' : 'status'}
        >
          {visible.message}
        </p>
      ) : null}
    </div>
  );
}
