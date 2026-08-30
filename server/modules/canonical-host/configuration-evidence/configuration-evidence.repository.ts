import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq } from 'drizzle-orm';

import type {
  CanonicalConfigurationEvidenceCurrentProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  configurationEvidenceEventVersion,
  configurationEvidenceFactVersion,
  configurationEvidencePredicateTraceVersion,
  configurationEvidenceSnapshotVersion,
  configurationEvidenceTraceStaleness,
  configurationEvidenceWorkItemHead,
  workItem,
} from '../../../database/schema';
import { markDependentConfigurationPredicateTracesStale } from './configuration-predicate-trace.staleness';
import { configurationTargetKey } from './configuration-snapshot.mapper';
import type {
  ConfigurationPredicateTrace,
  ConfigurationPredicateTraceStaleReason,
  ConfigurationSnapshot,
  ConfigurationSnapshotFact,
} from './configuration-snapshot.types';
import type {
  CommitConfigurationEvidenceInput,
  CommitConfigurationEvidenceResult,
  ConfigurationEvidenceReplayRead,
  ConfigurationEvidenceSnapshotSummary,
  ConfigurationEvidenceStorePort,
  ConfigurationEvidenceTruthSummary,
  PersistedConfigurationEvidenceSnapshot,
  ResolvedConfigurationEvidenceRequest,
} from './configuration-evidence.persistence.types';
import type {
  ConfigEventEvidenceProjection,
  InstallationEvidenceRecordProjection,
} from './installation-event-evidence.types';

type DatabaseExecutor = PostgresJsDatabase;
type SnapshotRow = typeof configurationEvidenceSnapshotVersion.$inferSelect;
type HeadRow = typeof configurationEvidenceWorkItemHead.$inferSelect;

interface PendingStaleness {
  priorSnapshotId: string;
  predicateTraceId: string;
  reason: ConfigurationPredicateTraceStaleReason;
}

@Injectable()
export class MiaodaConfigurationEvidenceStore implements ConfigurationEvidenceStorePort {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async findByRequest(input: {
    tenantId: string;
    workItemId: string;
    requestId: string;
  }): Promise<ConfigurationEvidenceReplayRead | null> {
    return this.db.transaction(
      async (transaction) => {
        const executor: DatabaseExecutor = transaction as DatabaseExecutor;
        const row: SnapshotRow | null = await findSnapshotByRequest(
          executor,
          input,
        );
        if (!row) return null;
        const workItemProjection = await requiredCurrentWorkItem(
          executor,
          input,
        );
        const head: HeadRow | null = await findHead(executor, input);
        assertCurrentBinding(workItemProjection, head);
        return {
          workItem: workItemProjection,
          persisted: await persistedSnapshot(
            executor,
            row,
            head?.currentSnapshotId ?? null,
          ),
        };
      },
      { accessMode: 'read only', isolationLevel: 'repeatable read' },
    );
  }

  async readCurrent(input: {
    tenantId: string;
    workItemId: string;
  }): Promise<PersistedConfigurationEvidenceSnapshot | null> {
    const head: HeadRow | null = await findHead(this.db, input);
    if (!head) return null;
    const row: SnapshotRow | null = await findSnapshotById(this.db, {
      ...input,
      snapshotId: head.currentSnapshotId,
    });
    if (!row || row.configurationRevision !== head.configurationRevision) {
      throw persistenceUnavailable('CONFIGURATION_EVIDENCE_HEAD_INVALID');
    }
    return persistedSnapshot(this.db, row, head.currentSnapshotId);
  }

  async readSnapshot(input: {
    tenantId: string;
    workItemId: string;
    snapshotId: string;
  }): Promise<PersistedConfigurationEvidenceSnapshot | null> {
    const row: SnapshotRow | null = await findSnapshotById(this.db, input);
    return row ? persistedSnapshot(this.db, row) : null;
  }

