import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  DATAPAAS_CONFIG,
  DRIZZLE_DATABASE,
  SqlExecutionContextMiddleware,
  type DataPaasConfig,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import type { Request, Response } from 'express';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';

import type {
  EngineeringMatterWorkingCommitResult,
  EngineeringMatterWorkingInputBinding,
  EngineeringMatterWorkingRevisionCommand,
  EngineeringMatterWorkingRevisionReadModel,
  EngineeringMatterWorkingRevisionSource,
} from '@shared/matter-working.interface';

import {
  engineeringMatter,
  engineeringMatterRevision,
  engineeringMatterRevisionWorkItem,
  engineeringMatterWorkRevision,
  identitySubjectMapping,
  workItem,
} from '../../database/schema';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { loadMaterials } from './engineering-matter.repository';
import { materialInputBindings } from './matter-material';
import {
  assertEngineeringMatterWorkingBindingsCurrent,
  engineeringMatterWorkingChangeFromCommand,
  materializeEngineeringMatterWorkingState,
  parseEngineeringMatterWorkingCommand,
  parseEngineeringMatterWorkingState,
} from './engineering-matter-working-state';

export type EngineeringMatterWorkingDatabaseExecutor = PostgresJsDatabase;

export interface EngineeringMatterWorkingCommitInput {
  tenantId: string;
  matterId: string;
  actorUserId: string;
  command: EngineeringMatterWorkingRevisionCommand;
  /** Fresh-authorized bindings captured by EngineeringMatterService. */
  currentInputs: EngineeringMatterWorkingInputBinding[];
  source: EngineeringMatterWorkingRevisionSource | null;
}

/**
 * Shared executor for W4. Candidate persistence and appendWorkingRevision can
 * run on the same database transaction after ActionAttempt enters COMMITTING.
 */
export interface EngineeringMatterWorkingTransactionExecutor {
  database: EngineeringMatterWorkingDatabaseExecutor;
  authorizeRuntimeInputs(input: {
    tenantId: string;
    matterId: string;
    actorUserId: string;
    basedOnMatterRevisionId?: string;
  }): Promise<EngineeringMatterRuntimeAuthorization>;
  loadCurrent(input: {
    tenantId: string;
    matterId: string;
  }): Promise<EngineeringMatterWorkingRevisionReadModel | null>;
  appendWorkingRevision(
    input: EngineeringMatterWorkingCommitInput,
  ): Promise<EngineeringMatterWorkingCommitResult>;
}

type WorkRevisionRow = typeof engineeringMatterWorkRevision.$inferSelect;
const OFFICIAL_CLIENT_ID = 'cli_aadde8b579f95bc9';

export interface EngineeringMatterRuntimeAuthorization {
  currentMatterRevisionId: string;
  currentInputs: EngineeringMatterWorkingInputBinding[];
}

