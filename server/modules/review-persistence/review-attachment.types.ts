import type {
  CanonicalExecutionModelSelection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';

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
  /** Captured by Host after session authorization; never accepted from request JSON. */
  ailySessionId?: string;
  purpose?: 'CHAT' | 'UPDATE_ASSESSMENT';
  includedDiscussionTurnIds?: string[];
  expectedInputRevision?: number;
  schemaVersion: 'wiselink.3_1.review_engineer_input.v1.c7';
  userMessage: string;
  selectedEvaluationItemId?: string | null;
  executionRequested?: boolean;
  requestedModel?: CanonicalExecutionModelSelection;
  attachments: ReviewAttachmentBinding[];
}
