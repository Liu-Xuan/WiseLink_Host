import { useMemo } from 'react';
import { History } from 'lucide-react';

import type {
  CanonicalTimelineEvent,
  CanonicalTimelineProjection,
} from '@shared/api.interface';
import { humanState } from '@client/src/features/navigation/treeMappers';

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
      return '原文查询';
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
      return '状态变化';
  }
}

function safeDetail(detail: string | null | undefined): string | null {
  const value = detail?.trim() ?? '';
  if (
    !value ||
    /OPENCLAW|ACTIONATTEMPT|SHA-?256|\b[0-9a-f]{40,64}\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[A-Z][A-Z0-9_]{3,}\b/iu.test(
      value,
    )
  ) {
    return null;
  }
  return value.slice(0, 240);
}

function occurredAtLabel(value: string | null): string {
  if (!value) return '时间未提供';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '时间未提供';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
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
        <small>{timeline.events.length} 条可核验记录</small>
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
          events.map((event, index) => (
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
                {events.length - index}
              </span>
              <div className="wl-revision-timeline-body">
                <header>
                  <strong>{kindLabel(event.kind)}</strong>
                  <span className="wl-revision-state">
                    {humanState(event.status) ?? '状态待确认'}
                  </span>
                  {event.revision !== null ? (
                    <span className="wl-revision-state">
                      版本 {event.revision}
                    </span>
                  ) : null}
                  <small>{occurredAtLabel(event.occurredAt)}</small>
                </header>
                {safeDetail(event.detail) ? <p>{safeDetail(event.detail)}</p> : null}
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
