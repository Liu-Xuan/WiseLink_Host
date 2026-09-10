import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { RequestDialogueAssessment } from '@shared/dialogue.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { DialogueRepository, type DialogueScope } from './dialogue.repository';
import { dialogueConflict } from './dialogue-validation';

export interface DialogueAssessmentRow extends Record<string, unknown> {
  request_ref: string;
  thread_ref: string;
  request_key: string;
  work_item_id: string;
  request_json: string;
  input_json: string;
  user_message: string;
  review_conversation_id: string;
  review_turn_id: string | null;
}
export interface DialogueAssessmentSnapshot {
  contextWorkItemIds: string[];
  contributions: Array<{
    contributionRef: string;
    revision: number;
    messageRef: string;
    selectedText: string;
    sourcePart: string;
    kind: string;
    origin: string;
    sourceContext: Array<{
      messageRef: string;
      userText: string;
      assistantText: string | null;
    }>;
  }>;
}

@Injectable()
export class DialogueAssessmentRepository {
  constructor(private readonly dialogues: DialogueRepository) {}

  async find(scope: DialogueScope, threadRef: string, requestKey: string) {
    return this.dialogues.transaction(scope, async (db) => {
      const [row] = await db.execute<DialogueAssessmentRow>(
        sql`SELECT * FROM dialogue_assessment_request WHERE thread_ref=${threadRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} AND request_key=${requestKey}`,
      );
      return row ?? null;
    });
  }

  async create(
    scope: DialogueScope,
    threadRef: string,
    request: RequestDialogueAssessment,
    snapshot: DialogueAssessmentSnapshot,
    userMessage: string,
    conversationId: string,
  ) {
    return this.dialogues.transaction(scope, async (db) => {
      const [thread] = await db.execute(
        sql`SELECT thread_ref FROM dialogue_thread WHERE thread_ref=${threadRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} FOR UPDATE`,
      );
      if (!thread) dialogueConflict('DIALOGUE_NOT_FOUND');
      const [existing] = await db.execute<DialogueAssessmentRow>(
        sql`SELECT * FROM dialogue_assessment_request WHERE thread_ref=${threadRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} AND request_key=${request.requestId}`,
      );
      if (existing) {
        if (existing.request_json !== canonicalJson(request))
          dialogueConflict('DIALOGUE_REQUEST_REPLAY_CONFLICT');
        return existing;
      }
      for (const selected of snapshot.contributions) {
        const [row] = await db.execute<{
          revision: number;
          status: string;
        }>(sql`SELECT revision,status FROM discussion_contribution
          WHERE contribution_ref=${selected.contributionRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} AND work_item_id=${request.workItemId} FOR UPDATE`);
        if (
          !row ||
          row.revision !== selected.revision ||
          row.status !== 'ACTIVE'
        )
          dialogueConflict('DIALOGUE_CONTRIBUTION_CHANGED');
      }
      const [row] =
        await db.execute<DialogueAssessmentRow>(sql`INSERT INTO dialogue_assessment_request
        (request_ref,thread_ref,tenant_id,actor_id,request_key,work_item_id,request_json,input_json,user_message,review_conversation_id)
        VALUES (${randomUUID()}::uuid,${threadRef}::uuid,${scope.tenantId},${scope.actorId},${request.requestId},${request.workItemId},${canonicalJson(request)},${JSON.stringify(snapshot)},${userMessage},${conversationId}) RETURNING *`);
      return row;
    });
  }

  async findForTurn(scope: DialogueScope, workItemId: string, turnId: string) {
    return this.dialogues.transaction(scope, async (db) => {
      const [row] = await db.execute<DialogueAssessmentRow>(sql`
        SELECT r.* FROM dialogue_assessment_request r
        JOIN review_turn t ON t.request_id='dialogue-' || r.request_ref::text
          AND t.review_conversation_id=r.review_conversation_id
          AND t.tenant_id=r.tenant_id AND t.actor_id=r.actor_id
          AND t.work_item_id=r.work_item_id
        WHERE r.tenant_id=${scope.tenantId} AND r.actor_id=${scope.actorId}
          AND r.work_item_id=${workItemId} AND t.review_turn_id=${turnId}`);
      return row ?? null;
    });
  }

  async findTurn(
    scope: DialogueScope,
    request: DialogueAssessmentRow,
  ): Promise<string | null> {
    return this.dialogues.transaction(scope, async (db) => {
      const [turn] = await db.execute<{ review_turn_id: string }>(sql`
        SELECT review_turn_id FROM review_turn
        WHERE tenant_id=${scope.tenantId} AND actor_id=${scope.actorId}
        AND work_item_id=${request.work_item_id}
        AND review_conversation_id=${request.review_conversation_id}
        AND request_id=${`dialogue-${request.request_ref}`}`);
      return turn?.review_turn_id ?? null;
    });
  }

  async bind(
    scope: DialogueScope,
    request: DialogueAssessmentRow,
    turnId: string,
  ) {
    return this.dialogues.transaction(scope, async (db) => {
      const [row] = await db.execute<DialogueAssessmentRow>(
        sql`SELECT * FROM dialogue_assessment_request WHERE request_ref=${request.request_ref}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} FOR UPDATE`,
      );
      if (!row || (row.review_turn_id && row.review_turn_id !== turnId))
        dialogueConflict('DIALOGUE_ASSESSMENT_BINDING_CHANGED');
      if (row.review_turn_id) return;
      const [turn] = await db.execute(
        sql`SELECT review_turn_id FROM review_turn WHERE review_turn_id=${turnId} AND review_conversation_id=${row.review_conversation_id} AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} AND work_item_id=${row.work_item_id} AND request_id=${`dialogue-${row.request_ref}`}`,
      );
      if (!turn) dialogueConflict('DIALOGUE_ASSESSMENT_BINDING_CHANGED');
      await db.execute(
        sql`UPDATE dialogue_assessment_request SET review_turn_id=${turnId},_updated_at=CURRENT_TIMESTAMP WHERE request_ref=${row.request_ref}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId}`,
      );
      const snapshot = JSON.parse(row.input_json) as DialogueAssessmentSnapshot;
      for (const item of snapshot.contributions) {
        await db.execute(sql`UPDATE discussion_contribution SET used_by_json=((used_by_json::jsonb) || ${JSON.stringify([{ reviewTurnId: turnId, workItemId: row.work_item_id, workingRef: null }])}::jsonb)::text,_updated_at=CURRENT_TIMESTAMP
          WHERE contribution_ref=${item.contributionRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId}`);
      }
    });
  }
}
