import { useMemo } from 'react';
import { CircleDashed, Loader2, XCircle } from 'lucide-react';

import type { CanonicalTimelineProjection } from '@shared/api.interface';

import './review-loop.css';

export interface TaskPillsProps {
  timeline: CanonicalTimelineProjection;
}

interface TaskView {
  key: string;
  label: string;
  state: 'running' | 'done' | 'failed' | 'pending';
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

function stateFromStatus(status: string): TaskView['state'] {
  const lowered = status.toLowerCase();
  if (lowered.includes('fail') || lowered.includes('error')) return 'failed';
  if (
    lowered.includes('complete') ||
    lowered.includes('done') ||
    lowered.includes('candidate') ||
    lowered.includes('confirmed')
  )
    return 'done';
  if (lowered.includes('run') || lowered.includes('progress')) return 'running';
  return 'pending';
}

/**
 * 任务胶囊（Spec R01 §4.3 / §2.2）。
 * OpenClaw 后台任务只暴露「任务、进度、结果、失败原因」；
 * 前端不轮询、不伪造进度，只读 Host current 投影。
 */
export default function TaskPills({ timeline }: TaskPillsProps) {
  const tasks = useMemo<TaskView[]>(() => {
    return TASK_KINDS.map(({ kind, label }) => {
      const latest = [...timeline.events]
        .reverse()
        .find((event) => event.kind === kind);
      if (!latest) {
        return {
          key: kind,
          label,
          state: 'pending' as const,
          note: '尚无进度记录',
        };
      }
      return {
        key: kind,
        label,
        state: stateFromStatus(latest.status),
        note: latest.detail || latest.label || latest.status,
      };
    });
  }, [timeline.events]);

  return (
    <div className="wl-task-pills" role="status" aria-label="分析任务状态">
      {tasks.map((task) => (
        <span
          key={task.key}
          className={`wl-task-pill is-${task.state}`}
          title={task.note}
        >
          {task.state === 'running' ? (
            <Loader2 aria-hidden="true" />
          ) : task.state === 'failed' ? (
            <XCircle aria-hidden="true" />
          ) : task.state === 'done' ? null : (
            <CircleDashed aria-hidden="true" />
          )}
          {task.label} ·{' '}
          {task.state === 'done'
            ? '已完成'
            : task.state === 'running'
              ? '进行中'
              : task.state === 'failed'
                ? '失败'
                : '等待中'}
        </span>
      ))}
    </div>
  );
}
