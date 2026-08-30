import type {
  CanonicalTranslationKnowledgeFeedbackDecision,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';

import type { BilingualTranslationArtifact } from './canonical-host-openclaw-translation.service';
import type { CanonicalTranslationConsumptionBinding } from './canonical-reader-consumption';

export const TRANSLATION_KNOWLEDGE_CANDIDATE_SCHEMA =
  'wiselink.3_1.translation_knowledge_candidate.v1';

export type TranslationKnowledgeActorKind = 'HUMAN' | 'MODEL' | 'SYSTEM';
export type TranslationKnowledgeGovernanceActorKind = 'HUMAN' | 'SYSTEM';

export interface TranslationKnowledgeCandidateRecord {
  schemaVersion: typeof TRANSLATION_KNOWLEDGE_CANDIDATE_SCHEMA;
  assetId: string;
  tenantId: string;
  workItemId: string;
  snapshotWorkItemRevision: number;
  knowledgeKind: 'TRANSLATION_MEMORY';
  candidateOnly: true;
  usagePolicy: 'SUGGESTION_ONLY';
  ownerActorId: string;
  importedByActorId: string;
  sourceArtifact: {
    ref: string;
    sha256: string;
  };
  sourceBinding: CanonicalTranslationConsumptionBinding;
  translationExecution: {
    actionAttemptId: string;
    resultContentHash: string;
    modelVersion: string;
    promptVersion: string;
    skillVersion: string;
  };
  ruleSet: {
    ruleSetId: string;
    ruleSetVersion: string;
    sourceLocale: string;
    targetLocale: string;
  };
  unit: {
    unitId: string;
    kind: string;
    sourceUnitCount: number;
    sourceText: string;
    translatedText: string;
    sourceRefIds: string[];
    engineerRevisionId: string | null;
  };
  validFrom: string;
  expiresAt: string;
  createdAt: string;
}

export type TranslationKnowledgeGovernanceEventType =
  | 'HUMAN_CONFIRMED'
  | 'INVALIDATED'
  | 'ENGINEER_ADOPTED'
  | 'ENGINEER_REJECTED';

export interface TranslationKnowledgeGovernanceEvent {
  eventId: string;
  tenantId: string;
  workItemId: string;
  snapshotWorkItemRevision: number;
  requestId: string | null;
  assetId: string;
  eventType: TranslationKnowledgeGovernanceEventType;
  feedbackDecision: CanonicalTranslationKnowledgeFeedbackDecision | null;
  expectedRevision: number;
  resultingRevision: number;
  actorKind: TranslationKnowledgeGovernanceActorKind;
  actorId: string;
  reason: string;
  createdAt: string;
}

export interface TranslationKnowledgeAggregate {
  candidate: TranslationKnowledgeCandidateRecord;
  events: TranslationKnowledgeGovernanceEvent[];
}

export interface SaveTranslationKnowledgeCandidateResult {
  candidate: TranslationKnowledgeCandidateRecord;
  disposition: 'CREATED' | 'REUSED';
}

/**
 * Persistence must atomically dedupe by tenant + existing artifact SHA-256 +
 * unit id. Cross-artifact semantic clustering belongs to V1.2 and is not
 * inferred here.
 */
export interface TranslationKnowledgeCandidateStore {
  saveCandidate(
    candidate: TranslationKnowledgeCandidateRecord,
  ): Promise<SaveTranslationKnowledgeCandidateResult>;
  readAggregate(
    tenantId: string,
    workItemId: string,
    assetId: string,
  ): Promise<TranslationKnowledgeAggregate | null>;
  appendEvent(
    event: TranslationKnowledgeGovernanceEvent,
  ): Promise<TranslationKnowledgeGovernanceEvent>;
}

export interface ImportBilingualTranslationCandidatesInput {
  tenantId: string;
  workItemId: string;
  snapshotWorkItemRevision: number;
  ownerActorId: string;
  importedByActorId: string;
  sourceArtifact: UnifiedPackageArtifactDescriptor;
  artifact: BilingualTranslationArtifact;
  currentBinding: CanonicalTranslationConsumptionBinding;
  validFrom: string;
  expiresAt: string;
  importedAt: string;
}

export interface ImportBilingualTranslationCandidatesResult {
  status: 'CANDIDATE_ONLY';
  createdCount: number;
  reusedCount: number;
  assetIds: string[];
}

export interface TranslationKnowledgeCandidateSnapshot {
  candidate: TranslationKnowledgeCandidateRecord;
  governanceRevision: number;
  confirmationStatus:
    | 'PENDING_HUMAN_CONFIRMATION'
    | 'HUMAN_CONFIRMED'
    | 'HUMAN_REJECTED';
  validityStatus: 'NOT_YET_VALID' | 'CURRENT' | 'EXPIRED' | 'INVALIDATED';
  sourceCurrentness: 'CURRENT' | 'STALE';
  retrievalEligibility: 'SUGGESTION_ONLY' | 'BLOCKED';
  activeTerminology: false;
  formalKnowledge: false;
  events: TranslationKnowledgeGovernanceEvent[];
}

export interface TranslationKnowledgeReviewInput {
  tenantId: string;
  workItemId: string;
  currentWorkItemRevision: number;
  assetId: string;
  actorKind: TranslationKnowledgeActorKind;
  actorId: string;
  reason: string;
  occurredAt: string;
  currentBinding: CanonicalTranslationConsumptionBinding | null;
}

export interface ReadTranslationKnowledgeCandidateInput {
  tenantId: string;
  workItemId: string;
  currentWorkItemRevision: number;
  assetId: string;
  asOf: string;
  currentBinding: CanonicalTranslationConsumptionBinding | null;
}

export interface InvalidateStaleTranslationKnowledgeInput {
  tenantId: string;
  workItemId: string;
  currentWorkItemRevision: number;
  assetId: string;
  invalidatedAt: string;
  currentBinding: CanonicalTranslationConsumptionBinding | null;
}

export type TranslationKnowledgeIdFactory = (kind: 'ASSET' | 'EVENT') => string;

export interface TranslationKnowledgeImportRequestItem {
  tenantId: string;
  workItemId: string;
  requestId: string;
  snapshotWorkItemRevision: number;
  sourceArtifactSha256: string;
  sourceUnitId: string;
  sourceUnitOrdinal: number;
  expectedUnitCount: number;
  assetId: string;
  validFrom: string;
  expiresAt: string;
  createdAt: string;
}

export interface TranslationKnowledgeProductStore extends TranslationKnowledgeCandidateStore {
  saveImportRequestItem(
    item: TranslationKnowledgeImportRequestItem,
  ): Promise<void>;
  readImportRequestItems(input: {
    tenantId: string;
    workItemId: string;
    requestId: string;
  }): Promise<TranslationKnowledgeImportRequestItem[]>;
  readEventByRequest(input: {
    tenantId: string;
    workItemId: string;
    requestId: string;
  }): Promise<TranslationKnowledgeGovernanceEvent | null>;
}
