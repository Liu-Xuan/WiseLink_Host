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
}

export type AutomaticWorkItemSourceAuthorizationResult =
  | {
      allowed: true;
      action: 'DOCUMENT_READ';
      authorizationPolicy: 'MIAODA_HOST_DOCUMENT_READ';
      tenantId: string;
      actorUserId: string;
      documentId: string;
      documentVersionId: string;
      sourceArtifactId: string;
      sourceFileSha256: string;
      sourceByteLength: number;
    }
  | { allowed: false; code: string };

/**
 * Implementations must ask the configured Host Document Management read
 * policy over this exact persisted source identity. They must not synthesize
 * a user session from actorUserId or treat source hashes/currentness as
 * authorization. The current policy is creator/owned-acquisition based and
 * does not claim to verify provider-level ACL or immediate external revocation.
 */
export interface AutomaticWorkItemSourceAuthorizationPort {
  authorizeSourceRead(
    input: AutomaticWorkItemSourceAuthorizationInput,
  ): Promise<AutomaticWorkItemSourceAuthorizationResult>;
}
