import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  lt,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import type {
  EngineeringMatterDirectoryRequest,
  EngineeringMatterDirectoryResponse,
} from '@shared/api.interface';
import type {
  AssessmentReadingResult,
  AssessmentReadingSummary,
} from '@shared/assessment-reading.interface';
import {
  engineeringMatter,
  engineeringMatterMaterialLink,
  engineeringMatterRevisionWorkItem,
  engineeringMatterWorkRevision,
  workItem,
} from '../../database/schema';
import { isHostedCanonicalFinalUserActor } from '../work-item/miaoda-hosted-canonical-object-access.adapter';
import type { CanonicalHostActor } from './canonical-host.types';
import { EngineeringMatterService } from './engineering-matter.service';
import { EngineeringMatterWorkingService } from './engineering-matter-working.service';

type DirectoryOverallStatus =
  EngineeringMatterDirectoryResponse['items'][number]['overallStatus'];

interface DirectoryWorkingFact {
  matterId: string;
  workingRevision: number;
  basedOnMatterRevisionId: string;
  createdAt: Date;
  hasSubstantiveResult: boolean;
  resultRef: string | null;
  resultRevision: number | null;
  resultHeadline: string | null;
  resultListBrief: string | null;
  resultScopeKind: string | null;
  resultScopeMatterId: string | null;
  decisiveClaims: unknown;
  overallStatus: string | null;
}