  async listHistory(input: {
    tenantId: string;
    workItemId: string;
    limit: number;
  }): Promise<ConfigurationEvidenceSnapshotSummary[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
      throw persistenceUnavailable(
        'CONFIGURATION_EVIDENCE_HISTORY_LIMIT_INVALID',
      );
    }
    const [head, rows]: [HeadRow | null, SnapshotRow[]] = await Promise.all([
      findHead(this.db, input),
      this.db
        .select()
        .from(configurationEvidenceSnapshotVersion)
        .where(
          and(
            eq(configurationEvidenceSnapshotVersion.tenantId, input.tenantId),
            eq(
              configurationEvidenceSnapshotVersion.workItemId,
              input.workItemId,
            ),
          ),
        )
        .orderBy(
          desc(configurationEvidenceSnapshotVersion.configurationRevision),
        )
        .limit(input.limit),
    ]);
    return rows.map((row: SnapshotRow) =>
      summaryFromRow(row, head?.currentSnapshotId ?? null),
    );
  }

  async commit(
    input: CommitConfigurationEvidenceInput,
  ): Promise<CommitConfigurationEvidenceResult> {
    const requestJson: string = JSON.stringify(input.request);
    return this.db.transaction(async (transaction) => {
      const executor: DatabaseExecutor = transaction as DatabaseExecutor;
      const existing: SnapshotRow | null = await findSnapshotByRequest(
        executor,
        {
          tenantId: input.tenantId,
          workItemId: input.workItemId,
          requestId: input.request.requestId,
        },
      );
      if (existing) {
        assertIdempotentRequest(existing, requestJson);
        return replayResult(executor, input, existing);
      }

      const storedWorkItem = await requiredWorkItem(executor, input);
      const head: HeadRow | null = await findHead(executor, input);
      assertCurrentBinding(storedWorkItem, head);
      const configurationRevision: number =
        (head?.configurationRevision ?? 0) + 1;
      const snapshotId: string = configurationSnapshotId(
        input.request.requestId,
      );
      const truthSummary: ConfigurationEvidenceTruthSummary = summarizeTruth(
        input.snapshot,
      );
      const nextWorkItem: CanonicalWorkItemProjection = nextWorkItemProjection({
        current: storedWorkItem,
        snapshotId,
        configurationRevision,
        snapshot: input.snapshot,
        truthSummary,
        recordedAt: input.recordedAt,
      });
      const pendingStaleness: PendingStaleness[] = head
        ? await staleDependencies({
            executor,
            input,
            head,
          })
        : [];

      const updatedRows = await executor
        .update(workItem)
        .set({
          projectionJson: JSON.stringify(nextWorkItem),
          revision: nextWorkItem.revision,
          updatedAt: new Date(input.recordedAt),
        })
        .where(
          and(
            eq(workItem.tenantId, input.tenantId),
            eq(workItem.workItemId, input.workItemId),
            eq(workItem.revision, input.expectedWorkItemRevision),
          ),
        )
        .returning({ workItemId: workItem.workItemId });
      if (updatedRows.length !== 1) {
        const raced: SnapshotRow | null = await findSnapshotByRequest(
          executor,
          {
            tenantId: input.tenantId,
            workItemId: input.workItemId,
            requestId: input.request.requestId,
          },
        );
        if (raced) {
          assertIdempotentRequest(raced, requestJson);
          return replayResult(executor, input, raced);
        }
        throw persistenceConflict('WORK_ITEM_CAS_CONFLICT');
      }

      await persistSnapshot({
        executor,
        input,
        snapshotId,
        configurationRevision,
        truthSummary,
        requestJson,
      });
      await persistStaleness({
        executor,
        input,
        incomingSnapshotId: snapshotId,
        incomingConfigurationRevision: configurationRevision,
        pendingStaleness,
      });
      await moveHead({
        executor,
        input,
        head,
        snapshotId,
        configurationRevision,
      });

      const row: SnapshotRow | null = await findSnapshotById(executor, {
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        snapshotId,
      });
      if (!row) {
        throw persistenceUnavailable(
          'CONFIGURATION_EVIDENCE_SNAPSHOT_READBACK_FAILED',
        );
      }
      return {
        replayed: false,
        workItem: nextWorkItem,
        persisted: await persistedSnapshot(executor, row, snapshotId),
      };
    });
  }
}

