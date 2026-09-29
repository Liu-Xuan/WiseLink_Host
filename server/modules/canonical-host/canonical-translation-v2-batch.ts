import type {
  TranslationBlockDependenciesV2,
  TranslationBlockRevisionV2,
  TranslationGenerationRequestV2,
  TranslationSemanticBlockV2,
  TranslationWorkspaceReadingV2,
  TranslationWorkspaceV2,
} from '@shared/canonical-translation-v2.interface';
import { TRANSLATION_V2_CHECK_VERSION } from './canonical-translation-v2-quality';
import { CANONICAL_TRANSLATION_RULE_SET_V1 } from './canonical-translation-rule-set-v1.private';

export type TranslationNextWorkV2 =
  | { kind: 'LOCAL_CHECK'; revision: TranslationBlockRevisionV2 }
  | {
      kind: 'GENERATE' | 'CORRECT' | 'CHECK';
      blockIds: string[];
      targetBlockRevisionId: string | null;
    }
  | {
      kind: 'CHECK_BATCH';
      blockIds: string[];
      targetBlockRevisionId: null;
      checkTargets: NonNullable<TranslationGenerationRequestV2['checkTargets']>;
    }
  | { kind: 'UNRESOLVED_GENERATION'; request: TranslationGenerationRequestV2 }
  | { kind: 'DONE' };

/** A scheduling target based on previous output measurements, not a token limit.
 * Whole semantic blocks are atomic even when one exceeds this target. */
export const TRANSLATION_INITIAL_BATCH_SOURCE_CHARACTERS = 6_000;
// The model still sees the complete document context. Bound only the number
// of candidate revisions reviewed in one function response: a real 17-block
// check returned incomplete_result while the preceding full-document generate
// and corrections succeeded.
export const TRANSLATION_SEMANTIC_CHECK_BATCH_BLOCKS = 8;

