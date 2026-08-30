import { Inject, Injectable } from '@nestjs/common';

import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { readFrozenApplicabilitySourceBinding } from '../canonical-host/canonical-host-applicability-source';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import type { BatchApplicabilitySourceConditionInput } from './batch-applicability.types';

export interface ReadBatchApplicabilitySource {
  condition: BatchApplicabilitySourceConditionInput;
  targetBindingHash: string;
}

/** Reads only the current WorkItem frozen.2 artifact through the one Reader. */
@Injectable()
export class BatchApplicabilitySourceReader {
  constructor(
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly reader: UnifiedReaderService,
  ) {}

  async read(
    workItem: CanonicalWorkItemProjection,
    sourceExpressionId: string,
  ): Promise<ReadBatchApplicabilitySource> {
    assertFrozenSource(workItem);
    const sourceUnits = await this.reader.readAllSourceUnits({
      artifact: workItem.package!.artifact,
      packageId: workItem.package!.packageId,
    });
    if (
      sourceUnits.length === 0 ||
      sourceUnits.length !== workItem.package!.contentUnitCount
    ) {
      throw conflict('BATCH_SOURCE_UNIT_COUNT_MISMATCH');
    }
    const bytes = await this.artifactStore.readActualBytes(
      workItem.package!.artifact,
    );
    const binding = readFrozenApplicabilitySourceBinding({
      bytes,
      workItem,
      sourceUnits,
    });
    if (
      workItem.applicabilityInput?.targetBindingHash !==
      binding.targetBindingHash
    ) {
      throw conflict('BATCH_SOURCE_TARGET_BINDING_DRIFT');
    }
    const expression = binding.sourceExpressions.find(
      (candidate): boolean => candidate.expressionId === sourceExpressionId,
    );
    if (!expression) throw notFound('BATCH_SOURCE_EXPRESSION_NOT_FOUND');
    const fragment = binding.deterministicFragments.find(
      (candidate): boolean =>
        candidate.ruleFragmentId === expression.expressionId,
    );
    const target =
      expression.targetKind === 'module'
        ? { kind: 'document' as const, targetId: null }
        : {
            kind: expression.targetKind,
            targetId: expression.targetId,
          };
    return {
      condition: {
        sourceConditionId: expression.expressionId,
        sourceExpressionId: expression.expressionId,
        authority: fragment ? 'NORMALIZED_CANDIDATE' : 'SOURCE_ASSERTED',
        sourceRefIds: unique([
          ...expression.sourceRefIds,
          ...expression.targetSourceRefIds,
        ]),
        target,
        applicabilityAst: fragment
          ? structuredClone(fragment.expressionAst)
          : null,
      },
      targetBindingHash: binding.targetBindingHash,
    };
  }
}

function assertFrozenSource(workItem: CanonicalWorkItemProjection): void {
  if (
    workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
    !workItem.package ||
    workItem.package.contractId !== 'techpub.parsed-package.v1' ||
    workItem.package.contractRevision !== 'frozen.2' ||
    !workItem.applicabilityInput ||
    !workItem.applicabilityControlledSelection
  ) {
    throw conflict('BATCH_FROZEN2_CURRENT_INPUT_REQUIRED');
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function conflict(code: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}

function notFound(code: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 404 });
}
