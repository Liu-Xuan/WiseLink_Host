import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, eq } from 'drizzle-orm';

import type { CanonicalTranslationKnowledgeFeedbackDecision } from '@shared/api.interface';
import {
  translationKnowledgeCandidate,
  translationKnowledgeGovernanceEvent,
  translationKnowledgeImportRequestItem,
  translationKnowledgeSourceRef,
} from './canonical-translation-knowledge-governance.schema';
import {
  TRANSLATION_KNOWLEDGE_CANDIDATE_SCHEMA,
  type SaveTranslationKnowledgeCandidateResult,
  type TranslationKnowledgeAggregate,
  type TranslationKnowledgeCandidateRecord,
  type TranslationKnowledgeGovernanceEvent,
  type TranslationKnowledgeGovernanceActorKind,
  type TranslationKnowledgeGovernanceEventType,
  type TranslationKnowledgeImportRequestItem,
  type TranslationKnowledgeProductStore,
} from './canonical-translation-knowledge-governance.types';

type CandidateRow = typeof translationKnowledgeCandidate.$inferSelect;
type EventRow = typeof translationKnowledgeGovernanceEvent.$inferSelect;
type ImportRequestRow =
  typeof translationKnowledgeImportRequestItem.$inferSelect;

@Injectable()
export class MiaodaTranslationKnowledgeProductStore implements TranslationKnowledgeProductStore {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async saveCandidate(
    candidate: TranslationKnowledgeCandidateRecord,
  ): Promise<SaveTranslationKnowledgeCandidateResult> {
    let inserted: Array<{ assetId: string }>;
    try {
      inserted = await this.db
        .insert(translationKnowledgeCandidate)
        .values(candidateValues(candidate))
        .onConflictDoNothing()
        .returning({ assetId: translationKnowledgeCandidate.assetId });
    } catch (error) {
      throw normalizedPersistenceError(error);
    }
    const row: CandidateRow | undefined = await this.readCandidateRow({
      tenantId: candidate.tenantId,
      workItemId: candidate.workItemId,
      snapshotWorkItemRevision: candidate.snapshotWorkItemRevision,
      sourceArtifactSha256: candidate.sourceArtifact.sha256,
      sourceUnitId: candidate.unit.unitId,
    });
    if (row === undefined) {
      throw new Error('KNOWLEDGE_CANDIDATE_READBACK_FAILED');
    }
    assertCandidateReplay(row, candidate);
    await this.saveSourceRefs(candidate, row.assetId);
    const stored: TranslationKnowledgeCandidateRecord =
      await this.candidateFromRow(row);
    if (
      JSON.stringify(stored.unit.sourceRefIds) !==
      JSON.stringify(candidate.unit.sourceRefIds)
    ) {
      throw conflict('KNOWLEDGE_CANDIDATE_DEDUPE_CONFLICT');
    }
    return {
      candidate: stored,
      disposition: inserted.length === 1 ? 'CREATED' : 'REUSED',
    };
  }

  async readAggregate(
    tenantId: string,
    workItemId: string,
    assetId: string,
  ): Promise<TranslationKnowledgeAggregate | null> {
    const rows: CandidateRow[] = await this.db
      .select()
      .from(translationKnowledgeCandidate)
      .where(
        and(
          eq(translationKnowledgeCandidate.tenantId, tenantId),
          eq(translationKnowledgeCandidate.workItemId, workItemId),
          eq(translationKnowledgeCandidate.assetId, assetId),
        ),
      )
      .limit(1);
    const row: CandidateRow | undefined = rows[0];
    if (row === undefined) return null;
    const eventRows: EventRow[] = await this.db
      .select()
      .from(translationKnowledgeGovernanceEvent)
      .where(
        and(
          eq(translationKnowledgeGovernanceEvent.tenantId, tenantId),
          eq(translationKnowledgeGovernanceEvent.workItemId, workItemId),
          eq(translationKnowledgeGovernanceEvent.assetId, assetId),
        ),
      )
      .orderBy(asc(translationKnowledgeGovernanceEvent.resultingRevision));
    return {
      candidate: await this.candidateFromRow(row),
      events: eventRows.map(eventFromRow),
    };
  }

