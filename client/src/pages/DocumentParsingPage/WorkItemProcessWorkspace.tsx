import { CheckCircle2, ClipboardCheck, MessageSquareText } from 'lucide-react';
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
import JobAidExecutionActivity from './JobAidExecutionActivity';
import ProgramAssessmentMaterials from './ProgramAssessmentMaterials';
import type { JobAidWorkingReadState } from './useJobAidWorkingRead';
import './work-item-process-workspace.css';

interface WorkItemProcessWorkspaceProps {
  data: CanonicalDocumentParsingPageResponse;
  workingRead: JobAidWorkingReadState;
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

interface ProcessProgressFact {
  label: string;
  occurredAt: string;
}

function latestProcessProgress(
  working: JobAidWorkingReadModel | null,
): ProcessProgressFact | null {
  const selected = working?.selectedExecution;
  const current = working?.current;
  const facts: ProcessProgressFact[] = [];
  if (selected?.programProgress)
    facts.push({
      label:
        selected.programProgress.phase === 'MODEL_RESPONSE_SAVED'
          ? '完整响应已留存'
          : '材料检查点已留存',
      occurredAt: selected.programProgress.observedAt,
    });
  if (current && (!selected || current.actionAttemptId === selected.attemptId))
    facts.push({
      label: `工作第 ${current.workRevision} 版已保存`,
      occurredAt: current.createdAt,
    });
  if (selected?.completedAt)
    facts.push({
      label: `执行状态：${humanState(selected.status) ?? selected.status}`,
      occurredAt: selected.completedAt,
    });
  return (
    facts
      .filter((fact: ProcessProgressFact) =>
        Number.isFinite(Date.parse(fact.occurredAt)),
      )
      .sort(
        (left: ProcessProgressFact, right: ProcessProgressFact) =>
          Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
      )[0] ?? null
  );
}

export function AssessmentProcessDetails({
  data,
  working,
}: {
  data: CanonicalDocumentParsingPageResponse;
  working: JobAidWorkingReadModel | null;
}) {
  const current = working?.current ?? null;
  const latest = working?.latestAttempt ?? null;
  const selected = working?.selectedExecution;
  const program: boolean = selected?.executionMode === 'PROGRAM_CONTROLLED_V1';
  const progress: ProcessProgressFact | null = latestProcessProgress(working);
  const resultPending: boolean =
    working?.executionStatus === 'UNKNOWN' ||
    Boolean(
      working?.activity?.consumerStopped &&
      working.activity.attemptRef === selected?.attemptRef &&
      selected?.status !== 'SUCCEEDED',
    );
  const savedBySelected: boolean =
    !!current && current.actionAttemptId === selected?.attemptId;
  const overall = data.workItem.integratedAssessment?.overallSynthesis;
  const currentOverall: boolean =
    !!current &&
    overall?.status === 'CANDIDATE_ONLY' &&
    overall.staleReason === null &&
    overall.basedOnJobAidWorkRevisionRef === current.workRevisionRef &&
    working?.overallStatus === 'CURRENT' &&
    working.overallBasedOnWorkRevisionRef === current.workRevisionRef;
  const active: boolean = [
    'REQUESTED',
    'QUEUED',
    'RUNNING',
    'RETRY_SCHEDULED',
    'COMMITTING',
  ].includes(working?.executionStatus ?? '');
  let currentStep: string = working?.executionStatus
    ? (humanState(working.executionStatus) ?? working.executionStatus)
    : '尚无执行记录';
  if (resultPending) currentStep = '原请求结果待核';
  else if (savedBySelected && !currentOverall)
    currentStep = '工作已保存，综合待更新';
  else if (savedBySelected && active) currentStep = '成果已可读，执行仍在收尾';
  else if (
    selected?.programProgress?.phase === 'MODEL_RESPONSE_SAVED' &&
    !savedBySelected
  )
    currentStep = '完整响应已留存，工作保存待确认';
  else if (selected?.programProgress?.phase === 'MATERIALS_READY' && active)
    currentStep = '材料检查点已留存，等待分析响应';
  const stages = data.initialAnalysis?.stages;
  const confirmation =
    data.workItem.integratedAssessment?.overallForAeoConfirmation ?? null;
  return (
    <section className="wl-process-facts" aria-label="本次评估可核验过程">
      <header>本次评估可核验过程</header>
      <div>
        <p>
          <strong>本轮目标：</strong>
          核对当前文件版本，形成工程判断、问题分析和下一步。
        </p>
        {program ? (
          <p>
            执行方式：程序评估 · 自主调查未启用
            {selected.executionModel
              ? ` · 本次模型：${selected.executionModel.displayName}`
              : ''}
          </p>
        ) : null}
        <p role="status">
          <strong>当前步骤：</strong>
          {currentStep}
        </p>
        <p>
          <strong>已有可读成果：</strong>
          {current
            ? `已保存工作第 ${current.workRevision} 版；正文可立即阅读。`
            : '尚无已保存评估；问题与待确认数量未知。'}
        </p>
        <p>
          <strong>最近有效进展：</strong>
          {progress ? (
            <>
              {progress.label} ·{' '}
              <time dateTime={progress.occurredAt}>
                {new Date(progress.occurredAt).toLocaleString('zh-CN')}
              </time>
            </>
          ) : (
            '尚无可核验的保存或阶段记录。'
          )}
        </p>
        <p>
          <strong>下一步：</strong>
          {resultPending
            ? data.initialAnalysis?.continuationOperations?.includes(
                'EVALUATE_JOBAID',
              ) && !active
              ? '可核对原请求，或按已允许范围另建程序评估。'
              : '核对原请求结果后再决定后续处理。'
            : current && !currentOverall
              ? '先阅读已保存工作，再核对对应综合的更新结果。'
              : active
                ? '等待读回本轮结果；已保存内容继续可读。'
                : '可阅读现有成果、核对依据并补充具体问题。'}
        </p>
      </div>
      <details className="px-4 pb-4">
        <summary className="cursor-pointer py-2 text-sm">
          展开对象、阶段与保存版本
        </summary>
        <div className="grid gap-2 pt-2">
          <p>
            <strong>输入对象：</strong>
            {data.workItem.source.documentId} · 文件版本{' '}
            {data.workItem.source.documentVersionId} · 事项修订{' '}
            {data.workItem.revision}
          </p>
          {stages ? (
            <ol>
              {(
                Object.keys(stageLabels) as Array<keyof typeof stageLabels>
              ).map((key) => (
                <li key={key}>
                  <strong>{stageLabels[key]}</strong>：
                  {humanState(stages[key].status) ?? stages[key].status}
                  {stages[key].terminalCode
                    ? ` · ${stages[key].terminalCode}`
                    : ''}
                </li>
              ))}
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
                  ? '已保存评估后，事项输入有更新。'
                  : '评估按保存时的输入修订记录。'}
              </p>
            </>
          ) : (
            <p>暂无已保存的问题评估。</p>
          )}
          <p>
            <strong>人工确认：</strong>
            {confirmation
              ? (humanState(confirmation.status) ?? confirmation.status)
              : '暂无整体意见确认记录。'}
          </p>
        </div>
      </details>
      {program && selected ? (
        <ProgramAssessmentMaterials
          workItemId={data.workItem.workItemId}
          attemptId={selected.attemptId}
          attemptRef={selected.attemptRef}
          available={selected.programMaterialsAvailable === true}
          executionModel={selected.executionModel}
          observationKey={selected.programProgress?.observedAt}
        />
      ) : null}
      <JobAidExecutionActivity activity={working?.activity} />
    </section>
  );
}

export default function WorkItemProcessWorkspace({
  data,
  workingRead,
  onOpenAssessment,
  onOpenReview,
  onRefresh,
}: WorkItemProcessWorkspaceProps) {
  const { data: working, error, refresh } = workingRead;
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
    ? (humanState(overall.status) ?? '已保存候选综合')
    : '尚未形成综合候选';

  return (
    <section className="wl-process-workspace" id="workspace-reasoning">
      <header className="wl-process-heading">
        <div>
          <p>当前事项 · {documentCode}</p>
          <h1>评估过程</h1>
          <span>查看本轮实际步骤、保存成果与版本记录。</span>
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
          <EngineeringReasoningTrail data={data} working={working} />
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
                  ? '已保存综合与形成记录'
                  : '暂无已保存综合，可查看分析记录和原文。'}
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
