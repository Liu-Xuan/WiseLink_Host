import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod/v4';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  WikiGuideNavigationPage, WikiGuideNode,
} from '@shared/wiki-guide.interface';
import type { SummaryActor } from './derived-summary-members.service';

interface AtaTitleRow { code: string; titleZH: string; titleEN: string }
interface AtaTitleCatalog { schemes: { ispec: { chapters: AtaTitleRow[]; expanded: AtaTitleRow[] } } }

function readPackagedAtaTitles(): AtaTitleCatalog {
  const filename = 'library-ata-titles.generated.json';
  const candidates = [
    resolve(__dirname, '../../runtime-assets/wiki-guide', filename),
    resolve(process.cwd(), 'client/src/pages/WorkspaceHomePage', filename),
  ];
  for (const path of candidates) {
    try { return JSON.parse(readFileSync(path, 'utf8')) as AtaTitleCatalog; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  throw new Error('WIKI_GUIDE_RUNTIME_ASSET_NOT_PACKAGED:' + filename);
}

// One initialization read; the build copies the same UI projection into server runtime assets.
const ataTitles = readPackagedAtaTitles();

/** Match iSpec bilingual names, then filter real registered nodes by legal exact codes. */
export function wikiGuideChapterTitleCodes(search: string): { ata2: string[]; ata4: string[] } {
  const term = search.trim().toLowerCase();
  if (!term) return { ata2: [], ata4: [] };
  const matching = (rows: AtaTitleRow[], format: RegExp): string[] => [...new Set(rows
    .filter(row => format.test(row.code) && [row.titleZH, row.titleEN].some(title => title.toLowerCase().includes(term)))
    .map(row => row.code))];
  return { ata2: matching(ataTitles.schemes.ispec.chapters, /^\d{2}$/u),
    ata4: matching(ataTitles.schemes.ispec.expanded, /^\d{2}-\d{2}$/u) };
}

function chapterTitleCondition(search: string): SQL {
  const codes = wikiGuideChapterTitleCodes(search);
  const array = (values: string[]): SQL => sql`ARRAY[${sql.join(values.map(value => sql`${value}`), sql`, `)}]::text[]`;
  return sql`((scope->>'kind'='ATA2' AND scope->>'ata2'=ANY(${array(codes.ata2)}))
    OR (scope->>'kind'='ATA4' AND scope->>'ata4'=ANY(${array(codes.ata4)})))`;
}

const id = z.string().min(1).max(255).refine(value =>
  value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
const pageLimit = z.preprocess(value => typeof value === 'string' && /^\d+$/u.test(value)
  ? Number(value) : value, z.number().int().min(1).max(50).default(20));
const navigationQuery = z.strictObject({
  summaryId: id.optional(), parentSummaryId: id.optional(), rootSummaryId: id.optional(),
  search: z.string().trim().max(200).default(''), after: z.string().min(1).max(4000).optional(),
  limit: pageLimit,
});
type NavigationQuery = z.infer<typeof navigationQuery>;
type NavigationKey = [string, string, string, string, string];
const navigationCursor = z.strictObject({
  query: navigationQuery.omit({ after: true }),
  key: z.tuple([z.string(), z.string(), z.string(), z.string(), id]),
});

/** The same ordinary keyset cursor is always rechecked against the current read scope. */
export function decodeWikiGuideCursor(value: string): unknown {
  if (!value || value.length > 4000 || !/^[A-Za-z0-9_-]+$/u.test(value))
    throw new Error('invalid cursor');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('invalid cursor');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

export function parseWikiGuideNavigationQuery(value: unknown): NavigationQuery {
  const parsed = navigationQuery.safeParse(value);
  if (!parsed.success) throw new BadRequestException('WIKI_GUIDE_NAVIGATION_QUERY_INVALID');
  const query = parsed.data;
  const supplied = value as Record<string, unknown>;
  if ((query.summaryId && ['parentSummaryId', 'rootSummaryId', 'search', 'after', 'limit']
    .some(key => supplied[key] !== undefined)) || (query.search && !query.rootSummaryId) ||
    (query.parentSummaryId && query.search))
    throw new BadRequestException('WIKI_GUIDE_NAVIGATION_QUERY_INVALID');
  return query;
}

/** Existing discovery metadata only: no member bodies, reservation reconciliation or inventory. */
export function wikiGuideTreeCte(owner: SummaryActor, rootSummaryId?: string, descendants = true): SQL {
  return sql`guide_nodes AS (
    SELECT w.wiki_id, w.summary_id, w.parent_wiki_id, w.actor_user_id,
      p.summary_id AS parent_summary_id, w.scope_json AS scope,
      h.current_summary_ref, h.current_revision
    FROM hierarchical_wiki_scope w
    JOIN derived_summary h ON h.summary_id=w.summary_id AND h.tenant_id=w.tenant_id
      AND h.actor_user_id=w.actor_user_id
    LEFT JOIN hierarchical_wiki_scope p ON p.wiki_id=w.parent_wiki_id
      AND p.tenant_id=w.tenant_id AND p.actor_user_id=w.actor_user_id
    WHERE w.tenant_id=${owner.tenantId}
      ${owner.readScope === 'TENANT' ? sql`` : sql`AND w.actor_user_id=${owner.actorUserId}`}
  ), guide_tree AS (
    SELECT node.*, node.summary_id AS root_summary_id, ARRAY[node.wiki_id]::text[] AS visited,
      jsonb_build_array(jsonb_build_object('summaryId',node.summary_id,
        'parentSummaryId',node.parent_summary_id,'scope',node.scope,
        'currentSummaryRef',node.current_summary_ref,'currentRevision',node.current_revision)) AS path
    FROM guide_nodes node WHERE node.parent_wiki_id IS NULL AND node.scope->>'kind'='FLEET'
      ${rootSummaryId ? sql`AND node.summary_id=${rootSummaryId}` : sql``}
    UNION ALL
    SELECT child.*, parent.root_summary_id, parent.visited || child.wiki_id::text,
      parent.path || jsonb_build_array(jsonb_build_object('summaryId',child.summary_id,
        'parentSummaryId',child.parent_summary_id,'scope',child.scope,
        'currentSummaryRef',child.current_summary_ref,'currentRevision',child.current_revision))
    FROM guide_nodes child JOIN guide_tree parent ON child.parent_wiki_id=parent.wiki_id
      AND child.actor_user_id=parent.actor_user_id
    WHERE ${descendants} AND NOT child.wiki_id=ANY(parent.visited) AND cardinality(parent.visited)<16
  )`;
}

function navigationBinding(query: NavigationQuery) {
  const { after: _after, ...binding } = query;
  return binding;
}

function navigationAfter(query: NavigationQuery): NavigationKey | undefined {
  if (!query.after) return undefined;
  try {
    const cursor = navigationCursor.parse(decodeWikiGuideCursor(query.after));
    if (JSON.stringify(cursor.query) !== JSON.stringify(navigationBinding(query))) throw new Error();
    return [cursor.key[0], cursor.key[1], cursor.key[2], cursor.key[3], cursor.key[4]];
  } catch { throw new BadRequestException('WIKI_GUIDE_NAVIGATION_CURSOR_INVALID'); }
}

const nodeOrder = sql`COALESCE(scope->>'fleetFamilyId',''),COALESCE(scope->'fleetModelIds'->>0,''),
  COALESCE(scope->>'ata2',''),COALESCE(scope->>'ata4',''),summary_id`;

function nodeKey(node: WikiGuideNode): NavigationKey {
  return [node.scope.fleetFamilyId, node.scope.fleetModelIds[0] ?? '',
    node.scope.ata2 ?? '', node.scope.ata4 ?? '', node.summaryId];
}

/** State is an observation of the existing queue, never an authorization to its body. */
const nodeState = sql`CASE
  WHEN NULLIF(w.state_json->>'blocked','') IS NOT NULL THEN 'BLOCKED'
  WHEN w.state_json->'active' IS NOT NULL AND w.state_json->'active'<>'null'::jsonb THEN
    CASE WHEN a.attempt_id IS NULL THEN 'BLOCKED'
      WHEN a.status IN ('RUNNING','COMMITTING') THEN 'RUNNING'
      WHEN a.status IN ('QUEUED','RETRY_SCHEDULED') THEN 'QUEUED' ELSE 'PENDING' END
  WHEN jsonb_array_length(w.state_json->'waiting')>0 THEN
    CASE WHEN w.state_json->'versions'=w.state_json->'lastGenerated'
      AND COALESCE((w.state_json->>'forceGeneration')::bigint,0)=0 THEN 'PARTIAL' ELSE 'WAITING_UPSTREAM' END
  WHEN w.state_json->'versions'='{}'::jsonb THEN 'EMPTY'
  WHEN w.state_json->>'firstDirtyAt' IS NOT NULL THEN
    CASE WHEN w.state_json->'versions'=w.state_json->'lastGenerated'
      AND COALESCE((w.state_json->>'forceGeneration')::bigint,0)=0 THEN 'PARTIAL' ELSE 'PENDING' END
  ELSE 'CURRENT' END`;

/** Retains the same coarse-scope exception as HierarchicalWikiCompletion.metadata. */
const bodyStatus = sql`CASE WHEN NOT EXISTS (
  SELECT 1 FROM jsonb_each(w.state_json->'lastGenerated') old
  WHERE NOT jsonb_exists(w.state_json->'versions',old.key) AND NOT (
    w.scope_json->>'kind' IN ('ATA2','FLEET') AND EXISTS (
      SELECT 1 FROM hierarchical_wiki_membership retained WHERE retained.wiki_id=w.wiki_id
        AND retained.tenant_id=w.tenant_id AND retained.actor_user_id=w.actor_user_id
        AND retained.basis_json->>'classificationStatus'='CONFIRMED'
        AND ((old.value->>'kind'='MATTER_WORK' AND retained.source_kind='MATTER'
          AND retained.source_id=old.value->>'matterId' AND old.key='MATTER:'||retained.source_id)
          OR (old.value->>'kind'='DOCUMENT_READING' AND retained.source_kind='DOCUMENT'
            AND old.key='DOCUMENT_FAMILY:'||retained.source_id)))))
  THEN 'AVAILABLE' ELSE 'UPDATING_SCOPE' END`;

export async function readWikiGuideNavigation(
  database: PostgresJsDatabase, owner: SummaryActor, input: unknown,
): Promise<WikiGuideNavigationPage> {
  const query = parseWikiGuideNavigationQuery(input);
  const after = navigationAfter(query);
  const selection = query.summaryId ? sql`summary_id=${query.summaryId}`
    : query.parentSummaryId ? sql`parent_summary_id=${query.parentSummaryId}
        ${query.rootSummaryId ? sql`AND root_summary_id=${query.rootSummaryId}` : sql``}`
      : query.rootSummaryId ? sql`root_summary_id=${query.rootSummaryId} AND summary_id<>${query.rootSummaryId}
          AND scope->>'kind' IN ('ATA2','ATA4') AND (${query.search}='' OR
            position(lower(${query.search}) in lower(concat_ws(' ',scope->>'title',scope->>'ata2',scope->>'ata4')))>0
            OR ${chapterTitleCondition(query.search)})`
        : sql`parent_wiki_id IS NULL AND scope->>'kind'='FLEET'`;
  const selectedId = query.summaryId ?? query.parentSummaryId ?? query.rootSummaryId;
  const [snapshot] = await database.execute<{
    selectionFound: boolean; scopeValid: boolean; items: WikiGuideNode[];
  }>(sql`WITH RECURSIVE ${wikiGuideTreeCte(owner, query.rootSummaryId,
    Boolean(query.summaryId || query.parentSummaryId || query.rootSummaryId))}, guide_page AS (
    SELECT * FROM guide_tree WHERE ${selection}
      ${after ? sql`AND (${nodeOrder})>(${after[0]},${after[1]},${after[2]},${after[3]},${after[4]})` : sql``}
    ORDER BY ${nodeOrder} LIMIT ${query.limit + 1}
  ) SELECT ${selectedId ? sql`EXISTS(SELECT 1 FROM guide_tree WHERE summary_id=${selectedId}
      )` : sql`true`} AS "selectionFound",
    ${query.rootSummaryId ? sql`EXISTS(SELECT 1 FROM guide_tree root WHERE root.summary_id=${query.rootSummaryId}
      AND root.parent_wiki_id IS NULL AND root.scope->>'kind'='FLEET'
      ${query.parentSummaryId ? sql`AND EXISTS(SELECT 1 FROM guide_tree parent
        WHERE parent.summary_id=${query.parentSummaryId} AND parent.root_summary_id=root.summary_id)` : sql``})`
      : sql`true`} AS "scopeValid",
    COALESCE((SELECT jsonb_agg(result.node ORDER BY result.sort_key) FROM (
      SELECT jsonb_build_object('wikiId',w.wiki_id,'summaryId',page.summary_id,
        'parentSummaryId',page.parent_summary_id,'scope',page.scope,'enabled',w.enabled,
        'currentSummaryRef',page.current_summary_ref,'currentRevision',page.current_revision,
        'state',${nodeState},'currentBodyStatus',${bodyStatus},'path',page.path) AS node,
        ARRAY[COALESCE(page.scope->>'fleetFamilyId',''),COALESCE(page.scope->'fleetModelIds'->>0,''),
          COALESCE(page.scope->>'ata2',''),COALESCE(page.scope->>'ata4',''),page.summary_id] AS sort_key
      FROM guide_page page JOIN hierarchical_wiki_scope w ON w.wiki_id=page.wiki_id
        AND w.tenant_id=${owner.tenantId} AND w.actor_user_id=page.actor_user_id
      LEFT JOIN action_attempt a ON a.operation_ref=w.state_json->'active'->>'attemptRef'
        AND a.tenant_id=w.tenant_id AND a.actor_user_id=w.actor_user_id AND a.summary_id=w.summary_id
        AND a.trigger_request_id=w.state_json->'active'->>'requestId'
        AND a.summary_delegated_principal_id=w.delegated_principal_id
        AND a.subject_kind='DERIVED_SUMMARY' AND a.action_type='OPENCLAW_DERIVED_SUMMARY'
        AND a.work_item_id IS NULL AND a.matter_id IS NULL AND a.document_version_id IS NULL
    ) result),'[]'::jsonb) AS items`);
  if (snapshot && !snapshot.scopeValid) throw new BadRequestException('WIKI_GUIDE_ROOT_SCOPE_INVALID');
  if (!snapshot?.selectionFound) throw new NotFoundException('WIKI_GUIDE_NODE_UNAVAILABLE');
  const items = snapshot.items.slice(0, query.limit);
  const last = items.at(-1);
  return { items, nextCursor: snapshot.items.length > query.limit && last
    ? Buffer.from(JSON.stringify({ query: navigationBinding(query), key: nodeKey(last) })).toString('base64url')
    : null };
}
