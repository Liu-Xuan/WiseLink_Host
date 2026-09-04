import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq } from 'drizzle-orm';

import { configurationEvidenceQueryAttempt } from '../../../database/schema';
import type { ConfigurationSnapshot } from './configuration-snapshot.types';
import type {
  CompleteConfigurationEvidenceQueryInput,
  ConfigurationEvidenceQueryAttemptReadModel,
  ConfigurationEvidenceQueryStorePort,
  ConfigurationEvidenceQueryTerminalStatus,
  ReserveConfigurationEvidenceQueryInput,
  ResolvedConfigurationEvidenceRequest,
} from './configuration-evidence.persistence.types';
import type { InstallationEventEvidenceProjection } from './installation-event-evidence.types';

type DatabaseExecutor = PostgresJsDatabase;
type QueryRow = typeof configurationEvidenceQueryAttempt.$inferSelect;

const TERMINAL_STATUSES = new Set<ConfigurationEvidenceQueryTerminalStatus>([
  'RUNNING',
  'SUCCEEDED_EVIDENCE',
  'SUCCEEDED_NO_RECORD',
  'NOT_CONNECTED',
  'ACCESS_DENIED',
  'CONFLICT',
  'FAILED_VALIDATION',
  'TIMEOUT',
  'CANCELED',
]);

@Injectable()
export class MiaodaConfigurationEvidenceQueryStore implements ConfigurationEvidenceQueryStorePort {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async findByRequest(input: {
    tenantId: string;
    workItemId: string;
    requestId: string;
  }): Promise<ConfigurationEvidenceQueryAttemptReadModel | null> {
    return readQuery(this.db, {
      tenantId: input.tenantId,
      workItemId: input.workItemId,
      column: 'requestId',
      value: input.requestId,
    });
  }

  async findByQueryAttemptRef(input: {
    tenantId: string;
    workItemId: string;
    queryAttemptRef: string;
  }): Promise<ConfigurationEvidenceQueryAttemptReadModel | null> {
    return readQuery(this.db, {
      tenantId: input.tenantId,
      workItemId: input.workItemId,
      column: 'queryAttemptRef',
      value: input.queryAttemptRef,
    });
  }

  async findByCandidateEvidenceRef(input: {
    tenantId: string;
    workItemId: string;
    candidateEvidenceRef: string;
  }): Promise<ConfigurationEvidenceQueryAttemptReadModel | null> {
    return readQuery(this.db, {
      tenantId: input.tenantId,
      workItemId: input.workItemId,
      column: 'candidateEvidenceRef',
      value: input.candidateEvidenceRef,
    });
  }

  async reserve(input: ReserveConfigurationEvidenceQueryInput): Promise<{
    replayed: boolean;
    attempt: ConfigurationEvidenceQueryAttemptReadModel;
  }> {
    const requestJson: string = JSON.stringify(input.request);
    return this.db.transaction(async (transaction) => {
      const executor: DatabaseExecutor = transaction as DatabaseExecutor;
      const replay = await readQuery(executor, {
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        column: 'requestId',
        value: input.request.requestId,
      });
      if (replay) {
        if (JSON.stringify(replay.request) !== requestJson) {
          throw queryConflict(
            'CONFIGURATION_EVIDENCE_QUERY_IDEMPOTENCY_PAYLOAD_MISMATCH',
          );
        }
        return { replayed: true, attempt: replay };
      }

      const cycleRows: QueryRow[] = await executor
        .select()
        .from(configurationEvidenceQueryAttempt)
        .where(
          and(
            eq(configurationEvidenceQueryAttempt.tenantId, input.tenantId),
            eq(configurationEvidenceQueryAttempt.workItemId, input.workItemId),
            eq(
              configurationEvidenceQueryAttempt.inputRevision,
              input.request.expectedRevision,
            ),
          ),
        );
      if (cycleRows.some((row: QueryRow) => row.terminalStatus === 'RUNNING')) {
        throw queryConflict('CONFIGURATION_EVIDENCE_QUERY_ALREADY_RUNNING');
      }
      if (
        cycleRows.some(
          (row: QueryRow) => row.queryFingerprint === input.queryFingerprint,
        )
      ) {
        throw queryConflict('CONFIGURATION_EVIDENCE_QUERY_DUPLICATE');
      }
      const roundNo: number = cycleRows.length + 1;
      const consumedQueries: number = cycleRows.reduce(
        (total: number, row: QueryRow) => total + row.queryCount,
        0,
      );
      if (roundNo > 2) {
        throw queryConflict(
          'CONFIGURATION_EVIDENCE_QUERY_ROUND_BUDGET_EXCEEDED',
        );
      }
      if (consumedQueries + input.request.targets.length > 5) {
        throw queryConflict(
          'CONFIGURATION_EVIDENCE_QUERY_COUNT_BUDGET_EXCEEDED',
        );
      }

      await executor.insert(configurationEvidenceQueryAttempt).values({
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        queryAttemptRef: input.queryAttemptRef,
        candidateEvidenceRef: input.candidateEvidenceRef,
        requestId: input.request.requestId,
        inputRevision: input.request.expectedRevision,
        roundNo,
        queryCount: input.request.targets.length,
        queryFingerprint: input.queryFingerprint,
        requestJson,
        projectionsJson: null,
        candidateSnapshotJson: null,
        terminalStatus: 'RUNNING',
        sourceRecordCount: 0,
        adoptionStatus: 'CANDIDATE_UNADOPTED',
        adoptedSnapshotId: null,
        adoptedWorkItemRevision: null,
        recordedByActorId: input.actorId,
        startedAt: new Date(input.startedAt),
        deadlineAt: new Date(input.deadlineAt),
        completedAt: null,
        adoptedAt: null,
      });
      const created = await readQuery(executor, {
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        column: 'queryAttemptRef',
        value: input.queryAttemptRef,
      });
      if (!created) {
        throw queryUnavailable(
          'CONFIGURATION_EVIDENCE_QUERY_RESERVE_READBACK_FAILED',
        );
      }
      return { replayed: false, attempt: created };
    });
  }

