import { Inject, Injectable } from '@nestjs/common';

import type {
  EngineeringMatterWorkingApplyResult,
  EngineeringMatterWorkingInputBinding,
  EngineeringMatterWorkingReadModel,
  EngineeringMatterWorkingRevisionCommand,
  EngineeringMatterWorkingRevisionSource,
  EngineeringMatterWorkingRevisionReadModel,
} from '@shared/matter-working.interface';

import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalObjectAccessPort,
  type CanonicalObjectAccessGrant,
  type CanonicalObjectAccessResult,
  type CanonicalWorkItemReadInput,
} from '../work-item/canonical-object-access.port';
import { assertSourceIdentity } from '../work-item/document-version-source-identity';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import type { CanonicalHostActor } from './canonical-host.types';
import {
  engineeringMatterInputBinding,
  EngineeringMatterWorkingRepository,
  type EngineeringMatterWorkingTransactionExecutor,
  type EngineeringMatterSavedRowBatch,
} from './engineering-matter-working.repository';
import { engineeringMatterPendingInputs } from './engineering-matter-working-state';
import { materialInputBindings } from './matter-material';
import { isHostedCanonicalFinalUserActor } from '../work-item/miaoda-hosted-canonical-object-access.adapter';
import {
  EngineeringReadPhaseObservation,
  observeEngineeringRead,
} from './engineering-read-phase-observation';
import {
  EngineeringMatterRepository,
  type EngineeringMatterRevisionLinkSnapshot,
  type EngineeringMatterSnapshot,
} from './engineering-matter.repository';

type TenantScopedWorkItem = NonNullable<
  Awaited<ReturnType<MiaodaWorkItemRepository['loadTenantScopedProjection']>>
>;

interface AuthorizedMatter {
  snapshot: EngineeringMatterSnapshot;
  currentInputs: EngineeringMatterWorkingInputBinding[];
  observation?: EngineeringReadPhaseObservation;
}

export interface EngineeringMatterWorkingBasis {
  snapshot: EngineeringMatterSnapshot;
  currentInputs: EngineeringMatterWorkingInputBinding[];
  working: EngineeringMatterWorkingRevisionReadModel | null;
}

export interface EngineeringMatterWorkingApplyOptions {
  source: EngineeringMatterWorkingRevisionSource | null;
  /** W4 supplies this only from an already-open candidate commit transaction. */
  executor?: EngineeringMatterWorkingTransactionExecutor;
}

@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided -- W1 registers/exports this in EngineeringMatterModule.
export class EngineeringMatterWorkingService {
  constructor(
    private readonly matters: EngineeringMatterRepository,
    private readonly working: EngineeringMatterWorkingRepository,
    private readonly workItems: MiaodaWorkItemRepository,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
  ) {}

  async readWorking(
    matterId: string,
    actor: CanonicalHostActor,
  ): Promise<EngineeringMatterWorkingReadModel> {
    return readModelFromBasis(await this.resolveWorkingBasis(matterId, actor));
  }

  createSavedReadBatch(
    expected: number,
    observation: EngineeringReadPhaseObservation,
  ): EngineeringMatterSavedRowBatch {
    return this.working.createSavedRowBatch(expected, observation);
  }

