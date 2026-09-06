import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type {
  CanonicalLibraryDocumentSummary,
  CanonicalLibraryDocumentsRequest,
  CanonicalLibraryDocumentsResponse,
  CanonicalLibraryQuicklookResponse,
} from '@shared/api.interface';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_PERMISSION_SNAPSHOT,
} from './canonical-host.constants';
import type {
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
} from './canonical-host.types';
import { isHostedCanonicalFinalUserActor } from '../work-item/miaoda-hosted-canonical-object-access.adapter';
import {
  CanonicalLibraryRepository,
  type CanonicalLibraryCursor,
  type CanonicalLibrarySummaryRow,
} from './canonical-library.repository';

@Injectable()
export class CanonicalLibraryService {
  constructor(
    private readonly repository: CanonicalLibraryRepository,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissions: CanonicalPermissionSnapshotPort,
  ) {}

  async list(
    input: CanonicalLibraryDocumentsRequest,
    actor: CanonicalHostActor,
  ): Promise<CanonicalLibraryDocumentsResponse> {
    const scope = ownedScope(actor);
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new BadRequestException('LIBRARY_LIMIT_INVALID');
    }
    const search = input.search?.trim() ?? '';
    if (search.length > 200)
      throw new BadRequestException('LIBRARY_SEARCH_TOO_LONG');
    const cursor = decodeCursor(input.cursor, search);
    const rows = await this.repository.list({
      ...scope,
      search,
      cursor,
      limit,
    });
    const items = rows.slice(0, limit).map(summary);
    const last = items.at(-1);
    return {
      scope: 'CURRENT_USER_OWNED_WORK_ITEMS',
      order: 'CREATED_AT_DESC_WORK_ITEM_ID_DESC',
      items,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                createdAt: last.createdAt,
                workItemId: last.workItemId,
                search,
              }),
            ).toString('base64url')
          : null,
      fileReadPerformed: false,
    };
  }

  async quicklook(
    workItemId: string,
    actor: CanonicalHostActor,
  ): Promise<CanonicalLibraryQuicklookResponse> {
    const scope = ownedScope(actor);
    const decision = await this.authorization.authorize({
      actor,
      workItemId,
      action: 'READ_LIBRARY_INDEX',
    });
    if (!decision.allowed || decision.action !== 'READ_LIBRARY_INDEX')
      throw notFound();
    const fresh = await this.permissions.freshRead({
      actor,
      decision,
      workItemId,
    });
    if (
      fresh.permissionSnapshotVersion !== decision.permissionSnapshotVersion
    ) {
      throw Object.assign(new Error('LIBRARY_PERMISSION_SNAPSHOT_DRIFT'), {
        code: 'LIBRARY_PERMISSION_SNAPSHOT_DRIFT',
        statusCode: 403,
      });
    }
    const row = await this.repository.quicklook({ ...scope, workItemId });
    if (!row) throw notFound();
    const { result, ...document } = row;
    return { document: summary(document), result, fileReadPerformed: false };
  }
}

function ownedScope(actor: CanonicalHostActor) {
  const identity = actor.objectAccessActor;
  if (
    !identity ||
    !isHostedCanonicalFinalUserActor(identity) ||
    identity.canonicalSubject.id !== actor.userId ||
    identity.tenantId !== actor.tenantId ||
    identity.applicationScopeId !== actor.appId
  ) {
    throw Object.assign(new Error('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE'), {
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
    });
  }
  // Same fresh creator-only relation as MiaodaHostedCanonicalObjectAccessAdapter.
  // No tenant-wide grant, role bypass, client-supplied owner or reusable permission.
  return {
    tenantId: identity.tenantId,
    actorUserId: identity.canonicalSubject.id,
  };
}

function summary(
  row: CanonicalLibrarySummaryRow,
): CanonicalLibraryDocumentSummary {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sourceReadability: 'NOT_CHECKED',
  };
}

function decodeCursor(
  value: string | undefined,
  search: string,
): CanonicalLibraryCursor | null {
  if (!value) return null;
  try {
    if (value.length > 2048 || !/^[\w-]+$/u.test(value)) throw new Error();
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (!parsed || typeof parsed !== 'object') throw new Error();
    const cursor = parsed as Record<string, unknown>;
    if (
      typeof cursor.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(cursor.createdAt)) ||
      new Date(cursor.createdAt).toISOString() !== cursor.createdAt ||
      typeof cursor.workItemId !== 'string' ||
      !cursor.workItemId ||
      cursor.workItemId.length > 96 ||
      cursor.search !== search
    )
      throw new Error();
    return { createdAt: cursor.createdAt, workItemId: cursor.workItemId };
  } catch {
    throw new BadRequestException('LIBRARY_CURSOR_INVALID');
  }
}

function notFound() {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}
