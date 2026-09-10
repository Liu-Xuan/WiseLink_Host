import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  DialogueContributionKind,
  DialogueMessagePurpose,
  DialogueOrigin,
  DialogueWorkingContext,
} from '@shared/dialogue.interface';
import {
  EngineeringMatterWorkingRepository,
  type EngineeringMatterWorkingDatabaseExecutor,
} from './engineering-matter-working.repository';
import { selectDialogueText } from './dialogue-excerpt-selection';
import { dialogueConflict, dialogueNotFound } from './dialogue-validation';

export interface DialogueScope {
  tenantId: string;
  actorId: string;
}
export interface DialogueThreadRow extends Record<string, unknown> {
  thread_ref: string;
  tenant_id: string;
  actor_id: string;
  revision: number;
  focus_json: string;
  request_json: string;
}
export interface DialogueMessageRow extends Record<string, unknown> {
  message_ref: string;
  thread_ref: string;
  request_key: string;
  thread_revision: number;
  user_text: string;
  origin: DialogueOrigin;
  origin_json: string;
  focus_json: string;
  context_json: string;
  purpose: DialogueMessagePurpose;
  executor: 'AILY' | 'NONE';
  _created_at: Date | string;
  query_ref: string | null;
  query_status: string | null;
  answer_text: string | null;
  error_code: string | null;
  remote_session_id: string | null;
  query_session_id: string | null;
}
export interface DialogueContributionRow extends Record<string, unknown> {
  contribution_ref: string;
  thread_ref: string;
  message_ref: string;
  work_item_id: string;
  revision: number;
  source_part: 'USER' | 'ASSISTANT';
  selected_text: string;
  kind: DialogueContributionKind;
  status: 'ACTIVE' | 'WITHDRAWN';
  supersedes_ref: string | null;
  used_by_json: string;
  selection_json: string;
  request_key: string;
  withdraw_request_key: string | null;
  _created_at: Date | string;
}
export interface DialogueGenerationContext {
  generationQuery: string;
  contextWorkItemIds: string[];
  focus: DialogueWorkingContext[];
  historyMessageRefs: string[];
  earlierMessagesOmitted: boolean;
  remoteSessionId?: string;
}

@Injectable()
export class DialogueRepository {
  constructor(private readonly actors: EngineeringMatterWorkingRepository) {}

  transaction<T>(
    scope: DialogueScope,
    work: (db: EngineeringMatterWorkingDatabaseExecutor) => Promise<T>,
  ) {
    return this.actors.withActorTransaction(scope.actorId, ({ database }) =>
      work(database),
    );
  }

