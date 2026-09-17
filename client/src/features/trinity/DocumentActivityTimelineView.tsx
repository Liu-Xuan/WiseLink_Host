import { ArrowLeft } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import type { DocumentActivityReadingResponse } from '@shared/document-activity.interface';
import {
  ACTIVITY_TIMELINE_LANES,
  ACTIVITY_TIMELINE_WINDOWS,
  spanIntersects,
  timelineItems,
  timelinePlacedItems,
  type ActivityCalendarSpan,
  type ActivityTimelineItem,
  type ActivityTimelineWindow,
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
  window?: ActivityTimelineWindow;
  onWindowChange?: (window: ActivityTimelineWindow) => void;
  /** Injectable calendar year for deterministic current-year windows. */
  nowYear?: number;
}

const MAP = { left: 125, right: 955, width: 980 } as const;
const LANE_Y = [47, 88, 129, 170] as const;

interface TimelineDomain {
  minYear: number;
  maxYear: number;
  startMs: number;
  endMs: number;
}

function domainFor(
  mode: ActivityTimelineWindow,
  spans: ActivityCalendarSpan[],
  nowYear: number,
): TimelineDomain {
  let minYear = nowYear;
  let maxYear = nowYear;
  if (mode === 'all' && spans.length > 0) {
    minYear = new Date(Math.min(...spans.map((span) => span.start))).getUTCFullYear();
    maxYear = new Date(Math.max(...spans.map((span) => span.end))).getUTCFullYear();
  }
  if (mode === 'current-year') {
    minYear = nowYear;
    maxYear = nowYear;
  }
  return {
    minYear,
    maxYear,
    startMs: Date.UTC(minYear, 0, 1),
    endMs: Date.UTC(maxYear + 1, 0, 1) - 1,
  };
}

function laneClass(item: ActivityTimelineItem): string {
  return item.lane === 'materials' ? 'source' : item.lane;
}

function itemActions(
  item: ActivityTimelineItem,
  onOpenReading: (statementId: string) => void,
  onOpenAnchor?: (statementId: string, anchorId: string) => void,
  onNavigateGraph?: (statementId: string) => void,
) {
  return (
    <div className="activity-timeline-actions">
      <Button variant="outline" size="sm" onClick={() => onOpenReading(item.statement.statementId)}>阅读原文依据</Button>
      {[...new Set(item.statement.quotes.map((quote) => quote.anchorId))].map((anchorId) => (
        <Button key={anchorId} variant="ghost" size="sm" onClick={() => onOpenAnchor?.(item.statement.statementId, anchorId)}>锚点 {anchorId}</Button>
      ))}
      {onNavigateGraph ? <Button variant="ghost" size="sm" onClick={() => onNavigateGraph(item.statement.statementId)}>进入图谱</Button> : null}
    </div>
  );
}

