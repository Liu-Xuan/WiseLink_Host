import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type {
  EngineeringIssueRead,
  EngineeringIssueSearchHit,
  EngineeringIssueSearchResponse,
} from '@shared/engineering-issue-search.interface';
import type { CanonicalHostActor } from './canonical-host.types';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';
import { EngineeringMatterWorkingService } from './engineering-matter-working.service';
import { isHostedCanonicalFinalUserActor } from '../work-item/miaoda-hosted-canonical-object-access.adapter';
import { jobAidReadingResult } from './jobaid-problem-work';
import { collectIssueEvidenceUses } from '@shared/jobaid-evidence-uses';
import { prepareEngineeringSearchQuery } from './engineering-search-text';
import { projectionOwnerToSubjectKind } from './engineering-search-projection';
import { EngineeringSearchProjectionWriter } from './engineering-search-projection';

type IssueIdentity = Pick<
  EngineeringIssueSearchHit,
  'subjectKind' | 'subjectId' | 'workRef' | 'issueKey'
> & { matchReason?: 'FULL_TEXT' | 'EXACT_IDENTIFIER' };
type SavedIssueWork =
  | Awaited<ReturnType<CanonicalJobAidProblemService['readBrowserRevision']>>
  | Awaited<ReturnType<EngineeringMatterWorkingService['readWorkingRevision']>>;

