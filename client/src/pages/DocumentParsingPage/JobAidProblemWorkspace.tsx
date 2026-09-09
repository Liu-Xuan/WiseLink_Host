import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import InitialAnalysisContinueButton from '@client/src/features/review/InitialAnalysisContinueButton';
import SavedAssessmentReading from '@client/src/features/matter/SavedAssessmentReading';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import type {
  CanonicalInitialAnalysisReadModel,
  CanonicalOpenClawOverallProjection,
} from '@shared/api.interface';
import {
  jobAidReadingResult,
  type JobAidWorkingReadModel,
} from '@shared/jobaid-problem-assessment.interface';
import {
  JobAidEvidenceDetails,
  JobAidIssueArticle,
  JobAidRequirement,
} from './JobAidIssueArticle';
import { useJobAidWorkingRead } from './useJobAidWorkingRead';
import './jobaid-problem-workspace.css';

interface Props {
  workItemId: string;
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
  initialAnalysis?: CanonicalInitialAnalysisReadModel | null;
  overall?: CanonicalOpenClawOverallProjection | null;
  onUpdated?: () => void;
  children?: ReactNode;
}
const completionLabels = {
  IN_PROGRESS: '分析进行中',
  COMPLETE: '本轮分析完成',
  COMPLETE_WITH_OPEN_QUESTIONS: '本轮分析完成，仍有待确认事项',
};
const executionLabels: Record<string, string> = {
  REQUESTED: '已请求执行',
  QUEUED: '排队等待',
  RUNNING: '正在执行',
  RETRY_SCHEDULED: '等待服务重试',
  COMMITTING: '正在保存',
  SUCCEEDED: '执行完成',
  WAITING_INPUT: '等待补充信息',
  FAILED: '执行失败',
  TIMED_OUT: '执行超时',
  CANCELLED: '已取消',
  CONFLICT: '版本冲突',
  OBSOLETE: '执行已过期',
};
const capabilityLabels = {
  AVAILABLE: '可用',
  NOT_CONNECTED: '未接通',
  ACCESS_DENIED: '无权读取',
  NOT_FOUND: '本次未查到',
  PARTIAL: '部分可用',
  READ_FAILED: '读取失败',
};

export default function JobAidProblemWorkspace(props: Props) {
  const session: number = getCanonicalHostClientSessionGeneration();
  return (
    <JobAidWorkspaceRead key={`${session}:${props.workItemId}`} {...props} />
  );
}

function JobAidWorkspaceRead(props: Props) {
  const { data, error, refresh } = useJobAidWorkingRead(props.workItemId);
  const signature: string = `${data?.current?.workRevisionRef ?? ''}:${data?.overallStatus ?? ''}:${data?.overallBasedOnWorkRevisionRef ?? ''}`;
  const notified = useRef<string | null>(null);
  const latestUpdated = useRef(props.onUpdated);
  latestUpdated.current = props.onUpdated;
  useEffect(() => {
    if (!data?.enabled || notified.current === signature) return;
    const previous = notified.current;
    notified.current = signature;
    if (previous !== null) latestUpdated.current?.();
  }, [signature, data?.enabled]);
  return (
    <>
      {error ? (
        <div role="alert" className="wl-jobaid-read-error">
          <p>
            问题分析刷新失败：{error}
            {data?.current
              ? '。以下保留上次读回的已保存工作，未确认有更新。'
              : ''}
          </p>
          <Button variant="outline" onClick={refresh}>
            重新读取
          </Button>
        </div>
      ) : null}
      {data ? (
        data.enabled ? (
          <JobAidProblemReading
            {...props}
            data={data}
            onContinue={() => {
              refresh();
              props.onUpdated?.();
            }}
          />
        ) : (
          props.children
        )
      ) : !error ? (
        <p role="status" className="p-4 text-sm">
          正在读取已保存的问题分析…
        </p>
      ) : null}
    </>
  );
}