  async list(
    scope: DialogueScope,
    before?: string,
  ): Promise<Array<{ threadRef: string; createdAt: string }>> {
    return this.transaction(scope, async (db) => {
      const rows = await db.execute<{
        thread_ref: string;
        _created_at: string;
      }>(sql`
        SELECT thread_ref, _created_at FROM dialogue_thread
        WHERE tenant_id=${scope.tenantId} AND actor_id=${scope.actorId}
        ${
          before
            ? sql`AND (_created_at, thread_ref) < (
          SELECT _created_at, thread_ref FROM dialogue_thread
          WHERE thread_ref=${before}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId}
        )`
            : sql``
        }
        ORDER BY _created_at DESC, thread_ref DESC LIMIT 50`);
      return rows.map((row) => ({
        threadRef: row.thread_ref,
        createdAt: new Date(row._created_at).toISOString(),
      }));
    });
  }

  async create(
    scope: DialogueScope,
    requestKey: string,
    workItemIds: string[],
  ) {
    const requestJson = JSON.stringify({ workItemIds });
    return this.transaction(scope, async (db) => {
      const [created] =
        await db.execute<DialogueThreadRow>(sql`INSERT INTO dialogue_thread(thread_ref,tenant_id,actor_id,request_key,request_json,focus_json)
        VALUES (${randomUUID()}::uuid,${scope.tenantId},${scope.actorId},${requestKey},${requestJson},${JSON.stringify(workItemIds)})
        ON CONFLICT (tenant_id,actor_id,request_key) DO NOTHING RETURNING *`);
      if (created) return created;
      const [existing] = await db.execute<DialogueThreadRow>(
        sql`SELECT * FROM dialogue_thread WHERE tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} AND request_key=${requestKey}`,
      );
      if (!existing || existing.request_json !== requestJson)
        dialogueConflict('DIALOGUE_REQUEST_REPLAY_CONFLICT');
      return existing;
    });
  }

  async read(
    scope: DialogueScope,
    threadRef: string,
    beforeMessageRef?: string,
  ): Promise<{
    thread: DialogueThreadRow;
    messages: DialogueMessageRow[];
    contributions: DialogueContributionRow[];
    nextMessageCursor: string | null;
  }> {
    return this.transaction(scope, async (db) => {
      const thread = await this.thread(db, scope, threadRef);
      let beforeRevision: number | undefined;
      if (beforeMessageRef) {
        const before = await this.message(
          db,
          scope,
          threadRef,
          beforeMessageRef,
        );
        beforeRevision = before.thread_revision;
      }
      const messages =
        await db.execute<DialogueMessageRow>(sql`SELECT m.*,q.query_ref,q.status AS query_status,q.answer_text,q.error_code,q.remote_session_id,q.session_id AS query_session_id
        FROM dialogue_message m LEFT JOIN review_aily_query q ON q.message_ref=m.message_ref AND q.tenant_id=m.tenant_id AND q.actor_id=m.actor_id
        WHERE m.thread_ref=${threadRef}::uuid AND m.tenant_id=${scope.tenantId} AND m.actor_id=${scope.actorId}
        ${beforeRevision === undefined ? sql`` : sql`AND m.thread_revision < ${beforeRevision}`}
        ORDER BY m.thread_revision DESC LIMIT 41`);
      const contributions =
        await db.execute<DialogueContributionRow>(sql`SELECT * FROM discussion_contribution
        WHERE thread_ref=${threadRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} ORDER BY _created_at,contribution_ref`);
      const page = messages.slice(0, 40);
      return {
        thread,
        messages: page.reverse(),
        contributions,
        nextMessageCursor: messages.length > 40 ? page[0].message_ref : null,
      };
    });
  }

  async relevantContributions(
    scope: DialogueScope,
    workItemIds: string[],
  ): Promise<DialogueContributionRow[]> {
    if (!workItemIds.length) return [];
    return this.transaction(scope, (db) =>
      db.execute<DialogueContributionRow>(sql`SELECT * FROM discussion_contribution
      WHERE tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} AND status='ACTIVE'
      AND work_item_id IN (${sql.join(
        workItemIds.map((id) => sql`${id}`),
        sql`, `,
      )}) ORDER BY _created_at,contribution_ref`),
    );
  }

  async contributionContext(
    scope: DialogueScope,
    row: DialogueContributionRow,
  ) {
    return this.transaction(scope, async (db) => {
      const source = await this.message(
        db,
        scope,
        row.thread_ref,
        row.message_ref,
      );
      const [previous] =
        await db.execute<DialogueMessageRow>(sql`SELECT m.*,q.query_ref,q.status AS query_status,q.answer_text,q.error_code,q.remote_session_id,q.session_id AS query_session_id
        FROM dialogue_message m LEFT JOIN review_aily_query q ON q.message_ref=m.message_ref AND q.tenant_id=m.tenant_id AND q.actor_id=m.actor_id
        WHERE m.thread_ref=${row.thread_ref}::uuid AND m.tenant_id=${scope.tenantId} AND m.actor_id=${scope.actorId}
        AND m.thread_revision < ${source.thread_revision} ORDER BY m.thread_revision DESC LIMIT 1`);
      return previous ? [previous, source] : [source];
    });
  }

  async findReplay(
    scope: DialogueScope,
    threadRef: string,
    requestKey: string,
  ) {
    return this.transaction(scope, async (db) => {
      await this.thread(db, scope, threadRef);
      const [row] =
        await db.execute<DialogueMessageRow>(sql`SELECT m.* FROM dialogue_message m
        WHERE thread_ref=${threadRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} AND request_key=${requestKey}`);
      return row ?? null;
    });
  }

  async readMessage(
    scope: DialogueScope,
    threadRef: string,
    messageRef: string,
  ) {
    return this.transaction(scope, (db) =>
      this.message(db, scope, threadRef, messageRef),
    );
  }

  async append(
    scope: DialogueScope,
    input: {
      threadRef: string;
      requestKey: string;
      expectedRevision: number;
      userText: string;
      origin: DialogueOrigin;
      originDetails: Record<string, unknown>;
      focusIds: string[];
      purpose: DialogueMessagePurpose;
      context: DialogueGenerationContext;
    },
  ) {
    return this.transaction(scope, async (db) => {
      const thread = await this.thread(db, scope, input.threadRef, true);
      const [existing] = await db.execute<DialogueMessageRow>(
        sql`SELECT * FROM dialogue_message WHERE thread_ref=${input.threadRef}::uuid AND request_key=${input.requestKey} AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId}`,
      );
      if (existing) return { message: existing, replayed: true };
      if (thread.revision !== input.expectedRevision) dialogueConflict();
      if (input.purpose === 'CHAT') {
        const [pending] = await db.execute<{
          message_ref: string;
        }>(sql`SELECT m.message_ref FROM dialogue_message m LEFT JOIN review_aily_query q ON q.message_ref=m.message_ref
          WHERE m.thread_ref=${input.threadRef}::uuid AND m.tenant_id=${scope.tenantId} AND m.actor_id=${scope.actorId} AND m.executor='AILY'
          AND (q.query_ref IS NULL OR q.status IN ('STARTING','RUNNING')) LIMIT 1`);
        if (pending) dialogueConflict('DIALOGUE_MESSAGE_IN_PROGRESS');
      }
      const revision = thread.revision + 1;
      const [message] =
        await db.execute<DialogueMessageRow>(sql`INSERT INTO dialogue_message
        (message_ref,thread_ref,tenant_id,actor_id,request_key,thread_revision,user_text,origin,origin_json,focus_json,context_json,purpose,executor)
        VALUES (${randomUUID()}::uuid,${input.threadRef}::uuid,${scope.tenantId},${scope.actorId},${input.requestKey},${revision},${input.userText},${input.origin},${JSON.stringify(input.originDetails)},${JSON.stringify(input.focusIds)},${JSON.stringify(input.context)},${input.purpose},${input.purpose === 'CHAT' ? 'AILY' : 'NONE'}) RETURNING *`);
      await db.execute(sql`UPDATE dialogue_thread SET revision=${revision},focus_json=${JSON.stringify(input.focusIds)},_updated_at=CURRENT_TIMESTAMP
        WHERE thread_ref=${input.threadRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} AND revision=${thread.revision}`);
      return { message, replayed: false };
    });
  }

  async saveContribution(
    scope: DialogueScope,
    input: {
      threadRef: string;
      requestKey: string;
      expectedRevision: number;
      messageRef: string;
      sourcePart: 'USER' | 'ASSISTANT';
      selection: { start: number; end: number };
      workItemId: string;
      kind: DialogueContributionKind;
      supersedesRef?: string;
    },
  ) {
    return this.transaction(scope, async (db) => {
      const thread = await this.thread(db, scope, input.threadRef, true);
      const [existing] = await db.execute<DialogueContributionRow>(
        sql`SELECT * FROM discussion_contribution WHERE thread_ref=${input.threadRef}::uuid AND request_key=${input.requestKey} AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId}`,
      );
      if (existing) {
        const selection = JSON.parse(existing.selection_json) as {
          start: number;
          end: number;
        };
        if (
          existing.message_ref !== input.messageRef ||
          existing.work_item_id !== input.workItemId ||
          existing.source_part !== input.sourcePart ||
          existing.kind !== input.kind ||
          existing.supersedes_ref !== (input.supersedesRef ?? null) ||
          selection.start !== input.selection.start ||
          selection.end !== input.selection.end
        )
          dialogueConflict('DIALOGUE_REQUEST_REPLAY_CONFLICT');
        return existing;
      }
      if (thread.revision !== input.expectedRevision) dialogueConflict();
      const message = await this.message(
        db,
        scope,
        input.threadRef,
        input.messageRef,
      );
      const original =
        input.sourcePart === 'USER'
          ? message.user_text
          : message.query_status === 'COMPLETED'
            ? message.answer_text
            : null;
      if (original === null || input.selection.end > original.length)
        dialogueConflict('DIALOGUE_SELECTION_UNAVAILABLE');
      let selectedText: string;
      try {
        selectedText = selectDialogueText(original, input.selection);
      } catch {
        throw new BadRequestException('DIALOGUE_SELECTION_INVALID');
      }
      if (!selectedText.trim()) dialogueConflict('DIALOGUE_SELECTION_EMPTY');
      if (input.supersedesRef) {
        const [old] =
          await db.execute<DialogueContributionRow>(sql`SELECT * FROM discussion_contribution
          WHERE contribution_ref=${input.supersedesRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} AND work_item_id=${input.workItemId} FOR UPDATE`);
        if (!old || old.status !== 'ACTIVE')
          dialogueConflict('DIALOGUE_CONTRIBUTION_CHANGED');
        await db.execute(sql`UPDATE discussion_contribution SET status='WITHDRAWN',revision=revision+1,withdraw_request_key=${input.requestKey},_updated_at=CURRENT_TIMESTAMP
          WHERE contribution_ref=${input.supersedesRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId}`);
      }
      const [created] =
        await db.execute<DialogueContributionRow>(sql`INSERT INTO discussion_contribution
        (contribution_ref,thread_ref,message_ref,tenant_id,actor_id,request_key,work_item_id,source_part,selected_text,selection_json,kind,supersedes_ref)
        VALUES (${randomUUID()}::uuid,${input.threadRef}::uuid,${input.messageRef}::uuid,${scope.tenantId},${scope.actorId},${input.requestKey},${input.workItemId},${input.sourcePart},${selectedText},${JSON.stringify({ ...input.selection, ...(input.sourcePart === 'ASSISTANT' ? { queryRef: message.query_ref, derivedAnswer: true } : {}) })},${input.kind},${input.supersedesRef ?? null}::uuid) RETURNING *`);
      await db.execute(
        sql`UPDATE dialogue_thread SET revision=revision+1,_updated_at=CURRENT_TIMESTAMP WHERE thread_ref=${input.threadRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId}`,
      );
      return created;
    });
  }

  async withdraw(
    scope: DialogueScope,
    threadRef: string,
    contributionRef: string,
    requestKey: string,
    revision: number,
  ) {
    return this.transaction(scope, async (db) => {
      await this.thread(db, scope, threadRef, true);
      const [row] =
        await db.execute<DialogueContributionRow>(sql`SELECT * FROM discussion_contribution WHERE contribution_ref=${contributionRef}::uuid
        AND thread_ref=${threadRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} FOR UPDATE`);
      if (!row) dialogueNotFound();
      if (row.status === 'WITHDRAWN' && row.withdraw_request_key === requestKey)
        return row;
      if (row.status !== 'ACTIVE' || row.revision !== revision)
        dialogueConflict('DIALOGUE_CONTRIBUTION_CHANGED');
      const [updated] =
        await db.execute<DialogueContributionRow>(sql`UPDATE discussion_contribution SET status='WITHDRAWN',revision=revision+1,withdraw_request_key=${requestKey},_updated_at=CURRENT_TIMESTAMP
        WHERE contribution_ref=${contributionRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} AND revision=${revision} RETURNING *`);
      await db.execute(
        sql`UPDATE dialogue_thread SET revision=revision+1,_updated_at=CURRENT_TIMESTAMP WHERE thread_ref=${threadRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId}`,
      );
      return updated;
    });
  }

  private async thread(
    db: EngineeringMatterWorkingDatabaseExecutor,
    scope: DialogueScope,
    threadRef: string,
    lock = false,
  ) {
    const [thread] = await db.execute<DialogueThreadRow>(
      sql`SELECT * FROM dialogue_thread WHERE thread_ref=${threadRef}::uuid AND tenant_id=${scope.tenantId} AND actor_id=${scope.actorId} ${lock ? sql`FOR UPDATE` : sql``}`,
    );
    if (!thread) dialogueNotFound();
    return thread;
  }
  private async message(
    db: EngineeringMatterWorkingDatabaseExecutor,
    scope: DialogueScope,
    threadRef: string,
    messageRef: string,
  ) {
    const [message] =
      await db.execute<DialogueMessageRow>(sql`SELECT m.*,q.query_ref,q.status AS query_status,q.answer_text,q.error_code,q.remote_session_id,q.session_id AS query_session_id
      FROM dialogue_message m LEFT JOIN review_aily_query q ON q.message_ref=m.message_ref AND q.tenant_id=m.tenant_id AND q.actor_id=m.actor_id
      WHERE m.message_ref=${messageRef}::uuid AND m.thread_ref=${threadRef}::uuid AND m.tenant_id=${scope.tenantId} AND m.actor_id=${scope.actorId}`);
    if (!message) dialogueNotFound();
    return message;
  }
}
