import type { AutomaticWorkItemCancellationBinding } from '@shared/api.interface';
import { parseExecutionModel } from '../model-settings/canonical-execution-model';

export const CANCELLED_AUTOMATIC_WORK_ITEM_CODE =
  'AUTO_WORK_ITEM_STAGE_JOBAID_CANCELLED';

export function parseAutomaticWorkItemCancellation(
  value: unknown,
): AutomaticWorkItemCancellationBinding {
  const keys = [
    'requestId', 'workItemRevision', 'documentId', 'documentVersionId',
    'sourceArtifactId', 'sourceFileSha256', 'sourceByteLength', 'attemptId',
    'attemptRef', 'attemptNo', 'attemptRequestId', 'actionType',
    'inputRevision', 'baseRevision', 'inputHash', 'executionModel',
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length ||
      keys.some(key => !Object.prototype.hasOwnProperty.call(row, key)) ||
      ['requestId', 'attemptRequestId', 'attemptId', 'attemptRef'].some(key => typeof row[key] !== 'string') ||
      !/^REQ-[A-Za-z0-9_-]{1,92}$/u.test(String(row.requestId)) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(String(row.attemptRequestId)) ||
      !/^ATT-[A-Za-z0-9_-]{1,92}$/u.test(String(row.attemptId)) ||
      !/^AQ-[A-Za-z0-9_-]{1,93}$/u.test(String(row.attemptRef)) ||
      row.actionType !== 'OPENCLAW_DYNAMIC_EVALUATION' ||
      ['documentId', 'documentVersionId', 'sourceArtifactId'].some(key =>
        typeof row[key] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(String(row[key]))) ||
      ['sourceFileSha256', 'inputHash'].some(key =>
        typeof row[key] !== 'string' || !/^[0-9a-f]{64}$/u.test(String(row[key]))) ||
      ['workItemRevision', 'inputRevision', 'baseRevision'].some(key =>
        typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || Number(row[key]) < 0) ||
      ['sourceByteLength', 'attemptNo'].some(key =>
        typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || Number(row[key]) < 1)) invalid();
  try {
    return { ...row, executionModel: parseExecutionModel(row.executionModel) } as unknown as AutomaticWorkItemCancellationBinding;
  } catch { return invalid(); }
}

function invalid(): never {
  throw Object.assign(new Error('AUTO_WORK_ITEM_CANCELLATION_INPUT_INVALID'), {
    code: 'AUTO_WORK_ITEM_CANCELLATION_INPUT_INVALID', statusCode: 400,
  });
}
