import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DerivedSummaryRevision } from '@shared/derived-summary.interface';
import EngineeringIssueBody from '@client/src/features/matter/EngineeringIssueBody';
import AssessmentEvidenceContext from '@client/src/features/matter/AssessmentEvidenceContext';
import MatterDocumentSourceDialog from '@client/src/features/matter/MatterDocumentSourceDialog';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import { summaryMemberRoute } from './summary-selection';
import { exactDocumentSourceRoute } from '@client/src/features/matter/matter-navigation';

export default function DerivedSummaryBody({ revision }: { revision: DerivedSummaryRevision }) {
  const [source, setSource] = useState<DocumentAssessmentEvidence | null>(null);
  const navigate = useNavigate();
  const locateSource = (value: DocumentAssessmentEvidence) => {
    const route = exactDocumentSourceRoute(value);
    if (route) navigate(route); else setSource(value);
  };
  return <>
    <div className="whitespace-pre-wrap break-words leading-7">{revision.content.body.split(/(\[\[[^\[\]\r\n]+\]\])/gu).map((part, index) => {
      if (!part.startsWith('[[') || !part.endsWith(']]')) return <span key={index}>{part}</span>;
      const ref = part.slice(2, -2);
      const member = revision.members.find(item => item.evidenceRef === ref);
      const evidence = revision.evidence.find(item => item.evidenceRef === ref);
      return member ? <details key={index} className="mx-1 inline-block align-top"><summary className="cursor-pointer text-primary">成员工作依据</summary>
        <div className="space-y-2 border border-border p-3"><strong>{member.headline}</strong><p>派生工作，沿原根来源阅读。</p>
          <EngineeringIssueBody body={member.body} evidence={member.evidence} onLocateDocument={locateSource} />
          <Link className="underline" to={summaryMemberRoute(member.member)}>阅读确切成员版本</Link></div>
      </details> : evidence ? <details key={index} className="mx-1 inline-block align-top"><summary className="cursor-pointer text-primary">来源依据</summary>
        <AssessmentEvidenceContext evidence={evidence} onLocateDocument={locateSource} />
      </details> : <span key={index} role="alert">［依据无法读回］</span>;
    })}</div>
    {source ? <MatterDocumentSourceDialog key={`${source.documentVersionId}:${source.sourceRefId}`} documentVersionId={source.documentVersionId}
      sourceRef={source.sourceRefId} onClose={() => setSource(null)} /> : null}
  </>;
}
