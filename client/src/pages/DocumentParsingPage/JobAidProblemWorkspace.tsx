import { useEffect, useState, type ReactNode } from 'react';
import { readJobAidAssessmentWork } from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import { useWorkbenchPanelActive } from '@client/src/features/workbench/RetainedWorkbenchPanel';
import AssessmentEvidenceContext from '@client/src/features/matter/AssessmentEvidenceContext';
import SavedAssessmentReading from '@client/src/features/matter/SavedAssessmentReading';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import {
  jobAidReadingResult,
  type JobAidWorkingReadModel,
} from '@shared/jobaid-problem-assessment.interface';

const completionLabels = {
  IN_PROGRESS: '分析进行中',
  COMPLETE: '本轮分析完成',
  COMPLETE_WITH_OPEN_QUESTIONS: '本轮分析完成，仍有待确认事项',
};
const treatmentLabels = {
  ADDRESSED: '已处理',
  CONDITIONS_UNCONFIRMED: '条件待确认',
  NOT_APPLICABLE_WITH_BASIS: '有依据地不适用',
  LATER_BUSINESS_STAGE: '属于后续业务阶段',
  NOT_YET_ADDRESSED: '尚未处理',
};
const measureLabels = {
  PROPOSED: '提出的措施',
  REPORTED_IMPLEMENTED: '来源报告已实施',
  VERIFIED_EFFECTIVE: '有依据验证有效',
};
const classificationLabels = {
  SAE_EVENT_CATEGORY: 'SAE 事件分类',
  SOURCE_DOCUMENT_CLASSIFICATION: '源文件分类',
  EO_ATTRIBUTE: 'EO 属性',
};
const executionLabels: Record<string, string> = {
  REQUESTED: '已请求执行',
  QUEUED: '排队等待',
  RUNNING: '正在执行',
  RETRY_SCHEDULED: '等待重试',
  COMMITTING: '正在保存',
  SUCCEEDED: '执行完成',
  WAITING_INPUT: '等待补充信息',
  FAILED: '执行失败',
  TIMED_OUT: '执行超时',
  CANCELLED: '已取消',
  CONFLICT: '版本冲突',
  OBSOLETE: '执行已过期',
};