  /** Browser path: requires the native actor and fresh object access per member. */
  async readWorkingRevision(
    matterId: string,
    workRef: string,
    actor: CanonicalHostActor,
    observation?: EngineeringReadPhaseObservation,
    batch?: EngineeringMatterSavedRowBatch,
  ): Promise<EngineeringMatterWorkingRevisionReadModel> {
    const requestObservation = observation?.scope({ attempt: 0 });
    // The exact saved revision below already owns its original bindings. Keep
    // fresh member/source checks, but do not hydrate current parse/semantic state
    // whose result is not consumed by this read.
    let authorizationObservation = requestObservation;
    try {
      const authorized = await observeEngineeringRead(
        requestObservation,
        'matter_authorize_current',
        () =>
          this.authorizedMatter(matterId, actor, 0, false, requestObservation),
      );
      authorizationObservation = authorized.observation ?? requestObservation;
    } catch (error) {
      requestObservation?.mark('root_all_skip', 'skip', { skipped: 1 });
      batch?.skip();
      throw error;
    }
    const revision = await observeEngineeringRead(
      authorizationObservation,
      'matter_read_saved',
      () =>
        this.working.readByRef({
          tenantId: actor.tenantId,
          matterId,
          workRef,
          observation: authorizationObservation,
          ...(batch ? { batch } : {}),
        }),
    );
    if (!revision) throw matterNotFound();
    // Historical work can contain a member that is no longer in the current composition.
    const savedMembers = [
      ...new Set(
        [
          ...revision.state.substantiveInputs,
          ...revision.state.coverage.map((item) => item.binding),
        ].flatMap((binding) =>
          binding.workItemId ? [binding.workItemId] : [],
        ),
      ),
    ];
    // Bound independent fresh reads within this request. Keep current and removed
    // members checked, and settle the whole group before rejecting so no reads
    // escape the request or overlap a caller's retry after an early rejection.
    for (
      let start = 0, memberGroup = 0;
      start < savedMembers.length;
      start += 4, memberGroup += 1
    ) {
      const groupObservation = authorizationObservation?.scope({ memberGroup });
      await observeEngineeringRead(
        groupObservation,
        'matter_recheck_saved_members',
        () =>
          this.requireInputs(
            savedMembers.slice(start, start + 4),
            actor,
            groupObservation,
            'saved',
          ),
      );
    }
    return revision;
  }

  async resolveWorkingBasis(
    matterId: string,
    actor: CanonicalHostActor,
  ): Promise<EngineeringMatterWorkingBasis> {
    return this.resolveBrowserBasisStable(matterId, actor, 0);
  }

  /**
   * Hosted runtime path: resolves only from official persisted identity and
   * owner bindings on one actor-bound database transaction. It never creates
   * or accepts a synthetic CanonicalHostActor.
   */
  async authorizeRuntimeWorkingBasis(input: {
    matterId: string;
    tenantId: string;
    actorId: string;
    basedOnMatterRevisionId?: string;
  }): Promise<EngineeringMatterWorkingBasis> {
    return this.working.withActorTransaction(
      input.actorId,
      async (executor) => {
        const authorized = await this.working.authorizeRuntimeInputs(
          {
            tenantId: input.tenantId,
            matterId: input.matterId,
            actorUserId: input.actorId,
            ...(input.basedOnMatterRevisionId
              ? { basedOnMatterRevisionId: input.basedOnMatterRevisionId }
              : {}),
          },
          executor.database,
        );
        const [snapshot, working] = await Promise.all([
          this.matters.loadCurrent(
            { tenantId: input.tenantId, matterId: input.matterId },
            executor.database,
          ),
          executor.loadCurrent({
            tenantId: input.tenantId,
            matterId: input.matterId,
          }),
        ]);
        if (
          !snapshot ||
          snapshot.currentMatterRevisionId !==
            authorized.currentMatterRevisionId ||
          snapshot.links.length +
            materialInputBindings(snapshot.materials ?? []).length !==
            authorized.currentInputs.length
        ) {
          throw workingReadConflict();
        }
        return {
          snapshot,
          currentInputs: authorized.currentInputs,
          working,
        };
      },
    );
  }

  /**
   * Null is an ordinary explanation: it performs no write and returns a fresh
   * authorized read. Non-null commands are Host-produced, version-bound work.
   */
  async applyWorkingUpdate(
    matterId: string,
    command: EngineeringMatterWorkingRevisionCommand | null,
    actor: CanonicalHostActor,
    options: EngineeringMatterWorkingApplyOptions = { source: null },
  ): Promise<EngineeringMatterWorkingApplyResult> {
    if (command === null) {
      return {
        working: await this.readWorking(matterId, actor),
        mutated: false,
      };
    }
    const authorized = await this.authorizedMatter(matterId, actor, 0);
    const commitInput = {
      tenantId: actor.tenantId,
      matterId,
      actorUserId: actor.userId,
      command,
      currentInputs: authorized.currentInputs,
      source: options.source,
    };
    const commit = options.executor
      ? await options.executor.appendWorkingRevision(commitInput)
      : await this.working.commit(commitInput);
    const current = options.executor
      ? await options.executor.loadCurrent({
          tenantId: actor.tenantId,
          matterId,
        })
      : await this.working.loadCurrent({ tenantId: actor.tenantId, matterId });
    if (!current) throw workingPersistenceError();
    return {
      working: {
        matterId,
        currentMatterRevisionId: authorized.snapshot.currentMatterRevisionId,
        currentWorkingRevision: current.workingRevision,
        current,
        pendingInputs: engineeringMatterPendingInputs(
          current.state,
          authorized.currentInputs,
        ),
      },
      mutated: true,
      commit,
    };
  }