@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided -- W1 registers/exports this in EngineeringMatterModule.
export class EngineeringMatterWorkingRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly sqlContext: SqlExecutionContextMiddleware,
    @Inject(DATAPAAS_CONFIG)
    private readonly databaseConfig: Pick<DataPaasConfig, 'roleSchema'>,
  ) {}

  async withTransaction<T>(
    operation: (
      executor: EngineeringMatterWorkingTransactionExecutor,
    ) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) =>
      operation(this.executor(transaction as PostgresJsDatabase)),
    );
  }

  /** Bind the verified Host actor for every query of this Hosted transaction. */
  async withActorTransaction<T>(
    actorUserId: string,
    operation: (
      executor: EngineeringMatterWorkingTransactionExecutor,
    ) => Promise<T>,
  ): Promise<T> {
    // The official SDK re-applies its SQL context before EVERY query, including
    // queries inside a pinned transaction. A standalone set_config is reset by
    // that next query. Use its injected middleware to scope the existing
    // service role to the Host-resolved actor, without changing the HTTP actor,
    // platform identity, global context or any role membership.
    if (!/^[A-Za-z0-9_-]{1,255}$/u.test(actorUserId))
      throw runtimeAuthorizationUnavailable();
    // MCP tool dispatch does not guarantee RequestContextService's HTTP flag.
    // Check the actual pre-existing SQL role before binding an actor; this
    // cannot turn an authenticated/browser database context into service_role.
    const roleSchema = this.databaseConfig.roleSchema;
    if (!roleSchema || !/^[A-Za-z0-9_]{1,255}$/u.test(roleSchema))
      throw runtimeAuthorizationUnavailable();
    const [runtimeRole] = await this.db.execute<{ isHostedService: boolean }>(
      sql`SELECT current_user = ${`service_role_${roleSchema}`} AS "isHostedService"`,
    );
    if (runtimeRole?.isHostedService !== true)
      throw runtimeAuthorizationUnavailable();
    return new Promise<T>((resolve, reject) => {
      this.sqlContext.use(
        {
          userContext: {
            userId: actorUserId,
            isSystemAccount: true,
            roles: [],
          },
        } as Request,
        {} as Response,
        () => {
          void this.db
            .transaction(async (transaction) =>
              operation(this.executor(transaction as PostgresJsDatabase)),
            )
            .then(resolve, reject);
        },
      );
    });
  }

  /** Build the same facade around an already-open W4 transaction. */
  executor(
    database: EngineeringMatterWorkingDatabaseExecutor,
  ): EngineeringMatterWorkingTransactionExecutor {
    return {
      database,
      authorizeRuntimeInputs: (input) =>
        this.authorizeRuntimeInputs(input, database),
      loadCurrent: (input) => this.loadCurrent(input, database),
      appendWorkingRevision: (input) =>
        this.appendWorkingRevision(input, database),
    };
  }

  async loadCurrent(
    input: { tenantId: string; matterId: string },
    executor: EngineeringMatterWorkingDatabaseExecutor = this.db,
  ): Promise<EngineeringMatterWorkingRevisionReadModel | null> {
    const [row] = await executor
      .select()
      .from(engineeringMatterWorkRevision)
      .where(
        and(
          eq(engineeringMatterWorkRevision.tenantId, input.tenantId),
          eq(engineeringMatterWorkRevision.matterId, input.matterId),
        ),
      )
      .orderBy(desc(engineeringMatterWorkRevision.workingRevision))
      .limit(1);
    return row ? readModel(row) : null;
  }

  async commit(
    input: EngineeringMatterWorkingCommitInput,
  ): Promise<EngineeringMatterWorkingCommitResult> {
    try {
      return await this.withTransaction((executor) =>
        executor.appendWorkingRevision(input),
      );
    } catch (error: unknown) {
      if (!isUniqueConflict(error)) throw error;
      const replay = await this.findReplay(this.db, input);
      if (!replay) throw workingCasConflict();
      assertExactReplay(replay, input);
      return this.resultForStored(this.db, replay, true);
    }
  }

  async findBySource(input: {
    tenantId: string;
    matterId: string;
    source: EngineeringMatterWorkingRevisionSource;
  }): Promise<EngineeringMatterWorkingRevisionReadModel | null> {
    const [row] = await this.db
      .select()
      .from(engineeringMatterWorkRevision)
      .where(
        and(
          eq(engineeringMatterWorkRevision.tenantId, input.tenantId),
          eq(engineeringMatterWorkRevision.matterId, input.matterId),
          eq(
            engineeringMatterWorkRevision.actionAttemptId,
            input.source.actionAttemptId,
          ),
          eq(
            engineeringMatterWorkRevision.reviewTurnId,
            input.source.reviewTurnId,
          ),
        ),
      )
      .limit(1);
    return row ? readModel(row) : null;
  }

  /**
   * Runtime-only fresh authorization. It accepts no browser actor object and
   * succeeds only for an active official mapping plus owner-visible current
   * and (when supplied) based Matter membership snapshots.
   */
  async authorizeRuntimeInputs(
    input: {
      tenantId: string;
      matterId: string;
      actorUserId: string;
      basedOnMatterRevisionId?: string;
    },
    executor: EngineeringMatterWorkingDatabaseExecutor,
  ): Promise<EngineeringMatterRuntimeAuthorization> {
    const [mapping] = await executor
      .select({ id: identitySubjectMapping.id })
      .from(identitySubjectMapping)
      .where(
        and(
          eq(identitySubjectMapping.miaodaUserId, input.actorUserId),
          eq(identitySubjectMapping.miaodaTenantId, input.tenantId),
          eq(identitySubjectMapping.expectedClientId, OFFICIAL_CLIENT_ID),
          eq(identitySubjectMapping.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!mapping) throw runtimeAuthorizationUnavailable();

    const [matter] = await executor
      .select({
        currentMatterRevisionId: engineeringMatter.currentMatterRevisionId,
        createdByUserId: engineeringMatter.createdByUserId,
      })
      .from(engineeringMatter)
      .where(
        and(
          eq(engineeringMatter.tenantId, input.tenantId),
          eq(engineeringMatter.matterId, input.matterId),
        ),
      )
      .limit(1);
    if (!matter || matter.createdByUserId !== input.actorUserId) {
      throw runtimeAuthorizationUnavailable();
    }
    await assertAllLinksOwned(
      executor,
      input.tenantId,
      matter.currentMatterRevisionId,
    );
    const currentInputs = await loadCurrentInputBindings(
      executor,
      {
        tenantId: input.tenantId,
        matterId: input.matterId,
        matterRevisionId: matter.currentMatterRevisionId,
      },
      input.actorUserId,
    );
    if (
      input.basedOnMatterRevisionId &&
      input.basedOnMatterRevisionId !== matter.currentMatterRevisionId
    ) {
      const [basis] = await executor
        .select({
          matterRevisionId: engineeringMatterRevision.matterRevisionId,
        })
        .from(engineeringMatterRevision)
        .where(
          and(
            eq(engineeringMatterRevision.tenantId, input.tenantId),
            eq(engineeringMatterRevision.matterId, input.matterId),
            eq(
              engineeringMatterRevision.matterRevisionId,
              input.basedOnMatterRevisionId,
            ),
          ),
        )
        .limit(1);
      if (!basis) throw workingMembershipConflict();
      await assertAllLinksOwned(
        executor,
        input.tenantId,
        input.basedOnMatterRevisionId,
      );
      await loadCurrentInputBindings(
        executor,
        {
          tenantId: input.tenantId,
          matterId: input.matterId,
          matterRevisionId: input.basedOnMatterRevisionId,
        },
        input.actorUserId,
      );
    }
    return {
      currentMatterRevisionId: matter.currentMatterRevisionId,
      currentInputs,
    };
  }

  private async appendWorkingRevision(
    input: EngineeringMatterWorkingCommitInput,
    executor: EngineeringMatterWorkingDatabaseExecutor,
  ): Promise<EngineeringMatterWorkingCommitResult> {
    validateCommitInput(input);
    const replay = await this.findReplay(executor, input);
    if (replay) {
      assertExactReplay(replay, input);
      return this.resultForStored(executor, replay, true);
    }

    const [matter] = await executor
      .select({
        matterId: engineeringMatter.matterId,
        currentMatterRevisionId: engineeringMatter.currentMatterRevisionId,
      })
      .from(engineeringMatter)
      .where(
        and(
          eq(engineeringMatter.tenantId, input.tenantId),
          eq(engineeringMatter.matterId, input.matterId),
        ),
      )
      .limit(1)
      .for('update');
    if (!matter) throw workingMatterNotFound();

    // A concurrent identical request can become visible only after this
    // transaction has waited for the Matter lock. Recheck before CAS so the
    // loser observes an exact replay instead of a false stale-revision error.
    const serializedReplay = await this.findReplay(executor, input);
    if (serializedReplay) {
      assertExactReplay(serializedReplay, input);
      return this.resultForStored(executor, serializedReplay, true);
    }
    if (
      matter.currentMatterRevisionId !== input.command.basedOnMatterRevisionId
    ) {
      throw workingMembershipConflict();
    }

    const currentInputs = await loadCurrentInputBindings(
      executor,
      {
        tenantId: input.tenantId,
        matterId: input.matterId,
        matterRevisionId: matter.currentMatterRevisionId,
      },
      input.actorUserId,
      true,
    );
    assertEngineeringMatterWorkingBindingsCurrent({
      expected: input.currentInputs,
      current: currentInputs,
    });
    assertCommandBindingsCurrent(input.command, currentInputs);

    const current = await this.loadCurrent(
      { tenantId: input.tenantId, matterId: input.matterId },
      executor,
    );
    const currentRevision = current?.workingRevision ?? 0;
    if (currentRevision !== input.command.expectedWorkingRevision) {
      throw workingCasConflict();
    }
    const materialized = materializeEngineeringMatterWorkingState({
      matterId: input.matterId,
      current: current?.state ?? null,
      command: input.command,
    });
    const row: typeof engineeringMatterWorkRevision.$inferInsert = {
      matterWorkRevisionId: `MWREV-${randomUUID()}`,
      tenantId: input.tenantId,
      matterId: input.matterId,
      workingRevision: currentRevision + 1,
      requestId: input.command.requestId,
      basedOnMatterRevisionId: input.command.basedOnMatterRevisionId,
      updateKind: input.command.updateKind,
      commandJson: canonicalJson(input.command),
      stateJson: canonicalJson(materialized.state),
      substantiveResultRef:
        materialized.state.substantiveResult?.resultRef ?? null,
      substantiveResultRevision:
        materialized.state.substantiveResult?.resultRevision ?? null,
      changeSummary: input.command.changeSummary,
      actionAttemptId: input.source?.actionAttemptId ?? null,
      reviewTurnId: input.source?.reviewTurnId ?? null,
      createdByUserId: input.actorUserId,
      createdAt: new Date(),
    };
    const [stored] = await executor
      .insert(engineeringMatterWorkRevision)
      .values(row)
      .returning();
    if (!stored) throw workingPersistenceError();
    return {
      revision: readModel(stored),
      replayed: false,
      resultChanged: materialized.resultChanged,
      coverageChanged: materialized.coverageChanged,
    };
  }

  private async findReplay(
    executor: EngineeringMatterWorkingDatabaseExecutor,
    input: EngineeringMatterWorkingCommitInput,
  ): Promise<WorkRevisionRow | null> {
    const [requestRow] = await executor
      .select()
      .from(engineeringMatterWorkRevision)
      .where(
        and(
          eq(engineeringMatterWorkRevision.tenantId, input.tenantId),
          eq(engineeringMatterWorkRevision.matterId, input.matterId),
          eq(engineeringMatterWorkRevision.requestId, input.command.requestId),
        ),
      )
      .limit(1);
    if (requestRow) return requestRow;
    if (!input.source) return null;
    const [sourceRow] = await executor
      .select()
      .from(engineeringMatterWorkRevision)
      .where(
        and(
          eq(engineeringMatterWorkRevision.tenantId, input.tenantId),
          or(
            eq(
              engineeringMatterWorkRevision.actionAttemptId,
              input.source.actionAttemptId,
            ),
            eq(
              engineeringMatterWorkRevision.reviewTurnId,
              input.source.reviewTurnId,
            ),
          ),
        ),
      )
      .limit(1);
    return sourceRow ?? null;
  }

  private async resultForStored(
    executor: EngineeringMatterWorkingDatabaseExecutor,
    row: WorkRevisionRow,
    replayed: boolean,
  ): Promise<EngineeringMatterWorkingCommitResult> {
    const [previous] = await executor
      .select()
      .from(engineeringMatterWorkRevision)
      .where(
        and(
          eq(engineeringMatterWorkRevision.tenantId, row.tenantId),
          eq(engineeringMatterWorkRevision.matterId, row.matterId),
          eq(
            engineeringMatterWorkRevision.workingRevision,
            row.workingRevision - 1,
          ),
        ),
      )
      .limit(1);
    const currentState = parseEngineeringMatterWorkingState(
      row.stateJson,
      row.matterId,
    );
    const previousState = previous
      ? parseEngineeringMatterWorkingState(
          previous.stateJson,
          previous.matterId,
        )
      : null;
    return {
      revision: readModel(row),
      replayed,
      resultChanged:
        canonicalJson(previousState?.substantiveResult ?? null) !==
        canonicalJson(currentState.substantiveResult),
      coverageChanged:
        canonicalJson(previousState?.coverage ?? []) !==
        canonicalJson(currentState.coverage),
    };
  }
}

async function assertAllLinksOwned(
  executor: EngineeringMatterWorkingDatabaseExecutor,
  tenantId: string,
  matterRevisionId: string,
): Promise<void> {
  const rows = await executor.execute<{ allLinksOwned: boolean }>(
    sql`SELECT engineering_matter_all_links_owned_by_actor(
      ${tenantId}, ${matterRevisionId}
    ) AS "allLinksOwned"`,
  );
  if (rows[0]?.allLinksOwned !== true) {
    throw runtimeAuthorizationUnavailable();
  }
}

export function engineeringMatterInputBinding(input: {
  workItemId: string;
  workItemRevision: number;
  documentVersionId: string;
  projection: unknown;
}): EngineeringMatterWorkingInputBinding {
  const result = assessmentResultIdentity(input.projection);
  return {
    inputId: input.workItemId,
    workItemId: input.workItemId,
    workItemRevision: input.workItemRevision,
    documentVersionId: input.documentVersionId,
    resultRef: result?.resultRef ?? null,
    resultRevision: result?.resultRevision ?? null,
  };
}

async function loadCurrentInputBindings(
  executor: EngineeringMatterWorkingDatabaseExecutor,
  input: {
    tenantId: string;
    matterId: string;
    matterRevisionId: string;
  },
  requiredActorUserId?: string,
  lockMembers = false,
): Promise<EngineeringMatterWorkingInputBinding[]> {
  const query = executor
    .select({
      workItemId: workItem.workItemId,
      workItemRevision: workItem.revision,
      documentVersionId: workItem.documentVersionId,
      projectionJson: workItem.projectionJson,
      requestedByUserId: workItem.requestedByUserId,
      ordinal: engineeringMatterRevisionWorkItem.ordinal,
    })
    .from(engineeringMatterRevisionWorkItem)
    .innerJoin(
      workItem,
      and(
        eq(workItem.tenantId, input.tenantId),
        eq(workItem.workItemId, engineeringMatterRevisionWorkItem.workItemId),
      ),
    )
    .where(
      and(
        eq(engineeringMatterRevisionWorkItem.tenantId, input.tenantId),
        eq(engineeringMatterRevisionWorkItem.matterId, input.matterId),
        eq(
          engineeringMatterRevisionWorkItem.matterRevisionId,
          input.matterRevisionId,
        ),
      ),
    )
    .orderBy(asc(engineeringMatterRevisionWorkItem.ordinal));
  // SHARE (not KEY SHARE) also blocks revision, projection and owner updates.
  // Only append requests hold these locks until their transaction completes.
  const rows = await (lockMembers
    ? query.for('share', { of: workItem })
    : query);
  const materials = await loadMaterials(
    executor,
    input.tenantId,
    input.matterId,
    input.matterRevisionId,
  );
  if (rows.length === 0 && materials.length === 0)
    throw workingPersistenceError();
  if (
    requiredActorUserId &&
    rows.some((row) => row.requestedByUserId !== requiredActorUserId)
  ) {
    throw runtimeAuthorizationUnavailable();
  }
  return [
    ...rows.map((row) =>
      engineeringMatterInputBinding({
        workItemId: row.workItemId,
        workItemRevision: row.workItemRevision,
        documentVersionId: row.documentVersionId,
        projection: parseProjection(row.projectionJson),
      }),
    ),
    ...materialInputBindings(materials),
  ];
}

function assessmentResultIdentity(
  projection: unknown,
): { resultRef: string; resultRevision: number } | null {
  if (!isRecord(projection)) return null;
  const integrated = projection.integratedAssessment;
  if (!isRecord(integrated)) return null;
  const overall = integrated.overallSynthesis;
  if (!isRecord(overall)) return null;
  const reading = overall.readingResult;
  if (
    isRecord(reading) &&
    typeof reading.resultRef === 'string' &&
    reading.resultRef.trim() !== '' &&
    Number.isSafeInteger(reading.resultRevision) &&
    Number(reading.resultRevision) > 0
  ) {
    return {
      resultRef: reading.resultRef,
      resultRevision: Number(reading.resultRevision),
    };
  }
  if (
    typeof overall.sourceResultId === 'string' &&
    overall.sourceResultId.trim() !== '' &&
    Number.isSafeInteger(overall.revision) &&
    Number(overall.revision) > 0
  ) {
    return {
      resultRef: overall.sourceResultId,
      resultRevision: Number(overall.revision),
    };
  }
  return null;
}

function parseProjection(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw workingPersistenceError();
  }
}

