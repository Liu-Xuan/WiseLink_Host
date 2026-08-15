import {
  AEO_EDITOR_CHECKPOINT_VERSION,
  type AeoEditorProjection,
  type AeoEditorShadowCheckpoint,
  type AeoEditorTransactionEntry,
  type AeoEditorTransactionKind,
} from '../../../shared/aeo-editor';

import { projectTiptapToAeoBlocks } from './aeo-editor-projection';
import { normalizeAeoEditorProjection } from './aeo-editor-projection.validation';
import {
  canonicalStringify,
  isRecord,
  projectionError,
  requireEnum,
  requireExactKeys,
  requireNonEmptyString,
  requirePositiveInteger,
  requireSha256,
  sha256Hex,
} from './aeo-editor-projection.utils';

const SHADOW_WORKING_REVISION = 1;
const TRANSACTION_KINDS: readonly AeoEditorTransactionKind[] = [
  'EDIT_TEXT',
  'PASTE_PLAIN_TEXT',
  'IMPORT_KNOWLEDGE',
  'REORDER_BLOCK',
  'UNDO',
  'REDO',
];

interface NormalizedCheckpointRequest {
  checkpointVersion: typeof AEO_EDITOR_CHECKPOINT_VERSION;
  expectedWorkingRevision: number;
  expectedBaseBlockSetHash: string;
  projection: AeoEditorProjection;
  transactions: AeoEditorTransactionEntry[];
}

export function buildAeoShadowCheckpoint(
  value: unknown,
): AeoEditorShadowCheckpoint {
  const request = normalizeCheckpointRequest(value);
  if (request.expectedWorkingRevision !== SHADOW_WORKING_REVISION) {
    projectionError(
      'AEO_EDITOR_WORKING_REVISION_CONFLICT',
      'The local shadow working revision no longer matches the request.',
    );
  }
  assertAeoTransactionReferences(
    request.transactions,
    new Set(request.projection.blockManifest.map((block) => block.blockId)),
  );
  const result = projectTiptapToAeoBlocks(request.projection);
  if (result.projectedFromBlockSetHash !== request.expectedBaseBlockSetHash) {
    projectionError(
      'AEO_EDITOR_BASE_HASH_CONFLICT',
      'The local shadow base block-set hash no longer matches the request.',
    );
  }
  assertAeoTransactionCoverage(result.changedBlockIds, request.transactions);
  const blockingUnresolvedCount = result.blocks.reduce(
    (count, block) =>
      count + block.unresolved.filter((item) => item.blocksCheckpoint).length,
    0,
  );
  const transactionDigest = sha256Hex(
    canonicalStringify(request.transactions),
  );
  const checkpointHash = sha256Hex(
    canonicalStringify({
      baseWorkingRevision: request.expectedWorkingRevision,
      baseBlockSetHash: request.expectedBaseBlockSetHash,
      currentBlockSetHash: result.currentBlockSetHash,
      transactionDigest,
    }),
  );
  return {
    checkpointVersion: AEO_EDITOR_CHECKPOINT_VERSION,
    checkpointKind: 'LOCAL_SHADOW_NO_PERSISTENCE',
    checkpointId: `AEOSHADOW-${checkpointHash.slice(0, 24).toUpperCase()}`,
    aeoIdentity: 'AEO-B787-46-0015-R09',
    baseWorkingRevision: request.expectedWorkingRevision,
    candidateWorkingRevision: request.expectedWorkingRevision + 1,
    baseBlockSetHash: request.expectedBaseBlockSetHash,
    currentBlockSetHash: result.currentBlockSetHash,
    transactionDigest,
    transactionCount: request.transactions.length,
    changedBlockIds: result.changedBlockIds,
    blockingUnresolvedCount,
    exportEligible: blockingUnresolvedCount === 0,
    persisted: false,
  };
}