  private async resolveBrowserBasisStable(
    matterId: string,
    actor: CanonicalHostActor,
    attempt: number,
  ): Promise<EngineeringMatterWorkingBasis> {
    const authorized = await this.authorizedMatter(matterId, actor, attempt);
    const current = await this.working.loadCurrent({
      tenantId: actor.tenantId,
      matterId,
    });
    const [confirmedMatter, confirmedWorking] = await Promise.all([
      this.matters.loadCurrent({ tenantId: actor.tenantId, matterId }),
      this.working.loadCurrent({ tenantId: actor.tenantId, matterId }),
    ]);
    if (!confirmedMatter) throw matterNotFound();
    if (
      confirmedMatter.currentMatterRevisionId !==
        authorized.snapshot.currentMatterRevisionId ||
      (confirmedWorking?.workingRevision ?? 0) !==
        (current?.workingRevision ?? 0)
    ) {
      if (attempt === 0) {
        return this.resolveBrowserBasisStable(matterId, actor, 1);
      }
      throw workingReadConflict();
    }
    return {
      snapshot: confirmedMatter,
      currentInputs: authorized.currentInputs,
      working: current,
    };
  }

  private async authorizedMatter(
    matterId: string,
    actor: CanonicalHostActor,
    attempt: number,
    includeOriginalBindings = true,
    observation?: EngineeringReadPhaseObservation,
  ): Promise<AuthorizedMatter> {
    const snapshotObservation = nextReadObservation(observation);
    const snapshot = await observeEngineeringRead(
      snapshotObservation,
      'current_snapshot_read',
      () =>
        this.matters.loadCurrent({
          tenantId: actor.tenantId,
          matterId,
        }),
    );
    if (!snapshot) throw matterNotFound();
    if (
      snapshot.materials?.length &&
      (!actor.objectAccessActor ||
        !isHostedCanonicalFinalUserActor(actor.objectAccessActor) ||
        actor.objectAccessActor.tenantId !== actor.tenantId ||
        actor.objectAccessActor.canonicalSubject.id !== actor.userId)
    )
      throw identityHandoffUnavailable();
    const currentInputs = await this.requireInputs(
      snapshot.links.map(
        (link: EngineeringMatterRevisionLinkSnapshot) => link.workItemId,
      ),
      actor,
      observation,
      'current',
    );
    currentInputs.push(...materialInputBindings(snapshot.materials ?? []));
    const confirmationObservation = nextReadObservation(observation);
    const confirmed = await observeEngineeringRead(
      confirmationObservation,
      'current_snapshot_confirm',
      () =>
        this.matters.loadCurrent({
          tenantId: actor.tenantId,
          matterId,
        }),
    );
    if (!confirmed) throw matterNotFound();
    if (
      confirmed.currentMatterRevisionId !== snapshot.currentMatterRevisionId
    ) {
      if (attempt === 0)
        return this.authorizedMatter(
          matterId,
          actor,
          1,
          includeOriginalBindings,
          observation?.scope({ attempt: 1 }),
        );
      throw workingReadConflict();
    }
    return {
      snapshot,
      currentInputs: includeOriginalBindings
        ? await this.working.bindOriginalInputs(actor.tenantId, currentInputs)
        : currentInputs,
      observation,
    };
  }

