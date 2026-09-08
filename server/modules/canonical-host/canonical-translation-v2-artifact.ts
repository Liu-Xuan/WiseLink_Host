import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type { BilingualTranslationArtifactV2 } from '@shared/canonical-translation-v2.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { assertNoDuplicateJsonKeys } from '../unified-reader/unified-reader.utils';
import { bilingualTranslationArtifactSchemaV2 } from './canonical-translation-v2.contract';

export function parseBilingualTranslationArtifactV2(
  bytes: Uint8Array,
): BilingualTranslationArtifactV2 {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assertNoDuplicateJsonKeys(text);
  const value = bilingualTranslationArtifactSchemaV2.parse(JSON.parse(text));
  assertTranslationArtifactV2(value);
  return value;
}

export function assertTranslationArtifactV2(
  value: BilingualTranslationArtifactV2,
): void {
  const anchorIds = value.anchors.map((anchor) => anchor.anchorId);
  const blockIds = value.blocks.map((block) => block.source.blockId);
  const sourceUnitIds = value.blocks.flatMap(
    (block) => block.source.sourceUnitIds,
  );
  const coveredAnchorIds = value.blocks.flatMap(
    (block) => block.source.anchorIds,
  );
  if (
    new Set(anchorIds).size !== anchorIds.length ||
    new Set(blockIds).size !== blockIds.length ||
    new Set(sourceUnitIds).size !== sourceUnitIds.length ||
    new Set(coveredAnchorIds).size !== coveredAnchorIds.length ||
    canonicalJson([...coveredAnchorIds].sort()) !==
      canonicalJson([...anchorIds].sort())
  )
    throw new Error('TRANSLATION_ARTIFACT_SOURCE_MAPPING_INVALID');
  for (const block of value.blocks) {
    const selected = block.selected;
    if (
      block.source.anchorIds.some(
        (id) =>
          !value.anchors.some(
            (anchor) =>
              anchor.anchorId === id &&
              block.source.sourceUnitIds.includes(anchor.sourceUnitId),
          ),
      )
    )
      throw new Error('TRANSLATION_ARTIFACT_ANCHOR_SCOPE_INVALID');
    if (Boolean(selected) !== (block.readingStatus === 'READABLE'))
      throw new Error('TRANSLATION_ARTIFACT_READING_STATE_INVALID');
    if (
      selected &&
      (!selected.selectedForReading ||
        selected.workspaceId !== value.manifest.workspaceId ||
        selected.blockId !== block.source.blockId ||
        selected.candidate.blockId !== block.source.blockId ||
        selected.planRevision !== value.manifest.planRevision ||
        selected.dependencies.contextRevision !==
          value.manifest.contextRevision ||
        selected.dependencies.methodVersion !== value.methodVersion ||
        !selected.check ||
        !selected.checkedAt ||
        selected.check.semanticCheck === 'PENDING' ||
        selected.check.issues.some((issue) => issue.severity === 'BLOCK') ||
        block.source.sourceIssues.some((issue) => issue.severity === 'BLOCK') ||
        canonicalJson(block.issues) !== canonicalJson(selected.check.issues) ||
        block.source.anchorIds.some(
          (id) =>
            !selected.candidate.elements.some((element) =>
              element.anchorIds.includes(id),
            ),
        ) ||
        selected.candidate.elements.some((element) =>
          element.anchorIds.some((id) => !block.source.anchorIds.includes(id)),
        ))
    )
      throw new Error('TRANSLATION_ARTIFACT_SELECTED_VERSION_INVALID');
  }
  const selected = value.blocks.flatMap((block) =>
    block.selected
      ? [
          {
            blockId: block.source.blockId,
            blockRevisionId: block.selected.blockRevisionId,
            contentRevision: block.selected.contentRevision,
          },
        ]
      : [],
  );
  const sort = (items: typeof selected) =>
    [...items].sort((a, b) => a.blockId.localeCompare(b.blockId));
  if (
    canonicalJson(sort(selected)) !==
    canonicalJson(sort(value.manifest.blockRevisions))
  )
    throw new Error('TRANSLATION_ARTIFACT_MANIFEST_INVALID');
  const complete = value.blocks.every(
    (block) => block.readingStatus === 'READABLE',
  );
  const completeness = !complete
    ? 'PARTIAL'
    : value.blocks.some((block) =>
          block.issues.some((issue) => issue.severity === 'REVIEW'),
        )
      ? 'COMPLETE_WITH_ISSUES'
      : 'COMPLETE';
  const registered = value.blocks.reduce(
    (sum, block) => sum + block.source.sourceCharacterCount,
    0,
  );
  const readable = value.blocks
    .filter((block) => block.selected)
    .reduce((sum, block) => sum + block.source.sourceCharacterCount, 0);
  if (
    value.completeness !== completeness ||
    value.coverage.registeredSourceCharacters !== registered ||
    value.coverage.readableSourceCharacters !== readable ||
    value.coverage.savedSourceCharacters < readable ||
    value.coverage.savedSourceCharacters > registered ||
    value.coverage.sourceUnitCount !== sourceUnitIds.length ||
    value.coverage.unresolvedSourceUnitCount !==
      value.blocks
        .filter((block) => !block.selected)
        .reduce((sum, block) => sum + block.source.sourceUnitIds.length, 0) ||
    value.coverage.missingBlockCount !==
      value.blocks.filter((block) => block.readingStatus === 'MISSING')
        .length ||
    value.coverage.pendingCheckBlockCount !==
      value.blocks.filter((block) => block.readingStatus === 'PENDING_CHECK')
        .length ||
    value.coverage.blockedBlockCount !==
      value.blocks.filter((block) => block.readingStatus === 'BLOCKED').length
  )
    throw new Error('TRANSLATION_ARTIFACT_COVERAGE_INVALID');
}

