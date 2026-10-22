import type { TdmsFileServiceRecordReadResponse } from '@shared/tdms-file-service-import.interface';
import { canReadTdmsSourceBody } from '@shared/tdms-source-body-policy';
import type { NavigationRequest, RuntimeProjection } from '@client/src/pages/DocumentParsingPage/runtime-monitor/monitor-types';

/** Local reading locator, never a fetch URL or an assertion of execution. */
export function engineeringExecutionSourceRef(revision: string, tableId: string, rowId?: string): string {
  return `tdms-execution:${JSON.stringify([revision, tableId, rowId ?? null])}`;
}

export function engineeringExecutionMonitorScope(read: TdmsFileServiceRecordReadResponse, parentScope?: string): string {
  return JSON.stringify([parentScope ?? 'exact-read-receipt', read.record.sourceInstanceId,
    read.record.sourceRecordId, read.record.sourceRevisionRef, read.receipt.receiptRef,
    read.receipt.permissionRevision, read.receipt.readAt]);
}

/** Pure projection of the same authorized response rendered by the source table. */
export function adaptEngineeringExecutionRead(
  read: TdmsFileServiceRecordReadResponse, parentScope?: string,
): RuntimeProjection | null {
  if (read.record.recordKind !== 'ENGINEERING_FILE' || !canReadTdmsSourceBody(read)) return null;
  const execution = read.engineeringExecution;
  if (!execution) return null;
  const revision = read.record.sourceRevisionRef;
  if (execution.sourceRevisionRef !== revision || execution.sourceRecordId !== read.record.sourceRecordId ||
      read.receipt.sourceRevisionRef !== revision || !read.receipt.readPerformed)
    throw new Error('单机执行观察与当前准确来源或读取回执不一致');
  const rows = execution.windows.flatMap(window => window.rows);
  const aircraft = new Set(rows.map(row => row.executionStatus.assetRef));
  const outputs = execution.windows.flatMap(window => [
    { label: `${window.tableTitle} · 已读 ${window.rows.length} 行`,
      ref: engineeringExecutionSourceRef(revision, window.tableId) },
    ...window.rows.map(row => ({ label: `${row.number} · ${row.executionStatus.assetNumber ?? row.executionStatus.assetRef} · 源状态 ${row.stateRaw}`,
      ref: engineeringExecutionSourceRef(revision, window.tableId, row.sourceRecordId) })),
  ]);
  const coverage = { label: '未知：逐项执行要求与完整目标机队未取得', tone: 'wait' as const };
  const coverageScope = '仅本修订已读来源窗口；无逐要求身份和完整目标分母，不计算整份完成率';
  const requestCoverage = '未提供全局请求或尝试集合；来源状态行不是 Host 执行请求';
  const windows = execution.windows.map(window => `${window.tableTitle}（${window.tableId}）：观察 ${window.observedAt}，`
    + `已读 ${window.rows.length} / 源声明 ${window.reportedRowCount} 行，枚举 ${window.enumerationState}`
    + `${window.stopReason ? `，停止原因 ${window.stopReason}` : ''}`).join('；');
  return {
    schemaVersion: 1,
    meta: { mode: 'live', observedAt: read.receipt.readAt, environment: '当前 Host 已获权来源读取 · 时间来自准确读取回执',
      scopeKey: engineeringExecutionMonitorScope(read, parentScope), readState: 'current' },
    scope: { id: revision, label: read.record.title || read.record.sourceRecordId,
      model: `TDMS 工程文件 · 来源修订 ${revision}` },
    nodes: [{
      id: 'business.aeo_execution', label: '工程文件单机来源观察', group: '公司与机队事实', kind: 'fact',
      execution: '未取得 Host 执行请求；仅观察来源行',
      artifact: `已读 ${execution.windows.length} 个窗口、${rows.length} 条来源行、${aircraft.size} 个飞机原生身份`,
      coverage, coverageScope, business: '整份落实状态未知；来源 Completed、反馈关联或执行日期不证明业务完成',
      sourceObservedAt: read.record.observedAt,
      summary: `Host 取得时间 ${read.record.capturedAt}。${windows || '未取得来源窗口。'} 执行要求覆盖 NOT_CAPTURED；目标机队 UNKNOWN；执行核验未完成。`,
      requestCompleteness: 'not_provided', requestCoverage, requests: [], outputs, inputRefs: [],
    }, {
      id: 'surface.reading', label: '本修订单机来源表', group: '阅读交付', kind: 'view',
      execution: '只读视图，无独立执行', artifact: `${outputs.length} 个准确来源表或行定位`,
      coverage, coverageScope, business: '展示已读来源，不创建正式采用或执行确认',
      summary: `本次读取时间 ${read.receipt.readAt}；回执 ${read.receipt.receiptRef}。点击来源定位返回同一修订的表或行；反馈正文未由关联身份推定已读。`,
      requestCompleteness: 'not_provided', requestCoverage, requests: [], outputs: [], inputRefs: outputs,
    }],
    edges: outputs.length ? [{ id: `${revision}:execution-reading`, templateId: 'artifact.reading',
      from: 'business.aeo_execution', to: 'surface.reading', status: 'consumed',
      label: '本次阅读实际展示的来源表与行', refs: outputs.map(item => item.ref) }] : [],
  };
}

/** Accept only a locator that is still present in the current authorized read. */
export function engineeringExecutionDiagnosticReference(detail: NavigationRequest, runtime: RuntimeProjection): string | null {
  if (detail.scopeKey !== runtime.meta.scopeKey || (detail.subjectRef && detail.subjectRef !== runtime.scope.id)) return null;
  const node = runtime.nodes.find(item => item.id === detail.nodeId);
  const refs = detail.kind === 'artifact' ? node?.outputs : detail.kind === 'source' ? node?.inputRefs : null;
  return refs?.some(item => item.ref === detail.ref) ? detail.ref! : null;
}
