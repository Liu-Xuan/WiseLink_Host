import type { AutomaticWorkItemLeaseAuthorizationInput } from './automatic-work-item-lease-authorization.port';

export function assertInput(
  input: AutomaticWorkItemLeaseAuthorizationInput,
): void {
  if (
    !input.tenantId.trim() ||
    !input.workItemId.trim() ||
    !input.principalId.trim() ||
    (input.leaseToken === undefined) !==
      (input.leaseGeneration === undefined) ||
    (input.leaseToken !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        input.leaseToken,
      )) ||
    (input.leaseGeneration !== undefined &&
      (!Number.isSafeInteger(input.leaseGeneration) ||
        input.leaseGeneration < 1))
  ) {
    throw workItemNotFound();
  }
}

export function isObjectLocalSourceFailure(error: unknown): boolean {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : error instanceof Error
        ? error.message
        : '';
  return new Set([
    'DOCUMENT_VERSION_NOT_FOUND',
    'DOCUMENT_VERSION_NOT_CURRENT',
    'DOCUMENT_VERSION_CURRENTNESS_UNVERIFIED',
    'DOCUMENT_VERSION_SOURCE_IDENTITY_INVALID',
  ]).has(code);
}

export function workItemNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}
