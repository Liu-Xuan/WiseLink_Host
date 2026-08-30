import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalTranslationKnowledgeAdoptionReceipt,
  CanonicalTranslationKnowledgeCandidateSnapshot,
  CanonicalTranslationKnowledgeFeedbackDecision,
  CanonicalWorkItemProjection,
  CreateCanonicalTranslationKnowledgeCandidatesRequest,
  CreateCanonicalTranslationKnowledgeCandidatesResponse,
  RecordCanonicalTranslationKnowledgeFeedbackRequest,
  RecordCanonicalTranslationKnowledgeFeedbackResponse,
} from '@shared/api.interface';
import { authorizeAndLoadCanonicalWorkItem } from './canonical-authorized-work-item-reader';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_HOST_CLOCK,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import type {
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalHostClockPort,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';
import {
  parseBilingualTranslationArtifact,
  type BilingualTranslationArtifact,
} from './canonical-host-openclaw-translation.service';
import type { CanonicalTranslationConsumptionBinding } from './canonical-reader-consumption';
import { CanonicalTranslationKnowledgeGovernanceService } from './canonical-translation-knowledge-governance';
import type {
  TranslationKnowledgeCandidateSnapshot,
  TranslationKnowledgeGovernanceEvent,
  TranslationKnowledgeImportRequestItem,
  ReadTranslationKnowledgeCandidateInput,
} from './canonical-translation-knowledge-governance.types';
import { HostOwnedV1TranslationRuleSetPrivateProvider } from './canonical-translation-rule-set-v1.private';
import { MiaodaTranslationKnowledgeProductStore } from './miaoda-translation-knowledge-product.store';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';

const SNAPSHOT_SCHEMA =
  'wiselink.3_1.translation_knowledge_candidate_snapshot.v1' as const;
const IMPORT_RECEIPT_SCHEMA =
  'wiselink.3_1.translation_knowledge_import_receipt.v1' as const;
const ADOPTION_RECEIPT_SCHEMA =
  'wiselink.3_1.translation_knowledge_adoption_receipt.v1' as const;

const AUTHORITY = {
  candidateOnly: true,
  activeTerminology: false,
  formalKnowledge: false,
  companyProcedureActivated: false,
  engineeringApproved: false,
  productionPublished: false,
  translationCurrentChanged: false,
  frequencyCreatesAuthority: false,
} as const;

interface AuthorizedWorkItem {
  workItem: CanonicalWorkItemProjection;
  permissionSnapshotVersion: string;
}

interface CurrentTranslationContext {
  binding: CanonicalTranslationConsumptionBinding;
  artifact: BilingualTranslationArtifact;
}

@Injectable()
export class CanonicalTranslationKnowledgeProductService {
  private readonly governance: CanonicalTranslationKnowledgeGovernanceService;

  constructor(
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissionSnapshots: CanonicalPermissionSnapshotPort,
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    @Inject(CANONICAL_HOST_CLOCK)
    private readonly clock: CanonicalHostClockPort,
    private readonly productStore: MiaodaTranslationKnowledgeProductStore,
    ruleSets: HostOwnedV1TranslationRuleSetPrivateProvider,
  ) {
    this.governance = new CanonicalTranslationKnowledgeGovernanceService(
      productStore,
      ruleSets,
    );
  }

  async createCandidates(
    workItemId: string,
    request: CreateCanonicalTranslationKnowledgeCandidatesRequest,
    actor: CanonicalHostActor,
  ): Promise<CreateCanonicalTranslationKnowledgeCandidatesResponse> {
    const authorized: AuthorizedWorkItem = await this.authorizedWorkItem(
      actor,
      workItemId,
      'RECORD_ENGINEER_REVIEW',
    );
    const replayItems: TranslationKnowledgeImportRequestItem[] =
      await this.productStore.readImportRequestItems({
        tenantId: actor.tenantId,
        workItemId,
        requestId: request.requestId,
      });
    if (completeImportReplay(replayItems)) {
      assertImportReplay(replayItems, request);
      const candidates: CanonicalTranslationKnowledgeCandidateSnapshot[] =
        await this.readMappedCandidates(
          authorized.workItem,
          replayItems,
          this.clock.nowIso(),
          actor,
        );
      return importResponse({
        request,
        workItemId,
        candidates,
        createdCount: 0,
        reusedCount: candidates.length,
        replayed: true,
      });
    }
    if (replayItems.length > 0) assertImportReplay(replayItems, request);
    assertExpectedWorkItemRevision(
      authorized.workItem,
      request.expectedWorkItemRevision,
    );
    const context: CurrentTranslationContext =
      await this.currentTranslationContext(authorized.workItem);
    const importedAt: string = this.clock.nowIso();
    const imported = await this.governance.importBilingualCandidates({
      tenantId: actor.tenantId,
      workItemId,
      snapshotWorkItemRevision: authorized.workItem.revision,
      ownerActorId: actor.userId,
      importedByActorId: actor.userId,
      sourceArtifact: authorized.workItem.translation!.artifact,
      artifact: context.artifact,
      currentBinding: context.binding,
      validFrom: request.validFrom,
      expiresAt: request.expiresAt,
      importedAt,
    });
    for (const [sourceUnitOrdinal, unit] of context.artifact.units.entries()) {
      const assetId: string | undefined = imported.assetIds[sourceUnitOrdinal];
      if (assetId === undefined) {
        throw new Error('KNOWLEDGE_IMPORT_ASSET_MAPPING_INCOMPLETE');
      }
      await this.productStore.saveImportRequestItem({
        tenantId: actor.tenantId,
        workItemId,
        requestId: request.requestId,
        snapshotWorkItemRevision: authorized.workItem.revision,
        sourceArtifactSha256: authorized.workItem.translation!.artifact.sha256,
        sourceUnitId: unit.unitId,
        sourceUnitOrdinal,
        expectedUnitCount: context.artifact.units.length,
        assetId,
        validFrom: request.validFrom,
        expiresAt: request.expiresAt,
        createdAt: importedAt,
      });
    }
    const mapped: TranslationKnowledgeImportRequestItem[] =
      await this.productStore.readImportRequestItems({
        tenantId: actor.tenantId,
        workItemId,
        requestId: request.requestId,
      });
    if (!completeImportReplay(mapped)) {
      throw new Error('KNOWLEDGE_IMPORT_REQUEST_READBACK_INCOMPLETE');
    }
    assertImportReplay(mapped, request);
    const fresh: AuthorizedWorkItem = await this.authorizedWorkItem(
      actor,
      workItemId,
      'RECORD_ENGINEER_REVIEW',
    );
    assertExpectedWorkItemRevision(
      fresh.workItem,
      request.expectedWorkItemRevision,
    );
    const candidates: CanonicalTranslationKnowledgeCandidateSnapshot[] =
      await this.readMappedCandidates(
        fresh.workItem,
        mapped,
        importedAt,
        actor,
      );
    return importResponse({
      request,
      workItemId,
      candidates,
      createdCount: imported.createdCount,
      reusedCount: imported.reusedCount,
      replayed: false,
    });
  }

  async readCandidate(
    workItemId: string,
    assetId: string,
    asOf: string,
    actor: CanonicalHostActor,
  ): Promise<CanonicalTranslationKnowledgeCandidateSnapshot> {
    const authorized: AuthorizedWorkItem = await this.authorizedWorkItem(
      actor,
      workItemId,
      'READ_DOCUMENT_PARSING',
    );
    const snapshot: TranslationKnowledgeCandidateSnapshot =
      await this.readGovernedCandidate({
        tenantId: actor.tenantId,
        workItemId,
        currentWorkItemRevision: authorized.workItem.revision,
        assetId,
        asOf,
        currentBinding: currentBinding(authorized.workItem),
      });
    assertCandidateOwner(snapshot, actor);
    return browserSnapshot(snapshot);
  }

  async recordFeedback(
    workItemId: string,
    assetId: string,
    request: RecordCanonicalTranslationKnowledgeFeedbackRequest,
    actor: CanonicalHostActor,
  ): Promise<RecordCanonicalTranslationKnowledgeFeedbackResponse> {
    const authorized: AuthorizedWorkItem = await this.authorizedWorkItem(
      actor,
      workItemId,
      'RECORD_ENGINEER_REVIEW',
    );
    const replay: TranslationKnowledgeGovernanceEvent | null =
      await this.productStore.readEventByRequest({
        tenantId: actor.tenantId,
        workItemId,
        requestId: request.requestId,
      });
    if (replay !== null) {
      assertFeedbackReplay(replay, assetId, request, actor);
      const snapshot: CanonicalTranslationKnowledgeCandidateSnapshot =
        await this.readCandidate(
          workItemId,
          assetId,
          this.clock.nowIso(),
          actor,
        );
      return {
        receipt: adoptionReceipt(replay, true),
        candidate: snapshot,
      };
    }
    assertExpectedWorkItemRevision(
      authorized.workItem,
      request.expectedWorkItemRevision,
    );
    const occurredAt: string = this.clock.nowIso();
    const before: TranslationKnowledgeCandidateSnapshot =
      await this.readGovernedCandidate({
        tenantId: actor.tenantId,
        workItemId,
        currentWorkItemRevision: authorized.workItem.revision,
        assetId,
        asOf: occurredAt,
        currentBinding: currentBinding(authorized.workItem),
      });
    assertCandidateOwner(before, actor);
    assertFeedbackEligible(before);
    if (before.governanceRevision !== request.expectedGovernanceRevision) {
      throw conflict('KNOWLEDGE_GOVERNANCE_CAS_CONFLICT');
    }
    const event: TranslationKnowledgeGovernanceEvent = {
      eventId: `TK-EVENT-${randomUUID()}`,
      tenantId: actor.tenantId,
      workItemId,
      snapshotWorkItemRevision: before.candidate.snapshotWorkItemRevision,
      requestId: request.requestId,
      assetId,
      eventType:
        request.decision === 'ADOPTED_AS_CANDIDATE_SUGGESTION'
          ? 'ENGINEER_ADOPTED'
          : 'ENGINEER_REJECTED',
      feedbackDecision: request.decision,
      expectedRevision: request.expectedGovernanceRevision,
      resultingRevision: request.expectedGovernanceRevision + 1,
      actorKind: 'HUMAN',
      actorId: actor.userId,
      reason: request.comment,
      createdAt: occurredAt,
    };
    const persistedEvent: TranslationKnowledgeGovernanceEvent =
      await this.productStore.appendEvent(event);
    const fresh: AuthorizedWorkItem = await this.authorizedWorkItem(
      actor,
      workItemId,
      'RECORD_ENGINEER_REVIEW',
    );
    const after: TranslationKnowledgeCandidateSnapshot =
      await this.readGovernedCandidate({
        tenantId: actor.tenantId,
        workItemId,
        currentWorkItemRevision: fresh.workItem.revision,
        assetId,
        asOf: occurredAt,
        currentBinding: currentBinding(fresh.workItem),
      });
    return {
      receipt: adoptionReceipt(
        persistedEvent,
        persistedEvent.eventId !== event.eventId,
      ),
      candidate: browserSnapshot(after),
    };
  }

  private authorizedWorkItem(
    actor: CanonicalHostActor,
    workItemId: string,
    action: 'READ_DOCUMENT_PARSING' | 'RECORD_ENGINEER_REVIEW',
  ): Promise<AuthorizedWorkItem> {
    return authorizeAndLoadCanonicalWorkItem({
      authorization: this.authorization,
      permissionSnapshots: this.permissionSnapshots,
      registrar: this.registrar,
      actor,
      action,
      workItemId,
    });
  }

  private async currentTranslationContext(
    workItem: CanonicalWorkItemProjection,
  ): Promise<CurrentTranslationContext> {
    const binding: CanonicalTranslationConsumptionBinding | null =
      currentBinding(workItem);
    if (binding === null || !workItem.translation) {
      throw conflict('KNOWLEDGE_CURRENT_TRANSLATION_REQUIRED');
    }
    const bytes: Uint8Array = await this.artifactStore.readActualBytes(
      workItem.translation.artifact,
    );
    const artifact: BilingualTranslationArtifact =
      parseBilingualTranslationArtifact(bytes);
    assertTranslationProjectionArtifact(workItem, artifact);
    return {
      binding,
      artifact,
    };
  }

  private async readMappedCandidates(
    workItem: CanonicalWorkItemProjection,
    items: readonly TranslationKnowledgeImportRequestItem[],
    asOf: string,
    actor: CanonicalHostActor,
  ): Promise<CanonicalTranslationKnowledgeCandidateSnapshot[]> {
    const candidates: CanonicalTranslationKnowledgeCandidateSnapshot[] = [];
    for (const item of items) {
      const snapshot: TranslationKnowledgeCandidateSnapshot =
        await this.readGovernedCandidate({
          tenantId: actor.tenantId,
          workItemId: workItem.workItemId,
          currentWorkItemRevision: workItem.revision,
          assetId: item.assetId,
          asOf,
          currentBinding: currentBinding(workItem),
        });
      assertCandidateOwner(snapshot, actor);
      candidates.push(browserSnapshot(snapshot));
    }
    return candidates;
  }

  private async readGovernedCandidate(
    input: ReadTranslationKnowledgeCandidateInput,
  ): Promise<TranslationKnowledgeCandidateSnapshot> {
    try {
      return await this.governance.readCandidate(input);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'KNOWLEDGE_CANDIDATE_NOT_FOUND'
      ) {
        throw notFound();
      }
      throw error;
    }
  }
}