export function normalizeAeoCheckpointRequest(
  value: unknown,
): NormalizedCheckpointRequest {
  if (!isRecord(value)) {
    projectionError(
      'AEO_EDITOR_CHECKPOINT_REQUEST_INVALID',
      'The shadow checkpoint request must be an object.',
    );
  }
  requireExactKeys(
    value,
    [
      'checkpointVersion',
      'expectedWorkingRevision',
      'expectedBaseBlockSetHash',
      'projection',
      'transactions',
    ],
    'AEO_EDITOR_CHECKPOINT_REQUEST_FIELDS_INVALID',
    'shadow checkpoint request',
  );
  if (value.checkpointVersion !== AEO_EDITOR_CHECKPOINT_VERSION) {
    projectionError(
      'AEO_EDITOR_CHECKPOINT_VERSION_UNSUPPORTED',
      'The shadow checkpoint version is unsupported.',
    );
  }
  if (!Array.isArray(value.transactions)) {
    projectionError(
      'AEO_EDITOR_TRANSACTION_LOG_INVALID',
      'The transaction log must be an array.',
    );
  }
  return {
    checkpointVersion: AEO_EDITOR_CHECKPOINT_VERSION,
    expectedWorkingRevision: requirePositiveInteger(
      value.expectedWorkingRevision,
      'AEO_EDITOR_WORKING_REVISION_INVALID',
      'expectedWorkingRevision',
    ),
    expectedBaseBlockSetHash: requireSha256(
      value.expectedBaseBlockSetHash,
      'AEO_EDITOR_BASE_HASH_INVALID',
      'expectedBaseBlockSetHash',
    ),
    projection: normalizeProjectionReference(value.projection),
    transactions: normalizeAeoTransactions(value.transactions),
  };
}

function normalizeCheckpointRequest(
  value: unknown,
): NormalizedCheckpointRequest {
  return normalizeAeoCheckpointRequest(value);
}

function normalizeProjectionReference(value: unknown): AeoEditorProjection {
  return normalizeAeoEditorProjection(value);
}

function normalizeTransaction(
  value: unknown,
  index: number,
): AeoEditorTransactionEntry {
  if (!isRecord(value)) {
    projectionError(
      'AEO_EDITOR_TRANSACTION_LOG_INVALID',
      `Transaction ${index} must be an object.`,
    );
  }
  requireExactKeys(
    value,
    ['sequence', 'kind', 'affectedBlockIds'],
    'AEO_EDITOR_TRANSACTION_FIELDS_INVALID',
    `transaction ${index}`,
  );
  const sequence = requirePositiveInteger(
    value.sequence,
    'AEO_EDITOR_TRANSACTION_SEQUENCE_INVALID',
    `transaction ${index} sequence`,
  );
  if (sequence !== index + 1 || !Array.isArray(value.affectedBlockIds)) {
    projectionError(
      'AEO_EDITOR_TRANSACTION_SEQUENCE_INVALID',
      'Transaction sequences must be contiguous and one-based.',
    );
  }
  const affectedBlockIds = value.affectedBlockIds.map((blockId) =>
    requireNonEmptyString(
      blockId,
      'AEO_EDITOR_TRANSACTION_BLOCK_INVALID',
      `transaction ${index} affected blockId`,
    ),
  );
  if (
    affectedBlockIds.length === 0 ||
    new Set(affectedBlockIds).size !== affectedBlockIds.length
  ) {
    projectionError(
      'AEO_EDITOR_TRANSACTION_BLOCK_INVALID',
      'Each transaction must name one or more unique affected blocks.',
    );
  }
  return {
    sequence,
    kind: requireEnum(
      value.kind,
      TRANSACTION_KINDS,
      'AEO_EDITOR_TRANSACTION_KIND_UNSUPPORTED',
      `transaction ${index} kind`,
    ),
    affectedBlockIds,
  };
}

export function normalizeAeoTransactions(
  value: unknown,
): AeoEditorTransactionEntry[] {
  if (!Array.isArray(value)) {
    projectionError(
      'AEO_EDITOR_TRANSACTION_LOG_INVALID',
      'The transaction log must be an array.',
    );
  }
  return value.map(normalizeTransaction);
}

export function assertAeoTransactionCoverage(
  changedBlockIds: string[],
  transactions: AeoEditorTransactionEntry[],
): void {
  const affected = new Set(
    transactions.flatMap((transaction) => transaction.affectedBlockIds),
  );
  if (changedBlockIds.some((blockId) => !affected.has(blockId))) {
    projectionError(
      'AEO_EDITOR_TRANSACTION_LOG_INCOMPLETE',
      'Every currently changed block must be covered by the transaction log.',
    );
  }
}

export function assertAeoTransactionReferences(
  transactions: AeoEditorTransactionEntry[],
  knownBlockIds: Set<string>,
): void {
  transactions.forEach((transaction) => {
    if (
      transaction.affectedBlockIds.some(
        (blockId) => !knownBlockIds.has(blockId),
      )
    ) {
      projectionError(
        'AEO_EDITOR_TRANSACTION_BLOCK_UNKNOWN',
        'Every affected block in the transaction log must exist in the projection manifest.',
      );
    }
    if (
      transaction.kind === 'REORDER_BLOCK' &&
      transaction.affectedBlockIds.length < 2
    ) {
      projectionError(
        'AEO_EDITOR_REORDER_TRANSACTION_INCOMPLETE',
        'A block reorder transaction must name both affected blocks.',
      );
    }
  });
}
