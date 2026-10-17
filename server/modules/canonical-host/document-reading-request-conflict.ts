export interface DocumentReadingRequestConflictIdentity {
  tenantId: string;
  actorUserId: string;
  documentVersionId: string;
  requestId: string;
}

/** A definite BEGIN input conflict for one exact reading request. */
export class DocumentReadingRequestConflict extends Error {
  readonly code = 'DOCUMENT_READING_REQUEST_CONFLICT';
  readonly statusCode = 409;
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly documentVersionId: string;
  readonly requestId: string;

  constructor(identity: DocumentReadingRequestConflictIdentity) {
    super('DOCUMENT_READING_REQUEST_CONFLICT');
    this.name = 'DocumentReadingRequestConflict';
    this.tenantId = identity.tenantId;
    this.actorUserId = identity.actorUserId;
    this.documentVersionId = identity.documentVersionId;
    this.requestId = identity.requestId;
  }
}
