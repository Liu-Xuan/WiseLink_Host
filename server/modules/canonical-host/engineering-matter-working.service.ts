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
} from '../work-item/canonical-object-access.port';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import type { CanonicalHostActor } from './canonical-host.types';
import {
  engineeringMatterInputBinding,
  EngineeringMatterWorkingRepository,
  type EngineeringMatterWorkingTransactionExecutor,
} from './engineering-matter-working.repository';
import { engineeringMatterPendingInputs } from './engineering-matter-working-state';
import {
  EngineeringMatterRepository,
  type EngineeringMatterRevisionLinkSnapshot,
  type EngineeringMatterSnapshot,
} from './engineering-matter.repository';

type TenantScopedWorkItem = NonNullable<
  Awaited<ReturnType<MiaodaWorkItemRepository['loadTenantScopedProjection']>>
>;
type DocumentVersionSource = Awaited<
  ReturnType<MiaodaDocumentVersionSourceResolver['resolve']>
>;

interface AuthorizedMatter {
  snapshot: EngineeringMatterSnapshot;
  currentInputs: EngineeringMatterWorkingInputBinding[];
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
    private readonly documentVersions: MiaodaDocumentVersionSourceResolver,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
  ) {}

  async readWorking(
    matterId: string,
    actor: CanonicalHostActor,
  ): Promise<EngineeringMatterWorkingReadModel> {
    return readModelFromBasis(await this.resolveWorkingBasis(matterId, actor));
  }

  /** Browser path: requires the native actor and fresh object access per member. */
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
          snapshot.links.length !== authorized.currentInputs.length
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
    return { ...authorized, snapshot: confirmedMatter, working: current };
  }

  private async authorizedMatter(
    matterId: string,
    actor: CanonicalHostActor,
    attempt: number,
  ): Promise<AuthorizedMatter> {
    const snapshot = await this.matters.loadCurrent({
      tenantId: actor.tenantId,
      matterId,
    });
    if (!snapshot) throw matterNotFound();
    const currentInputs = await Promise.all(
      snapshot.links.map((link: EngineeringMatterRevisionLinkSnapshot) =>
        this.requireInput(link.workItemId, actor),
      ),
    );
    const confirmed = await this.matters.loadCurrent({
      tenantId: actor.tenantId,
      matterId,
    });
    if (!confirmed) throw matterNotFound();
    if (
      confirmed.currentMatterRevisionId !== snapshot.currentMatterRevisionId
    ) {
      if (attempt === 0) return this.authorizedMatter(matterId, actor, 1);
      throw workingReadConflict();
    }
    return { snapshot, currentInputs };
  }

  private async requireInput(
    workItemId: string,
    actor: CanonicalHostActor,
  ): Promise<EngineeringMatterWorkingInputBinding> {
    if (!actor.objectAccessActor) throw identityHandoffUnavailable();
    const access = await this.objectAccess.freshRead({
      actor: actor.objectAccessActor,
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: workItemId },
    });
    if (access.allowed === false) {
      throw Object.assign(new Error('WorkItem is not available.'), {
        code: access.code,
        statusCode: access.statusCode,
      });
    }
    const scoped: Awaited<
      ReturnType<MiaodaWorkItemRepository['loadTenantScopedProjection']>
    > = await this.workItems.loadTenantScopedProjection(
      access.workItemId,
      actor.tenantId,
    );
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
    let source: DocumentVersionSource;
    try {
      source = await this.documentVersions.resolve(
        scoped.row.documentVersionId,
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message === 'DOCUMENT_VERSION_NOT_FOUND'
      ) {
        throw documentVersionNotFound();
      }
      throw error;
    }
    if (
      source.version.documentId !== scoped.row.documentId ||
      source.version.documentVersionId !== scoped.row.documentVersionId
    ) {
      throw workItemDocumentConflict();
    }
    return inputBinding(scoped);
  }
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