export function nextTranslationWorkV2(
  workspace: TranslationWorkspaceV2,
  revisions: TranslationBlockRevisionV2[],
  reading: TranslationWorkspaceReadingV2,
  targetSourceCharacters = TRANSLATION_INITIAL_BATCH_SOURCE_CHARACTERS,
  options: {
    retranslateBlockIds?: readonly string[];
    batchSemanticChecks?: boolean;
  } = {},
): TranslationNextWorkV2 {
  const requested = new Set(options.retranslateBlockIds ?? []);
  const currentRevision = (revision: TranslationBlockRevisionV2) =>
    !requested.has(revision.blockId) ||
    revision.provenance.originAttemptId === workspace.activeAttemptId;
  const pendingRequest = workspace.generationRequests.find(
    (request) => request.status === 'REGISTERED',
  );
  if (pendingRequest)
    return { kind: 'UNRESOLVED_GENERATION', request: pendingRequest };
  const unfinished = reading.blocks.filter(
    (block) =>
      block.readingStatus !== 'READABLE' ||
      (requested.has(block.source.blockId) &&
        block.selected?.provenance.originAttemptId !==
          workspace.activeAttemptId),
  );
  const pendingChecks: TranslationBlockRevisionV2[] = [];
  let checkCharacters = 0;
  const checkBatch = (): TranslationNextWorkV2 =>
    pendingChecks.length === 1
      ? {
          kind: 'CHECK',
          blockIds: [pendingChecks[0].blockId],
          targetBlockRevisionId: pendingChecks[0].blockRevisionId,
        }
      : {
          kind: 'CHECK_BATCH',
          blockIds: pendingChecks.map((revision) => revision.blockId),
          targetBlockRevisionId: null,
          checkTargets: pendingChecks.map((revision) => ({
            blockId: revision.blockId,
            blockRevisionId: revision.blockRevisionId,
            rowVersion: revision.rowVersion,
          })),
        };
  for (const entry of unfinished) {
    if (entry.source.sourceIssues.some((issue) => issue.severity === 'BLOCK'))
      continue;
    const latest = revisions
      .filter(
        (revision) =>
          revision.blockId === entry.source.blockId &&
          currentRevision(revision) &&
          revision.planRevision === workspace.plan.planRevision &&
          revision.dependencies.contextRevision ===
            workspace.plan.documentContext.revision &&
          revision.dependencies.methodVersion === workspace.methodVersion,
      )
      .sort((a, b) => b.contentRevision - a.contentRevision)[0];
    if (!latest) continue;
    if (!latest.check || (latest.check.semanticReview === null && latest.check.checkVersion !== TRANSLATION_V2_CHECK_VERSION))
      return { kind: 'LOCAL_CHECK', revision: latest };
    const blocked = latest.check.issues.some(
      (issue) => issue.severity === 'BLOCK',
    );
    if (blocked) {
      const correctionCount = workspace.generationRequests.filter(
        (request) =>
          request.attemptId === workspace.activeAttemptId &&
          request.purpose === 'CORRECT' &&
          request.blockIds.includes(latest.blockId),
      ).length;
      if (correctionCount < 2)
        return {
          kind: 'CORRECT',
          blockIds: [latest.blockId],
          targetBlockRevisionId: latest.blockRevisionId,
        };
    } else if (latest.check.semanticCheck === 'PENDING') {
      if (options.batchSemanticChecks) {
        if (
          pendingChecks.length &&
          (pendingChecks.length >= TRANSLATION_SEMANTIC_CHECK_BATCH_BLOCKS ||
            checkCharacters + entry.source.sourceCharacterCount >
              targetSourceCharacters)
        )
          return checkBatch();
        pendingChecks.push(latest);
        checkCharacters += entry.source.sourceCharacterCount;
        continue;
      }
      return {
        kind: 'CHECK',
        blockIds: [latest.blockId],
        targetBlockRevisionId: latest.blockRevisionId,
      };
    }
  }
  if (pendingChecks.length) return checkBatch();
  const missing = unfinished.filter(
    (entry) =>
      (entry.readingStatus === 'MISSING' ||
        (requested.has(entry.source.blockId) &&
          !revisions.some(
            (revision) =>
              revision.blockId === entry.source.blockId &&
              currentRevision(revision),
          ))) &&
      !entry.source.sourceIssues.some((issue) => issue.severity === 'BLOCK'),
  );
  const selected = new Set<string>();
  let characters = 0;
  for (const entry of missing) {
    if (selected.has(entry.source.blockId)) continue;
    const group = completeTogetherScope(workspace, [
      entry.source.blockId,
    ]).filter(
      (block) =>
        missing.some((item) => item.source.blockId === block.blockId) &&
        !selected.has(block.blockId),
    );
    const size = group.reduce(
      (sum, block) => sum + block.sourceCharacterCount,
      0,
    );
    if (selected.size && characters + size > targetSourceCharacters) break;
    group.forEach((block) => selected.add(block.blockId));
    characters += size;
  }
  return selected.size
    ? {
        kind: 'GENERATE',
        blockIds: workspace.plan.blocks
          .filter((block) => selected.has(block.blockId))
          .map((block) => block.blockId),
        targetBlockRevisionId: null,
      }
    : { kind: 'DONE' };
}

function completeTogetherScope(
  workspace: TranslationWorkspaceV2,
  blockIds: string[],
): TranslationSemanticBlockV2[] {
  const selected = new Set(blockIds);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const block of workspace.plan.blocks)
      if (selected.has(block.blockId)) {
        for (const id of block.requiredTogetherBlockIds)
          if (!selected.has(id)) {
            selected.add(id);
            expanded = true;
          }
      }
  }
  return workspace.plan.blocks.filter((block) => selected.has(block.blockId));
}

export function translationBatchDependenciesV2(
  workspace: TranslationWorkspaceV2,
  blockIds: string[],
): TranslationBlockDependenciesV2 {
  const { plan } = workspace;
  const output = plan.blocks.filter((block) =>
    blockIds.includes(block.blockId),
  );
  if (output.length !== blockIds.length)
    throw new Error('TRANSLATION_BATCH_BLOCK_SCOPE_INVALID');
  const sourceAnchorIds = output.flatMap((block) => block.anchorIds);
  const sourceIds = new Set(sourceAnchorIds);
  return {
    planRevision: plan.planRevision,
    contextRevision: plan.documentContext.revision,
    methodVersion: workspace.methodVersion,
    sourceAnchorIds,
    // Every generation sees the exact whole document. The target is still the
    // only writable scope; other anchors remain source quotations for context.
    contextAnchorIds: plan.anchors
      .filter((anchor) => !sourceIds.has(anchor.anchorId))
      .map((anchor) => anchor.anchorId),
  };
}

