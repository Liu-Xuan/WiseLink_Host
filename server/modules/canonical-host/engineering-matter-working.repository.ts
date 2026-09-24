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
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { bindMatterOriginalInputs } from './matter-original-input-bindings';
import { buildMatterWorkReference } from './matter-work-reference';
import { collectIssueEvidenceUses } from '@shared/jobaid-evidence-uses';
import { dmDocumentParseRun } from '../../database/document-parsing.schema';

import type {
  EngineeringMatterWorkingCommitResult,
  EngineeringMatterWorkingInputBinding,
  EngineeringMatterWorkingRevisionCommand,
  EngineeringMatterWorkingRevisionReadModel,
  EngineeringMatterWorkingRevisionSource,
} from '@shared/matter-working.interface';

import {
  engineeringMatter,
  actionAttempt,
  engineeringMatterRevision,
  engineeringMatterRevisionWorkItem,
  engineeringMatterWorkRevision,
  identitySubjectMapping,
  workItem,
} from '../../database/schema';
import {
  canonicalJson,
  parseMatterTaskEnvelope,
} from '../action-attempt/action-attempt-envelope';
import type { OpenClawMatterTaskEnvelope } from '../action-attempt/action-attempt-envelope.types';
import { loadMaterials } from './engineering-matter.repository';
import { materialInputBindings } from './matter-material';
import { EngineeringSearchProjectionWriter } from './engineering-search-projection';
import { EngineeringReadPhaseObservation, observeEngineeringRead, observeEngineeringReadSync } from './engineering-read-phase-observation';
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
type SavedRowKey = { tenantId: string; matterId: string; workRef: string };

/** One catalogue window only. Both queries use the existing actor-bound database context. */
export interface EngineeringMatterSavedRowBatch {
  read(key: SavedRowKey): Promise<WorkRevisionRow | null>;
  skip(): void;
  checkSources(tenantId: string, workItemIds: Set<string>, documentVersionIds: Set<string>): Promise<void>;
  skipSources(): void;
}

function savedRowKey(key: SavedRowKey): string {
  return JSON.stringify([key.tenantId, key.matterId, key.workRef]);
}

const OFFICIAL_CLIENT_ID = 'cli_aadde8b579f95bc9';

export interface EngineeringMatterRuntimeAuthorization {
  currentMatterRevisionId: string;
  currentInputs: EngineeringMatterWorkingInputBinding[];
}

export interface EngineeringMatterCorrectionSaveProjection {
  attemptId: string | null;
  workRef: string;
  workingRevision: number;
  requestId: string;
}

/** Resolve only a durable work revision backed by its exact save receipt. */
export function savedCorrectionWorkRef(
  attemptId: string,
  reviewActivityJson: string | null,
  saves: EngineeringMatterCorrectionSaveProjection[],
): string | null {
  let events: unknown;
  try {
    events = reviewActivityJson ? JSON.parse(reviewActivityJson) : [];
  } catch {
    throw workingPersistenceError();
  }
  if (!Array.isArray(events)) throw workingPersistenceError();
  let selected: EngineeringMatterCorrectionSaveProjection | null = null;
  for (const saved of saves) {
    if (saved.attemptId !== attemptId) continue;
    const hasReceipt = events.some(event => event && typeof event === 'object' &&
      'kind' in event && event.kind === 'MATTER_JOBAID_WORK_SAVED' &&
      'requestId' in event && event.requestId === saved.requestId &&
      'workRevisionRef' in event && event.workRevisionRef === saved.workRef &&
      'expectedWorkRevision' in event && event.expectedWorkRevision === saved.workingRevision - 1);
    if (hasReceipt && (!selected || saved.workingRevision > selected.workingRevision)) selected = saved;
  }
  return selected?.workRef ?? null;
}

/** A comparison is unchanged only when the attempt durably recorded that exact retained work. */
export function hasCorrectionUnchangedReceipt(
  reviewActivityJson: string | null,
  expectedWorkRef: string,
  expectedWorkingRevision: number,
): boolean {
  let events: unknown;
  try {
    events = reviewActivityJson ? JSON.parse(reviewActivityJson) : [];
  } catch {
    throw workingPersistenceError();
  }
  if (!Array.isArray(events)) throw workingPersistenceError();
  return events.some(event => event && typeof event === 'object' &&
    'kind' in event && event.kind === 'MATTER_CORRECTION_UNCHANGED' &&
    'workRevisionRef' in event && event.workRevisionRef === expectedWorkRef &&
    'workRevision' in event && event.workRevision === expectedWorkingRevision);
}