  private async requireInputs(
    workItemIds: string[],
    actor: CanonicalHostActor,
    observation?: EngineeringReadPhaseObservation,
    stage: 'current' | 'saved' = 'current',
  ): Promise<EngineeringMatterWorkingInputBinding[]> {
    if (workItemIds.length === 0) return [];
    if (workItemIds.length === 1)
      return [
        await this.requireInput(workItemIds[0], actor, observation, stage),
      ];
    const objectAccessActor = actor.objectAccessActor;
    if (!objectAccessActor) throw identityHandoffUnavailable();
    // Each member retains its own fresh decision. The hosted adapter can read
    // up to four owner bindings in one statement; other adapters keep the
    // existing independent reads and all-settled behavior.
    const accessInputs: CanonicalWorkItemReadInput[] = workItemIds.map(
      (workItemId) => ({
        actor: objectAccessActor,
        action: 'READ_WORK_ITEM',
        accessRoot: { kind: 'WORK_ITEM', id: workItemId },
      }),
    );
    const grantPhase = `${stage}_member_grant`;
    const freshReadBatch = this.objectAccess.freshReadBatch;
    const grantObservation =
      freshReadBatch && workItemIds.length <= 4
        ? nextReadObservation(observation)
        : undefined;
    const decisions: PromiseSettledResult<CanonicalObjectAccessResult>[] =
      freshReadBatch && workItemIds.length <= 4
        ? await observeEngineeringRead(grantObservation, grantPhase, () =>
            freshReadBatch.call(this.objectAccess, accessInputs),
          )
        : await Promise.allSettled(
            accessInputs.map((input) => {
              const itemObservation = nextReadObservation(observation);
              return observeEngineeringRead(itemObservation, grantPhase, () =>
                this.objectAccess.freshRead(input),
              );
            }),
          );
    observation?.mark(`${stage}_member_grant_ready`, 'ok', {
      participants: workItemIds.length,
    });
    if (decisions.length !== workItemIds.length)
      throw new Error('WORK_ITEM_AUTHORIZATION_BATCH_INCOMPLETE');
    const grants: CanonicalObjectAccessGrant[] = [];
    for (const decision of decisions) {
      if (decision.status === 'rejected') {
        observation?.mark(`${stage}_member_identity`, 'skip', {
          skipped: workItemIds.length,
        });
        throw decision.reason;
      }
      if (decision.value.allowed === false) {
        observation?.mark(`${stage}_member_identity`, 'skip', {
          skipped: workItemIds.length,
        });
        throw Object.assign(new Error('WorkItem is not available.'), {
          code: decision.value.code,
          statusCode: decision.value.statusCode,
        });
      }
      grants.push(decision.value);
    }
    const identityObservation = nextReadObservation(
      observation,
      grantObservation?.context.readInstance,
    );
    identityObservation?.mark(`${stage}_member_identity_dispatch`, 'ok', {
      participants: grants.length,
    });
    const scopedById = await observeEngineeringRead(
      identityObservation,
      `${stage}_member_identity`,
      () =>
        this.workItems.loadTenantScopedMemberIdentities(
          grants.map((grant) => ({
            workItemId: grant.workItemId,
            documentVersionId: grant.documentVersionId,
          })),
          actor.tenantId,
        ),
    );
    const bindings = grants.map((grant, index) =>
      this.validateInput(
        workItemIds[index],
        grant,
        scopedById.get(grant.workItemId),
      ),
    );
    identityObservation?.mark(`${stage}_member_identity_distribution`, 'ok', {
      participants: bindings.length,
    });
    return bindings;
  }

  private async requireInput(
    workItemId: string,
    actor: CanonicalHostActor,
    observation?: EngineeringReadPhaseObservation,
    stage: 'current' | 'saved' = 'current',
  ): Promise<EngineeringMatterWorkingInputBinding> {
    if (!actor.objectAccessActor) throw identityHandoffUnavailable();
    const grantObservation = nextReadObservation(observation);
    const access = await observeEngineeringRead(
      grantObservation,
      `${stage}_member_grant`,
      () =>
        this.objectAccess.freshRead({
          actor: actor.objectAccessActor!,
          action: 'READ_WORK_ITEM',
          accessRoot: { kind: 'WORK_ITEM', id: workItemId },
        }),
    );
    if (access.allowed === false) {
      observation?.mark(`${stage}_member_identity`, 'skip', { skipped: 1 });
      throw Object.assign(new Error('WorkItem is not available.'), {
        code: access.code,
        statusCode: access.statusCode,
      });
    }
    // Fresh access binds the source before the tenant/source composite read.
    const identityObservation = nextReadObservation(
      observation,
      grantObservation?.context.readInstance,
    );
    const scoped = await observeEngineeringRead(
      identityObservation,
      `${stage}_member_identity`,
      () =>
        this.workItems.loadTenantScopedMemberIdentity(
          access.workItemId,
          actor.tenantId,
          access.documentVersionId,
        ),
    );
    return this.validateInput(workItemId, access, scoped);
  }

