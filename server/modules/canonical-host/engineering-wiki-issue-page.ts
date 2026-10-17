import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod/v4';
import type { WikiGuideIssueHit, WikiGuideIssuePage, WikiGuidePathSegment } from '@shared/wiki-guide.interface';
import type { SummaryActor } from './derived-summary-members.service';
import { decodeWikiGuideCursor, wikiGuideTreeCte } from './hierarchical-wiki-navigation';
import { prepareEngineeringSearchQuery } from './engineering-search-text';

const id = z.string().min(1).max(255).refine(value =>
  value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
const issueQuery = z.strictObject({
  rootSummaryId: id, chapterSummaryId: id.optional(), search: z.string().trim().max(200).default(''),
  scope: z.enum(['CURRENT', 'HISTORY']).default('CURRENT'), after: z.string().min(1).max(4000).optional(),
  limit: z.preprocess(value => typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value,
    z.number().int().min(1).max(20).default(20)),
});
type IssueQuery = z.infer<typeof issueQuery>;
const identity = z.strictObject({
  subjectKind: z.enum(['WORK_ITEM', 'ENGINEERING_MATTER']), subjectId: id, workRef: id, issueKey: id,
});
type IssueIdentity = z.infer<typeof identity>;
const cursorSchema = z.strictObject({ query: issueQuery.omit({ after: true }), identity });

export interface WikiGuideIssueCandidate extends IssueIdentity {
  workRevision: number;
  documentVersionId: string | null;
  paths: WikiGuidePathSegment[][];
}

/** Returned only after the existing full exact-work/source authorization succeeds. */
export interface WikiGuideAuthorizedWork {
  subjectKind: IssueIdentity['subjectKind'];
  subjectId: string;
  workRef: string;
  workRevision: number;
  documentVersionId: string | null;
  issues: Array<{ issueKey: string; question: string }>;
}

export interface WikiGuideIssueReadStats {
  candidateRows: number;
  examinedCandidates: number;
  uniqueWorkReads: number;
  deniedWorkReads: number;
  readGroups: number;
  authorizedIssues: number;
}

export function wikiGuideIssueReadStats(): WikiGuideIssueReadStats {
  return { candidateRows: 0, examinedCandidates: 0, uniqueWorkReads: 0,
    deniedWorkReads: 0, readGroups: 0, authorizedIssues: 0 };
}

function parseQuery(value: unknown): IssueQuery {
  const parsed = issueQuery.safeParse(value);
  if (!parsed.success) throw new BadRequestException('WIKI_GUIDE_ISSUE_QUERY_INVALID');
  return parsed.data;
}

function binding(query: IssueQuery) {
  const { after: _after, ...result } = query;
  return result;
}

function afterIdentity(query: IssueQuery): IssueIdentity | undefined {
  if (!query.after) return undefined;
  try {
    const cursor = cursorSchema.parse(decodeWikiGuideCursor(query.after));
    if (JSON.stringify(cursor.query) !== JSON.stringify(binding(query))) throw new Error();
    return cursor.identity;
  } catch { throw new BadRequestException('WIKI_GUIDE_ISSUE_CURSOR_INVALID'); }
}

function scopedMembers(query: IssueQuery, owner: SummaryActor): SQL {
  return sql`guide_members AS (
    SELECT m.member_json AS member, tree.path
    FROM hierarchical_wiki_membership m JOIN guide_tree tree ON tree.wiki_id=m.wiki_id
      AND tree.actor_user_id=m.actor_user_id
    WHERE m.tenant_id=${owner.tenantId} AND tree.root_summary_id=${query.rootSummaryId}
      ${query.chapterSummaryId ? sql`AND tree.path @> jsonb_build_array(
        jsonb_build_object('summaryId',${query.chapterSummaryId}::text))` : sql``}
      AND m.basis_json->>'classificationStatus'='CONFIRMED'
      AND ((m.source_kind='WORK_ITEM' AND m.member_json->>'kind'='WORK_ITEM_WORK'
        AND m.source_id=m.member_json->>'workItemId') OR
        (m.source_kind='MATTER' AND m.member_json->>'kind'='MATTER_WORK'
          AND m.source_id=m.member_json->>'matterId'))
  ), guide_work_members AS (SELECT DISTINCT member FROM guide_members)`;
}

function searchCondition(query: IssueQuery): SQL {
  if (!query.search) return sql`true`;
  const prepared = prepareEngineeringSearchQuery(query.search);
  const identifiers = sql`ARRAY[${sql.join(prepared.exactIdentifierCandidates.map(value => sql`${value}`), sql`, `)}]::text[]`;
  if (process.env.WL_ENGINEERING_SEARCH_PROJECTION === '1') return sql`EXISTS (
    SELECT 1 FROM engineering_search_projection indexed
    WHERE indexed.tenant_id=work.tenant_id AND indexed.entry_kind='WORK'
      AND indexed.owner_kind=CASE work.subject_kind WHEN 'WORK_ITEM' THEN 'USER' ELSE 'MATTER' END
      AND indexed.parent_context_ref=work.subject_id AND indexed.exact_revision_ref=work.work_ref
      AND indexed.entry_id=work.work_ref||':issue:'||(issue->>'issueKey')
      AND (indexed.search_vector @@ plainto_tsquery('simple',${prepared.tokenizedText})
        OR indexed.identifiers && ${identifiers}))`;
  return sql`(to_tsvector('simple',issue::text) @@ plainto_tsquery('simple',${prepared.tokenizedText})
    OR position(lower(${query.search}) in lower(issue::text))>0
    OR upper(issue->>'issueKey')=ANY(${identifiers}))`;
}

/** No id-only or current-document fallback: path membership is the exact saved work. */
const memberMatchesCandidate = sql`membership.member->>'workRef'=candidate.work_ref
  AND membership.member->>'workRevision'=candidate.work_revision::text
  AND ((candidate.subject_kind='WORK_ITEM' AND membership.member->>'kind'='WORK_ITEM_WORK'
    AND membership.member->>'workItemId'=candidate.subject_id
    AND membership.member->>'documentVersionId'=candidate.document_version_id)
    OR (candidate.subject_kind='ENGINEERING_MATTER' AND membership.member->>'kind'='MATTER_WORK'
      AND membership.member->>'matterId'=candidate.subject_id AND candidate.document_version_id IS NULL))
  AND (membership.member->'issueKeys'='[]'::jsonb OR jsonb_exists(membership.member->'issueKeys',candidate.issue_key))`;

async function readCandidates(database: PostgresJsDatabase, owner: SummaryActor,
  query: IssueQuery, after: IssueIdentity | undefined): Promise<WikiGuideIssueCandidate[]> {
  const [snapshot] = await database.execute<{
    scopeValid: boolean; items: WikiGuideIssueCandidate[];
  }>(sql`WITH RECURSIVE ${wikiGuideTreeCte(owner, query.rootSummaryId)},
    guide_context AS (SELECT root.summary_id FROM guide_tree root
      WHERE root.summary_id=${query.rootSummaryId} AND root.parent_wiki_id IS NULL AND root.scope->>'kind'='FLEET'
      ${query.chapterSummaryId ? sql`AND EXISTS(SELECT 1 FROM guide_tree chapter
        WHERE chapter.summary_id=${query.chapterSummaryId} AND chapter.root_summary_id=root.summary_id
          AND chapter.scope->>'kind' IN ('ATA2','ATA4'))` : sql``}),
    ${scopedMembers(query, owner)}, guide_work_data AS (
      SELECT 'WORK_ITEM'::text AS subject_kind, saved.tenant_id, saved.work_item_id AS subject_id,
        saved.assessment_work_revision_id AS work_ref,saved.work_revision,
        saved.document_version_id,saved.content_json::jsonb AS content,selected.member
      FROM guide_work_members selected JOIN assessment_work_revision saved ON saved.tenant_id=${owner.tenantId}
        AND selected.member->>'kind'='WORK_ITEM_WORK' AND saved.work_item_id=selected.member->>'workItemId'
        AND saved.assessment_work_revision_id=selected.member->>'workRef'
        AND saved.work_revision::text=selected.member->>'workRevision'
        AND saved.document_version_id=selected.member->>'documentVersionId'
      WHERE (${query.scope}='HISTORY' OR NOT EXISTS(SELECT 1 FROM assessment_work_revision newer
        WHERE newer.tenant_id=saved.tenant_id AND newer.work_item_id=saved.work_item_id
          AND newer.work_revision>saved.work_revision))
      UNION ALL
      SELECT 'ENGINEERING_MATTER',saved.tenant_id,saved.matter_id,saved.matter_work_revision_id,
        saved.working_revision,NULL::text,saved.state_json::jsonb->'problemWork',selected.member
      FROM guide_work_members selected JOIN engineering_matter_work_revision saved ON saved.tenant_id=${owner.tenantId}
        AND selected.member->>'kind'='MATTER_WORK' AND saved.matter_id=selected.member->>'matterId'
        AND saved.matter_work_revision_id=selected.member->>'workRef'
        AND saved.working_revision::text=selected.member->>'workRevision'
      WHERE (${query.scope}='HISTORY' OR NOT EXISTS(SELECT 1 FROM engineering_matter_work_revision newer
        WHERE newer.tenant_id=saved.tenant_id AND newer.matter_id=saved.matter_id
          AND newer.working_revision>saved.working_revision))
    ), guide_candidates AS (
      SELECT DISTINCT work.subject_kind,work.subject_id,work.work_ref,work.work_revision,
        work.document_version_id,issue->>'issueKey' AS issue_key
      FROM guide_work_data work CROSS JOIN LATERAL jsonb_array_elements(work.content->'issues') issue
      WHERE EXISTS(SELECT 1 FROM guide_context) AND NULLIF(issue->>'issueKey','') IS NOT NULL
        AND (work.member->'issueKeys'='[]'::jsonb OR jsonb_exists(work.member->'issueKeys',issue->>'issueKey'))
        AND ${searchCondition(query)}
        ${after ? sql`AND (work.subject_kind,work.subject_id,work.work_ref,issue->>'issueKey')>
          (${after.subjectKind},${after.subjectId},${after.workRef},${after.issueKey})` : sql``}
      ORDER BY work.subject_kind,work.subject_id,work.work_ref,issue_key LIMIT 200
    ), guide_hits AS (
      SELECT candidate.subject_kind AS "subjectKind",candidate.subject_id AS "subjectId",
        candidate.work_ref AS "workRef",candidate.work_revision AS "workRevision",
        candidate.document_version_id AS "documentVersionId",candidate.issue_key AS "issueKey",
        jsonb_agg(DISTINCT membership.path) AS paths
      FROM guide_candidates candidate JOIN guide_members membership ON ${memberMatchesCandidate}
      GROUP BY candidate.subject_kind,candidate.subject_id,candidate.work_ref,candidate.work_revision,
        candidate.document_version_id,candidate.issue_key
    ) SELECT EXISTS(SELECT 1 FROM guide_context) AS "scopeValid",
      COALESCE((SELECT jsonb_agg(hit ORDER BY hit."subjectKind",hit."subjectId",hit."workRef",hit."issueKey")
        FROM guide_hits hit),'[]'::jsonb) AS items`);
  if (!snapshot?.scopeValid) throw new NotFoundException('WIKI_GUIDE_ISSUE_SCOPE_UNAVAILABLE');
  return snapshot.items;
}

function workKey(candidate: IssueIdentity): string {
  return JSON.stringify([candidate.subjectKind, candidate.subjectId, candidate.workRef]);
}

function scanLimit(): never {
  throw new ServiceUnavailableException('WIKI_GUIDE_ISSUE_SCAN_LIMIT');
}

function authorizedHit(candidate: WikiGuideIssueCandidate, work: WikiGuideAuthorizedWork): WikiGuideIssueHit {
  if (work.subjectKind !== candidate.subjectKind || work.subjectId !== candidate.subjectId ||
    work.workRef !== candidate.workRef || work.workRevision !== candidate.workRevision ||
    work.documentVersionId !== candidate.documentVersionId)
    throw new NotFoundException('WIKI_GUIDE_EXACT_WORK_UNAVAILABLE');
  const issue = work.issues.find(item => item.issueKey === candidate.issueKey);
  if (!issue) throw new NotFoundException('ENGINEERING_ISSUE_NOT_FOUND');
  return { subjectKind: candidate.subjectKind, subjectId: candidate.subjectId,
    workRef: candidate.workRef, workRevision: work.workRevision, issueKey: issue.issueKey,
    question: issue.question, documentVersionId: work.documentVersionId, paths: candidate.paths };
}

export async function readWikiGuideIssuePage(input: {
  query: unknown;
  withMetadataScope: (operation: (database: PostgresJsDatabase, owner: SummaryActor) =>
    Promise<WikiGuideIssueCandidate[]>) => Promise<WikiGuideIssueCandidate[]>;
  loadWork: (candidate: WikiGuideIssueCandidate) => Promise<WikiGuideAuthorizedWork>;
  isAccessUnavailable: (error: unknown) => boolean;
  stats: WikiGuideIssueReadStats;
}): Promise<WikiGuideIssuePage> {
  const query = parseQuery(input.query);
  const after = afterIdentity(query);
  // Release the metadata transaction before exact readers open their own current
  // browser/source transactions. Do not pin a pool connection across their I/O.
  const candidates = await input.withMetadataScope((database, owner) => readCandidates(database, owner, query, after));
  input.stats.candidateRows = candidates.length;
  if (candidates.length > 200) scanLimit();
  const reads = new Map<string, Promise<WikiGuideAuthorizedWork>>();
  const hits: WikiGuideIssueHit[] = [];
  let start = 0;
  while (start < candidates.length && hits.length < query.limit + 1) {
    const group: WikiGuideIssueCandidate[] = [];
    const planned = new Set<string>();
    for (let next = start; next < candidates.length && group.length < Math.min(4, query.limit + 1 - hits.length); next++) {
      const candidate = candidates[next];
      const key = workKey(candidate);
      if (!reads.has(key) && !planned.has(key) && reads.size + planned.size === 40) break;
      if (!reads.has(key)) planned.add(key);
      group.push(candidate);
    }
    if (!group.length) scanLimit();
    input.stats.readGroups++;
    const outcomes = await Promise.allSettled(group.map(candidate => {
      const key = workKey(candidate);
      let work = reads.get(key);
      if (!work) {
        input.stats.uniqueWorkReads++;
        work = Promise.resolve().then(() => input.loadWork(candidate));
        reads.set(key, work);
        void work.catch(error => { if (input.isAccessUnavailable(error)) input.stats.deniedWorkReads++; });
      }
      return work;
    }));
    for (let index = 0; index < group.length && hits.length < query.limit + 1; index++) {
      input.stats.examinedCandidates++;
      const outcome = outcomes[index];
      try {
        if (outcome.status === 'rejected') throw outcome.reason;
        hits.push(authorizedHit(group[index], outcome.value));
        input.stats.authorizedIssues++;
      } catch (error) { if (!input.isAccessUnavailable(error)) throw error; }
    }
    start += group.length;
  }
  if (hits.length < query.limit + 1 && candidates.length === 200) scanLimit();
  const items = hits.slice(0, query.limit);
  const last = items.at(-1);
  const nextIdentity: IssueIdentity | undefined = last ? {
    subjectKind: last.subjectKind, subjectId: last.subjectId, workRef: last.workRef, issueKey: last.issueKey,
  } : undefined;
  return { items, coverage: 'CONFIRMED_WIKI_MEMBERS', nextCursor: hits.length > query.limit && nextIdentity
    ? Buffer.from(JSON.stringify({ query: binding(query), identity: nextIdentity })).toString('base64url') : null };
}