export default function JobAidProblemWorkspace({
  workItemId,
  onLocateDocument,
  children,
}: {
  workItemId: string;
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
  children?: ReactNode;
}) {
  const active = useWorkbenchPanelActive();
  const [data, setData] = useState<JobAidWorkingReadModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const result = await readJobAidAssessmentWork(workItemId);
        if (cancelled) return;
        // A work revision is immutable. Keep its mounted evidence while an
        // unchanged polling response arrives, including an open claim dialog.
        setData((previous) =>
          previous?.workItemId === result.workItemId &&
          previous.enabled === result.enabled &&
          previous.current?.workRevisionRef ===
            result.current?.workRevisionRef &&
          previous.executionStatus === result.executionStatus &&
          previous.currentInputChanged === result.currentInputChanged &&
          previous.overallStatus === result.overallStatus &&
          previous.overallBasedOnWorkRevisionRef ===
            result.overallBasedOnWorkRevisionRef
            ? previous
            : result,
        );
        setError(null);
        // Working revisions change independently of the WorkItem's formally adopted revision.
        if (result.enabled) timer = setTimeout(() => void read(), 6000);
      } catch (caught) {
        if (!cancelled) {
          setData(null);
          setError(
            caught instanceof Error ? caught.message : '已保存评估暂时无法读取',
          );
        }
      }
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workItemId, active, retry]);
  if (error)
    return (
      <div role="alert" className="space-y-3 rounded border p-4">
        <p>问题评估读取失败：{error}</p>
        <Button
          variant="outline"
          onClick={() => setRetry((value) => value + 1)}
        >
          重新读取
        </Button>
      </div>
    );
  if (!data)
    return (
      <p role="status" className="p-4 text-sm">
        正在读取已保存的评估工作…
      </p>
    );
  if (!data.enabled) return <>{children}</>;
  if (!data.current)
    return (
      <p className="p-4 text-sm">
        问题评估尚未保存。原文和工程师输入可继续阅读；完成的分析会在这里显示。
      </p>
    );
  const current = data.current;
  const content = current.content;
  const reading = jobAidReadingResult(current);
  const byRef = new Map(
    content.evidence.map((item) => [item.evidenceRef, item]),
  );
  const sourceDetails = (refs: string[]) => (
    <details className="rounded border p-3 text-sm">
      <summary className="cursor-pointer">核对依据与方法</summary>
      <div className="mt-4 space-y-6">
        {[...new Set(refs)].map((ref) => {
          const evidence = byRef.get(ref);
          return evidence ? (
            <AssessmentEvidenceContext
              key={ref}
              evidence={evidence}
              onLocateDocument={onLocateDocument}
            />
          ) : (
            <p key={ref} role="alert">
              依据 {ref} 未能读回。
            </p>
          );
        })}
      </div>
    </details>
  );
  return (
    <section aria-label="JobAid 问题评估" className="space-y-6">
      <div className="space-y-2 text-sm">
        <p>
          {completionLabels[content.roundCompletion]} · 工作修订{' '}
          {current.workRevision}
        </p>
        {data.executionStatus &&
        !['SUCCEEDED', 'RUNNING', 'COMMITTING'].includes(
          data.executionStatus,
        ) ? (
          <p role="status">
            本次运行状态：
            {executionLabels[data.executionStatus] ?? data.executionStatus}
            。以下为已保存的工作，运行未成功不等于业务分析完成。
          </p>
        ) : null}
        {data.currentInputChanged ? (
          <p role="status">
            对象输入已变化，当前内容保留了原工作版本的判断和条件，需按新输入继续核对。
          </p>
        ) : null}
        {data.overallStatus === 'STALE' ? (
          <p role="status">
            整体意见基于较早的工作版本；以下展示最新已保存的问题认识。
          </p>
        ) : null}
        <p className="whitespace-pre-wrap text-muted-foreground">
          {content.completionReason}
        </p>
      </div>
      <SavedAssessmentReading
        result={reading}
        depth="brief"
        onLocateDocument={onLocateDocument}
      />
      <div className="space-y-4">
        {content.issues.map((issue) => (
          <details
            key={issue.issueKey}
            className="rounded-lg border p-4"
            open={content.decisiveIssueKeys.includes(issue.issueKey)}
          >
            <summary className="cursor-pointer font-medium">
              {issue.question}
            </summary>
            <div className="mt-4 space-y-5 text-sm leading-7">
              <p className="whitespace-pre-wrap">{issue.understanding}</p>
              <SavedAssessmentReading
                result={{
                  ...reading,
                  content: {
                    ...reading.content,
                    headline: issue.question,
                    listBrief: issue.understanding,
                    lead: '',
                    claims: issue.statements,
                    decisiveClaimIds: issue.statements.map(
                      (item) => item.claimId,
                    ),
                  },
                }}
                depth="full"
                locationSuffix={issue.issueKey}
                onLocateDocument={onLocateDocument}
              />
              {issue.riskScenarios.map((risk, index) => (
                <article
                  key={index}
                  className="space-y-2 rounded bg-muted/40 p-3"
                >
                  <h4 className="font-medium">风险情景：{risk.scenario}</h4>
                  {risk.conditions.map((condition) => (
                    <p key={condition}>成立条件：{condition}</p>
                  ))}
                  <p>
                    JA-AC：严重性 {risk.severity?.label ?? '待确认'}；可能性{' '}
                    {risk.likelihood?.label ?? '待确认'}；
                    {risk.score === null
                      ? '尚不具备计算分数与等级的依据'
                      : `${risk.score} 分，${risk.gradeMeaning}`}
                  </p>
                  {risk.severity ? (
                    <p>严重性依据：{risk.severity.reason}</p>
                  ) : null}
                  {risk.likelihood ? (
                    <p>可能性依据：{risk.likelihood.reason}</p>
                  ) : null}
                  {risk.importantEvent ? (
                    <p>
                      重要事件核对：{risk.importantEvent.event}。
                      {risk.importantEvent.reason}
                    </p>
                  ) : null}
                  <p>措施与后果的比较：{risk.controlComparison}</p>
                  {risk.limitations.map((limit) => (
                    <p key={limit}>限制：{limit}</p>
                  ))}
                  {sourceDetails([
                    ...(risk.severity?.basisRefs ?? []),
                    ...(risk.likelihood?.basisRefs ?? []),
                    ...(risk.importantEvent?.basisRefs ?? []),
                  ])}
                </article>
              ))}
              {issue.measures.map((measure, index) => (
                <article key={index} className="space-y-1">
                  <h4 className="font-medium">
                    {measureLabels[measure.status]}：{measure.text}
                  </h4>
                  <p>针对：{measure.addresses}</p>
                  {measure.limitations.map((limit) => (
                    <p key={limit}>限制：{limit}</p>
                  ))}
                  {sourceDetails(measure.basisRefs)}
                </article>
              ))}
              {issue.otherClassifications.map((item, index) => (
                <p key={index}>
                  {classificationLabels[item.method]}：{item.value}。
                  {item.reason}
                </p>
              ))}
              {issue.openQuestions.length ? (
                <div className="space-y-2">
                  <h4 className="font-medium">仍需确认</h4>
                  {issue.openQuestions.map((question, index) => (
                    <article key={index}>
                      <p>{question.question}</p>
                      <p>
                        影响：{question.affects}。原因：{question.reason}
                      </p>
                      <p>下一步所需依据：{question.nextEvidence}</p>
                    </article>
                  ))}
                </div>
              ) : null}
              {issue.requirementHandling.map((item, index) => (
                <article key={index} className="space-y-1">
                  <h4 className="font-medium">
                    {item.requirement} · {treatmentLabels[item.treatment]}
                  </h4>
                  {item.conditions.map((condition) => (
                    <p key={condition}>适用条件：{condition}</p>
                  ))}
                  <p>{item.explanation}</p>
                  {sourceDetails([item.methodRef, ...item.basisRefs])}
                </article>
              ))}
              {sourceDetails([
                ...issue.sourceDependencies,
                ...issue.premiseRefs,
              ])}
            </div>
          </details>
        ))}
      </div>
      <details className="rounded border p-4 text-sm">
        <summary className="cursor-pointer">
          本轮变化、方法版本与资料能力
        </summary>
        <div className="mt-3 space-y-3 leading-7">
          <p>{content.changeSummary}</p>
          <p>{content.unchangedExplanation}</p>
          {content.methodBinding.sources.map((source) => (
            <p key={source.sourceIdentity}>
              {source.sourceIdentity} {source.versionLabel} ·{' '}
              {source.status === 'CONFIRMED' ? '版本已确认' : '版本未确认'}
            </p>
          ))}
          {content.capabilities.map((item) => (
            <p key={item.capability}>{item.impact}</p>
          ))}
          {content.historyReview.limitation ? (
            <p>历史核对：{content.historyReview.limitation}</p>
          ) : null}
        </div>
      </details>
    </section>
  );
}
