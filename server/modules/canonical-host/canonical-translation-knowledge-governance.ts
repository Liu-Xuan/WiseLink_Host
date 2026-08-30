import { randomUUID } from 'node:crypto';

import type { BilingualTranslationArtifact } from './canonical-host-openclaw-translation.service';
import { translationConsumptionBindingsIdentical } from './canonical-translation-rule-contract';
import type { PrivateTranslationRuleSetProvider } from './canonical-translation-rule-set-v1.private';
import {
  TRANSLATION_KNOWLEDGE_CANDIDATE_SCHEMA,
  type ImportBilingualTranslationCandidatesInput,
  type ImportBilingualTranslationCandidatesResult,
  type InvalidateStaleTranslationKnowledgeInput,
  type ReadTranslationKnowledgeCandidateInput,
  type SaveTranslationKnowledgeCandidateResult,
  type TranslationKnowledgeAggregate,
  type TranslationKnowledgeCandidateRecord,
  type TranslationKnowledgeCandidateSnapshot,
  type TranslationKnowledgeCandidateStore,
  type TranslationKnowledgeGovernanceEvent,
  type TranslationKnowledgeGovernanceEventType,
  type TranslationKnowledgeIdFactory,
  type TranslationKnowledgeReviewInput,
} from './canonical-translation-knowledge-governance.types';

export {
  TRANSLATION_KNOWLEDGE_CANDIDATE_SCHEMA,
  type ImportBilingualTranslationCandidatesInput,
  type ImportBilingualTranslationCandidatesResult,
  type InvalidateStaleTranslationKnowledgeInput,
  type ReadTranslationKnowledgeCandidateInput,
  type SaveTranslationKnowledgeCandidateResult,
  type TranslationKnowledgeActorKind,
  type TranslationKnowledgeAggregate,
  type TranslationKnowledgeCandidateRecord,
  type TranslationKnowledgeCandidateSnapshot,
  type TranslationKnowledgeCandidateStore,
  type TranslationKnowledgeGovernanceEvent,
  type TranslationKnowledgeGovernanceEventType,
  type TranslationKnowledgeIdFactory,
  type TranslationKnowledgeReviewInput,
} from './canonical-translation-knowledge-governance.types';

/**
 * First R09 V1.1/V1.2 Translation Memory governance slice.
 *
 * This is deliberately candidate-only. It imports the existing bilingual
 * artifact; it does not translate, retrieve from a second RAG, activate a
 * terminology rule, or create formal engineering knowledge. A human owner
 * may confirm that a candidate is usable for later candidate suggestions,
 * but confirmation never promotes it beyond SUGGESTION_ONLY.
 *
 * The service is not registered in CanonicalHostModule yet. Its persistence
 * port is paired with migration 0015, while the local acceptance test uses a
 * read-back store implementing the same atomic dedupe/event contract.
 */

const defaultIdFactory: TranslationKnowledgeIdFactory = (
  kind: 'ASSET' | 'EVENT',
): string => `TK-${kind}-${randomUUID()}`;

export class CanonicalTranslationKnowledgeGovernanceService {
  constructor(
    private readonly store: TranslationKnowledgeCandidateStore,
    private readonly ruleSets: PrivateTranslationRuleSetProvider,
    private readonly idFactory: TranslationKnowledgeIdFactory = defaultIdFactory,
  ) {}