function assertTranslationProjectionArtifact(
  workItem: CanonicalWorkItemProjection,
  artifact: BilingualTranslationArtifact,
): void {
  const translation = workItem.translation;
  if (
    translation === null ||
    translation === undefined ||
    artifact.execution.actionAttemptId !== translation.actionAttemptId ||
    artifact.ruleSet.ruleSetId !== translation.ruleSetId ||
    artifact.ruleSet.ruleSetVersion !== translation.ruleSetVersion ||
    artifact.ruleSet.sourceLocale !== translation.sourceLocale ||
    artifact.ruleSet.targetLocale !== translation.targetLocale ||
    artifact.units.length !== translation.sourceUnitCount ||
    artifact.units.length !== translation.translatedUnitCount ||
    translation.pendingTranslationUnitCount !== 0 ||
    artifact.units.filter((unit) => unit.engineerRevisionId !== null).length !==
      translation.engineerRevisionCount ||
    artifact.validation.verdict !== translation.validationVerdict ||
    artifact.validation.findings.length !== translation.validationFindingCount
  ) {
    throw conflict('KNOWLEDGE_TRANSLATION_PROJECTION_DRIFT');
  }
}

function currentBinding(
  workItem: CanonicalWorkItemProjection,
): CanonicalTranslationConsumptionBinding | null {
  const translation = workItem.translation;
  const sourcePackage = workItem.package;
  if (
    !translation ||
    !sourcePackage ||
    translation.status !== 'CANDIDATE_ONLY' ||
    translation.currentness !== 'CURRENT' ||
    translation.validationVerdict !== 'ACCEPTED' ||
    translation.documentId !== workItem.source.documentId ||
    translation.documentVersionId !== workItem.source.documentVersionId ||
    translation.sourcePackageId !== sourcePackage.packageId ||
    translation.sourcePackageContentHash !== sourcePackage.contentHash
  ) {
    return null;
  }
  return {
    documentId: workItem.source.documentId,
    revisionId: workItem.source.documentVersionId,
    sbdPackageId: sourcePackage.packageId,
    sbdContentHash: sourcePackage.contentHash,
    tcpPackageId: null,
    tcpContentHash: null,
  };
}

