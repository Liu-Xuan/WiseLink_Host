// Timeline Panel component - Phase 2.3: Real data integration
import React from 'react';
import { useTimelineData } from '../hooks/useTimelineData';

interface TimelinePanelProps {
  /** Work item ID to fetch timeline for */
  workItemId: string;
  /** Currently selected node ID for highlighting */
  selectedNodeId: string | null;
  /** Callback when clicking an event to locate its related node */
  onEventClick?: (artifactRef: string) => void;
}

/**
 * Timeline panel showing canonical work item processing events
 *
 * Displays server-observed events from the canonical host API including:
 * - Document version binding
 * - Package parsing
 * - Reader queries
 * - Dynamic evaluations
 * - Engineer reviews
 * - Overall synthesis
 */
export function TimelinePanel({ workItemId, selectedNodeId, onEventClick }: TimelinePanelProps) {
  const { events, isLoading, error } = useTimelineData({
    workItemId,
    autoRefresh: false
  });

  const handleEventClick = (artifactRef: string | null) => {
    if (artifactRef && onEventClick) {
      onEventClick(artifactRef);
    }
  };

  if (isLoading) {
    return (
      <div className="timeline-panel">
        <div className="timeline-header">
          <h3>时间线</h3>
        </div>
        <div className="timeline-content timeline-loading">
          <div className="loading-spinner">加载中...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="timeline-panel">
        <div className="timeline-header">
          <h3>时间线</h3>
        </div>
        <div className="timeline-content timeline-error">
          <div className="error-message">
            <strong>加载失败</strong>
            <p>{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="timeline-panel">
        <div className="timeline-header">
          <h3>时间线</h3>
        </div>
        <div className="timeline-content timeline-empty">
          <p>暂无事件</p>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-panel">
      <div className="timeline-header">
        <h3>时间线</h3>
        <span className="event-count">{events.length} 个事件</span>
      </div>
      <div className="timeline-content">
        {events.map((event) => (
          <div
            key={event.id}
            className={`timeline-event ${
              event.artifactRef === selectedNodeId ? 'selected' : ''
            } event-kind-${event.kind.toLowerCase()}`}
            onClick={() => handleEventClick(event.artifactRef)}
            role="button"
            tabIndex={0}
          >
            <div className="event-sequence">#{event.sequence}</div>
            <div className="event-content">
              <div className="event-label">{event.label}</div>
              <div className="event-status">{event.status}</div>
              <div className="event-detail">{event.detail}</div>
              {event.occurredAt && (
                <div className="event-time">
                  {new Date(event.occurredAt).toLocaleString('zh-CN')}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
