import { Injectable } from '@nestjs/common';

import type {
  AeoEditorShadowCheckpoint,
  AeoEditorProjectionResult,
  AeoEditorShadowFixture,
  AeoEditorValidationSummary,
} from '../../../shared/aeo-editor';

import { buildAeoShadowCheckpoint } from './aeo-authoring.checkpoint';
import {
  AEO_EDITOR_FIXTURE_PROCEDURE_ITEM_ID,
  makeAeoEditorBlocksFixture,
} from './aeo-editor-projection.fixture';
import {
  projectAeoBlocksToTiptap,
  projectTiptapToAeoBlocks,
} from './aeo-editor-projection';

@Injectable()
export class AeoAuthoringService {
  getShadowFixture(): AeoEditorShadowFixture {
    const projection = projectAeoBlocksToTiptap(
      AEO_EDITOR_FIXTURE_PROCEDURE_ITEM_ID,
      makeAeoEditorBlocksFixture(),
    );
    return {
      fixtureKind: 'LOCAL_REAL_STRUCTURE_FIXTURE',
      aeoIdentity: 'AEO-B787-46-0015-R09',
      workingRevision: 1,
      sourceNotice:
        '本地影子 fixture：不读写 TDMS/AAmis，不保存或发布 AEO。',
      projection,
      validation: summarizeAeoProjection(projectTiptapToAeoBlocks(projection)),
    };
  }

  validateProjection(value: unknown): AeoEditorValidationSummary {
    return summarizeAeoProjection(projectTiptapToAeoBlocks(value));
  }

  createShadowCheckpoint(value: unknown): AeoEditorShadowCheckpoint {
    return buildAeoShadowCheckpoint(value);
  }
}

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
