import { randomUUID } from 'node:crypto';

import type {
  CanonicalReferenceContextRole,
  CanonicalReferenceExtractionMethod,
  CanonicalReferenceMentionPreviewItem,
  CanonicalRelatedContextRelationRole,
  CanonicalRelatedContextSnapshot,
  CanonicalRelatedContextSnapshotItem,
} from '@shared/api.interface';

interface RelatedContextSnapshotBuildInput {
  workItemId: string;
  inputRevision: number;
  primaryDocumentVersionId: string;
  assessmentTargetContextRef?: string | null;
  assessmentAsOf?: string | null;
  mentions: CanonicalReferenceMentionPreviewItem[];
}

export function buildCanonicalRelatedContextSnapshot(
  input: RelatedContextSnapshotBuildInput,
): { snapshot: CanonicalRelatedContextSnapshot; bytes: Uint8Array } {
  const unresolvedMentions = input.mentions.filter(
    (mention) => mention.resolutionState !== 'RESOLVED_EXACT',
  );
  const snapshot: CanonicalRelatedContextSnapshot = {
    schemaVersion: 'wiselink.3_1.related_context_snapshot.v1' as const,
    snapshotRef: `related-context-snapshot://${encodeURIComponent(input.workItemId)}/${input.inputRevision}/${randomUUID()}`,
    mode: 'EXPLICIT_PREVIEW',
    policyVersion: 'wiselink.related-context.explicit-preview.v1',
    workItemRef: input.workItemId,
    inputRevision: input.inputRevision,
    primaryDocumentVersionRef: input.primaryDocumentVersionId,
    assessmentTargetContextRef: input.assessmentTargetContextRef ?? null,
    assessmentAsOf: input.assessmentAsOf ?? null,
    referenceMentions: input.mentions.map((mention) => ({ ...mention })),
    items: snapshotItems(
      input.mentions,
      input.primaryDocumentVersionId,
      input.assessmentAsOf ?? null,
    ),
    unresolvedMentions: unresolvedMentions.map((mention) => ({ ...mention })),
    retrievalReceipts: [
      {
        channel: 'EXPLICIT_REFERENCE' as const,
        status: 'COMPLETE' as const,
        mentionCount: input.mentions.length,
      },
    ],
    authorization: {
      scope: 'CURRENT_USER_TENANT_WORKITEM',
      allResolvedItemsAuthorized: input.mentions.every(
        (mention) =>
          mention.resolutionState !== 'RESOLVED_EXACT' ||
          mention.permissionState === 'AUTHORIZED',
      ),
    },
    availability: snapshotAvailability(input.mentions),
    downgradeReasons: [
      ...new Set(
        unresolvedMentions.map(
          (mention) => `REFERENCE_${mention.resolutionState}`,
        ),
      ),
    ],
    candidateOnly: true,
    readOnly: true,
    includedInAssessmentInput: false,
  };
  return {
    snapshot,
    bytes: new TextEncoder().encode(JSON.stringify(snapshot)),
  };
}

