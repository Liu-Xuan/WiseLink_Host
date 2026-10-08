import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type {
  CanonicalCommonAssessmentContext,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import type { JobAidAssessmentContextPackage } from '@shared/jobaid-problem-assessment.interface';

/** Preserve the distinction between a readable main source and restricted references. */
export function buildJobAidContextPackage(input: {
  workItem: CanonicalWorkItemProjection;
  common: CanonicalCommonAssessmentContext;
  catalog: AssessmentEvidence[];
  initiallyDeliveredRefs: string[];
  previousWorkRevision: number | null;
  nativeEvidenceRefs?: string[];
}): JobAidAssessmentContextPackage {
  const delivered: Set<string> = new Set(input.initiallyDeliveredRefs);
  return {
    basedOnWorkItemRevision: input.workItem.revision,
    basedOnWorkingRevision: input.previousWorkRevision,
    primaryDocument: {
      ...input.common.primaryDocument,
      readingStatus: input.common.documentReading.status,
    },
    supplementaryMaterials: {
      status: input.common.relatedMaterials.status,
      reason: input.common.relatedMaterials.reason,
      items: input.common.relatedMaterials.items.map((item) => {
        const { availableSourceRefIds, readFragments: _readFragments, ...metadata } = item;
        const availableEvidenceRefs: string[] = input.catalog.flatMap((evidence) =>
          evidence.kind === 'DOCUMENT_PASSAGE' &&
          evidence.documentVersionId === item.documentVersionRef &&
          availableSourceRefIds.includes(evidence.sourceRefId)
            ? [evidence.evidenceRef]
            : [],
        );
        return {
          ...structuredClone(metadata),
          availableEvidenceRefs,
          deliveredEvidenceRefs: availableEvidenceRefs.filter((ref) => delivered.has(ref)),
        };
      }),
    },
    sourceOrigins: [...input.catalog.map((evidence) =>
      sourceOrigin(evidence, input.workItem.source.documentVersionId),
    ), ...(input.nativeEvidenceRefs ?? []).filter(ref=>!input.catalog.some(item=>item.evidenceRef===ref)).map(evidenceRef=>({evidenceRef,origin:'TDMS_NATIVE_RECORD',contentNature:'SOURCE_DECLARED_PROFESSIONAL_OPINION' as const}))],
    knowledgeRetrieval: structuredClone(input.common.knowledgeRetrieval),
  };
}

function sourceOrigin(
  evidence: AssessmentEvidence,
  primaryDocumentVersionId: string,
): JobAidAssessmentContextPackage['sourceOrigins'][number] {
  const evidenceRef: string = evidence.evidenceRef;
  switch (evidence.kind) {
    case 'TDMS_NATIVE_RECORD':
      return { evidenceRef, origin: 'TDMS_NATIVE_RECORD', contentNature: 'SOURCE_DECLARED_PROFESSIONAL_OPINION' };
    case 'DOCUMENT_PASSAGE':
      return {
        evidenceRef,
        origin: evidence.documentVersionId === primaryDocumentVersionId
          ? 'PRIMARY_DOCUMENT'
          : 'RELATED_DOCUMENT',
        contentNature: 'SOURCE_DOCUMENT_CONTENT',
      };
    case 'ENGINEER_ATTACHMENT':
      return { evidenceRef, origin: 'ENGINEER_ATTACHMENT', contentNature: 'SOURCE_DOCUMENT_CONTENT' };
    case 'ENGINEER_STATEMENT':
      return { evidenceRef, origin: evidence.origin, contentNature: 'UNVERIFIED_ENGINEER_STATEMENT' };
    case 'QUERY_RECEIPT':
      return { evidenceRef, origin: 'QUERY_RECEIPT', contentNature: 'UNVERIFIED_QUERY_RESPONSE' };
    case 'PRIOR_RESULT':
      return { evidenceRef, origin: 'PRIOR_RESULT', contentNature: 'PRIOR_CANDIDATE' };
    case 'HOST_FACT':
      return { evidenceRef, origin: 'HOST_FACT', contentNature: 'CONTROLLED_HOST_FACT' };
    case 'METHOD_CLAUSE':
      return { evidenceRef, origin: evidence.sourceIdentity, contentNature: 'METHOD_MATERIAL' };
  }
}
