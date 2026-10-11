import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { CanonicalExecutionModelSelection } from '@shared/api.interface';

import {
  actionAttempt,
  canonicalModelSetting,
  workItem,
} from '../../database/schema';
import { canonicalModelError } from './canonical-model-catalog';
import { readStoredExecutionModel } from './canonical-execution-model';

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

  async read(
    tenantId: string,
    executor: PostgresJsDatabase = this.db,
  ): Promise<StoredCanonicalModelSetting | null> {
    const [row] = await executor
      .select(selection)
      .from(canonicalModelSetting)
      .where(eq(canonicalModelSetting.tenantId, tenantId))
      .limit(1);
    return row ?? null;
  }

  /** Caller has already authorized this exact tenant and WorkItem. */
  async readWorkItemModel(
    tenantId: string,
    workItemId: string,
  ): Promise<CanonicalExecutionModelSelection | null> {
    const [row] = await this.db
      .select({ model: workItem.analysisModelJson })
      .from(workItem)
      .where(
        and(
          eq(workItem.tenantId, tenantId),
          eq(workItem.workItemId, workItemId),
        ),
      )
      .limit(1);
    if (!row) throw canonicalModelError('TASK_MODEL_WORK_ITEM_NOT_FOUND', 404);
    if (row.model != null) return readStoredExecutionModel(row.model);
    // Pre-task-choice WorkItems inherit their first real initial attempt, never
    // the current global preference or a later Review override.
    const [legacy] = await this.db
      .select({ model: actionAttempt.executionModelJson })
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.tenantId, tenantId),
          eq(actionAttempt.workItemId, workItemId),
          inArray(actionAttempt.actionType, [
            'OPENCLAW_TRANSLATE',
            'OPENCLAW_APPLICABILITY_EVALUATION',
            'OPENCLAW_DYNAMIC_EVALUATION',
            'OPENCLAW_OVERALL_SYNTHESIS',
          ]),
          isNotNull(actionAttempt.executionModelJson),
        ),
      )
      .orderBy(asc(actionAttempt.createdAt), asc(actionAttempt.attemptId))
      .limit(1);
    return readStoredExecutionModel(legacy?.model);
  }

  async pinWorkItemModel(
    tenantId: string,
    workItemId: string,
    model: CanonicalExecutionModelSelection,
  ): Promise<CanonicalExecutionModelSelection> {
    // Concurrent stage starts must all use the winner. Control metadata does
    // not revise engineering content or formally adopt a candidate.
    await this.db
      .update(workItem)
      .set({ analysisModelJson: JSON.stringify(model) })
      .where(
        and(
          eq(workItem.tenantId, tenantId),
          eq(workItem.workItemId, workItemId),
          isNull(workItem.analysisModelJson),
        ),
      );
    const saved = await this.readWorkItemModel(tenantId, workItemId);
    if (!saved) throw canonicalModelError('TASK_MODEL_READBACK_FAILED', 500);
    return saved;
  }

  async compareAndSet(input: {
    tenantId: string;
    actorUserId: string;
    expectedRevision: number;
    modelRef: string;
  }): Promise<StoredCanonicalModelSetting> {
    // The platform transaction supplies the actor and roles. The RPC accepts
    // no actor or parsing settings and preserves the table's write-deny RLS.
    const rows = await this.db.execute<{
      tenantId: string;
      modelRef: string;
      revision: number;
      updatedAt: Date | string;
    }>(sql`
      SELECT tenant_id AS "tenantId", model_ref AS "modelRef",
             revision, updated_at AS "updatedAt"
      FROM workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set(
        ${input.tenantId}::varchar,
        ${input.modelRef}::varchar,
        ${input.expectedRevision}::integer
      )
    `);
    if (!rows[0])
      throw canonicalModelError('MODEL_SETTINGS_REVISION_CONFLICT', 409);
    return {
      ...rows[0],
      updatedAt:
        rows[0].updatedAt instanceof Date
          ? rows[0].updatedAt
          : new Date(rows[0].updatedAt),
    };
  }
}
