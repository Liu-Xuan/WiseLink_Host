import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type {
  HierarchicalWikiClassificationRequest,
  HierarchicalWikiEnableRequest,
  HierarchicalWikiList,
  HierarchicalWikiStatus,
} from '@shared/hierarchical-wiki.interface';
import type {
  DerivedSummaryMember,
  RequestDerivedSummaryUpdate,
} from '@shared/derived-summary.interface';
import type { CanonicalHostActor } from './canonical-host.types';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedAutoWorkItemQueueScope,
} from './canonical-service-scope.authorization';
import { DerivedSummaryRepository, type SummaryAttempt } from './derived-summary.repository';
import {
  checkedSummaryTask,
  DerivedSummaryService,
} from './derived-summary.service';
import {
  DerivedSummaryMembersService,
  type SummaryActor,
} from './derived-summary-members.service';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { CanonicalFleetMasterDataRepository } from './canonical-fleet-master-data.repository';
import { taskModelSelection } from '../model-settings/canonical-model-catalog';
import { CanonicalModelSettingsService } from '../model-settings/canonical-model-settings.service';
import {
  mergeWikiDemand,
  wikiDemandState,
  wikiDue,
  retryWikiDemand,
  type WikiVersions,
} from './hierarchical-wiki-demand';
import {
  readActiveWikiAttempt,
  reconcileWikiReservations,
  wikiReservationNeedsReconciliation,
  wikiRequestHasSavedRevision,
} from './hierarchical-wiki-attempt-reconciliation';
import {
  ensureWiki,
  lockWiki,
  lockWikiBranch,
  lockWikiRoots,
  storeWikiDemand,
  wikiRows,
  type WikiRow,
} from './hierarchical-wiki.persistence';
import { readWikiInventory, wikiScopeFor } from './hierarchical-wiki-inventory';
import { wikiDirectVersions, wikiLayerInstruction } from './hierarchical-wiki-generation';
import { summaryError } from './derived-summary.validation';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { MatterActionAttemptService } from './matter-action-attempt.service';
import { readWikiGuideNavigation } from './hierarchical-wiki-navigation';
import type { WikiGuideNavigationPage } from '@shared/wiki-guide.interface';
import type {
  CanonicalMatterAttemptAuthorization,
  CanonicalVerifiedMatterAttemptScope,
} from './canonical-service-scope.authorization';

