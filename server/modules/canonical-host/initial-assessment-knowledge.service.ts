import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { ailyAgentId } from '../identity/aily-user-grant.codec';
import { JobAidWorkRepository } from './jobaid-work.repository';
import { ReviewAilyService } from './review-aily.service';

export interface InitialKnowledgeBinding {
  sessionId: string;
  agentId: string;
}
export interface InitialKnowledgeScope {
  tenantId: string;
  actorId: string;
  workItemId: string;
}
interface SavedQuery extends Record<string, unknown> {
  query_ref: string;
  query_text: string;
  status: string;
  answer_text: string | null;
  error_code: string | null;
  _created_at: Date | string;
}

export function initialKnowledgeEvidence(
  row: SavedQuery,
): AssessmentEvidence[] {
  if (
    !row.answer_text ||
    !['COMPLETED', 'FAILED', 'UNKNOWN'].includes(row.status)
  )
    return [];
  return [
    {
      evidenceRef: `query:aily:${row.query_ref}`,
      kind: 'QUERY_RECEIPT',
      receiptRef: row.query_ref,
      title: '按需知识检索回执（原始文档未核实）',
      versionLabel: null,
      excerpt: row.answer_text,
      checkedScope: row.query_text,
      queriedAt: new Date(row._created_at).toISOString(),
      coverage: 'PARTIAL',
      queryProvenance: {
        origin: 'AILY_RETRIEVAL',
        queryText: row.query_text,
        status: row.status as 'COMPLETED' | 'FAILED' | 'UNKNOWN',
        originalDocumentsVerified: false,
      },
    },
  ];
}

@Injectable()
export class InitialAssessmentKnowledgeService {
  constructor(
    private readonly work: JobAidWorkRepository,
    private readonly aily: ReviewAilyService,
  ) {}

  async binding(scope: InitialKnowledgeScope, sessionId?: string | null) {
    const access = await this.aily.availability({
      ...scope,
      sessionId: sessionId ?? undefined,
    });
    const agentId = ailyAgentId();
    return {
      access,
      binding:
        access.available && sessionId && agentId
          ? { sessionId, agentId }
          : undefined,
    };
  }

  async query(
    scope: InitialKnowledgeScope,
    binding: InitialKnowledgeBinding,
    attemptId: string,
    input: { requestKey?: string; query?: string; queryRef?: string },
  ) {
    if (binding.agentId !== ailyAgentId())
      throw new Error('JOBAID_KNOWLEDGE_BINDING_CHANGED');
    const actor = { ...scope, sessionId: binding.sessionId };
    let result;
    if (input.queryRef)
      result = await this.aily.result(actor, attemptId, input.queryRef);
    else if (input.query !== undefined && input.requestKey)
      result = await this.aily.start(
        actor,
        attemptId,
        input.requestKey,
        input.query,
      );
    else if (input.requestKey) {
      const rows = await this.work.withActorTransaction(scope.actorId, (db) =>
        db.execute<{ query_ref: string }>(sql`
        SELECT query_ref FROM review_aily_query WHERE attempt_ref=${attemptId} AND request_key=${input.requestKey}
        AND actor_id=${scope.actorId} AND tenant_id=${scope.tenantId} AND session_id=${binding.sessionId}::uuid AND agent_id=${binding.agentId}`),
      );
      if (!rows[0])
        return {
          queryRef: null,
          status: 'UNKNOWN',
          error: 'AILY_START_RESULT_UNCONFIRMED',
          evidence: [],
          candidateOnly: true,
          originalDocumentsVerified: false,
        };
      result = await this.aily.result(actor, attemptId, rows[0].query_ref);
    } else throw new Error('AILY_QUERY_INVALID');
    const evidence = (await this.saved(scope, attemptId)).filter(
      (item) =>
        item.kind === 'QUERY_RECEIPT' && item.receiptRef === result.queryRef,
    );
    return {
      queryRef: result.queryRef,
      status: result.status,
      error: result.error ?? null,
      evidence,
      candidateOnly: true,
      originalDocumentsVerified: false,
    };
  }

  async saved(
    scope: InitialKnowledgeScope,
    attemptId?: string,
    database?: PostgresJsDatabase,
  ): Promise<AssessmentEvidence[]> {
    const read = async (db: PostgresJsDatabase) => {
      const rows = await db.execute<SavedQuery>(sql`
        SELECT q.* FROM review_aily_query q JOIN action_attempt a ON a.attempt_id=q.attempt_ref
        JOIN work_item w ON w.work_item_id=a.work_item_id AND w.tenant_id=a.tenant_id
        WHERE q.tenant_id=${scope.tenantId} AND q.actor_id=${scope.actorId}
        AND w.tenant_id=${scope.tenantId} AND w.work_item_id=${scope.workItemId} AND w.requested_by_user_id=${scope.actorId}
        AND a.action_type IN ('OPENCLAW_DYNAMIC_EVALUATION','OPENCLAW_OVERALL_SYNTHESIS')
        AND ${attemptId ? sql`q.attempt_ref=${attemptId}` : sql`TRUE`}`);
      return rows.flatMap(initialKnowledgeEvidence);
    };
    return database
      ? read(database)
      : this.work.withActorTransaction(scope.actorId, read);
  }
}
