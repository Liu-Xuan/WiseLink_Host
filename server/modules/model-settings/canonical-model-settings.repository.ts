import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq } from 'drizzle-orm';

import { canonicalModelSetting } from '../../database/schema';
import { canonicalModelError } from './canonical-model-catalog';

export type StoredCanonicalModelSetting = Pick<
  typeof canonicalModelSetting.$inferSelect,
  'tenantId' | 'modelRef' | 'revision' | 'updatedAt'
>;

const selection = {
  tenantId: canonicalModelSetting.tenantId,
  modelRef: canonicalModelSetting.modelRef,
  revision: canonicalModelSetting.revision,
  updatedAt: canonicalModelSetting.updatedAt,
};

@Injectable()
export class CanonicalModelSettingsRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async read(tenantId: string): Promise<StoredCanonicalModelSetting | null> {
    const [row] = await this.db
      .select(selection)
      .from(canonicalModelSetting)
      .where(eq(canonicalModelSetting.tenantId, tenantId))
      .limit(1);
    return row ?? null;
  }

  async compareAndSet(input: {
    tenantId: string;
    actorUserId: string;
    expectedRevision: number;
    modelRef: string;
  }): Promise<StoredCanonicalModelSetting> {
    const now = new Date();
    const changed = {
      modelRef: input.modelRef,
      revision: input.expectedRevision + 1,
      changedByUserId: input.actorUserId,
      updatedAt: now,
      updatedBy: input.actorUserId,
    };
    const rows =
      input.expectedRevision === 0
        ? await this.db
            .insert(canonicalModelSetting)
            .values({
              ...changed,
              tenantId: input.tenantId,
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
      throw canonicalModelError('MODEL_SETTINGS_REVISION_CONFLICT', 409);
    return rows[0];
  }
}