  private validateInput(
    workItemId: string,
    access: CanonicalObjectAccessGrant,
    scoped:
      | Awaited<
          ReturnType<MiaodaWorkItemRepository['loadTenantScopedMemberIdentity']>
        >
      | undefined,
  ): EngineeringMatterWorkingInputBinding {
    if (
      !scoped ||
      scoped.row.workItemId !== workItemId ||
      scoped.row.documentVersionId !== access.documentVersionId
    ) {
      throw workItemNotFound();
    }
    if (
      scoped.projection &&
      scoped.projection.source.documentVersionId !==
        scoped.row.documentVersionId
    ) {
      throw workItemDocumentConflict();
    }
    const source = scoped.sourceIdentity;
    if (!source) throw documentVersionNotFound();
    assertSourceIdentity(source);
    if (
      source.version.documentId !== scoped.row.documentId ||
      source.version.documentVersionId !== scoped.row.documentVersionId
    ) {
      throw workItemDocumentConflict();
    }
    return inputBinding(scoped);
  }
}

function nextReadObservation(
  observation?: EngineeringReadPhaseObservation,
  parentReadInstance?: number,
): EngineeringReadPhaseObservation | undefined {
  if (!observation) return undefined;
  const inheritedParent = observation.context.readInstance;
  const parent = parentReadInstance ?? inheritedParent;
  return observation.scope({
    readInstance: observation.nextReadInstance(),
    ...(parent !== undefined ? { parentReadInstance: parent } : {}),
  });
}

function inputBinding(
  scoped: TenantScopedWorkItem,
): EngineeringMatterWorkingInputBinding {
  return engineeringMatterInputBinding({
    workItemId: scoped.row.workItemId,
    workItemRevision: scoped.row.revision,
    documentVersionId: scoped.row.documentVersionId,
    projection: scoped.projection,
  });
}

function readModelFromBasis(
  basis: EngineeringMatterWorkingBasis,
): EngineeringMatterWorkingReadModel {
  return {
    matterId: basis.snapshot.matterId,
    currentMatterRevisionId: basis.snapshot.currentMatterRevisionId,
    currentWorkingRevision: basis.working?.workingRevision ?? 0,
    current: basis.working,
    pendingInputs: engineeringMatterPendingInputs(
      basis.working?.state ?? null,
      basis.currentInputs,
    ),
  };
}

function matterNotFound(): Error & { code: string; statusCode: number } {
  return coded('ENGINEERING_MATTER_NOT_FOUND', 404);
}

function workingReadConflict(): Error & { code: string; statusCode: number } {
  return coded('ENGINEERING_MATTER_WORKING_READ_CONFLICT', 409);
}

function workItemNotFound(): Error & { code: string; statusCode: number } {
  return coded('CANONICAL_WORK_ITEM_NOT_FOUND', 404);
}

function documentVersionNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return coded('DOCUMENT_VERSION_NOT_FOUND', 404);
}

function workItemDocumentConflict(): Error & {
  code: string;
  statusCode: number;
} {
  return coded('ENGINEERING_MATTER_WORK_ITEM_DOCUMENT_CONFLICT', 409);
}

function identityHandoffUnavailable(): Error & {
  code: string;
  statusCode: number;
} {
  return coded('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE', 503);
}

function workingPersistenceError(): Error & {
  code: string;
  statusCode: number;
} {
  return coded('ENGINEERING_MATTER_WORKING_PERSISTENCE_INVALID', 500);
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