@Injectable()
export class EngineeringMatterDirectoryService {
  // Row-level readers remain injectable for callers, but list deliberately uses
  // batch projections instead of entering either full read path.
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    _matters: EngineeringMatterService,
    _working: EngineeringMatterWorkingService,
  ) {}

  async list(
    input: EngineeringMatterDirectoryRequest,
    actor: CanonicalHostActor,
  ): Promise<EngineeringMatterDirectoryResponse> {
    const identity = actor.objectAccessActor;
    if (
      !identity ||
      !isHostedCanonicalFinalUserActor(identity) ||
      identity.tenantId !== actor.tenantId ||
      identity.canonicalSubject.id !== actor.userId
    )
      throw directoryError('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE', 503);
    const limit = input.limit ?? 20;
    const search = input.search?.trim() ?? '';
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      search.length > 200 ||
      (input.workItemId?.length ?? 0) > 96
    )
      throw directoryError('ENGINEERING_MATTER_DIRECTORY_QUERY_INVALID', 400);
    const cursor = decodeCursor(input.cursor, search, input.workItemId ?? '');
    const members = this.db
      .select({ id: engineeringMatterRevisionWorkItem.id })
      .from(engineeringMatterRevisionWorkItem)
      .where(
        and(
          eq(engineeringMatterRevisionWorkItem.tenantId, actor.tenantId),
          eq(
            engineeringMatterRevisionWorkItem.matterId,
            engineeringMatter.matterId,
          ),
          eq(
            engineeringMatterRevisionWorkItem.matterRevisionId,
            engineeringMatter.currentMatterRevisionId,
          ),
          notExists(
            this.db
              .select({ id: workItem.workItemId })
              .from(workItem)
              .where(
                and(
                  eq(workItem.tenantId, actor.tenantId),
                  eq(
                    workItem.workItemId,
                    engineeringMatterRevisionWorkItem.workItemId,
                  ),
                  eq(workItem.requestedByUserId, actor.userId),
                ),
              ),
          ),
        ),
      );
    const conditions = [
      eq(engineeringMatter.tenantId, actor.tenantId),
      notExists(members),
    ];
    if (search)
      conditions.push(
        ilike(
          engineeringMatter.title,
          `%${search.replace(/[\\%_]/gu, '\\$&')}%`,
        ),
      );
    if (input.workItemId)
      conditions.push(
        exists(
          this.db
            .select({ id: engineeringMatterRevisionWorkItem.id })
            .from(engineeringMatterRevisionWorkItem)
            .where(
              and(
                eq(engineeringMatterRevisionWorkItem.tenantId, actor.tenantId),
                eq(
                  engineeringMatterRevisionWorkItem.matterId,
                  engineeringMatter.matterId,
                ),
                eq(
                  engineeringMatterRevisionWorkItem.matterRevisionId,
                  engineeringMatter.currentMatterRevisionId,
                ),
                eq(
                  engineeringMatterRevisionWorkItem.workItemId,
                  input.workItemId,
                ),
              ),
            ),
        ),
      );
    if (cursor)
      conditions.push(
        or(
          lt(engineeringMatter.createdAt, cursor.createdAt),
          and(
            eq(engineeringMatter.createdAt, cursor.createdAt),
            lt(engineeringMatter.matterId, cursor.matterId),
          ),
        )!,
      );
    const rows = await this.db
      .select({
        matterId: engineeringMatter.matterId,
        title: engineeringMatter.title,
        currentMatterRevisionId: engineeringMatter.currentMatterRevisionId,
        createdAt: engineeringMatter.createdAt,
        updatedAt: engineeringMatter.updatedAt,
      })
      .from(engineeringMatter)
      .where(and(...conditions))
      .orderBy(
        desc(engineeringMatter.createdAt),
        desc(engineeringMatter.matterId),
      )
      .limit(limit + 1);
    const selected = rows.slice(0, limit);
    const matterIds: string[] = selected.map(
      (row: (typeof selected)[number]) => row.matterId,
    );
    const revisionIds: string[] = selected.map(
      (row: (typeof selected)[number]) => row.currentMatterRevisionId,
    );
    const [linkRows, materialRows, workingRows] = await Promise.all([
      revisionIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select({
              matterRevisionId:
                engineeringMatterRevisionWorkItem.matterRevisionId,
              workItemId: engineeringMatterRevisionWorkItem.workItemId,
              relationRole: engineeringMatterRevisionWorkItem.relationRole,
              ordinal: engineeringMatterRevisionWorkItem.ordinal,
            })
            .from(engineeringMatterRevisionWorkItem)
            .where(
              and(
                eq(engineeringMatterRevisionWorkItem.tenantId, actor.tenantId),
                inArray(
                  engineeringMatterRevisionWorkItem.matterRevisionId,
                  revisionIds,
                ),
              ),
            )
            .orderBy(
              asc(engineeringMatterRevisionWorkItem.matterRevisionId),
              asc(engineeringMatterRevisionWorkItem.ordinal),
            ),
      revisionIds.length === 0
        ? Promise.resolve([])
        : this.db
            .selectDistinctOn(
              [engineeringMatterMaterialLink.matterRevisionId],
              {
                matterRevisionId:
                  engineeringMatterMaterialLink.matterRevisionId,
              },
            )
            .from(engineeringMatterMaterialLink)
            .where(
              and(
                eq(engineeringMatterMaterialLink.tenantId, actor.tenantId),
                inArray(
                  engineeringMatterMaterialLink.matterRevisionId,
                  revisionIds,
                ),
              ),
            )
            .orderBy(asc(engineeringMatterMaterialLink.matterRevisionId)),
      matterIds.length === 0
        ? Promise.resolve([])
        : this.db
            .selectDistinctOn([engineeringMatterWorkRevision.matterId], {
              matterId: engineeringMatterWorkRevision.matterId,
              workingRevision: engineeringMatterWorkRevision.workingRevision,
              basedOnMatterRevisionId:
                engineeringMatterWorkRevision.basedOnMatterRevisionId,
              createdAt: engineeringMatterWorkRevision.createdAt,
              hasSubstantiveResult: sql<boolean>`
                  coalesce(
                    jsonb_typeof(
                      ${engineeringMatterWorkRevision.stateJson}::jsonb
                        -> 'substantiveResult'
                    ) <> 'null',
                    false
                  )`,
              resultRef: sql<string | null>`
                  ${engineeringMatterWorkRevision.stateJson}::jsonb
                    #>> '{substantiveResult,resultRef}'`,
              resultRevision: sql<number | null>`
                  (${engineeringMatterWorkRevision.stateJson}::jsonb
                    #>> '{substantiveResult,resultRevision}')::integer`,
              resultHeadline: sql<string | null>`
                  ${engineeringMatterWorkRevision.stateJson}::jsonb
                    #>> '{substantiveResult,content,headline}'`,
              resultListBrief: sql<string | null>`
                  ${engineeringMatterWorkRevision.stateJson}::jsonb
                    #>> '{substantiveResult,content,listBrief}'`,
              resultScopeKind: sql<string | null>`
                  ${engineeringMatterWorkRevision.stateJson}::jsonb
                    #>> '{substantiveResult,scope,kind}'`,
              resultScopeMatterId: sql<string | null>`
                  ${engineeringMatterWorkRevision.stateJson}::jsonb
                    #>> '{substantiveResult,scope,matterId}'`,
              decisiveClaims: sql<unknown>`
                  CASE
                    WHEN jsonb_typeof(
                      ${engineeringMatterWorkRevision.stateJson}::jsonb
                        -> 'substantiveResult' -> 'content' -> 'claims'
                    ) <> 'array' THEN NULL
                    ELSE (
                      SELECT coalesce(
                        jsonb_agg(
                          jsonb_build_object(
                            'claimId', claim ->> 'claimId',
                            'text', claim ->> 'text'
                          )
                          ORDER BY claim_order
                        ),
                        '[]'::jsonb
                      )
                      FROM jsonb_array_elements(
                        ${engineeringMatterWorkRevision.stateJson}::jsonb
                          -> 'substantiveResult' -> 'content' -> 'claims'
                      ) WITH ORDINALITY AS claims(claim, claim_order)
                      WHERE jsonb_exists(
                        ${engineeringMatterWorkRevision.stateJson}::jsonb
                          -> 'substantiveResult' -> 'content'
                          -> 'decisiveClaimIds',
                        claim ->> 'claimId'
                      )
                    )
                  END`,
              overallStatus: sql<string | null>`
                  ${engineeringMatterWorkRevision.stateJson}::jsonb
                    #>> '{problemWork,overviewStatus}'`,
            })
            .from(engineeringMatterWorkRevision)
            .where(
              and(
                eq(engineeringMatterWorkRevision.tenantId, actor.tenantId),
                inArray(engineeringMatterWorkRevision.matterId, matterIds),
              ),
            )
            .orderBy(
              asc(engineeringMatterWorkRevision.matterId),
              desc(engineeringMatterWorkRevision.workingRevision),
            ),
    ]);
    const primaryByRevision: Map<string, string[]> = new Map();
    for (const link of linkRows) {
      if (link.relationRole !== 'PRIMARY') continue;
      const primary = primaryByRevision.get(link.matterRevisionId) ?? [];
      primary.push(link.workItemId);
      primaryByRevision.set(link.matterRevisionId, primary);
    }
    const materialRevisions: Set<string> = new Set(
      materialRows.map(
        (row: { matterRevisionId: string }) => row.matterRevisionId,
      ),
    );
    const workingByMatter: Map<string, DirectoryWorkingFact> = new Map(
      workingRows.map((row) => [row.matterId, row]),
    );
    const items = selected.map((row: (typeof selected)[number]) => {
      const primary = primaryByRevision.get(row.currentMatterRevisionId) ?? [];
      const working = workingByMatter.get(row.matterId);
      if (
        primary.length !== 1 &&
        !materialRevisions.has(row.currentMatterRevisionId)
      )
        throw directoryError('ENGINEERING_MATTER_DIRECTORY_CHANGED', 409);
      if (
        working &&
        working.basedOnMatterRevisionId !== row.currentMatterRevisionId
      )
        throw directoryError('ENGINEERING_MATTER_DIRECTORY_CHANGED', 409);
      return {
        matterId: row.matterId,
        title: row.title,
        primaryWorkItemId: primary[0] ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt:
          working?.createdAt.toISOString() ?? row.updatedAt.toISOString(),
        currentMatterRevisionId: row.currentMatterRevisionId,
        workingRevision: working?.workingRevision ?? 0,
        result: working ? directoryResultSummary(working) : null,
        overallStatus: directoryOverallStatus(working?.overallStatus ?? null),
      };
    });
    const last = selected.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                createdAt: last.createdAt.toISOString(),
                matterId: last.matterId,
                search,
                workItemId: input.workItemId ?? '',
              }),
            ).toString('base64url')
          : null,
      fileReadPerformed: false,
    };
  }
}