export default function DocumentActivityTimelineView({
  reading, selectedStatementId, onSelectStatement, onOpenReading, onOpenAnchor, onNavigateGraph,
  loading = false, error = null, hasExactSource = false,
  window = 'all', onWindowChange, nowYear,
}: DocumentActivityTimelineViewProps) {
  const candidate = reading?.candidate ?? null;
  if (loading) return <section className="activity-timeline-empty" role="status"><h2>正在读取已保存时间声明…</h2></section>;
  if (error) return <section className="activity-timeline-empty" role="alert"><h2>时间轴读取失败</h2><p>{error}</p></section>;
  if (!reading || !candidate) return <section className="activity-timeline-empty" role="status">
    <h2>{hasExactSource ? '当前准确来源尚无已保存候选' : '从资料库选择准确版本'}</h2>
    <p>{hasExactSource ? '当前来源身份已准确固定，但没有可显示的已保存候选。' : '时间轴只读取当前文档版本已保存的活动候选，不默认使用示例或其他版本。'}</p>
  </section>;

  const year = nowYear ?? new Date().getFullYear();
  const items = timelineItems(candidate);
  const placed = timelinePlacedItems(items);
  const undated = items.filter((item) => item.span === null);
  const domain = domainFor(window, placed.map((item) => item.span!), year);
  const windowStart = window === 'current-year' ? Date.UTC(year, 0, 1) : domain.startMs;
  const windowEnd = window === 'current-year' ? Date.UTC(year + 1, 0, 1) - 1 : domain.endMs;
  const inWindow = placed.filter((item) => spanIntersects(item.span!, windowStart, windowEnd));
  const outOfWindow = placed.filter((item) => !spanIntersects(item.span!, windowStart, windowEnd));
  const selected = candidate.statements.find((statement) => statement.statementId === selectedStatementId) ?? null;
  const selectedOutsideWindow = selected
    ? outOfWindow.some((item) => item.statement.statementId === selected.statementId)
    : false;
  const x = (ms: number) => MAP.left + ((ms - domain.startMs) / (domain.endMs - domain.startMs)) * (MAP.right - MAP.left);
  const yearTicks: number[] = [];
  for (let tick = domain.minYear; tick <= domain.maxYear + 1; tick += 1) yearTicks.push(tick);
  const singleYear = domain.minYear === domain.maxYear;

  return <div className="activity-timeline-layout" data-testid="activity-timeline">
    <section className="activity-timeline">
      <div className="activity-timeline-toolbar">
        <div className="activity-timeline-axis" role="group" aria-label="时间轴坐标">
          <button type="button" className="active">工程历程</button>
          <button type="button" disabled title="当前合同尚未提供系统取得时间">信息取得</button>
        </div>
        <div className="activity-timeline-filters" role="group" aria-label="时间窗">
          {ACTIVITY_TIMELINE_WINDOWS.map((entry) => (
            <button key={entry.id} type="button" data-window={entry.id}
              className={window === entry.id ? 'active' : ''}
              disabled={!onWindowChange}
              onClick={() => onWindowChange?.(entry.id)}>{entry.label}</button>
          ))}
          <span className="activity-window-count">窗口内 {inWindow.length} 条 · 窗口外 {outOfWindow.length} 条 · 无时间 {undated.length} 条</span>
        </div>
      </div>

      <header className="activity-timeline-head"><div>
        <div className="eyebrow">已保存时间声明 · 文档版本 {reading.binding.documentVersionId}</div>
        <h2>活动时间轴</h2>
        <p>保存时间 {candidate.savedAt} · 解析版本 {reading.binding.parseRunId} · 候选 {candidate.runRef} / r{candidate.candidateRevision} · 时间窗 {window === 'all' ? `${domain.minYear}–${domain.maxYear} 全部保存时间` : `${year} 年`}</p>
      </div></header>

      <div className="activity-timeline-map"><svg viewBox={`0 0 ${MAP.width} 205`} role="img" aria-label="四类工程记录的跨年时间分布">
        {yearTicks.map((tick) => {
          const tickX = x(Date.UTC(tick, 0, 1));
          return <g key={tick}>
            <line className="activity-map-line" x1={tickX} y1="25" x2={tickX} y2="186" />
            <text x={tickX} y="15" textAnchor={tick === domain.minYear ? 'start' : tick === domain.maxYear + 1 ? 'end' : 'middle'}>{tick}年</text>
          </g>;
        })}
        {singleYear ? [0, 3, 6, 9].map((offset) => {
          const tickX = x(Date.UTC(domain.minYear, offset, 1));
          return <g key={`m${offset}`}>
            <line className="activity-map-line activity-map-line-minor" x1={tickX} y1="32" x2={tickX} y2="186" />
            <text x={tickX} y="24" textAnchor="middle">{offset + 1}月</text>
          </g>;
        }) : null}
        {ACTIVITY_TIMELINE_LANES.map((lane, index) => <g key={lane.id}>
          <text x="3" y={LANE_Y[index] + 4}>{lane.label}</text>
          <line className="activity-map-line" x1="123" x2="955" y1={LANE_Y[index]} y2={LANE_Y[index]} />
        </g>)}
        {inWindow.map((item, index) => {
          const laneIndex = ACTIVITY_TIMELINE_LANES.findIndex((lane) => lane.id === item.lane);
          const y = LANE_Y[Math.max(0, laneIndex)] + (index % 2 ? 6 : -6);
          const startX = x(item.span!.start);
          const endX = Math.max(x(item.span!.end), startX + 1.5);
          const midX = (startX + endX) / 2;
          return <g key={item.statement.statementId} role="button" tabIndex={0}
            aria-label={item.statement.label} className={selectedStatementId === item.statement.statementId ? 'selected' : ''}
            onClick={() => onSelectStatement(item.statement.statementId)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelectStatement(item.statement.statementId); }}>
            <line className="activity-map-range" x1={startX} x2={endX} y1={y} y2={y} />
            <circle className="activity-map-range-cap" cx={startX} cy={y} r="3" />
            <circle className="activity-map-range-cap" cx={endX} cy={y} r="3" />
            <circle cx={midX} cy={y} r="13" fill="transparent" />
          </g>;
        })}
      </svg></div>

      <div className="activity-timeline-list">{inWindow.map((item) => <article
        className={`activity-timeline-item ${selectedStatementId === item.statement.statementId ? 'selected' : ''}`}
        key={item.statement.statementId}>
        <button type="button" className="activity-timeline-select" onClick={() => onSelectStatement(item.statement.statementId)}>
          <span className="activity-time">{item.displayTime}<small>来源时间 · {item.span!.precision}</small></span>
          <span className="activity-timeline-copy">
            <span className="activity-timeline-meta"><i className={`activity-lane-indicator ${laneClass(item)}`} />资料与厂家进展 · {item.time?.role ?? 'UNKNOWN'}</span>
            <strong>{item.statement.label}</strong>
            <small>声明 {item.statement.statementId} · 原词 {item.statement.statusRaw ?? '未提供'} · 精度 {item.time?.precision ?? 'UNKNOWN'}</small>
          </span>
        </button>
        {itemActions(item, onOpenReading, onOpenAnchor, onNavigateGraph)}
      </article>)}</div>

      {outOfWindow.length > 0 ? <section className="activity-window-context">
        <h3>窗口外声明 · 保留为上下文</h3>
        <p>以下声明有明确年份但不属于当前时间窗，不参与窗口内计数。</p>
        {outOfWindow.map((item) => <article key={item.statement.statementId}
          className={`activity-timeline-item ${selectedStatementId === item.statement.statementId ? 'selected' : ''}`}>
          <button type="button" className="activity-timeline-select" onClick={() => onSelectStatement(item.statement.statementId)}>
            <span className="activity-time">{item.displayTime}<small>窗口外 · {item.span!.precision}</small></span>
            <span className="activity-timeline-copy"><strong>{item.statement.label}</strong><small>声明 {item.statement.statementId} · 原词保留，不在当前窗口计数</small></span>
          </button>
          {itemActions(item, onOpenReading, onOpenAnchor, onNavigateGraph)}
        </article>)}
      </section> : null}

      {undated.length > 0 ? <section className="activity-undated"><h3>日期未定／尚无可计算时间</h3>
        {undated.map((item) => <article key={item.statement.statementId}
          className={`activity-timeline-item ${selectedStatementId === item.statement.statementId ? 'selected' : ''}`}>
          <button type="button" className="activity-timeline-select" onClick={() => onSelectStatement(item.statement.statementId)}>
            <span className="activity-time">{item.displayTime}<small>未确定时间</small></span>
            <span className="activity-timeline-copy"><strong>{item.statement.label}</strong><small>声明 {item.statement.statementId} · 保留原词</small></span>
          </button>
          {itemActions(item, onOpenReading, onOpenAnchor, onNavigateGraph)}
        </article>)}
      </section> : null}

      <footer className="activity-timeline-foot"><ArrowLeft size={14} /> 时间区按声明原词归类；Q、TBD、相对时间和缺少可靠坐标均保留在原词或未确定区，不猜测日期。</footer>
    </section>

    <aside className="activity-timeline-inspector" aria-label="当前时间声明">
      <div className="activity-timeline-inspector-eyebrow">资料与厂家进展 · 已保存候选</div>
      {selected ? <>
        <h2>{selected.label}</h2>
        <p className="activity-timeline-inspector-lead">{selected.time?.raw ?? '当前声明没有可作为日期坐标的时间原词。'}</p>
        <dl><dt>时间性质</dt><dd>{selected.time?.role ?? 'UNKNOWN'}</dd><dt>精度</dt><dd>{selected.time?.precision ?? 'UNKNOWN'}</dd><dt>原始状态</dt><dd>{selected.statusRaw ?? '未提供'}</dd><dt>准确来源</dt><dd>{reading.binding.documentVersionId}<br />{reading.binding.parseRunId}</dd></dl>
        {selectedOutsideWindow ? <p className="activity-window-note">该声明在当前时间窗外，仅作为上下文保留，不计入窗口数量。</p> : null}
        {selected.limitations.length ? <div className="activity-timeline-limitations"><strong>限制</strong>{selected.limitations.map((item) => <p key={item}>{item}</p>)}</div> : null}
        <section className="activity-history-boundary"><h3>预计变化边界</h3><p>当前候选没有跨版本活动身份。相似标题不会自动拼成“同一活动”的预计历史；取得有依据的身份关系后再按版本展示。</p></section>
        <div className="activity-timeline-inspector-actions">
          <Button size="sm" onClick={() => onOpenReading(selected.statementId)}>阅读原文依据</Button>
          {[...new Set(selected.quotes.map((quote) => quote.anchorId))].map((anchorId) => <Button key={anchorId} variant="ghost" size="sm" onClick={() => onOpenAnchor?.(selected.statementId, anchorId)}>锚点 {anchorId}</Button>)}
          {onNavigateGraph ? <Button variant="outline" size="sm" onClick={() => onNavigateGraph(selected.statementId)}>查看同一声明关系</Button> : null}
        </div>
      </> : <><h2>选择一条时间声明</h2><p className="activity-timeline-inspector-lead">选择左侧条目后，在这里核对原词、时间性质、限制与准确来源。</p><dl><dt>候选</dt><dd>{candidate.runRef} / r{candidate.candidateRevision}</dd><dt>保存时间</dt><dd>{candidate.savedAt}</dd></dl></>}
    </aside>
  </div>;
}
