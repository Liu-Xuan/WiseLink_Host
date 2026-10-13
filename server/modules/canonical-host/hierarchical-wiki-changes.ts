import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';

export interface WikiChange {
  tenantId: string;
  actorUserId: string;
  kind: 'DOCUMENT' | 'MATTER' | 'WORK_ITEM' | 'SUMMARY';
  subjectId: string;
  versionRef: string;
  important?: boolean;
}

/** A Wiki-specific save journal. Source writers only append; they never acquire
 * Wiki locks after their source/matter locks, avoiding a reservation lock inversion. */
@Injectable()
export class HierarchicalWikiChanges {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async record(
    input: WikiChange,
    database: Pick<PostgresJsDatabase, 'execute'> = this.db,
  ): Promise<void> {
    await database.execute(sql`INSERT INTO hierarchical_wiki_change
      (tenant_id,actor_user_id,kind,subject_id,version_ref,important)
      VALUES (${input.tenantId},${input.actorUserId},${input.kind},${input.subjectId},${input.versionRef},${input.important ?? false})
      ON CONFLICT (tenant_id,kind,subject_id,version_ref) DO NOTHING`);
  }
}
