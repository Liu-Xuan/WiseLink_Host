import { useMemo } from 'react';
import type { DocumentTranslationReadingResponse } from '@shared/document-translation-reading.interface';
import { WiseLinkRuntimeMonitor } from './WiseLinkRuntimeMonitor';
import { adaptDocumentTranslationRead, translationDiagnosticAttempt, translationDiagnosticRevision } from './adapt-document-translation-read';

interface Props {
  read: DocumentTranslationReadingResponse | null;
  documentVersionId: string;
  parseRunId: string;
  scopeKey: string;
  observedAt: string | null;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onLocateRevision: (revisionId: string) => void;
  onOpenContinuation: () => void;
}

export default function DocumentTranslationRuntimeDiagnostic(props: Props) {
  const runtime = useMemo(() => adaptDocumentTranslationRead(props.read, props.documentVersionId, props.parseRunId, {
    scopeKey: props.scopeKey, observedAt: props.observedAt ?? '', label: '当前文档版本', mode: 'live',
    environment: '当前 Host 读取 · 观察时间为客户端读回时间',
    readState: props.refreshing ? 'refreshing' : props.error ? 'stale' : 'current', readError: props.error,
  }), [props.read, props.documentVersionId, props.parseRunId, props.scopeKey, props.observedAt, props.error, props.refreshing]);
  return <details aria-label="当前译文运行图">
    <summary>查看译文运行图</summary>
    <p>复用本页中文读取。仅观察翻译状态、选用块与阅读关系；尝试集合范围见节点说明，队列资源和就绪/ACK 时间尚未提供。</p>
    {props.error ? <p role="alert">{props.error}{runtime ? '。保留上次获权观察，尚未确认更新。' : ''}</p> : null}
    <WiseLinkRuntimeMonitor key={props.scopeKey} runtime={runtime} allowVerification={false}
      onRefresh={props.onRefresh} onNavigate={detail => {
        if (!runtime) return;
        const revision = translationDiagnosticRevision(detail, runtime);
        if (revision) props.onLocateRevision(revision);
        else if (translationDiagnosticAttempt(detail, runtime)) props.onOpenContinuation();
      }} />
  </details>;
}
