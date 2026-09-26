import type { DocumentParseRunSummary } from './document-parsing.interface';

const PREFIX = 'parse-resume-';
const RUN_ID = /^PRUN-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

/** A reserved, immutable request identity records the predecessor; it grants no authority. */
export function documentParseRecoveryRequestId(parseRunId: string): string {
  if (!RUN_ID.test(parseRunId)) throw new Error('DOCUMENT_PARSE_RECOVERY_REQUEST_INVALID');
  return PREFIX + parseRunId;
}

export function documentParseRecoveryPredecessor(requestId: string): string | null {
  if (!requestId.startsWith(PREFIX)) return null;
  const predecessor = requestId.slice(PREFIX.length);
  if (!RUN_ID.test(predecessor)) throw new Error('DOCUMENT_PARSE_RECOVERY_REQUEST_INVALID');
  return predecessor;
}

/** Expiry alone does not establish that a plugin, quota, input or authorization failure is repaired. */
export function canAutomaticallyRecoverDocumentParse(
  run: Pick<DocumentParseRunSummary, 'status' | 'errorCode' | 'deadlineAt'>,
  now = Date.now(),
): boolean {
  const deadline = Date.parse(run.deadlineAt);
  if (!Number.isFinite(deadline) || deadline > now || run.status === 'PUBLISHED') return false;
  return run.errorCode === 'DOCUMENT_PARSE_INTERRUPTED' ||
    (['RUNNING', 'STAGING'].includes(run.status) && run.errorCode === null);
}
