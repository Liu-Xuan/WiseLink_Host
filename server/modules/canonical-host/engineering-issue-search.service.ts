import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
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
  EngineeringIssueReferenceReceipt,
  EngineeringIssueReferenceStatus,
  EngineeringKnowledgeIdentity,
  EngineeringKnowledgeScope,
  EngineeringKnowledgeEntry,
  EngineeringKnowledgePage,
  EngineeringKnowledgeRead,
} from '@shared/engineering-issue-search.interface';
import { z } from 'zod/v4';
import { MatterActionAttemptService } from './matter-action-attempt.service';
import { CANONICAL_SERVICE_SCOPE_AUTHORIZATION, canonicalServiceScopeUnavailable,
  type CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';
import type { CanonicalHostActor } from './canonical-host.types';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';
import { EngineeringMatterWorkingService } from './engineering-matter-working.service';
import type { EngineeringMatterSavedRowBatch } from './engineering-matter-working.repository';
import { isHostedCanonicalFinalUserActor } from '../work-item/miaoda-hosted-canonical-object-access.adapter';
import { jobAidReadingResult } from './jobaid-problem-work';
import { collectIssueEvidenceUses } from '@shared/jobaid-evidence-uses';
import { assessmentEvidenceRoots } from '@shared/assessment-evidence-roots';
import { prepareEngineeringSearchQuery } from './engineering-search-text';
import { projectionOwnerToSubjectKind } from './engineering-search-projection';
import { EngineeringSearchProjectionWriter } from './engineering-search-projection';
import { EngineeringReadPhaseObservation, observeEngineeringRead } from './engineering-read-phase-observation';

type IssueIdentity = Pick<
  EngineeringIssueSearchHit,
  'subjectKind' | 'subjectId' | 'workRef' | 'issueKey'
> & { matchReason?: 'FULL_TEXT' | 'EXACT_IDENTIFIER' };
type SavedIssueWork =
  | Awaited<ReturnType<CanonicalJobAidProblemService['readBrowserRevision']>>
  | Awaited<ReturnType<EngineeringMatterWorkingService['readWorkingRevision']>>;

@Injectable()
export class EngineeringIssueSearchService {
  private readonly logger = new Logger(EngineeringIssueSearchService.name);
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly jobAid: CanonicalJobAidProblemService,
    private readonly matters: EngineeringMatterWorkingService,
    private readonly projectionWriter?: EngineeringSearchProjectionWriter,
    @Optional() private readonly attempts?: MatterActionAttemptService,
    @Optional() @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceAuthorization?: CanonicalServiceScopeAuthorizationPort,
  ) {}

  /** Browses saved explanations without generating text or requiring a keyword. */
  async catalogue(query: string, scope: EngineeringKnowledgeScope, after: string | undefined,
    actor: CanonicalHostActor): Promise<EngineeringKnowledgePage> {
    const observation = new EngineeringReadPhaseObservation({
      timeline: process.env.WISELINK_CATALOGUE_TIMELINE === '1',
    });
    const entries: EngineeringKnowledgeEntry[] = [];
    let batches = 0;
    let windowIndex = 0;
    let completed = false;
    observation.mark('catalogue_start');
    try {
      this.requireActor(actor);
      if (typeof query !== 'string' || query.length > 200 || !['CURRENT', 'ALL', 'HISTORICAL'].includes(scope))
        throw new BadRequestException('ENGINEERING_KNOWLEDGE_QUERY_INVALID');
      const search = query.trim();
      let cursor: EngineeringKnowledgeIdentity | undefined;
      if (after) {
        try {
          if (after.length > 2400) throw new Error();
          const decoded = JSON.parse(Buffer.from(after, 'base64url').toString('utf8'));
          if (decoded.search !== search || decoded.scope !== scope) throw new Error();
          cursor = knowledgeIdentitySchema.parse(decoded.identity);
        } catch { throw new BadRequestException('ENGINEERING_KNOWLEDGE_CURSOR_INVALID'); }
      }
      // Only authorized entries count toward the page and continuation. Each batch
      // loads identities only; the existing exact reader checks retained sources.
      // Reads run in order-preserving groups of four. One in-flight or succeeded
      // read is shared per exact identity within this call only; a denied read is
      // dropped so it never becomes an authorization cache.
      const workReads = new Map<string, { work: Promise<SavedIssueWork>; readInstance: number }>();
      const readWork = (row: EngineeringKnowledgeIdentity, window: EngineeringReadPhaseObservation,
        rootSlot: number, batch?: EngineeringMatterSavedRowBatch): Promise<SavedIssueWork> => {
        const key = JSON.stringify([row.subjectKind, row.subjectId, row.workRef]);
        const existing = workReads.get(key);
        if (existing) {
          window.scope({ rootSlot, readInstance: existing.readInstance }).mark('root_reuse', 'reuse');
          return existing.work;
        }
        const readInstance = observation.nextReadInstance();
        const root = window.scope({ rootSlot, readInstance, attempt: 0, depth: 0 });
        const work = root.measure(row.subjectKind === 'WORK_ITEM'
          ? 'work_item_exact_read' : 'matter_exact_read',
        () => this.loadWork({ ...row, issueKey: '' }, actor, root, batch));
        workReads.set(key, { work, readInstance });
        void work.catch(() => workReads.delete(key));
        return work;
      };
      while (entries.length < 21) {
        if (batches++ === 5) throw new ServiceUnavailableException('ENGINEERING_KNOWLEDGE_SCAN_LIMIT');
        const rows = await observation.measure('candidate_query', () =>
          this.db.execute<EngineeringKnowledgeIdentity & { current: boolean }>(sql`
        WITH works AS (
          SELECT 'WORK_ITEM'::text AS kind, w.work_item_id AS subject_id,
            w.assessment_work_revision_id AS work_ref, w.content_json::jsonb AS content,
            NOT EXISTS (SELECT 1 FROM assessment_work_revision newer WHERE newer.tenant_id=w.tenant_id
              AND newer.work_item_id=w.work_item_id AND newer.work_revision>w.work_revision) AS current
          FROM assessment_work_revision w
          WHERE w.tenant_id=${actor.tenantId} AND w.created_by_user_id=${actor.userId}
          UNION ALL
          SELECT 'ENGINEERING_MATTER', w.matter_id, w.matter_work_revision_id,
            w.state_json::jsonb->'problemWork',
            NOT EXISTS (SELECT 1 FROM engineering_matter_work_revision newer WHERE newer.tenant_id=w.tenant_id
              AND newer.matter_id=w.matter_id AND newer.working_revision>w.working_revision)
          FROM engineering_matter_work_revision w
          WHERE w.tenant_id=${actor.tenantId} AND w.created_by_user_id=${actor.userId}
        )
        SELECT kind AS "subjectKind", subject_id AS "subjectId", work_ref AS "workRef", current
        FROM works
        WHERE content IS NOT NULL AND content <> 'null'::jsonb
          AND (${scope}='ALL' OR (${scope}='CURRENT' AND current) OR (${scope}='HISTORICAL' AND NOT current))
          AND (${search}='' OR position(lower(${search}) in lower(content::text))>0)
          ${cursor ? sql`AND (kind,subject_id,work_ref)>(${cursor.subjectKind},${cursor.subjectId},${cursor.workRef})` : sql``}
        ORDER BY kind,subject_id,work_ref LIMIT 40`));
        for (let start = 0; start < rows.length && entries.length < 21;) {
          // The final group only needs enough authorized entries to determine
          // whether another page exists. Denied rows still advance the scan.
          const group = rows.slice(start, start + Math.min(CATALOGUE_READ_GROUP_SIZE, 21 - entries.length));
          start += group.length;
          const newMatterKeys = new Set(group.filter(row => row.subjectKind === 'ENGINEERING_MATTER')
            .map(row => JSON.stringify([row.subjectKind, row.subjectId, row.workRef]))
            .filter(key => !workReads.has(key)));
          const window = observation.scope({ windowIndex: windowIndex++ });
          const batch = newMatterKeys.size >= 2
            ? this.matters.createSavedReadBatch(newMatterKeys.size, window) : undefined;
          const settled = await window.measure('read_group_wait', () =>
            Promise.allSettled(group.map((row, rootSlot) => readWork(row, window, rootSlot, batch))));
          for (let index = 0; index < group.length && entries.length < 21; index += 1) {
            const row = group[index];
            const outcome = settled[index];
            try {
              if (outcome.status === 'rejected') throw outcome.reason;
              entries.push(this.knowledgeEntryFromWork(row, outcome.value, row.current));
            } catch (error) { if (!isAccessUnavailable(error)) throw error; }
          }
        }
        if (rows.length < 40 || entries.length === 21) break;
        cursor = rows[rows.length - 1];
      }
      const page = entries.slice(0, 20);
      const last = page[page.length - 1];
      const result = { entries: page, nextCursor: entries.length > 20 && last ? Buffer.from(JSON.stringify({
        search, scope, identity: { subjectKind: last.subjectKind, subjectId: last.subjectId, workRef: last.workRef },
      })).toString('base64url') : null };
      completed = true;
      return result;
    } finally {
      observation.mark('catalogue_end', completed ? 'ok' : 'error');
      // Telemetry is best-effort: it must not replace a read result or its error.
      try {
        this.logger.log({ event: 'ENGINEERING_KNOWLEDGE_CATALOGUE_PHASES',
          scope: ['CURRENT', 'ALL', 'HISTORICAL'].includes(scope) ? scope : undefined,
          status: completed ? 'ok' : 'error',
          candidateBatches: observation.snapshot().candidate_query?.count ?? 0,
          visibleEntries: entries.length, durationMs: observation.elapsedMs(),
          windows: observation.windowSnapshot(), phases: observation.snapshot(),
          timeline: observation.timelineSnapshot() });
      } catch {
        try { this.logger.warn('ENGINEERING_KNOWLEDGE_CATALOGUE_OBSERVATION_UNAVAILABLE'); }
        catch { /* A broken telemetry sink cannot alter business error precedence. */ }
      }
    }
  }

  async readKnowledge(identity: EngineeringKnowledgeIdentity, actor: CanonicalHostActor): Promise<EngineeringKnowledgeRead> {
    this.requireActor(actor);
    const parsed = knowledgeIdentitySchema.safeParse(identity);
    if (!parsed.success) throw new BadRequestException('ENGINEERING_KNOWLEDGE_IDENTITY_INVALID');
    const exact = parsed.data;
    const observation = exact.subjectKind === 'ENGINEERING_MATTER'
      ? new EngineeringReadPhaseObservation() : undefined;
    let completed = false;
    try {
      return await observeEngineeringRead(observation, 'knowledge_total', async () => {
        const revision = await observeEngineeringRead(observation, 'knowledge_load_work', () =>
          this.loadWork({ ...exact, issueKey: '' }, actor, observation));
        const rows = await observeEngineeringRead(observation, 'knowledge_current_flag', () =>
          exact.subjectKind === 'WORK_ITEM'
            ? this.db.execute<{ current: boolean }>(sql`SELECT NOT EXISTS (
          SELECT 1 FROM assessment_work_revision newer WHERE newer.tenant_id=w.tenant_id
          AND newer.work_item_id=w.work_item_id AND newer.work_revision>w.work_revision) AS current
          FROM assessment_work_revision w WHERE w.tenant_id=${actor.tenantId}
          AND w.work_item_id=${exact.subjectId} AND w.assessment_work_revision_id=${exact.workRef}`)
            : this.db.execute<{ current: boolean }>(sql`SELECT NOT EXISTS (
          SELECT 1 FROM engineering_matter_work_revision newer WHERE newer.tenant_id=w.tenant_id
          AND newer.matter_id=w.matter_id AND newer.working_revision>w.working_revision) AS current
          FROM engineering_matter_work_revision w WHERE w.tenant_id=${actor.tenantId}
          AND w.matter_id=${exact.subjectId} AND w.matter_work_revision_id=${exact.workRef}`));
        if (!rows.length) throw new NotFoundException('ENGINEERING_KNOWLEDGE_WORK_NOT_FOUND');
        const result = this.knowledgeFromWork(exact, revision, rows[0].current);
        completed = true;
        return result;
      });
    } finally {
      if (observation) this.logger.log({ event: 'ENGINEERING_KNOWLEDGE_READ_PHASES',
        status: completed ? 'ok' : 'error', phases: observation.snapshot() });
    }
  }

  private knowledgeEntryFromWork(identity: EngineeringKnowledgeIdentity, revision: SavedIssueWork,
    current: boolean): EngineeringKnowledgeEntry {
    const content = 'content' in revision ? revision.content : revision.state.problemWork;
    if (!content) throw new NotFoundException('ENGINEERING_KNOWLEDGE_WORK_NOT_FOUND');
    // The former detail projection rejected malformed saved issue arrays. Keep
    // that validity boundary while avoiding article construction and evidence cloning.
    if ('content' in revision) {
      if (!Array.isArray(content.issues) || content.issues.some(issue => issue === null))
        throw new TypeError('JOBAID_SAVED_ISSUES_INVALID');
    }
    return { subjectKind: identity.subjectKind, subjectId: identity.subjectId, workRef: identity.workRef,
      workRevision: 'workRevision' in revision ? revision.workRevision : revision.workingRevision,
      current, headline: content.headline, listBrief: content.listBrief,
      createdAt: revision.createdAt, overviewStatus: content.overviewStatus };
  }

  private knowledgeFromWork(identity: EngineeringKnowledgeIdentity, revision: SavedIssueWork,
    current: boolean): EngineeringKnowledgeRead {
    const content = 'content' in revision ? revision.content : revision.state.problemWork;
    const reading = 'content' in revision ? jobAidReadingResult(revision)
      : content?.overviewStatus === 'NOT_AVAILABLE' ? null : revision.state.substantiveResult;
    if (!content) throw new NotFoundException('ENGINEERING_KNOWLEDGE_WORK_NOT_FOUND');
    return {
      entry: this.knowledgeEntryFromWork(identity, revision, current),
      content, reading,
      ...('state' in revision ? { correctionNotices: revision.correctionNotices,
        overviewCorrectionNotices: revision.overviewCorrectionNotices,
        referenceWorkNotices: revision.referenceWorkNotices, overviewSourceWork: revision.overviewSourceWork } : {}),
    };
  }

  async reference(input: unknown, actor: CanonicalHostActor): Promise<EngineeringIssueReferenceReceipt> {
    this.requireActor(actor);
    const id = z.string().trim().min(1).max(255);
    const parsed = z.object({ targetMatterId: id, expectedMatterRevisionId: id,
      expectedMatterRevision: z.number().int().positive(), expectedWorkingRevision: z.number().int().nonnegative(),
      requestId: z.string().trim().min(1).max(96), purpose: z.string().trim().min(1).max(3000),
      source: z.object({ subjectKind: z.literal('ENGINEERING_MATTER'), subjectId: id, workRef: id, issueKey: id }).strict(),
    }).strict().safeParse(input);
    if (!parsed.success) throw new BadRequestException('MATTER_REFERENCE_REQUEST_INVALID');
    const request = parsed.data;
    if (request.targetMatterId === request.source.subjectId) throw new BadRequestException('MATTER_REFERENCE_REQUEST_INVALID');
    if (!this.attempts || !this.serviceAuthorization?.authorizeOpenClawMatterRequest) throw canonicalServiceScopeUnavailable();
    await this.matters.readWorking(request.targetMatterId, actor);
    await this.read(request.source, actor);
    const scope = await this.referenceScope(request.targetMatterId, actor);
    const result = await this.attempts.reserveJobAidForBrowser({ ...scope,
      expectedMatterRevisionId: request.expectedMatterRevisionId,
      expectedMatterRevision: request.expectedMatterRevision, expectedWorkingRevision: request.expectedWorkingRevision,
      idempotencyKey: `matter:${request.targetMatterId}:${request.requestId}`,
      trigger: { kind: 'USER_REQUEST', requestId: request.requestId,
        instruction: `将本次指定的旧工作作为候选参考，核对完整问题、适用条件和根来源，与本事项有效工程文件及实际对象比较后保存本事项认识。不能继承另一事项的构型、概率、评分或实施批准状态。用途：${request.purpose}` },
      referenceWorks: [{ matterId: request.source.subjectId, workRef: request.source.workRef,
        issueKey: request.source.issueKey, purpose: request.purpose }],
    }, actor);
    return { targetMatterId: request.targetMatterId, source: request.source,
      attemptRef: result.task.operationRef, status: result.row.status, created: result.created };
  }

  async referenceStatus(matterId: string, attemptRef: string, actor: CanonicalHostActor): Promise<EngineeringIssueReferenceStatus> {
    this.requireActor(actor);
    if (typeof matterId !== 'string' || !matterId.trim() || matterId.length > 255 ||
        typeof attemptRef !== 'string' || !attemptRef.trim() || attemptRef.length > 255)
      throw new BadRequestException('MATTER_REFERENCE_REQUEST_INVALID');
    if (!this.attempts) throw canonicalServiceScopeUnavailable();
    await this.matters.readWorking(matterId, actor);
    const scope = await this.referenceScope(matterId, actor);
    const row = await this.attempts.readForBrowser({ ...scope, attemptRef }, actor);
    const task = JSON.parse(row.taskEnvelopeJson ?? '{}');
    if (!Array.isArray(task.modelInput?.referenceWorks) || !task.modelInput.referenceWorks.length)
      throw new NotFoundException('MATTER_REFERENCE_REQUEST_NOT_FOUND');
    return { targetMatterId: matterId, attemptRef, status: row.status, errorCode: row.terminalReason ?? null };
  }

  private async referenceScope(matterId: string, actor: CanonicalHostActor) {
    if (!this.serviceAuthorization?.authorizeOpenClawMatterRequest) throw canonicalServiceScopeUnavailable();
    const target = await this.serviceAuthorization.authorizeOpenClawMatterRequest({ matterId });
    if (target.appId !== actor.appId || target.tenantId !== actor.tenantId || target.actorUserId !== actor.userId ||
        target.matterId !== matterId || !target.principalId) throw canonicalServiceScopeUnavailable();
    const authorizeReferenceMatter = async (matterId: string) => {
      const source = await this.serviceAuthorization!.authorizeOpenClawMatterRequest!({ matterId });
      if (source.appId !== target.appId || source.tenantId !== target.tenantId || source.actorUserId !== target.actorUserId ||
          source.principalId !== target.principalId || source.matterId !== matterId) throw canonicalServiceScopeUnavailable();
    };
    return { tenantId: actor.tenantId, actorUserId: actor.userId, matterId, authorizeReferenceMatter };
  }

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
    observation?: EngineeringReadPhaseObservation,
    batch?: EngineeringMatterSavedRowBatch,
  ): Promise<SavedIssueWork> {
    return identity.subjectKind === 'WORK_ITEM'
      ? this.jobAid.readBrowserRevision(
          identity.subjectId,
          identity.workRef,
          actor,
        )
      : batch ? this.matters.readWorkingRevision(
          identity.subjectId,
          identity.workRef,
          actor,
          observation,
          batch,
        ) : observation ? this.matters.readWorkingRevision(
          identity.subjectId,
          identity.workRef,
          actor,
          observation,
        ) : this.matters.readWorkingRevision(
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
        : content?.overviewStatus === 'NOT_AVAILABLE'
          ? null
          : revision.state.substantiveResult;
    const issue = content?.issues.find(
      (item) => item.issueKey === identity.issueKey,
    );
    if (!issue || !content)
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
        overviewStatus: content.overviewStatus,
        ...('state' in revision ? { overviewSourceWork: revision.overviewSourceWork ?? null } : {}),
        matchedRange: `issue:${issue.issueKey}`,
        reason: identity.matchReason ?? 'FULL_TEXT',
        rootRefs: assessmentEvidenceRoots(collectIssueEvidenceUses(issue).map(use => use.evidenceRef), content.evidence).rootRefs,
        ...('correctionNotices' in revision && revision.correctionNotices?.some(item => item.issueKey === issue.issueKey)
          ? { correctionNotices: revision.correctionNotices.filter(item => item.issueKey === issue.issueKey) } : {}),
        ...('overviewCorrectionNotices' in revision && revision.overviewCorrectionNotices?.length
          ? { overviewCorrectionNotices: revision.overviewCorrectionNotices } : {}),
        ...('referenceWorkNotices' in revision && revision.referenceWorkNotices?.some(item => item.affectedIssueKeys.includes(issue.issueKey))
          ? { referenceWorkNotices: revision.referenceWorkNotices.filter(item => item.affectedIssueKeys.includes(issue.issueKey)) } : {}),
      },
      issue,
      reading,
      evidence: content.evidence,
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

const CATALOGUE_READ_GROUP_SIZE = 4;

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

const knowledgeIdentitySchema = z.object({
  subjectKind: z.enum(['WORK_ITEM', 'ENGINEERING_MATTER']),
  subjectId: z.string().min(1).max(255),
  workRef: z.string().min(1).max(255),
}).strict();