function browserSnapshot(
  snapshot: TranslationKnowledgeCandidateSnapshot,
): CanonicalTranslationKnowledgeCandidateSnapshot {
  const latestFeedback: TranslationKnowledgeGovernanceEvent | undefined = [
    ...snapshot.events,
  ]
    .reverse()
    .find(
      (event: TranslationKnowledgeGovernanceEvent) =>
        event.eventType === 'ENGINEER_ADOPTED' ||
        event.eventType === 'ENGINEER_REJECTED',
    );
  return {
    schemaVersion: SNAPSHOT_SCHEMA,
    assetId: snapshot.candidate.assetId,
    workItemId: snapshot.candidate.workItemId,
    snapshotWorkItemRevision: snapshot.candidate.snapshotWorkItemRevision,
    governanceRevision: snapshot.governanceRevision,
    knowledgeKind: 'TRANSLATION_MEMORY',
    usagePolicy: 'SUGGESTION_ONLY',
    unit: {
      unitId: snapshot.candidate.unit.unitId,
      kind: snapshot.candidate.unit.kind,
      sourceText: snapshot.candidate.unit.sourceText,
      translatedText: snapshot.candidate.unit.translatedText,
      sourceRefIds: [...snapshot.candidate.unit.sourceRefIds],
      engineerRevisionId: snapshot.candidate.unit.engineerRevisionId,
    },
    ruleSet: structuredClone(snapshot.candidate.ruleSet),
    validFrom: snapshot.candidate.validFrom,
    expiresAt: snapshot.candidate.expiresAt,
    confirmationStatus: snapshot.confirmationStatus,
    validityStatus: snapshot.validityStatus,
    sourceCurrentness: snapshot.sourceCurrentness,
    retrievalEligibility: snapshot.retrievalEligibility,
    latestFeedback:
      latestFeedback?.feedbackDecision === null || latestFeedback === undefined
        ? null
        : {
            decision: latestFeedback.feedbackDecision,
            comment: latestFeedback.reason,
            occurredAt: latestFeedback.createdAt,
          },
    authority: AUTHORITY,
  };
}