  async importBilingualCandidates(
    input: ImportBilingualTranslationCandidatesInput,
  ): Promise<ImportBilingualTranslationCandidatesResult> {
    validateImport(input, this.ruleSets);
    const assetIds: string[] = [];
    let createdCount = 0;
    let reusedCount = 0;

    for (const unit of input.artifact.units) {
      const candidate: TranslationKnowledgeCandidateRecord = {
        schemaVersion: TRANSLATION_KNOWLEDGE_CANDIDATE_SCHEMA,
        assetId: this.idFactory('ASSET'),
        tenantId: input.tenantId,
        knowledgeKind: 'TRANSLATION_MEMORY',
        candidateOnly: true,
        usagePolicy: 'SUGGESTION_ONLY',
        ownerActorId: input.ownerActorId,
        importedByActorId: input.importedByActorId,
        sourceArtifact: {
          ref: input.sourceArtifact.ref,
          sha256: input.sourceArtifact.sha256,
        },
        sourceBinding: structuredClone(input.artifact.source),
        translationExecution: {
          actionAttemptId: input.artifact.execution.actionAttemptId,
          resultContentHash: input.artifact.execution.resultContentHash,
          modelVersion: input.artifact.execution.modelVersion,
          promptVersion: input.artifact.execution.promptVersion,
          skillVersion: input.artifact.execution.skillVersion,
        },
        ruleSet: structuredClone(input.artifact.ruleSet),
        unit: {
          unitId: unit.unitId,
          kind: unit.kind,
          sourceText: unit.sourceText,
          translatedText: unit.translatedText,
          sourceRefIds: [...unit.sourceRefIds],
          engineerRevisionId: unit.engineerRevisionId,
        },
        validFrom: input.validFrom,
        expiresAt: input.expiresAt,
        createdAt: input.importedAt,
      };
      const saved: SaveTranslationKnowledgeCandidateResult =
        await this.store.saveCandidate(candidate);
      assetIds.push(saved.candidate.assetId);
      if (saved.disposition === 'CREATED') createdCount += 1;
      else reusedCount += 1;
    }

    return {
      status: 'CANDIDATE_ONLY',
      createdCount,
      reusedCount,
      assetIds,
    };
  }

  async readCandidate(
    input: ReadTranslationKnowledgeCandidateInput,
  ): Promise<TranslationKnowledgeCandidateSnapshot> {
    assertNonBlank(input.tenantId, 'KNOWLEDGE_TENANT_REQUIRED');
    assertNonBlank(input.assetId, 'KNOWLEDGE_ASSET_ID_REQUIRED');
    assertTimestamp(input.asOf, 'KNOWLEDGE_AS_OF_INVALID');
    const aggregate: TranslationKnowledgeAggregate =
      await this.requiredAggregate(input.tenantId, input.assetId);
    const events: TranslationKnowledgeGovernanceEvent[] = orderedEvents(
      aggregate.events,
    );
    const invalidated: boolean = events.some(
      (event: TranslationKnowledgeGovernanceEvent) =>
        event.eventType === 'INVALIDATED',
    );
    const confirmed: boolean = events.some(
      (event: TranslationKnowledgeGovernanceEvent) =>
        event.eventType === 'HUMAN_CONFIRMED',
    );
    const sourceCurrent: boolean =
      input.currentBinding !== null &&
      translationConsumptionBindingsIdentical(
        aggregate.candidate.sourceBinding,
        input.currentBinding,
      );
    const expired: boolean =
      Date.parse(input.asOf) >= Date.parse(aggregate.candidate.expiresAt);
    const validityStatus: TranslationKnowledgeCandidateSnapshot['validityStatus'] =
      invalidated ? 'INVALIDATED' : expired ? 'EXPIRED' : 'CURRENT';
    const eligible: boolean =
      confirmed && validityStatus === 'CURRENT' && sourceCurrent;

    return {
      candidate: structuredClone(aggregate.candidate),
      governanceRevision: events.length,
      confirmationStatus: confirmed
        ? 'HUMAN_CONFIRMED'
        : 'PENDING_HUMAN_CONFIRMATION',
      validityStatus,
      sourceCurrentness: sourceCurrent ? 'CURRENT' : 'STALE',
      retrievalEligibility: eligible ? 'SUGGESTION_ONLY' : 'BLOCKED',
      activeTerminology: false,
      formalKnowledge: false,
      events,
    };
  }

