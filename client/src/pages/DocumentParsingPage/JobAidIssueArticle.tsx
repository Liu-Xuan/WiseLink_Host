import type { ReactNode } from 'react';
import AssessmentEvidenceContext from '@client/src/features/matter/AssessmentEvidenceContext';
import SavedAssessmentReading from '@client/src/features/matter/SavedAssessmentReading';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import type {
  AssessmentEvidence,
  AssessmentReadingResult,
} from '@shared/assessment-reading.interface';
import type {
  JobAidProblemIssue,
  JobAidRequirementHandling,
} from '@shared/jobaid-problem-assessment.interface';

export const jobAidTreatmentLabels: Record<
  JobAidRequirementHandling['treatment'],
  string
> = {
  ADDRESSED: '已处理',
  CONDITIONS_UNCONFIRMED: '条件待确认',
  NOT_APPLICABLE_WITH_BASIS: '有依据地不适用',
  LATER_BUSINESS_STAGE: '属于后续业务阶段',
  NOT_YET_ADDRESSED: '尚未处理',
};
const measureLabels = {
  PROPOSED: '提出的措施',
  REPORTED_IMPLEMENTED: '来源报告已实施',
  VERIFIED_EFFECTIVE: '评估认为有效',
};
const classificationLabels = {
  SAE_EVENT_CATEGORY: 'SAE 事件分类',
  SOURCE_DOCUMENT_CLASSIFICATION: '源文件分类',
  EO_ATTRIBUTE: 'EO 属性',
};

export function JobAidEvidenceDetails({
  refs,
  evidence,
  onLocateDocument,
  label = '核对来源与方法',
}: {
  refs: string[];
  evidence: AssessmentEvidence[];
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
  label?: string;
}) {
  if (!refs.length)
    return (
      <p className="wl-jobaid-meta">
        未登记可展开的依据；不能据此认定已经核实。
      </p>
    );
  return (
    <details className="wl-jobaid-evidence">
      <summary>
        {label}（{new Set(refs).size}）
      </summary>
      <div>
        {[...new Set(refs)].map((ref) => {
          const source = evidence.find((item) => item.evidenceRef === ref);
          return source ? (
            <AssessmentEvidenceContext
              key={ref}
              evidence={source}
              onLocateDocument={onLocateDocument}
            />
          ) : (
            <p key={ref} role="alert">
              依据 {ref} 未能读回，不能视为已核实。
            </p>
          );
        })}
      </div>
    </details>
  );
}

export function JobAidRequirement({
  item,
  children,
}: {
  item: JobAidRequirementHandling;
  children?: ReactNode;
}) {
  return (
    <section className="wl-jobaid-requirement">
      <h4>
        {item.requirement}{' '}
        <small>{jobAidTreatmentLabels[item.treatment]}</small>
      </h4>
      {item.conditions.map((condition) => (
        <p key={condition}>适用条件：{condition}</p>
      ))}
      <p>{item.explanation}</p>
      {children}
    </section>
  );
}

export function JobAidIssueArticle({
  issue,
  reading,
  onLocateDocument,
}: {
  issue: JobAidProblemIssue;
  reading: AssessmentReadingResult;
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
}) {
  const sourceDetails = (refs: string[]) => (
    <JobAidEvidenceDetails
      refs={refs}
      evidence={reading.evidence}
      onLocateDocument={onLocateDocument}
    />
  );
  return (
    <>
      <h3>{issue.question}</h3>
      <p>{issue.understanding}</p>
      {issue.statements.length ? (
        <SavedAssessmentReading
          result={{
            ...reading,
            content: { ...reading.content, claims: issue.statements },
          }}
          depth="full"
          presentation="claims"
          locationSuffix={issue.issueKey}
          onLocateDocument={onLocateDocument}
        />
      ) : null}
      {issue.riskScenarios.map((risk, index) => (
        <section key={index} className="wl-jobaid-risk">
          <h4>风险情景：{risk.scenario}</h4>
          {risk.conditions.map((condition) => (
            <p key={condition}>成立条件：{condition}</p>
          ))}
          <p>措施与后果的比较：{risk.controlComparison}</p>
          {risk.limitations.map((limit) => (
            <p key={limit}>限制：{limit}</p>
          ))}
          <dl className="wl-jobaid-risk-classification">
            <div>
              <dt>JA-AC 严重性</dt>
              <dd>{risk.severity?.label ?? '未定级'}</dd>
            </div>
            <div>
              <dt>JA-AC 可能性</dt>
              <dd>{risk.likelihood?.label ?? '未定级'}</dd>
            </div>
            <div>
              <dt>JA-AC 风险等级</dt>
              <dd>
                {risk.riskGrade === null ? '未定级' : `${risk.riskGrade} 级`}
                {risk.gradeMeaning ? ` · ${risk.gradeMeaning}` : ''}
              </dd>
            </div>
            <div>
              <dt>Host 计算分数</dt>
              <dd>
                {risk.score === null ? '依据不足，未计算' : `${risk.score} 分`}
              </dd>
            </div>
          </dl>
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
      {issue.measures.map((measure, index) => (
        <section key={index} className="wl-jobaid-measure">
          <h4>
            {measureLabels[measure.status]}：{measure.text}
          </h4>
          <p>针对：{measure.addresses}</p>
          {measure.limitations.map((limit) => (
            <p key={limit}>措施限制：{limit}</p>
          ))}
          {sourceDetails(measure.basisRefs)}
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
      {issue.openQuestions.length ? (
        <section className="wl-jobaid-open-questions">
          <h4>仍需确认</h4>
          {issue.openQuestions.map((question, index) => (
            <div key={index}>
              <p>{question.question}</p>
              <p>
                影响：{question.affects}。原因：{question.reason}
              </p>
              <p>下一步所需依据：{question.nextEvidence}</p>
            </div>
          ))}
        </section>
      ) : null}
      {issue.requirementHandling.map((item, index) => (
        <JobAidRequirement key={index} item={item}>
          {sourceDetails([item.methodRef, ...item.basisRefs])}
        </JobAidRequirement>
      ))}
      {sourceDetails([...issue.sourceDependencies, ...issue.premiseRefs])}
    </>
  );
}
