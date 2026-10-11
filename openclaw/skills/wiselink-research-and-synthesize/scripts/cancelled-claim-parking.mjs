import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export const CANCELLED_CLAIM_BLOCK_CODE = 'AUTO_WORK_ITEM_STAGE_JOBAID_CANCELLED';

function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function id(value, pattern) { return typeof value === 'string' && pattern.test(value); }
function integer(value, minimum) { return Number.isSafeInteger(value) && value >= minimum; }
function invalid() { throw new Error('AUTO_WORK_ITEM_CANCELLATION_EXPECTATION_INVALID'); }

export function parseCancelledClaimExpectation(value) {
  if (!exact(value, ['workItemId', 'leaseGeneration', 'leaseTokenHash', 'expectedCancellation']) ||
      !id(value.workItemId, /^WI-[A-Za-z0-9_-]{1,93}$/u) || !integer(value.leaseGeneration, 1) ||
      !id(value.leaseTokenHash, /^[0-9a-f]{64}$/u)) invalid();
  const row = value.expectedCancellation;
  const keys = ['requestId', 'workItemRevision', 'documentId', 'documentVersionId',
    'sourceArtifactId', 'sourceFileSha256', 'sourceByteLength', 'attemptId', 'attemptRef',
    'attemptNo', 'attemptRequestId', 'actionType', 'inputRevision', 'baseRevision', 'inputHash', 'executionModel'];
  if (!exact(row, keys) || !id(row.requestId, /^REQ-[A-Za-z0-9_-]{1,92}$/u) ||
      !id(row.attemptRequestId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u) ||
      !id(row.attemptId, /^ATT-[A-Za-z0-9_-]{1,92}$/u) || !id(row.attemptRef, /^AQ-[A-Za-z0-9_-]{1,93}$/u) ||
      row.actionType !== 'OPENCLAW_DYNAMIC_EVALUATION' ||
      ['documentId', 'documentVersionId', 'sourceArtifactId'].some(key =>
        !id(row[key], /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u)) ||
      ['sourceFileSha256', 'inputHash'].some(key => !id(row[key], /^[0-9a-f]{64}$/u)) ||
      ['workItemRevision', 'inputRevision', 'baseRevision'].some(key => !integer(row[key], 0)) ||
      ['sourceByteLength', 'attemptNo'].some(key => !integer(row[key], 1))) invalid();
  const model = row.executionModel;
  const modelKeys = ['modelRef', 'displayName', 'providerKind', 'settingsRevision', 'selectedAt'];
  if (!exact(model, modelKeys) || !id(model.modelRef, /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9/._:-]*$/u) ||
      model.modelRef.length > 255 || typeof model.displayName !== 'string' || !model.displayName.trim() ||
      model.displayName.length > 120 || !['BUILT_IN', 'CUSTOM'].includes(model.providerKind) ||
      !integer(model.settingsRevision, 0) || typeof model.selectedAt !== 'string' ||
      !Number.isFinite(Date.parse(model.selectedAt))) invalid();
  return { workItemId: value.workItemId, leaseGeneration: value.leaseGeneration,
    leaseTokenHash: value.leaseTokenHash, expectedCancellation: Object.fromEntries(keys.map(key =>
      [key, key === 'executionModel' ? Object.fromEntries(modelKeys.map(name => [name, model[name]])) : row[key]])) };
}

export async function readCancelledClaimExpectation(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || typeof process.getuid !== 'function') invalid();
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 ||
          info.size < 1 || info.size > 8192) invalid();
      const bytes = await handle.readFile();
      if (bytes.length !== info.size || bytes.length > 8192) invalid();
      return parseCancelledClaimExpectation(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } finally { await handle.close(); }
  } catch { return invalid(); }
}

export function matchesCancelledClaim(claim, expectation) {
  const expected = expectation.expectedCancellation;
  return claim !== null && claim.workItemId === expectation.workItemId &&
    claim.leaseGeneration === expectation.leaseGeneration && claim.requestId === expected.requestId &&
    claim.documentVersionId === expected.documentVersionId && claim.workItemRevision === expected.workItemRevision &&
    typeof claim.leaseToken === 'string' &&
    createHash('sha256').update(claim.leaseToken).digest('hex') === expectation.leaseTokenHash;
}