function importResponse(input: {
  request: CreateCanonicalTranslationKnowledgeCandidatesRequest;
  workItemId: string;
  candidates: CanonicalTranslationKnowledgeCandidateSnapshot[];
  createdCount: number;
  reusedCount: number;
  replayed: boolean;
}): CreateCanonicalTranslationKnowledgeCandidatesResponse {
  return {
    schemaVersion: IMPORT_RECEIPT_SCHEMA,
    status: 'CANDIDATE_SNAPSHOTS_READY',
    requestId: input.request.requestId,
    workItemId: input.workItemId,
    snapshotWorkItemRevision: input.request.expectedWorkItemRevision,
    createdCount: input.createdCount,
    reusedCount: input.reusedCount,
    replayed: input.replayed,
    candidates: input.candidates,
    authority: AUTHORITY,
  };
}

function adoptionReceipt(
  event: TranslationKnowledgeGovernanceEvent,
  replayed: boolean,
): CanonicalTranslationKnowledgeAdoptionReceipt {
  if (event.requestId === null || event.feedbackDecision === null) {
    throw new Error('KNOWLEDGE_FEEDBACK_RECEIPT_INVALID');
  }
  return {
    schemaVersion: ADOPTION_RECEIPT_SCHEMA,
    receiptId: event.eventId,
    requestId: event.requestId,
    workItemId: event.workItemId,
    assetId: event.assetId,
    snapshotWorkItemRevision: event.snapshotWorkItemRevision,
    expectedGovernanceRevision: event.expectedRevision,
    resultingGovernanceRevision: event.resultingRevision,
    decision: event.feedbackDecision,
    comment: event.reason,
    occurredAt: event.createdAt,
    replayed,
    learningEventRecorded: true,
    candidateSuggestionAdopted:
      event.feedbackDecision === 'ADOPTED_AS_CANDIDATE_SUGGESTION',
    authority: AUTHORITY,
  };
}

