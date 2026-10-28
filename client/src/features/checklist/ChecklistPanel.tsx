import type { JobAidChecklistDefinitionView, JobAidChecklistSnapshotView,
  JobAidChecklistTaskRead, JobAidChecklistResult } from '@shared/jobaid-checklist.interface';
import type { JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';
import type { ReactNode } from 'react';

const outcomes = { ANSWERED: '已回答（候选）', OPEN: '未决', CONFLICT: '存在冲突', DEFERRED: '延期' };
const applicability = { APPLICABLE: '需要分析', NOT_APPLICABLE: '有据不适用', UNDETERMINED: '适用条件未明' };
const modes = { INCLUDE: '本轮纳入', WHEN_TRIGGERED: '条件触发时分析', EXCLUDE_OPTIONAL: '本轮排除可选范围' };
const unavailable = {
  NOT_PREPARED: '本任务尚未封存检查单定义。', NOT_BOUND: '本任务未绑定贯穿检查单；未以当前版本补填。',
  UNSUPPORTED: '本任务绑定的定义版本暂不支持展示；原依据未替换。',
  INVALID: '本任务检查单绑定无法准确核对，未展示推测内容。',
};

function TextList({ label, value }: { label: string; value: string | readonly string[] }) {
  return <div><h4 className="font-medium">{label}</h4>{typeof value === 'string'
    ? <p className="whitespace-pre-wrap">{value}</p>
    : <ul className="list-disc pl-5">{value.map((text: string, index: number) => <li key={index}>{text}</li>)}</ul>}</div>;
}

interface ResultContext {
  work?: JobAidProblemWorkContent;
  onIssue?: (issueKey: string) => void;
  renderEvidence?: (refs: string[]) => ReactNode;
}

function ResultDetails({ result, work, onIssue, renderEvidence }: ResultContext & { result: JobAidChecklistResult }) {
  const related = work?.issues.filter(issue => result.resultRefs.some(ref => ref.issueKey === issue.issueKey)) ?? [];
  return <div className="space-y-2 border-l-2 pl-3" data-outcome={result.outcome}>
    <p>{applicability[result.itemApplicability] ?? result.itemApplicability} · {outcomes[result.outcome] ?? result.outcome}</p>
    <ul>{result.resultRefs.map((ref, index: number) => {
      const issue = related.find(item => item.issueKey === ref.issueKey);
      return <li key={index}>{issue && onIssue
        ? <button type="button" className="text-primary underline" onClick={() => onIssue(ref.issueKey)}>{issue.question}</button>
        : issue?.question ?? `未在本次工作读回中找到问题 ${ref.issueKey}`} · 正文位置 {ref.fieldPath}</li>;
    })}</ul>
    {related.map(issue => <div key={issue.issueKey}>
      {issue.openQuestions.map((question, index: number) => <div key={index} className="my-2">
        <p>未决：{question.question}</p><p>影响：{question.affects}</p>
        <p>原因：{question.reason}</p><p>待补依据：{question.nextEvidence}</p>
      </div>)}
    </div>)}
    {work && renderEvidence ? renderEvidence(result.basisRefs)
      : <p>保存的依据引用：{result.basisRefs.join('、') || '本项未保存依据引用'}</p>}
  </div>;
}

/** Renders only declared definition fields. It never dumps a binding/full task into the page. */
export function ChecklistDefinitionPanel({ definition: view, snapshot, work, onIssue, renderEvidence }: ResultContext & {
  definition: JobAidChecklistDefinitionView; snapshot?: JobAidChecklistSnapshotView;
}) {
  const definition = view.definition;
  const policy = definition.commonPolicy;
  return <div className="space-y-4 text-sm" data-checklist-definition={view.definitionId}>
    <p>检查单内容用于候选分析；逐项已回答不表示正式采用、实施或工程批准。</p>
    <details><summary>版本与内容摘要</summary><dl className="break-all">
      <dt>定义</dt><dd>{view.definitionId}</dd><dt>定义版本</dt><dd>{view.definitionVersion}</dd>
      <dt>合同版本</dt><dd>{view.contractVersion}</dd><dt>定义内容摘要（Hash）</dt><dd>{view.definitionContentHash}</dd>
    </dl></details>
    {snapshot ? <details><summary>本轮选择与验收范围</summary>
      <ul>{snapshot.selection.map(item => <li key={item.itemId}>{item.itemId} · {modes[item.mode]}：{item.reason}</li>)}</ul>
      <p>允许保存的结果：{snapshot.acceptance.allowedSavedOutcomes.map(value => outcomes[value]).join('、')}</p>
      <p>允许延期的项目：{snapshot.acceptance.allowedDeferredItemIds.join('、') || '无'}</p>
      <p>允许带未决完成本轮的项目：{snapshot.acceptance.allowedCompletionWithOpenItemIds.join('、') || '无'}</p>
      <p>本轮分析完成不构成正式采用。</p>
    </details> : <p>当前内置定义没有某一任务的选择与验收范围；具体任务以其封存版本为准。</p>}
    {definition.items.map(item => {
      const results = work?.checklistResults?.filter(result => result.itemId === item.itemId) ?? [];
      return <details key={item.itemId} className="rounded-md border p-3">
        <summary className="cursor-pointer font-medium">{item.title} · {results.length === 1
          ? outcomes[results[0]!.outcome] ?? results[0]!.outcome : results.length > 1 ? '结果存在重复，需核对' : '尚无本项保存结果'}</summary>
        <div className="mt-3 space-y-3">
          <p>{item.itemId} · {item.pyramidPath.join(' / ')}</p><p className="font-medium">{item.question}</p>
          {results.map((result, index: number) => <ResultDetails key={index} result={result} work={work}
            onIssue={onIssue} renderEvidence={renderEvidence} />)}
          <TextList label="何时需要分析" value={item.trigger.appliesWhen} />
          <TextList label="何时不适用" value={item.trigger.notApplicableWhen} />
          <TextList label="条件未知时" value={item.trigger.unknownHandling} />
          <TextList label="判断责任" value={item.trigger.decisionOwner} />
          <p>默认选择：{modes[item.selection.defaultMode]} · {item.selection.optionalBoundary}</p>
          <TextList label="必要调查" value={item.necessaryInvestigations} />
          <TextList label="证据要求" value={item.evidenceRequirements} />
          <TextList label="最低完成要求" value={item.minimumCompletion} />
          <TextList label="允许保留的未决" value={item.allowedOpen} />
          <TextList label="不足与失败处理" value={item.failureHandling} />
          <p>定义来源标识（非业务已读证据）：{item.sourceRefs.join('、')}</p>
          <p>规则关联：{item.ruleRefs.join('、')}</p>
        </div>
      </details>;
    })}
    <details><summary>完整公共策略</summary><div className="space-y-3">
      <TextList label="目标来源" value={policy.goalOwner} /><TextList label="自主调查" value={policy.autonomy} />
      <dl>{Object.entries(policy.selectionModes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
      <TextList label="选择冲突" value={policy.selectionConflict} />
      <p>适用性：{policy.itemApplicability.join(' / ')}；结果：{policy.outcome.join(' / ')}；方法使用：{policy.methodUsage.join(' / ')}</p>
      <TextList label="状态含义" value={policy.stateMeaning} /><TextList label="语义判断边界" value={policy.semanticBoundary} />
      <TextList label="系统边界" value={policy.systemInvariants} /><TextList label="来源数量" value={policy.noUniformSourceCount} />
      <TextList label="发布与权威边界" value={policy.publicationBoundary} />
    </div></details>
    <details><summary>规则目录与机器校验边界</summary>
      <p>此页不执行预检，也未取得本任务的预检回执。NOT_MACHINE_ASSESSED 表示未由机器判定，不表示通过。</p>
      {definition.ruleCatalog.map(rule => <section key={rule.ruleId} className="my-3">
        <h4>{rule.ruleId} · {rule.nature === 'SEMANTIC_RUBRIC' ? '语义复核参考' : '确定性约束'}</h4>
        <p>{rule.meaning}</p><small>原定义登记状态：{rule.implementationStatus}；不代表本任务执行进度。</small>
      </section>)}
    </details>
  </div>;
}

export function TaskChecklist({ checklist, label = '本任务封存检查单' }: {
  checklist?: JobAidChecklistTaskRead; label?: string;
}) {
  return <details className="my-3 rounded-lg border p-4" aria-label={label}>
    <summary className="cursor-pointer font-medium">{label}</summary>
    {!checklist ? <p>尚未取得本任务的检查单投影；不使用先前保存工作或当前内置版补填。</p>
      : checklist.status !== 'AVAILABLE' ? <p role={checklist.status === 'INVALID' ? 'alert' : 'status'}>{unavailable[checklist.status]}</p>
        : checklist.snapshot ? <><p>仅显示该任务封存的依据。逐项结果须另读其准确保存工作；执行状态不代表逐项已完成。</p>
          <ChecklistDefinitionPanel definition={checklist.snapshot} snapshot={checklist.snapshot} /></>
          : <p role="alert">检查单投影缺少封存内容。</p>}
  </details>;
}

export function SavedChecklist({ work, workRef, onIssue, renderEvidence }: ResultContext & {
  work: JobAidProblemWorkContent; workRef: string;
}) {
  const binding = work.checklistBinding;
  return <details className="my-3 rounded-lg border p-4" aria-label="已保存工作的检查单" data-checklist-work-ref={workRef}>
    <summary className="cursor-pointer font-medium">查看本工作检查单与逐项结果</summary>
    <p className="break-all">对应准确保存修订：{workRef}。保持当时定义，不随当前内置版本变化。</p>
    {binding ? <ChecklistDefinitionPanel definition={binding} snapshot={binding} work={work}
      onIssue={onIssue} renderEvidence={renderEvidence} />
      : <p>本工作未保存贯穿检查单绑定；不以当前定义重建历史结果。</p>}
    {binding && !work.checklistResults ? <p>本工作尚未取得逐项结果。</p> : null}
  </details>;
}
