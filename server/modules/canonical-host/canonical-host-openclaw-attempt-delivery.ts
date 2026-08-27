import type {
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from '../action-attempt/action-attempt-envelope.types';
import type { TranslationTaskContract } from './canonical-translation-rule-contract';

export const OPENCLAW_TRANSLATION_DELIVERY_SCHEMA =
  'wiselink.3_1.openclaw_translation_delivery.v1';
export const OPENCLAW_TRANSLATION_DELIVERY_MAX_UTF8_BYTES = 14_000;

export interface OpenClawTranslationDeliveryClaim {
  attemptRef: string;
  status: 'RUNNING' | 'COMMITTING';
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  task: OpenClawTaskEnvelope;
  recoveryResult?: OpenClawResultEnvelope;
}

export interface OpenClawTranslationDeliveryResult {
  schemaVersion: typeof OPENCLAW_TRANSLATION_DELIVERY_SCHEMA;
  attemptRef: string;
  status: 'RUNNING' | 'COMMITTING';
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  recoveryResultContentHash?: string;
  taskBinding: {
    actionAttemptId: string;
    operationRef: string;
    taskType: 'OPENCLAW_TRANSLATE';
    workItemId: string;
    inputRevision: number;
    baseRevision: number;
    documentVersionId: string;
    deadline: string;
    inputHash: string;
    sourceArtifactSha256: string[];
  };
  delivery: {
    partIndex: number;
    partCount: number;
    sourceUnitStartIndex: number;
    sourceUnitEndExclusive: number;
    sourceUnitCount: number;
    modelInputBase?: Omit<TranslationTaskContract, 'sourceUnits'>;
    sourceUnits: TranslationTaskContract['sourceUnits'];
  };
}

/**
 * Produce readable, semantic SourceUnit batches for the official Hosted Agent.
 * The bound is checked on the actual serialized response, never inferred from
 * a fixed number of units.
 */
export function buildOpenClawTranslationDelivery(
  claim: OpenClawTranslationDeliveryClaim,
  partIndex = 0,
): OpenClawTranslationDeliveryResult {
  const task = translationTask(claim.task.modelInput);
  const batches = partitionSourceUnits(claim, task);
  if (
    !Number.isSafeInteger(partIndex) ||
    partIndex < 0 ||
    partIndex >= batches.length
  ) {
    throw deliveryError('OPENCLAW_TRANSLATION_DELIVERY_PART_INVALID', {
      partIndex,
      partCount: batches.length,
    });
  }
  return deliveryResponse(claim, task, batches, partIndex);
}

function partitionSourceUnits(
  claim: OpenClawTranslationDeliveryClaim,
  task: TranslationTaskContract,
): TranslationTaskContract['sourceUnits'][] {
  const batches: TranslationTaskContract['sourceUnits'][] = [];
  let current: TranslationTaskContract['sourceUnits'] = [];
  for (const unit of task.sourceUnits) {
    const candidate = [...current, structuredClone(unit)];
    const provisional = [...batches, candidate];
    const response = deliveryResponse(
      claim,
      task,
      provisional,
      provisional.length - 1,
      task.sourceUnits.length,
    );
    if (
      serializedToolResultBytes(response) <=
      OPENCLAW_TRANSLATION_DELIVERY_MAX_UTF8_BYTES
    ) {
      current = candidate;
      continue;
    }
    if (current.length === 0) {
      throw deliveryError('OPENCLAW_TRANSLATION_SOURCE_UNIT_TOO_LARGE', {
        unitKey: unit.unitKey,
      });
    }
    batches.push(current);
    current = [structuredClone(unit)];
    const single = deliveryResponse(
      claim,
      task,
      [...batches, current],
      batches.length,
      task.sourceUnits.length,
    );
    if (
      serializedToolResultBytes(single) >
      OPENCLAW_TRANSLATION_DELIVERY_MAX_UTF8_BYTES
    ) {
      throw deliveryError('OPENCLAW_TRANSLATION_SOURCE_UNIT_TOO_LARGE', {
        unitKey: unit.unitKey,
      });
    }
  }
  if (current.length > 0) batches.push(current);
  if (batches.length === 0) {
    throw deliveryError('OPENCLAW_TRANSLATION_SOURCE_UNITS_REQUIRED');
  }
  for (let index = 0; index < batches.length; index += 1) {
    const response = deliveryResponse(claim, task, batches, index);
    if (
      serializedToolResultBytes(response) >
      OPENCLAW_TRANSLATION_DELIVERY_MAX_UTF8_BYTES
    ) {
      throw deliveryError('OPENCLAW_TRANSLATION_DELIVERY_RESPONSE_TOO_LARGE', {
        partIndex: index,
      });
    }
  }
  return batches;
}

function deliveryResponse(
  claim: OpenClawTranslationDeliveryClaim,
  task: TranslationTaskContract,
  batches: TranslationTaskContract['sourceUnits'][],
  partIndex: number,
  conservativePartCount?: number,
): OpenClawTranslationDeliveryResult {
  const recoveryResultContentHash = recoveryHash(claim);
  const sourceUnitStartIndex = batches
    .slice(0, partIndex)
    .reduce((count, batch) => count + batch.length, 0);
  const sourceUnits = batches[partIndex] ?? [];
  const { sourceUnits: _sourceUnits, ...modelInputBase } = task;
  return {
    schemaVersion: OPENCLAW_TRANSLATION_DELIVERY_SCHEMA,
    attemptRef: claim.attemptRef,
    status: claim.status,
    leaseToken: claim.leaseToken,
    leaseGeneration: claim.leaseGeneration,
    leaseExpiresAt: claim.leaseExpiresAt,
    ...(recoveryResultContentHash ? { recoveryResultContentHash } : {}),
    taskBinding: {
      actionAttemptId: claim.task.actionAttemptId,
      operationRef: claim.task.operationRef,
      taskType: 'OPENCLAW_TRANSLATE',
      workItemId: claim.task.workItemId,
      inputRevision: claim.task.inputRevision,
      baseRevision: claim.task.baseRevision,
      documentVersionId: claim.task.documentVersionId,
      deadline: claim.task.deadline,
      inputHash: claim.task.inputHash,
      sourceArtifactSha256: claim.task.sourceRefs.map(({ sha256 }) => sha256),
    },
    delivery: {
      partIndex,
      partCount: conservativePartCount ?? batches.length,
      sourceUnitStartIndex,
      sourceUnitEndExclusive: sourceUnitStartIndex + sourceUnits.length,
      sourceUnitCount: task.sourceUnits.length,
      ...(partIndex === 0
        ? { modelInputBase: structuredClone(modelInputBase) }
        : {}),
      sourceUnits: structuredClone(sourceUnits),
    },
  };
}

function recoveryHash(
  claim: OpenClawTranslationDeliveryClaim,
): string | undefined {
  if (claim.status === 'RUNNING') return undefined;
  const contentHash = claim.recoveryResult?.contentHash;
  if (typeof contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(contentHash)) {
    throw deliveryError('OPENCLAW_TRANSLATION_COMMITTING_RECOVERY_REQUIRED');
  }
  return contentHash;
}

function translationTask(value: unknown): TranslationTaskContract {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Array.isArray((value as TranslationTaskContract).sourceUnits) ||
    !(value as TranslationTaskContract).rulePack ||
    !(value as TranslationTaskContract).taskStartBinding
  ) {
    throw deliveryError('OPENCLAW_TRANSLATION_MODEL_INPUT_INVALID');
  }
  return structuredClone(value as TranslationTaskContract);
}

function serializedToolResultBytes(value: unknown): number {
  return Buffer.byteLength(
    JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(value) }],
    }),
    'utf8',
  );
}

function deliveryError(code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { code, statusCode: 400, details });
}
