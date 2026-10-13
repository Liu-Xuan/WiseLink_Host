import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type {
  DerivedSummaryRevision,
  DerivedSummaryScopeSelection,
} from '@shared/derived-summary.interface';
import type { SummaryActor } from './derived-summary-members.service';
import {
  completeWikiDemand,
  emptyWikiDemand,
  wikiScopeKey,
  type WikiDemand,
  type WikiVersions,
} from './hierarchical-wiki-demand';
import { summaryError } from './derived-summary.validation';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

export interface WikiRow extends Record<string, unknown> {
  wikiId: string;
  summaryId: string;
  tenantId: string;
  actorUserId: string;
  scope: DerivedSummaryScopeSelection;
  parentWikiId: string | null;
  principalId: string;
  modelRef: string;
  enabled: boolean;
  state: WikiDemand;
  lastEventSeq: string;
  lastInventoryAt: string | null;
  inventoryCursor: string | null;
  upstreamDelegations: Record<
    string,
    { enabled: boolean; authorizedAt: string }
  >;
}
const columns = sql`wiki_id AS "wikiId",summary_id AS "summaryId",tenant_id AS "tenantId",actor_user_id AS "actorUserId",
  scope_json AS scope,parent_wiki_id AS "parentWikiId",delegated_principal_id AS "principalId",model_ref AS "modelRef",
  enabled,state_json AS state,last_event_seq::text AS "lastEventSeq",last_inventory_at::text AS "lastInventoryAt",
  inventory_cursor AS "inventoryCursor",upstream_delegations_json AS "upstreamDelegations"`;

export async function wikiRows(
  database: PostgresJsDatabase,
  owner: SummaryActor,
): Promise<WikiRow[]> {
  const rows =
    await database.execute<WikiRow>(sql`SELECT ${columns} FROM hierarchical_wiki_scope
    WHERE tenant_id=${owner.tenantId}
      ${owner.readScope === 'TENANT' ? sql`` : sql`AND actor_user_id=${owner.actorUserId}`}
    ORDER BY wiki_id`);
  for (const row of rows) {
    if (
      row.state.schemaVersion !== 1 ||
      !row.state.versions ||
      !row.state.lastGenerated ||
      !Array.isArray(row.state.waiting)
    )
      throw summaryError('WIKI_PERSISTENCE_INVALID');
  }
  return [...rows];
}

export async function ensureWiki(
  database: PostgresJsDatabase,
  owner: SummaryActor,
  scope: DerivedSummaryScopeSelection,
  principalId: string,
  modelRef: string,
  parent: WikiRow | null,
): Promise<WikiRow> {
  const key = wikiScopeKey(scope);
  const found =
    await database.execute<WikiRow>(sql`SELECT ${columns} FROM hierarchical_wiki_scope
    WHERE tenant_id=${owner.tenantId} AND actor_user_id=${owner.actorUserId} AND scope_key=${key}`);
  if (found[0]) return found[0];
  const wikiId = `WIKI-${randomUUID()}`;
  const summaryId = `DS-${randomUUID()}`;
  await database.execute(sql`INSERT INTO derived_summary(summary_id,tenant_id,actor_user_id,create_request_id,scope_json,members_json)
    VALUES (${summaryId},${owner.tenantId},${owner.actorUserId},${wikiId},${JSON.stringify(scope)}::jsonb,'[]'::jsonb)`);
  const rows =
    await database.execute<WikiRow>(sql`INSERT INTO hierarchical_wiki_scope
    (wiki_id,summary_id,tenant_id,actor_user_id,scope_key,scope_json,parent_wiki_id,delegated_principal_id,model_ref,state_json)
    VALUES (${wikiId},${summaryId},${owner.tenantId},${owner.actorUserId},${key},${JSON.stringify(scope)}::jsonb,
      ${parent?.wikiId ?? null},${principalId},${modelRef},${JSON.stringify(emptyWikiDemand())}::jsonb)
    ON CONFLICT (tenant_id,actor_user_id,scope_key) DO NOTHING RETURNING ${columns}`);
  // Roll back the losing provisional summary too. A retry reads the unique row;
  // no orphan summaries or title-derived identities survive a concurrent enable.
  if (!rows[0]) throw summaryError('WIKI_SCOPE_RESERVATION_RACE');
  return rows[0];
}

export async function storeWikiDemand(
  database: PostgresJsDatabase,
  row: WikiRow,
  state: WikiDemand,
): Promise<void> {
  await database.execute(sql`UPDATE hierarchical_wiki_scope SET state_json=${JSON.stringify(state)}::jsonb,_updated_at=CURRENT_TIMESTAMP
    WHERE wiki_id=${row.wikiId} AND tenant_id=${row.tenantId} AND actor_user_id=${row.actorUserId}`);
  row.state = state;
}

/** Directory writers serialize before reading or changing memberships. They
 * perform no body/native-source reads while these registry locks are held. */
