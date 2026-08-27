export const DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER = Symbol(
  'DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER',
);

export interface DocumentManagementIngestAuthorizer {
  assertCanIngest(input: {
    actorUserId: string;
    tenantId: string;
    roles: string[];
    action: 'DOCUMENT_INGEST';
    selection: { bucketId: string; filePath: string };
    runtimeIngestAuthority?: {
      mode:
        | 'HOSTED_OAUTH_SESSION_DEVELOPMENT_RUN'
        | 'HOSTED_OAUTH_SESSION_REVIEW_ATTACHMENT';
      actorUserId: string;
      tenantId: string;
      appId: string;
      identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN';
      sessionProvenance: 'SERVER_OPAQUE_SESSION';
      workItemId?: string;
      expectedRevision?: number;
      authorizationFingerprint?: string;
    };
  }): Promise<void>;

  assertCanRead(input: {
    actorUserId: string;
    tenantId: string;
    roles: string[];
    action: 'DOCUMENT_READ';
    documentVersionId: string;
  }): Promise<void>;
}
