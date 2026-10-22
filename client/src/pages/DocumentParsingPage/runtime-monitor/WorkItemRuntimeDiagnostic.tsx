import { useMemo } from 'react';
import type { JobAidWorkingReadState } from '../useJobAidWorkingRead';
import { adaptJobAidWorkingRead } from './adapt-jobaid-working-read';
import { WiseLinkRuntimeMonitor } from './WiseLinkRuntimeMonitor';
import type { NavigationRequest, RuntimeProjection } from './monitor-types';

interface Props {
  read: JobAidWorkingReadState;
  workItemId: string;
  sessionGeneration: number;
  observationMode?: 'live' | 'snapshot';
  environment?: string;
  onRefresh: () => void;
  onOpenPanel: (panel: 'assessment' | 'review' | 'reader') => void;
}

/** Navigation is bounded to the currently authorized observation, not arbitrary refs. */
export function diagnosticNavigationPanel(
  detail: NavigationRequest,
  runtime: RuntimeProjection,
  workItemId: string,
): 'assessment' | 'review' | 'reader' | null {
  if (detail.scopeKey !== runtime.meta.scopeKey || (detail.subjectRef && detail.subjectRef !== workItemId)) return null;
  const node = runtime.nodes.find((item) => item.id === detail.nodeId);
  if (!node) return null;
  if (detail.kind === 'request') {
    const record = node.requests.find((item) => item.id === detail.ref);
    if (!record || record.recordKind !== detail.recordKind) return null;
    if (record.recordKind === 'attempt' ? detail.attemptId !== record.id || Boolean(detail.requestId) : detail.requestId !== record.id || Boolean(detail.attemptId)) return null;
  } else {
    const refs = detail.kind === 'artifact' ? node.outputs : detail.kind === 'source' ? node.inputRefs : [];
    if (!refs.some((item) => item.ref === detail.ref)) return null;
  }
  // A revision reference alone is not a source locator. Read the exact refs in assessment.
  return detail.kind === 'request' ? 'review' : 'assessment';
}

export default function WorkItemRuntimeDiagnostic({
  read, workItemId, sessionGeneration, onRefresh, onOpenPanel, observationMode = 'live', environment,
}: Props) {
  const scopeKey = `${sessionGeneration}:${workItemId}`;
  const runtime = useMemo(() => adaptJobAidWorkingRead(
    read.data?.workItemId === workItemId ? read.data : null,
    {
      observedAt: read.observedAt ?? '',
      environment: environment ?? (observationMode === 'snapshot' ? '本地回放 · 非实时运行' : '当前 Host 读取 · 观察时间为客户端读回时间'),
      scopeKey,
      label: workItemId,
      mode: observationMode,
      readState: read.isRefreshing ? 'refreshing' : read.error ? 'stale' : 'current',
      readError: read.error,
    },
  ), [read.data, read.observedAt, read.error, read.isRefreshing, scopeKey, workItemId, observationMode, environment]);
  return (
    <section aria-label="当前事项运行诊断">
      <p>仅显示本事项的 JobAid 调查与综合消费关系；不代表全系统运行或正式批准。就绪、首次可读与 ACK 时间尚未提供；已列事件时间不替代这些时间。</p>
      {read.error ? <p role="alert">诊断读取失败：{read.error}{runtime ? '。保留上次获权观察，尚未确认更新。' : ''}</p> : null}
      <WiseLinkRuntimeMonitor
        key={scopeKey}
        runtime={runtime}
        allowVerification={false}
        onRefresh={onRefresh}
        onNavigate={(detail) => {
          if (!runtime) return;
          const panel = diagnosticNavigationPanel(detail, runtime, workItemId);
          if (panel) onOpenPanel(panel);
        }}
      />
    </section>
  );
}
