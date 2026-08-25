import { useMemo } from 'react';
import { History } from 'lucide-react';

import type {
  CanonicalTimelineEvent,
  CanonicalTimelineProjection,
} from '@shared/api.interface';

import './review-loop.css';

export interface RevisionTimelineProps {
  timeline: CanonicalTimelineProjection;
  /** 最多展示条数（默认 12，避免一次渲染全部） */
  limit?: number;
}

function kindLabel(kind: CanonicalTimelineEvent['kind']): string {
  switch (kind) {
    case 'WORKITEM_REVISION':
      return '修订';
    case 'DOCUMENT_VERSION_BOUND':
      return '文档绑定';
    case 'PACKAGE_READBACK':
      return '解析回读';
    case 'READER_QUERY':
      return 'Reader 查询';
    case 'DYNAMIC_EVALUATION':
      return '动态评估';
    case 'ENGINEER_REVIEW':
      return '工程师复核';
    case 'OVERALL_SYNTHESIS':
      return '整体综合';
    case 'OVERALL_CONFIRMATION':
      return '整体确认';
    case 'AEO_CANDIDATE':
      return 'AEO 候选';
    case 'FAILURE':
      return '失败';
    default:
      return kind;
  }
}

/**
 * 版本时间线（Spec R01 §4.3 分析过程与版本时间线）。
 * 只读投影：revision 如何形成、复核与重综合发生在何时。
 */
export default function RevisionTimeline({
  timeline,
  limit = 12,
}: RevisionTimelineProps) {
  const events = useMemo(
    () => timeline.events.slice(-limit).reverse(),
    [timeline.events, limit],
  );

  return (
    <section className="wl-revision-timeline-card" aria-label="版本时间线">
      <header>
        <History aria-hidden="true" />
        <div>
          <span>版本时间线 · 只读</span>
          <strong>版本与复核时间线</strong>
        </div>
        <small>
          {timeline.events.length} 条事件 · {timeline.boundary.note}
        </small>
      </header>
      <ul className="wl-revision-timeline">
        {events.length === 0 ? (
          <li className="wl-revision-timeline-empty">
            <span className="wl-revision-timeline-dot">—</span>
            <div className="wl-revision-timeline-body">
              <p>当前事项尚无可显示的时间线事件。</p>
            </div>
          </li>
        ) : (
          events.map((event) => (
            <li
              key={event.id}
              className={[
                event.kind === 'ENGINEER_REVIEW' ? 'is-review' : '',
                event.kind === 'FAILURE' ? 'is-failure' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="wl-revision-timeline-dot">
                {event.sequence % 100}
              </span>
              <div className="wl-revision-timeline-body">
                <header>
                  <strong>{event.label || kindLabel(event.kind)}</strong>
                  <code>{event.status}</code>
                  {event.revision !== null ? (
                    <code>rev {event.revision}</code>
                  ) : null}
                  <small>{event.occurredAt ?? '时间未提供'}</small>
                </header>
                {event.detail ? <p>{event.detail}</p> : null}
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