function assertFeedbackEligible(
  snapshot: TranslationKnowledgeCandidateSnapshot,
): void {
  if (snapshot.validityStatus === 'NOT_YET_VALID') {
    throw conflict('KNOWLEDGE_CANDIDATE_NOT_YET_VALID');
  }
  if (snapshot.validityStatus === 'EXPIRED') {
    throw conflict('KNOWLEDGE_CANDIDATE_EXPIRED');
  }
  if (snapshot.validityStatus !== 'CURRENT') {
    throw conflict('KNOWLEDGE_CANDIDATE_NOT_CURRENT');
  }
  if (snapshot.sourceCurrentness !== 'CURRENT') {
    throw conflict('KNOWLEDGE_SOURCE_NOT_CURRENT');
  }
}

function assertCandidateOwner(
  snapshot: TranslationKnowledgeCandidateSnapshot,
  actor: CanonicalHostActor,
): void {
  if (
    snapshot.candidate.tenantId !== actor.tenantId ||
    snapshot.candidate.ownerActorId !== actor.userId
  ) {
    throw notFound();
  }
}

function assertExpectedWorkItemRevision(
  workItem: CanonicalWorkItemProjection,
  expectedRevision: number,
): void {
  if (workItem.revision !== expectedRevision) {
    throw conflict('KNOWLEDGE_WORK_ITEM_CAS_CONFLICT');
  }
}

