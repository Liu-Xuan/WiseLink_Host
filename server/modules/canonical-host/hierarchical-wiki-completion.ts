import { Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { DerivedSummaryRevision } from '@shared/derived-summary.interface';
import type { SummaryActor } from './derived-summary-members.service';
import { completeSavedWiki } from './hierarchical-wiki.persistence';
import { sql } from 'drizzle-orm';
import type { DerivedSummaryMetadata } from '@shared/derived-summary.interface';
import type { WikiDemand } from './hierarchical-wiki-demand';

@Injectable()
export class HierarchicalWikiCompletion {
  saved(
    database: PostgresJsDatabase,
    owner: SummaryActor,
    revision: DerivedSummaryRevision,
  ): Promise<void> {
    return completeSavedWiki(database, owner, revision);
  }

  async metadata(
    summaryId: string,
    database: PostgresJsDatabase,
  ): Promise<
    Pick<
      DerivedSummaryMetadata,
      'automaticWiki' | 'currentBodyStatus' | 'parentSummaryId'
    >
  > {
    const rows = await database.execute<{
      wikiId: string;
      scopeKind: string;
      state: WikiDemand;
      parentSummaryId: string | null;
    }>(sql`SELECT w.wiki_id AS "wikiId",w.scope_json->>'kind' AS "scopeKind",w.state_json AS state,p.summary_id AS "parentSummaryId"
      FROM hierarchical_wiki_scope w LEFT JOIN hierarchical_wiki_scope p ON p.wiki_id=w.parent_wiki_id WHERE w.summary_id=${summaryId}`);
    const row = rows[0];
    if (!row) return {};
    const missing = Object.entries(row.state.lastGenerated).filter(([key]) =>
      !Object.hasOwn(row.state.versions, key));
    let valid = missing.length === 0;
    if (!valid && ['ATA2', 'FLEET'].includes(row.scopeKind)) {
      // The generation policy no longer selects coarse original material, but
      // that alone must not hide an existing saved body. Classification removal
      // still hides it; readHead/checkRevision still reauthorizes every body and
      // SourceRef. These keys never return to the new generation/coverage set.
      const retained = await database.execute<{ key: string; sourceKind: string; sourceId: string }>(sql`
        SELECT member_key AS key,source_kind AS "sourceKind",source_id AS "sourceId"
        FROM hierarchical_wiki_membership WHERE wiki_id=${row.wikiId}
          AND basis_json->>'classificationStatus'='CONFIRMED'`);
      valid = missing.every(([key, member]) => retained.some(item => item.key === key &&
        (member.kind === 'MATTER_WORK'
          ? item.sourceKind === 'MATTER' && item.sourceId === member.matterId && key === `MATTER:${item.sourceId}`
          : member.kind === 'DOCUMENT_READING' && item.sourceKind === 'DOCUMENT' && key === `DOCUMENT_FAMILY:${item.sourceId}`)));
    }
    return {
      automaticWiki: true,
      currentBodyStatus: valid ? 'AVAILABLE' : 'UPDATING_SCOPE',
      parentSummaryId: row.parentSummaryId,
    };
  }
}
