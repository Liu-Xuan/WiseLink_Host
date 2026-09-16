import { ArrowLeft } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import type { DocumentActivityReadingResponse } from '@shared/document-activity.interface';
import {
  ACTIVITY_TIMELINE_LANES,
  timelineLaneItems,
} from './document-activity-timeline';
import './document-activity-timeline.css';

export interface DocumentActivityTimelineViewProps {
  reading: DocumentActivityReadingResponse | null;
  selectedStatementId: string | null;
  onSelectStatement: (statementId: string) => void;
  onOpenReading: (statementId: string) => void;
  onOpenAnchor?: (statementId: string, anchorId: string) => void;
  onNavigateGraph?: (statementId: string) => void;
  loading?: boolean;
  error?: string | null;
  hasExactSource?: boolean;
}

export default function DocumentActivityTimelineView({
  reading, selectedStatementId, onSelectStatement, onOpenReading, onOpenAnchor, onNavigateGraph,
  loading = false, error = null, hasExactSource = false,
}: DocumentActivityTimelineViewProps) {
  const candidate = reading?.candidate ?? null;
  if (loading) return <section className="activity-timeline-empty" role="status"><h2>正在读取已保存时间声明…</h2></section>;
  if (error) return <section className="activity-timeline-empty" role="alert"><h2>时间轴读取失败</h2><p>{error}</p></section>;
  if (!reading || !candidate) {
    return (
      <section className="activity-timeline-empty" role="status">
        <h2>{hasExactSource ? '当前准确来源尚无已保存候选' : '从资料库选择准确版本'}</h2>
        <p>{hasExactSource ? '当前来源身份已准确固定，但没有可显示的已保存候选。' : '时间轴只读取当前文档版本已保存的活动候选，不默认使用示例或其他版本。'}</p>
      </section>
    );
  }
  const selected = candidate.statements.find((statement) => statement.statementId === selectedStatementId) ?? null;
  return (
    <div className="activity-timeline-layout" data-testid="activity-timeline">
      <section className="activity-timeline">
        <header className="activity-timeline-head">
        <div>
          <div className="eyebrow">已保存时间声明 · 文档版本 {reading.binding.documentVersionId}</div>
          <h2>活动时间轴</h2>
          <p>保存时间 {candidate.savedAt} · 解析版本 {reading.binding.parseRunId} · 候选 {candidate.runRef} / r{candidate.candidateRevision}</p>
        </div>
        </header>
        <div className="activity-timeline-lanes">
        {ACTIVITY_TIMELINE_LANES.map((lane) => {
          const items = timelineLaneItems(candidate, lane.id);
          return (
            <section className="activity-lane" key={lane.id} data-lane={lane.id}>
              <div className="activity-lane-title"><span>{lane.label}</span><Badge variant="outline">{lane.id === 'materials' ? items.length : '—'}</Badge></div>
              {items.length === 0 ? <p className="activity-lane-empty">{lane.id === 'materials' ? '本候选的已交付范围内没有时间声明，不代表全文没有活动。' : '该类业务记录尚未接入本次读取。'}</p> : items.map((item) => (
                <article className={`activity-timeline-item ${selectedStatementId === item.statement.statementId ? 'selected' : ''}`} key={item.statement.statementId}>
                  <button type="button" className="activity-timeline-select" onClick={() => onSelectStatement(item.statement.statementId)}>
                    <span className="activity-time">{item.displayTime}</span><span>日期坐标尚未核定 · {item.time?.role ?? 'UNKNOWN'} · {item.time?.precision ?? 'UNKNOWN'}</span>
                    <strong>{item.statement.label}</strong>
                    <small>声明 {item.statement.statementId} · 原词 {item.statement.statusRaw ?? '未提供'}</small>
                  </button>
                    {item.statement.quotes.length > 0 ? <span className="activity-anchor-links">{[...new Set(item.statement.quotes.map((quote) => quote.anchorId))].map((anchorId) => <button type="button" key={anchorId} onClick={(event) => { event.stopPropagation(); onOpenAnchor?.(item.statement.statementId, anchorId); }}>锚点 {anchorId}</button>)}</span> : null}
                  <div className="activity-timeline-actions">
                    <Button variant="outline" size="sm" onClick={() => onOpenReading(item.statement.statementId)}>阅读原文依据</Button>
                    {onNavigateGraph ? <Button variant="ghost" size="sm" onClick={() => onNavigateGraph(item.statement.statementId)}>进入图谱</Button> : null}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
        </div>
        <footer className="activity-timeline-foot"><ArrowLeft size={14} /> 时间区按声明原词归类；Q、TBD、相对时间和缺少可靠坐标均保留在原词或未确定区。</footer>
      </section>
      <aside className="activity-timeline-inspector" aria-label="当前时间声明">
        <div className="activity-timeline-inspector-eyebrow">资料与厂家进展 · 已保存候选</div>
        {selected ? <>
          <h2>{selected.label}</h2>
          <p className="activity-timeline-inspector-lead">{selected.time?.raw ?? '当前声明没有可作为日期坐标的时间原词。'}</p>
          <dl>
            <dt>时间性质</dt><dd>{selected.time?.role ?? 'UNKNOWN'}</dd>
            <dt>精度</dt><dd>{selected.time?.precision ?? 'UNKNOWN'}</dd>
            <dt>原始状态</dt><dd>{selected.statusRaw ?? '未提供'}</dd>
            <dt>准确来源</dt><dd>{reading.binding.documentVersionId}<br />{reading.binding.parseRunId}</dd>
          </dl>
          {selected.limitations.length ? <div className="activity-timeline-limitations"><strong>限制</strong>{selected.limitations.map((item) => <p key={item}>{item}</p>)}</div> : null}
          <div className="activity-timeline-inspector-actions">
            <Button size="sm" onClick={() => onOpenReading(selected.statementId)}>阅读原文依据</Button>
            {onNavigateGraph ? <Button variant="outline" size="sm" onClick={() => onNavigateGraph(selected.statementId)}>查看同一声明关系</Button> : null}
          </div>
        </> : <>
          <h2>选择一条时间声明</h2>
          <p className="activity-timeline-inspector-lead">选择左侧条目后，在这里核对原词、时间性质、限制与准确来源。</p>
          <dl><dt>候选</dt><dd>{candidate.runRef} / r{candidate.candidateRevision}</dd><dt>保存时间</dt><dd>{candidate.savedAt}</dd></dl>
        </>}
      </aside>
    </div>
  );
}
