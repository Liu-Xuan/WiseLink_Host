export interface Phase5BoeingSbIngestRequestInput {
  selection: { bucketId: string; filePath: string };
  sourceRef: string;
  idempotencyKey: string;
}

export const PHASE5_737_34_3830_HANDOFF: Readonly<Record<string, unknown>>;

export function createPhase5BoeingSbIngestRequest(
  input: Phase5BoeingSbIngestRequestInput,
): {
  selection: { bucketId: string; filePath: string };
  sourceChannel: 'canonical_miaoda_document_selection';
  sourceRef: string;
  idempotencyKey: string;
  descriptor: Record<string, unknown>;
};