@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided -- W1 registers/exports this in EngineeringMatterModule.
export class EngineeringMatterWorkingRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly sqlContext: SqlExecutionContextMiddleware,
    @Inject(DATAPAAS_CONFIG)
    private readonly databaseConfig: Pick<DataPaasConfig, 'roleSchema'>,
    private readonly searchProjection: EngineeringSearchProjectionWriter,
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
    operation: (executor: EngineeringMatterWorkingTransactionExecutor) => Promise<T>,
  ): Promise<T> {
    return this.withActorScope(actorUserId, () => this.db.transaction(
      transaction => operation(this.executor(transaction as PostgresJsDatabase)),
    ));
  }

  /** Keeps verified SQL identity across external calls without holding a transaction. */
  async withActorScope<T>(actorUserId: string, operation: () => Promise<T>): Promise<T> {
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
          void Promise.resolve().then(operation).then(resolve, reject);
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

  bindOriginalInputs(tenantId: string, inputs: EngineeringMatterWorkingInputBinding[]) {
    return bindMatterOriginalInputs(this.db, tenantId, inputs);
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
    return row ? authorizedReadModel(row, executor) : null;
  }

  createSavedRowBatch(expected: number, observation?: EngineeringReadPhaseObservation): EngineeringMatterSavedRowBatch {
    if (!Number.isInteger(expected) || expected < 2 || expected > 4) throw new Error('MATTER_SAVED_ROW_BATCH_INVALID');
    const pending: Array<{ key: SavedRowKey; resolve: (row: WorkRevisionRow | null) => void;
      reject: (error: unknown) => void }> = [];
    const sources: Array<{ tenantId: string; workItemIds: string[]; documentVersionIds: string[];
      resolve: () => void; reject: (error: unknown) => void }> = [];
    let arrived = 0;
    let dispatched = false;
    let sourceArrived = 0;
    let sourcesDispatched = false;
    const dispatch = () => {
      if (dispatched || arrived !== expected) return;
      dispatched = true;
      if (!pending.length) return;
      const unique = [...new Map(pending.map(item => [savedRowKey(item.key), item.key])).values()];
      void observeEngineeringRead(observation, 'saved_row_batch_query', () => this.db
        .select()
        .from(engineeringMatterWorkRevision)
        .where(or(...unique.map(key => and(
          eq(engineeringMatterWorkRevision.tenantId, key.tenantId),
          eq(engineeringMatterWorkRevision.matterId, key.matterId),
          eq(engineeringMatterWorkRevision.matterWorkRevisionId, key.workRef),
        ))))).then(rows => {
          const byKey = new Map(rows.map(row => [savedRowKey({ tenantId: row.tenantId,
            matterId: row.matterId, workRef: row.matterWorkRevisionId }), row]));
          pending.forEach(item => item.resolve(byKey.get(savedRowKey(item.key)) ?? null));
        }).catch(error => pending.forEach(item => item.reject(error)));
    };
    const arrive = () => {
      if (dispatched || ++arrived > expected) throw new Error('MATTER_SAVED_ROW_BATCH_OVERFLOW');
      dispatch();
    };
    // A root that is denied, missing, or malformed releases its source slot.
    // Each surviving root retains its own allowed result; no grant is cached.
    const dispatchSources = () => {
      if (sourcesDispatched || sourceArrived !== expected) return;
      sourcesDispatched = true;
      if (!sources.length) return;
      const roots = sources.map((source, index) => ({ index, tenantId: source.tenantId,
        workItemIds: source.workItemIds, documentVersionIds: source.documentVersionIds }));
      void observeEngineeringRead(observation, 'saved_sources_batch_query', () => this.db.execute<{
        index: number; allowed: boolean }>(sql`
        SELECT (root.value ->> 'index')::integer AS "index",
          NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(root.value -> 'workItemIds') AS w(id)
            WHERE engineering_matter_work_item_owned_by_actor(
              (root.value ->> 'tenantId')::varchar, w.id::varchar) IS NOT TRUE)
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(root.value -> 'documentVersionIds') AS d(id)
            WHERE engineering_matter_document_owned_by_actor(
              (root.value ->> 'tenantId')::varchar, d.id::varchar) IS NOT TRUE) AS "allowed"
        FROM jsonb_array_elements(${JSON.stringify(roots)}::jsonb) AS root(value)
      `)).then(rows => {
        const byIndex = new Map(rows.map(row => [row.index, row.allowed]));
        sources.forEach((source, index) => {
          if (byIndex.get(index) !== true) source.reject(runtimeAuthorizationUnavailable());
          else source.resolve();
        });
      }).catch(error => sources.forEach(source => source.reject(error)));
    };
    const arriveSource = () => {
      if (sourcesDispatched || ++sourceArrived > expected) throw new Error('MATTER_SOURCE_BATCH_OVERFLOW');
      dispatchSources();
    };
    return {
      read: key => new Promise<WorkRevisionRow | null>((resolve, reject) => {
        pending.push({ key, resolve, reject });
        arrive();
      }),
      skip: () => { arrive(); arriveSource(); },
      checkSources: (tenantId, workItemIds, documentVersionIds) => new Promise<void>((resolve, reject) => {
        sources.push({ tenantId, workItemIds: [...workItemIds], documentVersionIds: [...documentVersionIds],
          resolve, reject });
        arriveSource();
      }),
      skipSources: arriveSource,
    };
  }

  /** Exact saved identity, constrained before loading the full investigation body. */
  async readByRef(
    input: { tenantId: string; matterId: string; workRef: string;
      observation?: EngineeringReadPhaseObservation; batch?: EngineeringMatterSavedRowBatch },
    executor: EngineeringMatterWorkingDatabaseExecutor = this.db,
  ): Promise<EngineeringMatterWorkingRevisionReadModel | null> {
    const batch = input.batch;
    let sourceArrived = false;
    try {
      const row = await observeEngineeringRead(input.observation, 'saved_row_await', async () => {
        if (batch) return batch.read(input);
        const [found] = await executor.select().from(engineeringMatterWorkRevision).where(and(
          eq(engineeringMatterWorkRevision.tenantId, input.tenantId),
          eq(engineeringMatterWorkRevision.matterId, input.matterId),
          eq(engineeringMatterWorkRevision.matterWorkRevisionId, input.workRef),
        )).limit(1);
        return found ?? null;
      });
      return row ? authorizedReadModel(row, executor, new Set(), input.observation,
        batch ? (tenantId, workItemIds, documentVersionIds) => {
          sourceArrived = true;
          return batch.checkSources(tenantId, workItemIds, documentVersionIds);
        } : undefined) : null;
    } finally {
      if (batch && !sourceArrived) batch.skipSources();
    }
  }

  async readByRefForRuntime(input: {
    tenantId: string;
    matterId: string;
    workRef: string;
    actorUserId: string;
  }): Promise<EngineeringMatterWorkingRevisionReadModel | null> {
    return this.withActorTransaction(
      input.actorUserId,
      async ({ database }) => {
        await this.authorizeRuntimeInputs(input, database);
        const revision = await this.readByRef(input, database);
        if (revision)
          await this.authorizeRuntimeInputs(
            {
              ...input,
              basedOnMatterRevisionId: revision.basedOnMatterRevisionId,
            },
            database,
          );
        return revision;
      },
    );
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

  async findBySource(
    input: {
      tenantId: string;
      matterId: string;
      source: EngineeringMatterWorkingRevisionSource;
      requestId?: string;
    },
    executor: EngineeringMatterWorkingDatabaseExecutor = this.db,
  ): Promise<EngineeringMatterWorkingRevisionReadModel | null> {
    const [row] = await executor
      .select()
      .from(engineeringMatterWorkRevision)
      .where(
        and(
          eq(engineeringMatterWorkRevision.tenantId, input.tenantId),
          eq(engineeringMatterWorkRevision.matterId, input.matterId),
          ...(input.requestId
            ? [eq(engineeringMatterWorkRevision.requestId, input.requestId)]
            : []),
          eq(
            engineeringMatterWorkRevision.actionAttemptId,
            input.source.actionAttemptId,
          ),
          input.source.reviewTurnId === null
            ? isNull(engineeringMatterWorkRevision.reviewTurnId)
            : eq(
                engineeringMatterWorkRevision.reviewTurnId,
                input.source.reviewTurnId,
              ),
        ),
      )
      .orderBy(desc(engineeringMatterWorkRevision.workingRevision))
      .limit(1);
    return row ? authorizedReadModel(row, executor) : null;
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

  /** Re-authorize every frozen input and the exact prior work, not a latest substitute. */
  async authorizeAttemptWorkingBasis(
    input: {
      tenantId: string;
      matterId: string;
      actorUserId: string;
      basedOnMatterRevisionId: string;
      baseRevision: number;
      basis: OpenClawMatterTaskEnvelope['workingBasis'];
    },
    executor: EngineeringMatterWorkingDatabaseExecutor,
  ): Promise<void> {
    await this.authorizeRuntimeInputs(input, executor);
    const registered = await loadCurrentInputBindings(
      executor,
      {
        tenantId: input.tenantId,
        matterId: input.matterId,
        matterRevisionId: input.basedOnMatterRevisionId,
      },
      input.actorUserId,
    );
    const byId = new Map(
      registered.map((binding) => [binding.inputId, binding]),
    );
    if (
      input.basis.inputs.length !== byId.size ||
      new Set(input.basis.inputs.map((binding) => binding.inputId)).size !==
        byId.size
    )
      throw workingInputConflict();
    for (const frozen of input.basis.inputs) {
      const current = byId.get(frozen.inputId);
      const { original: _frozenOriginal, ...frozenIdentity } = frozen;
      const { original: _currentOriginal, ...currentIdentity } = current ?? {};
      if (
        !current ||
        frozen.workItemId !== current.workItemId ||
        (frozen.workItemId === null &&
          canonicalJson(frozenIdentity) !== canonicalJson(currentIdentity))
      )
        throw workingInputConflict();
      if (frozen.original) {
        const [original] = await executor.select({ id: dmDocumentParseRun.parseRunId }).from(dmDocumentParseRun)
          .where(and(eq(dmDocumentParseRun.tenantId,input.tenantId),eq(dmDocumentParseRun.documentVersionId,frozen.documentVersionId),
            eq(dmDocumentParseRun.parseRunId,frozen.original.parseRunId),eq(dmDocumentParseRun.parseRevision,frozen.original.parseRevision),
            eq(dmDocumentParseRun.status,'PUBLISHED'),sql`${dmDocumentParseRun.manifestArtifact}->>'relativePath' = 'original/manifest.json'`)).limit(1);
        if (!original) throw workingInputConflict();
      }
    }
    await assertOwnedSources(
      executor,
      input.tenantId,
      new Set(
        input.basis.inputs.flatMap((binding) =>
          binding.workItemId ? [binding.workItemId] : [],
        ),
      ),
      new Set(input.basis.inputs.map((binding) => binding.documentVersionId)),
    );
    if (input.basis.priorWorkRef === null) {
      if (input.baseRevision !== 0) throw workingInputConflict();
    } else {
      const prior = await this.readByRef(
        {
          tenantId: input.tenantId,
          matterId: input.matterId,
          workRef: input.basis.priorWorkRef,
        },
        executor,
      );
      if (!prior || prior.workingRevision !== input.baseRevision)
        throw workingInputConflict();
    }
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
    const frozenInputs =
      input.source?.reviewTurnId === null
        ? await this.frozenAttemptInputs(input, executor)
        : null;
    if (
      frozenInputs === null &&
      matter.currentMatterRevisionId !== input.command.basedOnMatterRevisionId
    ) {
      throw workingMembershipConflict();
    }

    const currentInputs =
      frozenInputs ??
      (await loadCurrentInputBindings(
        executor,
        {
          tenantId: input.tenantId,
          matterId: input.matterId,
          matterRevisionId: matter.currentMatterRevisionId,
        },
        input.actorUserId,
        true,
      ));
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
    for (const condition of input.command.reviewConditionDelta?.upserts ?? []) {
      const when = condition.when;
      if (when?.kind !== 'ORIGINAL_CHANGED') continue;
      const prior = current?.state.reviewConditions.find(item => item.itemId === condition.itemId)?.when;
      if (prior?.kind === 'ORIGINAL_CHANGED' && prior.inputId === when.inputId && prior.afterParseRunId === when.afterParseRunId) continue;
      const binding = currentInputs.find(item => item.inputId === when.inputId);
      if (!binding || (binding.original?.parseRunId ?? null) !== when.afterParseRunId)
        throw new Error('MATTER_REVISIT_SOURCE_BINDING_INVALID');
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
    if (materialized.state.problemWork) {
      await this.searchProjection.enqueuePending({ tenantId: stored.tenantId, ownerKind: 'MATTER',
        ownerId: stored.createdByUserId, subjectId: stored.matterId,
        revisionRef: stored.matterWorkRevisionId, database: executor });
    }
    return {
      revision: await authorizedReadModel(stored, executor),
      replayed: false,
      resultChanged: materialized.resultChanged,
      coverageChanged: materialized.coverageChanged,
    };
  }

  private async frozenAttemptInputs(
    input: EngineeringMatterWorkingCommitInput,
    executor: EngineeringMatterWorkingDatabaseExecutor,
  ): Promise<EngineeringMatterWorkingInputBinding[]> {
    const [attempt] = await executor
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.attemptId, input.source!.actionAttemptId),
          eq(actionAttempt.tenantId, input.tenantId),
          eq(actionAttempt.actorUserId, input.actorUserId),
          eq(actionAttempt.subjectKind, 'ENGINEERING_MATTER'),
          eq(actionAttempt.matterId, input.matterId),
        ),
      )
      .limit(1)
      .for('share');
    const invalid = () =>
      coded('ENGINEERING_MATTER_WORKING_SOURCE_INVALID', 409);
    if (
      !attempt ||
      !['RUNNING', 'COMMITTING'].includes(attempt.status) ||
      !attempt.taskEnvelopeJson ||
      attempt.matterRevisionId !== input.command.basedOnMatterRevisionId ||
      (attempt.status === 'COMMITTING' &&
        (attempt.baseRevision !== input.command.expectedWorkingRevision ||
          attempt.triggerRequestId !== input.command.requestId))
    )
      throw invalid();
    const task = parseMatterTaskEnvelope(attempt.taskEnvelopeJson);
    if (
      task.actionAttemptId !== attempt.attemptId ||
      task.operationRef !== attempt.operationRef ||
      task.tenantId !== input.tenantId ||
      task.subject.matterId !== input.matterId ||
      task.subject.matterRevisionId !== attempt.matterRevisionId ||
      task.baseRevision !== attempt.baseRevision ||
      task.inputRevision !== attempt.inputRevision ||
      task.inputHash !== attempt.taskInputHash
    )
      throw invalid();
    await this.authorizeAttemptWorkingBasis(
      {
        tenantId: input.tenantId,
        matterId: input.matterId,
        actorUserId: input.actorUserId,
        basedOnMatterRevisionId: task.subject.matterRevisionId,
        baseRevision: task.baseRevision,
        basis: task.workingBasis,
      },
      executor,
    );
    if (attempt.status === 'RUNNING') {
      const current = await this.loadCurrent(input, executor);
      if (
        (current?.workingRevision ?? 0) !==
          input.command.expectedWorkingRevision ||
        ((current?.workingRevision ?? 0) !== task.baseRevision &&
          current?.source?.actionAttemptId !== attempt.attemptId)
      )
        throw workingCasConflict();
    }
    return task.workingBasis.inputs;
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
    if (!input.source || input.source.reviewTurnId === null) return null;
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
            ...(input.source.reviewTurnId === null
              ? []
              : [
                  eq(
                    engineeringMatterWorkRevision.reviewTurnId,
                    input.source.reviewTurnId,
                  ),
                ]),
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
      revision: await authorizedReadModel(row, executor),
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
  return bindMatterOriginalInputs(executor, input.tenantId, [
    ...rows.map((row) =>
      engineeringMatterInputBinding({
        workItemId: row.workItemId,
        workItemRevision: row.workItemRevision,
        documentVersionId: row.documentVersionId,
        projection: parseProjection(row.projectionJson),
      }),
    ),
    ...materialInputBindings(materials),
  ]);
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

/** Check retained sources after choosing the exact/latest row: never fall back to older work. */
async function authorizedReadModel(
  row: WorkRevisionRow,
  executor: EngineeringMatterWorkingDatabaseExecutor,
  ancestors: Set<string> = new Set(),
  observation?: EngineeringReadPhaseObservation,
  checkSources?: (tenantId: string, workItemIds: Set<string>, documentVersionIds: Set<string>) => Promise<void>,
): Promise<EngineeringMatterWorkingRevisionReadModel> {
  if (ancestors.has(row.matterWorkRevisionId)) throw workingPersistenceError();
  const ancestry = new Set(ancestors).add(row.matterWorkRevisionId);
  const revision = observeEngineeringReadSync(observation, 'saved_state_parse', () => readModel(row));
  const bindings = [
    ...revision.state.substantiveInputs,
    ...revision.state.coverage.map((item) => item.binding),
  ];
  const evidence = [
    ...(revision.state.substantiveResult?.evidence ?? []),
    ...(revision.state.problemWork?.evidence ?? []),
  ];
  const workItemIds = new Set([
    ...bindings.flatMap((item) => (item.workItemId ? [item.workItemId] : [])),
    ...evidence.flatMap((item) =>
      'workItemId' in item && item.workItemId ? [item.workItemId] : [],
    ),
  ]);
  const documentVersionIds = new Set([
    ...bindings.map((item) => item.documentVersionId),
    ...evidence.flatMap((item) =>
      item.kind === 'DOCUMENT_PASSAGE' ? [item.documentVersionId] : [],
    ),
  ]);
  await observeEngineeringRead(observation, 'saved_sources_await', () => checkSources
    ? checkSources(row.tenantId, workItemIds, documentVersionIds)
    : assertOwnedSources(executor, row.tenantId, workItemIds, documentVersionIds));
  // Resolve the last explicit saved overview, using the same authorized history.
  // A status flag or matching save time cannot identify the work that supplied it.
  // Never reach backward across a different/absent overview merely because older
  // prose happens to match again; historical rows without receipts stay unknown.
  revision.overviewSourceWork = null;
  if (revision.state.problemWork && revision.state.problemWork.overviewStatus !== 'NOT_AVAILABLE') {
    const overview = revision.state.problemWork.understanding;
    const [origin] = await observeEngineeringRead(observation, 'overview_origin_await', () =>
      executor.execute<{ workRef: string; workingRevision: number; submittedOverview: string }>(sql`
      SELECT w.matter_work_revision_id AS "workRef", w.working_revision AS "workingRevision",
        receipt -> 'proposal' ->> 'overview' AS "submittedOverview"
      FROM engineering_matter_work_revision w
      JOIN action_attempt a ON a.attempt_id = w.action_attempt_id
        AND a.tenant_id = w.tenant_id AND a.matter_id = w.matter_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.review_activity_json::jsonb, '[]'::jsonb)) receipt
      WHERE w.tenant_id = ${row.tenantId} AND w.matter_id = ${row.matterId}
        AND w.created_by_user_id = ${row.createdByUserId}
        AND w.working_revision <= ${row.workingRevision}
        AND w.state_json::jsonb -> 'problemWork' ->> 'understanding' = ${overview}
        AND receipt ->> 'kind' = 'MATTER_JOBAID_WORK_SAVED'
        AND receipt ->> 'workRevisionRef' = w.matter_work_revision_id
        AND receipt ->> 'requestId' = w.request_id
        AND receipt -> 'expectedWorkRevision' = to_jsonb(w.working_revision - 1)
        AND jsonb_typeof(receipt -> 'proposal' -> 'overview') = 'string'
        AND NOT EXISTS (
          SELECT 1 FROM engineering_matter_work_revision later
          WHERE later.tenant_id = w.tenant_id AND later.matter_id = w.matter_id
            AND later.working_revision > w.working_revision AND later.working_revision <= ${row.workingRevision}
            AND (later.state_json::jsonb -> 'problemWork' ->> 'understanding' IS DISTINCT FROM ${overview}
              OR later.state_json::jsonb -> 'problemWork' ->> 'overviewStatus' = 'NOT_AVAILABLE')
        )
      ORDER BY w.working_revision DESC LIMIT 1
    `));
    if (origin) {
      if (origin.submittedOverview.trim() !== overview) throw workingPersistenceError();
      revision.overviewSourceWork = { workRef: origin.workRef, workingRevision: origin.workingRevision };
    }
  }
  // A saved B explanation does not keep A readable after A or its original inputs are revoked.
  // Walk exact immutable work identities, not the latest analysis or a detached excerpt.
  const checkedReferences = new Map<string, string>();
  for (const item of evidence) {
    if (item.kind !== 'PRIOR_RESULT' || !item.sourceWork) continue;
    const ref = item.sourceWork;
    const referenceKey = canonicalJson(ref);
    if (checkedReferences.has(referenceKey)) {
      if (checkedReferences.get(referenceKey) !== canonicalJson(item)) throw workingPersistenceError();
      continue;
    }
    const [sourceMatter] = await observeEngineeringRead(observation, 'prior_current_matter_await', () =>
      executor.select({ currentMatterRevisionId: engineeringMatter.currentMatterRevisionId })
        .from(engineeringMatter).where(and(eq(engineeringMatter.tenantId, row.tenantId),
          eq(engineeringMatter.matterId, ref.subjectId), eq(engineeringMatter.createdByUserId, row.createdByUserId))).limit(1));
    if (!sourceMatter) throw runtimeAuthorizationUnavailable();
    await observeEngineeringRead(observation, 'prior_current_links_await', () =>
      assertAllLinksOwned(executor, row.tenantId, sourceMatter.currentMatterRevisionId));
    const [source] = await observeEngineeringRead(observation, 'prior_saved_row_await', () =>
      executor.select().from(engineeringMatterWorkRevision).where(and(
        eq(engineeringMatterWorkRevision.tenantId, row.tenantId), eq(engineeringMatterWorkRevision.matterId, ref.subjectId),
        eq(engineeringMatterWorkRevision.matterWorkRevisionId, ref.workRef),
        eq(engineeringMatterWorkRevision.createdByUserId, row.createdByUserId))).limit(1));
    if (!source || source.workingRevision !== item.resultRevision || item.resultRef !== ref.workRef)
      throw runtimeAuthorizationUnavailable();
    await observeEngineeringRead(observation, 'prior_saved_links_await', () =>
      assertAllLinksOwned(executor, row.tenantId, source.basedOnMatterRevisionId));
    const sourceRevision = await observeEngineeringRead(observation, 'prior_recursive_read', () =>
      authorizedReadModel(source, executor, ancestry, observation));
    observeEngineeringReadSync(observation, 'prior_verify_reference_js', () => {
      if (!sourceRevision.state.problemWork?.issues.some(issue => issue.issueKey === ref.issueKey))
        throw runtimeAuthorizationUnavailable();
      const verified = buildMatterWorkReference({ matterId: ref.subjectId, workRef: ref.workRef,
        issueKey: ref.issueKey, purpose: 'Verify saved lineage' }, sourceRevision);
      const expected = verified[0]!;
      if (expected.kind !== 'PRIOR_RESULT' || canonicalJson(expected) !== canonicalJson(item))
        throw workingPersistenceError();
      for (const rootRef of expected.originalEvidenceRefs) {
        const original = verified.find(value => value.evidenceRef === rootRef);
        const retained = evidence.find(value => value.evidenceRef === rootRef);
        if (!original || !retained || canonicalJson(original) !== canonicalJson(retained)) throw workingPersistenceError();
      }
      const affectedIssueKeys = (revision.state.problemWork?.issues ?? []).filter(issue =>
        collectIssueEvidenceUses(issue).some(use => use.evidenceRef === item.evidenceRef)).map(issue => issue.issueKey);
      if (affectedIssueKeys.length) {
        (revision.referenceWorkNotices ??= []).push({ sourceWork: structuredClone(ref), evidenceRef: item.evidenceRef,
          affectedIssueKeys, overviewStatus: sourceRevision.state.problemWork.overviewStatus,
          correctionNotices: structuredClone(sourceRevision.correctionNotices?.filter(notice => notice.issueKey === ref.issueKey) ?? []),
          overviewCorrectionNotices: structuredClone(sourceRevision.overviewCorrectionNotices ?? []) });
      }
      checkedReferences.set(referenceKey, canonicalJson(expected));
    });
  }
  // A Matter attempt can carry hundreds of KB of source catalog. Materialize
  // only the two small review-purpose objects so WHERE, match flags and output
  // do not repeatedly cast the full task envelope from text to jsonb.
  // jsonb_path_query_first returns SQL NULL for absent/non-object modelInput,
  // retaining the former non-match behavior of -> on malformed shape.
  const noticeAttempts = await executor.execute<{
    id: string; attemptRef: string | null; status: string;
    isCorrection: boolean | null; isOverview: boolean | null;
    correctionPurpose: { kind: string; expectedWorkRef: string; issueKey: string; correctionReason: string } | null;
    overviewPurpose: { kind: string; expectedWorkRef: string; correctionReason: string } | null;
    reviewActivityJson: string | null;
  }>(sql`
    WITH scoped AS MATERIALIZED (
      SELECT a.attempt_id AS "id", a.operation_ref AS "attemptRef", a.status,
        a.review_activity_json AS "reviewActivityJson", a.created_at AS "createdAt",
        purpose.correction AS "correctionPurpose",
        purpose."overviewCorrection" AS "overviewPurpose"
      FROM action_attempt a
      CROSS JOIN LATERAL jsonb_to_record(jsonb_path_query_first(
        a.task_envelope_json::jsonb, '$.modelInput ? (@.type() == "object")'
      )) AS purpose(correction jsonb, "overviewCorrection" jsonb)
      WHERE a.tenant_id = ${row.tenantId} AND a.matter_id = ${row.matterId}
        AND a.subject_kind = 'ENGINEERING_MATTER'
        AND a.action_type = 'OPENCLAW_MATTER_ASSESSMENT'
    ), matched AS MATERIALIZED (
      SELECT scoped.*,
        (scoped."correctionPurpose" ->> 'kind' = 'ENGINEERING_ISSUE_CORRECTION'
          AND scoped."correctionPurpose" ->> 'expectedWorkRef' = ${row.matterWorkRevisionId}) AS "isCorrection",
        (scoped."overviewPurpose" ->> 'kind' = 'ENGINEERING_OVERVIEW_CORRECTION'
          AND scoped."overviewPurpose" ->> 'expectedWorkRef' IN (
            SELECT w.matter_work_revision_id FROM engineering_matter_work_revision w
            WHERE w.tenant_id = ${row.tenantId} AND w.matter_id = ${row.matterId}
              AND w.created_by_user_id = ${row.createdByUserId}
              AND w.working_revision <= ${row.workingRevision}
          )) AS "isOverview"
      FROM scoped
    )
    SELECT "id", "attemptRef", status, "reviewActivityJson",
      "correctionPurpose", "overviewPurpose", "isCorrection", "isOverview"
    FROM matched WHERE "isCorrection" OR "isOverview"
    ORDER BY "createdAt" ASC
  `);
  const corrections = noticeAttempts.filter(item => item.isCorrection);
  const overviewCorrections = noticeAttempts.filter(item => item.isOverview);
  // One scoped save lookup serves both notice types. Correction receipts still
  // decide the exact saved work; overview-only attempts need their latest row.
  const correctionAttemptIds = corrections.map(item => item.id);
  const noticeAttemptIds = [...new Set([...corrections, ...overviewCorrections].map(item => item.id))];
  const rankedSaves = executor.select({
    attemptId: engineeringMatterWorkRevision.actionAttemptId,
    workRef: engineeringMatterWorkRevision.matterWorkRevisionId,
    workingRevision: engineeringMatterWorkRevision.workingRevision,
    requestId: engineeringMatterWorkRevision.requestId,
    saveRank: sql<number>`row_number() over (partition by ${engineeringMatterWorkRevision.actionAttemptId}
      order by ${engineeringMatterWorkRevision.workingRevision} desc)`.as('save_rank'),
  }).from(engineeringMatterWorkRevision).where(and(
    eq(engineeringMatterWorkRevision.tenantId, row.tenantId),
    eq(engineeringMatterWorkRevision.matterId, row.matterId),
    eq(engineeringMatterWorkRevision.createdByUserId, row.createdByUserId),
    inArray(engineeringMatterWorkRevision.actionAttemptId, noticeAttemptIds),
  )).as('ranked_notice_saves');
  const noticeSaves = noticeAttemptIds.length ? await executor.select({
    attemptId: rankedSaves.attemptId, workRef: rankedSaves.workRef,
    workingRevision: rankedSaves.workingRevision, requestId: rankedSaves.requestId,
  }).from(rankedSaves).where(correctionAttemptIds.length
    ? or(inArray(rankedSaves.attemptId, correctionAttemptIds), eq(rankedSaves.saveRank, 1))
    : eq(rankedSaves.saveRank, 1)).orderBy(asc(rankedSaves.workingRevision)) : [];
  const savedCorrectionWork = new Map<string, string>();
  for (const item of corrections) {
    const saved = savedCorrectionWorkRef(item.id, item.reviewActivityJson, noticeSaves);
    if (saved) savedCorrectionWork.set(item.id, saved);
  }
  if (corrections.length) revision.correctionNotices = corrections.map(item => {
    if (!item.attemptRef || typeof item.correctionPurpose?.expectedWorkRef !== 'string' ||
        typeof item.correctionPurpose?.issueKey !== 'string' || typeof item.correctionPurpose?.correctionReason !== 'string')
      throw new Error('ENGINEERING_CORRECTION_NOTICE_INVALID');
    const correctedWorkRef = savedCorrectionWork.get(item.id) ?? null;
    const unchanged = correctedWorkRef === null && hasCorrectionUnchangedReceipt(
      item.reviewActivityJson, item.correctionPurpose.expectedWorkRef, row.workingRevision);
    return { attemptRef: item.attemptRef, issueKey: item.correctionPurpose.issueKey, reason: item.correctionPurpose.correctionReason,
      ...(unchanged ? { unchanged: true } : {}),
      attemptStatus: item.status, correctedWorkRef };
  });
  // These are the owner's explicit review requests, not extracted old source text.
  // Retain their target identity across later work so an unrelated save cannot
  // silently erase a known review. Historical reads exclude requests about newer work.
  for (const item of overviewCorrections) {
    if (!item.attemptRef || typeof item.overviewPurpose?.expectedWorkRef !== 'string' ||
        typeof item.overviewPurpose?.correctionReason !== 'string' || !item.overviewPurpose.correctionReason.trim())
      throw new Error('ENGINEERING_OVERVIEW_CORRECTION_NOTICE_INVALID');
  }
  // Rows are ordered by working revision, so the last row for an attempt is
  // the same latest save as the former DISTINCT ON query.
  const overviewSaveByAttempt = new Map(noticeSaves.map(saved => [saved.attemptId, saved]));
  for (const item of overviewCorrections) {
    const saved = overviewSaveByAttempt.get(item.id);
    (revision.overviewCorrectionNotices ??= []).push({ attemptRef: item.attemptRef,
      targetWorkRef: item.overviewPurpose.expectedWorkRef, reason: item.overviewPurpose.correctionReason,
      attemptStatus: item.status, savedWorkRef: saved?.workRef ?? null, savedWorkingRevision: saved?.workingRevision ?? null });
  }
  return revision;
}

async function assertOwnedSources(
  executor: EngineeringMatterWorkingDatabaseExecutor,
  tenantId: string,
  workItemIds: Set<string>,
  documentVersionIds: Set<string>,
): Promise<void> {
  const [access] = await executor.execute<{ allowed: boolean }>(sql`
    SELECT NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(${JSON.stringify([...workItemIds])}::jsonb) AS w(id)
      WHERE engineering_matter_work_item_owned_by_actor(${tenantId}, w.id::varchar) IS NOT TRUE
    ) AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(${JSON.stringify([...documentVersionIds])}::jsonb) AS d(id)
      WHERE engineering_matter_document_owned_by_actor(${tenantId}, d.id::varchar) IS NOT TRUE
    ) AS allowed
  `);
  if (access?.allowed !== true) throw runtimeAuthorizationUnavailable();
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
  const source: EngineeringMatterWorkingRevisionSource | null =
    row.actionAttemptId && row.reviewTurnId
      ? {
          actionAttemptId: row.actionAttemptId,
          reviewTurnId: row.reviewTurnId,
        }
      : row.actionAttemptId
        ? {
            kind: 'ENGINEERING_MATTER',
            actionAttemptId: row.actionAttemptId,
            reviewTurnId: null,
          }
        : null;
  if (row.actionAttemptId === null && row.reviewTurnId !== null) {
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
      (input.source.reviewTurnId === null
        ? !('kind' in input.source) ||
          input.source.kind !== 'ENGINEERING_MATTER'
        : input.source.reviewTurnId.trim() === '')
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