  async appendEvent(
    event: TranslationKnowledgeGovernanceEvent,
  ): Promise<TranslationKnowledgeGovernanceEvent> {
    let inserted: Array<{ eventId: string }>;
    try {
      inserted = await this.db
        .insert(translationKnowledgeGovernanceEvent)
        .values(eventValues(event))
        .onConflictDoNothing()
        .returning({ eventId: translationKnowledgeGovernanceEvent.eventId });
    } catch (error) {
      throw normalizedPersistenceError(error);
    }
    if (inserted.length === 1) return structuredClone(event);
    const replay: TranslationKnowledgeGovernanceEvent | null = event.requestId
      ? await this.readEventByRequest({
          tenantId: event.tenantId,
          workItemId: event.workItemId,
          requestId: event.requestId,
        })
      : await this.readEventById(event);
    if (
      replay !== null &&
      (event.requestId === null
        ? sameEvent(replay, event)
        : sameFeedbackRequest(replay, event))
    ) {
      return replay;
    }
    if (replay !== null) throw conflict('KNOWLEDGE_REQUEST_ID_CONFLICT');
    throw conflict('KNOWLEDGE_GOVERNANCE_CAS_CONFLICT');
  }

  async saveImportRequestItem(
    item: TranslationKnowledgeImportRequestItem,
  ): Promise<void> {
    let inserted: Array<{ assetId: string }>;
    try {
      inserted = await this.db
        .insert(translationKnowledgeImportRequestItem)
        .values(importRequestValues(item))
        .onConflictDoNothing()
        .returning({ assetId: translationKnowledgeImportRequestItem.assetId });
    } catch (error) {
      throw normalizedPersistenceError(error);
    }
    if (inserted.length === 1) return;
    const rows: ImportRequestRow[] = await this.db
      .select()
      .from(translationKnowledgeImportRequestItem)
      .where(
        and(
          eq(translationKnowledgeImportRequestItem.tenantId, item.tenantId),
          eq(translationKnowledgeImportRequestItem.workItemId, item.workItemId),
          eq(translationKnowledgeImportRequestItem.requestId, item.requestId),
          eq(
            translationKnowledgeImportRequestItem.sourceUnitId,
            item.sourceUnitId,
          ),
        ),
      )
      .limit(1);
    const replay: TranslationKnowledgeImportRequestItem | null = rows[0]
      ? importRequestFromRow(rows[0])
      : null;
    if (replay !== null && sameImportRequestItem(replay, item)) return;
    throw conflict('KNOWLEDGE_IMPORT_REQUEST_ID_CONFLICT');
  }

  async readImportRequestItems(input: {
    tenantId: string;
    workItemId: string;
    requestId: string;
  }): Promise<TranslationKnowledgeImportRequestItem[]> {
    const rows: ImportRequestRow[] = await this.db
      .select()
      .from(translationKnowledgeImportRequestItem)
      .where(
        and(
          eq(translationKnowledgeImportRequestItem.tenantId, input.tenantId),
          eq(
            translationKnowledgeImportRequestItem.workItemId,
            input.workItemId,
          ),
          eq(translationKnowledgeImportRequestItem.requestId, input.requestId),
        ),
      )
      .orderBy(asc(translationKnowledgeImportRequestItem.sourceUnitOrdinal));
    return rows.map(importRequestFromRow);
  }

  async readEventByRequest(input: {
    tenantId: string;
    workItemId: string;
    requestId: string;
  }): Promise<TranslationKnowledgeGovernanceEvent | null> {
    const rows: EventRow[] = await this.db
      .select()
      .from(translationKnowledgeGovernanceEvent)
      .where(
        and(
          eq(translationKnowledgeGovernanceEvent.tenantId, input.tenantId),
          eq(translationKnowledgeGovernanceEvent.workItemId, input.workItemId),
          eq(translationKnowledgeGovernanceEvent.requestId, input.requestId),
        ),
      )
      .limit(1);
    return rows[0] ? eventFromRow(rows[0]) : null;
  }