export function assessmentReadingSummary(
  result: AssessmentReadingResult,
): AssessmentReadingSummary {
  const decisive = new Set(result.content.decisiveClaimIds);
  return {
    resultRef: result.resultRef,
    resultRevision: result.resultRevision,
    headline: result.content.headline,
    listBrief: result.content.listBrief,
    decisiveClaims: result.content.claims
      .filter((claim) => decisive.has(claim.claimId))
      .map((claim) => ({ claimId: claim.claimId, text: claim.text })),
  };
}

function directoryResultSummary(
  working: DirectoryWorkingFact,
): AssessmentReadingSummary | null {
  if (!working.hasSubstantiveResult) return null;
  if (
    working.resultScopeKind !== 'ENGINEERING_MATTER' ||
    working.resultScopeMatterId !== working.matterId
  ) {
    throw directoryError('ENGINEERING_MATTER_RESULT_BINDING_INVALID', 409);
  }
  if (
    typeof working.resultRef !== 'string' ||
    !working.resultRef.trim() ||
    !Number.isSafeInteger(working.resultRevision) ||
    Number(working.resultRevision) < 1 ||
    typeof working.resultHeadline !== 'string' ||
    typeof working.resultListBrief !== 'string' ||
    !Array.isArray(working.decisiveClaims)
  ) {
    throw directoryError('ENGINEERING_MATTER_DIRECTORY_CHANGED', 409);
  }
  const decisiveClaims: AssessmentReadingSummary['decisiveClaims'] = [];
  for (const claim of working.decisiveClaims) {
    if (
      !isRecord(claim) ||
      typeof claim.claimId !== 'string' ||
      typeof claim.text !== 'string'
    ) {
      throw directoryError('ENGINEERING_MATTER_DIRECTORY_CHANGED', 409);
    }
    decisiveClaims.push({ claimId: claim.claimId, text: claim.text });
  }
  return {
    resultRef: working.resultRef,
    resultRevision: working.resultRevision,
    headline: working.resultHeadline,
    listBrief: working.resultListBrief,
    decisiveClaims,
  };
}

function directoryOverallStatus(value: string | null): DirectoryOverallStatus {
  switch (value) {
    case null:
    case 'NOT_AVAILABLE':
    case 'CURRENT':
    case 'STALE':
      return value;
    default:
      throw directoryError('ENGINEERING_MATTER_DIRECTORY_CHANGED', 409);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeCursor(
  value: string | undefined,
  search: string,
  workItemId: string,
): { createdAt: Date; matterId: string } | null {
  if (!value) return null;
  try {
    if (value.length > 2048 || !/^[\w-]+$/u.test(value)) throw new Error();
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    if (
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.matterId !== 'string' ||
      !parsed.matterId ||
      parsed.matterId.length > 96 ||
      parsed.search !== search ||
      parsed.workItemId !== workItemId
    )
      throw new Error();
    const createdAt = new Date(parsed.createdAt);
    if (createdAt.toISOString() !== parsed.createdAt) throw new Error();
    return { createdAt, matterId: parsed.matterId };
  } catch {
    throw directoryError('ENGINEERING_MATTER_DIRECTORY_CURSOR_INVALID', 400);
  }
}
function directoryError(
  code: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}
