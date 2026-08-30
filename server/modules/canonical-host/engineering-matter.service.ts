import { Inject, Injectable } from '@nestjs/common';

import type {
  CreateEngineeringMatterRequest,
  CreateEngineeringMatterResponse,
  EngineeringMatterCatalogEntry,
  EngineeringMatterReadModel,
  LinkEngineeringMatterWorkItemRequest,
  LinkEngineeringMatterWorkItemResponse,
} from '@shared/api.interface';

import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalObjectAccessPort,
} from '../work-item/canonical-object-access.port';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import {
  EngineeringMatterRepository,
  type EngineeringMatterRevisionLinkSnapshot,
  type EngineeringMatterSnapshot,
} from './engineering-matter.repository';
import type { CanonicalHostActor } from './canonical-host.types';

type TenantScopedWorkItem = NonNullable<
  Awaited<ReturnType<MiaodaWorkItemRepository['loadTenantScopedProjection']>>
>;
type DocumentVersionSource = Awaited<
  ReturnType<MiaodaDocumentVersionSourceResolver['resolve']>
>;

interface AuthorizedMatterWorkItem {
  scoped: TenantScopedWorkItem;
  source: DocumentVersionSource;
}

@Injectable()
export class EngineeringMatterService {
  constructor(
    private readonly matters: EngineeringMatterRepository,
    private readonly workItems: MiaodaWorkItemRepository,
    private readonly documentVersions: MiaodaDocumentVersionSourceResolver,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
  ) {}

  async create(
    input: CreateEngineeringMatterRequest,
    actor: CanonicalHostActor,
  ): Promise<CreateEngineeringMatterResponse> {
    const primary: AuthorizedMatterWorkItem = await this.requireWorkItem(
      input.primaryWorkItemId,
      actor,
    );
    const result = await this.matters.create({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      requestId: input.requestId,
      title: input.title,
      primaryWorkItemId: primary.scoped.row.workItemId,
      primaryWorkItemRevision: primary.scoped.row.revision,
    });
    if (!result.created) {
      const primaryLink: EngineeringMatterRevisionLinkSnapshot | undefined =
        result.snapshot.links.find(
          (link: EngineeringMatterRevisionLinkSnapshot) =>
            link.relationRole === 'PRIMARY',
        );
      if (
        result.snapshot.title !== input.title ||
        primaryLink?.workItemId !== input.primaryWorkItemId
      ) {
        throw requestReplayMismatch();
      }
    }
    return {
      matter: await this.read(result.snapshot.matterId, actor),
      created: result.created,
    };
  }

  async linkWorkItem(
    matterId: string,
    input: LinkEngineeringMatterWorkItemRequest,
    actor: CanonicalHostActor,
  ): Promise<LinkEngineeringMatterWorkItemResponse> {
    const current: EngineeringMatterSnapshot | null =
      await this.matters.loadCurrent({ tenantId: actor.tenantId, matterId });
    if (!current) throw matterNotFound();
    await Promise.all(
      current.links.map((link: EngineeringMatterRevisionLinkSnapshot) =>
        this.requireWorkItem(link.workItemId, actor),
      ),
    );
    const related: AuthorizedMatterWorkItem = await this.requireWorkItem(
      input.workItemId,
      actor,
    );
    const result = await this.matters.linkWorkItem({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      matterId,
      requestId: input.requestId,
      expectedMatterRevision: input.expectedMatterRevision,
      workItemId: related.scoped.row.workItemId,
      workItemRevision: related.scoped.row.revision,
      changeSummary:
        input.changeSummary ?? `Linked WorkItem ${input.workItemId}.`,
    });
    return {
      matter: await this.read(matterId, actor),
      linked: result.linked,
      replayed: result.replayed,
    };
  }

  async read(
    matterId: string,
    actor: CanonicalHostActor,
  ): Promise<EngineeringMatterReadModel> {
    return this.readStable(matterId, actor, 0);
  }