@Injectable()
export class HierarchicalWikiService {
  private readonly logger = new Logger(HierarchicalWikiService.name);
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly repository: DerivedSummaryRepository,
    private readonly summaries: DerivedSummaryService,
    private readonly members: DerivedSummaryMembersService,
    private readonly transactions: EngineeringMatterWorkingRepository,
    private readonly fleet: CanonicalFleetMasterDataRepository,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly authorization: CanonicalServiceScopeAuthorizationPort,
    @Optional() private readonly matterAttempts?: MatterActionAttemptService,
    @Optional() private readonly models?: CanonicalModelSettingsService,
  ) {}

  async enable(
    input: HierarchicalWikiEnableRequest,
    actor: CanonicalHostActor,
  ): Promise<HierarchicalWikiList> {
    const catalog = await this.fleet.readLibraryCatalog({
      tenantId: actor.tenantId,
      asOf: new Date().toISOString().slice(0, 10),
    });
    const family = catalog.families.find(
      (item) => item.fleetFamily === input.fleetFamilyId,
    );
    if (
      catalog.status !== 'AVAILABLE' ||
      !family ||
      (input.fleetModelId && !family.models.includes(input.fleetModelId))
    )
      throw summaryError('WIKI_FLEET_SCOPE_UNAVAILABLE', 400);
    if (input.modelRef !== undefined) taskModelSelection(input.modelRef, new Date());
    const scope = await this.authorization.authorizeOpenClawAutoWorkItemQueue();
    this.assertScope(scope, actor.tenantId);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.repository.browser(actor, async (database, owner) => {
          await lockWikiRoots(database, owner);
          if (!this.models) throw summaryError('WIKI_MODEL_SETTINGS_UNAVAILABLE', 503);
          const configured = await this.models.captureForNewTask(owner.tenantId, new Date(), database);
          if (input.modelRef !== undefined && input.modelRef !== configured.modelRef)
            throw summaryError('WIKI_AUTOMATIC_MODEL_CONFIGURATION_MISMATCH', 400);
          const root = await ensureWiki(
            database,
            owner,
            wikiScopeFor(input, null),
            scope.principalId,
            configured.modelRef,
            null,
          );
          if (root.principalId !== scope.principalId)
            throw summaryError('WIKI_DELEGATION_CHANGED');
          await database.execute(sql`UPDATE hierarchical_wiki_scope SET enabled=true WHERE wiki_id=${root.wikiId}
            OR (tenant_id=${owner.tenantId} AND actor_user_id=${owner.actorUserId}
              AND scope_json->>'fleetFamilyId'=${input.fleetFamilyId} AND scope_json->'fleetModelIds'=${JSON.stringify(root.scope.fleetModelIds)}::jsonb)`);
          await this.refresh(database, owner, new Date().toISOString(), true);
        });
        return await this.readList(actor);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== 'WIKI_SCOPE_RESERVATION_RACE' ||
          attempt === 1
        )
          throw error;
      }
    }
    throw summaryError('WIKI_SCOPE_RESERVATION_FAILED');
  }

  async list(
    actor: CanonicalHostActor,
    cursor?: string,
  ): Promise<HierarchicalWikiList> {
    return this.readList(actor, cursor);
  }

  navigation(input: unknown, actor: CanonicalHostActor): Promise<WikiGuideNavigationPage> {
    return this.repository.readBrowser(actor, (database, reader) =>
      readWikiGuideNavigation(database, reader, input));
  }

  /** Explicit browser engineering-analysis delegation, distinct from reading
   * and Wiki directory classification. Existing Matter models and source guards
   * still govern every background operation. */
  async delegateMatter(
    summaryId: string,
    input: { matterId: string; enabled: boolean },
    actor: CanonicalHostActor,
  ) {
    return this.repository.browser(actor, async (database, owner) => {
      if (input.enabled)
        await this.transactions.authorizeRuntimeInputs(
          { ...owner, matterId: input.matterId },
          database,
        );
      const base = (await wikiRows(database, owner)).find(
        (row) => row.summaryId === summaryId,
      );
      if (!base) throw summaryError('WIKI_UNAVAILABLE', 404);
      const root = (await wikiRows(database, owner)).find(
        (row) =>
          row.scope.kind === 'FLEET' &&
          row.scope.fleetFamilyId === base.scope.fleetFamilyId &&
          canonicalJson(row.scope.fleetModelIds) ===
            canonicalJson(base.scope.fleetModelIds),
      );
      if (!root) throw summaryError('WIKI_UNAVAILABLE', 404);
      const locked = await lockWiki(database, root);
      const delegations = {
        ...locked.upstreamDelegations,
        [input.matterId]: {
          enabled: input.enabled,
          authorizedAt: new Date().toISOString(),
        },
      };
      await database.execute(sql`UPDATE hierarchical_wiki_scope SET upstream_delegations_json=${JSON.stringify(delegations)}::jsonb
        WHERE wiki_id=${root.wikiId}`);
      return {
        status: 'UPDATED' as const,
        summaryId,
        matterId: input.matterId,
        enabled: input.enabled,
      };
    });
  }

  async cleanup(input: {
    kind: 'SUMMARY' | 'MATTER';
    subjectId: string;
    attemptRef: string;
    operation: 'STATUS' | 'CANCEL';
  }) {
    const scope = await this.authorization.authorizeOpenClawAutoWorkItemQueue();
    this.assertScope(scope, scope.tenantId);
    const rows = await this.db.execute<{
      receipt: {
        status: string;
        attemptRef: string;
        errorCode: string | null;
        summaryId?: string;
        matterId?: string;
        savedSummaryRefs: string[];
      };
    }>(sql`SELECT hierarchical_wiki_cleanup(
        ${scope.tenantId},${scope.principalId},${input.kind},${input.subjectId},${input.attemptRef},${input.operation}) AS receipt`);
    if (!rows[0]) throw summaryError('WIKI_ATTEMPT_UNAVAILABLE', 404);
    return rows[0].receipt;
  }

  async authorizeMatter(input: {
    matterId: string;
    attemptRef?: string;
    operation?: CanonicalMatterAttemptAuthorization['operation'];
  }): Promise<
    Omit<CanonicalVerifiedMatterAttemptScope, 'attemptRef'> & {
      attemptRef?: string;
    }
  > {
    const scope = await this.authorization.authorizeOpenClawAutoWorkItemQueue();
    this.assertScope(scope, scope.tenantId);
    const allowClosed =
      !!input.attemptRef &&
      ['STATUS', 'CANCEL', 'READ_SAVED_WORK'].includes(input.operation ?? '');
    const rows = await this.db.execute<{
      actor: string | null;
    }>(sql`SELECT hierarchical_wiki_matter_actor(
      ${scope.tenantId},${scope.principalId},${input.matterId},${input.attemptRef ?? null},${allowClosed}) AS actor`);
    if (!rows[0]?.actor)
      throw summaryError('WIKI_MATTER_DELEGATION_UNAVAILABLE', 404);
    return {
      appId: scope.appId,
      tenantId: scope.tenantId,
      principalId: scope.principalId,
      actorUserId: rows[0].actor,
      matterId: input.matterId,
      ...(input.attemptRef ? { attemptRef: input.attemptRef } : {}),
    };
  }

  async classify(
    summaryId: string,
    input: HierarchicalWikiClassificationRequest,
    actor: CanonicalHostActor,
  ): Promise<HierarchicalWikiList> {
    await this.repository.browser(actor, async (database, owner) => {
      const base = (await wikiRows(database, owner)).find(
        (row) => row.summaryId === summaryId,
      );
      if (!base) throw summaryError('WIKI_UNAVAILABLE', 404);
      const target: HierarchicalWikiEnableRequest = {
        fleetFamilyId: base.scope.fleetFamilyId,
        fleetModelId: base.scope.fleetModelIds[0] ?? null,
        modelRef: base.modelRef,
      };
      let documentVersionId: string | null = null;
      if (input.sourceKind === 'DOCUMENT') {
        const rows = await database.execute<{
          id: string;
        }>(sql`SELECT current_document_version_id AS id FROM dm_publication_family
          WHERE family_id=${input.sourceId} AND engineering_matter_document_owned_by_actor(${owner.tenantId},current_document_version_id)`);
        if (!rows[0]) throw summaryError('WIKI_SOURCE_UNAVAILABLE', 404);
        documentVersionId = rows[0].id;
      } else
        await this.transactions.authorizeRuntimeInputs(
          { ...owner, matterId: input.sourceId },
          database,
        );
      await lockWikiRoots(database, owner);
      const root = await ensureWiki(
        database,
        owner,
        wikiScopeFor(target, null),
        base.principalId,
        base.modelRef,
        null,
      );
      const parent = input.ata
        ? await ensureWiki(
            database,
            owner,
            wikiScopeFor(target, input.ata.slice(0, 2)),
            base.principalId,
            base.modelRef,
            root,
          )
        : root;
      const node =
        input.ata && input.ata.length > 2
          ? await ensureWiki(
              database,
              owner,
              wikiScopeFor(target, input.ata),
              base.principalId,
              base.modelRef,
              parent,
            )
          : parent;
      const key = `${input.sourceKind === 'DOCUMENT' ? 'DOCUMENT_FAMILY' : 'MATTER'}:${input.sourceId}`;
      await database.execute(sql`INSERT INTO hierarchical_wiki_membership
        (wiki_id,tenant_id,actor_user_id,member_key,source_kind,source_id,member_json,basis_json)
        VALUES (${node.wikiId},${owner.tenantId},${owner.actorUserId},${key},${input.sourceKind},${input.sourceId},'{}'::jsonb,
          ${JSON.stringify({ kind: 'USER_WIKI_CLASSIFICATION', classificationStatus: input.included ? 'CONFIRMED' : 'EXCLUDED', documentVersionId, ata: input.ata })}::jsonb)
        ON CONFLICT (wiki_id,member_key) DO UPDATE SET member_json='{}'::jsonb,basis_json=EXCLUDED.basis_json`);
      await database.execute(sql`INSERT INTO hierarchical_wiki_change(tenant_id,actor_user_id,kind,subject_id,version_ref,important)
        VALUES (${owner.tenantId},${owner.actorUserId},${input.sourceKind},${documentVersionId ?? input.sourceId},${`classification:${randomUUID()}`},true)`);
      await this.refresh(database, owner, new Date().toISOString());
    });
    return this.readList(actor);
  }

  async update(
    summaryId: string,
    input: { enabled?: boolean; immediately?: boolean },
    actor: CanonicalHostActor,
  ): Promise<HierarchicalWikiList> {
    await this.repository.browser(actor, async (database, owner) => {
      await this.refresh(database, owner, new Date().toISOString());
      const rows = await wikiRows(database, owner);
      const row = rows.find((item) => item.summaryId === summaryId);
      if (!row) throw summaryError('WIKI_UNAVAILABLE', 404);
      if (input.enabled !== undefined)
        await database.execute(sql`UPDATE hierarchical_wiki_scope SET enabled=${input.enabled}
        WHERE wiki_id=${row.wikiId} OR (${row.scope.kind === 'FLEET'} AND tenant_id=${owner.tenantId} AND actor_user_id=${owner.actorUserId}
          AND scope_json->>'fleetFamilyId'=${row.scope.fleetFamilyId} AND scope_json->'fleetModelIds'=${JSON.stringify(row.scope.fleetModelIds)}::jsonb)`);
      if (input.immediately) {
        await this.refresh(database, owner, new Date().toISOString(), true);
        const locked = await lockWiki(database, row);
        await storeWikiDemand(database, locked, {
          ...locked.state,
          blocked: null,
          retryCount: 0,
          desiredGeneration: locked.state.desiredGeneration + 1,
          forceGeneration: locked.state.desiredGeneration + 1,
          firstDirtyAt: locked.state.firstDirtyAt ?? new Date().toISOString(),
          dueAt: new Date().toISOString(),
        });
      }
    });
    return this.readList(actor);
  }

  /** Native cron and platform backstop use the same durable delegated owner,
   * reservation and attempt queue. No user identity is accepted in its payload. */
  async next(now: string = new Date().toISOString()): Promise<
    | { status: 'IDLE' }
    | { status: 'ATTENTION'; errorCodes: string[] }
    | {
        status: 'SUMMARY_PENDING';
        summaryId: string;
        attemptRef: string;
      }
    | { status: 'MATTER_PENDING'; matterId: string; attemptRef: string }
  > {
    const scope = await this.authorization.authorizeOpenClawAutoWorkItemQueue();
    this.assertScope(scope, scope.tenantId);
    const owners = await this.db.execute<{
      actorUserId: string;
    }>(sql`SELECT actor_user_id AS "actorUserId"
      FROM hierarchical_wiki_runtime_owners(${scope.tenantId},${scope.principalId})`);
    const errors: string[] = [];
    for (const owner of owners) {
      const actor: SummaryActor = {
        tenantId: scope.tenantId,
        actorUserId: owner.actorUserId,
      };
      let candidates: WikiRow[];
      try {
        candidates = await this.transactions.withActorTransaction(
          owner.actorUserId,
          async ({ database }) => {
            await this.members.authorizeActor(actor, database);
            errors.push(...(await reconcileWikiReservations(
              database,
              this.repository,
              actor,
              (await wikiRows(database, actor)).filter(
                (row: WikiRow) => row.enabled && row.principalId === scope.principalId,
              ),
              now,
            )));
            await this.refresh(database, actor, now);
            return (await wikiRows(database, actor)).filter(
              (row) => row.enabled && row.principalId === scope.principalId,
            );
          },
        );
      } catch (error) {
        const code =
          error instanceof Error && /^[A-Z][A-Z0-9_:-]+$/u.test(error.message)
            ? error.message
            : 'WIKI_DISCOVERY_FAILED';
        this.logger.error(code);
        errors.push(code);
        continue;
      }
      // Real prerequisite work has priority over a new aggregate. This invokes
      // the existing SOURCE_CHANGE/revisit admission and its idempotency keys.
      // A saved revisit can become due with every input already covered, so it
      // has no waiting row. Recheck only explicitly delegated upstream Matters.
      for (const matterId of [
        ...new Set([
          ...candidates.flatMap((row) =>
            row.state.waiting
              .filter((item) => item.kind === 'MATTER')
              .map((item) => item.subjectId),
          ),
          ...candidates.flatMap((row: WikiRow) =>
            row.scope.kind === 'FLEET'
              ? Object.keys(row.upstreamDelegations).filter(
                  (id: string) => row.upstreamDelegations[id]?.enabled,
                )
              : [],
          ),
        ]),
      ]) {
        if (
          !this.matterAttempts ||
          !candidates.some(
            (row) =>
              row.scope.kind === 'FLEET' &&
              row.upstreamDelegations[matterId]?.enabled,
          )
        )
          continue;
        try {
          const delegated = await this.authorizeMatter({ matterId });
          if (delegated.actorUserId !== actor.actorUserId)
            throw summaryError('WIKI_MATTER_DELEGATION_UNAVAILABLE');
          const next = await this.matterAttempts.nextForRuntime({
            ...delegated,
            authorizeReferenceMatter: async (id) => {
              const source = await this.authorizeMatter({ matterId: id });
              if (source.actorUserId !== actor.actorUserId)
                throw summaryError('WIKI_MATTER_DELEGATION_UNAVAILABLE');
            },
          });
          if (
            next.next &&
            ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(
              next.next.status,
            )
          )
            return {
              status: 'MATTER_PENDING',
              matterId,
              attemptRef: next.next.attemptRef,
            };
        } catch (error) {
          const code =
            error instanceof Error && /^[A-Z][A-Z0-9_:-]+$/u.test(error.message)
              ? error.message
              : 'WIKI_MATTER_DISPATCH_FAILED';
          this.logger.error(code);
          errors.push(code);
        }
      }
      candidates.sort(
        (a, b) =>
          Number(Boolean(b.state.active)) - Number(Boolean(a.state.active)) ||
          Number(b.state.priority === 'IMPORTANT') -
            Number(a.state.priority === 'IMPORTANT') ||
          Date.parse(a.state.dueAt ?? now) - Date.parse(b.state.dueAt ?? now),
      );
      for (const candidate of candidates)
        try {
          const next = await this.transactions.withActorTransaction(
            owner.actorUserId,
            async ({ database }) => {
              await this.members.authorizeActor(actor, database);
              const rows = (await wikiRows(database, actor)).filter(
                (row) =>
                  row.wikiId === candidate.wikiId &&
                  row.enabled &&
                  row.principalId === scope.principalId,
              );
              // Resume the exact saved/unfinished reservation before admitting another
              // automatic Wiki. Global runtime claim capacity remains unchanged.
              for (const row of rows)
                if (row.state.active) {
                  const attempt = await this.repository.attempt(
                    row.summaryId,
                    row.state.active.attemptRef,
                    actor.tenantId,
                    database,
                  );
                  if (
                    [
                      'QUEUED',
                      'RUNNING',
                      'RETRY_SCHEDULED',
                      'COMMITTING',
                    ].includes(attempt.status)
                  )
                    return {
                      status: 'SUMMARY_PENDING' as const,
                      summaryId: row.summaryId,
                      attemptRef: row.state.active.attemptRef,
                    };
                  if (await wikiRequestHasSavedRevision(database, row, attempt))
                    throw summaryError('WIKI_SAVED_RESERVATION_PENDING');
                  const locked = await lockWikiBranch(database, row);
                  if (
                    locked.state.active?.attemptRef !==
                    row.state.active.attemptRef
                  )
                    return null;
                  await storeWikiDemand(
                    database,
                    locked,
                    retryWikiDemand(
                      locked.state,
                      attempt.errorCode ??
                        attempt.terminalReason ??
                        'WIKI_ATTEMPT_FAILED',
                      now,
                    ),
                  );
                  return null; // Commit registry cleanup before any later context/source reservation.
                }
              const due = rows
                .filter((row) => wikiDue(row.state, row.scope.kind, now))
                .sort(
                  (a, b) =>
                    Number(b.state.priority === 'IMPORTANT') -
                      Number(a.state.priority === 'IMPORTANT') ||
                    Date.parse(a.state.dueAt!) - Date.parse(b.state.dueAt!) ||
                    a.wikiId.localeCompare(b.wikiId),
                );
              const row = due[0];
              if (!row) return null;
              const head = await this.repository.head(
                row.summaryId,
                actor,
                database,
              );
              const requestId = `wiki-${randomUUID()}`;
              const input: RequestDerivedSummaryUpdate = {
                requestId,
                scope: row.scope,
                expectedSummaryRevision: head.currentRevision,
                members: Object.values(row.state.versions),
                purpose:
                  head.currentRevision &&
                  Object.keys(row.state.lastGenerated).every((key) =>
                    Object.hasOwn(row.state.versions, key),
                  )
                    ? 'REVISE_SAVED_SUMMARY'
                    : 'SYNTHESIZE',
                instruction:
                  wikiLayerInstruction(row.scope.kind) +
                  `本次尚未完成的下层依赖：${JSON.stringify(row.state.waiting)}。不得宣称已覆盖这些新工作。`,
              };
              let receipt;
              try {
                receipt = await this.summaries.reserve(
                  input,
                  actor,
                  head,
                  database,
                  row.scope.kind,
                );
              } catch (error) {
                if (
                  input.purpose !== 'REVISE_SAVED_SUMMARY' ||
                  !(error instanceof Error) ||
                  ![
                    'DERIVED_SUMMARY_MEMBER_UNAVAILABLE',
                    'DERIVED_SUMMARY_SOURCE_UNAVAILABLE',
                    'DERIVED_SUMMARY_DOCUMENT_READING_UNAVAILABLE',
                    'DERIVED_SUMMARY_UNAVAILABLE',
                  ].includes(error.message)
                )
                  throw error;
                // The previous body remains restricted. A fresh synthesis receives
                // only the newly reauthorized current membership, never that body.
                receipt = await this.summaries.reserve(
                  { ...input, purpose: 'SYNTHESIZE' },
                  actor,
                  head,
                  database,
                  row.scope.kind,
                );
              }
              // Existing context locks precede the Wiki lock, just as in SAVE.
              const locked = await lockWikiBranch(database, row);
              if (
                !locked.enabled ||
                locked.state.active ||
                Object.entries(row.state.versions).some(
                  ([key, member]) =>
                    canonicalJson(locked.state.versions[key]) !==
                    canonicalJson(member),
                )
              )
                throw summaryError('WIKI_RESERVATION_CHANGED');
              await storeWikiDemand(database, locked, {
                ...locked.state,
                active: {
                  requestId,
                  attemptRef: receipt.attemptRef,
                  generation: row.state.desiredGeneration,
                  versions: row.state.versions,
                  waiting: row.state.waiting,
                },
              });
              // This new request is now an authentic persisted runtime delegation.
              // Reauthorize its entire sealed closure under the existing final native
              // transaction guard before committing a background reservation.
              await this.members.withNativeTransaction(
                actor,
                database,
                {
                  kind: 'RUNTIME',
                  summaryId: row.summaryId,
                  attemptRef: receipt.attemptRef,
                  scope,
                },
                async () => {
                  const attempt = await this.repository.attempt(
                    row.summaryId,
                    receipt.attemptRef,
                    actor.tenantId,
                    database,
                  );
                  await this.summaries.checkTaskAccess(
                    checkedSummaryTask(attempt),
                    actor,
                    database,
                    { requireCurrentContext: true },
                  );
                },
              );
              return {
                status: 'SUMMARY_PENDING' as const,
                summaryId: row.summaryId,
                attemptRef: receipt.attemptRef,
              };
            },
          );
          if (next) return next;
        } catch (error) {
          // An inaccessible owner does not stall other scopes. Keep an explicit
          // diagnostic; never expose this owner's source identities to another.
          const code =
            error instanceof Error && /^[A-Z][A-Z0-9_:-]+$/u.test(error.message)
              ? error.message
              : 'WIKI_DISPATCH_FAILED';
          if (
            [
              'WIKI_RESERVATION_CHANGED',
              'DERIVED_SUMMARY_REQUEST_ACTIVE',
            ].includes(code)
          ) {
            const winner = await this.transactions.withActorTransaction(
              owner.actorUserId,
              async ({ database }) => {
                const row = (await wikiRows(database, actor)).find(
                  (item) => item.wikiId === candidate.wikiId && item.enabled,
                );
                return row?.state.active
                  ? {
                      status: 'SUMMARY_PENDING' as const,
                      summaryId: row.summaryId,
                      attemptRef: row.state.active.attemptRef,
                    }
                  : null;
              },
            );
            if (winner) return winner;
            if (code === 'WIKI_RESERVATION_CHANGED') continue;
          }
          this.logger.error(code);
          errors.push(code);
          await this.transactions.withActorTransaction(
            owner.actorUserId,
            async ({ database }) => {
              const row = (await wikiRows(database, actor)).find(
                (item) => item.wikiId === candidate.wikiId,
              );
              if (row) {
                const locked = await lockWikiBranch(database, row);
                if (!locked.state.active)
                  await storeWikiDemand(database, locked, {
                    ...locked.state,
                    blocked: code,
                  });
              }
            },
          );
        }
    }
    if (errors.length)
      return { status: 'ATTENTION', errorCodes: [...new Set(errors)] };
    return { status: 'IDLE' };
  }

  private async refresh(
    database: PostgresJsDatabase,
    owner: SummaryActor,
    now: string,
    force = false,
  ): Promise<void> {
    await lockWikiRoots(database, owner);
    let rows = await wikiRows(database, owner);
    for (const root of rows.filter(
      (row) => row.scope.kind === 'FLEET' && row.enabled,
    )) {
      const related = rows.filter(
        (row) =>
          row.scope.fleetFamilyId === root.scope.fleetFamilyId &&
          JSON.stringify(row.scope.fleetModelIds) ===
            JSON.stringify(root.scope.fleetModelIds),
      );
      let pruned = false;
      // A vanished/revoked source is absent from discovery, so validate retained
      // memberships explicitly instead of treating absence as authorization.
      const retained = await database.execute<{
        wikiId: string;
        key: string;
        member: DerivedSummaryMember;
        kind: string;
        sourceId: string;
      }>(sql`
        SELECT wiki_id AS "wikiId",member_key AS key,member_json AS member,source_kind AS kind,source_id AS "sourceId"
        FROM hierarchical_wiki_membership WHERE tenant_id=${owner.tenantId} AND actor_user_id=${owner.actorUserId}
          AND wiki_id IN (SELECT wiki_id FROM hierarchical_wiki_scope WHERE scope_json->>'fleetFamilyId'=${root.scope.fleetFamilyId}
            AND scope_json->'fleetModelIds'=${JSON.stringify(root.scope.fleetModelIds)}::jsonb) AND jsonb_exists(member_json, 'kind')`);
      for (const item of retained) {
        const access = await database.execute<{
          allowed: boolean;
        }>(sql`SELECT derived_summary_reading_sources_owned(
          ${owner.tenantId},${owner.actorUserId},${JSON.stringify({ members: [{ leaves: [item.member] }], evidence: [] })}::jsonb) AS allowed`);
        if (access[0]?.allowed !== true) {
          pruned = true;
          await database.execute(sql`UPDATE hierarchical_wiki_membership
          SET member_json='{}'::jsonb WHERE wiki_id=${item.wikiId} AND member_key=${item.key}`);
        }
      }
      const events = await database.execute<{
        seq: string;
        kind: string;
        subjectId: string;
        important: boolean;
      }>(sql`
        SELECT seq::text AS seq,kind,subject_id AS "subjectId",important FROM hierarchical_wiki_change
        WHERE tenant_id=${owner.tenantId} AND seq>${root.lastEventSeq}::bigint ORDER BY seq LIMIT 100`);
      // Source-head reconciliation is cheap and exact. It also catches changes
      // made through existing publication/parse/semantic writers before a new
      // reading is SAVED, without coupling those writers to Wiki row locks.
      const sourceChanges = await database.execute<{
        kind: string;
        subjectId: string;
        important: boolean;
      }>(sql`
        SELECT DISTINCT 'DOCUMENT' AS kind,f.current_document_version_id AS "subjectId",
          (m.basis_json->>'documentVersionId' IS DISTINCT FROM f.current_document_version_id OR
            (r.run_ref IS NULL AND jsonb_exists(m.member_json, 'readingRunRef'))) AS important
        FROM hierarchical_wiki_membership m JOIN hierarchical_wiki_scope w ON w.wiki_id=m.wiki_id
        JOIN dm_publication_family f ON f.family_id=m.source_id
        LEFT JOIN LATERAL (SELECT a.* FROM dm_document_reading_run a WHERE a.tenant_id=${owner.tenantId}
          AND a.document_version_id=f.current_document_version_id AND a.status='SAVED'
          AND a.parse_run_id=(SELECT parse_run_id FROM dm_document_parse_run p WHERE p.tenant_id=a.tenant_id
            AND p.document_version_id=a.document_version_id AND p.status='PUBLISHED' ORDER BY p.parse_revision DESC LIMIT 1)
          AND a.semantic_revision=(SELECT max(semantic_revision) FROM dm_document_semantic_revision s WHERE s.tenant_id=a.tenant_id
            AND s.document_version_id=a.document_version_id AND s.parse_run_id=a.parse_run_id)
          ORDER BY a.reading_revision DESC LIMIT 1) r ON NOT EXISTS (SELECT 1 FROM dm_document_reading_retraction z
            WHERE z.tenant_id=r.tenant_id AND z.run_ref=r.run_ref)
        WHERE m.tenant_id=${owner.tenantId} AND m.actor_user_id=${owner.actorUserId} AND m.source_kind='DOCUMENT'
          AND m.basis_json->>'classificationStatus'='CONFIRMED'
          AND w.scope_json->>'fleetFamilyId'=${root.scope.fleetFamilyId}
          AND w.scope_json->'fleetModelIds'=${JSON.stringify(root.scope.fleetModelIds)}::jsonb
          AND engineering_matter_document_owned_by_actor(${owner.tenantId},f.current_document_version_id)
          AND (m.basis_json->>'documentVersionId' IS DISTINCT FROM f.current_document_version_id
            OR m.member_json->>'readingRunRef' IS DISTINCT FROM r.run_ref) ORDER BY "subjectId" LIMIT 100`);
      const full =
        force ||
        root.inventoryCursor !== null ||
        !root.lastInventoryAt ||
        Date.parse(now) - Date.parse(root.lastInventoryAt) >= 24 * 60 * 60_000;
      const waitingDocs = related.flatMap((row) =>
        row.state.waiting
          .filter((item) => item.documentVersionId)
          .map((item) => ({
            kind: 'DOCUMENT',
            subjectId: item.documentVersionId!,
          })),
      );
      const waitingMatters = related.flatMap((row) =>
        row.state.waiting
          .filter((item) => item.kind === 'MATTER')
          .map((item) => ({ kind: 'MATTER', subjectId: item.subjectId })),
      );
      const matterChanges = await database.execute<{
        kind: string;
        subjectId: string;
        important: boolean;
      }>(sql`
        SELECT DISTINCT 'MATTER' AS kind,e.matter_id AS "subjectId",true AS important
        FROM hierarchical_wiki_membership m JOIN hierarchical_wiki_scope w ON w.wiki_id=m.wiki_id
        JOIN engineering_matter e ON e.tenant_id=m.tenant_id AND e.matter_id=m.source_id
        LEFT JOIN LATERAL(SELECT r.matter_work_revision_id FROM engineering_matter_work_revision r WHERE r.tenant_id=e.tenant_id
          AND r.matter_id=e.matter_id AND r.created_by_user_id=${owner.actorUserId} ORDER BY r.working_revision DESC LIMIT 1) latest ON true
        WHERE m.tenant_id=${owner.tenantId} AND m.actor_user_id=${owner.actorUserId} AND m.source_kind='MATTER'
          AND m.basis_json->>'classificationStatus'='CONFIRMED' AND engineering_matter_owned_by_actor(${owner.tenantId},e.matter_id)
          AND w.scope_json->>'fleetFamilyId'=${root.scope.fleetFamilyId} AND w.scope_json->'fleetModelIds'=${JSON.stringify(root.scope.fleetModelIds)}::jsonb
          AND (m.basis_json->>'matterRevisionId' IS DISTINCT FROM e.current_matter_revision_id OR
            m.member_json->>'workRef' IS DISTINCT FROM latest.matter_work_revision_id) ORDER BY "subjectId" LIMIT 100`);
      // Existing saved WI work may predate its journal or the WI inventory
      // branch. Compare only immutable head metadata here; the original
      // inventory still decides readiness and exact member authorization.
      // Already-waiting missing heads are reread by waitingDocs, leaving this
      // bounded discovery page free for other families. Real prior members
      // always remain eligible for invalidation by a newer partial head.
      const workItemChanges = await database.execute<{
        kind: string;
        subjectId: string;
        important: boolean;
      }>(sql`
        SELECT DISTINCT 'WORK_ITEM' AS kind,wi.work_item_id AS "subjectId",true AS important
        FROM hierarchical_wiki_membership m JOIN hierarchical_wiki_scope w ON w.wiki_id=m.wiki_id
          AND w.tenant_id=m.tenant_id AND w.actor_user_id=m.actor_user_id
        JOIN dm_publication_family f ON f.family_id=m.source_id
        JOIN dm_document_version d ON d.document_version_id=f.current_document_version_id
        JOIN work_item wi ON wi.tenant_id=m.tenant_id AND wi.document_version_id=d.document_version_id
          AND wi.source_artifact_id=d.source_artifact_id AND wi.source_file_sha256=d.pdf_sha256
          AND wi.source_byte_length=d.byte_length AND wi.requested_by_user_id=${owner.actorUserId}
        JOIN LATERAL (SELECT r.assessment_work_revision_id,r.work_revision FROM assessment_work_revision r
          WHERE r.tenant_id=wi.tenant_id AND r.work_item_id=wi.work_item_id ORDER BY r.work_revision DESC LIMIT 1) latest ON true
        LEFT JOIN hierarchical_wiki_membership prior ON prior.wiki_id=m.wiki_id
          AND prior.tenant_id=m.tenant_id AND prior.actor_user_id=m.actor_user_id
          AND prior.source_kind='WORK_ITEM' AND prior.source_id=wi.work_item_id
          AND prior.member_key='WORK_ITEM:'||wi.work_item_id
        WHERE m.tenant_id=${owner.tenantId} AND m.actor_user_id=${owner.actorUserId} AND m.source_kind='DOCUMENT'
          AND m.basis_json->>'classificationStatus'='CONFIRMED'
          AND m.basis_json->>'documentVersionId'=d.document_version_id AND w.scope_json->>'kind' IN ('ATA4','ATA2')
          AND w.scope_json->>'fleetFamilyId'=${root.scope.fleetFamilyId}
          AND w.scope_json->'fleetModelIds'=${JSON.stringify(root.scope.fleetModelIds)}::jsonb
          AND engineering_matter_work_item_owned_by_actor(${owner.tenantId},wi.work_item_id)
          AND engineering_matter_document_owned_by_actor(${owner.tenantId},d.document_version_id)
          AND (prior.member_key IS NOT NULL OR NOT EXISTS (
            SELECT 1 FROM hierarchical_wiki_scope pending
            CROSS JOIN LATERAL jsonb_array_elements(pending.state_json->'waiting') gap
            WHERE pending.tenant_id=m.tenant_id AND pending.actor_user_id=m.actor_user_id
              AND pending.scope_json->>'fleetFamilyId'=w.scope_json->>'fleetFamilyId'
              AND pending.scope_json->'fleetModelIds'=w.scope_json->'fleetModelIds'
              AND gap->>'kind'='DOCUMENT' AND gap->>'subjectId'=f.family_id
              AND gap->>'documentVersionId'=d.document_version_id
              AND gap->>'status'='SAVED_ASSESSMENT_NOT_READY'))
          AND (prior.member_json->>'workRef' IS DISTINCT FROM latest.assessment_work_revision_id
            OR prior.member_json->'workRevision' IS DISTINCT FROM to_jsonb(latest.work_revision)
            OR prior.member_json->>'documentVersionId' IS DISTINCT FROM wi.document_version_id)
        ORDER BY "subjectId" LIMIT 100`);
      if (
        !full &&
        !events.length &&
        !sourceChanges.length &&
        !matterChanges.length &&
        !workItemChanges.length &&
        !waitingDocs.length &&
        !waitingMatters.length &&
        !root.state.pendingEvents &&
        !pruned
      )
        continue;
      const target: HierarchicalWikiEnableRequest = {
        fleetFamilyId: root.scope.fleetFamilyId,
        fleetModelId: root.scope.fleetModelIds[0] ?? null,
        modelRef: root.modelRef,
      };
      const batch =
        root.state.pendingEvents ??
        (events.length ||
        sourceChanges.length ||
        matterChanges.length ||
        workItemChanges.length ||
        waitingDocs.length ||
        waitingMatters.length
          ? {
              untilSeq: events.at(-1)?.seq ?? root.lastEventSeq,
              changes: [
                ...events,
                ...sourceChanges,
                ...matterChanges,
                ...workItemChanges,
                ...[...waitingDocs, ...waitingMatters].map((item) => ({
                  ...item,
                  important: false,
                })),
              ],
              cursor: null,
            }
          : null);
      const fullInventory = full
        ? await readWikiInventory(
            database,
            owner,
            target,
            null,
            root.inventoryCursor,
            this.transactions,
          )
        : null;
      const eventInventory = batch
        ? await readWikiInventory(
            database,
            owner,
            target,
            batch.changes,
            batch.cursor,
            this.transactions,
          )
        : null;
      const parts = [fullInventory, eventInventory].filter(
        (part): part is NonNullable<typeof part> => part !== null,
      );
      const inventory = {
        items: [
          ...new Map(
            parts
              .flatMap((part) => part.items)
              .map((item) => [
                JSON.stringify([item.ata, item.memberKey]),
                item,
              ]),
          ).values(),
        ],
        removed: parts.flatMap((part) => part.removed),
        waiting: parts.flatMap((part) => part.waiting),
      };
      const nodes = new Map<string | null, WikiRow>(
        related.map((row) => [row.scope.ata4 ?? row.scope.ata2, row]),
      );
      nodes.set(null, root);
      for (const ata of [
        ...new Set(
          [...inventory.items, ...inventory.waiting].map((item) => item.ata),
        ),
      ]) {
        if (ata === null) continue;
        const ata2 = ata.slice(0, 2);
        const parent =
          nodes.get(ata2) ??
          (await ensureWiki(
            database,
            owner,
            wikiScopeFor(target, ata2),
            root.principalId,
            root.modelRef,
            root,
          ));
        nodes.set(ata2, parent);
        if (ata.length > 2 && !nodes.has(ata))
          nodes.set(
            ata,
            await ensureWiki(
              database,
              owner,
              wikiScopeFor(target, ata),
              root.principalId,
              root.modelRef,
              parent,
            ),
          );
      }
      for (const removed of inventory.removed)
        await database.execute(sql`DELETE FROM hierarchical_wiki_membership
        WHERE tenant_id=${owner.tenantId} AND actor_user_id=${owner.actorUserId} AND source_kind=${removed.kind}
          AND source_id=${removed.id} AND wiki_id IN (SELECT wiki_id FROM hierarchical_wiki_scope
            WHERE scope_json->>'fleetFamilyId'=${root.scope.fleetFamilyId}
              AND scope_json->'fleetModelIds'=${JSON.stringify(root.scope.fleetModelIds)}::jsonb)
          AND basis_json->>'kind'<>'USER_WIKI_CLASSIFICATION'`);
      for (const item of inventory.items)
        await database.execute(sql`INSERT INTO hierarchical_wiki_membership
        (wiki_id,tenant_id,actor_user_id,member_key,source_kind,source_id,member_json,basis_json)
        VALUES (${nodes.get(item.ata)!.wikiId},${owner.tenantId},${owner.actorUserId},${item.memberKey},${item.sourceKind},
          ${item.sourceId},${JSON.stringify(item.member ?? {})}::jsonb,${JSON.stringify(item.basis)}::jsonb)
        ON CONFLICT (wiki_id,member_key) DO UPDATE SET member_json=EXCLUDED.member_json,basis_json=EXCLUDED.basis_json,_updated_at=CURRENT_TIMESTAMP`);
      // Recompute bottom-up from exact SAVED child pointers. No parent models
      // run merely because the descendant status has changed.
      const ordered = [...nodes.values()].sort(
        (a, b) =>
          Number(b.scope.kind === 'ATA4') - Number(a.scope.kind === 'ATA4') ||
          Number(b.scope.kind === 'ATA2') - Number(a.scope.kind === 'ATA2') ||
          a.wikiId.localeCompare(b.wikiId),
      );
      for (const node of ordered) {
        const memberships = await database.execute<{
          key: string;
          member: DerivedSummaryMember;
        }>(sql`
          SELECT member_key AS key,member_json AS member FROM hierarchical_wiki_membership WHERE wiki_id=${node.wikiId}
            AND basis_json->>'classificationStatus'='CONFIRMED' AND jsonb_exists(member_json, 'kind') ORDER BY member_key`);
        const versions: WikiVersions = wikiDirectVersions(node.scope.kind, memberships);
        const ata = node.scope.ata4 ?? node.scope.ata2;
        const touched = new Set(
          inventory.removed.map((item) => `${item.kind}:${item.id}`),
        );
        const waiting = node.state.waiting.filter(
          (item) =>
            item.kind !== 'SUMMARY' &&
            !touched.has(`${item.kind}:${item.subjectId}`),
        );
        waiting.push(
          ...inventory.waiting
            .filter((item) => item.ata === ata)
            .map(({ ata: _ata, ...item }) => item),
        );
        for (const child of ordered.filter(
          (item) => item.parentWikiId === node.wikiId,
        )) {
          if (
            node.scope.kind === 'ATA4' ||
            child.scope.kind !== (node.scope.kind === 'FLEET' ? 'ATA2' : 'ATA4') ||
            (node.scope.kind === 'ATA2' && child.scope.ata2 !== node.scope.ata2)
          ) throw summaryError('WIKI_LAYER_MEMBERS_INVALID');
          const head = await this.repository.head(
            child.summaryId,
            owner,
            database,
          );
          if (
            head.currentSummaryRef &&
            Object.keys(child.state.versions).length &&
            Object.keys(child.state.lastGenerated).every((key) =>
              Object.hasOwn(child.state.versions, key),
            )
          )
            versions[`SUMMARY:${child.summaryId}`] = {
              kind: 'DERIVED_SUMMARY',
              summaryId: child.summaryId,
              summaryRef: head.currentSummaryRef,
              summaryRevision: head.currentRevision,
            };
          if (
            child.state.firstDirtyAt ||
            child.state.active ||
            child.state.waiting.length
          )
            waiting.push({
              kind: 'SUMMARY',
              subjectId: child.summaryId,
              requestId: child.state.active?.requestId ?? null,
              documentVersionId: null,
              status: wikiDemandState(
                child.state,
                (await readActiveWikiAttempt(database, this.repository, child))
                  ?.status,
              ),
            });
        }
        const locked = await lockWiki(database, node);
        const released = locked.state.waiting.some(
          (prior) =>
            !waiting.some(
              (item) =>
                item.kind === prior.kind && item.subjectId === prior.subjectId,
            ),
        );
        const state = mergeWikiDemand(locked.state, {
          versions,
          waiting: [
            ...new Map(
              waiting.map((item) => [JSON.stringify(item), item]),
            ).values(),
          ],
          kind: node.scope.kind,
          now,
          important: batch?.changes.some((event) => event.important),
          dependencyCompleted: released,
        });
        await storeWikiDemand(database, locked, state);
        node.state = state;
      }
      const reconciled = await lockWiki(database, root);
      await storeWikiDemand(database, reconciled, {
        ...reconciled.state,
        pendingEvents:
          batch && eventInventory && !eventInventory.complete
            ? { ...batch, cursor: eventInventory.cursor }
            : null,
      });
      await database.execute(sql`UPDATE hierarchical_wiki_scope SET last_event_seq=${eventInventory?.complete ? batch!.untilSeq : root.lastEventSeq}::bigint,
        last_inventory_at=${fullInventory?.complete ? now : root.lastInventoryAt}::timestamptz,
        inventory_cursor=${fullInventory ? fullInventory.cursor : root.inventoryCursor} WHERE wiki_id=${root.wikiId}`);
      rows = await wikiRows(database, owner);
    }
  }

  /** Body/native authorization runs after directory writer locks are released.
   * This keeps native/source → Wiki lock order while retaining the final guard. */
  private async readList(
    actor: CanonicalHostActor,
    cursor?: string,
  ): Promise<HierarchicalWikiList> {
    // Expiration writes use the real owner's existing browser transaction;
    // the separate tenant read remains unable to modify another owner's queue.
    const now: string = new Date().toISOString();
    const snapshot: { reconcile: true } | { reconcile: false; listing: HierarchicalWikiList } =
      await this.repository.readBrowser(actor, async (database, reader) => {
        const rows: WikiRow[] = await wikiRows(database, reader);
        for (const row of rows.filter(
          (item: WikiRow) => item.actorUserId === reader.actorUserId && item.state.active,
        )) {
          try {
            const attempt: SummaryAttempt | null = await readActiveWikiAttempt(database, this.repository, row);
            if (attempt && wikiReservationNeedsReconciliation(attempt, new Date(now)))
              return { reconcile: true as const };
          } catch (error) {
            // RLS-hidden metadata cannot authorize expiration. listRows reports
            // this exact row as blocked and keeps other readable rows available.
            if (!(error instanceof Error) || error.message !== 'DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE') throw error;
          }
        }
        return { reconcile: false as const, listing: await this.listRows(rows, reader, database, cursor) };
      });
    if (snapshot.reconcile === false) return snapshot.listing;
    await this.repository.browser(actor, async (database, owner) =>
      reconcileWikiReservations(database, this.repository, owner, await wikiRows(database, owner), now),
    );
    return this.repository.readBrowser(actor, async (database, owner) =>
      this.listRows(await wikiRows(database, owner), owner, database, cursor),
    );
  }

  private async listRows(
    rows: WikiRow[],
    owner: SummaryActor,
    database: PostgresJsDatabase,
    cursor?: string,
  ): Promise<HierarchicalWikiList> {
    const items: HierarchicalWikiStatus[] = [];
    for (const row of rows) {
      const root = rows.find(
        (item) =>
          item.scope.kind === 'FLEET' &&
          item.actorUserId === row.actorUserId &&
          item.scope.fleetFamilyId === row.scope.fleetFamilyId &&
          canonicalJson(item.scope.fleetModelIds) ===
            canonicalJson(row.scope.fleetModelIds),
      );
      // Exact saved coverage metadata is also source-derived. Reauthorize its
      // complete closure before releasing IDs, counts or waiting relationships.
      let denied: string | null = null;
      try {
        await this.members.readAll(
          Object.values(row.state.delivered),
          owner,
          database,
        );
      } catch (error) {
        denied =
          error instanceof Error && /^[A-Z][A-Z0-9_:-]+$/u.test(error.message)
            ? error.message
            : 'WIKI_SOURCE_UNAVAILABLE';
      }
      if (!denied) {
        const access = await database.execute<{
          allowed: boolean;
        }>(
          owner.readScope === 'TENANT'
            ? sql`SELECT NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(${JSON.stringify(row.state.waiting)}::jsonb) gap
          WHERE CASE gap->>'kind'
            WHEN 'DOCUMENT' THEN native_app_document_readable(${owner.tenantId},gap->>'documentVersionId') IS NOT TRUE
            WHEN 'MATTER' THEN NOT EXISTS (SELECT 1 FROM engineering_matter e WHERE e.tenant_id=${owner.tenantId}
              AND e.matter_id=gap->>'subjectId')
            ELSE false END) AS allowed`
            : sql`SELECT NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(${JSON.stringify(row.state.waiting)}::jsonb) gap
          WHERE CASE gap->>'kind'
            WHEN 'DOCUMENT' THEN engineering_matter_document_owned_by_actor(${owner.tenantId},gap->>'documentVersionId') IS NOT TRUE
            WHEN 'MATTER' THEN engineering_matter_owned_by_actor(${owner.tenantId},gap->>'subjectId') IS NOT TRUE
            ELSE false END) AS allowed`,
        );
        if (access[0]?.allowed !== true) denied = 'WIKI_SOURCE_UNAVAILABLE';
      }
      let attempt: SummaryAttempt | null = null;
      if (!denied) {
        try { attempt = await readActiveWikiAttempt(database, this.repository, row); }
        catch (error) {
          if (!(error instanceof Error) || error.message !== 'DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE') throw error;
          denied = error.message;
        }
      }
      items.push({
        wikiId: row.wikiId,
        summaryId: row.summaryId,
        parentSummaryId:
          rows.find((parent) => parent.wikiId === row.parentWikiId)
            ?.summaryId ?? null,
        scope: row.scope,
        enabled: row.enabled,
        state: denied ? 'BLOCKED' : wikiDemandState(row.state, attempt?.status),
        desiredGeneration: row.state.desiredGeneration,
        completedGeneration: row.state.completedGeneration,
        firstDirtyAt: row.state.firstDirtyAt,
        dueAt: row.state.dueAt,
        coveredMembers: denied ? [] : Object.values(row.state.delivered),
        waiting: denied ? [] : row.state.waiting,
        activeRequest:
          !denied && row.state.active && attempt &&
          ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(attempt.status)
            ? {
                requestId: row.state.active.requestId,
                attemptRef: attempt.operationRef!,
                status: attempt.status,
                claimCount: attempt.claimCount ?? null,
                executorSessionKey: attempt.executorSessionKey ?? null,
              }
            : null,
        errorCode:
          denied ??
          row.state.blocked ??
          attempt?.errorCode ??
          row.state.lastAttemptErrorCode ??
          (attempt &&
          !['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(
            attempt.status,
          )
            ? 'WIKI_SAVED_RESERVATION_PENDING'
            : null),
        coverage: 'AUTHORIZED_CLASSIFIED_HOST_MATERIAL',
        lastCheckedAt: row.state.lastCheckedAt,
        inventoryComplete:
          !!root?.lastInventoryAt && root.inventoryCursor === null,
      });
    }
    // Dependency progress is read from this same authorized directory snapshot;
    // an older inventory check must not keep a terminal child labeled RUNNING.
    const currentStates: Map<string, HierarchicalWikiStatus['state']> = new Map(
      items.map((item: HierarchicalWikiStatus) => [item.summaryId, item.state]),
    );
    const currentRequests: Map<string, string | null> = new Map(
      rows.map((row: WikiRow) => [
        row.summaryId,
        row.state.active?.requestId ?? null,
      ]),
    );
    for (const item of items)
      item.waiting = item.waiting.map(
        (gap: HierarchicalWikiStatus['waiting'][number]) =>
          gap.kind === 'SUMMARY' && currentStates.has(gap.subjectId)
            ? {
                ...gap,
                status: currentStates.get(gap.subjectId)!,
                requestId: currentRequests.get(gap.subjectId) ?? null,
              }
            : gap,
      );
    let after: [string, string] | null = null;
    if (cursor) {
      try {
        const value: unknown = JSON.parse(cursor);
        if (
          !Array.isArray(value) ||
          value.length !== 2 ||
          value.some(
            (item) =>
              typeof item !== 'string' || !item.trim() || item.length > 200,
          )
        )
          throw new Error('invalid');
        after = value as [string, string];
      } catch {
        throw summaryError('WIKI_CLASSIFICATION_CURSOR_INVALID', 400);
      }
    }
    const classifications = await database.execute<
      HierarchicalWikiList['classifications'][number]
    >(sql`SELECT w.summary_id AS "summaryId",
      m.member_key AS "memberKey",m.source_kind AS "sourceKind",m.source_id AS "sourceId",
      m.basis_json->>'documentVersionId' AS "documentVersionId",COALESCE(w.scope_json->>'ata4',w.scope_json->>'ata2') AS ata,
      m.basis_json->>'classificationStatus' AS status,
      COALESCE(f.canonical_document_number,e.title,'资料') AS title,
      EXISTS(SELECT 1 FROM hierarchical_wiki_scope root WHERE root.scope_json->>'kind'='FLEET'
        AND root.scope_json->>'fleetFamilyId'=w.scope_json->>'fleetFamilyId' AND root.scope_json->'fleetModelIds'=w.scope_json->'fleetModelIds'
        AND root.tenant_id=w.tenant_id AND root.actor_user_id=w.actor_user_id
        AND root.upstream_delegations_json->m.source_id->>'enabled'='true') AS "automaticMatterUpdates"
      FROM hierarchical_wiki_membership m JOIN hierarchical_wiki_scope w ON w.wiki_id=m.wiki_id
      LEFT JOIN dm_publication_family f ON m.source_kind='DOCUMENT' AND f.family_id=m.source_id
      LEFT JOIN engineering_matter e ON m.source_kind='MATTER' AND e.tenant_id=m.tenant_id AND e.matter_id=m.source_id
      WHERE m.tenant_id=${owner.tenantId}
        ${owner.readScope === 'TENANT' ? sql`` : sql`AND m.actor_user_id=${owner.actorUserId}`}
        AND m.basis_json->>'classificationStatus' IN ('CANDIDATE','CONFIRMED','EXCLUDED')
        AND (${after === null} OR (w.summary_id,m.member_key)>(${after?.[0] ?? ''},${after?.[1] ?? ''}))
        AND ${owner.readScope === 'TENANT' ? sql`CASE m.source_kind
          WHEN 'DOCUMENT' THEN EXISTS (SELECT 1 FROM dm_publication_family f WHERE f.family_id=m.source_id
            AND native_app_document_readable(${owner.tenantId},f.current_document_version_id))
          WHEN 'MATTER' THEN EXISTS (SELECT 1 FROM engineering_matter e WHERE e.tenant_id=${owner.tenantId}
            AND e.matter_id=m.source_id) ELSE false END`
          : sql`CASE m.source_kind WHEN 'DOCUMENT' THEN EXISTS (SELECT 1 FROM dm_publication_family f WHERE f.family_id=m.source_id
            AND engineering_matter_document_owned_by_actor(${owner.tenantId},f.current_document_version_id))
          WHEN 'MATTER' THEN engineering_matter_owned_by_actor(${owner.tenantId},m.source_id) ELSE false END`}
      ORDER BY w.summary_id,m.member_key LIMIT 101`);
    const page = [...classifications].slice(0, 100);
    const tail = page.at(-1);
    return {
      items,
      classifications: page,
      candidates: page.filter((item) => item.status === 'CANDIDATE'),
      nextClassificationCursor:
        classifications.length > 100 && tail
          ? JSON.stringify([tail.summaryId, tail.memberKey])
          : null,
      sourceCurrentness: 'UNKNOWN',
    };
  }

  private assertScope(
    scope: CanonicalVerifiedAutoWorkItemQueueScope,
    tenantId: string,
  ): void {
    if (
      scope.appId !== 'app_17bzc551rsg' ||
      scope.tenantId !== tenantId ||
      !scope.principalId
    )
      throw summaryError('WIKI_SERVICE_SCOPE_UNAVAILABLE', 503);
  }
}
