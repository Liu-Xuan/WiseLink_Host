import { useMemo } from 'react';
import { CircleDashed, UserCheck, XCircle } from 'lucide-react';

import type { CanonicalTimelineProjection } from '@shared/api.interface';

import './review-loop.css';

export interface TaskPillsProps {
  timeline: CanonicalTimelineProjection;
}

interface TaskView {
  key: string;
  label: string;
  state:
    | 'running'
    | 'done'
    | 'failed'
    | 'pending'
    | 'waiting'
    | 'review'
    | 'confirmed'
    | 'candidate'
    | 'stale'
    | 'conflict'
    | 'obsolete'
    | 'cancelled';
  note: string;
}

const TASK_KINDS: ReadonlyArray<{
  kind: string;
  label: string;
}> = [
  { kind: 'DYNAMIC_EVALUATION', label: '动态评估' },
  { kind: 'OVERALL_SYNTHESIS', label: '整体综合' },
  { kind: 'OVERALL_CONFIRMATION', label: '整体确认' },
  { kind: 'AEO_CANDIDATE', label: 'AEO 候选' },
];

function stateFromStatus(
  status: string,
  kind: CanonicalTimelineProjection['events'][number]['kind'],
): TaskView['state'] {
  const upper = status.toUpperCase();
  if (upper.includes('FAIL') || upper.includes('ERROR')) return 'failed';
  if (upper.includes('CONFLICT')) return 'conflict';
  if (upper.includes('STALE')) return 'stale';
  if (upper.includes('CANCELLED')) return 'cancelled';
  if (upper.includes('OBSOLETE') || upper.includes('SUPERSEDED')) {
    return 'obsolete';
  }
  if (upper.includes('REVIEW_REQUIRED') || upper.includes('NEEDS_REVIEW')) {
    return 'review';
  }
  if (upper.includes('HUMAN_CONFIRMED')) return 'confirmed';
  if (upper.includes('WAITING_INPUT') || upper.includes('WAITING')) {
    return 'waiting';
  }
  // CANDIDATE_READY / CANDIDATE_ONLY 均只是可复核候选，不是业务完成。
  if (upper.includes('CANDIDATE')) return 'candidate';
  if (upper.includes('RUN') || upper.includes('PROGRESS')) return 'running';
  if (upper.includes('QUEUE') || upper.includes('PENDING')) return 'pending';
  if (
    upper.includes('SUCCEEDED') ||
    upper.includes('COMPLETE') ||
    upper.includes('DONE')
  ) {
    if (kind === 'OVERALL_CONFIRMATION') return 'confirmed';
    if (
      kind === 'DYNAMIC_EVALUATION' ||
      kind === 'OVERALL_SYNTHESIS' ||
      kind === 'AEO_CANDIDATE'
    ) {
      return 'candidate';
    }
    return 'done';
  }
  if (upper.includes('CONFIRMED')) return 'confirmed';
  return 'pending';
}

function stateLabel(state: TaskView['state']): string {
  if (state === 'done') return '已完成';
  if (state === 'running') return '进行中';
  if (state === 'failed') return '未完成';
  if (state === 'waiting') return '等待补充';
  if (state === 'review') return '待人工复核';
  if (state === 'confirmed') return '人工确认已记录';
  if (state === 'candidate') return '候选待复核';
  if (state === 'stale') return '结论需更新';
  if (state === 'conflict') return '基于旧版本';
  if (state === 'obsolete') return '已被替代';
  if (state === 'cancelled') return '已取消';
  return '等待中';
}

function safeTaskNote(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() ?? '';
  if (
    !normalized ||
    /OPENCLAW|ACTIONATTEMPT|SHA-?256|\b[0-9a-f]{40,64}\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[A-Z][A-Z0-9_]{3,}\b/iu.test(
      normalized,
    )
  ) {
    return fallback;
  }
  return normalized.slice(0, 180);
}

/**
 * 任务胶囊（Spec R01 §4.3 / §2.2）。
 * OpenClaw 后台任务只暴露「任务、进度、结果、失败原因」；
 * 前端不轮询、不伪造进度，只读 Host current 投影。
 */
export default function TaskPills({ timeline }: TaskPillsProps) {
  const tasks = useMemo<TaskView[]>(() => {
    return TASK_KINDS.flatMap(({ kind, label }) => {
      const latest = [...timeline.events]
        .reverse()
        .find((event) => event.kind === kind);
      if (!latest) return [];
      const state = stateFromStatus(latest.status, latest.kind);
      const statusLabel = stateLabel(state);
      return [
        {
          key: kind,
          label,
          state,
          note: safeTaskNote(latest.detail || latest.label, statusLabel),
        },
      ];
    });
  }, [timeline.events]);

  return (
    <div className="wl-task-pills" role="status" aria-label="分析任务状态">
      {tasks.length === 0 ? (
        <span className="wl-task-pills-empty">当前暂无分析进度记录</span>
      ) : null}
      {tasks.map((task) => (
        <span
          key={task.key}
          className={`wl-task-pill is-${task.state}`}
          title={task.note}
        >
          {task.state === 'running' ? (
            <span
              className="wl-status-dot"
              data-pulse="true"
              aria-hidden="true"
            />
          ) : task.state === 'failed' ? (
            <XCircle aria-hidden="true" />
          ) : task.state === 'confirmed' ? (
            <UserCheck aria-hidden="true" />
          ) : task.state === 'done' ? null : (
            <CircleDashed aria-hidden="true" />
          )}
          {task.label} · {stateLabel(task.state)}
        </span>
      ))}
    </div>
  );
}
