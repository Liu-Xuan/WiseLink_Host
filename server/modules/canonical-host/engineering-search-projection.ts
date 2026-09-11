import type { JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql } from 'drizzle-orm';
import { engineeringSearchProjection, engineeringSearchProjectionPending } from '../../database/engineering-search.schema';
import { buildEngineeringSearchText, type EngineeringSearchText } from './engineering-search-text';

export interface EngineeringSearchProjectionEntry {
  entryId: string;
  ownerKind: 'USER' | 'MATTER' | 'SOURCE';
  ownerId: string;
  exactRevisionRef: string;
  entryKind: 'SOURCE' | 'RECORD' | 'WORK';
  locatorRef: string;
  parentContextRef: string | null;
  title: string;
  search: EngineeringSearchText;
}

export interface AuthorizedSearchProjectionEntryInput {
  /** Caller must have already performed the normal tenant/actor source read. */
  entryId: string;
  ownerKind: 'SOURCE';
  ownerId: string;
  exactRevisionRef: string;
  entryKind: 'SOURCE' | 'RECORD';
  locatorRef: string;
  parentContextRef?: string | null;
  title?: string;
  originalText: string;
  identifiers?: readonly string[];
}

/** Builds derived SOURCE/RECORD rows from an already-authorized Reader result. */
export function buildAuthorizedSourceSearchProjection(
  entries: readonly AuthorizedSearchProjectionEntryInput[],
): EngineeringSearchProjectionEntry[] {
  const seen = new Set<string>();
  return entries.map((entry) => {
    for (const [name, value] of Object.entries({
      entryId: entry.entryId, ownerId: entry.ownerId,
      exactRevisionRef: entry.exactRevisionRef, locatorRef: entry.locatorRef,
      originalText: entry.originalText,
    })) {
      if (typeof value !== 'string' || value.trim() === '' || value.length > 255) {
        throw new Error(`ENGINEERING_SEARCH_SOURCE_${name.toUpperCase()}_INVALID`);
      }
    }
    if (entry.entryId.length > 160) throw new Error('ENGINEERING_SEARCH_SOURCE_ENTRY_ID_INVALID');
    if (seen.has(entry.entryId)) throw new Error('ENGINEERING_SEARCH_SOURCE_ENTRY_DUPLICATE');
    seen.add(entry.entryId);
    if (entry.entryKind !== 'SOURCE' && entry.entryKind !== 'RECORD') {
      throw new Error('ENGINEERING_SEARCH_SOURCE_ENTRY_KIND_INVALID');
    }
    return {
    entryId: entry.entryId,
    ownerKind: entry.ownerKind,
    ownerId: entry.ownerId,
    exactRevisionRef: entry.exactRevisionRef,
    entryKind: entry.entryKind,
    locatorRef: entry.locatorRef,
    parentContextRef: entry.parentContextRef ?? null,
    title: entry.title ?? '',
    search: buildEngineeringSearchText(entry.originalText, entry.identifiers ?? []),
    };
  });
}

export function projectionOwnerToSubjectKind(ownerKind: string): 'WORK_ITEM' | 'ENGINEERING_MATTER' | null {
  if (ownerKind === 'USER') return 'WORK_ITEM';
  if (ownerKind === 'MATTER') return 'ENGINEERING_MATTER';
  return null;
}

/** Builds only derived rows; callers persist them after a successful work CAS. */
export function buildWorkSearchProjection(input: {
  ownerKind: 'USER' | 'MATTER'; ownerId: string; subjectId?: string; exactRevisionRef: string;
  content: JobAidProblemWorkContent;
}): EngineeringSearchProjectionEntry[] {
  return input.content.issues.map((issue, index) => {
    const title = issue.issueKey || `issue-${index + 1}`;
    const text = [issue.question, ...issue.statements.map(statement => statement.text ?? ''),
      ...(issue.riskScenarios ?? []).map(item => `${item.scenario}\n${item.conditions.join(' ')}`),
      ...(issue.measures ?? []).map(item => `${item.text}\n${item.addresses}`)].filter(Boolean).join('\n');
    return { entryId: `${input.exactRevisionRef}:issue:${issue.issueKey || index + 1}`,
      ownerKind: input.ownerKind, ownerId: input.ownerId, exactRevisionRef: input.exactRevisionRef,
      entryKind: 'WORK', locatorRef: `issues[${index}]`, parentContextRef: input.subjectId ?? input.ownerId, title,
      search: buildEngineeringSearchText(text, [issue.issueKey || title]) };
  });
}

