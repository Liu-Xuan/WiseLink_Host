import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import type { BilingualTranslationArtifact } from './canonical-host-openclaw-translation.service';
import type { CanonicalTranslationConsumptionBinding } from './canonical-reader-consumption';

export const TRANSLATION_KNOWLEDGE_CANDIDATE_SCHEMA =
  'wiselink.3_1.translation_knowledge_candidate.v1';

export type TranslationKnowledgeActorKind = 'HUMAN' | 'MODEL' | 'SYSTEM';

export interface TranslationKnowledgeCandidateRecord {
  schemaVersion: typeof TRANSLATION_KNOWLEDGE_CANDIDATE_SCHEMA;
  assetId: string;
  tenantId: string;
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
  | 'INVALIDATED';

export interface TranslationKnowledgeGovernanceEvent {
  eventId: string;
  tenantId: string;
  assetId: string;
  eventType: TranslationKnowledgeGovernanceEventType;
  expectedRevision: number;
  resultingRevision: number;
  actorKind: TranslationKnowledgeActorKind;
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
    assetId: string,
  ): Promise<TranslationKnowledgeAggregate | null>;
  appendEvent(event: TranslationKnowledgeGovernanceEvent): Promise<void>;
}

export interface ImportBilingualTranslationCandidatesInput {
  tenantId: string;
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
  confirmationStatus: 'PENDING_HUMAN_CONFIRMATION' | 'HUMAN_CONFIRMED';
  validityStatus: 'NOT_YET_VALID' | 'CURRENT' | 'EXPIRED' | 'INVALIDATED';
  sourceCurrentness: 'CURRENT' | 'STALE';
  retrievalEligibility: 'SUGGESTION_ONLY' | 'BLOCKED';
  activeTerminology: false;
  formalKnowledge: false;
  events: TranslationKnowledgeGovernanceEvent[];
}

export interface TranslationKnowledgeReviewInput {
  tenantId: string;
  assetId: string;
  actorKind: TranslationKnowledgeActorKind;
  actorId: string;
  reason: string;
  occurredAt: string;
  currentBinding: CanonicalTranslationConsumptionBinding | null;
}

export interface ReadTranslationKnowledgeCandidateInput {
  tenantId: string;
  assetId: string;
  asOf: string;
  currentBinding: CanonicalTranslationConsumptionBinding | null;
}

export interface InvalidateStaleTranslationKnowledgeInput {
  tenantId: string;
  assetId: string;
  invalidatedAt: string;
  currentBinding: CanonicalTranslationConsumptionBinding | null;
}

export type TranslationKnowledgeIdFactory = (kind: 'ASSET' | 'EVENT') => string;