export function assertTranslationArtifactV2Current(
  value: BilingualTranslationArtifactV2,
  workItem: CanonicalWorkItemProjection,
): void {
  const projection = workItem.translation;
  if (
    !projection ||
    projection.schemaVersion !==
      'wiselink.3_1.translation_candidate_projection.v2' ||
    projection.status !== 'CANDIDATE_ONLY' ||
    projection.currentness !== 'CURRENT' ||
    projection.staleReason !== null ||
    projection.workspaceId !== value.manifest.workspaceId ||
    projection.planRevision !== value.manifest.planRevision ||
    projection.contextRevision !== value.manifest.contextRevision ||
    projection.completeness !== value.completeness ||
    value.source.documentVersionId !== workItem.source.documentVersionId ||
    value.source.packageId !== workItem.package?.packageId ||
    canonicalJson(value.source.parsedArtifact) !==
      canonicalJson(workItem.package?.artifact) ||
    projection.documentVersionId !== workItem.source.documentVersionId ||
    projection.documentId !== workItem.source.documentId ||
    projection.sourcePackageId !== workItem.package?.packageId ||
    projection.sourcePackageContentHash !== workItem.package?.contentHash ||
    projection.sourceUnitCount !== value.coverage.sourceUnitCount ||
    projection.pendingTranslationUnitCount !==
      value.coverage.unresolvedSourceUnitCount ||
    projection.translatedUnitCount !==
      value.coverage.sourceUnitCount - value.coverage.unresolvedSourceUnitCount
  )
    throw new Error('TRANSLATION_ARTIFACT_CURRENT_BINDING_INVALID');
}

/** Typed semantic context for downstream consumers; no conversion to v1 units. */
export function bilingualContextV2(value: BilingualTranslationArtifactV2) {
  return {
    schemaVersion: 'wiselink.3_1.bilingual_context.v2',
    candidateOnly: true,
    source: value.source,
    workspaceId: value.manifest.workspaceId,
    completeness: value.completeness,
    coverage: value.coverage,
    anchors: value.anchors,
    blocks: value.blocks.map((block) => ({
      source: block.source,
      readingStatus: block.readingStatus,
      blockRevisionId: block.selected?.blockRevisionId ?? null,
      elements: block.selected?.candidate.elements ?? [],
      issues: block.issues,
      provenance: block.selected?.provenance ?? null,
    })),
  };
}
