import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalOrdinaryWorkItemRunResponse,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

export type ParseAction =
  | 'RESUME_PENDING'
  | 'RETRY_SOURCE_BINDING'
  | 'REPARSE_COMPLETED';

export interface ReparseExpectedIdentity {
  workItemId: string;
  documentVersionId: string;
}

export function availableParseAction(
  developmentIntakeAvailable: boolean,
  projection: CanonicalWorkItemProjection | null,
): ParseAction | null {
  if (!developmentIntakeAvailable || projection === null) return null;
  if (projection.phase === 'PARSE_REQUESTED') return 'RESUME_PENDING';
  if (
    projection.phase === 'FAILED' &&
    projection.failure?.failureCode === 'SOURCE_BINDING_FAILED'
  ) {
    return 'RETRY_SOURCE_BINDING';
  }
  if (
    projection.phase === 'CANDIDATE_READBACK_VERIFIED' &&
    projection.package !== null
  ) {
    return 'REPARSE_COMPLETED';
  }
  return null;
}

export function parseActionLabel(action: ParseAction): string {
  return action === 'RESUME_PENDING' ? '继续解析' : '重新解析';
}

export function assertSameWorkItemReparseRun(
  response: CanonicalOrdinaryWorkItemRunResponse,
  expected: ReparseExpectedIdentity,
): void {
  if (
    response.workItemCreated ||
    !response.workItemReused ||
    !response.actionAttemptId.trim() ||
    response.result.status !== 'CANDIDATE_VERTICAL_VERIFIED' ||
    response.result.workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
    response.result.workItem.package === null ||
    response.result.workItem.workItemId !== expected.workItemId ||
    response.result.workItem.source.documentVersionId !==
      expected.documentVersionId
  ) {
    throw new Error('CANONICAL_SAME_WORK_ITEM_RETRY_MISMATCH');
  }
}

export function assertSameWorkItemReparseReadback(
  response: CanonicalDocumentParsingPageResponse,
  expected: ReparseExpectedIdentity,
): void {
  if (
    response.status !== 'FRESH_READ' ||
    response.workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
    response.workItem.package === null ||
    response.workItem.workItemId !== expected.workItemId ||
    response.workItem.source.documentVersionId !== expected.documentVersionId
  ) {
    throw new Error('CANONICAL_SAME_WORK_ITEM_READBACK_MISMATCH');
  }
}
