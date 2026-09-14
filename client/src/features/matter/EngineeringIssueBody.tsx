import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { DocumentAssessmentEvidence } from './assessment-reading';
import AssessmentEvidenceContext from './AssessmentEvidenceContext';

export default function EngineeringIssueBody({ body, evidence, onLocateDocument }: {
  body: string; evidence: AssessmentEvidence[];
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
}) {
  const parts = body.split(/(\[\[[^\[\]\r\n]+\]\])/gu);
  return <div className="whitespace-pre-wrap leading-7">{parts.map((part, index) => {
    if (!part.startsWith('[[') || !part.endsWith(']]')) return <span key={index}>{part}</span>;
    const ref = part.slice(2, -2);
    const source = evidence.find(item => item.evidenceRef === ref);
    return source ? <details key={index} className="inline-block align-top mx-1">
      <summary className="cursor-pointer text-primary">依据</summary>
      <AssessmentEvidenceContext evidence={source} onLocateDocument={onLocateDocument} />
    </details> : <span key={index} role="alert">［依据无法读回］</span>;
  })}</div>;
}
