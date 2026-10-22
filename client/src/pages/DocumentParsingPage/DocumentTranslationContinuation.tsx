import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ContinueDocumentTranslationRequest, DocumentTranslationBrowserAction,
  DocumentTranslationContinuationPreparation } from '@shared/document-translation-browser.interface';
import { continueDocumentTranslation, getCanonicalHostClientSessionGeneration,
  prepareDocumentTranslationContinuation, subscribeCanonicalHostClientSession } from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';

interface Props {
  documentVersionId: string;
  parseRunId: string;
  observationKey: string;
  onContinued: () => void;
  onAccessRejected: (message: string) => void;
}

const actionLabels: Record<DocumentTranslationBrowserAction, string> = {
  RESUME_KNOWN_FAILURE: '检查已保存译文并继续',
  RECOVER_KNOWN_FAILURE: '继续未生成部分',
  CONTINUE_PARTIAL: '继续剩余可修复部分',
  RECOVER_EXPIRED: '继续尚未开始的翻译',
};
const reasonLabels: Record<string, string> = {
  OWN_UPLOAD_TRANSLATION_REQUIRED: '当前文档没有可在此续接的本人上传翻译请求；其他来源请使用原处理入口。',
  EXISTING_EXECUTION: '已有执行在排队或处理中，已保存的有效译文可继续阅读。',
  COMMIT_IN_PROGRESS: '原执行正在提交，需等待原执行完成。',
  GENERATION_OUTCOME_UNKNOWN: '原生成结果仍待核对；请使用原处理入口核对，不重复发起翻译。',
  TARGET_READABLE: '当前计划范围已有可读译文，具体覆盖与限制见下方。',
  REPAIR_REMAINING_BLOCKS: '复用已有译文，仅处理本次可修复的剩余块。',
  CHECK_SAVED_BLOCKS_FIRST: '已有候选译文会先检查和选用，再接续未完成范围。',
  UNCLAIMED_EXECUTION_EXPIRED: '上次执行尚未被领取即已超时，可沿原请求继续。',
  KNOWN_FAILURE_WITHOUT_OUTPUT: '上次生成已确认失败且未保存输出，可沿原请求继续。',
  REMAINING_SOURCE_OR_REPAIR_LIMITATIONS: '剩余范围包含原文或修复限制，请在原处理入口核对。',
};

export default function DocumentTranslationContinuation(props: Props) {
  const session = useSyncExternalStore(subscribeCanonicalHostClientSession,
    getCanonicalHostClientSessionGeneration, getCanonicalHostClientSessionGeneration);
  const identity = JSON.stringify([props.documentVersionId, props.parseRunId, session]);
  return <ContinuationState key={identity} {...props} identity={identity} />;
}

function ContinuationState(props: Props & { identity: string }) {
  const identity = props.identity;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const callbacks = useRef(props);
  callbacks.current = props;
  const [snapshot, setSnapshot] = useState<{ identity: string; value: DocumentTranslationContinuationPreparation } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<ContinueDocumentTranslationRequest | null>(null);
  const inFlight = useRef(false);
  const postController = useRef<AbortController | null>(null);
  const current = snapshot?.identity === identity ? snapshot.value : null;

  useEffect(() => {
    setError(null); setPending(null); setSending(false); inFlight.current = false;
    return () => { postController.current?.abort(); };
  }, [identity]);
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    void prepareDocumentTranslationContinuation(props.documentVersionId, props.parseRunId, controller.signal)
      .then(value => {
        if (!controller.signal.aborted && identityRef.current === identity) {
          setSnapshot({ identity, value }); setError(null);
        }
      }).catch((caught: unknown) => {
        if (controller.signal.aborted || identityRef.current !== identity) return;
        const message = caught instanceof Error ? caught.message : '译文续接状态未读回，请重新核对。';
        setError(message);
        if (isAccessRejection(caught)) callbacks.current.onAccessRejected(message);
      });
    return () => controller.abort();
  }, [identity, props.observationKey, retry]);

  const submit = async () => {
    if (inFlight.current) return;
    const input: ContinueDocumentTranslationRequest | null = pending ?? (current?.action && current.attempt ? {
      parseRunId: props.parseRunId, expectedAttemptRef: current.attempt.attemptRef, action: current.action,
    } : null);
    if (!input) return;
    const startedIdentity = identity;
    const controller = new AbortController();
    postController.current = controller;
    inFlight.current = true; setSending(true); setPending(input); setError(null);
    try {
      await continueDocumentTranslation(props.documentVersionId, input, controller.signal);
      if (controller.signal.aborted || identityRef.current !== startedIdentity) return;
      setPending(null); setSnapshot(null); setRetry(value => value + 1);
      callbacks.current.onContinued();
    } catch (caught) {
      if (controller.signal.aborted || identityRef.current !== startedIdentity) return;
      const message = caught instanceof Error ? caught.message : '续接受理结果尚未确认。';
      setError(message);
      const status = errorStatus(caught);
      if (status !== null && status >= 400 && status < 500) {
        setPending(null); setSnapshot(null);
      }
      if (isAccessRejection(caught)) callbacks.current.onAccessRejected(message);
    } finally {
      if (identityRef.current === startedIdentity) { inFlight.current = false; setSending(false); }
    }
  };

  return <section aria-label="译文续接" className="space-y-2">
    <p className="text-sm text-muted-foreground">此处仅支持本人已选择全文中文翻译的上传文档；其他已获权来源仍从原处理入口续接。</p>
    {current ? <p role="status">{reasonLabels[current.reason] ?? '当前状态需在原处理入口核对，已有有效译文保留。'}</p>
      : !error ? <p role="status">正在核对原翻译请求…</p> : null}
    {error ? <p role="alert">{error}{pending ? ' 受理结果尚未确认；核对时复用原请求。' : ''}</p> : null}
    <div className="flex flex-wrap gap-2">
      {(pending || current?.action) ? <Button size="sm" disabled={sending} onClick={() => void submit()}>
        {sending ? '正在核对并受理…' : pending ? '核对本次续接' : actionLabels[current!.action!]}
      </Button> : null}
      <Button size="sm" variant="outline" disabled={sending} onClick={() => setRetry(value => value + 1)}>重新核对</Button>
    </div>
  </section>;
}

function errorStatus(error: unknown): number | null {
  return error !== null && typeof error === 'object' && 'statusCode' in error &&
    typeof error.statusCode === 'number' ? error.statusCode : null;
}
function isAccessRejection(error: unknown): boolean {
  return [401, 403, 404].includes(errorStatus(error) ?? 0);
}
