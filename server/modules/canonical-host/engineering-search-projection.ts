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
  entryKind: 'WORK';
  locatorRef: string;
  parentContextRef: string | null;
  title: string;
  search: EngineeringSearchText;
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
}