async function persistSnapshot(input: {
  executor: DatabaseExecutor;
  input: CommitConfigurationEvidenceInput;
  snapshotId: string;
  configurationRevision: number;
  truthSummary: ConfigurationEvidenceTruthSummary;
  requestJson: string;
}): Promise<void> {
  const persistedAt: Date = new Date(input.input.recordedAt);
  await input.executor.insert(configurationEvidenceSnapshotVersion).values({
    tenantId: input.input.tenantId,
    workItemId: input.input.workItemId,
    snapshotId: input.snapshotId,
    requestId: input.input.request.requestId,
    requestJson: input.requestJson,
    aircraftAssetId: input.input.snapshot.aircraftAssetId,
    assessmentAsOf: new Date(input.input.snapshot.assessmentAsOf),
    configurationRevision: input.configurationRevision,
    workItemRevisionBefore: input.input.expectedWorkItemRevision,
    workItemRevisionAfter: input.input.expectedWorkItemRevision + 1,
    sourceCompleteness: input.input.snapshot.coverage.sourceCompleteness,
    requestedTargetCount: input.input.snapshot.coverage.requestedTargetCount,
    trueCount: input.truthSummary.trueCount,
    falseCount: input.truthSummary.falseCount,
    unknownCount: input.truthSummary.unknownCount,
    conflictCount: input.truthSummary.conflictCount,
    snapshotJson: JSON.stringify(input.input.snapshot),
    recordedByActorId: input.input.actorId,
    recordedAt: persistedAt,
  });

  const evidenceById: Map<string, InstallationEvidenceRecordProjection> =
    new Map<string, InstallationEvidenceRecordProjection>(
      input.input.snapshot.evidenceRecordRefs.map(
        (record: InstallationEvidenceRecordProjection) => [
          record.evidenceRecordId,
          record,
        ],
      ),
    );
  if (input.input.snapshot.configEvents.length > 0) {
    await input.executor.insert(configurationEvidenceEventVersion).values(
      input.input.snapshot.configEvents.map(
        (event: ConfigEventEvidenceProjection) => {
          const evidence: InstallationEvidenceRecordProjection | undefined =
            evidenceById.get(event.evidenceRecordId);
          if (!evidence) {
            throw persistenceUnavailable(
              'CONFIGURATION_EVIDENCE_EVENT_SOURCE_MISSING',
            );
          }
          return {
            tenantId: input.input.tenantId,
            workItemId: input.input.workItemId,
            snapshotId: input.snapshotId,
            configEventId: event.configEventId,
            evidenceRecordId: event.evidenceRecordId,
            eventKind: event.eventKind,
            aircraftAssetId: event.aircraftAssetId,
            positionId: event.positionId,
            effectiveAt: new Date(event.effectiveAt),
            sourceRecordedAt: new Date(event.recordedAt),
            evidenceJson: JSON.stringify(evidence),
            eventJson: JSON.stringify(event),
            recordedByActorId: input.input.actorId,
            persistedAt,
          };
        },
      ),
    );
  }

  await input.executor.insert(configurationEvidenceFactVersion).values(
    input.input.snapshot.facts.map((fact: ConfigurationSnapshotFact) => ({
      tenantId: input.input.tenantId,
      workItemId: input.input.workItemId,
      snapshotId: input.snapshotId,
      factAssertionId: fact.factAssertionId,
      targetKey: configurationTargetKey(fact.target),
      property: fact.property,
      truth: fact.truth,
      valueJson: JSON.stringify(fact.value),
      status: fact.status,
      authority: fact.authority,
      assessmentAsOf: new Date(fact.assessmentAsOf),
      validFrom: fact.temporal.validFrom
        ? new Date(fact.temporal.validFrom)
        : null,
      validThroughAsOf: new Date(fact.temporal.validThroughAsOf),
      sourceSliceRef: fact.coverage.sourceSliceRef,
      factJson: JSON.stringify(fact),
      recordedByActorId: input.input.actorId,
      persistedAt,
    })),
  );
  await input.executor
    .insert(configurationEvidencePredicateTraceVersion)
    .values(
      input.input.snapshot.predicateTraces.map(
        (trace: ConfigurationPredicateTrace) => ({
          tenantId: input.input.tenantId,
          workItemId: input.input.workItemId,
          snapshotId: input.snapshotId,
          predicateTraceId: trace.predicateTraceId,
          factAssertionId: trace.factAssertionId,
          targetKey: trace.dependencySelector.targetKey,
          truth: trace.truth,
          status: trace.status,
          assessmentAsOf: new Date(trace.assessmentAsOf),
          sourceSliceRef: trace.sourceSliceRef,
          traceJson: JSON.stringify(trace),
          recordedByActorId: input.input.actorId,
          persistedAt,
        }),
      ),
    );
}

