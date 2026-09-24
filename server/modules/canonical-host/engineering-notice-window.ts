import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { EngineeringReadPhaseObservation, observeEngineeringRead } from './engineering-read-phase-observation';

export interface NoticeRoot {
  tenantId: string;
  matterId: string;
  matterWorkRevisionId: string;
  createdByUserId: string;
  workingRevision: number;
}
export type NoticeAttempt = {
  id: string; attemptRef: string | null; status: string;
  isCorrection: boolean | null; isOverview: boolean | null;
  correctionPurpose: { kind: string; expectedWorkRef: string; issueKey: string; correctionReason: string } | null;
  overviewPurpose: { kind: string; expectedWorkRef: string; correctionReason: string } | null;
  reviewActivityJson: string | null;
}
export type NoticeReader = (row: NoticeRoot) => Promise<NoticeAttempt[]>;

/**
 * Original singleton query; also used by recursive, retry and late roots.
 * Materialize only purpose objects: full task envelopes can contain large source
 * catalogs. Non-object/absent modelInput retains PostgreSQL non-match semantics.
 */
export async function readNoticeAttempts(executor: PostgresJsDatabase, row: NoticeRoot): Promise<NoticeAttempt[]> {
  return executor.execute<NoticeAttempt>(sql`
    WITH scoped AS MATERIALIZED (
      SELECT a.attempt_id AS "id", a.operation_ref AS "attemptRef", a.status,
        a.review_activity_json AS "reviewActivityJson", a.created_at AS "createdAt",
        purpose.correction AS "correctionPurpose",
        purpose."overviewCorrection" AS "overviewPurpose"
      FROM action_attempt a
      CROSS JOIN LATERAL jsonb_to_record(jsonb_path_query_first(
        a.task_envelope_json::jsonb, '$.modelInput ? (@.type() == "object")'
      )) AS purpose(correction jsonb, "overviewCorrection" jsonb)
      WHERE a.tenant_id = ${row.tenantId} AND a.matter_id = ${row.matterId}
        AND a.subject_kind = 'ENGINEERING_MATTER'
        AND a.action_type = 'OPENCLAW_MATTER_ASSESSMENT'
    ), matched AS MATERIALIZED (
      SELECT scoped.*,
        (scoped."correctionPurpose" ->> 'kind' = 'ENGINEERING_ISSUE_CORRECTION'
          AND scoped."correctionPurpose" ->> 'expectedWorkRef' = ${row.matterWorkRevisionId}) AS "isCorrection",
        (scoped."overviewPurpose" ->> 'kind' = 'ENGINEERING_OVERVIEW_CORRECTION'
          AND scoped."overviewPurpose" ->> 'expectedWorkRef' IN (
            SELECT w.matter_work_revision_id FROM engineering_matter_work_revision w
            WHERE w.tenant_id = ${row.tenantId} AND w.matter_id = ${row.matterId}
              AND w.created_by_user_id = ${row.createdByUserId}
              AND w.working_revision <= ${row.workingRevision}
          )) AS "isOverview"
      FROM scoped
    )
    SELECT "id", "attemptRef", status, "reviewActivityJson",
      "correctionPurpose", "overviewPurpose", "isCorrection", "isOverview"
    FROM matched WHERE "isCorrection" OR "isOverview"
    ORDER BY "createdAt" ASC
  `);
}

/** Request-local window queue: dispatch next microtask, never wait for other roots. */
export function createNoticeWindowReader(
  executor: PostgresJsDatabase,
  observation?: EngineeringReadPhaseObservation,
): NoticeReader {
  type Pending = { row: NoticeRoot; resolve: (rows: NoticeAttempt[]) => void; reject: (error: unknown) => void };
  let pending: Pending[] = [];
  let accepted = 0;
  let dispatched = false;
  const flush = () => {
    dispatched = true;
    const ready: Pending[] = pending;
    pending = [];
    const groups = new Map<string, Pending[]>();
    for (const item of ready) {
      const key = JSON.stringify([item.row.tenantId, item.row.matterId]);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const group of groups.values()) {
      if (group.length === 1) {
        const item = group[0];
        void readNoticeAttempts(executor, item.row).then(item.resolve, item.reject);
        continue;
      }
      const row = group[0].row;
      const roots = group.map((item, index) => ({ index,
        matterWorkRevisionId: item.row.matterWorkRevisionId,
        createdByUserId: item.row.createdByUserId, workingRevision: item.row.workingRevision }));
      observation?.mark('notice_window_batch_ready', 'ok', { participants: group.length });
      void observeEngineeringRead(observation, 'notice_window_batch_query', () =>
        executor.execute<NoticeAttempt & { index: number }>(sql`
    WITH roots AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(roots)}::jsonb)
        AS r(index integer, "matterWorkRevisionId" text, "createdByUserId" text, "workingRevision" integer)
    ), scoped AS MATERIALIZED (
      SELECT a.attempt_id AS "id", a.operation_ref AS "attemptRef", a.status,
        a.review_activity_json AS "reviewActivityJson", a.created_at AS "createdAt",
        purpose.correction AS "correctionPurpose",
        purpose."overviewCorrection" AS "overviewPurpose"
      FROM action_attempt a
      CROSS JOIN LATERAL jsonb_to_record(jsonb_path_query_first(
        a.task_envelope_json::jsonb, '$.modelInput ? (@.type() == "object")'
      )) AS purpose(correction jsonb, "overviewCorrection" jsonb)
      WHERE a.tenant_id = ${row.tenantId} AND a.matter_id = ${row.matterId}
        AND a.subject_kind = 'ENGINEERING_MATTER'
        AND a.action_type = 'OPENCLAW_MATTER_ASSESSMENT'
    ), matched AS MATERIALIZED (
      SELECT roots.index, scoped.*,
        (scoped."correctionPurpose" ->> 'kind' = 'ENGINEERING_ISSUE_CORRECTION'
          AND scoped."correctionPurpose" ->> 'expectedWorkRef' = roots."matterWorkRevisionId") AS "isCorrection",
        (scoped."overviewPurpose" ->> 'kind' = 'ENGINEERING_OVERVIEW_CORRECTION'
          AND scoped."overviewPurpose" ->> 'expectedWorkRef' IN (
            SELECT w.matter_work_revision_id FROM engineering_matter_work_revision w
            WHERE w.tenant_id = ${row.tenantId} AND w.matter_id = ${row.matterId}
              AND w.created_by_user_id = roots."createdByUserId"
              AND w.working_revision <= roots."workingRevision"
          )) AS "isOverview"
      FROM scoped CROSS JOIN roots
    )
    SELECT index, "id", "attemptRef", status, "reviewActivityJson",
      "correctionPurpose", "overviewPurpose", "isCorrection", "isOverview"
    FROM matched WHERE "isCorrection" OR "isOverview"
    ORDER BY index, "createdAt" ASC
  `)).then(rows => {
          // Matching stays in PostgreSQL (including JSON ->> semantics). Validation,
          // receipts, saves and authorization remain in each exact root reader.
          for (let index = 0; index < group.length; index += 1) {
            group[index].resolve(rows.filter(item => item.index === index));
          }
        }).catch(error => { for (const item of group) item.reject(error); });
    }
  };
  return row => {
    if (++accepted > 4) throw new Error('MATTER_NOTICE_WINDOW_OVERFLOW');
    if (dispatched) return readNoticeAttempts(executor, row);
    return new Promise<NoticeAttempt[]>((resolve, reject) => {
      pending.push({ row, resolve, reject });
      if (pending.length === 1) queueMicrotask(flush);
    });
  };
}
