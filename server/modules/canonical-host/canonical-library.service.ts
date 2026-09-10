import { jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CanonicalFleetMasterDataRepository } from './canonical-fleet-master-data.repository';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import type {
  CanonicalLibraryDocumentSummary,
  CanonicalLibraryDocumentsRequest,
  CanonicalLibraryDocumentsResponse,
  CanonicalLibraryTasksRequest,
  CanonicalLibraryTasksResponse,
  CanonicalLibraryWorkItemSummary,
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
  private readonly logger = new Logger(CanonicalLibraryService.name);
  constructor(
    private readonly repository: CanonicalLibraryRepository,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissions: CanonicalPermissionSnapshotPort,
    @Optional() private readonly jobAid?: CanonicalJobAidProblemService,
    @Optional() private readonly fleet?: CanonicalFleetMasterDataRepository,
  ) {}

  async fleetCatalog(
    actor: CanonicalHostActor,
  ): Promise<CanonicalLibraryFleetCatalog> {
    const { tenantId } = ownedScope(actor);
    try {
      if (!this.fleet) throw new Error('FLEET_REPOSITORY_UNCONFIGURED');
      return await this.fleet.readLibraryCatalog({
        tenantId,
        asOf: new Date().toISOString().slice(0, 10),
      });
    } catch (error) {
      this.logger.error(
        'LIBRARY_FLEET_CATALOG_READ_FAILED',
        error instanceof Error ? error.stack : 'Non-Error database failure',
      );
      throw new ServiceUnavailableException({
        code: 'LIBRARY_FLEET_CATALOG_READ_FAILED',
        message: 'Unable to read current fleet catalog',
      });
    }
  }

  async list(
    input: CanonicalLibraryDocumentsRequest,
    actor: CanonicalHostActor,
  ): Promise<CanonicalLibraryDocumentsResponse> {
    const scope = ownedScope(actor);
    const normalizedFamily = input.normalizedFamily?.trim() ?? '';
    if (normalizedFamily.length > 96)
      throw new BadRequestException('LIBRARY_FAMILY_INVALID');
    const ata = input.ata?.trim() ?? '';
    const aircraftModel = input.aircraftModel?.trim() ?? '';
    if (ata.length > 96 || aircraftModel.length > 96)
      throw new BadRequestException('LIBRARY_FILTER_INVALID');
    const fleetFamily = input.fleetFamily?.trim().toUpperCase() ?? '';
    const fleetModel = input.fleetModel?.trim().toUpperCase() ?? '';
    if (
      fleetFamily.length > 96 ||
      fleetModel.length > 96 ||
      (fleetModel && !fleetFamily) ||
      (fleetFamily && aircraftModel)
    ) {
      throw new BadRequestException('LIBRARY_FLEET_FILTER_INVALID');
    }
    let fleetMentionValues: string[] | undefined;
    let fleetRevision: string[] | undefined;
    if (fleetFamily) {
      const catalog = await this.fleetCatalog(actor);
      if (catalog.status === 'MISSING')
        throw new ServiceUnavailableException({
          code: 'LIBRARY_FLEET_CATALOG_MISSING',
        });
      const family = catalog.families.find(
        (item) => item.fleetFamily === fleetFamily,
      );
      if (!family || (fleetModel && !family.models.includes(fleetModel)))
        throw new BadRequestException('LIBRARY_FLEET_FILTER_INVALID');
      fleetMentionValues = fleetModel
        ? [fleetModel]
        : [family.fleetFamily, ...family.models];
      fleetRevision = [
        catalog.source!.sourceSnapshotId,
        catalog.source!.authorityRevision,
        catalog.asOf,
      ];
    }
    const context = fleetFamily
      ? `DOCUMENTS:${JSON.stringify([normalizedFamily, ata, fleetFamily, fleetModel, fleetRevision])}`
      : normalizedFamily || ata || aircraftModel
        ? `DOCUMENTS:${JSON.stringify([normalizedFamily, ata, aircraftModel])}`
        : 'DOCUMENTS';
    const query = listQuery(input, context);
    const [result] = await this.repository.listDocuments({
      ...scope,
      ...query,
      normalizedFamily,
      ata,
      aircraftModel,
      ...(fleetMentionValues ? { fleetMentionValues } : {}),
    });
    const rows = result.rows;
    const items: CanonicalLibraryDocumentSummary[] = rows
      .slice(0, query.limit)
      .map((row) => ({
        ...row,
        kind: 'DOCUMENT',
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
        versions: row.versions.map((version) => ({
          ...version,
          committedAt: new Date(version.committedAt).toISOString(),
        })),
      }));
    const last = items.at(-1);
    return {
      scope: 'CURRENT_USER_DOCUMENT_CATALOG',
      totalCount: result.totalCount,
      familyCounts: result.familyCounts,
      ataCounts: result.ataCounts,
      aircraftModelCounts: result.aircraftModelCounts,
      order: 'FAMILY_CREATED_AT_DESC_FAMILY_ID_DESC',
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.createdAt, last.familyId, query.search, context)
          : null,
      fileReadPerformed: false,
    };
  }

  async listTasks(
    input: CanonicalLibraryTasksRequest,
    actor: CanonicalHostActor,
  ): Promise<CanonicalLibraryTasksResponse> {
    const scope = ownedScope(actor);
    const familyId = input.familyId?.trim() ?? '';
    if (familyId.length > 96)
      throw new BadRequestException('LIBRARY_FAMILY_INVALID');
    const context = `TASKS:${familyId}`;
    const query = listQuery(input, context);
    const rows = await this.repository.listTasks({
      ...scope,
      ...query,
      familyId,
    });
    const items = await Promise.all(
      rows.slice(0, query.limit).map(async (row) => {
        const item = summary(row);
        if (row.jobAidWorkRevisionRef) {
          if (!this.jobAid)
            throw new Error('JOBAID_LIBRARY_READER_UNAVAILABLE');
          const working = await this.jobAid.readBrowser(row.workItemId, actor);
          const revision = working.current;
          if (!revision)
            throw new Error('JOBAID_LIBRARY_WORK_READBACK_MISSING');
          const reading = jobAidReadingResult(revision);
          item.readingSummary = {
            resultRef: reading.resultRef,
            resultRevision: reading.resultRevision,
            headline: reading.content.headline,
            listBrief: reading.content.listBrief,
            roundCompletion: revision.content.roundCompletion,
            decisiveClaims: reading.content.claims
              .filter((claim) =>
                reading.content.decisiveClaimIds.includes(claim.claimId),
              )
              .map(({ claimId, text }) => ({ claimId, text })),
          };
        }
        return item;
      }),
    );
    const last = items.at(-1);
    return {
      scope: 'CURRENT_USER_OWNED_WORK_ITEMS',
      order: 'CREATED_AT_DESC_WORK_ITEM_ID_DESC',
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.createdAt, last.workItemId, query.search, context)
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
    if (row.jobAidWorkRevisionRef) {
      if (!this.jobAid) throw new Error('JOBAID_LIBRARY_READER_UNAVAILABLE');
      const working = await this.jobAid.readBrowser(workItemId, actor);
      const current = working.current;
      if (!current) throw new Error('JOBAID_LIBRARY_WORK_READBACK_MISSING');
      return {
        document: summary(document),
        result: {
          status: 'CANDIDATE_ONLY',
          revision: current.workRevision,
          sourceResultId: current.workRevisionRef,
          engineeringSummary: null,
          readingResult: jobAidReadingResult(current),
          overallCandidate: current.content.understanding,
          missingInputs: current.content.issues.flatMap((issue) =>
            issue.openQuestions.map((question) => question.question),
          ),
          gap: null,
          staleReason: null,
          sourceCount: current.content.evidence.filter(
            (item) => item.kind === 'DOCUMENT_PASSAGE',
          ).length,
          jobAidRoundCompletion: current.content.roundCompletion,
          overallStatus: working.overallStatus,
        },
        fileReadPerformed: false,
      };
    }
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
): CanonicalLibraryWorkItemSummary {
  const { jobAidWorkRevisionRef: _workRef, ...visible } = row;
  return {
    ...visible,
    kind: 'TASK',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sourceReadability: 'NOT_CHECKED',
  };
}

function decodeCursor(
  value: string | undefined,
  search: string,
  context: string,
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
      typeof cursor.itemId !== 'string' ||
      !cursor.itemId ||
      cursor.itemId.length > 96 ||
      cursor.search !== search ||
      cursor.context !== context
    )
      throw new Error();
    return { createdAt: cursor.createdAt, itemId: cursor.itemId };
  } catch {
    throw new BadRequestException('LIBRARY_CURSOR_INVALID');
  }
}

function listQuery(input: CanonicalLibraryDocumentsRequest, context: string) {
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new BadRequestException('LIBRARY_LIMIT_INVALID');
  const search = input.search?.trim() ?? '';
  if (search.length > 200)
    throw new BadRequestException('LIBRARY_SEARCH_TOO_LONG');
  return { limit, search, cursor: decodeCursor(input.cursor, search, context) };
}

function encodeCursor(
  createdAt: string,
  itemId: string,
  search: string,
  context: string,
): string {
  return Buffer.from(
    JSON.stringify({ createdAt, itemId, search, context }),
  ).toString('base64url');
}

function notFound() {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}