async function persistStaleness(input: {
  executor: DatabaseExecutor;
  input: CommitConfigurationEvidenceInput;
  incomingSnapshotId: string;
  incomingConfigurationRevision: number;
  pendingStaleness: PendingStaleness[];
}): Promise<void> {
  if (input.pendingStaleness.length === 0) return;
  await input.executor.insert(configurationEvidenceTraceStaleness).values(
    input.pendingStaleness.map((stale: PendingStaleness, index: number) => ({
      tenantId: input.input.tenantId,
      workItemId: input.input.workItemId,
      stalenessId: [
        'CONFIGURATION-TRACE-STALENESS',
        input.incomingSnapshotId,
        stale.priorSnapshotId,
        String(index + 1),
      ].join(':'),
      priorSnapshotId: stale.priorSnapshotId,
      predicateTraceId: stale.predicateTraceId,
      incomingSnapshotId: input.incomingSnapshotId,
      incomingConfigurationRevision: input.incomingConfigurationRevision,
      previousStatus: stale.reason.previousStatus,
      staleReasonJson: JSON.stringify(stale.reason),
      recordedByActorId: input.input.actorId,
      recordedAt: new Date(input.input.recordedAt),
    })),
  );
}

async function moveHead(input: {
  executor: DatabaseExecutor;
  input: CommitConfigurationEvidenceInput;
  head: HeadRow | null;
  snapshotId: string;
  configurationRevision: number;
}): Promise<void> {
  const values = {
    currentSnapshotId: input.snapshotId,
    configurationRevision: input.configurationRevision,
    updatedByActorId: input.input.actorId,
    updatedAt: new Date(input.input.recordedAt),
  };
  if (!input.head) {
    await input.executor.insert(configurationEvidenceWorkItemHead).values({
      tenantId: input.input.tenantId,
      workItemId: input.input.workItemId,
      ...values,
    });
    return;
  }
  const updated = await input.executor
    .update(configurationEvidenceWorkItemHead)
    .set(values)
    .where(
      and(
        eq(configurationEvidenceWorkItemHead.tenantId, input.input.tenantId),
        eq(
          configurationEvidenceWorkItemHead.workItemId,
          input.input.workItemId,
        ),
        eq(
          configurationEvidenceWorkItemHead.configurationRevision,
          input.head.configurationRevision,
        ),
        eq(
          configurationEvidenceWorkItemHead.currentSnapshotId,
          input.head.currentSnapshotId,
        ),
      ),
    )
    .returning({
      currentSnapshotId: configurationEvidenceWorkItemHead.currentSnapshotId,
    });
  if (updated.length !== 1) {
    throw persistenceConflict('CONFIGURATION_EVIDENCE_HEAD_CAS_CONFLICT');
  }
}