  async complete(
    input: CompleteConfigurationEvidenceQueryInput,
  ): Promise<ConfigurationEvidenceQueryAttemptReadModel> {
    const updated = await this.db
      .update(configurationEvidenceQueryAttempt)
      .set({
        terminalStatus: input.terminalStatus,
        projectionsJson: JSON.stringify(input.projections),
        candidateSnapshotJson: JSON.stringify(input.candidateSnapshot),
        sourceRecordCount: input.sourceRecordCount,
        completedAt: new Date(input.completedAt),
      })
      .where(
        and(
          eq(configurationEvidenceQueryAttempt.tenantId, input.tenantId),
          eq(configurationEvidenceQueryAttempt.workItemId, input.workItemId),
          eq(
            configurationEvidenceQueryAttempt.queryAttemptRef,
            input.queryAttemptRef,
          ),
          eq(configurationEvidenceQueryAttempt.terminalStatus, 'RUNNING'),
          eq(
            configurationEvidenceQueryAttempt.recordedByActorId,
            input.actorId,
          ),
        ),
      )
      .returning({
        queryAttemptRef: configurationEvidenceQueryAttempt.queryAttemptRef,
      });
    const completed = await this.findByQueryAttemptRef(input);
    if (!completed) {
      throw queryUnavailable(
        'CONFIGURATION_EVIDENCE_QUERY_COMPLETE_READBACK_FAILED',
      );
    }
    if (updated.length === 0) {
      assertSameCompletion(completed, input);
    }
    return completed;
  }

  async markAdopted(input: {
    tenantId: string;
    workItemId: string;
    candidateEvidenceRef: string;
    snapshotId: string;
    workItemRevision: number;
    adoptedAt: string;
  }): Promise<ConfigurationEvidenceQueryAttemptReadModel> {
    const updated = await this.db
      .update(configurationEvidenceQueryAttempt)
      .set({
        adoptionStatus: 'ADOPTED',
        adoptedSnapshotId: input.snapshotId,
        adoptedWorkItemRevision: input.workItemRevision,
        adoptedAt: new Date(input.adoptedAt),
      })
      .where(
        and(
          eq(configurationEvidenceQueryAttempt.tenantId, input.tenantId),
          eq(configurationEvidenceQueryAttempt.workItemId, input.workItemId),
          eq(
            configurationEvidenceQueryAttempt.candidateEvidenceRef,
            input.candidateEvidenceRef,
          ),
          eq(
            configurationEvidenceQueryAttempt.adoptionStatus,
            'CANDIDATE_UNADOPTED',
          ),
        ),
      )
      .returning({
        candidateEvidenceRef:
          configurationEvidenceQueryAttempt.candidateEvidenceRef,
      });
    const adopted = await this.findByCandidateEvidenceRef(input);
    if (!adopted) {
      throw queryUnavailable('CONFIGURATION_EVIDENCE_ADOPTION_READBACK_FAILED');
    }
    if (updated.length === 0) {
      if (
        adopted.adoption.status !== 'ADOPTED' ||
        adopted.adoption.snapshotId !== input.snapshotId ||
        adopted.adoption.workItemRevision !== input.workItemRevision
      ) {
        throw queryConflict('CONFIGURATION_EVIDENCE_ADOPTION_CONFLICT');
      }
    }
    return adopted;
  }
}

async function readQuery(
  executor: DatabaseExecutor,
  input: {
    tenantId: string;
    workItemId: string;
    column: 'requestId' | 'queryAttemptRef' | 'candidateEvidenceRef';
    value: string;
  },
): Promise<ConfigurationEvidenceQueryAttemptReadModel | null> {
  const column = configurationEvidenceQueryAttempt[input.column];
  const [row] = await executor
    .select()
    .from(configurationEvidenceQueryAttempt)
    .where(
      and(
        eq(configurationEvidenceQueryAttempt.tenantId, input.tenantId),
        eq(configurationEvidenceQueryAttempt.workItemId, input.workItemId),
        eq(column, input.value),
      ),
    )
    .limit(1);
  return row ? queryReadModel(row) : null;
}