function completeImportReplay(
  items: readonly TranslationKnowledgeImportRequestItem[],
): boolean {
  return items.length > 0 && items.length === items[0]?.expectedUnitCount;
}

function assertImportReplay(
  items: readonly TranslationKnowledgeImportRequestItem[],
  request: CreateCanonicalTranslationKnowledgeCandidatesRequest,
): void {
  const valid: boolean =
    items.length > 0 &&
    items.every(
      (item: TranslationKnowledgeImportRequestItem) =>
        item.requestId === request.requestId &&
        item.snapshotWorkItemRevision === request.expectedWorkItemRevision &&
        item.validFrom === request.validFrom &&
        item.expiresAt === request.expiresAt &&
        item.expectedUnitCount === items[0]?.expectedUnitCount,
    );
  if (!valid) throw conflict('KNOWLEDGE_IMPORT_REQUEST_ID_CONFLICT');
}

function assertFeedbackReplay(
  event: TranslationKnowledgeGovernanceEvent,
  assetId: string,
  request: RecordCanonicalTranslationKnowledgeFeedbackRequest,
  actor: CanonicalHostActor,
): void {
  if (
    event.assetId !== assetId ||
    event.snapshotWorkItemRevision !== request.expectedWorkItemRevision ||
    event.expectedRevision !== request.expectedGovernanceRevision ||
    event.feedbackDecision !== request.decision ||
    event.reason !== request.comment ||
    event.actorKind !== 'HUMAN' ||
    event.actorId !== actor.userId
  ) {
    throw conflict('KNOWLEDGE_REQUEST_ID_CONFLICT');
  }
}

function conflict(code: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}

function notFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('KNOWLEDGE_CANDIDATE_NOT_FOUND'), {
    code: 'KNOWLEDGE_CANDIDATE_NOT_FOUND',
    statusCode: 404,
  });
}