async function staleDependencies(input: {
  executor: DatabaseExecutor;
  input: CommitConfigurationEvidenceInput;
  head: HeadRow;
}): Promise<PendingStaleness[]> {
  const rows: SnapshotRow[] = await input.executor
    .select()
    .from(configurationEvidenceSnapshotVersion)
    .where(
      and(
        eq(configurationEvidenceSnapshotVersion.tenantId, input.input.tenantId),
        eq(
          configurationEvidenceSnapshotVersion.workItemId,
          input.input.workItemId,
        ),
      ),
    )
    .orderBy(configurationEvidenceSnapshotVersion.configurationRevision);
  const current: SnapshotRow | undefined = rows.find(
    (row: SnapshotRow) => row.snapshotId === input.head.currentSnapshotId,
  );
  if (
    !current ||
    current.configurationRevision !== input.head.configurationRevision
  ) {
    throw persistenceUnavailable('CONFIGURATION_EVIDENCE_HEAD_INVALID');
  }
  const pending: PendingStaleness[] = [];
  for (const row of rows) {
    const prior: ConfigurationSnapshot = parseSnapshot(row.snapshotJson);
    if (
      prior.aircraftAssetId !== input.input.snapshot.aircraftAssetId ||
      input.input.snapshot.assessmentAsOf < prior.assessmentAsOf
    ) {
      continue;
    }
    const marked: ConfigurationSnapshot =
      markDependentConfigurationPredicateTracesStale({
        snapshot: prior,
        incomingProjections: input.input.projections,
      });
    for (const trace of marked.predicateTraces) {
      if (trace.status === 'STALE' && trace.staleReason !== null) {
        pending.push({
          priorSnapshotId: row.snapshotId,
          predicateTraceId: trace.predicateTraceId,
          reason: trace.staleReason,
        });
      }
    }
  }
  return pending;
}

async function replayResult(
  executor: DatabaseExecutor,
  input: CommitConfigurationEvidenceInput,
  row: SnapshotRow,
): Promise<CommitConfigurationEvidenceResult> {
  const storedWorkItem = await requiredCurrentWorkItem(executor, input);
  const head: HeadRow | null = await findHead(executor, input);
  return {
    replayed: true,
    workItem: storedWorkItem,
    persisted: await persistedSnapshot(
      executor,
      row,
      head?.currentSnapshotId ?? null,
    ),
  };
}

async function requiredWorkItem(
  executor: DatabaseExecutor,
  input: CommitConfigurationEvidenceInput,
): Promise<CanonicalWorkItemProjection> {
  const current: CanonicalWorkItemProjection = await requiredCurrentWorkItem(
    executor,
    input,
  );
  if (
    current.revision !== input.expectedWorkItemRevision ||
    current.workItemId !== input.workItemId
  ) {
    throw persistenceConflict('WORK_ITEM_CAS_CONFLICT');
  }
  return current;
}

async function requiredCurrentWorkItem(
  executor: DatabaseExecutor,
  input: Pick<CommitConfigurationEvidenceInput, 'tenantId' | 'workItemId'>,
): Promise<CanonicalWorkItemProjection> {
  const [row] = await executor
    .select({
      workItemId: workItem.workItemId,
      revision: workItem.revision,
      projectionJson: workItem.projectionJson,
    })
    .from(workItem)
    .where(
      and(
        eq(workItem.tenantId, input.tenantId),
        eq(workItem.workItemId, input.workItemId),
      ),
    )
    .limit(1);
  if (!row || !row.projectionJson) {
    throw persistenceConflict('CANONICAL_WORK_ITEM_NOT_FOUND');
  }
  const projection: CanonicalWorkItemProjection = parseWorkItem(
    row.projectionJson,
  );
  if (
    projection.workItemId !== row.workItemId ||
    projection.revision !== row.revision
  ) {
    throw persistenceUnavailable(
      'CONFIGURATION_EVIDENCE_WORK_ITEM_READBACK_INVALID',
    );
  }
  return projection;
}