export function validateCancelledBlockReceipt(value, expectation, { replayOnly = false, blockedAt } = {}) {
  if (!exact(value, ['status', 'workItemId', 'blockedCode', 'blockedAt', 'replayed']) ||
      value.status !== 'BLOCKED' || value.workItemId !== expectation.workItemId ||
      value.blockedCode !== CANCELLED_CLAIM_BLOCK_CODE || typeof value.replayed !== 'boolean' ||
      (replayOnly && value.replayed !== true) || typeof value.blockedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.blockedAt)) || new Date(value.blockedAt).toISOString() !== value.blockedAt ||
      (blockedAt !== undefined && value.blockedAt !== blockedAt))
    throw new Error('AUTO_WORK_ITEM_BLOCK_RECEIPT_INVALID');
  return value;
}

export function assertCancelledParkIntent(value, claim, expectation, validateClaim) {
  try {
    if (!exact(value, ['schemaVersion', 'claim', 'cancellationExpectation']) ||
        value.schemaVersion !== 'wiselink.auto_work_item_cancelled_claim_park.v1' ||
        JSON.stringify(validateClaim(value.claim)) !== JSON.stringify(claim) ||
        JSON.stringify(parseCancelledClaimExpectation(value.cancellationExpectation)) !== JSON.stringify(expectation))
      throw new Error('INVALID_BINDING');
  } catch { throw new Error('AUTO_WORK_ITEM_CANCELLATION_PARK_INTENT_INVALID'); }
}

export async function parkCancelledAutomaticClaim(options, dependencies) {
  if (options.finishBlockedClaim || options.repairStoppedClaim ||
      typeof dependencies.blockWorkItem !== 'function' || typeof dependencies.validateClaim !== 'function' ||
      typeof dependencies.checkpoint?.writeOnceOrEqual !== 'function')
    throw new Error('AUTO_WORK_ITEM_CANCELLATION_OPTIONS_INVALID');
  const expectation = await readCancelledClaimExpectation(options.parkExpectationFile);
  const stored = await dependencies.checkpoint.readOptional('active-claim');
  const claim = stored === null ? null : dependencies.validateClaim(stored);
  if (!matchesCancelledClaim(claim, expectation) || claim.consumerStopped !== true ||
      claim.completionReady !== false || claim.blockReady !== null)
    throw new Error('AUTO_WORK_ITEM_BLOCKED_CLAIM_CHANGED');
  const intentKey = `cancelled-park-${claim.workItemId}-g${claim.leaseGeneration}`;
  if (await dependencies.checkpoint.readOptional(intentKey) !== null)
    throw new Error('AUTO_WORK_ITEM_CANCELLATION_PARK_ALREADY_STARTED');
  // Bound before the single POST. A crash or unknown response is not permission
  // for another PARK; finalization must match these original private bytes.
  await dependencies.checkpoint.writeOnceOrEqual(intentKey, {
    schemaVersion: 'wiselink.auto_work_item_cancelled_claim_park.v1', claim,
    cancellationExpectation: expectation,
  });
  const receipt = validateCancelledBlockReceipt(await dependencies.blockWorkItem({
    workItemId: claim.workItemId, leaseToken: claim.leaseToken,
    leaseGeneration: claim.leaseGeneration, expectedCancellation: expectation.expectedCancellation,
  }), expectation);
  // A fresh or unknown PARK never archives or clears. The separate operator
  // finalizer must reread the claim and receive an exact replayOnly BLOCK.
  return { ...receipt, status: 'CANCELLED_CLAIM_PARKED', workItemId: claim.workItemId,
    requestId: claim.requestId, documentVersionId: claim.documentVersionId,
    leaseGeneration: claim.leaseGeneration, claimRetained: true, providerTerminal: 'UNKNOWN' };
}
