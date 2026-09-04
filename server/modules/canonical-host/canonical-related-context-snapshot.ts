import { createHash } from 'node:crypto';

import type {
  CanonicalReferenceContextRole,
  CanonicalReferenceMentionPreviewItem,
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
  const body = {
    schemaVersion: 'wiselink.3_1.related_context_snapshot.v1' as const,
    workItemRef: input.workItemId,
    inputRevision: input.inputRevision,
    primaryDocumentVersionRef: input.primaryDocumentVersionId,
    assessmentTargetContextRef: input.assessmentTargetContextRef ?? null,
    assessmentAsOf: input.assessmentAsOf ?? null,
    items: snapshotItems(input.mentions),
    retrievalReceipts: [
      {
        channel: 'EXPLICIT_REFERENCE' as const,
        status: 'COMPLETE' as const,
        mentionCount: input.mentions.length,
      },
    ],
    authority: {
      candidateOnly: true as const,
      readOnly: true as const,
      includedInAssessmentInput: false as const,
    },
  };
  const contentHash = createHash('sha256')
    .update(JSON.stringify(body))
    .digest('hex');
  const snapshot: CanonicalRelatedContextSnapshot = {
    ...body,
    snapshotRef: `related-context-snapshot://sha256/${contentHash}`,
    contentHash,
  };
  return {
    snapshot,
    bytes: new TextEncoder().encode(JSON.stringify(snapshot)),
  };
}

function snapshotItems(
  mentions: CanonicalReferenceMentionPreviewItem[],
): CanonicalRelatedContextSnapshotItem[] {
  const grouped = new Map<
    string,
    {
      first: CanonicalReferenceMentionPreviewItem;
      sourceRefs: Set<string>;
      roles: Set<CanonicalReferenceContextRole>;
      count: number;
    }
  >();
  for (const mention of mentions) {
    const current = grouped.get(mention.normalizedTarget);
    if (current) {
      mention.sourceRefIds.forEach((sourceRef) =>
        current.sourceRefs.add(sourceRef),
      );
      current.roles.add(mention.contextRole);
      current.count += 1;
      continue;
    }
    grouped.set(mention.normalizedTarget, {
      first: mention,
      sourceRefs: new Set(mention.sourceRefIds),
      roles: new Set([mention.contextRole]),
      count: 1,
    });
  }

  return [...grouped.values()].map((group, index) => {
    const resolution = group.first.targetResolution;
    const resolved = resolution.status === 'RESOLVED_EXACT';
    return {
      relatedContextItemRef: `related-context-item://${index + 1}`,
      retrievalChannel: 'EXPLICIT_REFERENCE',
      normalizedTarget: group.first.normalizedTarget,
      mentionSourceRefs: [...group.sourceRefs],
      ...(resolved
        ? {
            resolvedDocumentVersionRef: resolution.documentVersionId,
            resolvedWorkItemRef: resolution.workItemId,
          }
        : { unresolvedIdentity: group.first.normalizedTarget }),
      documentType: group.first.documentType,
      relationRoles: [...group.roles],
      issueRelevance: 'EXPLICIT_REFERENCE',
      targetApplicability: group.first.targetApplicability,
      ...(group.first.applicabilityResultRef
        ? { applicabilityResultRef: group.first.applicabilityResultRef }
        : {}),
      currentness: resolved ? 'CURRENT' : 'UNKNOWN',
      authority: 'PRIMARY_DOCUMENT_EXPLICIT_MENTION',
      contextUse: 'BACKGROUND_ONLY',
      selectedSourceRefs: [],
      conflicts:
        resolution.status === 'RESOLVED_MULTIPLE'
          ? ['MULTIPLE_CURRENT_DOCUMENTS']
          : [],
      missingInputs: [
        ...(!resolved ? ['RESOLVED_DOCUMENT_VERSION'] : []),
        ...(group.first.targetApplicability === 'NOT_EVALUATED'
          ? ['TARGET_APPLICABILITY']
          : []),
        ...(group.first.targetApplicability === 'UNKNOWN'
          ? ['TARGET_APPLICABILITY_FACTS']
          : []),
      ],
      occurrenceCount: group.count,
    };
  });
}
