import type {
  CanonicalReferenceMentionPreviewItem,
  CanonicalRelatedContextPreviewResponse,
  ReviewTurnReadModel,
} from '@shared/api.interface';

export interface ReviewPrimaryMaterial {
  title: string;
  documentVersionId: string;
  versionLabel?: string;
}

export interface ReviewAttachmentMaterial {
  ref: string;
  turnNos: number[];
}

export interface ReviewCitedSource {
  sourceRef: string;
  citations: Array<{ turnNo: number; inputRevision: number }>;
}

/** Count exact persisted references, never treat a fragment or an answer as another document. */
export function reviewMaterialReferences(turns: ReviewTurnReadModel[]): {
  attachments: ReviewAttachmentMaterial[];
  citedSources: ReviewCitedSource[];
} {
  const attachments = new Map<string, ReviewAttachmentMaterial>();
  const citedSources = new Map<string, ReviewCitedSource>();
  for (const turn of [...turns].sort(
    (left, right) => left.turnNo - right.turnNo,
  )) {
    for (const ref of new Set([
      ...turn.attachmentRefs,
      ...turn.engineerSuppliedInput.attachmentRefs,
    ])) {
      const item = attachments.get(ref) ?? { ref, turnNos: [] };
      if (!item.turnNos.includes(turn.turnNo)) item.turnNos.push(turn.turnNo);
      attachments.set(ref, item);
    }
    for (const sourceRef of new Set(
      turn.assistantCandidate?.sourceRefs ?? [],
    )) {
      const item = citedSources.get(sourceRef) ?? { sourceRef, citations: [] };
      if (!item.citations.some((citation) => citation.turnNo === turn.turnNo)) {
        item.citations.push({
          turnNo: turn.turnNo,
          inputRevision: turn.inputRevision,
        });
      }
      citedSources.set(sourceRef, item);
    }
  }
  return {
    attachments: [...attachments.values()],
    citedSources: [...citedSources.values()],
  };
}

export interface ReferenceMaterialGroup {
  id: string;
  mentions: CanonicalReferenceMentionPreviewItem[];
}

/** Reuse Host target grouping; repeated occurrences remain available as source locations. */
export function referenceMaterialGroups(
  preview: CanonicalRelatedContextPreviewResponse,
): ReferenceMaterialGroup[] {
  const grouped = new Set<string>();
  const result: ReferenceMaterialGroup[] = [];
  for (const item of preview.snapshot.items) {
    const mentions = preview.mentions.filter(
      (mention) =>
        item.mentionRefs.includes(mention.mentionRef) &&
        !grouped.has(mention.mentionRef),
    );
    if (!mentions.length) continue;
    for (const mention of mentions) grouped.add(mention.mentionRef);
    result.push({ id: item.contextItemRef, mentions });
  }
  for (const mention of preview.mentions) {
    if (!grouped.has(mention.mentionRef)) {
      result.push({ id: mention.mentionRef, mentions: [mention] });
      grouped.add(mention.mentionRef);
    }
  }
  return result;
}

export function readableReferenceTarget(
  mentions: CanonicalReferenceMentionPreviewItem[],
): {
  workItemId: string;
  businessRevision: string | null;
} | null {
  const first = mentions[0]?.targetResolution;
  if (!first || first.status !== 'RESOLVED_EXACT') return null;
  return mentions.every(
    (mention) =>
      mention.permissionState === 'AUTHORIZED' &&
      mention.targetResolution.status === 'RESOLVED_EXACT' &&
      mention.targetResolution.documentVersionId === first.documentVersionId &&
      mention.targetResolution.workItemId === first.workItemId,
  )
    ? { workItemId: first.workItemId, businessRevision: first.businessRevision }
    : null;
}
