export const AUTOMATIC_WORK_ITEM_LEASE_AUTHORIZATION = Symbol(
  'AUTOMATIC_WORK_ITEM_LEASE_AUTHORIZATION',
);

export interface AutomaticWorkItemLeaseAuthorizationInput {
  tenantId: string;
  principalId: string;
  workItemId: string;
  /** Supplied only for the queue acknowledgement control call. */
  leaseToken?: string;
  leaseGeneration?: number;
}

export interface AuthorizedAutomaticWorkItemLease {
  tenantId: string;
  principalId: string;
  workItemId: string;
  requestId: string;
  actorUserId: string;
  documentId: string;
  documentVersionId: string;
  sourceArtifactId: string;
  sourceFileSha256: string;
  sourceByteLength: number;
  leaseGeneration: number;
  leaseExpiresAt: string;
}

export interface AutomaticWorkItemLeaseAuthorizationPort {
  authorizeActiveLease(
    input: AutomaticWorkItemLeaseAuthorizationInput,
  ): Promise<AuthorizedAutomaticWorkItemLease>;
}
