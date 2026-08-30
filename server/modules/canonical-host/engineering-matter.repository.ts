import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, eq } from 'drizzle-orm';

import type { EngineeringMatterWorkItemRole } from '@shared/api.interface';

import {
  engineeringMatter,
  engineeringMatterRevision,
  engineeringMatterRevisionWorkItem,
} from '../../database/schema';

export interface EngineeringMatterRevisionLinkSnapshot {
  workItemId: string;
  ordinal: number;
  relationRole: EngineeringMatterWorkItemRole;
  linkedAtWorkItemRevision: number;
}

export interface EngineeringMatterSnapshot {
  matterId: string;
  tenantId: string;
  title: string;
  status: 'ACTIVE';
  currentRevisionNo: number;
  currentMatterRevisionId: string;
  changeKind: 'CREATED' | 'WORK_ITEM_LINKED';
  changeSummary: string;
  revisionCreatedAt: Date;
  links: EngineeringMatterRevisionLinkSnapshot[];
}

export interface EngineeringMatterCreateResult {
  snapshot: EngineeringMatterSnapshot;
  created: boolean;
}

export interface EngineeringMatterLinkResult {
  snapshot: EngineeringMatterSnapshot;
  linked: boolean;
  replayed: boolean;
}

@Injectable()
export class EngineeringMatterRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async create(input: {
    tenantId: string;
    actorUserId: string;
    requestId: string;
    title: string;
    primaryWorkItemId: string;
    primaryWorkItemRevision: number;
  }): Promise<EngineeringMatterCreateResult> {
    const existing: EngineeringMatterSnapshot | null =
      await this.loadByCreateRequest(input);
    if (existing) return { snapshot: existing, created: false };

    const matterId: string = `MAT-${randomUUID()}`;
    const matterRevisionId: string = `MREV-${randomUUID()}`;
    const now: Date = new Date();
    try {
      await this.db.transaction(async (transaction) => {
        await transaction.insert(engineeringMatter).values({
          matterId,
          tenantId: input.tenantId,
          title: input.title,
          status: 'ACTIVE',
          currentRevisionNo: 1,
          currentMatterRevisionId: matterRevisionId,
          requestId: input.requestId,
          createdByUserId: input.actorUserId,
          createdAt: now,
          updatedAt: now,
        });
        await transaction.insert(engineeringMatterRevision).values({
          matterRevisionId,
          matterId,
          tenantId: input.tenantId,
          revisionNo: 1,
          requestId: input.requestId,
          changeKind: 'CREATED',
          changeSummary: 'Created Engineering Matter.',
          changedWorkItemId: input.primaryWorkItemId,
          createdByUserId: input.actorUserId,
          createdAt: now,
        });
        await transaction.insert(engineeringMatterRevisionWorkItem).values({
          matterRevisionId,
          matterId,
          tenantId: input.tenantId,
          workItemId: input.primaryWorkItemId,
          ordinal: 1,
          relationRole: 'PRIMARY',
          linkedAtWorkItemRevision: input.primaryWorkItemRevision,
        });
      });
    } catch (error: unknown) {
      if (isUniqueConflict(error)) {
        const replayed: EngineeringMatterSnapshot | null =
          await this.loadByCreateRequest(input);
        if (replayed) return { snapshot: replayed, created: false };
      }
      throw error;
    }
    const snapshot: EngineeringMatterSnapshot | null = await this.loadCurrent({
      tenantId: input.tenantId,
      matterId,
    });
    if (!snapshot) throw matterPersistenceError();
    return { snapshot, created: true };
  }

  async linkWorkItem(input: {
    tenantId: string;
    actorUserId: string;
    matterId: string;
    requestId: string;
    expectedMatterRevision: number;
    workItemId: string;
    workItemRevision: number;
    changeSummary: string;
  }): Promise<EngineeringMatterLinkResult> {
    const current: EngineeringMatterSnapshot | null = await this.loadCurrent({
      tenantId: input.tenantId,
      matterId: input.matterId,
    });
    if (!current) throw matterNotFound();
    const replayedRequest: EngineeringMatterRevisionRequest | null =
      await this.revisionRequest({
        matterId: input.matterId,
        requestId: input.requestId,
      });
    if (replayedRequest !== null) {
      if (
        replayedRequest.changeKind !== 'WORK_ITEM_LINKED' ||
        replayedRequest.changedWorkItemId !== input.workItemId ||
        replayedRequest.changeSummary !== input.changeSummary
      ) {
        throw matterRequestReplayMismatch();
      }
      return { snapshot: current, linked: false, replayed: true };
    }
    if (current.currentRevisionNo !== input.expectedMatterRevision) {
      throw matterCasConflict();
    }
    if (
      current.links.some(
        (link: EngineeringMatterRevisionLinkSnapshot) =>
          link.workItemId === input.workItemId,
      )
    ) {
      return { snapshot: current, linked: false, replayed: false };
    }

    const nextRevisionNo: number = current.currentRevisionNo + 1;
    const nextMatterRevisionId: string = `MREV-${randomUUID()}`;
    const now: Date = new Date();
    try {
      await this.db.transaction(async (transaction) => {
        await transaction.insert(engineeringMatterRevision).values({
          matterRevisionId: nextMatterRevisionId,
          matterId: input.matterId,
          tenantId: input.tenantId,
          revisionNo: nextRevisionNo,
          requestId: input.requestId,
          changeKind: 'WORK_ITEM_LINKED',
          changeSummary: input.changeSummary,
          changedWorkItemId: input.workItemId,
          createdByUserId: input.actorUserId,
          createdAt: now,
        });
        const copiedLinks: Array<
          typeof engineeringMatterRevisionWorkItem.$inferInsert
        > = current.links.map(
          (link: EngineeringMatterRevisionLinkSnapshot) => ({
            matterRevisionId: nextMatterRevisionId,
            matterId: input.matterId,
            tenantId: input.tenantId,
            workItemId: link.workItemId,
            ordinal: link.ordinal,
            relationRole: link.relationRole,
            linkedAtWorkItemRevision: link.linkedAtWorkItemRevision,
          }),
        );
        copiedLinks.push({
          matterRevisionId: nextMatterRevisionId,
          matterId: input.matterId,
          tenantId: input.tenantId,
          workItemId: input.workItemId,
          ordinal: copiedLinks.length + 1,
          relationRole: 'RELATED',
          linkedAtWorkItemRevision: input.workItemRevision,
        });
        await transaction
          .insert(engineeringMatterRevisionWorkItem)
          .values(copiedLinks);
        const updated: Array<{ matterId: string }> = await transaction
          .update(engineeringMatter)
          .set({
            currentRevisionNo: nextRevisionNo,
            currentMatterRevisionId: nextMatterRevisionId,
            updatedAt: now,
          })
          .where(
            and(
              eq(engineeringMatter.tenantId, input.tenantId),
              eq(engineeringMatter.matterId, input.matterId),
              eq(
                engineeringMatter.currentRevisionNo,
                input.expectedMatterRevision,
              ),
              eq(
                engineeringMatter.currentMatterRevisionId,
                current.currentMatterRevisionId,
              ),
            ),
          )
          .returning({ matterId: engineeringMatter.matterId });
        if (updated.length !== 1) throw matterCasConflict();
      });
    } catch (error: unknown) {
      if (isUniqueConflict(error)) {
        const replayedRequest: EngineeringMatterRevisionRequest | null =
          await this.revisionRequest({
            matterId: input.matterId,
            requestId: input.requestId,
          });
        if (replayedRequest === null) throw matterCasConflict();
        if (
          replayedRequest.changeKind !== 'WORK_ITEM_LINKED' ||
          replayedRequest.changedWorkItemId !== input.workItemId ||
          replayedRequest.changeSummary !== input.changeSummary
        ) {
          throw matterRequestReplayMismatch();
        }
        const replaySnapshot: EngineeringMatterSnapshot | null =
          await this.loadCurrent({
            tenantId: input.tenantId,
            matterId: input.matterId,
          });
        if (!replaySnapshot) throw matterNotFound();
        return {
          snapshot: replaySnapshot,
          linked: false,
          replayed: true,
        };
      }
      throw error;
    }

    const snapshot: EngineeringMatterSnapshot | null = await this.loadCurrent({
      tenantId: input.tenantId,
      matterId: input.matterId,
    });
    if (!snapshot) throw matterPersistenceError();
    return { snapshot, linked: true, replayed: false };
  }

  async loadCurrent(input: {
    tenantId: string;
    matterId: string;
  }): Promise<EngineeringMatterSnapshot | null> {
    const [row] = await this.db
      .select({
        matterId: engineeringMatter.matterId,
        tenantId: engineeringMatter.tenantId,
        title: engineeringMatter.title,
        status: engineeringMatter.status,
        currentRevisionNo: engineeringMatter.currentRevisionNo,
        currentMatterRevisionId: engineeringMatter.currentMatterRevisionId,
        revisionNo: engineeringMatterRevision.revisionNo,
        changeKind: engineeringMatterRevision.changeKind,
        changeSummary: engineeringMatterRevision.changeSummary,
        revisionCreatedAt: engineeringMatterRevision.createdAt,
      })
      .from(engineeringMatter)
      .innerJoin(
        engineeringMatterRevision,
        and(
          eq(
            engineeringMatterRevision.matterRevisionId,
            engineeringMatter.currentMatterRevisionId,
          ),
          eq(engineeringMatterRevision.matterId, engineeringMatter.matterId),
          eq(engineeringMatterRevision.tenantId, engineeringMatter.tenantId),
        ),
      )
      .where(
        and(
          eq(engineeringMatter.tenantId, input.tenantId),
          eq(engineeringMatter.matterId, input.matterId),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (
      row.status !== 'ACTIVE' ||
      row.revisionNo !== row.currentRevisionNo ||
      (row.changeKind !== 'CREATED' && row.changeKind !== 'WORK_ITEM_LINKED')
    ) {
      throw matterPersistenceError();
    }
    const linkRows: Array<
      typeof engineeringMatterRevisionWorkItem.$inferSelect
    > = await this.db
      .select()
      .from(engineeringMatterRevisionWorkItem)
      .where(
        and(
          eq(
            engineeringMatterRevisionWorkItem.matterRevisionId,
            row.currentMatterRevisionId,
          ),
          eq(engineeringMatterRevisionWorkItem.matterId, row.matterId),
          eq(engineeringMatterRevisionWorkItem.tenantId, row.tenantId),
        ),
      )
      .orderBy(asc(engineeringMatterRevisionWorkItem.ordinal));
    if (linkRows.length === 0) throw matterPersistenceError();
    const links: EngineeringMatterRevisionLinkSnapshot[] = linkRows.map(
      (link: typeof engineeringMatterRevisionWorkItem.$inferSelect) => ({
        workItemId: link.workItemId,
        ordinal: link.ordinal,
        relationRole: requiredRole(link.relationRole),
        linkedAtWorkItemRevision: link.linkedAtWorkItemRevision,
      }),
    );
    return {
      matterId: row.matterId,
      tenantId: row.tenantId,
      title: row.title,
      status: row.status,
      currentRevisionNo: row.currentRevisionNo,
      currentMatterRevisionId: row.currentMatterRevisionId,
      changeKind: row.changeKind,
      changeSummary: row.changeSummary,
      revisionCreatedAt: row.revisionCreatedAt,
      links,
    };
  }

  private async loadByCreateRequest(input: {
    tenantId: string;
    actorUserId: string;
    requestId: string;
  }): Promise<EngineeringMatterSnapshot | null> {
    const [matter] = await this.db
      .select({ matterId: engineeringMatter.matterId })
      .from(engineeringMatter)
      .where(
        and(
          eq(engineeringMatter.tenantId, input.tenantId),
          eq(engineeringMatter.createdByUserId, input.actorUserId),
          eq(engineeringMatter.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (!matter) return null;
    return this.loadCurrent({
      tenantId: input.tenantId,
      matterId: matter.matterId,
    });
  }

  private async revisionRequest(input: {
    matterId: string;
    requestId: string;
  }): Promise<EngineeringMatterRevisionRequest | null> {
    const [row] = await this.db
      .select({
        changedWorkItemId: engineeringMatterRevision.changedWorkItemId,
        changeKind: engineeringMatterRevision.changeKind,
        changeSummary: engineeringMatterRevision.changeSummary,
      })
      .from(engineeringMatterRevision)
      .where(
        and(
          eq(engineeringMatterRevision.matterId, input.matterId),
          eq(engineeringMatterRevision.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (row.changeKind !== 'CREATED' && row.changeKind !== 'WORK_ITEM_LINKED') {
      throw matterPersistenceError();
    }
    return {
      changedWorkItemId: row.changedWorkItemId,
      changeKind: row.changeKind,
      changeSummary: row.changeSummary,
    };
  }
}

interface EngineeringMatterRevisionRequest {
  changedWorkItemId: string;
  changeKind: 'CREATED' | 'WORK_ITEM_LINKED';
  changeSummary: string;
}

function requiredRole(value: string): EngineeringMatterWorkItemRole {
  if (value === 'PRIMARY' || value === 'RELATED') return value;
  throw matterPersistenceError();
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String(error.code) === '23505'
  );
}

function matterNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('Engineering Matter is not available.'), {
    code: 'ENGINEERING_MATTER_NOT_FOUND',
    statusCode: 404,
  });
}

function matterCasConflict(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('Engineering Matter revision changed.'), {
    code: 'ENGINEERING_MATTER_CAS_CONFLICT',
    statusCode: 409,
  });
}

function matterRequestReplayMismatch(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(
    new Error('Matter request id was reused with new input.'),
    {
      code: 'ENGINEERING_MATTER_REQUEST_REPLAY_MISMATCH',
      statusCode: 409,
    },
  );
}

function matterPersistenceError(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(
    new Error('Engineering Matter persistence is invalid.'),
    {
      code: 'ENGINEERING_MATTER_PERSISTENCE_INVALID',
      statusCode: 500,
    },
  );
}
