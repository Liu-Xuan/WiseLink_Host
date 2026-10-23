import { useState } from 'react';
import { isEqual } from 'es-toolkit/predicate';
import type { EngineeringKnowledgeRead } from '@shared/engineering-issue-search.interface';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import SavedAssessmentReading from '@client/src/features/matter/SavedAssessmentReading';
import { compactReadingSummary } from '@client/src/features/matter/compact-reading-summary';
import EngineeringIssueBody from '@client/src/features/matter/EngineeringIssueBody';
import { SavedJobAidMethodNotice } from '@client/src/features/matter/SavedJobAidReadingContext';
import ReferenceWorkNotices from '@client/src/features/matter/ReferenceWorkNotices';
import RetainedWorkbenchPanel from '@client/src/features/workbench/RetainedWorkbenchPanel';
import { Button } from '@client/src/components/ui/button';
import { JobAidIssueArticle } from './JobAidIssueArticle';
import DocumentSavedEvidenceSource from './DocumentSavedEvidenceSource';
import type { DocumentReadingLinks } from './document-reading-links';
import type { DocumentWorkbenchPanel } from './document-workbench-panel';

interface Props {
  active: DocumentWorkbenchPanel;
  links: DocumentReadingLinks & { loading: boolean };
  onRetry(): void;
  onRejected(message: string): void;
}

export default function DocumentSavedWorkPanels(props: Props) {
  return <>
    <RetainedWorkbenchPanel active={props.active === 'wiki'}>
      <SavedWorkPanel {...props} kind="wiki" />
    </RetainedWorkbenchPanel>
  </>;
}

function SavedWorkPanel({ kind, links, onRetry, onRejected }: Props & { kind: 'assessment' | 'wiki' }) {
  const [source, setSource] = useState<DocumentAssessmentEvidence | null>(null);
  const read = links.knowledge;
  const label: string = kind === 'assessment' ? '评估' : 'Wiki';
  return <section className="document-saved-work-panel" aria-label={`同版本已保存${label}`}>
    <div className="document-saved-work-scroll" inert={Boolean(source)} aria-hidden={source ? true : undefined}>
      <header><h2>{label}</h2><Button size="sm" variant="outline" onClick={onRetry}>重新读取</Button></header>
      {links.loading || links.wikiLoading ? <p role="status">正在读取同版本 Wiki…</p>
        : read ? <FullSavedWork read={read} kind={kind} onLocateDocument={setSource} />
          : links.wikiError || links.error ? <p role="alert">{links.wikiError ?? links.error}</p> : <p>{links.wikiNote}</p>}
    </div>
    {source && read ? <DocumentSavedEvidenceSource evidence={source} onClose={() => setSource(null)} onRejected={onRejected} /> : null}
  </section>;
}

function FullSavedWork({ read, kind, onLocateDocument }: {
  read: EngineeringKnowledgeRead; kind: 'assessment' | 'wiki'; onLocateDocument(evidence: DocumentAssessmentEvidence): void;
}) {
  const content = read.content;
  const headline: string = read.entry.headline || content.headline;
  const brief: string = compactReadingSummary(headline, read.entry.listBrief);
  const overall = read.overall?.readingResult;
  // A JA Overall can project the same immutable work. Keep its conclusion here
  // and render those identical articles once with their complete issue context.
  const sameWorkProjection: boolean = Boolean(overall &&
    overall.resultRef === read.entry.workRef && overall.resultRevision === read.entry.workRevision &&
    overall.content.headline === headline && overall.content.lead === content.understanding &&
    Array.isArray(overall.evidence) && Array.isArray(content.evidence) &&
    isEqual(overall.evidence, content.evidence) &&
    overall.content.issueArticles?.length === content.issues.length &&
    overall.content.issueArticles.every((article, index) => {
      const issue = content.issues[index];
      return article.issueRef === issue.issueRef && article.issueKey === issue.issueKey &&
        article.question === issue.question && article.body === issue.body;
    }));
  return <article data-work-ref={read.entry.workRef} data-work-revision={read.entry.workRevision}>
    <header><h3>{headline}</h3><p>保存修订 {read.entry.workRevision}
      {read.entry.current ? '' : ' · 历史工作'}</p></header>
    {!read.overall && brief !== headline ? <p>{brief}</p> : null}
    {read.overall ? <section aria-label="已保存综合意见"><h3>综合意见</h3>
      {read.overall.status === 'STALE' ? <p>已保存的历史综合意见</p> : null}
      {sameWorkProjection ? <EngineeringIssueBody body={read.overall.readingResult.content.lead}
        evidence={read.overall.readingResult.evidence} onLocateDocument={onLocateDocument} /> : null}
      <SavedAssessmentReading result={read.overall.readingResult} depth={sameWorkProjection ? 'brief' : 'full'}
        presentation={sameWorkProjection ? 'claims' : 'complete'}
        locationSuffix={`document-workbench:${kind}:${read.entry.workRef}:overall`} onLocateDocument={onLocateDocument} />
    </section> : null}
    {content.understanding && !sameWorkProjection ? <section><h3>问题理解</h3>
      <EngineeringIssueBody body={content.understanding} evidence={content.evidence} onLocateDocument={onLocateDocument} />
    </section> : null}
    {content.issues.map((issue, index) => <section className="document-saved-issue" key={`${issue.issueKey}:${index}`}>
      <JobAidIssueArticle issue={issue} evidence={content.evidence} onLocateDocument={onLocateDocument} />
    </section>)}
    {content.completionReason ? <p>{content.completionReason}</p> : null}
    <SavedJobAidMethodNotice work={content} />
    {content.capabilities.map((capability, index) => <p key={index}>{capability.capability}：{capability.impact}</p>)}
    {content.historyReview.limitation ? <p>{content.historyReview.limitation}</p> : null}
    {read.correctionNotices?.map(notice => <p role="note" key={`${notice.issueKey}:${notice.attemptRef}`}>{notice.reason}</p>)}
    <ReferenceWorkNotices notices={read.referenceWorkNotices} />
  </article>;
}
