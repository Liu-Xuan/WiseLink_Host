import type { JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
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

export interface EngineeringSearchPendingRevision {
  tenantId: string;
  revisionRef: string;
  ownerKind: 'USER' | 'MATTER';
  ownerId: string;
  subjectId: string | null;
  lastError: string;
  attempts: number;
}

function pendingIdentity(item: Pick<EngineeringSearchPendingRevision,
  'tenantId' | 'revisionRef' | 'ownerKind' | 'ownerId' | 'subjectId'>) {
  return and(eq(engineeringSearchProjectionPending.tenantId, item.tenantId),
    eq(engineeringSearchProjectionPending.exactRevisionRef, item.revisionRef),
    eq(engineeringSearchProjectionPending.ownerKind, item.ownerKind),
    eq(engineeringSearchProjectionPending.ownerId, item.ownerId),
    item.subjectId === null ? isNull(engineeringSearchProjectionPending.subjectId)
      : eq(engineeringSearchProjectionPending.subjectId, item.subjectId));
}

function projectionFailureCode(error: unknown): string {
  // SQL wrapper messages can contain source text or parameters. Keep codes only.
  let code = 'ENGINEERING_SEARCH_PROJECTION_FAILED';
  for (let depth = 0; depth < 5 && error instanceof Error; depth += 1) {
    if ('code' in error && typeof error.code === 'string' && /^[A-Z0-9_:-]+$/u.test(error.code)) {
      code = error.code;
    } else if (/^[A-Z][A-Z0-9_:-]+$/u.test(error.message)) {
      code = error.message;
    }
    error = error.cause;
  }
  return code.slice(0, 2000);
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
    })) {
      if (typeof value !== 'string' || value.trim() === '' || value.length > 255) {
        throw new Error(`ENGINEERING_SEARCH_SOURCE_${name.toUpperCase()}_INVALID`);
      }
    }
    if (typeof entry.originalText !== 'string' || entry.originalText.trim() === '') {
      throw new Error('ENGINEERING_SEARCH_SOURCE_ORIGINALTEXT_INVALID');
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

/** The same saved-work corpus is used by indexed and authorized direct search. */
export function buildWorkIssueSearchText(content: JobAidProblemWorkContent,
  issue: JobAidProblemWorkContent['issues'][number], fallbackTitle: string): EngineeringSearchText {
  const text = [content.headline, content.listBrief, content.understanding,
    content.completionReason, issue.question, issue.body,
    ...(issue.riskScenarios ?? []).map(item => `${item.scenario}\n${item.conditions.join(' ')}\n${item.limitations.join(' ')}\n${item.controlComparison}`),
    ...(issue.measures ?? []).map(item => `${item.text}\n${item.addresses}\n${item.limitations.join(' ')}`),
    ...(issue.openQuestions ?? []).map(item => `${item.question}\n${item.affects}\n${item.nextEvidence}\n${item.reason}`),
    ...(issue.requirementHandling ?? []).map(item => `${item.requirement}\n${item.conditions.join(' ')}\n${item.explanation}`),
    ...(issue.otherClassifications ?? []).map(item => `${item.value}\n${item.reason}`),
  ].filter(Boolean).join('\n');
  return buildEngineeringSearchText(text, [issue.issueKey || fallbackTitle]);
}

/** Builds only derived rows; callers persist them after a successful work CAS. */
export function buildWorkSearchProjection(input: {
  ownerKind: 'USER' | 'MATTER'; ownerId: string; subjectId: string; exactRevisionRef: string;
  content: JobAidProblemWorkContent;
}): EngineeringSearchProjectionEntry[] {
  return input.content.issues.map((issue, index) => {
    const title = issue.issueKey || `issue-${index + 1}`;
    return { entryId: `${input.exactRevisionRef}:issue:${issue.issueKey || index + 1}`,
      ownerKind: input.ownerKind, ownerId: input.ownerId, exactRevisionRef: input.exactRevisionRef,
      entryKind: 'WORK', locatorRef: `issues[${index}]`, parentContextRef: input.subjectId, title,
      search: buildWorkIssueSearchText(input.content, issue, title) };
  });
}

@Injectable()
// Registered in CanonicalHostModule.register dynamic providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class EngineeringSearchProjectionWriter {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async indexJobAidRevision(input: { tenantId: string; ownerId: string; subjectId: string; revisionRef: string; content: JobAidProblemWorkContent; database?: PostgresJsDatabase }) {
    return this.indexWorkRevision({ ...input, ownerKind: 'USER' });
  }

  async indexMatterRevision(input: { tenantId: string; ownerId: string; subjectId: string; revisionRef: string; content: JobAidProblemWorkContent; database?: PostgresJsDatabase }) {
    return this.indexWorkRevision({ ...input, ownerKind: 'MATTER' });
  }

  private async indexWorkRevision(input: { tenantId: string; ownerKind: 'USER' | 'MATTER';
    ownerId: string; subjectId: string; revisionRef: string; content: JobAidProblemWorkContent;
    database?: PostgresJsDatabase }) {
    const rows = buildWorkSearchProjection({ ...input, exactRevisionRef: input.revisionRef });
    const write = async (tx: PostgresJsDatabase) => {
      const existing = await tx.select({ ownerKind: engineeringSearchProjection.ownerKind,
        ownerId: engineeringSearchProjection.ownerId, subjectId: engineeringSearchProjection.parentContextRef,
        entryKind: engineeringSearchProjection.entryKind }).from(engineeringSearchProjection)
        .where(and(eq(engineeringSearchProjection.tenantId, input.tenantId),
          eq(engineeringSearchProjection.exactRevisionRef, input.revisionRef)));
      if (existing.some(row => row.ownerKind !== input.ownerKind || row.ownerId !== input.ownerId ||
        row.subjectId !== input.subjectId || row.entryKind !== 'WORK'))
        throw new Error('ENGINEERING_SEARCH_PROJECTION_IDENTITY_CONFLICT');
      await tx.delete(engineeringSearchProjection).where(and(
        eq(engineeringSearchProjection.tenantId, input.tenantId),
        eq(engineeringSearchProjection.ownerKind, input.ownerKind),
        eq(engineeringSearchProjection.ownerId, input.ownerId),
        eq(engineeringSearchProjection.parentContextRef, input.subjectId),
        eq(engineeringSearchProjection.exactRevisionRef, input.revisionRef)));
      if (rows.length > 0) await tx.insert(engineeringSearchProjection).values(rows.map(row => ({
        entryId: row.entryId, tenantId: input.tenantId, ownerKind: row.ownerKind, ownerId: row.ownerId,
        exactRevisionRef: row.exactRevisionRef, entryKind: row.entryKind, locatorRef: row.locatorRef,
        parentContextRef: row.parentContextRef, title: row.title, identifiers: row.search.identifiers,
        originalOrWorkText: row.search.originalText, tokenizedText: row.search.tokenizedText, indexedVersion: 1,
      })));
      await tx.delete(engineeringSearchProjectionPending).where(pendingIdentity(input));
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
      if (rows.length > 0) {
        // Readers deliver partial batches. Replacing a whole revision here
        // loses previously read passages; update only the exact entry identity.
        const written = await tx.insert(engineeringSearchProjection).values(rows.map((row) => ({
          entryId: row.entryId, tenantId: input.tenantId, ownerKind: row.ownerKind,
          ownerId: row.ownerId, exactRevisionRef: row.exactRevisionRef,
          entryKind: row.entryKind, locatorRef: row.locatorRef,
          parentContextRef: row.parentContextRef, title: row.title,
          identifiers: row.search.identifiers, originalOrWorkText: row.search.originalText,
          tokenizedText: row.search.tokenizedText, indexedVersion: 1,
        }))).onConflictDoUpdate({
          target: [engineeringSearchProjection.tenantId, engineeringSearchProjection.entryId],
          set: { title: sql`excluded.title`, identifiers: sql`excluded.identifiers`,
            originalOrWorkText: sql`excluded.original_or_work_text`, tokenizedText: sql`excluded.tokenized_text`,
            parentContextRef: sql`excluded.parent_context_ref`, indexedVersion: 1 },
          setWhere: and(eq(engineeringSearchProjection.ownerKind, 'SOURCE'),
            sql`${engineeringSearchProjection.ownerId} = excluded.owner_id`,
            sql`${engineeringSearchProjection.exactRevisionRef} = excluded.exact_revision_ref`,
            sql`${engineeringSearchProjection.locatorRef} = excluded.locator_ref`,
            sql`${engineeringSearchProjection.entryKind} = excluded.entry_kind`),
        }).returning({ entryId: engineeringSearchProjection.entryId });
        if (written.length !== rows.length) throw new Error('ENGINEERING_SEARCH_SOURCE_IDENTITY_CONFLICT');
      }
    };
    if (input.database) await write(input.database); else await this.db.transaction(write);
  }

  /** Called and awaited inside the authoritative work transaction; no index SQL here. */
  async enqueuePending(input: { tenantId: string; ownerKind: 'USER' | 'MATTER'; ownerId: string;
    subjectId: string; revisionRef: string; database: PostgresJsDatabase }): Promise<void> {
    if (!input.subjectId) throw new Error('ENGINEERING_SEARCH_PENDING_SUBJECT_MISSING');
    await input.database.insert(engineeringSearchProjectionPending).values({
      tenantId: input.tenantId, exactRevisionRef: input.revisionRef, ownerKind: input.ownerKind,
      ownerId: input.ownerId, subjectId: input.subjectId, lastError: '', attempts: 0,
    }).onConflictDoNothing({
      target: [engineeringSearchProjectionPending.tenantId, engineeringSearchProjectionPending.exactRevisionRef],
    });
  }

  async listPending(tenantId: string, actorUserId: string, limit = 100): Promise<EngineeringSearchPendingRevision[]> {
    if (!tenantId || !actorUserId || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('ENGINEERING_SEARCH_PENDING_QUERY_INVALID');
    // Both work and matter ownerId are the saved revision's creator, never matterId.
    // Filter before LIMIT so another actor's queue cannot starve this request.
    const rows = await this.db.select().from(engineeringSearchProjectionPending)
      .where(and(eq(engineeringSearchProjectionPending.tenantId, tenantId),
        eq(engineeringSearchProjectionPending.ownerId, actorUserId),
        inArray(engineeringSearchProjectionPending.ownerKind, ['USER', 'MATTER'])))
      .orderBy(engineeringSearchProjectionPending.exactRevisionRef).limit(limit);
    return rows.map(row => ({ tenantId: row.tenantId, revisionRef: row.exactRevisionRef,
      ownerKind: row.ownerKind as 'USER' | 'MATTER', ownerId: row.ownerId, subjectId: row.subjectId,
      lastError: row.lastError, attempts: row.attempts }));
  }

  private async lockPending(item: EngineeringSearchPendingRevision, database: PostgresJsDatabase): Promise<boolean> {
    const rows = await database.select({ id: engineeringSearchProjectionPending.id })
      .from(engineeringSearchProjectionPending).where(pendingIdentity(item)).limit(1).for('update');
    return rows.length === 1;
  }

  /** Each item rechecks the admitted request and authoritative saved revision in its write transaction. */
  async rebuildPending(input: {
    tenantId: string;
    actorUserId: string;
    limit?: number;
    verifySession: (database: PostgresJsDatabase) => Promise<void>;
    load: (pending: EngineeringSearchPendingRevision, database: PostgresJsDatabase) => Promise<JobAidProblemWorkContent>;
  }): Promise<{ attempted: number; rebuilt: number; failed: number }> {
    const pending = await this.listPending(input.tenantId, input.actorUserId, input.limit);
    let rebuilt = 0;
    let failed = 0;
    for (const item of pending) {
      // Defense in depth even if a replaced repository returns an invalid candidate.
      if (item.tenantId !== input.tenantId || item.ownerId !== input.actorUserId || !item.subjectId ||
        !['USER', 'MATTER'].includes(item.ownerKind)) {
        failed += 1;
        continue;
      }
      let sessionVerified = false;
      let contentAuthorized = false;
      try {
        const written = await this.db.transaction(async (tx: PostgresJsDatabase) => {
          await input.verifySession(tx);
          sessionVerified = true;
          if (!await this.lockPending(item, tx)) return false;
          const content = await input.load(item, tx);
          contentAuthorized = true;
          const write = { tenantId: input.tenantId, ownerId: input.actorUserId,
            subjectId: item.subjectId!, revisionRef: item.revisionRef, content, database: tx };
          if (item.ownerKind === 'USER') await this.indexJobAidRevision(write);
          else await this.indexMatterRevision(write);
          return true;
        });
        if (written) rebuilt += 1;
      } catch (error: unknown) {
        // Session denial must remain an HTTP auth error, never a successful receipt.
        if (!sessionVerified) throw error;
        failed += 1;
        // Authorization/identity failures are read-only, including attempts/lastError.
        if (!contentAuthorized || (error instanceof Error &&
          error.message === 'ENGINEERING_SEARCH_PROJECTION_IDENTITY_CONFLICT')) continue;
        let retrySessionVerified = false;
        try {
          await this.db.transaction(async (tx: PostgresJsDatabase) => {
            await input.verifySession(tx);
            retrySessionVerified = true;
            if (!await this.lockPending(item, tx)) return;
            await input.load(item, tx);
            // UPDATE only: a completed/deleted/rebound item must never be resurrected.
            await tx.update(engineeringSearchProjectionPending).set({
              attempts: sql`${engineeringSearchProjectionPending.attempts} + 1`,
              lastError: projectionFailureCode(error),
            }).where(pendingIdentity(item));
          });
        } catch (retryError: unknown) {
          if (!retrySessionVerified) throw retryError;
          // Preserve the failed receipt. A lost authorization or failed diagnostic
          // write cannot authorize another write or mask the original index failure.
        }
      }
    }
    return { attempted: pending.length, rebuilt, failed };
  }
}
