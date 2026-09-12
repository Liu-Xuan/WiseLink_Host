import type { TranslationBlockCandidateV2, TranslationBlockDependenciesV2, TranslationBlockRevisionV2, TranslationSemanticBlockV2, TranslationWorkspaceV2 } from '@shared/canonical-translation-v2.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { TRANSLATION_V2_CHECK_VERSION } from './canonical-translation-v2-quality';
import { translationBatchDependenciesV2 } from './canonical-translation-v2-batch';

export interface TranslationOriginalReuse {
  previous: TranslationBlockRevisionV2;
  candidate: TranslationBlockCandidateV2;
  dependencies: TranslationBlockDependenciesV2;
}

/** Reuse actual saved text only when every delivered source/context dependency
 * has an unambiguous equivalent. Generated parse identities and PDF positions
 * may change; text, table layout, conditions and references may not. */
export function planOriginalTranslationReuse(previous: TranslationWorkspaceV2, next: TranslationWorkspaceV2,
  revisions: TranslationBlockRevisionV2[]): TranslationOriginalReuse[] {
  const oldBinding = previous.plan.source.originalBinding, newBinding = next.plan.source.originalBinding;
  if (previous.workItemId !== null || next.workItemId !== null || !oldBinding || !newBinding ||
    previous.tenantId !== next.tenantId || oldBinding.documentVersionId !== newBinding.documentVersionId ||
    oldBinding.sourceArtifactId !== newBinding.sourceArtifactId || oldBinding.sourceSha256 !== newBinding.sourceSha256 ||
    oldBinding.sourceByteLength !== newBinding.sourceByteLength || oldBinding.parseRevision >= newBinding.parseRevision ||
    previous.methodVersion !== next.methodVersion) return [];
  const signature = (workspace: TranslationWorkspaceV2, block: TranslationSemanticBlockV2) => canonicalJson({
    kind: block.kind, organization: block.organization,
    structure: block.sourceStructure.map(unit => ({ kind: unit.kind, payload: stablePayload(unit.payload, workspace.plan.source.originalBinding!.parseRunId) })),
    anchors: block.anchorIds.map(id => { const anchor = workspace.plan.anchors.find(item => item.anchorId === id)!;
      return { text: anchor.sourceText, path: anchor.payloadPath }; }),
  });
  const positions = (workspace: TranslationWorkspaceV2) => {
    const index = new Map<string, TranslationSemanticBlockV2[]>();
    for (const block of workspace.plan.blocks) { const key = signature(workspace, block); index.set(key, [...(index.get(key) ?? []), block]); }
    return index;
  };
  const oldIndex = positions(previous), nextIndex = positions(next);
  const blockMap = new Map<string, string>(), anchorMap = new Map<string, string>();
  for (const [key, blocks] of oldIndex) {
    const targets = nextIndex.get(key);
    if (blocks.length !== 1 || targets?.length !== 1) continue;
    const old = blocks[0], target = targets[0];
    blockMap.set(old.blockId, target.blockId);
    old.anchorIds.forEach((id, i) => anchorMap.set(id, target.anchorIds[i]));
  }
  const ids = (values: string[], map: Map<string, string>) => values.map(id => map.get(id) ?? `UNMAPPED:${id}`);
  const context = (workspace: TranslationWorkspaceV2, translate: boolean) => {
    const value = workspace.plan.documentContext;
    const anchors = (values: string[]) => translate ? ids(values, anchorMap) : values;
    const blocks = (values: string[]) => translate ? ids(values, blockMap) : values;
    return { title: value.title, references: value.references,
      outline: value.outline.map(entry => ({ ...entry, blockId: blocks([entry.blockId])[0], anchorIds: anchors(entry.anchorIds) })),
      scopedConditions: value.scopedConditions.map(entry => ({ advisoryBlockId: blocks([entry.advisoryBlockId])[0],
        targetBlockIds: blocks(entry.targetBlockIds), anchorIds: anchors(entry.anchorIds) })),
      conditionAnchorIds: anchors(value.conditionAnchorIds), definitionAnchorIds: anchors(value.definitionAnchorIds) };
  };
  if (canonicalJson(context(previous, true)) !== canonicalJson(context(next, false))) return [];
  const selected = revisions.filter(revision => revision.selectedForReading && revision.check && !revision.check.issues.length &&
    revision.check.semanticCheck !== 'PENDING' && revision.check.checkVersion === TRANSLATION_V2_CHECK_VERSION && revision.planRevision === previous.plan.planRevision &&
    revision.dependencies.contextRevision === previous.plan.documentContext.revision && revision.dependencies.methodVersion === previous.methodVersion);
  return selected.flatMap(revision => {
    const oldBlock = previous.plan.blocks.find(block => block.blockId === revision.blockId);
    const block = next.plan.blocks.find(item => item.blockId === blockMap.get(revision.blockId));
    if (!block || !oldBlock || block.sourceIssues.length || oldBlock.sourceIssues.length ||
      canonicalJson(ids(oldBlock.requiredTogetherBlockIds, blockMap)) !== canonicalJson(block.requiredTogetherBlockIds)) return [];
    const delivered = [...revision.dependencies.sourceAnchorIds, ...revision.dependencies.contextAnchorIds];
    if (delivered.some(id => !anchorMap.has(id))) return [];
    const mapped = delivered.map(id => anchorMap.get(id)!);
    const required = translationBatchDependenciesV2(next, [block.blockId]);
    if ([...required.sourceAnchorIds, ...required.contextAnchorIds].some(id => !mapped.includes(id))) return [];
    // Order changes in delivered context can alter scope even when all words remain.
    const oldOrder = previous.plan.anchors.filter(anchor => delivered.includes(anchor.anchorId)).map(anchor => anchorMap.get(anchor.anchorId));
    const newOrder = next.plan.anchors.filter(anchor => mapped.includes(anchor.anchorId)).map(anchor => anchor.anchorId);
    if (canonicalJson(oldOrder) !== canonicalJson(newOrder)) return [];
    if (revision.candidate.elements.some(element => element.anchorIds.some(id => !anchorMap.has(id)))) return [];
    return [{ previous: revision, candidate: { blockId: block.blockId, elements: revision.candidate.elements.map((element, index) => ({
      ...element, elementId: `${block.blockId}:reuse:${index}`, anchorIds: element.anchorIds.map(id => anchorMap.get(id)!),
    })) }, dependencies: { ...required, contextAnchorIds: mapped.filter(id => !required.sourceAnchorIds.includes(id)) } }];
  });
}

function stablePayload(value: unknown, parseRunId: string): unknown {
  if (Array.isArray(value)) return value.map(item => stablePayload(item, parseRunId));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => key !== 'sourceRefIds' &&
    !(['rowId', 'cellId'].includes(key) && typeof item === 'string' && item.startsWith(`${parseRunId}:`)))
    .map(([key, item]) => [key, stablePayload(item, parseRunId)]));
}