function nextWorkItemProjection(input: {
  current: CanonicalWorkItemProjection;
  snapshotId: string;
  configurationRevision: number;
  snapshot: ConfigurationSnapshot;
  truthSummary: ConfigurationEvidenceTruthSummary;
  recordedAt: string;
}): CanonicalWorkItemProjection {
  const currentPointer: CanonicalConfigurationEvidenceCurrentProjection = {
    schemaVersion: 'wiselink.3_1.configuration_evidence_work_item_current.v1',
    snapshotId: input.snapshotId,
    configurationRevision: input.configurationRevision,
    aircraftAssetId: input.snapshot.aircraftAssetId,
    assessmentAsOf: input.snapshot.assessmentAsOf,
    sourceCompleteness: input.snapshot.coverage.sourceCompleteness,
    truthSummary: structuredClone(input.truthSummary),
    recordedAt: input.recordedAt,
    authority: 'WORK_ITEM_CURRENT_EVIDENCE_VIEW',
    globalAircraftCurrentChanged: false,
  };
  return {
    ...structuredClone(input.current),
    revision: input.current.revision + 1,
    configurationEvidenceCurrent: currentPointer,
  };
}

function assertCurrentBinding(
  current: CanonicalWorkItemProjection,
  head: HeadRow | null,
): void {
  const pointer = current.configurationEvidenceCurrent ?? null;
  if (!head && !pointer) return;
  if (
    !head ||
    !pointer ||
    pointer.snapshotId !== head.currentSnapshotId ||
    pointer.configurationRevision !== head.configurationRevision
  ) {
    throw persistenceUnavailable(
      'CONFIGURATION_EVIDENCE_CURRENT_BINDING_INVALID',
    );
  }
}

async function persistedSnapshot(
  executor: DatabaseExecutor,
  row: SnapshotRow,
  knownCurrentSnapshotId?: string | null,
): Promise<PersistedConfigurationEvidenceSnapshot> {
  const currentSnapshotId: string | null =
    knownCurrentSnapshotId === undefined
      ? ((await findHead(executor, row))?.currentSnapshotId ?? null)
      : knownCurrentSnapshotId;
  const snapshot: ConfigurationSnapshot = await snapshotWithStaleness(
    executor,
    row,
  );
  return {
    request: parseRequest(row.requestJson),
    summary: summaryFromRow(row, currentSnapshotId),
    snapshot,
  };
}

async function snapshotWithStaleness(
  executor: DatabaseExecutor,
  row: SnapshotRow,
): Promise<ConfigurationSnapshot> {
  const snapshot: ConfigurationSnapshot = parseSnapshot(row.snapshotJson);
  const staleRows = await executor
    .select({
      predicateTraceId: configurationEvidenceTraceStaleness.predicateTraceId,
      incomingConfigurationRevision:
        configurationEvidenceTraceStaleness.incomingConfigurationRevision,
      staleReasonJson: configurationEvidenceTraceStaleness.staleReasonJson,
    })
    .from(configurationEvidenceTraceStaleness)
    .where(
      and(
        eq(configurationEvidenceTraceStaleness.tenantId, row.tenantId),
        eq(configurationEvidenceTraceStaleness.workItemId, row.workItemId),
        eq(configurationEvidenceTraceStaleness.priorSnapshotId, row.snapshotId),
      ),
    )
    .orderBy(
      desc(configurationEvidenceTraceStaleness.incomingConfigurationRevision),
    );
  const latestByTrace: Map<string, ConfigurationPredicateTraceStaleReason> =
    new Map<string, ConfigurationPredicateTraceStaleReason>();
  for (const stale of staleRows) {
    if (!latestByTrace.has(stale.predicateTraceId)) {
      latestByTrace.set(
        stale.predicateTraceId,
        parseStaleReason(stale.staleReasonJson),
      );
    }
  }
  if (latestByTrace.size === 0) return snapshot;
  const overlaid: ConfigurationSnapshot = structuredClone(snapshot);
  overlaid.predicateTraces = overlaid.predicateTraces.map(
    (trace: ConfigurationPredicateTrace): ConfigurationPredicateTrace => {
      const reason: ConfigurationPredicateTraceStaleReason | undefined =
        latestByTrace.get(trace.predicateTraceId);
      return reason
        ? { ...trace, status: 'STALE', staleReason: structuredClone(reason) }
        : trace;
    },
  );
  return overlaid;
}

