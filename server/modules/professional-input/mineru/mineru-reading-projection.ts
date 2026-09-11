import type {
  MineruReaderSource,
  MineruReadingProjection,
} from '@shared/mineru-reading.interface';
import type { MineruDocumentArtifacts } from './mineru-artifacts';
import { buildMineruTranslationPlan } from './mineru-translation';

/** Text is used for exact DOM binding; source geometry always comes from the parsed version. */
export function buildMineruReadingProjection(
  document: MineruDocumentArtifacts,
  identity: {
    documentVersionId: string;
    parseRunId: string;
  },
): MineruReadingProjection {
  const plan = buildMineruTranslationPlan(document, identity);
  const blocks = new Map(
    [...document.blocks, ...document.discardedBlocks].map((block) => [
      block.id,
      block,
    ]),
  );
  const projection: MineruReadingProjection = {
    ...identity,
    sources: [],
    notes: [],
    issues: [],
  };
  for (const unit of plan.units) {
    const block = blocks.get(unit.key)!;
    const base = {
      blockId: block.id,
      pageIndex: block.pageIndex,
      bbox: block.bbox
        ? ([...block.bbox] as [number, number, number, number])
        : null,
      sourcePointer: block.sourcePointer,
    };
    const add = (
      source: Pick<
        MineruReaderSource,
        'kind' | 'text' | 'items' | 'cells' | 'imagePath'
      >,
    ) => {
      const id = `${block.id}-${source.kind}`;
      projection.sources.push({ ...base, id, ...source });
      return id;
    };
    if (unit.value?.kind === 'text' && unit.value.text) {
      if (['page_footnote', 'page_aside_text'].includes(block.type)) {
        const id = add({ kind: 'note', text: unit.value.text });
        projection.notes.push({ id, text: unit.value.text });
      } else if (block.type === 'title' || block.type === 'paragraph') {
        add({
          kind: block.type === 'title' ? 'heading' : 'paragraph',
          text: unit.value.text,
        });
      }
    } else if (unit.value?.kind === 'list')
      add({ kind: 'list', items: unit.value.items });
    else if (unit.value?.kind === 'table') {
      add({
        kind: 'table',
        cells: unit.value.rows
          .flat()
          .filter((cell): cell is string => cell !== null),
        ...(block.assetPath ? { imagePath: block.assetPath } : {}),
      });
    }
    if (block.assetPath && ['image', 'chart'].includes(block.type))
      add({ kind: 'image', imagePath: block.assetPath });
    projection.issues.push(...unit.issues
      .filter(code => !['CODE_BODY_PRESERVED', 'NAVIGATION_ONLY'].includes(code))
      .map(code => ({ blockId: block.id, code })));
  }
  return projection;
}