function assertCommandBindingsCurrent(
  command: EngineeringMatterWorkingRevisionCommand,
  currentInputs: EngineeringMatterWorkingInputBinding[],
): void {
  const currentById = new Map(
    currentInputs.map((binding) => [binding.inputId, binding]),
  );
  const referenced = [
    ...command.substantiveInputs,
    ...command.coverageUpdates.map((coverage) => coverage.binding),
  ];
  for (const binding of referenced) {
    const current = currentById.get(binding.inputId);
    if (!current || canonicalJson(current) !== canonicalJson(binding)) {
      throw workingInputConflict();
    }
  }
}

function readModel(
  row: WorkRevisionRow,
): EngineeringMatterWorkingRevisionReadModel {
  const command = parseEngineeringMatterWorkingCommand(row.commandJson);
  const state = parseEngineeringMatterWorkingState(row.stateJson, row.matterId);
  if (
    row.updateKind !== command.updateKind ||
    row.changeSummary !== command.changeSummary ||
    row.basedOnMatterRevisionId !== command.basedOnMatterRevisionId ||
    row.substantiveResultRef !== (state.substantiveResult?.resultRef ?? null) ||
    row.substantiveResultRevision !==
      (state.substantiveResult?.resultRevision ?? null)
  ) {
    throw workingPersistenceError();
  }
  if (
    row.updateKind !== 'INITIAL_SYNTHESIS' &&
    row.updateKind !== 'CORRECTION' &&
    row.updateKind !== 'MATERIAL_INCORPORATION'
  ) {
    throw workingPersistenceError();
  }
  const source =
    row.actionAttemptId && row.reviewTurnId
      ? {
          actionAttemptId: row.actionAttemptId,
          reviewTurnId: row.reviewTurnId,
        }
      : null;
  if ((row.actionAttemptId === null) !== (row.reviewTurnId === null)) {
    throw workingPersistenceError();
  }
  return {
    matterWorkRevisionId: row.matterWorkRevisionId,
    matterId: row.matterId,
    workingRevision: row.workingRevision,
    basedOnMatterRevisionId: row.basedOnMatterRevisionId,
    updateKind: row.updateKind,
    changeSummary: row.changeSummary,
    substantiveResultRef: row.substantiveResultRef,
    substantiveResultRevision: row.substantiveResultRevision,
    state,
    change: engineeringMatterWorkingChangeFromCommand(command),
    source,
    createdAt: row.createdAt.toISOString(),
  };
}