@Injectable()
export class EngineeringSearchProjectionWriter {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async indexJobAidRevision(input: { tenantId: string; ownerId: string; revisionRef: string; content: JobAidProblemWorkContent; database?: PostgresJsDatabase }) {
    const rows = buildWorkSearchProjection({ ownerKind: 'USER', ownerId: input.ownerId, exactRevisionRef: input.revisionRef, content: input.content });
    const write = async (tx: PostgresJsDatabase) => {
      await tx.delete(engineeringSearchProjection).where(and(eq(engineeringSearchProjection.tenantId, input.tenantId), eq(engineeringSearchProjection.exactRevisionRef, input.revisionRef)));
      if (rows.length > 0) await tx.insert(engineeringSearchProjection).values(rows.map(row => ({
          entryId: row.entryId, tenantId: input.tenantId, ownerKind: row.ownerKind, ownerId: row.ownerId,
          exactRevisionRef: row.exactRevisionRef, entryKind: row.entryKind, locatorRef: row.locatorRef,
          parentContextRef: row.parentContextRef, title: row.title, identifiers: row.search.identifiers,
          originalOrWorkText: row.search.originalText, tokenizedText: row.search.tokenizedText, indexedVersion: 1,
        })));
      await tx.delete(engineeringSearchProjectionPending).where(and(eq(engineeringSearchProjectionPending.tenantId, input.tenantId), eq(engineeringSearchProjectionPending.exactRevisionRef, input.revisionRef)));
    };
    if (input.database) await write(input.database);
    else await this.db.transaction(write);
  }

  async indexMatterRevision(input: { tenantId: string; ownerId: string; subjectId: string; revisionRef: string; content: JobAidProblemWorkContent; database?: PostgresJsDatabase }) {
    const rows = buildWorkSearchProjection({ ownerKind: 'MATTER', ownerId: input.ownerId, subjectId: input.subjectId, exactRevisionRef: input.revisionRef, content: input.content });
    const write = async (tx: PostgresJsDatabase) => {
      await tx.delete(engineeringSearchProjection).where(and(eq(engineeringSearchProjection.tenantId, input.tenantId), eq(engineeringSearchProjection.exactRevisionRef, input.revisionRef)));
      if (rows.length > 0) await tx.insert(engineeringSearchProjection).values(rows.map(row => ({
        entryId: row.entryId, tenantId: input.tenantId, ownerKind: row.ownerKind, ownerId: row.ownerId,
        exactRevisionRef: row.exactRevisionRef, entryKind: row.entryKind, locatorRef: row.locatorRef,
        parentContextRef: row.parentContextRef, title: row.title, identifiers: row.search.identifiers,
        originalOrWorkText: row.search.originalText, tokenizedText: row.search.tokenizedText, indexedVersion: 1,
      })));
      await tx.delete(engineeringSearchProjectionPending).where(and(eq(engineeringSearchProjectionPending.tenantId, input.tenantId), eq(engineeringSearchProjectionPending.exactRevisionRef, input.revisionRef)));
    };
    if (input.database) await write(input.database); else await this.db.transaction(write);
  }

