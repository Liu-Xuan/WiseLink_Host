import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { DerivedSummaryMatterCatalogProjection, DerivedSummaryMemberReading,
  DerivedSummaryRevision } from '@shared/derived-summary.interface';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@client/src/components/ui/dialog';
import AssessmentEvidenceContext from '@client/src/features/matter/AssessmentEvidenceContext';
import MatterDocumentSourceDialog from '@client/src/features/matter/MatterDocumentSourceDialog';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import { summaryMemberRoute, summaryMemberVersionLabel, summaryReadingRoute } from './summary-selection';
import { exactDocumentSourceRoute } from '@client/src/features/matter/matter-navigation';
import SummaryMarkdown from './SummaryMarkdown';
import { summaryReadingBrief } from './summary-reading-presentation';
import SummaryEngineeringCatalog from './SummaryEngineeringCatalog';

type SelectedCitation = { kind: 'MEMBER'; member: DerivedSummaryMemberReading }
  | { kind: 'EVIDENCE'; evidence: AssessmentEvidence };

export default function DerivedSummaryBody({ revision, wikiCatalog = false, conditions, matterCatalog }: {
  revision: DerivedSummaryRevision; wikiCatalog?: boolean; conditions?: ReactNode;
  matterCatalog?: DerivedSummaryMatterCatalogProjection;
}) {
  const [source, setSource] = useState<DocumentAssessmentEvidence | null>(null);
  const [citation, setCitation] = useState<SelectedCitation | null>(null);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const brief = summaryReadingBrief(revision.content);
  const citationBody = [brief, revision.content.body].filter(Boolean).join('\n\n');
  const citationLabel = (reference: string) => revision.members.find(item => item.evidenceRef === reference)?.headline ??
    (revision.evidence.some(item => item.evidenceRef === reference) ? '来源依据' : undefined);
  const locateSource = (value: DocumentAssessmentEvidence) => {
    setCitation(null);
    const route = exactDocumentSourceRoute(value);
    if (route) navigate(summaryReadingRoute(route, params)); else setSource(value);
  };
  const openCitation = (reference: string) => {
    const member = revision.members.find(item => item.evidenceRef === reference);
    const evidence = revision.evidence.find(item => item.evidenceRef === reference);
    if (member) setCitation({ kind: 'MEMBER', member });
    else if (evidence) setCitation({ kind: 'EVIDENCE', evidence });
  };
  return <>
    {!wikiCatalog && brief ? <section className="summary-reading-brief" aria-label="阅读要点">
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">要点</h2>
      <SummaryMarkdown body={brief} citationBody={citationBody} citationLabel={citationLabel} onCitation={openCitation} />
    </section> : null}
    {wikiCatalog ? <SummaryEngineeringCatalog revision={revision}
      conditions={conditions} brief={brief} matterCatalog={matterCatalog}
      readingRoute={(route: string) => summaryReadingRoute(route, params)} renderMarkdown={(body: string) =>
        <SummaryMarkdown body={body} citationBody={citationBody} foldSupportingSections
          citationLabel={citationLabel} onCitation={openCitation} />} />
      : <SummaryMarkdown body={revision.content.body} citationBody={citationBody} foldSupportingSections
        citationLabel={citationLabel} onCitation={openCitation} />}
    <Dialog open={citation !== null} onOpenChange={(open: boolean) => { if (!open) setCitation(null); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{citation?.kind === 'MEMBER' ? citation.member.headline : '来源依据'}</DialogTitle>
          <DialogDescription>{citation?.kind === 'MEMBER' ? summaryMemberVersionLabel(citation.member.member) : '核对本条依据及其准确来源。'}</DialogDescription>
        </DialogHeader>
        {citation?.kind === 'MEMBER' ? <>
          <SummaryMarkdown body={citation.member.body} citationLabel={(reference: string) =>
            citation.member.evidence.some(item => item.evidenceRef === reference) ? '来源依据' : undefined}
            onCitation={(reference: string) => {
              const evidence = citation.member.evidence.find(item => item.evidenceRef === reference);
              if (evidence) setCitation({ kind: 'EVIDENCE', evidence });
            }} />
          <Link className="underline" to={summaryReadingRoute(summaryMemberRoute(citation.member.member), params)}>阅读确切成员版本</Link>
        </> : citation?.kind === 'EVIDENCE' ? <AssessmentEvidenceContext evidence={citation.evidence} onLocateDocument={locateSource} /> : null}
      </DialogContent>
    </Dialog>
    {source ? <MatterDocumentSourceDialog key={`${source.documentVersionId}:${source.sourceRefId}`} documentVersionId={source.documentVersionId}
      sourceRef={source.sourceRefId} onClose={() => setSource(null)} /> : null}
  </>;
}
