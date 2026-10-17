import { useEffect, useState } from 'react';
import { getCanonicalHostClientSessionGeneration, getDocumentParsingPage } from '@client/src/api/canonical-host';
import type { CanonicalDocumentParsingPageResponse, CanonicalLibraryQuicklookResponse } from '@shared/api.interface';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import SavedAssessmentReading from '@client/src/features/matter/SavedAssessmentReading';
import AssessmentRuleWorkspace from './AssessmentRuleWorkspace';
import { assertDocumentReadingVersion } from './document-parsing-load';

export function validateSavedLegacyAssessment(page: CanonicalDocumentParsingPageResponse,
  saved: CanonicalLibraryQuicklookResponse): CanonicalDocumentParsingPageResponse {
  assertDocumentReadingVersion(page, saved.document.workItemId, saved.document.documentVersionId);
  const overall = page.workItem.integratedAssessment?.overallSynthesis;
  if (!saved.result || !overall || overall.sourceResultId !== saved.result.sourceResultId ||
      overall.revision !== saved.result.revision)
    throw new Error('已保存评估版本已变化，请重新读取当前面板。');
  return page;
}

/** The existing full read supplies every rule; the list quicklook is never its body. */
export default function DocumentSavedLegacyAssessment({ saved, onLocateDocument, onRejected }: {
  saved: CanonicalLibraryQuicklookResponse;
  onLocateDocument(evidence: DocumentAssessmentEvidence): void;
  onRejected(message: string): void;
}) {
  const session: number = getCanonicalHostClientSessionGeneration();
  const identity: string = JSON.stringify([session, saved.document.documentVersionId,
    saved.document.workItemId, saved.result?.sourceResultId, saved.result?.revision]);
  const [state, setState] = useState<{ identity: string; page: CanonicalDocumentParsingPageResponse | null; error: string | null } | null>(null);
  const [criterion, setCriterion] = useState('');
  const [sourceNote, setSourceNote] = useState<string | null>(null);
  useEffect(() => {
    const controller: AbortController = new AbortController();
    const current = (): boolean => !controller.signal.aborted && session === getCanonicalHostClientSessionGeneration();
    setState(null);
    void getDocumentParsingPage(saved.document.workItemId, '').then((page: CanonicalDocumentParsingPageResponse) => {
      if (!current()) return;
      const valid = validateSavedLegacyAssessment(page, saved);
      setCriterion(valid.engineerReviewContext?.items[0]?.criterionId ?? '');
      setState({ identity, page: valid, error: null });
    }).catch((reason: unknown) => {
      if (!current()) return;
      const message: string = reason instanceof Error ? reason.message : '完整评估读取未完成。';
      setState({ identity, page: null, error: message });
      if (reason && typeof reason === 'object' && 'statusCode' in reason &&
        [401, 403, 404].includes(Number(reason.statusCode))) onRejected(message);
    });
    return () => controller.abort();
  }, [identity, session, saved, onRejected]);
  const value = state?.identity === identity ? state : null;
  const overall = value?.page?.workItem.integratedAssessment?.overallSynthesis;
  const summary = overall?.engineeringSummary;
  const groups = summary ? [
    { title: '综合判断', items: [summary.conclusion] },
    { title: '关注原因', items: summary.whyItMatters },
    { title: '适用范围与待核事实', items: [summary.applicability.sourceScope, summary.applicability.fleetMatch, ...summary.applicability.requiredFacts] },
    { title: '实施影响', items: summary.implementationImpact },
    { title: '处理顺序', items: summary.dispositionPriority },
    { title: '下一步', items: summary.nextActions },
  ] : [];
  return <>
    {!value ? <p role="status">正在读取完整评估…</p> : value.error ? <p role="alert">{value.error}</p> : <>
      {overall?.readingResult ? <SavedAssessmentReading result={overall.readingResult} depth="full"
        locationSuffix={`document-workbench:assessment:${overall.sourceResultId}`} onLocateDocument={onLocateDocument} />
        : groups.map(group => <section key={group.title}><h3>{group.title}</h3>{group.items.map((item, index) =>
          <div key={index}><p>{item.text}</p>{item.sourceRefIds.length ? <small>来源：{item.sourceRefIds.join('、')}</small> : null}</div>)}</section>)}
      {overall?.findings?.map((finding, index) => <section key={index}>
        <h3>{finding.finding}</h3><p>{finding.basis}</p>
        {finding.assumptions.map((assumption, position) => <p key={position}>适用前提：{assumption}</p>)}
        {finding.uncertainty ? <p>待核：{finding.uncertainty}</p> : null}
      </section>)}
      {overall?.missingInputs?.map(item => <p key={item}>待补充：{item}</p>)}
      {overall?.gap ? <p>{overall.gap}</p> : null}
      {value.page?.engineerReviewContext?.items.length ? <AssessmentRuleWorkspace
        items={value.page.engineerReviewContext.items} selectedCriterionId={criterion} onSelectCriterion={setCriterion}
        onLocateSourceRef={ref => setSourceNote(`保存的原文引用：${ref}`)} /> : <p>本版未返回规则正文。</p>}
      {sourceNote ? <p role="status">{sourceNote}</p> : null}
    </>}
  </>;
}
