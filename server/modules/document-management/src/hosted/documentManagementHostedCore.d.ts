export interface HostedCorePorts {
  artifactStore: {
    readSelection(selection: unknown): Promise<Record<string, unknown>>;
    persistImmutableSource(input: unknown): Promise<Record<string, unknown>>;
  };
  catalog: {
    recordAcquisition(input: unknown): Promise<unknown>;
    findIngestionByIdempotency(input: unknown): Promise<unknown>;
    assertImmutableSourceReuseSafe(input: unknown): Promise<unknown>;
    assertIncompleteIngestionRecoverySafe(input: unknown): Promise<unknown>;
    listIngressDocuments(input?: unknown): Promise<unknown[]>;
    observeFamily(identityKey: string): Promise<unknown>;
    recordPreflight(input: unknown): Promise<unknown>;
    findExactDocumentVersion(input: unknown): Promise<unknown>;
    linkAcquisitionToVersion(input: unknown): Promise<unknown>;
    commitNewVersion(input: unknown): Promise<unknown>;
    readDocumentVersion(documentVersionId: string): Promise<unknown>;
    readFamily(familyId: string): Promise<unknown>;
  };
  pdfLayoutExtractor?: {
    extractLayout(bytes: Buffer): unknown;
    extractLayoutWithDiagnostics?(bytes: Buffer): unknown;
  };
  authorizer: {
    assertCanIngest(context: unknown): Promise<void>;
  };
  now?: () => string;
}

export class DocumentManagementHostedCore {
  constructor(ports: HostedCorePorts);
  ingestFileServiceSelection(
    request: unknown,
    serverContext: unknown,
  ): Promise<Record<string, unknown>>;
}
