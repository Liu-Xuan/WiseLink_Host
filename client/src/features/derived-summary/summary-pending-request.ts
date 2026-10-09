import type { CreateDerivedSummaryRequest, RequestDerivedSummaryUpdate } from '@shared/derived-summary.interface';

export type PendingSummaryRequest = CreateDerivedSummaryRequest | RequestDerivedSummaryUpdate;
export const summaryPendingKey = (tenantId: string, actorId: string, summaryId?: string): string =>
  `wiselink:derived-summary:pending:${JSON.stringify([tenantId, actorId, summaryId ?? 'new'])}`;

/** Keep the original request across a reload; the Host still reauthorizes every replay. */
export function readPendingSummaryRequest(key: string, summaryId?: string): PendingSummaryRequest | null {
  try {
    const text = sessionStorage.getItem(key);
    if (!text) return null;
    const value = JSON.parse(text) as PendingSummaryRequest;
    if (!value || typeof value.requestId !== 'string' || !value.requestId || typeof value.modelRef !== 'string' ||
      (value.purpose !== undefined && !['SYNTHESIZE', 'REVISE_SAVED_SUMMARY'].includes(value.purpose)) ||
      ('expectedSummaryRevision' in value && (!Number.isSafeInteger(value.expectedSummaryRevision) || value.expectedSummaryRevision < 0 || value.expectedSummaryRevision >= 2147483647)) ||
      (summaryId ? !('expectedSummaryRevision' in value) : 'expectedSummaryRevision' in value || value.purpose === 'REVISE_SAVED_SUMMARY') ||
      (value.purpose === 'REVISE_SAVED_SUMMARY' && (!('expectedSummaryRevision' in value) || value.expectedSummaryRevision < 1)) ||
      !value.scope || !['ATA4', 'ATA2', 'FLEET'].includes(value.scope.kind) || typeof value.scope.title !== 'string' ||
      typeof value.scope.fleetFamilyId !== 'string' || !Array.isArray(value.scope.fleetModelIds) ||
      typeof value.scope.selectionReason !== 'string' || typeof value.instruction !== 'string' ||
      !Array.isArray(value.members) || !value.members.length || value.members.some(member => {
        if (!member) return true;
        if (member.kind === 'DERIVED_SUMMARY') return typeof member.summaryId !== 'string' || typeof member.summaryRef !== 'string' || !Number.isSafeInteger(member.summaryRevision);
        if (member.kind !== 'WORK_ITEM_WORK' && member.kind !== 'MATTER_WORK') return true;
        return typeof member.workRef !== 'string' || !Number.isSafeInteger(member.workRevision) || !Array.isArray(member.issueKeys) || member.issueKeys.some(key => typeof key !== 'string') ||
          (member.kind === 'WORK_ITEM_WORK' ? typeof member.workItemId !== 'string' || typeof member.documentVersionId !== 'string' : typeof member.matterId !== 'string');
      }))
      throw new Error('INVALID_PENDING_REQUEST');
    return value;
  } catch { throw new Error('本地保留请求无法读取。请先从概述目录核对已有受理结果，避免重复发起。'); }
}
export function storePendingSummaryRequest(key: string, input: PendingSummaryRequest): void {
  try { sessionStorage.setItem(key, JSON.stringify(input)); }
  catch { throw new Error('无法保留原请求快照，本次尚未发起。请恢复浏览器会话存储后重试。'); }
}
export function clearPendingSummaryRequest(key: string): void {
  sessionStorage.removeItem(key);
}
