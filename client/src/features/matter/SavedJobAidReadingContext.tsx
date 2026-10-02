import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type {
  JobAidProblemIssue,
  JobAidProblemWorkContent,
  JobAidRequirementHandling,
} from '@shared/jobaid-problem-assessment.interface';
import type { DocumentAssessmentEvidence } from './assessment-reading';
import AssessmentEvidenceContext from './AssessmentEvidenceContext';
import './saved-jobaid-reading.css';

export const jobAidTreatmentLabels: Record<JobAidRequirementHandling['treatment'], string> = {
  ADDRESSED: '已处理',
  CONDITIONS_UNCONFIRMED: '条件待确认',
  NOT_APPLICABLE_WITH_BASIS: '有依据地不适用',
  LATER_BUSINESS_STAGE: '属于后续业务阶段',
  NOT_YET_ADDRESSED: '尚未处理',
};

const measureLabels = {
  PROPOSED: '提出的措施',
  REPORTED_IMPLEMENTED: '来源报告已实施',
  VERIFIED_EFFECTIVE: '保存候选认为有效',
};

/** Uses only the evidence in this exact, Host-authorized saved work. */
export function JobAidEvidenceDetails({ refs, evidence, onLocateDocument, label = '核对来源与方法' }: {
  refs: string[];
  evidence: AssessmentEvidence[];
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
  label?: string;
}) {
  if (!refs.length) return <p className="wl-jobaid-meta">未登记可展开的依据；不能据此认定已经核实。</p>;
  return <details className="wl-jobaid-evidence">
    <summary>{label}（{new Set(refs).size}）</summary>
    <div>{[...new Set(refs)].map((ref: string) => {
      const source = evidence.find((item: AssessmentEvidence) => item.evidenceRef === ref);
      return source ? <AssessmentEvidenceContext key={ref} evidence={source} onLocateDocument={onLocateDocument} />
        : <p key={ref} role="alert">依据 {ref} 未能读回，不能视为已核实。</p>;
    })}</div>
  </details>;
}

/** Method version and delivery do not certify compliance, original reading or adoption. */
export function SavedJobAidMethodNotice({ work }: { work: JobAidProblemWorkContent }) {
  const binding = work.methodBinding;
  const sources = binding?.sources ?? [];
  return <section className="wl-saved-jobaid-notice" aria-label="本版方法与资料边界">
    <p>本版保存的候选分析；不是正式采用、实施或放行决定。</p>
    {sources.length ? <p>{sources.map((source) => <span key={source.sourceIdentity}>
      {source.sourceIdentity} {source.versionLabel} ·{' '}
      {source.status === 'CONFIRMED' && source.documentVersionId
        ? '本版登记版本已确认' : '受控版本身份待确认'}；{' '}
    </span>)}</p> : <p>未取得本版方法绑定；不能据此认定已采用受控方法。</p>}
    <p>{binding?.attachment5 === 'R00_CONTENT_REPORTED_R01_LINK_UNCONFIRMED'
      ? '附件 5：本版登记为 R00 内容转述，与 R01 正文配套待核。'
      : '未取得本版附件 5 的绑定，版次及配套关系待核。'}</p>
    <p>以下来源按本工作保存的登记展示，可含此前沿用资料；本阅读投影未提供区分本轮新读与历史沿用的完整回执，不能宣称本轮已读取全部原件。</p>
  </section>;
}

/** Show every saved condition, limitation and question; never infer priority or configuration. */
export function SavedJobAidIssueContext({ issue, evidence, onLocateDocument }: {
  issue: JobAidProblemIssue;
  evidence: AssessmentEvidence[];
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
}) {
  const risks = issue.riskScenarios ?? [];
  const requirements = issue.requirementHandling ?? [];
  const questions = issue.openQuestions ?? [];
  const measures = issue.measures ?? [];
  const hasConditions = risks.some((risk) => risk.conditions.length || risk.limitations.length) ||
    requirements.some((item) => item.conditions.length) || measures.some((item) => item.limitations.length);
  return <section className="wl-saved-jobaid-context" aria-label="本问题保存的条件、局限与未决问题" data-saved-context-issue={issue.issueKey}>
    {!hasConditions ? <p className="wl-saved-jobaid-caveat">未登记结构化条件或局限；仍须核对完整保存正文，不能据此认定没有条件。</p> : null}
    {risks.map((risk, index: number) => <section key={index}>
      <h4>风险情景：{risk.scenario}</h4>
      {risk.conditions.map((condition: string, position: number) => <p key={position}>成立条件：{condition}</p>)}
      {risk.limitations.map((limit: string, position: number) => <p key={position}>限制：{limit}</p>)}
      <dl className="wl-saved-jobaid-risk">
        <div><dt>JA-AC 严重性</dt><dd>{risk.severity?.label ?? '未定级'}</dd></div>
        <div><dt>JA-AC 可能性</dt><dd>{risk.likelihood?.label ?? '未定级'}</dd></div>
        <div><dt>JA-AC 风险等级</dt><dd>{risk.riskGrade == null ? '未定级' : `${risk.riskGrade} 级`}{risk.gradeMeaning ? ` · ${risk.gradeMeaning}` : ''}</dd></div>
        <div><dt>Host 计算分数</dt><dd>{risk.score == null ? '依据不足，未计算' : `${risk.score} 分`}</dd></div>
      </dl>
    </section>)}
    {requirements.map((item, index: number) => <section key={index}>
      <h4>{item.requirement} · {jobAidTreatmentLabels[item.treatment]}</h4>
      {item.conditions.map((condition: string, position: number) => <p key={position}>适用条件：{condition}</p>)}
      <p>{item.explanation}</p>
      {!item.basisRefs.length ? <p className="wl-saved-jobaid-caveat">未登记对象依据，不能将处理状态视为覆盖已核实。</p> : null}
    </section>)}
    {questions.length ? <section className="wl-jobaid-open-questions">
      <h4>仍需确认与下一步</h4>
      {questions.map((question, index: number) => <div key={index}>
        <p>{question.question}</p><p>影响：{question.affects}。原因：{question.reason}</p>
        <p>下一步所需依据：{question.nextEvidence}</p>
      </div>)}
    </section> : <p className="wl-saved-jobaid-caveat">未登记未决问题，不等于不存在未知。</p>}
    {measures.map((measure, index: number) => <section key={index} className="wl-jobaid-measure">
      <h4>{measureLabels[measure.status]}：{measure.text}</h4>
      <p>针对：{measure.addresses}</p>
      {measure.limitations.map((limit: string, position: number) => <p key={position}>措施限制：{limit}</p>)}
      <p className="wl-saved-jobaid-caveat">该状态是本版保存候选的表述；提议或报告实施不能证明控制有效，也不能据此降低剩余风险。</p>
      <JobAidEvidenceDetails refs={measure.basisRefs} evidence={evidence} onLocateDocument={onLocateDocument} label="核对本措施的保存依据" />
    </section>)}
    {!risks.length ? <p className="wl-saved-jobaid-caveat">未登记风险情景，不等于没有风险。</p> : null}
    {!requirements.length ? <p className="wl-saved-jobaid-caveat">未登记要求处理记录，不能认定方法已覆盖。</p> : null}
    {!measures.length ? <p className="wl-saved-jobaid-caveat">未登记措施，不等于无需措施。</p> : null}
  </section>;
}
