import type { TranslationWorkspaceReadingV2 } from '@shared/canonical-translation-v2.interface';

/** The exact non-source blocked blocks eligible for one partial successor. */
export function documentTranslationRepairableBlockIds(
  reading: TranslationWorkspaceReadingV2,
): string[] {
  return reading.blocks.filter((block) =>
    block.readingStatus === 'BLOCKED' &&
    !block.source.sourceIssues.some((issue) => issue.severity === 'BLOCK') &&
    block.issues.some((issue) => issue.severity === 'BLOCK' && issue.origin !== 'SOURCE'),
  ).map((block) => block.source.blockId);
}
