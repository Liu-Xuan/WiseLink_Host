import type { Request } from 'express';

import {
  isRecord,
  projectionError,
  requireNonEmptyString,
} from './aeo-editor-projection.utils';

export const AEO_AILY_REQUESTER_RESOLVER = Symbol(
  'AEO_AILY_REQUESTER_RESOLVER',
);

/**
 * CanonicalAily host adapter. The implementation must derive the actor from a
 * platform-authenticated request context; caller supplied request fields are
 * never an identity source.
 */
export interface AeoAilyRequesterResolver {
  resolve(request: Request): Promise<string>;
}

export class UnconfiguredAeoAilyRequesterResolver implements AeoAilyRequesterResolver {
  async resolve(_request: Request): Promise<string> {
    projectionError(
      'AEO_AILY_REQUESTER_UNAVAILABLE',
      'CanonicalAily 可信用户解析器尚未由 3.1 宿主绑定。',
    );
  }
}

export function attachTrustedAilyRequester(
  body: unknown,
  requesterRef: string,
): Record<string, unknown> {
  if (!isRecord(body)) {
    projectionError('AEO_AILY_REQUEST_INVALID', '请求必须是对象。');
  }
  if ('requesterRef' in body) {
    projectionError(
      'AEO_AILY_REQUEST_INVALID',
      'requesterRef 不得由调用者提交；必须由 CanonicalAily 可信上下文注入。',
    );
  }
  return {
    ...body,
    requesterRef: requireNonEmptyString(
      requesterRef,
      'AEO_AILY_REQUESTER_UNAVAILABLE',
      'trusted requesterRef',
    ),
  };
}
