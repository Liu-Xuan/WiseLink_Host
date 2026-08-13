export interface HostedFileServiceSelection extends Record<string, unknown> {
  bucketId: string;
  filePath: string;
  providerObjectId: string;
  providerVersionId: string;
  fileName: string;
  mediaType: string;
  bytes: Buffer;
  byteLength: number;
  sha256: string;
  readbackVerified: true;
}

export class MiaodaFileServiceArtifactStore {
  constructor(fileService: unknown, options?: { maxBytes?: number });
  readSelection(selection: {
    bucketId: string;
    filePath: string;
  }): Promise<HostedFileServiceSelection>;
  persistImmutableSource(input: unknown): Promise<Record<string, unknown>>;
}