export function JobAidProblemReading({
  data,
  onLocateDocument,
  initialAnalysis,
  overall,
  onContinue,
}: Omit<Props, 'workItemId' | 'children' | 'onUpdated'> & {
  data: JobAidWorkingReadModel;
  onContinue?: () => void;
}) {
  const [tab, setTab] = useState<'understanding' | 'issues' | 'method'>(
    'issues',
  );
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const current = data.current;
  const allowed = initialAnalysis?.continuationOperations ?? [];
  const actions = (
    <div className="wl-jobaid-actions">
      {initialAnalysis
        ? (['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'] as const)
            .filter((operation) => allowed.includes(operation))
            .map((operation) => (
              <InitialAnalysisContinueButton
                key={operation}
                workItemId={data.workItemId}
                expectedRevision={initialAnalysis.workItemRevision}
                operation={operation}
                label={
                  operation === 'EVALUATE_JOBAID'
                    ? '继续问题分析'
                    : '继续形成整体意见'
                }
                onQueued={() => onContinue?.()}
              />
            ))
        : null}
    </div>
  );
  if (!current)
    return (
      <section className="wl-jobaid-workspace">
        <p>
          尚无已保存的问题分析。原文和工程师输入仍可阅读；形成的工作会在这里接续。
        </p>
        {actions}
      </section>
    );
  const content = current.content;
  const reading = jobAidReadingResult(current);
  const overallMatches: boolean = Boolean(
    overall?.readingResult &&
    overall.basedOnJobAidWorkRevisionRef === current.workRevisionRef &&
    data.overallStatus === 'CURRENT' &&
    data.overallBasedOnWorkRevisionRef === current.workRevisionRef,
  );
  function locateIssue(issueKey: string): void {
    setSelectedIssue(issueKey);
    nodes.current
      .get(issueKey)
      ?.scrollIntoView({ block: 'start', behavior: 'auto' });
    nodes.current.get(issueKey)?.focus({ preventScroll: true });
  }
  return (
    <section
      aria-label="JobAid 问题分析"
      className="wl-jobaid-workspace"
      data-work-revision-ref={current.workRevisionRef}
    >
      <header className="wl-jobaid-status">
        <div>
          <strong>{completionLabels[content.roundCompletion]}</strong>
          <span>
            工作修订 {current.workRevision} ·{' '}
            {new Date(current.createdAt).toLocaleString('zh-CN')}
          </span>
        </div>
        {actions}
        {data.executionStatus ? (
          <p>
            运行：
            {executionLabels[data.executionStatus] ?? data.executionStatus}
            。本轮分析是否完成以已保存内容为准。
          </p>
        ) : null}
        <p>{content.completionReason}</p>
      </header>
      {data.currentInputChanged ? (
        <p role="status" className="wl-jobaid-notice">
          对象输入已变化。以下保留原工作版本的判断和条件，需按新输入继续核对。
        </p>
      ) : null}
      {data.overallStatus === 'STALE' ? (
        <p role="status" className="wl-jobaid-notice">
          问题认识已有更新；整体意见仍基于较早的工作版本。新分析没有被旧整体意见替代。
        </p>
      ) : !overallMatches ? (
        <p className="wl-jobaid-notice">
          当前展示已保存的问题分析；尚未读到与本工作版本一致的整体意见。
        </p>
      ) : null}
      <div className="wl-jobaid-tabs" aria-label="问题分析阅读视图">
        {(
          [
            ['understanding', '当前认识'],
            ['issues', '问题分析'],
            ['method', '方法与要求'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant="ghost"
            size="sm"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === 'understanding' ? (
        <div className="wl-jobaid-reading">
          <SavedAssessmentReading
            result={reading}
            depth="full"
            onLocateDocument={onLocateDocument}
          />
          {overall?.readingResult ? (
            <section className="wl-jobaid-overall">
              <h3>
                {overallMatches
                  ? '基于本工作版本的整体意见'
                  : '此前保存的整体意见 · 另行保留'}
              </h3>
              <p className="wl-jobaid-meta">
                {overallMatches
                  ? `对应工作修订 ${current.workRevision}`
                  : '其基础版本与当前工作不同或尚未确认，不与新分析拼接。'}
              </p>
              <SavedAssessmentReading
                result={overall.readingResult}
                depth="full"
                locationSuffix="overall"
                onLocateDocument={onLocateDocument}
              />
            </section>
          ) : null}
        </div>
      ) : null}
      {tab === 'issues' ? (
        <div
          className={`wl-jobaid-layout${content.issues.length ? ' has-issues' : ''}`}
        >
          {content.issues.length ? (
            <nav className="wl-jobaid-index" aria-label="实际问题目录">
              <span>本轮问题</span>
              {content.issues.map((issue) => (
                <button
                  type="button"
                  key={issue.issueKey}
                  aria-current={
                    selectedIssue === issue.issueKey ? 'location' : undefined
                  }
                  onClick={() => locateIssue(issue.issueKey)}
                >
                  {issue.question}
                </button>
              ))}
            </nav>
          ) : null}
          <div className="wl-jobaid-reading">
            <header>
              <h2>{content.headline}</h2>
              <p>{content.understanding}</p>
            </header>
            {content.issues.map((issue) => (
              <article
                key={issue.issueKey}
                className="wl-jobaid-issue"
                data-issue-key={issue.issueKey}
                tabIndex={-1}
                ref={(node) => {
                  if (node) nodes.current.set(issue.issueKey, node);
                  else nodes.current.delete(issue.issueKey);
                }}
              >
                <JobAidIssueArticle
                  issue={issue}
                  reading={reading}
                  onLocateDocument={onLocateDocument}
                />
              </article>
            ))}
          </div>
        </div>
      ) : null}
      {tab === 'method' ? (
        <div className="wl-jobaid-reading">
          <h2>方法与原始要求</h2>
          <p>方法包版本：{content.methodBinding.version}</p>
          {content.methodBinding.sources.map((source) => (
            <p key={source.sourceIdentity}>
              {source.sourceIdentity} {source.versionLabel} ·{' '}
              {source.status === 'CONFIRMED' ? '版本已确认' : '版本未确认'}
            </p>
          ))}
          <p className="wl-jobaid-notice">
            附件 5：已报告 R00 内容，但 R01
            链接尚未确认。该限制针对正式表单版本，不阻止有明确条件的候选分析。
          </p>
          {content.issues.map((issue) =>
            issue.requirementHandling.length ? (
              <section key={issue.issueKey}>
                <h3>{issue.question}</h3>
                {issue.requirementHandling.map((item, index) => (
                  <JobAidRequirement key={index} item={item}>
                    <JobAidEvidenceDetails
                      refs={[item.methodRef, ...item.basisRefs]}
                      evidence={content.evidence}
                      onLocateDocument={onLocateDocument}
                    />
                  </JobAidRequirement>
                ))}
              </section>
            ) : null,
          )}
          <section>
            <h3>本轮变化与保留理由</h3>
            {content.changeSummary ? <p>{content.changeSummary}</p> : null}
            {content.unchangedExplanation ? (
              <p>{content.unchangedExplanation}</p>
            ) : null}
          </section>
          {content.capabilities.length ? (
            <section>
              <h3>资料能力与限制</h3>
              {content.capabilities.map((item) => (
                <p key={item.capability}>
                  {capabilityLabels[item.status]}：{item.impact}
                </p>
              ))}
            </section>
          ) : null}
          {content.historyReview.limitation ? (
            <p>历史核对范围：{content.historyReview.limitation}</p>
          ) : null}
          <JobAidEvidenceDetails
            refs={content.evidence.map((item) => item.evidenceRef)}
            evidence={content.evidence}
            onLocateDocument={onLocateDocument}
            label="本轮实际资料"
          />
        </div>
      ) : null}
    </section>
  );
}
