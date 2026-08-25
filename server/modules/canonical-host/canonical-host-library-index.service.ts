import { Injectable, Inject } from '@nestjs/common';

import type { CanonicalLibraryIndexReadResponse } from '@shared/api.interface';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_PERMISSION_SNAPSHOT,
} from './canonical-host.constants';
import { buildCanonicalPageProjections } from './canonical-host-page-projections';
import type {
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
} from './canonical-host.types';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';

const READ_ACTION = 'READ_LIBRARY_INDEX' as const;

@Injectable()
export class CanonicalHostLibraryIndexService {
  constructor(
    private readonly workItems: MiaodaWorkItemRepository,
    private readonly documentVersions: MiaodaDocumentVersionSourceResolver,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissions: CanonicalPermissionSnapshotPort,
  ) {}

  async read(input: {
    workItemId: string;
    actor: CanonicalHostActor;
  }): Promise<CanonicalLibraryIndexReadResponse> {
    const decision = await this.authorization.authorize({
      actor: input.actor,
      action: READ_ACTION,
      workItemId: input.workItemId,
    });
    if (decision.action !== READ_ACTION || decision.allowed !== true) {
      throw statusError(
        'CANONICAL_WORK_ITEM_NOT_FOUND',
        'The WorkItem is not available.',
        404,
      );
    }
    const fresh = await this.permissions.freshRead({
      actor: input.actor,
      decision,
      workItemId: input.workItemId,
    });
    if (
      fresh.permissionSnapshotVersion !== decision.permissionSnapshotVersion
    ) {
      throw statusError(
        'LIBRARY_INDEX_PERMISSION_SNAPSHOT_DRIFT',
        'The permission snapshot changed during the read.',
        403,
      );
    }

    const scoped = await this.workItems.loadTenantScopedProjection(
      input.workItemId,
      input.actor.tenantId,
    );
    if (!scoped || !scoped.projection) {
      throw statusError(
        'CANONICAL_WORK_ITEM_NOT_FOUND',
        'The WorkItem is not available.',
        404,
      );
    }

    const { row, projection } = scoped;

    // The existing DM resolver is the sole source of document identity and
    // currentness. It also verifies immutable source-artifact byte identity.
    let source: Awaited<
      ReturnType<MiaodaDocumentVersionSourceResolver['resolve']>
    >;
    try {
      source = await this.documentVersions.resolve(row.documentVersionId);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'DOCUMENT_VERSION_NOT_FOUND'
      ) {
        throw statusError(
          'LIBRARY_DOCUMENT_VERSION_NOT_FOUND',
          'The selected DocumentVersion is not available.',
          404,
        );
      }
      throw error;
    }
    if (source.version.documentId !== row.documentId) {
      throw statusError(
        'LIBRARY_DOCUMENT_BINDING_MISMATCH',
        'The WorkItem document binding is inconsistent with DocumentManagement.',
        409,
      );
    }
    const libraryIndex = buildCanonicalPageProjections({
      workItem: projection,
      queryResults: [],
      engineerReviewContext: null,
    }).libraryIndex;

    return {
      schemaVersion: 'wiselink.3_1.library_index_read.v0.candidate',
      scope: 'CURRENT_WORKITEM_ONLY',
      workItem: {
        workItemId: projection.workItemId,
        revision: projection.revision,
        phase: projection.phase,
      },
      document: {
        documentId: source.version.documentId,
        documentVersionId: source.version.documentVersionId,
        documentCode: source.family.canonicalDocumentNumber,
        businessRevision: source.version.businessRevision,
        normalizedFamily: source.family.documentFamily,
      },
      currentness: {
        familyId: source.family.familyId,
        currentDocumentVersionId: source.family.currentDocumentVersionId,
        currentGeneration: source.family.currentGeneration,
        selectedVersionIsCurrent:
          source.family.currentDocumentVersionId ===
          source.version.documentVersionId,
      },
      libraryIndex,
      readAuthorization: {
        action: READ_ACTION,
        decisionId: decision.decisionId,
        permissionSnapshotVersion: fresh.permissionSnapshotVersion,
      },
    };
  }
}

function statusError(
  code: string,
  message: string,
  statusCode: number,
): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(message), { code, statusCode });
}