  async confirmByHuman(
    input: TranslationKnowledgeReviewInput,
  ): Promise<TranslationKnowledgeCandidateSnapshot> {
    assertHumanOwnerReviewInput(input);
    const before: TranslationKnowledgeCandidateSnapshot =
      await this.readCandidate({
        tenantId: input.tenantId,
        assetId: input.assetId,
        asOf: input.occurredAt,
        currentBinding: input.currentBinding,
      });
    assertOwner(before.candidate, input.actorId);
    if (before.validityStatus !== 'CURRENT') {
      throw new Error('KNOWLEDGE_CANDIDATE_NOT_CURRENT');
    }
    if (before.sourceCurrentness !== 'CURRENT') {
      throw new Error('KNOWLEDGE_SOURCE_NOT_CURRENT');
    }
    if (before.confirmationStatus === 'HUMAN_CONFIRMED') return before;

    await this.store.appendEvent(
      this.eventFor(input, before.governanceRevision, 'HUMAN_CONFIRMED'),
    );
    return this.readCandidate({
      tenantId: input.tenantId,
      assetId: input.assetId,
      asOf: input.occurredAt,
      currentBinding: input.currentBinding,
    });
  }

  async invalidateByHuman(
    input: TranslationKnowledgeReviewInput,
  ): Promise<TranslationKnowledgeCandidateSnapshot> {
    assertHumanOwnerReviewInput(input);
    const before: TranslationKnowledgeCandidateSnapshot =
      await this.readCandidate({
        tenantId: input.tenantId,
        assetId: input.assetId,
        asOf: input.occurredAt,
        currentBinding: input.currentBinding,
      });
    assertOwner(before.candidate, input.actorId);
    if (before.validityStatus === 'INVALIDATED') return before;

    await this.store.appendEvent(
      this.eventFor(input, before.governanceRevision, 'INVALIDATED'),
    );
    return this.readCandidate({
      tenantId: input.tenantId,
      assetId: input.assetId,
      asOf: input.occurredAt,
      currentBinding: input.currentBinding,
    });
  }

  async invalidateIfSourceStale(
    input: InvalidateStaleTranslationKnowledgeInput,
  ): Promise<TranslationKnowledgeCandidateSnapshot> {
    assertTimestamp(input.invalidatedAt, 'KNOWLEDGE_INVALIDATION_TIME_INVALID');
    const before: TranslationKnowledgeCandidateSnapshot =
      await this.readCandidate({
        tenantId: input.tenantId,
        assetId: input.assetId,
        asOf: input.invalidatedAt,
        currentBinding: input.currentBinding,
      });
    if (
      before.sourceCurrentness === 'CURRENT' ||
      before.validityStatus === 'INVALIDATED'
    ) {
      return before;
    }
    const reason: string =
      input.currentBinding === null
        ? 'HOST_CURRENT_BINDING_UNAVAILABLE'
        : 'SOURCE_BINDING_CHANGED';
    const event: TranslationKnowledgeGovernanceEvent = {
      eventId: this.idFactory('EVENT'),
      tenantId: input.tenantId,
      assetId: input.assetId,
      eventType: 'INVALIDATED',
      expectedRevision: before.governanceRevision,
      resultingRevision: before.governanceRevision + 1,
      actorKind: 'SYSTEM',
      actorId: 'system:canonical-host-currentness',
      reason,
      createdAt: input.invalidatedAt,
    };
    await this.store.appendEvent(event);
    return this.readCandidate({
      tenantId: input.tenantId,
      assetId: input.assetId,
      asOf: input.invalidatedAt,
      currentBinding: input.currentBinding,
    });
  }

