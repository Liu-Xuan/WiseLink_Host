import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

export interface ReviewAttachmentBinding {
  attachmentRef: string;
  documentVersionId: string;
  fileName: string;
  mediaType: 'application/pdf';
  byteLength: number;
  selectionKey: string;
  parsedArtifact: UnifiedPackageArtifactDescriptor;
}

export interface ReviewEngineerInputPayload {
  schemaVersion: 'wiselink.3_1.review_engineer_input.v1.c7';
  userMessage: string;
  selectedEvaluationItemId?: string | null;
  executionRequested?: boolean;
  attachments: ReviewAttachmentBinding[];
}
