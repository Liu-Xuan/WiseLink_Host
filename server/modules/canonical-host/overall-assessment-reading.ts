import type {
  AssessmentEvidence,
  AssessmentClaimPremise,
  AssessmentReadingClaim,
  AssessmentReadingContent,
  AssessmentReadingResult,
} from '@shared/assessment-reading.interface';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type { OpenClawEngineerReviewContext } from './selective-overall-resynthesis';
import type { UnifiedArtifactReadScope } from '../unified-reader/unified-artifact-read-scope';

export type OverallAssessmentReadingSummary = Omit<
  AssessmentReadingContent,
  'schemaVersion'
> & { schemaVersion: 'wiselink.3_1.overall_engineering_summary.v2' };

export interface OverallModelEvidence {
  queryProvenance?: Extract<
    AssessmentEvidence,
    { kind: 'QUERY_RECEIPT' }
  >['queryProvenance'];
  evidenceRef: string;
  kind: AssessmentEvidence['kind'];
  title: string;
  versionLabel: string | null;
  excerpt: string;
  locator: string | null;
}

export function overallModelEvidenceRegistry(
  evidence: AssessmentEvidence[],
): OverallModelEvidence[] {
  return evidence.map((item) => ({
    evidenceRef: item.evidenceRef,
    kind: item.kind,
    title: item.title,
    versionLabel: item.versionLabel,
    excerpt: item.excerpt,
    locator: 'locator' in item ? item.locator : null,
    ...(item.kind === 'QUERY_RECEIPT' && item.queryProvenance
      ? { queryProvenance: structuredClone(item.queryProvenance) }
      : {}),
  }));
}