  private async readCandidateRow(input: {
    tenantId: string;
    workItemId: string;
    snapshotWorkItemRevision: number;
    sourceArtifactSha256: string;
    sourceUnitId: string;
  }): Promise<CandidateRow | undefined> {
    const rows: CandidateRow[] = await this.db
      .select()
      .from(translationKnowledgeCandidate)
      .where(
        and(
          eq(translationKnowledgeCandidate.tenantId, input.tenantId),
          eq(translationKnowledgeCandidate.workItemId, input.workItemId),
          eq(
            translationKnowledgeCandidate.snapshotWorkItemRevision,
            input.snapshotWorkItemRevision,
          ),
          eq(
            translationKnowledgeCandidate.sourceArtifactSha256,
            input.sourceArtifactSha256,
          ),
          eq(translationKnowledgeCandidate.sourceUnitId, input.sourceUnitId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  private async saveSourceRefs(
    candidate: TranslationKnowledgeCandidateRecord,
    assetId: string,
  ): Promise<void> {
    try {
      await this.db
        .insert(translationKnowledgeSourceRef)
        .values(
          candidate.unit.sourceRefIds.map(
            (sourceRefId: string, sourceRefOrdinal: number) => ({
              tenantId: candidate.tenantId,
              workItemId: candidate.workItemId,
              assetId,
              sourceRefId,
              sourceRefOrdinal,
            }),
          ),
        )
        .onConflictDoNothing();
    } catch (error) {
      throw normalizedPersistenceError(error);
    }
  }

  private async candidateFromRow(
    row: CandidateRow,
  ): Promise<TranslationKnowledgeCandidateRecord> {
    assertCandidateRow(row);
    const refs: Array<{ sourceRefId: string; sourceRefOrdinal: number }> =
      await this.db
        .select({
          sourceRefId: translationKnowledgeSourceRef.sourceRefId,
          sourceRefOrdinal: translationKnowledgeSourceRef.sourceRefOrdinal,
        })
        .from(translationKnowledgeSourceRef)
        .where(
          and(
            eq(translationKnowledgeSourceRef.tenantId, row.tenantId),
            eq(translationKnowledgeSourceRef.workItemId, row.workItemId),
            eq(translationKnowledgeSourceRef.assetId, row.assetId),
          ),
        )
        .orderBy(asc(translationKnowledgeSourceRef.sourceRefOrdinal));
    if (refs.length !== row.sourceRefCount) {
      throw new Error('KNOWLEDGE_SOURCE_REF_READBACK_INCOMPLETE');
    }
    return candidateFromRow(
      row,
      refs.map(
        (ref: { sourceRefId: string; sourceRefOrdinal: number }) =>
          ref.sourceRefId,
      ),
    );
  }

  private async readEventById(
    event: TranslationKnowledgeGovernanceEvent,
  ): Promise<TranslationKnowledgeGovernanceEvent | null> {
    const rows: EventRow[] = await this.db
      .select()
      .from(translationKnowledgeGovernanceEvent)
      .where(
        and(
          eq(translationKnowledgeGovernanceEvent.tenantId, event.tenantId),
          eq(translationKnowledgeGovernanceEvent.workItemId, event.workItemId),
          eq(translationKnowledgeGovernanceEvent.eventId, event.eventId),
        ),
      )
      .limit(1);
    return rows[0] ? eventFromRow(rows[0]) : null;
  }
}

function candidateValues(candidate: TranslationKnowledgeCandidateRecord) {
  return {
    tenantId: candidate.tenantId,
    workItemId: candidate.workItemId,
    snapshotWorkItemRevision: candidate.snapshotWorkItemRevision,
    assetId: candidate.assetId,
    knowledgeKind: candidate.knowledgeKind,
    candidateOnly: candidate.candidateOnly,
    usagePolicy: candidate.usagePolicy,
    ownerActorId: candidate.ownerActorId,
    importedByActorId: candidate.importedByActorId,
    sourceArtifactRef: candidate.sourceArtifact.ref,
    sourceArtifactSha256: candidate.sourceArtifact.sha256,
    sourceDocumentId: candidate.sourceBinding.documentId,
    sourceRevisionId: candidate.sourceBinding.revisionId,
    sourceSbdPackageId: candidate.sourceBinding.sbdPackageId,
    sourceSbdContentHash: candidate.sourceBinding.sbdContentHash,
    sourceTcpPackageId: candidate.sourceBinding.tcpPackageId,
    sourceTcpContentHash: candidate.sourceBinding.tcpContentHash,
    actionAttemptId: candidate.translationExecution.actionAttemptId,
    resultContentHash: candidate.translationExecution.resultContentHash,
    modelVersion: candidate.translationExecution.modelVersion,
    promptVersion: candidate.translationExecution.promptVersion,
    skillVersion: candidate.translationExecution.skillVersion,
    ruleSetId: candidate.ruleSet.ruleSetId,
    ruleSetVersion: candidate.ruleSet.ruleSetVersion,
    sourceLocale: candidate.ruleSet.sourceLocale,
    targetLocale: candidate.ruleSet.targetLocale,
    sourceUnitId: candidate.unit.unitId,
    sourceUnitKind: candidate.unit.kind,
    sourceUnitCount: candidate.unit.sourceUnitCount,
    sourceRefCount: candidate.unit.sourceRefIds.length,
    sourceText: candidate.unit.sourceText,
    translatedText: candidate.unit.translatedText,
    engineerRevisionId: candidate.unit.engineerRevisionId,
    validFrom: new Date(candidate.validFrom),
    expiresAt: new Date(candidate.expiresAt),
    createdAt: new Date(candidate.createdAt),
  };
}

function eventValues(event: TranslationKnowledgeGovernanceEvent) {
  return {
    tenantId: event.tenantId,
    workItemId: event.workItemId,
    snapshotWorkItemRevision: event.snapshotWorkItemRevision,
    eventId: event.eventId,
    requestId: event.requestId,
    assetId: event.assetId,
    eventType: event.eventType,
    feedbackDecision: event.feedbackDecision,
    expectedRevision: event.expectedRevision,
    resultingRevision: event.resultingRevision,
    actorKind: event.actorKind,
    actorId: event.actorId,
    reason: event.reason,
    createdAt: new Date(event.createdAt),
  };
}

function importRequestValues(item: TranslationKnowledgeImportRequestItem) {
  return {
    tenantId: item.tenantId,
    workItemId: item.workItemId,
    requestId: item.requestId,
    snapshotWorkItemRevision: item.snapshotWorkItemRevision,
    sourceArtifactSha256: item.sourceArtifactSha256,
    sourceUnitId: item.sourceUnitId,
    sourceUnitOrdinal: item.sourceUnitOrdinal,
    expectedUnitCount: item.expectedUnitCount,
    assetId: item.assetId,
    validFrom: new Date(item.validFrom),
    expiresAt: new Date(item.expiresAt),
    createdAt: new Date(item.createdAt),
  };
}

function candidateFromRow(
  row: CandidateRow,
  sourceRefIds: string[],
): TranslationKnowledgeCandidateRecord {
  return {
    schemaVersion: TRANSLATION_KNOWLEDGE_CANDIDATE_SCHEMA,
    assetId: row.assetId,
    tenantId: row.tenantId,
    workItemId: row.workItemId,
    snapshotWorkItemRevision: row.snapshotWorkItemRevision,
    knowledgeKind: 'TRANSLATION_MEMORY',
    candidateOnly: true,
    usagePolicy: 'SUGGESTION_ONLY',
    ownerActorId: row.ownerActorId,
    importedByActorId: row.importedByActorId,
    sourceArtifact: {
      ref: row.sourceArtifactRef,
      sha256: row.sourceArtifactSha256,
    },
    sourceBinding: {
      documentId: row.sourceDocumentId,
      revisionId: row.sourceRevisionId,
      sbdPackageId: row.sourceSbdPackageId,
      sbdContentHash: row.sourceSbdContentHash,
      tcpPackageId: row.sourceTcpPackageId,
      tcpContentHash: row.sourceTcpContentHash,
    },
    translationExecution: {
      actionAttemptId: row.actionAttemptId,
      resultContentHash: row.resultContentHash,
      modelVersion: row.modelVersion,
      promptVersion: row.promptVersion,
      skillVersion: row.skillVersion,
    },
    ruleSet: {
      ruleSetId: row.ruleSetId,
      ruleSetVersion: row.ruleSetVersion,
      sourceLocale: row.sourceLocale,
      targetLocale: row.targetLocale,
    },
    unit: {
      unitId: row.sourceUnitId,
      kind: row.sourceUnitKind,
      sourceUnitCount: row.sourceUnitCount,
      sourceText: row.sourceText,
      translatedText: row.translatedText,
      sourceRefIds,
      engineerRevisionId: row.engineerRevisionId,
    },
    validFrom: row.validFrom.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function eventFromRow(row: EventRow): TranslationKnowledgeGovernanceEvent {
  return {
    eventId: row.eventId,
    tenantId: row.tenantId,
    workItemId: row.workItemId,
    snapshotWorkItemRevision: row.snapshotWorkItemRevision,
    requestId: row.requestId,
    assetId: row.assetId,
    eventType: eventType(row.eventType),
    feedbackDecision: feedbackDecision(row.feedbackDecision),
    expectedRevision: row.expectedRevision,
    resultingRevision: row.resultingRevision,
    actorKind: actorKind(row.actorKind),
    actorId: row.actorId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

function importRequestFromRow(
  row: ImportRequestRow,
): TranslationKnowledgeImportRequestItem {
  return {
    tenantId: row.tenantId,
    workItemId: row.workItemId,
    requestId: row.requestId,
    snapshotWorkItemRevision: row.snapshotWorkItemRevision,
    sourceArtifactSha256: row.sourceArtifactSha256,
    sourceUnitId: row.sourceUnitId,
    sourceUnitOrdinal: row.sourceUnitOrdinal,
    expectedUnitCount: row.expectedUnitCount,
    assetId: row.assetId,
    validFrom: row.validFrom.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function assertCandidateRow(row: CandidateRow): void {
  if (
    row.knowledgeKind !== 'TRANSLATION_MEMORY' ||
    row.candidateOnly !== true ||
    row.usagePolicy !== 'SUGGESTION_ONLY'
  ) {
    throw new Error('KNOWLEDGE_CANDIDATE_ROW_AUTHORITY_INVALID');
  }
}

function assertCandidateReplay(
  row: CandidateRow,
  candidate: TranslationKnowledgeCandidateRecord,
): void {
  assertCandidateRow(row);
  const expected = candidateValues(candidate);
  const matches: boolean =
    row.tenantId === expected.tenantId &&
    row.workItemId === expected.workItemId &&
    row.snapshotWorkItemRevision === expected.snapshotWorkItemRevision &&
    row.ownerActorId === expected.ownerActorId &&
    row.importedByActorId === expected.importedByActorId &&
    row.sourceArtifactRef === expected.sourceArtifactRef &&
    row.sourceArtifactSha256 === expected.sourceArtifactSha256 &&
    row.sourceDocumentId === expected.sourceDocumentId &&
    row.sourceRevisionId === expected.sourceRevisionId &&
    row.sourceSbdPackageId === expected.sourceSbdPackageId &&
    row.sourceSbdContentHash === expected.sourceSbdContentHash &&
    row.sourceTcpPackageId === expected.sourceTcpPackageId &&
    row.sourceTcpContentHash === expected.sourceTcpContentHash &&
    row.actionAttemptId === expected.actionAttemptId &&
    row.resultContentHash === expected.resultContentHash &&
    row.modelVersion === expected.modelVersion &&
    row.promptVersion === expected.promptVersion &&
    row.skillVersion === expected.skillVersion &&
    row.ruleSetId === expected.ruleSetId &&
    row.ruleSetVersion === expected.ruleSetVersion &&
    row.sourceLocale === expected.sourceLocale &&
    row.targetLocale === expected.targetLocale &&
    row.sourceUnitId === expected.sourceUnitId &&
    row.sourceUnitKind === expected.sourceUnitKind &&
    row.sourceUnitCount === expected.sourceUnitCount &&
    row.sourceRefCount === expected.sourceRefCount &&
    row.sourceText === expected.sourceText &&
    row.translatedText === expected.translatedText &&
    row.engineerRevisionId === expected.engineerRevisionId &&
    row.validFrom.getTime() === expected.validFrom.getTime() &&
    row.expiresAt.getTime() === expected.expiresAt.getTime();
  if (!matches) throw conflict('KNOWLEDGE_CANDIDATE_DEDUPE_CONFLICT');
}

function eventType(value: string): TranslationKnowledgeGovernanceEventType {
  if (
    value === 'HUMAN_CONFIRMED' ||
    value === 'INVALIDATED' ||
    value === 'ENGINEER_ADOPTED' ||
    value === 'ENGINEER_REJECTED'
  ) {
    return value;
  }
  throw new Error('KNOWLEDGE_EVENT_TYPE_INVALID');
}

function actorKind(value: string): TranslationKnowledgeGovernanceActorKind {
  if (value === 'HUMAN' || value === 'SYSTEM') {
    return value;
  }
  throw new Error('KNOWLEDGE_EVENT_ACTOR_INVALID');
}

function feedbackDecision(
  value: string | null,
): CanonicalTranslationKnowledgeFeedbackDecision | null {
  if (value === null) return null;
  if (value === 'ADOPTED_AS_CANDIDATE_SUGGESTION') {
    return 'ADOPTED_AS_CANDIDATE_SUGGESTION';
  }
  if (value === 'REJECTED') return 'REJECTED';
  throw new Error('KNOWLEDGE_FEEDBACK_DECISION_INVALID');
}

function sameEvent(
  left: TranslationKnowledgeGovernanceEvent,
  right: TranslationKnowledgeGovernanceEvent,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameImportRequestItem(
  left: TranslationKnowledgeImportRequestItem,
  right: TranslationKnowledgeImportRequestItem,
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.workItemId === right.workItemId &&
    left.requestId === right.requestId &&
    left.snapshotWorkItemRevision === right.snapshotWorkItemRevision &&
    left.sourceArtifactSha256 === right.sourceArtifactSha256 &&
    left.sourceUnitId === right.sourceUnitId &&
    left.sourceUnitOrdinal === right.sourceUnitOrdinal &&
    left.expectedUnitCount === right.expectedUnitCount &&
    left.assetId === right.assetId &&
    left.validFrom === right.validFrom &&
    left.expiresAt === right.expiresAt
  );
}

function sameFeedbackRequest(
  left: TranslationKnowledgeGovernanceEvent,
  right: TranslationKnowledgeGovernanceEvent,
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.workItemId === right.workItemId &&
    left.snapshotWorkItemRevision === right.snapshotWorkItemRevision &&
    left.requestId === right.requestId &&
    left.assetId === right.assetId &&
    left.eventType === right.eventType &&
    left.feedbackDecision === right.feedbackDecision &&
    left.expectedRevision === right.expectedRevision &&
    left.resultingRevision === right.resultingRevision &&
    left.actorKind === right.actorKind &&
    left.actorId === right.actorId &&
    left.reason === right.reason
  );
}

function normalizedPersistenceError(error: unknown): Error {
  if (
    errorChainContains(error, 'TRANSLATION_KNOWLEDGE_WORK_ITEM_CAS_CONFLICT')
  ) {
    return conflict('KNOWLEDGE_WORK_ITEM_CAS_CONFLICT');
  }
  if (
    errorChainContains(
      error,
      'TRANSLATION_KNOWLEDGE_ACTION_ATTEMPT_SCOPE_CONFLICT',
    )
  ) {
    return conflict('KNOWLEDGE_ACTION_ATTEMPT_SCOPE_CONFLICT');
  }
  return error instanceof Error ? error : new Error(String(error));
}

function errorChainContains(error: unknown, expected: string): boolean {
  const seen: Set<unknown> = new Set<unknown>();
  let current: unknown = error;
  while (
    current !== null &&
    typeof current === 'object' &&
    !seen.has(current)
  ) {
    seen.add(current);
    if (current instanceof Error && current.message.includes(expected)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function conflict(code: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