function summaryFromRow(
  row: SnapshotRow,
  currentSnapshotId: string | null,
): ConfigurationEvidenceSnapshotSummary {
  return {
    snapshotId: row.snapshotId,
    configurationRevision: row.configurationRevision,
    workItemRevisionBefore: row.workItemRevisionBefore,
    workItemRevisionAfter: row.workItemRevisionAfter,
    aircraftAssetId: row.aircraftAssetId,
    assessmentAsOf: row.assessmentAsOf.toISOString(),
    sourceCompleteness:
      row.sourceCompleteness as ConfigurationEvidenceSnapshotSummary['sourceCompleteness'],
    truthSummary: {
      trueCount: row.trueCount,
      falseCount: row.falseCount,
      unknownCount: row.unknownCount,
      conflictCount: row.conflictCount,
    },
    recordedByActorId: row.recordedByActorId,
    recordedAt: row.recordedAt.toISOString(),
    isCurrent: row.snapshotId === currentSnapshotId,
  };
}

function summarizeTruth(
  snapshot: ConfigurationSnapshot,
): ConfigurationEvidenceTruthSummary {
  const summary: ConfigurationEvidenceTruthSummary = {
    trueCount: 0,
    falseCount: 0,
    unknownCount: 0,
    conflictCount: 0,
  };
  for (const fact of snapshot.facts) {
    if (fact.truth === 'TRUE') summary.trueCount += 1;
    else if (fact.truth === 'FALSE') summary.falseCount += 1;
    else if (fact.truth === 'UNKNOWN') summary.unknownCount += 1;
    else summary.conflictCount += 1;
  }
  if (
    snapshot.facts.length !== snapshot.coverage.requestedTargetCount ||
    summary.trueCount +
      summary.falseCount +
      summary.unknownCount +
      summary.conflictCount !==
      snapshot.coverage.requestedTargetCount
  ) {
    throw persistenceUnavailable(
      'CONFIGURATION_EVIDENCE_SNAPSHOT_FACT_COUNT_INVALID',
    );
  }
  return summary;
}

