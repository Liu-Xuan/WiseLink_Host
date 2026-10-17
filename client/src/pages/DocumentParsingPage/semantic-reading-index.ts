import type { TranslationSourceAnchorV2 } from '@shared/canonical-translation-v2.interface';
import type { SemanticReadingBlock } from './semantic-reading';

interface PositionedAnchor {
  anchor: TranslationSourceAnchorV2;
  order: number;
}

/** Same membership and source order as anchors.filter, without rescanning the document for every block. */
export function indexSemanticReadingAnchors(
  blocks: readonly SemanticReadingBlock[],
  anchors: readonly TranslationSourceAnchorV2[],
): ReadonlyMap<SemanticReadingBlock, TranslationSourceAnchorV2[]> {
  const byId = new Map<string, PositionedAnchor[]>();
  anchors.forEach((anchor: TranslationSourceAnchorV2, order: number) => {
    const positions: PositionedAnchor[] = byId.get(anchor.anchorId) ?? [];
    positions.push({ anchor, order });
    byId.set(anchor.anchorId, positions);
  });
  const byBlock = new Map<SemanticReadingBlock, TranslationSourceAnchorV2[]>();
  for (const block of blocks) {
    const positions: PositionedAnchor[] = [];
    for (const id of new Set(block.source.anchorIds)) positions.push(...(byId.get(id) ?? []));
    positions.sort((a: PositionedAnchor, b: PositionedAnchor) => a.order - b.order);
    byBlock.set(block, positions.map((position: PositionedAnchor) => position.anchor));
  }
  return byBlock;
}

const SEMANTIC_READING_NO_SELECTION: string[] = [];

/** Unrelated blocks cannot change their highlight; keep their render props stable. */
export function semanticBlockSelection(
  block: SemanticReadingBlock,
  selected: string[],
  selectedIds: ReadonlySet<string>,
): string[] {
  const relevant: boolean = block.source.anchorIds.some((id: string) => selectedIds.has(id)) ||
    (block.selected?.candidate.elements.some((element) =>
      element.anchorIds.some((id: string) => selectedIds.has(id))) ?? false);
  return relevant ? selected : SEMANTIC_READING_NO_SELECTION;
}
