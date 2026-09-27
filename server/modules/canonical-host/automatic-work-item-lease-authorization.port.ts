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
  authorizeReviewDelegation?(input: {
    tenantId: string;
    principalId: string;
    workItemId: string;
    reviewConversationRef: string;
    requestId: string;
  }): Promise<AuthorizedSuccessorReviewDelegation>;
  authorizeReviewAttempt?(input: {
    tenantId: string;
    principalId: string;
    workItemId: string;
    attemptRef: string;
  }): Promise<AuthorizedSuccessorReviewDelegation>;
  authorizeActiveLease(
    input: AutomaticWorkItemLeaseAuthorizationInput,
  ): Promise<AuthorizedAutomaticWorkItemLease>;
}

export interface AuthorizedSuccessorReviewDelegation {
  tenantId: string;
  principalId: string;
  workItemId: string;
  actorUserId: string;
  documentId: string;
  documentVersionId: string;
  sourceArtifactId: string;
  sourceFileSha256: string;
  sourceByteLength: number;
  reviewConversationRef: string;
  reviewTurnRef: string;
  requestId: string;
  inputRevision: number;
  overallRequested: boolean;
}