function validateCommitInput(input: EngineeringMatterWorkingCommitInput): void {
  for (const value of [input.tenantId, input.matterId, input.actorUserId]) {
    if (value.trim() === '') throw workingInputConflict();
  }
  if (input.source) {
    if (
      input.source.actionAttemptId.trim() === '' ||
      input.source.reviewTurnId.trim() === ''
    ) {
      throw workingInputConflict();
    }
  }
}

function assertExactReplay(
  row: WorkRevisionRow,
  input: EngineeringMatterWorkingCommitInput,
): void {
  const sourceMatches = input.source
    ? row.actionAttemptId === input.source.actionAttemptId &&
      row.reviewTurnId === input.source.reviewTurnId
    : row.actionAttemptId === null && row.reviewTurnId === null;
  if (
    row.tenantId !== input.tenantId ||
    row.matterId !== input.matterId ||
    row.createdByUserId !== input.actorUserId ||
    row.commandJson !== canonicalJson(input.command) ||
    !sourceMatches
  ) {
    throw workingReplayMismatch();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String(error.code) === '23505'
  );
}

function workingMatterNotFound(): Error & { code: string; statusCode: number } {
  return coded('ENGINEERING_MATTER_NOT_FOUND', 404);
}

function workingCasConflict(): Error & { code: string; statusCode: number } {
  return coded('ENGINEERING_MATTER_WORKING_CAS_CONFLICT', 409);
}

function workingMembershipConflict(): Error & {
  code: string;
  statusCode: number;
} {
  return coded('ENGINEERING_MATTER_WORKING_MEMBERSHIP_CONFLICT', 409);
}

function workingInputConflict(): Error & { code: string; statusCode: number } {
  return coded('ENGINEERING_MATTER_WORKING_INPUT_CONFLICT', 409);
}

function workingReplayMismatch(): Error & { code: string; statusCode: number } {
  return coded('ENGINEERING_MATTER_WORKING_REQUEST_REPLAY_MISMATCH', 409);
}

function workingPersistenceError(): Error & {
  code: string;
  statusCode: number;
} {
  return coded('ENGINEERING_MATTER_WORKING_PERSISTENCE_INVALID', 500);
}

function runtimeAuthorizationUnavailable(): Error & {
  code: string;
  statusCode: number;
} {
  return coded('ENGINEERING_MATTER_RUNTIME_AUTHORIZATION_UNAVAILABLE', 404);
}

function coded(
  code: string,
  statusCode: number,
): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode });
}
