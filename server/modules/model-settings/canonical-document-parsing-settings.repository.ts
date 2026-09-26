import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq } from 'drizzle-orm';
import type { UpdateDocumentParsingSettingsRequest } from '@shared/document-parsing-settings.interface';
import { canonicalModelSetting } from '../../database/schema';
import {
  CANONICAL_INITIAL_MODEL_REF,
  canonicalModelError,
} from './canonical-model-catalog';

const selection = {
  revision: canonicalModelSetting.revision,
  localMineruFallbackEnabled: canonicalModelSetting.localMineruFallbackEnabled,
  titleEnhancementEnabled: canonicalModelSetting.titleEnhancementEnabled,
  updatedAt: canonicalModelSetting.updatedAt,
};
@Injectable()
export class CanonicalDocumentParsingSettingsRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async read(tenantId: string, executor: PostgresJsDatabase = this.db) {
    const [row] = await executor
      .select(selection)
      .from(canonicalModelSetting)
      .where(eq(canonicalModelSetting.tenantId, tenantId))
      .limit(1);
    return row ?? null;
  }

  async compareAndSet(
    input: UpdateDocumentParsingSettingsRequest & {
      tenantId: string;
      actorUserId: string;
    },
  ) {
    const changed = {
      localMineruFallbackEnabled: input.localMineruFallbackEnabled,
      titleEnhancementEnabled: input.titleEnhancementEnabled,
      revision: input.expectedRevision + 1,
      changedByUserId: input.actorUserId,
      updatedAt: new Date(),
      updatedBy: input.actorUserId,
    };
    const rows =
      input.expectedRevision === 0
        ? await this.db
            .insert(canonicalModelSetting)
            .values({
              ...changed,
              tenantId: input.tenantId,
              modelRef: CANONICAL_INITIAL_MODEL_REF,
              createdBy: input.actorUserId,
            })
            .onConflictDoNothing()
            .returning(selection)
        : await this.db
            .update(canonicalModelSetting)
            .set(changed)
            .where(
              and(
                eq(canonicalModelSetting.tenantId, input.tenantId),
                eq(canonicalModelSetting.revision, input.expectedRevision),
              ),
            )
            .returning(selection);
    if (!rows[0])
      throw canonicalModelError(
        'DOCUMENT_PARSING_SETTINGS_REVISION_CONFLICT',
        409,
      );
    return rows[0];
  }
}
