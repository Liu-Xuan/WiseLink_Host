import {
  CheckCircle2,
  ClipboardCheck,
  MessageSquareText,
} from 'lucide-react';

import { Button } from '@client/src/components/ui/button';
import { humanState } from '@client/src/features/navigation/treeMappers';
import RevisionTimeline from '@client/src/features/review/RevisionTimeline';
import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalTimelineEvent,
} from '@shared/api.interface';

import { EngineeringReasoningTrail } from './EngineeringReasoningTrail';
import './work-item-process-workspace.css';

interface WorkItemProcessWorkspaceProps {
  data: CanonicalDocumentParsingPageResponse;
  onOpenAssessment: () => void;
  onOpenReview: () => void;
}

const PROCESS_EVENT_KINDS: ReadonlySet<CanonicalTimelineEvent['kind']> =
  new Set<CanonicalTimelineEvent['kind']>([
    'DYNAMIC_EVALUATION',
    'ENGINEER_REVIEW',
    'OVERALL_SYNTHESIS',
    'OVERALL_CONFIRMATION',
  ]);

function activityLabel(kind: CanonicalTimelineEvent['kind']): string {
  switch (kind) {
    case 'DYNAMIC_EVALUATION':
      return '问题评估';
    case 'ENGINEER_REVIEW':
      return '工程师复核';
    case 'OVERALL_SYNTHESIS':
      return '综合认识更新';
    case 'OVERALL_CONFIRMATION':
      return '综合认识确认';
    default:
      return '分析记录';
  }
}

function dateLabel(value: string | null): string {
  if (!value) return '时间未提供';
  const date: Date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未提供';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export default function WorkItemProcessWorkspace({
  data,
  onOpenAssessment,
  onOpenReview,
}: WorkItemProcessWorkspaceProps) {
  const integrated = data.workItem.integratedAssessment ?? null;
  const overall = integrated?.overallSynthesis ?? null;
  const activities: CanonicalTimelineEvent[] = data.timeline.events
    .filter((event: CanonicalTimelineEvent) =>
      PROCESS_EVENT_KINDS.has(event.kind),
    )
    .slice(-4)
    .reverse();
  const documentCode: string =
    data.workItem.package?.documentIdentity?.documentCode?.trim() ||
    data.workItem.source.documentId;
  const updateState: string = overall
    ? humanState(overall.status) ?? '已保存候选综合'
    : '尚未形成综合候选';

  return (
    <section className="wl-process-workspace" id="workspace-reasoning">
      <header className="wl-process-heading">
        <div>
          <p>当前事项 · {documentCode}</p>
          <h1>问题与分析</h1>
          <span>先读完整问题，再核查分析使用的条件、方法和来源。</span>
        </div>
        <Button type="button" variant="outline" onClick={onOpenAssessment}>
          <ClipboardCheck aria-hidden="true" /> 阅读综合评估
        </Button>
      </header>

      <div className="wl-process-layout">
        <div className="wl-process-main">
          <EngineeringReasoningTrail data={data} />
          <div id="workspace-history">
            <RevisionTimeline timeline={data.timeline} />
          </div>
        </div>

        <aside className="wl-process-aside">
          <section>
            <header>认识更新状态</header>
            <div>
              <strong>{updateState}</strong>
              <p>
                {overall
                  ? '当前显示已保存的候选综合及其形成记录；后续变化不会自动改写这份认识。'
                  : '当前尚无已保存综合，分析记录和原文仍可按各自范围核对。'}
              </p>
              <Button type="button" onClick={onOpenReview}>
                <MessageSquareText aria-hidden="true" /> 补充与复核
              </Button>
            </div>
          </section>

          <section>
            <header>已记录的分析活动</header>
            <div>
              {activities.length > 0 ? (
                activities.map((event: CanonicalTimelineEvent) => (
                  <article className="wl-process-activity" key={event.id}>
                    <CheckCircle2 aria-hidden="true" />
                    <div>
                      <strong>{activityLabel(event.kind)}</strong>
                      <p>{humanState(event.status) ?? '状态待确认'}</p>
                      <small>{dateLabel(event.occurredAt)}</small>
                    </div>
                  </article>
                ))
              ) : (
                <p className="wl-process-empty">
                  当前事项尚无可显示的分析或复核活动。
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
