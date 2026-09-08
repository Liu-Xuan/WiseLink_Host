import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, exists, ilike, lt, notExists, or } from 'drizzle-orm';
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
  engineeringMatterRevisionWorkItem,
  workItem,
} from '../../database/schema';
import { isHostedCanonicalFinalUserActor } from '../work-item/miaoda-hosted-canonical-object-access.adapter';
import type { CanonicalHostActor } from './canonical-host.types';
import { EngineeringMatterService } from './engineering-matter.service';
import { EngineeringMatterWorkingService } from './engineering-matter-working.service';

@Injectable()
export class EngineeringMatterDirectoryService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly matters: EngineeringMatterService,
    private readonly working: EngineeringMatterWorkingService,
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
    const items = await Promise.all(
      selected.map(async (row) => {
        const [matter, working] = await Promise.all([
          this.matters.read(row.matterId, actor),
          this.working.readWorking(row.matterId, actor),
        ]);
        const primary = matter.catalog.entries.filter(
          (entry) => entry.relationRole === 'PRIMARY',
        );
        if (
          primary.length !== 1 ||
          matter.currentRevision.matterRevisionId !==
            working.currentMatterRevisionId
        )
          throw directoryError('ENGINEERING_MATTER_DIRECTORY_CHANGED', 409);
        const result = working.current?.state.substantiveResult ?? null;
        if (
          result &&
          (result.scope.kind !== 'ENGINEERING_MATTER' ||
            result.scope.matterId !== matter.matterId)
        )
          throw directoryError(
            'ENGINEERING_MATTER_RESULT_BINDING_INVALID',
            409,
          );
        return {
          matterId: matter.matterId,
          title: matter.title,
          primaryWorkItemId: primary[0].workItemId,
          createdAt: row.createdAt.toISOString(),
          updatedAt: working.current?.createdAt ?? row.updatedAt.toISOString(),
          currentMatterRevisionId: working.currentMatterRevisionId,
          workingRevision: working.currentWorkingRevision,
          result: result ? assessmentReadingSummary(result) : null,
        };
      }),
    );
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
