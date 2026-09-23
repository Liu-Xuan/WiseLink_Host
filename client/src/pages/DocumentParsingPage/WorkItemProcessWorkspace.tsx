import {
  CheckCircle2,
  ClipboardCheck,
  MessageSquareText,
} from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Button } from '@client/src/components/ui/button';
import { humanState } from '@client/src/features/navigation/treeMappers';
import RevisionTimeline from '@client/src/features/review/RevisionTimeline';
import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalTimelineEvent,
} from '@shared/api.interface';
import type { JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';

import { EngineeringReasoningTrail } from './EngineeringReasoningTrail';
import { useJobAidWorkingRead } from './useJobAidWorkingRead';
import './work-item-process-workspace.css';

interface WorkItemProcessWorkspaceProps {
  data: CanonicalDocumentParsingPageResponse;
  onOpenAssessment: () => void;
  onOpenReview: () => void;
  onRefresh: () => void;
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

const stageLabels = {
  translation: '原文翻译',
  applicability: '适用性提取',
  jobAid: '按 JobAid 逐项评估',
  overall: '综合候选更新',
} as const;

export function AssessmentProcessDetails({
  data,
  working,
}: {
  data: CanonicalDocumentParsingPageResponse;
  working: JobAidWorkingReadModel | null;
}) {
  const current = working?.current ?? null;
  const latest = working?.latestAttempt ?? null;
  const stages = data.initialAnalysis?.stages;
  const confirmation =
    data.workItem.integratedAssessment?.overallForAeoConfirmation ?? null;
  return (
    <section className="wl-process-facts" aria-label="本次评估可核验过程">
      <header>本次评估可核验过程</header>
      <div>
        <p>
          <strong>输入对象：</strong>
          {data.workItem.source.documentId} · 文件版本{' '}
          {data.workItem.source.documentVersionId} · 事项修订{' '}
          {data.workItem.revision}
        </p>
        {stages ? (
          <ol>
            {(Object.keys(stageLabels) as Array<keyof typeof stageLabels>).map(
              (key) => (
                <li key={key}>
                  <strong>{stageLabels[key]}</strong>：
                  {humanState(stages[key].status) ?? stages[key].status}
                  {stages[key].terminalCode
                    ? ` · ${stages[key].terminalCode}`
                    : ''}
                </li>
              ),
            )}
          </ol>
        ) : (
          <p>当前没有初始分析阶段记录。</p>
        )}
        <p>
          <strong>最近评估请求：</strong>
          {latest
            ? `${humanState(latest.status) ?? latest.status} · 输入修订 ${latest.inputRevision ?? '未记录'}`
            : '尚未发起'}
        </p>
        {current ? (
          <>
            <p>
              <strong>已保存候选：</strong>工作修订 {current.workRevision} ·{' '}
              {current.content.issues.length} 个问题 ·{' '}
              {current.content.evidence.length} 项输入依据 ·{' '}
              {current.content.readSourceRefs.length} 条已读来源引用
            </p>
            <p>
              <strong>资料能力：</strong>
              {current.content.capabilities.length
                ? current.content.capabilities
                    .map(
                      (item) =>
                        `${item.capability}：${humanState(item.status) ?? item.status}${item.impact ? `（${item.impact}）` : ''}`,
                    )
                    .join('；')
                : '本轮没有记录额外资料能力调用'}
            </p>
            <p>
              <strong>版本关系：</strong>
              {working?.currentInputChanged
                ? '当前事项输入已变化，已保存候选需要复核。'
                : '候选按其记录的输入修订保存；具体证据请在问题评估中核对。'}
            </p>
          </>
        ) : (
          <p>尚无已保存的问题评估候选；运行状态不代表结论已形成。</p>
        )}
        <p>
          <strong>人工确认：</strong>
          {confirmation
            ? humanState(confirmation.status) ?? confirmation.status
            : '尚无整体意见确认记录；候选不会自动成为正式结论。'}
        </p>
      </div>
    </section>
  );
}

export default function WorkItemProcessWorkspace({
  data,
  onOpenAssessment,
  onOpenReview,
  onRefresh,
}: WorkItemProcessWorkspaceProps) {
  const { data: working, error, refresh } = useJobAidWorkingRead(
    data.workItem.workItemId,
  );
  const lastAttemptState = useRef<string | null>(null);
  const attemptState = working?.latestAttempt
    ? `${working.latestAttempt.attemptId}:${working.latestAttempt.status}`
    : null;
  useEffect(() => {
    const previous = lastAttemptState.current;
    lastAttemptState.current = attemptState;
    if (previous !== null && previous !== attemptState) onRefresh();
  }, [attemptState, onRefresh]);
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
          {error ? (
            <div className="wl-process-read-error" role="alert">
              评估过程刷新失败：{error}。
              {working ? '以下保留上次读回记录，尚未确认有更新。' : ''}
              <Button type="button" variant="outline" onClick={refresh}>
                重新读取
              </Button>
            </div>
          ) : null}
          {working ? (
            <AssessmentProcessDetails data={data} working={working} />
          ) : !error ? (
            <p role="status">正在读取评估过程…</p>
          ) : null}
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