function snapshotItems(
  mentions: CanonicalReferenceMentionPreviewItem[],
  primaryDocumentVersionRef: string,
  assessmentAsOf: string | null,
): CanonicalRelatedContextSnapshotItem[] {
  const grouped = new Map<
    string,
    {
      first: CanonicalReferenceMentionPreviewItem;
      mentionRefs: Set<string>;
      sourceRefs: Set<string>;
      roles: Set<CanonicalReferenceContextRole>;
      contributionRoles: Set<CanonicalRelatedContextRelationRole>;
      extractionMethods: Set<CanonicalReferenceExtractionMethod>;
      count: number;
    }
  >();
  for (const mention of mentions) {
    const groupingKey =
      mention.normalizedTarget.trim() || `mention:${mention.mentionRef}`;
    const current = grouped.get(groupingKey);
    if (current) {
      mention.sourceRefIds.forEach((sourceRef) =>
        current.sourceRefs.add(sourceRef),
      );
      current.mentionRefs.add(mention.mentionRef);
      current.roles.add(mention.contextRole);
      mention.relationRoleCandidates.forEach((role) =>
        current.contributionRoles.add(role),
      );
      current.extractionMethods.add(mention.extractionMethod);
      current.count += 1;
      continue;
    }
    grouped.set(groupingKey, {
      first: mention,
      mentionRefs: new Set([mention.mentionRef]),
      sourceRefs: new Set(mention.sourceRefIds),
      roles: new Set([mention.contextRole]),
      contributionRoles: new Set(mention.relationRoleCandidates),
      extractionMethods: new Set([mention.extractionMethod]),
      count: 1,
    });
  }

  return [...grouped.values()].map((group, index) => {
    const resolution = group.first.targetResolution;
    const resolved = resolution.status === 'RESOLVED_EXACT';
    const contextItemRef =
      `related-context-item://${encodeURIComponent(primaryDocumentVersionRef)}/` +
      `${index + 1}`;
    const conflictRefs =
      resolution.status === 'RESOLVED_MULTIPLE'
        ? ['MULTIPLE_CURRENT_DOCUMENTS']
        : [];
    return {
      contextItemRef,
      relatedContextItemRef: contextItemRef,
      primaryDocumentVersionRef,
      mentionRefs: [...group.mentionRefs],
      retrievalChannel: 'EXPLICIT_REFERENCE',
      normalizedTarget: group.first.normalizedTarget,
      mentionSourceRefs: [...group.sourceRefs],
      relatedDocumentRef: resolved ? resolution.workItemId : null,
      authorizedExternalRef: null,
      ...(resolved
        ? {
            resolvedDocumentVersionRef: resolution.documentVersionId,
            resolvedWorkItemRef: resolution.workItemId,
          }
        : group.first.normalizedTarget.trim()
          ? { unresolvedIdentity: group.first.normalizedTarget }
          : {}),
      documentType: group.first.documentType,
      contributionRoleCandidates: [...group.contributionRoles],
      acceptedContributionRoles: [],
      relationTypeCandidates: [...group.roles],
      acceptedRelationTypes: [],
      relationRoles: [...group.roles],
      issueRelevance: 'UNKNOWN',
      targetApplicability: group.first.targetApplicability,
      ...(group.first.applicabilityResultRef
        ? { applicabilityResultRef: group.first.applicabilityResultRef }
        : {}),
      currentness: resolved ? 'CURRENT' : 'UNKNOWN',
      authority: group.first.sourceAuthority,
      sourceAuthority: group.first.sourceAuthority,
      sourceBasis: 'PRIMARY_DOCUMENT_EXPLICIT_MENTION',
      evidenceStance: 'NOT_EVALUATED',
      contextUse: 'BACKGROUND_ONLY',
      sourceRefs: [...group.sourceRefs],
      selectedSourceRefs: [],
      assessmentAsOf,
      availability: itemAvailability(resolution.status),
      confidence: group.extractionMethods.has('DETERMINISTIC_TEXT')
        ? 'MEDIUM'
        : 'HIGH',
      reasonCodes: [
        'PRIMARY_DOCUMENT_EXPLICIT_MENTION',
        `REFERENCE_${resolution.status}`,
        'RELATION_CANDIDATE_NOT_ACCEPTED',
        'SOURCE_AUTHORITY_NOT_EVALUATED',
      ],
      provenance: {
        source: 'PRIMARY_DOCUMENT_EXPLICIT_MENTION',
        mentionSourceRefs: [...group.sourceRefs],
        extractionMethods: [...group.extractionMethods],
      },
      conflicts: conflictRefs,
      conflictRefs,
      missingInputs: [
        ...(!resolved ? ['RESOLVED_DOCUMENT_VERSION'] : []),
        ...(group.first.targetApplicability === 'NOT_EVALUATED'
          ? ['TARGET_APPLICABILITY']
          : []),
        ...(group.first.targetApplicability === 'UNKNOWN'
          ? ['TARGET_APPLICABILITY_FACTS']
          : []),
      ],
      roleExplanation: group.first.relationCue
        ? `Explicit citation cue: ${group.first.relationCue}`
        : 'Derived from an explicit citation in the primary document.',
      occurrenceCount: group.count,
      candidateOnly: true,
    };
  });
}

function itemAvailability(
  status: CanonicalReferenceMentionPreviewItem['resolutionState'],
): CanonicalRelatedContextSnapshotItem['availability'] {
  const values: Record<
    CanonicalReferenceMentionPreviewItem['resolutionState'],
    CanonicalRelatedContextSnapshotItem['availability']
  > = {
    RESOLVED_EXACT: 'AVAILABLE',
    RESOLVED_MULTIPLE: 'AMBIGUOUS',
    UNRESOLVED: 'UNRESOLVED',
    DOCUMENT_NOT_INGESTED: 'NOT_INGESTED',
    UNAVAILABLE: 'UNAVAILABLE',
    ACCESS_DENIED: 'ACCESS_DENIED',
    UNSUPPORTED_DOCUMENT: 'UNSUPPORTED',
  };
  return values[status];
}

function snapshotAvailability(
  mentions: CanonicalReferenceMentionPreviewItem[],
): CanonicalRelatedContextSnapshot['availability'] {
  if (
    mentions.length > 0 &&
    mentions.every((mention) => mention.resolutionState === 'UNAVAILABLE')
  ) {
    return 'UNAVAILABLE';
  }
  return mentions.some(
    (mention) => mention.resolutionState !== 'RESOLVED_EXACT',
  )
    ? 'PARTIAL'
    : 'AVAILABLE';
}
