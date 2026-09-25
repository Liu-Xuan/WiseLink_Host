/** Fresh, authoritative source ACL checks required before an enrolled item is dispatched. */
export const AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION = Symbol(
  'AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION',
);

export interface AutomaticWorkItemSourceAuthorizationInput {
  tenantId: string;
  actorUserId: string;
  workItemId: string;
  requestId: string;
  documentId: string;
  documentVersionId: string;
  sourceArtifactId: string;
  sourceFileSha256: string;
  sourceByteLength: number;
  queuePrincipalId: 'service:openclaw-main';
  queueAuthorizationFingerprint: string;
}

export type AutomaticWorkItemSourceAuthorizationResult =
  | {
      allowed: true;
      action: 'DOCUMENT_READ';
      tenantId: string;
      actorUserId: string;
      documentId: string;
      documentVersionId: string;
      sourceArtifactId: string;
      sourceFileSha256: string;
      sourceByteLength: number;
      authorizationFingerprint: string;
    }
  | { allowed: false; code: string };

/**
 * Implementations must ask the authoritative Document Management ACL for a
 * fresh decision over this exact source identity. They must not synthesize a
 * user session from actorUserId or treat creator ownership, hashes, or
 * currentness as source-read authorization.
 */
export interface AutomaticWorkItemSourceAuthorizationPort {
  authorizeSourceRead(
    input: AutomaticWorkItemSourceAuthorizationInput,
  ): Promise<AutomaticWorkItemSourceAuthorizationResult>;
}
