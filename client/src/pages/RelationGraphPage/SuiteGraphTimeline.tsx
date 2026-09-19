import { memo } from 'react';
import { CalendarClock, ChevronRight, FileClock } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import type {
  SuiteGraphTimelineEvent,
  SuiteGraphTimelineSource,
} from './suite-graph-timeline';

export interface SuiteGraphTimelineProps {
  events: SuiteGraphTimelineEvent[];
  sources: SuiteGraphTimelineSource[];
  selectedEventId: string | null;
  loading: boolean;
  onSelectEvent: (event: SuiteGraphTimelineEvent) => void;
  onOpenFullTimeline: (event: SuiteGraphTimelineEvent) => void;
  onExpandSource: (documentVersionId: string) => void;
}

const SOURCE_STATUS_LABELS: Record<string, string> = {
  loading: '正在读取…',
  loaded: '已读入声明',
  empty: '无已保存声明',
  unparsed: '尚无已发布解析',
  unavailable: '当前不可读',
  skipped: '未读取',
};

/**
 * Left column: source-declared events. Selecting an event highlights the same
 * statement node in the graph and shows the same statement in the knowledge panel;
 * events whose target is filtered out keep their selection notice instead of being
 * remapped. Events never merge into inferred engineering lanes.
 */
const SuiteGraphTimeline = memo(function SuiteGraphTimeline({
  events,
  sources,
  selectedEventId,
  loading,
  onSelectEvent,
  onOpenFullTimeline,
  onExpandSource,
}: SuiteGraphTimelineProps) {
  const hasSourceAttention = sources.some(
    (source) => source.status !== 'loaded' && source.status !== 'loading',
  );

  return (
    <div className="suite-graph-timeline" aria-label="来源声明事件">
      {sources.length > 0 ? (
        <details className="suite-graph-timeline-sources" open={hasSourceAttention}>
          <summary>来源读取状态（{sources.length}）</summary>
          <div role="list" aria-label="来源读取状态">
            {sources.map((source) => (
              <div className="suite-graph-timeline-source" role="listitem" key={source.documentVersionId}>
                <div className="suite-graph-timeline-source-row">
                  <b>{source.label}</b>
                  <span data-status={source.status}>{SOURCE_STATUS_LABELS[source.status] ?? source.status}</span>
                </div>
                {source.notice ? <p className="suite-graph-muted">{source.notice}</p> : null}
                {source.status === 'skipped' || source.status === 'unavailable' || source.status === 'empty' || source.status === 'unparsed' ? (
                  <Button size="sm" variant="ghost" onClick={() => onExpandSource(source.documentVersionId)}>
                    {source.status === 'skipped' ? '读取该来源声明' : '重新读取'}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {loading && events.length === 0 ? <p className="suite-graph-muted" role="status">正在读取来源声明…</p> : null}
      {!loading && events.length === 0 ? (
        <p className="suite-graph-muted">当前授权范围没有可进入的文档时间声明。</p>
      ) : null}
      <ol className="suite-graph-timeline-events">
        {events.map((event) => (
          <li key={event.id}>
            <div className={`suite-graph-timeline-event is-${event.kind}${selectedEventId === event.id ? ' is-selected' : ''}`}>
              <button
                type="button"
                className="suite-graph-timeline-event-main"
                aria-pressed={selectedEventId === event.id}
                onClick={() => onSelectEvent(event)}
              >
                <span className="suite-graph-timeline-event-date">
                  {event.kind === 'work' ? <FileClock aria-hidden="true" /> : <CalendarClock aria-hidden="true" />}
                  {event.date}
                </span>
                <b>{event.title}</b>
                <small>{event.detail}</small>
                {event.nodeId === null ? (
                  <small className="suite-graph-timeline-event-detached">该声明所属资料未入图，不映射到其他节点。</small>
                ) : null}
              </button>
              {event.pins ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="suite-graph-timeline-event-open"
                  onClick={() => onOpenFullTimeline(event)}
                >
                  完整时间轴 <ChevronRight aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
});

export default SuiteGraphTimeline;