async function findSnapshotByRequest(
  executor: DatabaseExecutor,
  input: { tenantId: string; workItemId: string; requestId: string },
): Promise<SnapshotRow | null> {
  const [row] = await executor
    .select()
    .from(configurationEvidenceSnapshotVersion)
    .where(
      and(
        eq(configurationEvidenceSnapshotVersion.tenantId, input.tenantId),
        eq(configurationEvidenceSnapshotVersion.workItemId, input.workItemId),
        eq(configurationEvidenceSnapshotVersion.requestId, input.requestId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findSnapshotById(
  executor: DatabaseExecutor,
  input: { tenantId: string; workItemId: string; snapshotId: string },
): Promise<SnapshotRow | null> {
  const [row] = await executor
    .select()
    .from(configurationEvidenceSnapshotVersion)
    .where(
      and(
        eq(configurationEvidenceSnapshotVersion.tenantId, input.tenantId),
        eq(configurationEvidenceSnapshotVersion.workItemId, input.workItemId),
        eq(configurationEvidenceSnapshotVersion.snapshotId, input.snapshotId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findHead(
  executor: DatabaseExecutor,
  input: { tenantId: string; workItemId: string },
): Promise<HeadRow | null> {
  const [row] = await executor
    .select()
    .from(configurationEvidenceWorkItemHead)
    .where(
      and(
        eq(configurationEvidenceWorkItemHead.tenantId, input.tenantId),
        eq(configurationEvidenceWorkItemHead.workItemId, input.workItemId),
      ),
    )
    .limit(1);
  return row ?? null;
}

function assertIdempotentRequest(row: SnapshotRow, requestJson: string): void {
  if (row.requestJson !== requestJson) {
    throw persistenceConflict(
      'CONFIGURATION_EVIDENCE_IDEMPOTENCY_PAYLOAD_MISMATCH',
    );
  }
}

function configurationSnapshotId(requestId: string): string {
  return `CONFIGURATION-SNAPSHOT:${requestId}`;
}

function parseWorkItem(value: string): CanonicalWorkItemProjection {
  const parsed: unknown = parseJson(value);
  if (!isRecord(parsed)) {
    throw persistenceUnavailable(
      'CONFIGURATION_EVIDENCE_WORK_ITEM_READBACK_INVALID',
    );
  }
  if (
    parsed.schemaVersion !==
      'wiselink.3_1.canonical_work_item_projection.v0.candidate' ||
    typeof parsed.workItemId !== 'string' ||
    !Number.isSafeInteger(parsed.revision)
  ) {
    throw persistenceUnavailable(
      'CONFIGURATION_EVIDENCE_WORK_ITEM_READBACK_INVALID',
    );
  }
  return parsed as unknown as CanonicalWorkItemProjection;
}

function parseRequest(value: string): ResolvedConfigurationEvidenceRequest {
  const parsed: unknown = parseJson(value);
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 'wiselink.3_1.refresh_configuration_evidence.v1' ||
    typeof parsed.requestId !== 'string' ||
    !Number.isSafeInteger(parsed.expectedRevision) ||
    !isRecord(parsed.aircraft) ||
    !Array.isArray(parsed.targets)
  ) {
    throw persistenceUnavailable(
      'CONFIGURATION_EVIDENCE_REQUEST_READBACK_INVALID',
    );
  }
  return parsed as unknown as ResolvedConfigurationEvidenceRequest;
}

function parseSnapshot(value: string): ConfigurationSnapshot {
  const parsed: unknown = parseJson(value);
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !==
      'wiselink.3_1.configuration_snapshot.v1.candidate' ||
    typeof parsed.aircraftAssetId !== 'string' ||
    typeof parsed.assessmentAsOf !== 'string' ||
    !Array.isArray(parsed.facts) ||
    !Array.isArray(parsed.predicateTraces) ||
    !Array.isArray(parsed.evidenceRecordRefs) ||
    !Array.isArray(parsed.configEvents)
  ) {
    throw persistenceUnavailable(
      'CONFIGURATION_EVIDENCE_SNAPSHOT_READBACK_INVALID',
    );
  }
  return parsed as unknown as ConfigurationSnapshot;
}

function parseStaleReason(
  value: string,
): ConfigurationPredicateTraceStaleReason {
  const parsed: unknown = parseJson(value);
  if (
    !isRecord(parsed) ||
    parsed.code !== 'DEPENDENCY_OBSERVATION_CHANGED' ||
    typeof parsed.previousStatus !== 'string' ||
    typeof parsed.incomingSourceSliceRef !== 'string'
  ) {
    throw persistenceUnavailable(
      'CONFIGURATION_EVIDENCE_STALENESS_READBACK_INVALID',
    );
  }
  return parsed as unknown as ConfigurationPredicateTraceStaleReason;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw persistenceUnavailable('CONFIGURATION_EVIDENCE_JSON_INVALID');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function persistenceConflict(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}

function persistenceUnavailable(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 503 });
}