export function buildTranslationBatchV2(
  workspace: TranslationWorkspaceV2,
  request: TranslationGenerationRequestV2,
  revisions: TranslationBlockRevisionV2[],
) {
  const { plan } = workspace;
  const target = request.targetBlockRevisionId
    ? revisions.find(
        (revision) =>
          revision.blockRevisionId === request.targetBlockRevisionId,
      )
    : null;
  if (request.targetBlockRevisionId && !target)
    throw new Error('TRANSLATION_BATCH_TARGET_NOT_FOUND');
  const checkCandidates = request.checkTargets?.map((entry) => {
    const revision = revisions.find(
      (value) => value.blockRevisionId === entry.blockRevisionId,
    );
    if (
      !revision ||
      revision.blockId !== entry.blockId ||
      revision.rowVersion !== entry.rowVersion
    )
      throw new Error('TRANSLATION_BATCH_TARGET_CHANGED');
    return { ...entry, candidate: structuredClone(revision.candidate) };
  });
  const sourceIds = new Set(request.dependencies.sourceAnchorIds);
  const contextIds = new Set(request.dependencies.contextAnchorIds);
  const targetBlocks = new Set(request.blockIds);
  const fullDocumentContext = plan.anchors.every((anchor) =>
    sourceIds.has(anchor.anchorId) || contextIds.has(anchor.anchorId),
  );
  const contextBlocks = plan.blocks.filter((block) =>
    !targetBlocks.has(block.blockId) &&
    (fullDocumentContext || block.anchorIds.some((id) => contextIds.has(id))),
  );
  const anchorValue = (anchor: (typeof plan.anchors)[number]) => ({
    anchorId: anchor.anchorId,
    sourceUnitId: anchor.sourceUnitId,
    payloadPath: anchor.payloadPath,
    sourceText: anchor.sourceText,
    sourceRefIds: anchor.sourceRefIds,
  });
  return {
    schemaVersion: 'wiselink.3_1.translation_semantic_batch.v2' as const,
    workspaceId: workspace.workspaceId,
    generationRequestRef: request.generationRequestRef,
    purpose: request.purpose,
    sourcePlanAnchorCount: plan.anchors.length,
    sourcePlanBlockCount: plan.blocks.length,
    source: structuredClone(plan.source),
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    dependencies: structuredClone(request.dependencies),
    blocks: structuredClone(
      plan.blocks.filter((block) => request.blockIds.includes(block.blockId)),
    ),
    anchors: plan.anchors
      .filter((anchor) => sourceIds.has(anchor.anchorId))
      .map(anchorValue),
    documentContext: {
      ...structuredClone(plan.documentContext),
      blocks: structuredClone(contextBlocks),
      anchors: plan.anchors
        .filter((anchor) => contextIds.has(anchor.anchorId))
        .map(anchorValue),
      conditionsAreSourceQuotations: true,
    },
    // Retain established terminology without importing v1 one-fragment/one-
    // output rules. Context-specific definitions remain verbatim above.
    terminology: request.glossary ? {
      terms: request.glossary.entries.filter(entry => entry.kind === 'TERM')
        .map(entry => ({ ruleId: entry.entryId,
          sourceTerm: entry.sourceText,
          targetRenderings: [...entry.targetRenderings],
          severity: 'mandatory' as const,
          ...(entry.note !== null ? { note: entry.note } : {}),
        })),
      noTranslate: request.glossary.entries.filter(entry => entry.kind === 'NO_TRANSLATE')
        .map(entry => ({ ruleId: entry.entryId, token: entry.sourceText,
          ...(entry.note !== null ? { note: entry.note } : {}),
        })),
    } : {
      terms: structuredClone(CANONICAL_TRANSLATION_RULE_SET_V1.terms),
      noTranslate: structuredClone(CANONICAL_TRANSLATION_RULE_SET_V1.noTranslate),
    },
    previousCandidate: target ? structuredClone(target.candidate) : null,
    previousBlockRevisionId: target?.blockRevisionId ?? null,
    ...(checkCandidates ? { checkCandidates } : {}),
    correctionIssues: target ? structuredClone(target.check?.issues ?? []) : [],
  };
}