function queryReadModel(
  row: QueryRow,
): ConfigurationEvidenceQueryAttemptReadModel {
  const terminalStatus = queryStatus(row.terminalStatus);
  const request = parseRequest(row.requestJson);
  const projections = row.projectionsJson
    ? parseProjections(row.projectionsJson)
    : null;
  const candidateSnapshot = row.candidateSnapshotJson
    ? parseSnapshot(row.candidateSnapshotJson)
    : null;
  if (
    row.inputRevision !== request.expectedRevision ||
    row.queryCount !== request.targets.length ||
    (terminalStatus === 'RUNNING' &&
      (projections !== null ||
        candidateSnapshot !== null ||
        row.completedAt)) ||
    (terminalStatus !== 'RUNNING' &&
      (!projections || !candidateSnapshot || !row.completedAt))
  ) {
    throw queryUnavailable('CONFIGURATION_EVIDENCE_QUERY_READBACK_INVALID');
  }
  const adoption =
    row.adoptionStatus === 'ADOPTED' &&
    row.adoptedSnapshotId &&
    row.adoptedWorkItemRevision !== null &&
    row.adoptedAt
      ? {
          status: 'ADOPTED' as const,
          snapshotId: row.adoptedSnapshotId,
          workItemRevision: row.adoptedWorkItemRevision,
          adoptedAt: row.adoptedAt.toISOString(),
        }
      : row.adoptionStatus === 'CANDIDATE_UNADOPTED' &&
          !row.adoptedSnapshotId &&
          row.adoptedWorkItemRevision === null &&
          !row.adoptedAt
        ? { status: 'CANDIDATE_UNADOPTED' as const }
        : null;
  if (!adoption) {
    throw queryUnavailable(
      'CONFIGURATION_EVIDENCE_QUERY_ADOPTION_READBACK_INVALID',
    );
  }
  return {
    queryAttemptRef: row.queryAttemptRef,
    candidateEvidenceRef: row.candidateEvidenceRef,
    workItemId: row.workItemId,
    inputRevision: row.inputRevision,
    roundNo: row.roundNo,
    queryCount: row.queryCount,
    queryFingerprint: row.queryFingerprint,
    request,
    terminalStatus,
    sourceRecordCount: row.sourceRecordCount,
    projections,
    candidateSnapshot,
    startedAt: row.startedAt.toISOString(),
    deadlineAt: row.deadlineAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    adoption,
  };
}

function queryStatus(value: string): ConfigurationEvidenceQueryTerminalStatus {
  if (
    !TERMINAL_STATUSES.has(value as ConfigurationEvidenceQueryTerminalStatus)
  ) {
    throw queryUnavailable('CONFIGURATION_EVIDENCE_QUERY_STATUS_INVALID');
  }
  return value as ConfigurationEvidenceQueryTerminalStatus;
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
    throw queryUnavailable('CONFIGURATION_EVIDENCE_QUERY_REQUEST_INVALID');
  }
  return parsed as unknown as ResolvedConfigurationEvidenceRequest;
}

function parseProjections(
  value: string,
): InstallationEventEvidenceProjection[] {
  const parsed: unknown = parseJson(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (projection: unknown) =>
        !isRecord(projection) ||
        projection.schemaVersion !==
          'wiselink.3_1.installation_event_evidence.v0.candidate',
    )
  ) {
    throw queryUnavailable('CONFIGURATION_EVIDENCE_QUERY_PROJECTIONS_INVALID');
  }
  return parsed as InstallationEventEvidenceProjection[];
}

function parseSnapshot(value: string): ConfigurationSnapshot {
  const parsed: unknown = parseJson(value);
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !==
      'wiselink.3_1.configuration_snapshot.v1.candidate' ||
    !Array.isArray(parsed.facts) ||
    !Array.isArray(parsed.predicateTraces)
  ) {
    throw queryUnavailable('CONFIGURATION_EVIDENCE_QUERY_SNAPSHOT_INVALID');
  }
  return parsed as unknown as ConfigurationSnapshot;
}

function assertSameCompletion(
  current: ConfigurationEvidenceQueryAttemptReadModel,
  input: CompleteConfigurationEvidenceQueryInput,
): void {
  if (
    current.terminalStatus !== input.terminalStatus ||
    current.sourceRecordCount !== input.sourceRecordCount ||
    JSON.stringify(current.projections) !== JSON.stringify(input.projections) ||
    JSON.stringify(current.candidateSnapshot) !==
      JSON.stringify(input.candidateSnapshot)
  ) {
    throw queryConflict('CONFIGURATION_EVIDENCE_QUERY_COMPLETION_CONFLICT');
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw queryUnavailable('CONFIGURATION_EVIDENCE_QUERY_JSON_INVALID');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function queryConflict(code: string): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}

function queryUnavailable(code: string): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode: 503 });
}