@Injectable()
export class EngineeringIssueSearchService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly jobAid: CanonicalJobAidProblemService,
    private readonly matters: EngineeringMatterWorkingService,
    private readonly projectionWriter?: EngineeringSearchProjectionWriter,
  ) {}

  /** Rebuilds derived search rows through the same actor-scoped readers as search/read. */
  async rebuildProjection(limit: number | undefined, actor: CanonicalHostActor): Promise<{
    attempted: number; rebuilt: number; failed: number;
  }> {
    this.requireActor(actor);
    if (!this.projectionWriter) throw new Error('ENGINEERING_SEARCH_PROJECTION_WRITER_UNAVAILABLE');
    return this.projectionWriter.rebuildPending({
      tenantId: actor.tenantId,
      limit,
      load: async pending => {
        if (!pending.subjectId) throw new BadRequestException('ENGINEERING_SEARCH_PENDING_SUBJECT_MISSING');
        if (pending.ownerKind === 'USER') {
          const revision = await this.jobAid.readBrowserRevision(pending.subjectId, pending.revisionRef, actor);
          if (!('content' in revision) || !revision.content) throw new NotFoundException('ENGINEERING_SEARCH_WORK_CONTENT_MISSING');
          return revision.content;
        }
        if (!pending.subjectId) throw new BadRequestException('ENGINEERING_SEARCH_PENDING_SUBJECT_MISSING');
        const revision = await this.matters.readWorkingRevision(pending.subjectId, pending.revisionRef, actor);
        if (!revision.state.problemWork) throw new NotFoundException('ENGINEERING_SEARCH_WORK_CONTENT_MISSING');
        return revision.state.problemWork;
      },
    });
  }

  async search(
    query: string,
    actor: CanonicalHostActor,
    scope: 'CURRENT' | 'HISTORY' = 'CURRENT',
  ): Promise<EngineeringIssueSearchResponse> {
    this.requireActor(actor);
    if (!['CURRENT','HISTORY'].includes(scope)) throw new BadRequestException('ENGINEERING_ISSUE_SEARCH_SCOPE_INVALID');
    const includeHistory = scope === 'HISTORY';
    const search = typeof query === 'string' ? query.trim() : '';
    if (!search || search.length > 200)
      throw new BadRequestException('ENGINEERING_ISSUE_QUERY_INVALID');
    const prepared = prepareEngineeringSearchQuery(search);
    const exactIdentifiers = identifierArray(prepared.exactIdentifierCandidates);
    if (process.env.WL_ENGINEERING_SEARCH_PROJECTION === '1') {
      return this.searchProjection(prepared, actor, includeHistory);
    }
    const hits: EngineeringIssueSearchHit[] = [];
    const workReads = new Map<string, Promise<SavedIssueWork>>();
    let cursor: IssueIdentity | undefined;
    // Page across denied work too: SQL's limit must not hide later readable issues.
    // The cursor stays internal and pagination hints count authorized hits only.
    while (hits.length < 51) {
      const candidates = await this.db.execute<
        EngineeringIssueSearchHit & Record<string, unknown>
      >(sql`
      WITH works AS (
        SELECT 'WORK_ITEM'::text AS kind, w.work_item_id AS subject_id,
          w.assessment_work_revision_id AS work_ref, w.work_revision AS revision,
          w.content_json::jsonb AS content
        FROM assessment_work_revision w
        WHERE w.tenant_id = ${actor.tenantId} AND w.created_by_user_id = ${actor.userId}
          AND (${includeHistory} OR NOT EXISTS (SELECT 1 FROM assessment_work_revision newer
            WHERE newer.tenant_id = w.tenant_id AND newer.work_item_id = w.work_item_id
              AND newer.work_revision > w.work_revision))
        UNION ALL
        SELECT 'ENGINEERING_MATTER', w.matter_id, w.matter_work_revision_id,
          w.working_revision, w.state_json::jsonb -> 'problemWork'
        FROM engineering_matter_work_revision w
        WHERE w.tenant_id = ${actor.tenantId} AND w.created_by_user_id = ${actor.userId}
          AND (${includeHistory} OR NOT EXISTS (SELECT 1 FROM engineering_matter_work_revision newer
            WHERE newer.tenant_id = w.tenant_id AND newer.matter_id = w.matter_id
              AND newer.working_revision > w.working_revision))
      )
      SELECT kind AS "subjectKind", subject_id AS "subjectId", work_ref AS "workRef",
        revision AS "workRevision", issue ->> 'issueKey' AS "issueKey",
        issue ->> 'question' AS question, issue -> 'sourceDependencies' AS "sourceRefs",
        CASE WHEN upper(issue ->> 'issueKey') = ANY(${exactIdentifiers})
          THEN 'EXACT_IDENTIFIER' ELSE 'FULL_TEXT' END AS "matchReason"
      FROM works CROSS JOIN LATERAL jsonb_array_elements(content -> 'issues') issue
      WHERE (
        to_tsvector('simple', issue::text) @@ plainto_tsquery('simple', ${prepared.tokenizedText})
        OR position(lower(${search}) in lower(issue::text)) > 0
        OR upper(issue ->> 'issueKey') = ANY(${exactIdentifiers})
      )
        ${
          cursor
            ? sql`AND (kind, subject_id, work_ref, issue ->> 'issueKey') >
          (${cursor.subjectKind}, ${cursor.subjectId}, ${cursor.workRef}, ${cursor.issueKey})`
            : sql``
        }
      ORDER BY kind, subject_id, work_ref, issue ->> 'issueKey'
      LIMIT 51
    `);
      for (const candidate of candidates) {
        try {
          // Reuse exact-work/source authorization, including retained private and
          // removed sources. Search metadata must not bypass the full reader.
          const key = JSON.stringify([
            candidate.subjectKind,
            candidate.subjectId,
            candidate.workRef,
          ]);
          let work = workReads.get(key);
          if (!work) {
            work = this.loadWork(candidate, actor);
            workReads.set(key, work);
          }
          const read = this.issueFromWork(candidate, await work);
          hits.push(read.identity);
          if (hits.length === 51) break;
        } catch (error: unknown) {
          if (!isAccessUnavailable(error)) throw error;
        }
      }
      if (candidates.length < 51 || hits.length === 51) break;
      cursor = candidates[candidates.length - 1];
    }
    // Even pagination hints derive only from authorized hits.
    return {
      hits: hits.slice(0, 50),
      hasMore: hits.length > 50,
      limitations: [includeHistory ? '包含历史已保存版本；历史内容不代表当前工作，每项仍按当前来源权限展开。' : '仅返回当前已保存且经授权展开的问题工作；结果不代表全量统计。'],
    };
  }

  private async searchProjection(prepared: ReturnType<typeof prepareEngineeringSearchQuery>, actor: CanonicalHostActor, includeHistory: boolean): Promise<EngineeringIssueSearchResponse> {
    type ProjectionRow = {
      entryId: string; ownerKind: string; ownerId: string; exactRevisionRef: string;
      parentContextRef: string | null; title: string;
      matchReason: 'FULL_TEXT' | 'EXACT_IDENTIFIER';
    };
    const exactIdentifiers = identifierArray(prepared.exactIdentifierCandidates);
    const hits: EngineeringIssueSearchHit[] = [];
    const workReads = new Map<string, Promise<SavedIssueWork>>();
    let cursor: string | undefined;
    let exhausted = false;
    while (hits.length < 51 && !exhausted) {
      const rows = await this.db.execute<ProjectionRow>(sql`SELECT entry_id AS "entryId", owner_kind AS "ownerKind", owner_id AS "ownerId",
        exact_revision_ref AS "exactRevisionRef", parent_context_ref AS "parentContextRef", title,
        CASE WHEN identifiers && ${exactIdentifiers}
          THEN 'EXACT_IDENTIFIER' ELSE 'FULL_TEXT' END AS "matchReason"
        FROM engineering_search_projection
        WHERE tenant_id = ${actor.tenantId}
          AND entry_kind = 'WORK'
          AND ((owner_kind = 'USER' AND EXISTS (
            SELECT 1 FROM assessment_work_revision w
            WHERE w.tenant_id = engineering_search_projection.tenant_id
              AND w.work_item_id = engineering_search_projection.parent_context_ref
              AND w.assessment_work_revision_id = engineering_search_projection.exact_revision_ref
              AND (${includeHistory} OR NOT EXISTS (SELECT 1 FROM assessment_work_revision newer
                WHERE newer.tenant_id = w.tenant_id AND newer.work_item_id = w.work_item_id
                  AND newer.work_revision > w.work_revision))
          )) OR (owner_kind = 'MATTER' AND EXISTS (
            SELECT 1 FROM engineering_matter_work_revision w
            WHERE w.tenant_id = engineering_search_projection.tenant_id
              AND w.matter_id = engineering_search_projection.parent_context_ref
              AND w.matter_work_revision_id = engineering_search_projection.exact_revision_ref
              AND (${includeHistory} OR NOT EXISTS (SELECT 1 FROM engineering_matter_work_revision newer
                WHERE newer.tenant_id = w.tenant_id AND newer.matter_id = w.matter_id
                  AND newer.working_revision > w.working_revision))
          )))
          AND (search_vector @@ plainto_tsquery('simple', ${prepared.tokenizedText})
            OR identifiers && ${exactIdentifiers})
          ${cursor ? sql`AND entry_id > ${cursor}` : sql``}
        ORDER BY entry_id LIMIT 101`);
      exhausted = rows.length < 101;
      for (const row of rows) {
        const match = row.entryId.match(/^(.*):issue:(.*)$/);
        const subjectKind = projectionOwnerToSubjectKind(row.ownerKind);
        if (!match || !subjectKind) continue;
        if (!row.parentContextRef) throw new Error('ENGINEERING_SEARCH_PROJECTION_SUBJECT_MISSING');
        const subjectId = row.parentContextRef;
        const key = JSON.stringify([subjectKind, subjectId, row.exactRevisionRef]);
        let work = workReads.get(key);
        if (!work) { work = this.loadWork({ subjectKind, subjectId, workRef: row.exactRevisionRef, issueKey: match[2] }, actor); workReads.set(key, work); }
        try {
          hits.push((this.issueFromWork({ subjectKind, subjectId, workRef: row.exactRevisionRef, issueKey: match[2], matchReason: row.matchReason }, await work)).identity);
        } catch (error) { if (!isAccessUnavailable(error)) throw error; }
        if (hits.length >= 51) break;
      }
      if (rows.length > 0) cursor = rows[rows.length - 1]!.entryId;
      else exhausted = true;
    }
    return {
      hits: hits.slice(0, 50),
      // Pagination is based on authorized, fully expanded work identities;
      // denied projection rows must not create a false "more" signal.
      hasMore: hits.length > 50,
      limitations: [includeHistory ? '包含历史已保存版本；历史内容不代表当前工作，正文仍按当前授权逐项读取。' : '仅搜索当前已保存工作；投影命中后正文仍按当前授权逐项读取。'],
    };
  }

  async read(
    identity: Pick<
      EngineeringIssueSearchHit,
      'subjectKind' | 'subjectId' | 'workRef' | 'issueKey'
    >,
    actor: CanonicalHostActor,
  ): Promise<EngineeringIssueRead> {
    this.requireActor(actor);
    if (
      !['WORK_ITEM', 'ENGINEERING_MATTER'].includes(identity.subjectKind) ||
      [identity.subjectId, identity.workRef, identity.issueKey].some(
        (value) => typeof value !== 'string' || !value || value.length > 255,
      )
    )
      throw new BadRequestException('ENGINEERING_ISSUE_IDENTITY_INVALID');
    return this.issueFromWork(identity, await this.loadWork(identity, actor));
  }

  private loadWork(
    identity: IssueIdentity,
    actor: CanonicalHostActor,
  ): Promise<SavedIssueWork> {
    return identity.subjectKind === 'WORK_ITEM'
      ? this.jobAid.readBrowserRevision(
          identity.subjectId,
          identity.workRef,
          actor,
        )
      : this.matters.readWorkingRevision(
          identity.subjectId,
          identity.workRef,
          actor,
        );
  }

  private issueFromWork(
    identity: IssueIdentity,
    revision: SavedIssueWork,
  ): EngineeringIssueRead {
    const content =
      'content' in revision ? revision.content : revision.state.problemWork;
    const reading =
      'content' in revision
        ? jobAidReadingResult(revision)
        : revision.state.substantiveResult;
    const issue = content?.issues.find(
      (item) => item.issueKey === identity.issueKey,
    );
    if (!issue || !reading || !content)
      throw new NotFoundException('ENGINEERING_ISSUE_NOT_FOUND');
    return {
      identity: {
        ...identity,
        workRevision:
          'workRevision' in revision
            ? revision.workRevision
            : revision.workingRevision,
        question: issue.question,
        sourceRefs: [...new Set(collectIssueEvidenceUses(issue).map(use => use.evidenceRef))],
        kind: 'WORK',
        matchedRange: `issue:${issue.issueKey}`,
        reason: identity.matchReason ?? 'FULL_TEXT',
        rootRefs: [...new Set(collectIssueEvidenceUses(issue).map(use => use.evidenceRef))],
      },
      issue,
      reading: { ...reading, evidence: content.evidence },
    };
  }

  private requireActor(actor: CanonicalHostActor): void {
    const identity = actor.objectAccessActor;
    if (
      !identity ||
      !isHostedCanonicalFinalUserActor(identity) ||
      identity.tenantId !== actor.tenantId ||
      identity.canonicalSubject.id !== actor.userId
    )
      throw Object.assign(new Error('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE'), {
        statusCode: 503,
      });
  }
}

function isAccessUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status =
    (error as Error & { statusCode?: number; status?: number }).statusCode ??
    (error as Error & { status?: number }).status;
  return (
    status === 403 ||
    status === 404 ||
    /^(JOBAID_(SOURCE|ATTACHMENT|QUERY_RECEIPT|ACTOR)_AUTHORIZATION_CHANGED|ENGINEERING_MATTER_RUNTIME_AUTHORIZATION_UNAVAILABLE)$/.test(
      error.message,
    )
  );
}

function identifierArray(values: readonly string[]) {
  return sql`ARRAY[${sql.join(values.map(value => sql`${value}`), sql`, `)}]::text[]`;
}
