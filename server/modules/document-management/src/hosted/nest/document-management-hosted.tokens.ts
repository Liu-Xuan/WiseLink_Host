export const DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER = Symbol(
  'DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER',
);

export interface DocumentManagementIngestAuthorizer {
  assertCanIngest(input: {
    actorUserId: string;
    tenantId: string;
    roles: string[];
    action: 'DOCUMENT_INGEST';
  }): Promise<void>;

  assertCanRead?(input: {
    actorUserId: string;
    tenantId: string;
    roles: string[];
    action: 'DOCUMENT_READ';
  }): Promise<void>;
}
