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
      state: WikiDemand;
      parentSummaryId: string | null;
    }>(sql`SELECT w.state_json AS state,p.summary_id AS "parentSummaryId"
      FROM hierarchical_wiki_scope w LEFT JOIN hierarchical_wiki_scope p ON p.wiki_id=w.parent_wiki_id WHERE w.summary_id=${summaryId}`);
    const row = rows[0];
    if (!row) return {};
    const valid = Object.keys(row.state.lastGenerated).every((key) =>
      Object.hasOwn(row.state.versions, key),
    );
    return {
      automaticWiki: true,
      currentBodyStatus: valid ? 'AVAILABLE' : 'UPDATING_SCOPE',
      parentSummaryId: row.parentSummaryId,
    };
  }
}