  /** Persists rows only after the caller's existing Reader/ACL has authorized them. */
  async indexAuthorizedSourceEntries(input: {
    tenantId: string;
    entries: readonly AuthorizedSearchProjectionEntryInput[];
    database?: PostgresJsDatabase;
  }): Promise<void> {
    const rows = buildAuthorizedSourceSearchProjection(input.entries);
    const write = async (tx: PostgresJsDatabase) => {
      const revisions = [...new Set(rows.map((row) => row.exactRevisionRef))];
      for (const revision of revisions) {
        await tx.delete(engineeringSearchProjection).where(and(
          eq(engineeringSearchProjection.tenantId, input.tenantId),
          eq(engineeringSearchProjection.ownerKind, 'SOURCE'),
          eq(engineeringSearchProjection.exactRevisionRef, revision),
        ));
      }
      if (rows.length > 0) {
        await tx.insert(engineeringSearchProjection).values(rows.map((row) => ({
          entryId: row.entryId, tenantId: input.tenantId, ownerKind: row.ownerKind,
          ownerId: row.ownerId, exactRevisionRef: row.exactRevisionRef,
          entryKind: row.entryKind, locatorRef: row.locatorRef,
          parentContextRef: row.parentContextRef, title: row.title,
          identifiers: row.search.identifiers, originalOrWorkText: row.search.originalText,
          tokenizedText: row.search.tokenizedText, indexedVersion: 1,
        })));
      }
    };
    if (input.database) await write(input.database); else await this.db.transaction(write);
  }

  async markPending(input: { tenantId: string; ownerKind: 'USER' | 'MATTER'; ownerId: string; subjectId?: string; revisionRef: string; error: unknown }): Promise<void> {
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    await this.db.insert(engineeringSearchProjectionPending).values({
      tenantId: input.tenantId, exactRevisionRef: input.revisionRef, ownerKind: input.ownerKind,
      ownerId: input.ownerId, subjectId: input.subjectId ?? null, lastError: message.slice(0, 2000), attempts: 1,
    }).onConflictDoUpdate({
      target: [engineeringSearchProjectionPending.tenantId, engineeringSearchProjectionPending.exactRevisionRef],
      set: { lastError: message.slice(0, 2000), attempts: sql`${engineeringSearchProjectionPending.attempts} + 1` },
    });
  }

  async listPending(tenantId: string, limit = 100): Promise<Array<{
    tenantId: string; revisionRef: string; ownerKind: 'USER' | 'MATTER'; ownerId: string; subjectId: string | null; lastError: string; attempts: number;
  }>> {
    if (!tenantId || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('ENGINEERING_SEARCH_PENDING_QUERY_INVALID');
    const rows = await this.db.select().from(engineeringSearchProjectionPending)
      .where(eq(engineeringSearchProjectionPending.tenantId, tenantId)).limit(limit);
    return rows.map(row => ({ tenantId: row.tenantId, revisionRef: row.exactRevisionRef,
      ownerKind: row.ownerKind as 'USER' | 'MATTER', ownerId: row.ownerId, subjectId: row.subjectId,
      lastError: row.lastError, attempts: row.attempts }));
  }

  /**
   * Rebuilds derived rows from the authoritative saved revision. The loader is
   * supplied by the caller so this class never bypasses the existing reader,
   * tenant or actor authorization boundary. A failed item remains pending and
   * is processed independently from later items.
   */
  async rebuildPending(input: {
    tenantId: string;
    limit?: number;
    load: (pending: {
      revisionRef: string;
      ownerKind: 'USER' | 'MATTER';
      ownerId: string;
      subjectId: string | null;
    }) => Promise<JobAidProblemWorkContent>;
  }): Promise<{ attempted: number; rebuilt: number; failed: number }> {
    const pending = await this.listPending(input.tenantId, input.limit);
    let rebuilt = 0;
    let failed = 0;
    for (const item of pending) {
      try {
        const content = await input.load(item);
        if (item.ownerKind === 'USER') {
          await this.indexJobAidRevision({ tenantId: input.tenantId, ownerId: item.ownerId, revisionRef: item.revisionRef, content });
        } else if (item.subjectId) {
          await this.indexMatterRevision({ tenantId: input.tenantId, ownerId: item.ownerId, subjectId: item.subjectId, revisionRef: item.revisionRef, content });
        } else {
          throw new Error('ENGINEERING_SEARCH_PENDING_SUBJECT_MISSING');
        }
        rebuilt += 1;
      } catch (error: unknown) {
        failed += 1;
        await this.markPending({ tenantId: input.tenantId, ownerKind: item.ownerKind, ownerId: item.ownerId,
          subjectId: item.subjectId ?? undefined, revisionRef: item.revisionRef, error });
      }
    }
    return { attempted: pending.length, rebuilt, failed };
  }
}
