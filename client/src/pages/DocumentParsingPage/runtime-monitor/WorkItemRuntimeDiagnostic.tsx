import { useMemo, useState } from 'react';
import type { JobAidWorkingReadState } from '../useJobAidWorkingRead';
import { adaptJobAidWorkingRead, savedNativeObservations, type JobAidWorkingObservation, type SavedNativeObservation } from './adapt-jobaid-working-read';
import { tdmsSourceVersionLabel } from '@/features/tdms-source/tdms-source-presentation';
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

function SavedNativeDetail({ observation, work, onClose }: {
  observation: SavedNativeObservation;
  work: NonNullable<JobAidWorkingObservation['current']>;
  onClose: () => void;
}) {
  const evidence = observation.evidence;
  const source = evidence.nativeSource;
  const receipt = evidence.nativeReadReceipt;
  const binding = evidence.nativeScope.processingSetBinding;
  const approval = evidence.nativeScope.approval;
  return <section aria-label="已保存 TDMS 来源详情" className="mt-4 rounded-xl border p-4 break-words">
    <div className="flex items-start justify-between gap-4">
      <h3 className="font-semibold">{evidence.title}</h3>
      <button type="button" className="rounded border px-3 py-1" onClick={onClose}>关闭来源详情</button>
    </div>
    <p>来自工作 {work.workRevision} 保存的获权响应 · 历史 READ {receipt.readAt}</p>
    <p>{tdmsSourceVersionLabel(source.sourceVersion)}</p>
    <p>{source.businessVersion ? tdmsSourceVersionLabel(source.businessVersion, '业务文件') : '业务文件版本未取得'}</p>
    <p>当前有效性 UNKNOWN；最新性未提供。源声明 Estimated 批准依据对应下列精确技术版本。</p>
    <p>本回执未创建工程正式采用，未验证执行结果。</p>
    <blockquote className="my-3 whitespace-pre-wrap border-l-2 pl-3">{evidence.excerpt}</blockquote>
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
      <dt>来源记录</dt><dd>{source.sourceRecordId} · {source.recordRef}</dd>
      <dt>准确源观察</dt><dd>{source.sourceRevisionRef}</dd>
      <dt>读取回执</dt><dd>{receipt.receiptRef}</dd>
      <dt>保存工作</dt><dd>{work.workRevisionRef} · 保存于 {work.createdAt}</dd>
      <dt>工作请求 / 尝试</dt><dd>{work.requestId} / {work.actionAttemptId}</dd>
      <dt>工作资料版本</dt><dd>{work.documentVersionId}</dd>
      <dt>来源观察 / 捕获</dt><dd>{source.observedAt} / {source.capturedAt}</dd>
      <dt>保存的来源覆盖</dt><dd>{source.coverage.status} · {source.coverage.readback}</dd>
    </dl>
    {source.coverage.gaps.length ? <p>来源缺口：{source.coverage.gaps.join('；')}</p> : null}
    {evidence.nativeScope.limitations.length ? <p>原始限制：{evidence.nativeScope.limitations.join('；')}</p> : null}
    <details className="mt-3 text-sm">
      <summary>核对精确证据、批准依据与字段</summary>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt>证据引用</dt><dd>{evidence.evidenceRef}</dd>
        <dt>来源实例</dt><dd>{source.sourceKey} / {source.sourceInstanceId}</dd>
        <dt>原读取任务</dt><dd>{receipt.taskContextRef}</dd>
        <dt>原读取用途</dt><dd>{receipt.purpose}</dd>
        <dt>原读取权限版本</dt><dd>{receipt.permissionRevision}</dd>
        <dt>保存的处理集合</dt><dd>{binding.setRevisionRef} · generation {binding.generation}</dd>
        <dt>处理族 / 批次</dt><dd>{binding.processingFamilyRef} / {binding.cohortRef}</dd>
        <dt>处理观察 / 成员</dt><dd>{binding.processingObservationRef} / {binding.memberRef}</dd>
        <dt>批准捕获依据</dt><dd>{approval.captureRef} · {approval.evidencePath} · {approval.mode}</dd>
        <dt>批准前后观察</dt><dd>{approval.before.observedAt} / {approval.after.observedAt}</dd>
        <dt>已读取字段</dt><dd>{evidence.nativeScope.fieldSelectors.map(item => <div key={item.fieldPath}>{item.fieldPath} → {item.selector}</div>)}</dd>
      </dl>
    </details>
  </section>;
}

export default function WorkItemRuntimeDiagnostic({
  read, workItemId, sessionGeneration, onRefresh, onOpenPanel, observationMode = 'live', environment,
}: Props) {
  const scopeKey = `${sessionGeneration}:${workItemId}`;
  const acknowledgement = read.data?.workItemId === workItemId &&
    read.data.autoProcessingAcknowledgement?.workItemId === workItemId
    ? read.data.autoProcessingAcknowledgement : null;
  const [selected, setSelected] = useState<{ scopeKey: string; ref: string } | null>(null);
  const work = read.data?.enabled && read.data.workItemId === workItemId ? read.data.current : null;
  const native = useMemo(() => savedNativeObservations(work), [work]);
  // Keep only the key in state: every detail render resolves against the current parent response.
  const selectedSource = selected?.scopeKey === scopeKey
    ? native.observations.find(item => item.navigationRef === selected.ref) : undefined;
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
      <p>显示本事项已保存的 TDMS 来源读取、JobAid 调查与综合消费关系；当前读回时间不代表 TDMS 实时有效或最新。就绪与首次可读时间尚未提供；已列事件时间不替代这些时间。</p>
      {acknowledgement ? <p className="mt-2 break-words text-sm" aria-label="外层自动处理 ACK">
        外层自动处理 ACK（原请求 {acknowledgement.requestId}）：
        <time dateTime={acknowledgement.acknowledgedAt}>{acknowledgement.acknowledgedAt}</time>。
        此回执不表示后续调查或综合尝试已完成。
      </p> : <p>外层自动处理 ACK 时间尚未提供。</p>}
      {read.error ? <p role="alert">诊断读取失败：{read.error}{runtime ? '。保留上次获权观察，尚未确认更新。' : ''}</p> : null}
      <WiseLinkRuntimeMonitor
        key={scopeKey}
        runtime={runtime}
        allowVerification={false}
        onRefresh={onRefresh}
        onNavigate={(detail) => {
          if (!runtime) return;
          const panel = diagnosticNavigationPanel(detail, runtime, workItemId);
          if (!panel) return;
          const source = detail.kind === 'source' && native.observations.find(item => item.navigationRef === detail.ref);
          if (source) setSelected({ scopeKey, ref: source.navigationRef });
          else onOpenPanel(panel);
        }}
      />
      {work && selectedSource ? <SavedNativeDetail observation={selectedSource} work={work} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}