  private eventFor(
    input: TranslationKnowledgeReviewInput,
    expectedRevision: number,
    eventType: TranslationKnowledgeGovernanceEventType,
  ): TranslationKnowledgeGovernanceEvent {
    return {
      eventId: this.idFactory('EVENT'),
      tenantId: input.tenantId,
      assetId: input.assetId,
      eventType,
      expectedRevision,
      resultingRevision: expectedRevision + 1,
      actorKind: input.actorKind,
      actorId: input.actorId,
      reason: input.reason,
      createdAt: input.occurredAt,
    };
  }

  private async requiredAggregate(
    tenantId: string,
    assetId: string,
  ): Promise<TranslationKnowledgeAggregate> {
    const aggregate: TranslationKnowledgeAggregate | null =
      await this.store.readAggregate(tenantId, assetId);
    if (aggregate === null) throw new Error('KNOWLEDGE_CANDIDATE_NOT_FOUND');
    return aggregate;
  }
}

function validateImport(
  input: ImportBilingualTranslationCandidatesInput,
  ruleSets: PrivateTranslationRuleSetProvider,
): void {
  assertNonBlank(input.tenantId, 'KNOWLEDGE_TENANT_REQUIRED');
  assertNonBlank(input.ownerActorId, 'KNOWLEDGE_OWNER_REQUIRED');
  assertNonBlank(input.importedByActorId, 'KNOWLEDGE_IMPORTER_REQUIRED');
  assertNonBlank(input.sourceArtifact.ref, 'KNOWLEDGE_ARTIFACT_REF_REQUIRED');
  assertNonBlank(
    input.sourceArtifact.sha256,
    'KNOWLEDGE_ARTIFACT_SHA256_REQUIRED',
  );
  assertTimestamp(input.validFrom, 'KNOWLEDGE_VALID_FROM_INVALID');
  assertTimestamp(input.expiresAt, 'KNOWLEDGE_EXPIRES_AT_INVALID');
  assertTimestamp(input.importedAt, 'KNOWLEDGE_IMPORTED_AT_INVALID');
  if (Date.parse(input.expiresAt) <= Date.parse(input.validFrom)) {
    throw new Error('KNOWLEDGE_VALIDITY_WINDOW_INVALID');
  }
  if (
    input.artifact.schemaVersion !==
      'wiselink.3_1.bilingual_translation_artifact.v1' ||
    input.artifact.candidateOnly !== true ||
    input.artifact.validation.verdict !== 'ACCEPTED'
  ) {
    throw new Error('KNOWLEDGE_ACCEPTED_CANDIDATE_ARTIFACT_REQUIRED');
  }
  if (
    !translationConsumptionBindingsIdentical(
      input.artifact.source,
      input.currentBinding,
    )
  ) {
    throw new Error('KNOWLEDGE_SOURCE_NOT_CURRENT');
  }
  const selectedRuleSet: unknown = ruleSets.select({
    ruleSetId: input.artifact.ruleSet.ruleSetId,
    ruleSetVersion: input.artifact.ruleSet.ruleSetVersion,
    sourceLocale: input.artifact.ruleSet.sourceLocale,
    targetLocale: input.artifact.ruleSet.targetLocale,
  });
  if (selectedRuleSet === null) {
    throw new Error('KNOWLEDGE_RULE_SET_NOT_DEPLOYED');
  }
  assertExecutionProvenance(input.artifact);
  if (input.artifact.units.length === 0) {
    throw new Error('KNOWLEDGE_TRANSLATION_UNITS_REQUIRED');
  }
  const unitIds: Set<string> = new Set<string>();
  for (const unit of input.artifact.units) {
    assertNonBlank(unit.unitId, 'KNOWLEDGE_UNIT_ID_REQUIRED');
    assertNonBlank(unit.kind, 'KNOWLEDGE_UNIT_KIND_REQUIRED');
    assertNonBlank(unit.sourceText, 'KNOWLEDGE_SOURCE_TEXT_REQUIRED');
    assertNonBlank(unit.translatedText, 'KNOWLEDGE_TRANSLATED_TEXT_REQUIRED');
    if (unitIds.has(unit.unitId)) {
      throw new Error('KNOWLEDGE_DUPLICATE_UNIT_ID');
    }
    unitIds.add(unit.unitId);
    assertSourceRefs(unit.sourceRefIds);
  }
}

