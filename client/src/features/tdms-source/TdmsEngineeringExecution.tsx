import { useRef } from 'react';
import type { TdmsFileServiceRecordReadResponse } from '@shared/tdms-file-service-import.interface';
import { canReadTdmsSourceBody } from '@shared/tdms-source-body-policy';
import { tdmsJsonText, tdmsSourceVersionLabel } from './tdms-source-presentation';
import { TdmsEngineeringExecutionDiagnostic } from './TdmsEngineeringExecutionDiagnostic';
import { engineeringExecutionSourceRef } from './tdms-engineering-execution-monitor';

const raw = (value: string | null): string => value === null ? '未取得' : value;

export function TdmsEngineeringExecution({ read, monitorScopeKey, onRefresh }: {
  read: TdmsFileServiceRecordReadResponse;
  monitorScopeKey?: string;
  onRefresh?: () => void;
}) {
  const section = useRef<HTMLElement>(null);
  if (read.record.recordKind !== 'ENGINEERING_FILE' || !canReadTdmsSourceBody(read)) return null;
  const execution = read.engineeringExecution;
  if (!execution) return <p>结构化单机执行反馈尚未取得；已有原始字段仍可单独阅读。</p>;
  if (execution.sourceRevisionRef !== read.record.sourceRevisionRef ||
      execution.sourceRecordId !== read.record.sourceRecordId) {
    return <p role="alert">单机执行反馈与当前来源修订不一致，请重新读取。</p>;
  }
  return <section ref={section} aria-label="公司工程文件单机执行反馈">
    <h4>单机执行反馈</h4>
    <p>本次读取：{tdmsSourceVersionLabel(execution.sourceVersion)} · 业务文件版本
      {' '}{execution.businessVersion ? tdmsSourceVersionLabel(execution.businessVersion, '业务文件') : '未取得'}</p>
    <p className="tdms-source-notice">仅展示本修订已读来源窗口。逐项执行要求和完整目标机队尚未取得，不能计算整份完成率。
      同机多条反馈分别保留；源状态、反馈存在或执行日期均不自动证明整份完成或措施效果。</p>
    <TdmsEngineeringExecutionDiagnostic read={read} scopeKey={monitorScopeKey} onRefresh={onRefresh} onLocate={ref => {
      const target = Array.from(section.current?.querySelectorAll<HTMLElement>('[data-tdms-execution-ref]') ?? [])
        .find(element => element.dataset.tdmsExecutionRef === ref);
      if (target) { target.scrollIntoView({ block: 'center' }); target.focus({ preventScroll: true }); }
    }} />
    {execution.windows.map(window => <section key={window.tableId} tabIndex={-1}
      data-tdms-execution-ref={engineeringExecutionSourceRef(execution.sourceRevisionRef, window.tableId)}>
      <h5>{window.tableTitle}</h5>
      <p>已读 {window.rows.length} 条来源行 · 已知 {window.observedAircraftCount} 个飞机原生身份
        {' '}· 源窗口声明 {window.reportedRowCount} 行</p>
      <p className="tdms-source-locator">来源观察时间 {window.observedAt} · Host 取得时间 {read.record.capturedAt}
        {' '}· 本次读取时间 {read.receipt.readAt}</p>
      <p className="tdms-source-notice">反馈日期、计划日期未作为独立字段取得；备注中的日期保留原文，不代替执行日期。
        窗口枚举状态：{window.enumerationState}{window.stopReason ? ` · ${window.stopReason}` : ''}</p>
      {window.rows.length ? <div className="tdms-execution-table-scroll">
        <table className="tdms-execution-table">
          <caption>已读单机来源行；按飞机原生身份去重统计，保留每条状态与反馈</caption>
          <thead><tr><th scope="col">飞机 / 来源状态</th><th scope="col">反馈单</th>
            <th scope="col">执行日期（原始）</th><th scope="col">到期日期（原始）</th>
            <th scope="col">源修改时间（原始）</th><th scope="col">状态备注 / 来源</th></tr></thead>
          <tbody>{window.rows.map(row => <tr key={row.sourceRecordId} tabIndex={-1}
            data-tdms-execution-ref={engineeringExecutionSourceRef(execution.sourceRevisionRef, window.tableId, row.sourceRecordId)}>
            <th scope="row">{raw(row.executionStatus.assetNumber)}<p>{row.stateRaw}</p>
              <small>{row.executionStatus.assetRef}</small></th>
            <td>{row.executionStatus.feedbackRef ? <>{raw(row.executionStatus.feedbackNumber)}
              <p className="tdms-source-locator">{row.executionStatus.feedbackRef}</p>
              <small>仅取得关联身份，反馈单正文未由此读取</small></> : '未取得反馈单关联'}</td>
            <td>{raw(row.executionStatus.executedDateRaw)}</td>
            <td>{raw(row.executionStatus.expiredDateRaw)}</td>
            <td>{row.sourceModifiedRaw}</td>
            <td className="tdms-source-full-text">{raw(row.executionStatus.stateComments)}
              <p>运营基地：{raw(row.executionStatus.operatorBase)}</p>
              <p className="tdms-source-locator">{row.number} · {row.sourceRecordId}</p>
              <p className="tdms-source-locator">工程文件：{row.executionStatus.engineeringDocumentNumber}
                {' '}· {row.executionStatus.engineeringDocumentRef}</p></td>
          </tr>)}</tbody>
        </table>
      </div> : <p>本来源窗口没有单机状态行；不据此认定目标机队为空或全部完成。</p>}
      <details><summary>来源窗口与筛选依据</summary>
        <p className="tdms-source-locator">{window.sourceLocator} · {window.tableId}</p>
        {window.sourceViewEvidence ? <pre>{tdmsJsonText(window.sourceViewEvidence)}</pre>
          : <p>原生视图与筛选依据未取得，窗口范围未知。</p>}
      </details>
    </section>)}
  </section>;
}