/** Re-read the Host-owned registry from the sealed task without inventing bindings. */
export function readStoredOverallEvidence(
  value: unknown,
): AssessmentEvidence[] {
  return array(value, 'OPENCLAW_OVERALL_READING_EVIDENCE_INVALID').map(
    (value): AssessmentEvidence => {
      const item = record(
        value,
        'OPENCLAW_OVERALL_READING_EVIDENCE_ITEM_INVALID',
      );
      const common = {
        evidenceRef: text(item.evidenceRef, 'OVERALL_EVIDENCE_REF_INVALID'),
        title: text(item.title, 'OVERALL_EVIDENCE_TITLE_INVALID'),
        versionLabel:
          item.versionLabel === null
            ? null
            : text(item.versionLabel, 'OVERALL_EVIDENCE_VERSION_INVALID'),
        excerpt: text(item.excerpt, 'OVERALL_EVIDENCE_EXCERPT_INVALID'),
      };
      switch (item.kind) {
        case 'ENGINEER_ATTACHMENT':
          return {
            ...common,
            kind: 'ENGINEER_ATTACHMENT',
            workItemId: text(
              item.workItemId,
              'OVERALL_ATTACHMENT_WORK_ITEM_REQUIRED',
            ),
            reviewConversationId: text(
              item.reviewConversationId,
              'OVERALL_ATTACHMENT_CONVERSATION_REQUIRED',
            ),
            reviewTurnId: text(
              item.reviewTurnId,
              'OVERALL_ATTACHMENT_TURN_REQUIRED',
            ),
            attachmentRef: text(
              item.attachmentRef,
              'OVERALL_ATTACHMENT_REF_REQUIRED',
            ),
            documentVersionId: text(
              item.documentVersionId,
              'OVERALL_ATTACHMENT_VERSION_REQUIRED',
            ),
            artifactRef: text(
              item.artifactRef,
              'OVERALL_ATTACHMENT_ARTIFACT_REQUIRED',
            ),
            artifactSha256: text(
              item.artifactSha256,
              'OVERALL_ATTACHMENT_HASH_REQUIRED',
            ),
            locator: text(item.locator, 'OVERALL_ATTACHMENT_LOCATOR_REQUIRED'),
          };
        case 'METHOD_CLAUSE':
          if (
            item.sourceVersionStatus !== 'CONFIRMED' &&
            item.sourceVersionStatus !== 'VERSION_UNCONFIRMED'
          )
            throw new Error('OVERALL_METHOD_VERSION_STATUS_INVALID');
          return {
            ...common,
            kind: item.kind,
            packRef: text(item.packRef, 'OVERALL_METHOD_PACK_INVALID'),
            methodRef: text(item.methodRef, 'OVERALL_METHOD_REF_INVALID'),
            sourceIdentity: text(
              item.sourceIdentity,
              'OVERALL_METHOD_SOURCE_INVALID',
            ),
            locator: text(item.locator, 'OVERALL_METHOD_LOCATOR_INVALID'),
            sourceVersionStatus: item.sourceVersionStatus,
          };
        case 'DOCUMENT_PASSAGE':
          return {
            ...common,
            kind: item.kind,
            workItemId: text(
              item.workItemId,
              'OVERALL_EVIDENCE_WORK_ITEM_INVALID',
            ),
            documentVersionId: text(
              item.documentVersionId,
              'OVERALL_EVIDENCE_DOCUMENT_VERSION_INVALID',
            ),
            sourceRefId: text(
              item.sourceRefId,
              'OVERALL_EVIDENCE_SOURCE_REF_INVALID',
            ),
            locator: text(item.locator, 'OVERALL_EVIDENCE_LOCATOR_INVALID'),
          };
        case 'ENGINEER_STATEMENT':
          if (item.origin === 'ENGINEER_REVIEW_LEDGER') {
            return {
              ...common,
              kind: item.kind,
              origin: item.origin,
              workItemId: text(
                item.workItemId,
                'OVERALL_EVIDENCE_WORK_ITEM_INVALID',
              ),
              reviewRevision: positiveInteger(
                item.reviewRevision,
                'OVERALL_EVIDENCE_REVIEW_REVISION_INVALID',
              ),
              sequence: positiveInteger(
                item.sequence,
                'OVERALL_EVIDENCE_REVIEW_SEQUENCE_INVALID',
              ),
              sourceRefId: text(
                item.sourceRefId,
                'OVERALL_EVIDENCE_SOURCE_REF_INVALID',
              ),
              locator: text(item.locator, 'OVERALL_EVIDENCE_LOCATOR_INVALID'),
              recordedAt: text(
                item.recordedAt,
                'OVERALL_EVIDENCE_RECORDED_AT_INVALID',
              ),
            };
          }
          if (item.origin === 'REVIEW_CONVERSATION') {
            return {
              ...common,
              kind: item.kind,
              origin: item.origin,
              reviewConversationId: text(
                item.reviewConversationId,
                'OVERALL_EVIDENCE_CONVERSATION_INVALID',
              ),
              reviewTurnId: text(
                item.reviewTurnId,
                'OVERALL_EVIDENCE_TURN_INVALID',
              ),
              engineerSuppliedInputId: text(
                item.engineerSuppliedInputId,
                'OVERALL_EVIDENCE_ENGINEER_INPUT_INVALID',
              ),
              recordedAt: text(
                item.recordedAt,
                'OVERALL_EVIDENCE_RECORDED_AT_INVALID',
              ),
            };
          }
          throw new Error('OVERALL_EVIDENCE_ENGINEER_ORIGIN_INVALID');
        case 'HOST_FACT':
          return {
            ...common,
            kind: item.kind,
            workItemId: text(
              item.workItemId,
              'OVERALL_EVIDENCE_WORK_ITEM_INVALID',
            ),
            workItemRevision: positiveInteger(
              item.workItemRevision,
              'OVERALL_EVIDENCE_WORK_ITEM_REVISION_INVALID',
            ),
            factRef: text(item.factRef, 'OVERALL_EVIDENCE_FACT_REF_INVALID'),
            recordedAt: text(
              item.recordedAt,
              'OVERALL_EVIDENCE_RECORDED_AT_INVALID',
            ),
          };
        case 'QUERY_RECEIPT':
          if (item.queryProvenance !== undefined) {
            const provenance = record(
              item.queryProvenance,
              'OVERALL_QUERY_PROVENANCE_INVALID',
            );
            if (
              provenance.origin !== 'AILY_RETRIEVAL' ||
              provenance.originalDocumentsVerified !== false ||
              !['COMPLETED', 'FAILED', 'UNKNOWN'].includes(
                String(provenance.status),
              ) ||
              typeof provenance.queryText !== 'string' ||
              !provenance.queryText.trim()
            )
              throw new Error('OVERALL_QUERY_PROVENANCE_INVALID');
          }
          if (item.coverage !== 'COMPLETE' && item.coverage !== 'PARTIAL')
            throw new Error('OVERALL_EVIDENCE_QUERY_COVERAGE_INVALID');
          return {
            ...common,
            kind: item.kind,
            receiptRef: text(
              item.receiptRef,
              'OVERALL_EVIDENCE_QUERY_REF_INVALID',
            ),
            checkedScope: text(
              item.checkedScope,
              'OVERALL_EVIDENCE_QUERY_SCOPE_INVALID',
            ),
            queriedAt: text(
              item.queriedAt,
              'OVERALL_EVIDENCE_QUERY_TIME_INVALID',
            ),
            coverage: item.coverage,
            ...(item.queryProvenance
              ? {
                  queryProvenance: structuredClone(
                    item.queryProvenance,
                  ) as Extract<
                    AssessmentEvidence,
                    { kind: 'QUERY_RECEIPT' }
                  >['queryProvenance'],
                }
              : {}),
          };
        case 'PRIOR_RESULT':
          return {
            ...common,
            kind: item.kind,
            resultRef: text(
              item.resultRef,
              'OVERALL_EVIDENCE_RESULT_REF_INVALID',
            ),
            resultRevision: positiveInteger(
              item.resultRevision,
              'OVERALL_EVIDENCE_RESULT_REVISION_INVALID',
            ),
            originalEvidenceRefs: array(
              item.originalEvidenceRefs,
              'OVERALL_EVIDENCE_ORIGINAL_REFS_INVALID',
            ).map((value) =>
              text(value, 'OVERALL_EVIDENCE_ORIGINAL_REF_INVALID'),
            ),
          };
        default:
          throw new Error('OVERALL_EVIDENCE_KIND_INVALID');
      }
    },
  );
}