  private async readStable(
    matterId: string,
    actor: CanonicalHostActor,
    attempt: number,
  ): Promise<EngineeringMatterReadModel> {
    const snapshot: EngineeringMatterSnapshot | null =
      await this.matters.loadCurrent({ tenantId: actor.tenantId, matterId });
    if (!snapshot) throw matterNotFound();
    const entries: EngineeringMatterCatalogEntry[] = await Promise.all(
      snapshot.links.map(
        async (
          link: EngineeringMatterRevisionLinkSnapshot,
        ): Promise<EngineeringMatterCatalogEntry> => {
          const authorized: AuthorizedMatterWorkItem =
            await this.requireWorkItem(link.workItemId, actor);
          return catalogEntry(link, authorized);
        },
      ),
    );
    const confirmed: EngineeringMatterSnapshot | null =
      await this.matters.loadCurrent({ tenantId: actor.tenantId, matterId });
    if (!confirmed) throw matterNotFound();
    if (
      confirmed.currentMatterRevisionId !== snapshot.currentMatterRevisionId
    ) {
      if (attempt === 0) return this.readStable(matterId, actor, 1);
      throw matterReadConflict();
    }
    return {
      schemaVersion: 'wiselink.3_1.engineering_matter_catalog.v1',
      matterId: snapshot.matterId,
      title: snapshot.title,
      status: snapshot.status,
      currentRevision: {
        matterRevisionId: snapshot.currentMatterRevisionId,
        revisionNo: snapshot.currentRevisionNo,
        changeKind: snapshot.changeKind,
        changeSummary: snapshot.changeSummary,
        createdAt: snapshot.revisionCreatedAt.toISOString(),
      },
      catalog: { scope: 'CROSS_WORK_ITEM', entries },
      authorization: {
        policy: 'ALL_LINKED_WORK_ITEMS_REQUIRED',
        authorizedWorkItemCount: entries.length,
      },
      authority: {
        workItemCurrentRemainsAuthoritative: true,
        documentManagementRemainsAuthoritative: true,
        sourceRefsRemainWorkItemScoped: true,
        matterCreatesAssessmentCurrent: false,
      },
    };
  }

  private async requireWorkItem(
    workItemId: string,
    actor: CanonicalHostActor,
  ): Promise<AuthorizedMatterWorkItem> {
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
    return { scoped, source };
  }
}

function catalogEntry(
  link: EngineeringMatterRevisionLinkSnapshot,
  authorized: AuthorizedMatterWorkItem,
): EngineeringMatterCatalogEntry {
  const { row, projection } = authorized.scoped;
  const { version, family } = authorized.source;
  const sourceNavigation: EngineeringMatterCatalogEntry['sourceNavigation'] =
    projection?.package
      ? {
          status: 'AVAILABLE',
          sourceRefCount: projection.package.sourceRefCount,
          structuredContentPath: `/api/canonical-host/work-items/${encodeURIComponent(
            row.workItemId,
          )}/structured-content`,
        }
      : {
          status: 'NOT_PARSED',
          sourceRefCount: 0,
          structuredContentPath: null,
        };
  return {
    workItemId: row.workItemId,
    relationRole: link.relationRole,
    linkedAtWorkItemRevision: link.linkedAtWorkItemRevision,
    currentWorkItemRevision: row.revision,
    workItemChangedSinceLink: row.revision !== link.linkedAtWorkItemRevision,
    workItemStatus: row.status,
    document: {
      documentId: version.documentId,
      documentVersionId: version.documentVersionId,
      documentCode: family.canonicalDocumentNumber,
      businessRevision: version.businessRevision,
      normalizedFamily: family.documentFamily,
    },
    documentCurrentness: {
      familyId: family.familyId,
      currentDocumentVersionId: family.currentDocumentVersionId,
      currentGeneration: family.currentGeneration,
      selectedVersionIsCurrent:
        family.currentDocumentVersionId === version.documentVersionId,
    },
    sourceNavigation,
  };
}

function matterNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('Engineering Matter is not available.'), {
    code: 'ENGINEERING_MATTER_NOT_FOUND',
    statusCode: 404,
  });
}

function matterReadConflict(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('Engineering Matter changed during read.'), {
    code: 'ENGINEERING_MATTER_READ_CONFLICT',
    statusCode: 409,
  });
}

function requestReplayMismatch(): Error & { code: string; statusCode: number } {
  return Object.assign(
    new Error('Matter request id was reused with new input.'),
    {
      code: 'ENGINEERING_MATTER_REQUEST_REPLAY_MISMATCH',
      statusCode: 409,
    },
  );
}

function workItemNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('WorkItem is not available.'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}

function documentVersionNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('DocumentVersion is not available.'), {
    code: 'DOCUMENT_VERSION_NOT_FOUND',
    statusCode: 404,
  });
}

function workItemDocumentConflict(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(
    new Error('WorkItem document binding is inconsistent.'),
    {
      code: 'ENGINEERING_MATTER_WORK_ITEM_DOCUMENT_CONFLICT',
      statusCode: 409,
    },
  );
}

function identityHandoffUnavailable(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('Verified actor context is unavailable.'), {
    code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
    statusCode: 503,
  });
}