function assertExecutionProvenance(
  artifact: BilingualTranslationArtifact,
): void {
  assertNonBlank(
    artifact.execution.actionAttemptId,
    'KNOWLEDGE_ACTION_ATTEMPT_REQUIRED',
  );
  assertNonBlank(
    artifact.execution.resultContentHash,
    'KNOWLEDGE_RESULT_CONTENT_HASH_REQUIRED',
  );
  assertNonBlank(
    artifact.execution.modelVersion,
    'KNOWLEDGE_MODEL_VERSION_REQUIRED',
  );
  assertNonBlank(
    artifact.execution.promptVersion,
    'KNOWLEDGE_PROMPT_VERSION_REQUIRED',
  );
  assertNonBlank(
    artifact.execution.skillVersion,
    'KNOWLEDGE_SKILL_VERSION_REQUIRED',
  );
}

function assertSourceRefs(sourceRefIds: readonly string[]): void {
  if (sourceRefIds.length === 0) {
    throw new Error('KNOWLEDGE_SOURCE_REF_REQUIRED');
  }
  const unique: Set<string> = new Set<string>();
  for (const sourceRefId of sourceRefIds) {
    assertNonBlank(sourceRefId, 'KNOWLEDGE_SOURCE_REF_REQUIRED');
    if (unique.has(sourceRefId)) {
      throw new Error('KNOWLEDGE_DUPLICATE_SOURCE_REF');
    }
    unique.add(sourceRefId);
  }
}

function orderedEvents(
  source: readonly TranslationKnowledgeGovernanceEvent[],
): TranslationKnowledgeGovernanceEvent[] {
  const events: TranslationKnowledgeGovernanceEvent[] = structuredClone([
    ...source,
  ]).sort(
    (
      left: TranslationKnowledgeGovernanceEvent,
      right: TranslationKnowledgeGovernanceEvent,
    ): number => left.resultingRevision - right.resultingRevision,
  );
  let revision = 0;
  for (const event of events) {
    if (
      event.expectedRevision !== revision ||
      event.resultingRevision !== revision + 1 ||
      (event.eventType === 'HUMAN_CONFIRMED' && event.actorKind !== 'HUMAN')
    ) {
      throw new Error('KNOWLEDGE_GOVERNANCE_EVENT_CHAIN_INVALID');
    }
    revision = event.resultingRevision;
  }
  return events;
}

function assertHumanOwnerReviewInput(
  input: TranslationKnowledgeReviewInput,
): void {
  assertNonBlank(input.tenantId, 'KNOWLEDGE_TENANT_REQUIRED');
  assertNonBlank(input.assetId, 'KNOWLEDGE_ASSET_ID_REQUIRED');
  assertNonBlank(input.actorId, 'KNOWLEDGE_ACTOR_REQUIRED');
  assertNonBlank(input.reason, 'KNOWLEDGE_REVIEW_REASON_REQUIRED');
  assertTimestamp(input.occurredAt, 'KNOWLEDGE_REVIEW_TIME_INVALID');
  if (input.actorKind !== 'HUMAN') {
    throw new Error('KNOWLEDGE_HUMAN_CONFIRMATION_REQUIRED');
  }
}

function assertOwner(
  candidate: TranslationKnowledgeCandidateRecord,
  actorId: string,
): void {
  if (candidate.ownerActorId !== actorId) {
    throw new Error('KNOWLEDGE_OWNER_CONFIRMATION_REQUIRED');
  }
}

function assertTimestamp(value: string, errorCode: string): void {
  const parsed: Date = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(errorCode);
  }
}

function assertNonBlank(value: string, errorCode: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(errorCode);
  }
}