/** Only verified bytes and effective ledger entries supplied to this task count. */
export function buildOverallReadingEvidence(input: {
  workItem: CanonicalWorkItemProjection;
  packageBytes: Uint8Array;
  engineerReviewContext: OpenClawEngineerReviewContext;
  relatedReadingEvidence?: AssessmentEvidence[];
  readScope?: UnifiedArtifactReadScope;
}): AssessmentEvidence[] {
  const pkg = record(
    input.readScope
      ? input.readScope.parseJson(input.packageBytes)
      : JSON.parse(new TextDecoder().decode(input.packageBytes)),
    'PACKAGE_ARTIFACT_JSON_INVALID',
  );
  const evidence: AssessmentEvidence[] = array(
    pkg.sourceRefs,
    'SOURCE_CONTEXT_REFS_INVALID',
  ).flatMap((value, index) => {
    const ref = record(value, 'SOURCE_CONTEXT_REF_INVALID');
    // A locator without text does not become a usable passage premise.
    if (typeof ref.quote !== 'string' || !ref.quote.trim()) return [];
    const pageStart = positiveInteger(ref.pageStart, 'SOURCE_PAGE_INVALID');
    const pageEnd = positiveInteger(ref.pageEnd, 'SOURCE_PAGE_INVALID');
    return [
      {
        evidenceRef: `overall-evidence:primary:${index + 1}`,
        kind: 'DOCUMENT_PASSAGE' as const,
        title:
          input.workItem.package?.title ||
          input.workItem.package?.documentIdentity?.documentCode ||
          input.workItem.source.documentId,
        versionLabel:
          input.workItem.package?.documentIdentity?.businessRevision ?? null,
        // v2 keeps the entire supplied passage, including trailing conditions.
        excerpt: ref.quote,
        workItemId: input.workItem.workItemId,
        documentVersionId: input.workItem.source.documentVersionId,
        sourceRefId: text(ref.sourceRefId, 'SOURCE_CONTEXT_REF_ID_INVALID'),
        locator: `page ${pageStart}-${pageEnd}`,
      },
    ];
  });
  const reviews = input.engineerReviewContext;
  for (const review of reviews.effective) {
    review.evidence.forEach((item, index) => {
      const reviewRevision = positiveInteger(
        reviews.revision,
        'OVERALL_REVIEW_EVIDENCE_REVISION_INVALID',
      );
      evidence.push({
        evidenceRef: `overall-evidence:engineer-review:${review.sequence}:${index + 1}`,
        kind: 'ENGINEER_STATEMENT',
        origin: 'ENGINEER_REVIEW_LEDGER',
        title: `工程师评审 ${review.criterionId} · ${item.kind}`,
        versionLabel: `review revision ${reviewRevision}`,
        excerpt: text(
          item.statement,
          'OVERALL_REVIEW_EVIDENCE_STATEMENT_INVALID',
        ),
        workItemId: input.workItem.workItemId,
        reviewRevision,
        sequence: positiveInteger(
          review.sequence,
          'OVERALL_REVIEW_EVIDENCE_SEQUENCE_INVALID',
        ),
        sourceRefId: text(
          item.sourceRefId,
          'OVERALL_REVIEW_EVIDENCE_SOURCE_REF_INVALID',
        ),
        locator: text(item.locator, 'OVERALL_REVIEW_EVIDENCE_LOCATOR_INVALID'),
        recordedAt: text(
          review.recordedAt,
          'OVERALL_REVIEW_EVIDENCE_RECORDED_AT_INVALID',
        ),
      });
    });
  }
  evidence.push(...structuredClone(input.relatedReadingEvidence ?? []));
  if (
    new Set(evidence.map((item) => item.evidenceRef)).size !== evidence.length
  ) {
    throw new Error('OVERALL_DUPLICATE_EVIDENCE_REF');
  }
  return readStoredOverallEvidence(evidence);
}

