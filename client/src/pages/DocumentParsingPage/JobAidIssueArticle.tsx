import type { ReactNode } from 'react';
import EngineeringIssueBody from '@client/src/features/matter/EngineeringIssueBody';
import { JobAidEvidenceDetails, SavedJobAidIssueContext, jobAidTreatmentLabels } from '@client/src/features/matter/SavedJobAidReadingContext';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import type {
  AssessmentEvidence,
} from '@shared/assessment-reading.interface';
import type {
  JobAidProblemIssue,
  JobAidRequirementHandling,
} from '@shared/jobaid-problem-assessment.interface';

export { JobAidEvidenceDetails, jobAidTreatmentLabels } from '@client/src/features/matter/SavedJobAidReadingContext';
const classificationLabels = {
  SAE_EVENT_CATEGORY: 'SAE 事件分类',
  SOURCE_DOCUMENT_CLASSIFICATION: '源文件分类',
  EO_ATTRIBUTE: 'EO 属性',
};

export function JobAidRequirement({
  item,
  children,
  showConditions = true,
}: {
  item: JobAidRequirementHandling;
  children?: ReactNode;
  showConditions?: boolean;
}) {
  return (
    <section className="wl-jobaid-requirement">
      <h4>
        {item.requirement}{' '}
        <small>{jobAidTreatmentLabels[item.treatment]}</small>
      </h4>
      {showConditions && item.conditions.map((condition) => (
        <p key={condition}>适用条件：{condition}</p>
      ))}
      <p>{item.explanation}</p>
      {children}
    </section>
  );
}

export function JobAidIssueArticle({
  issue,
  evidence,
  onLocateDocument,
  bodyAlreadyVisible = false,
  contextAlreadyVisible = false,
}: {
  issue: JobAidProblemIssue;
  evidence: AssessmentEvidence[];
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
  bodyAlreadyVisible?: boolean;
  contextAlreadyVisible?: boolean;
}) {
  const sourceDetails = (refs: string[]) => (
    <JobAidEvidenceDetails
      refs={refs}
      evidence={evidence}
      onLocateDocument={onLocateDocument}
    />
  );
  return (
    <>
      {!bodyAlreadyVisible ? <h3>{issue.question}</h3> : null}
      {!bodyAlreadyVisible ? issue.body ? <EngineeringIssueBody body={issue.body} evidence={evidence} onLocateDocument={onLocateDocument} /> : <p>未取得本版保存正文，不能用问题标题替代判断。</p> : null}
      {!contextAlreadyVisible ? <SavedJobAidIssueContext issue={issue} evidence={evidence} onLocateDocument={onLocateDocument} /> : null}
      {issue.riskScenarios.map((risk, index) => (
        <section key={index} className="wl-jobaid-risk">
          <h4>情景分析与分级理由：{risk.scenario}</h4>
          <p>措施与后果的比较：{risk.controlComparison}</p>
          {risk.severity ? <p>严重性理由：{risk.severity.reason}</p> : null}
          {risk.likelihood ? <p>可能性理由：{risk.likelihood.reason}</p> : null}
          {risk.importantEvent ? (
            <p>
              重要事件核对：{risk.importantEvent.event}。
              {risk.importantEvent.reason}
            </p>
          ) : null}
          {sourceDetails([
            ...(risk.severity?.basisRefs ?? []),
            ...(risk.likelihood?.basisRefs ?? []),
            ...(risk.importantEvent?.basisRefs ?? []),
          ])}
        </section>
      ))}
      {issue.otherClassifications.map((item, index) => (
        <section key={index}>
          <h4>
            {classificationLabels[item.method]}：{item.value}
          </h4>
          <p>{item.reason}</p>
          {sourceDetails(item.basisRefs)}
        </section>
      ))}
      {issue.requirementHandling.length ? <details className="wl-jobaid-evidence">
        <summary>展开本问题登记的要求与方法（{issue.requirementHandling.length}）</summary>
        {issue.requirementHandling.map((item, index) => (
        <JobAidRequirement key={index} item={item} showConditions={false}>
          {sourceDetails([item.methodRef, ...item.basisRefs])}
        </JobAidRequirement>
      ))}</details> : null}
      {sourceDetails([...issue.sourceDependencies, ...issue.premiseRefs])}
    </>
  );
}