export async function lockWikiRoots(
  database: PostgresJsDatabase,
  owner: SummaryActor,
): Promise<void> {
  await database.execute(sql`SELECT wiki_id FROM hierarchical_wiki_scope
    WHERE tenant_id=${owner.tenantId} AND actor_user_id=${owner.actorUserId} AND scope_json->>'kind'='FLEET'
    ORDER BY wiki_id FOR UPDATE`);
}

/** Runtime takes its original context/source locks first, then root and node.
 * Every membership writer holds this same root through its complete refresh. */
export async function lockWikiBranch(
  database: PostgresJsDatabase,
  row: WikiRow,
): Promise<WikiRow> {
  const roots =
    await database.execute<WikiRow>(sql`SELECT ${columns} FROM hierarchical_wiki_scope
    WHERE tenant_id=${row.tenantId} AND actor_user_id=${row.actorUserId} AND scope_json->>'kind'='FLEET'
      AND scope_json->>'fleetFamilyId'=${row.scope.fleetFamilyId}
      AND scope_json->'fleetModelIds'=${JSON.stringify(row.scope.fleetModelIds)}::jsonb FOR UPDATE`);
  if (roots.length !== 1) throw summaryError('WIKI_UNAVAILABLE', 404);
  return roots[0]!.wikiId === row.wikiId ? roots[0]! : lockWiki(database, row);
}

/** Called after the existing summary/source CAS locks, in the SAVE transaction.
 * Reservation takes its existing context locks before this same Wiki row lock. */
export async function completeSavedWiki(
  database: PostgresJsDatabase,
  owner: SummaryActor,
  revision: DerivedSummaryRevision,
): Promise<void> {
  const rows =
    await database.execute<WikiRow>(sql`SELECT ${columns} FROM hierarchical_wiki_scope
    WHERE tenant_id=${owner.tenantId} AND actor_user_id=${owner.actorUserId} AND summary_id=${revision.summaryId}`);
  if (!rows[0]) return; // Ordinary manual summaries keep their existing lifecycle.
  const row = await lockWikiBranch(database, rows[0]);
  if (!row.enabled || row.state.active?.requestId !== revision.requestId)
    throw summaryError('WIKI_ATTEMPT_BINDING_MISMATCH');
  if (
    Object.entries(row.state.active.versions).some(
      ([key, member]) =>
        canonicalJson(row.state.versions[key]) !== canonicalJson(member),
    )
  )
    throw summaryError('DERIVED_SUMMARY_CONTEXT_CHANGED');
  const memberships = await database.execute<{
    key: string;
    member: unknown;
  }>(sql`SELECT member_key AS key,member_json AS member
    FROM hierarchical_wiki_membership WHERE wiki_id=${row.wikiId} AND basis_json->>'classificationStatus'='CONFIRMED'`);
  const children =
    await database.execute<WikiRow>(sql`SELECT ${columns} FROM hierarchical_wiki_scope
    WHERE tenant_id=${owner.tenantId} AND actor_user_id=${owner.actorUserId} AND parent_wiki_id=${row.wikiId}`);
  for (const [key, member] of Object.entries(row.state.active.versions)) {
    const valid =
      member.kind === 'DERIVED_SUMMARY'
        ? children.some(
            (child) =>
              child.summaryId === member.summaryId &&
              Object.keys(child.state.versions).length > 0 &&
              Object.keys(child.state.lastGenerated).every((item) =>
                Object.hasOwn(child.state.versions, item),
              ),
          )
        : memberships.some(
            (item) =>
              item.key === key &&
              canonicalJson(item.member) === canonicalJson(member),
          );
    if (!valid) throw summaryError('DERIVED_SUMMARY_CONTEXT_CHANGED');
  }
  const important = row.state.priority === 'IMPORTANT';
  const covered: WikiVersions = {};
  for (const [key, member] of Object.entries(row.state.active.versions)) {
    if (
      revision.coverage.some(
        (item) =>
          item.delivered &&
          item.used &&
          canonicalJson(item.member) === canonicalJson(member),
      )
    )
      covered[key] = member;
  }
  await storeWikiDemand(
    database,
    row,
    completeWikiDemand(
      row.state,
      revision.requestId,
      covered,
      revision.createdAt,
    ),
  );
  await database.execute(sql`INSERT INTO hierarchical_wiki_change(tenant_id,actor_user_id,kind,subject_id,version_ref,important)
    VALUES (${owner.tenantId},${owner.actorUserId},'SUMMARY',${revision.summaryId},${revision.summaryRef},${important})
    ON CONFLICT (tenant_id,kind,subject_id,version_ref) DO NOTHING`);
}

export async function lockWiki(
  database: PostgresJsDatabase,
  row: WikiRow,
): Promise<WikiRow> {
  const rows =
    await database.execute<WikiRow>(sql`SELECT ${columns} FROM hierarchical_wiki_scope
    WHERE wiki_id=${row.wikiId} AND tenant_id=${row.tenantId} AND actor_user_id=${row.actorUserId} FOR UPDATE`);
  if (!rows[0]) throw summaryError('WIKI_UNAVAILABLE', 404);
  return rows[0];
}
