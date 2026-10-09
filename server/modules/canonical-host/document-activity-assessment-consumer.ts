import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { DocumentActivityAssessmentProjection, DocumentActivityAssessmentRecord } from './document-activity-assessment-projection';

/** One catalog hint carrier, never source text or an execution decision. */
export function sourceStatementEvidence(record: DocumentActivityAssessmentRecord): Extract<AssessmentEvidence,{kind:'PRIOR_RESULT'}> {
  return { evidenceRef:record.ref, kind:'PRIOR_RESULT', title:`来源声明候选 · 解析修订 ${record.sourceBinding.original.parseRevision}`,
    versionLabel:record.sourceBinding.original.parseRunId, excerpt:record.statement.label,
    resultRef:record.reference.runRef, resultRevision:record.reference.candidateRevision,
    originalEvidenceRefs:[...new Set([...record.rootRefs,...record.requiredContextRootRefs])],
    sourceStatement:{reference:structuredClone(record.reference),sourceBinding:structuredClone(record.sourceBinding)} };
}
export function sourceStatementDirectory(item: AssessmentEvidence, projections: DocumentActivityAssessmentProjection[]) {
  if(item.kind!=='PRIOR_RESULT'||!item.sourceStatement) return {};
  const entries=projections.flatMap(p=>p.entries).filter(e=>e.ref===item.evidenceRef);
  if(entries.length!==1) throw new Error('JOBAID_SOURCE_STATEMENT_SNAPSHOT_REQUIRED');
  const {reference,label,semanticFieldsAvailability,scopeBasis,sourceSchemaVersion}=entries[0];
  return { sourceStatement:{reference:structuredClone(reference),label,semanticFieldsAvailability,scopeBasis,...(sourceSchemaVersion ? {sourceSchemaVersion} : {})} };
}