/** The model supplies reading content; source identities come from the Host. */
export function validateOverallAssessmentReading(
  value: unknown,
  evidenceRegistry: ReadonlyArray<Pick<AssessmentEvidence, 'evidenceRef'>>,
): AssessmentReadingContent {
  const summary = record(value, 'OVERALL_ENGINEERING_SUMMARY_INVALID');
  exactKeys(
    summary,
    [
      'schemaVersion',
      'headline',
      'listBrief',
      'lead',
      'claims',
      'decisiveClaimIds',
    ],
    'OVERALL_ENGINEERING_SUMMARY',
  );
  if (summary.schemaVersion !== 'wiselink.3_1.overall_engineering_summary.v2') {
    throw new Error('OVERALL_ENGINEERING_SUMMARY_VERSION_INVALID');
  }
  const knownEvidence = new Set(
    evidenceRegistry.map((item) => item.evidenceRef),
  );
  if (knownEvidence.size !== evidenceRegistry.length) {
    throw new Error('OVERALL_DUPLICATE_EVIDENCE_REF');
  }
  const claimIds = new Set<string>();
  const claims = array(
    summary.claims,
    'OVERALL_CLAIMS_INVALID',
  ).map<AssessmentReadingClaim>((value) => {
    const claim = record(value, 'OVERALL_CLAIM_INVALID');
    exactKeys(claim, ['claimId', 'text', 'basis', 'premises'], 'OVERALL_CLAIM');
    const claimId = text(claim.claimId, 'OVERALL_CLAIM_ID_INVALID');
    if (claimIds.has(claimId)) throw new Error('OVERALL_DUPLICATE_CLAIM_ID');
    claimIds.add(claimId);
    const basis = claim.basis;
    if (basis !== 'SOURCE_FACT' && basis !== 'CONDITIONAL_INFERENCE') {
      throw new Error('OVERALL_CLAIM_BASIS_INVALID');
    }
    const refs = new Set<string>();
    const premises = array(
      claim.premises,
      'OVERALL_CLAIM_PREMISES_INVALID',
    ).map<AssessmentClaimPremise>((value) => {
      const premise = record(value, 'OVERALL_CLAIM_PREMISE_INVALID');
      exactKeys(
        premise,
        ['evidenceRef', 'role', 'explanation', 'limitation'],
        'OVERALL_CLAIM_PREMISE',
      );
      const evidenceRef = text(
        premise.evidenceRef,
        'OVERALL_EVIDENCE_REF_INVALID',
      );
      if (!knownEvidence.has(evidenceRef)) {
        throw new Error(`OVERALL_UNKNOWN_EVIDENCE_REF:${evidenceRef}`);
      }
      if (refs.has(evidenceRef))
        throw new Error('OVERALL_DUPLICATE_CLAIM_EVIDENCE_REF');
      refs.add(evidenceRef);
      const role = premise.role;
      if (
        role !== 'SUPPORTS' &&
        role !== 'LIMITS' &&
        role !== 'CONTEXT' &&
        role !== 'CONFLICTS'
      ) {
        throw new Error('OVERALL_CLAIM_PREMISE_ROLE_INVALID');
      }
      return {
        evidenceRef,
        role,
        explanation: text(
          premise.explanation,
          'OVERALL_CLAIM_PREMISE_EXPLANATION_INVALID',
        ),
        limitation:
          premise.limitation === null
            ? null
            : text(
                premise.limitation,
                'OVERALL_CLAIM_PREMISE_LIMITATION_INVALID',
              ),
      };
    });
    if (premises.length === 0)
      throw new Error('OVERALL_CLAIM_PREMISES_REQUIRED');
    return {
      claimId,
      text: text(claim.text, 'OVERALL_CLAIM_TEXT_INVALID'),
      basis,
      premises,
    };
  });
  if (claims.length === 0) throw new Error('OVERALL_CLAIMS_REQUIRED');
  const decisiveClaimIds = array(
    summary.decisiveClaimIds,
    'OVERALL_DECISIVE_CLAIM_IDS_INVALID',
  ).map((value) => text(value, 'OVERALL_DECISIVE_CLAIM_ID_INVALID'));
  if (new Set(decisiveClaimIds).size !== decisiveClaimIds.length) {
    throw new Error('OVERALL_DUPLICATE_DECISIVE_CLAIM_ID');
  }
  for (const claimId of decisiveClaimIds) {
    if (!claimIds.has(claimId))
      throw new Error(`OVERALL_UNKNOWN_DECISIVE_CLAIM_ID:${claimId}`);
  }
  return {
    schemaVersion: 'wiselink.3_1.assessment_reading.v1',
    headline: text(summary.headline, 'OVERALL_HEADLINE_INVALID'),
    listBrief: text(summary.listBrief, 'OVERALL_LIST_BRIEF_INVALID'),
    lead: text(summary.lead, 'OVERALL_LEAD_INVALID'),
    claims,
    decisiveClaimIds,
  };
}

export function projectOverallAssessmentReading(input: {
  summary: unknown;
  evidenceRegistry: AssessmentEvidence[];
  resultRef: string;
  resultRevision: number;
  workItemId: string;
  documentVersionId: string;
}): AssessmentReadingResult {
  const content = validateOverallAssessmentReading(
    input.summary,
    input.evidenceRegistry,
  );
  const cited = new Set(
    content.claims.flatMap((claim) =>
      claim.premises.map((premise) => premise.evidenceRef),
    ),
  );
  return {
    resultRef: input.resultRef,
    resultRevision: input.resultRevision,
    scope: {
      kind: 'WORK_ITEM',
      workItemId: input.workItemId,
      documentVersionId: input.documentVersionId,
    },
    content,
    evidence: structuredClone(
      input.evidenceRegistry.filter((item) => cited.has(item.evidenceRef)),
    ),
    candidateOnly: true,
  };
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(code);
  return value as Record<string, unknown>;
}

function text(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value;
}

function array(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(code);
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
  code: string,
): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value))
  ) {
    throw new Error(`${code}_KEYS_INVALID`);
  }
}

function positiveInteger(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error(code);
  return value;
}
