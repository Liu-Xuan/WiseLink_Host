import type {
  AeoEditorProjectionResult,
  AeoEditorValidationSummary,
} from '../../../shared/aeo-editor';

export function summarizeAeoProjection(
  result: AeoEditorProjectionResult,
): AeoEditorValidationSummary {
  const blockingUnresolvedCount = result.blocks.reduce(
    (count, block) =>
      count + block.unresolved.filter((item) => item.blocksCheckpoint).length,
    0,
  );
  return {
    procedureItemId: result.procedureItemId,
    projectedFromBlockSetHash: result.projectedFromBlockSetHash,
    currentBlockSetHash: result.currentBlockSetHash,
    changedBlockIds: result.changedBlockIds,
    blockCount: result.blocks.length,
    blockingUnresolvedCount,
    checkpointEligible: blockingUnresolvedCount === 0,
  };
}
