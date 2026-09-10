import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  DialogueContributionReadModel,
  DialogueMessageReadModel,
  DialogueThreadReadModel,
} from '@shared/dialogue.interface';
import {
  SessionResolver,
  type ResolvedSession,
} from '../identity/session-resolver.service';
import {
  DialogueRepository,
  type DialogueContributionRow,
  type DialogueGenerationContext,
  type DialogueMessageRow,
} from './dialogue.repository';
import {
  DialogueContextService,
  dialogueContextWorkItemIds,
} from './dialogue-context.service';
import { ReviewAilyService } from './review-aily.service';
import { normalizeDialogueOriginDetails } from './dialogue-excerpt-selection';
import {
  dialogueConflict,
  dialogueId,
  dialogueObject,
  dialogueRevision,
  dialogueText,
  dialogueWorkItemIds,
} from './dialogue-validation';

@Injectable()
export class DialogueService {
  constructor(
    private readonly sessions: SessionResolver,
    private readonly repository: DialogueRepository,
    private readonly context: DialogueContextService,
    private readonly aily: ReviewAilyService,
  ) {}

  async list(request: Request, before?: string, workItemValue?: string) {
    const session = await this.session(request);
    const workItemId =
      workItemValue === undefined ? undefined : dialogueText(workItemValue, 96);
    if (workItemId) await this.context.authorize(session, [workItemId]);
    return this.repository.list(
      scope(session),
      before === undefined ? undefined : dialogueId(before),
      workItemId,
    );
  }

  async create(body: unknown, request: Request) {
    const session = await this.session(request);
    const input = dialogueObject(body, ['requestId', 'workItemIds']);
    const ids = dialogueWorkItemIds(input.workItemIds ?? []);
    await this.context.authorize(session, ids);
    const thread = await this.repository.create(
      scope(session),
      dialogueText(input.requestId, 200),
      ids,
    );
    return this.readFor(session, thread.thread_ref);
  }

  async read(threadRef: string, request: Request, before?: string) {
    return this.readFor(
      await this.session(request),
      dialogueId(threadRef),
      before === undefined ? undefined : dialogueId(before),
    );
  }

  async currentContext(
    threadValue: string,
    workItemValue: string,
    request: Request,
  ) {
    const session = await this.session(request);
    await this.repository.read(scope(session), dialogueId(threadValue));
    return this.context.current(session, [dialogueText(workItemValue, 96)]);
  }

  async append(threadValue: string, body: unknown, request: Request) {
    const session = await this.session(request);
    const threadRef = dialogueId(threadValue);
    const input = dialogueObject(body, [
      'requestId',
      'expectedThreadRevision',
      'userText',
      'workItemIds',
      'purpose',
      'origin',
      'originDetails',
    ]);
    const requestKey = dialogueText(input.requestId, 200);
    const expectedRevision = dialogueRevision(input.expectedThreadRevision);
    const userText = dialogueText(input.userText, 20_000);
    const origin = input.origin ?? 'HOST';
    const purpose =
      input.purpose ??
      (origin === 'FEISHU_EXCERPT' ? 'CONTRIBUTION_ONLY' : 'CHAT');
    if (purpose !== 'CHAT' && purpose !== 'CONTRIBUTION_ONLY')
      throw new BadRequestException('DIALOGUE_PURPOSE_INVALID');
    if (origin !== 'HOST' && origin !== 'FEISHU_EXCERPT')
      throw new BadRequestException('DIALOGUE_ORIGIN_INVALID');
    let originDetails: ReturnType<typeof normalizeDialogueOriginDetails>;
    try {
      originDetails = normalizeDialogueOriginDetails(input.originDetails);
    } catch {
      throw new BadRequestException('DIALOGUE_ORIGIN_INVALID');
    }
    if (origin === 'HOST' && Object.keys(originDetails).length)
      throw new BadRequestException('DIALOGUE_ORIGIN_INVALID');
    const state = await this.repository.read(scope(session), threadRef);
    const replay = await this.repository.findReplay(
      scope(session),
      threadRef,
      requestKey,
    );
    const focusIds = dialogueWorkItemIds(
      input.workItemIds ??
        JSON.parse(replay?.focus_json ?? state.thread.focus_json),
    );
    await this.authorizeMessages(session, state.messages);
    await this.settleMessages(session, state.messages);
    await this.context.authorize(session, focusIds);
    const assertReplay = (message: DialogueMessageRow) => {
      if (
        message.user_text !== userText ||
        message.purpose !== purpose ||
        message.origin !== origin ||
        message.origin_json !== JSON.stringify(originDetails) ||
        message.focus_json !== JSON.stringify(focusIds)
      )
        dialogueConflict('DIALOGUE_REQUEST_REPLAY_CONFLICT');
    };
    if (replay) assertReplay(replay);
    if (replay) await this.authorizeMessages(session, [replay]);
    const generation = replay
      ? (JSON.parse(replay.context_json) as DialogueGenerationContext)
      : this.context.generation(
          userText,
          await this.context.current(session, focusIds),
          state.messages,
        );
    if (generation.generationQuery.length > 60_000)
      throw new BadRequestException('DIALOGUE_CONTEXT_TOO_LARGE');
    if (purpose === 'CHAT' && !replay) {
      const available = await this.aily.availability(scope(session));
      if (!available.available)
        throw new BadRequestException(available.reason ?? 'AILY_UNAVAILABLE');
    }
    const saved =
      replay ??
      (
        await this.repository.append(scope(session), {
          threadRef,
          requestKey,
          expectedRevision,
          userText,
          origin,
          originDetails,
          focusIds,
          purpose,
          context: generation,
        })
      ).message;
    assertReplay(saved);
    await this.authorizeMessages(session, [saved]);
    if (purpose === 'CHAT') {
      // Use the first persisted generation input even when another request won the race.
      const persisted = JSON.parse(
        saved.context_json,
      ) as DialogueGenerationContext;
      const existing = await this.repository.readMessage(
        scope(session),
        threadRef,
        saved.message_ref,
      );
      if (!existing?.query_ref)
        await this.aily.startMessage(scope(session), {
          messageRef: saved.message_ref,
          requestKey,
          query: persisted.generationQuery,
          remoteSessionId: persisted.remoteSessionId,
        });
    }
    return this.readFor(session, threadRef);
  }

  async contribute(threadValue: string, body: unknown, request: Request) {
    const session = await this.session(request);
    const threadRef = dialogueId(threadValue);
    const input = dialogueObject(body, [
      'requestId',
      'expectedThreadRevision',
      'messageRef',
      'sourcePart',
      'selection',
      'workItemId',
      'kind',
      'supersedesContributionRef',
    ]);
    const workItemId = dialogueText(input.workItemId, 96);
    const kind = input.kind;
    if (
      kind !== 'QUESTION' &&
      kind !== 'HYPOTHESIS' &&
      kind !== 'CORRECTION' &&
      kind !== 'CONSTRAINT' &&
      kind !== 'CLARIFICATION'
    )
      throw new BadRequestException('DIALOGUE_CONTRIBUTION_KIND_INVALID');
    if (input.sourcePart !== 'USER' && input.sourcePart !== 'ASSISTANT')
      throw new BadRequestException('DIALOGUE_SELECTION_INVALID');
    const selection = dialogueObject(input.selection, ['start', 'end']);
    if (
      !Number.isSafeInteger(selection.start) ||
      !Number.isSafeInteger(selection.end) ||
      Number(selection.start) < 0 ||
      Number(selection.end) <= Number(selection.start)
    )
      throw new BadRequestException('DIALOGUE_SELECTION_INVALID');
    const state = await this.repository.read(scope(session), threadRef);
    await this.authorizeMessages(session, state.messages);
    await this.authorizeMessages(session, [
      await this.repository.readMessage(
        scope(session),
        threadRef,
        dialogueId(input.messageRef),
      ),
    ]);
    await this.context.authorize(session, [workItemId]);
    await this.repository.saveContribution(scope(session), {
      threadRef,
      requestKey: dialogueText(input.requestId, 200),
      expectedRevision: dialogueRevision(input.expectedThreadRevision),
      messageRef: dialogueId(input.messageRef),
      sourcePart: input.sourcePart,
      selection: { start: Number(selection.start), end: Number(selection.end) },
      workItemId,
      kind,
      supersedesRef:
        input.supersedesContributionRef === undefined
          ? undefined
          : dialogueId(input.supersedesContributionRef),
    });
    return this.readFor(session, threadRef);
  }

  async withdraw(
    threadValue: string,
    contributionValue: string,
    body: unknown,
    request: Request,
  ) {
    const session = await this.session(request);
    const threadRef = dialogueId(threadValue);
    const input = dialogueObject(body, ['requestId', 'expectedRevision']);
    await this.repository.withdraw(
      scope(session),
      threadRef,
      dialogueId(contributionValue),
      dialogueText(input.requestId, 200),
      dialogueRevision(input.expectedRevision),
    );
    return this.readFor(session, threadRef);
  }

  async resume(threadValue: string, messageValue: string, request: Request) {
    const session = await this.session(request);
    const threadRef = dialogueId(threadValue);
    const row = await this.repository.readMessage(
      scope(session),
      threadRef,
      dialogueId(messageValue),
    );
    await this.authorizeMessages(session, [row]);
    if (row.purpose !== 'CHAT')
      throw new BadRequestException('DIALOGUE_NOT_A_CHAT');
    if (!row.query_ref) {
      const context = JSON.parse(row.context_json) as DialogueGenerationContext;
      await this.aily.startMessage(scope(session), {
        messageRef: row.message_ref,
        requestKey: row.request_key,
        query: context.generationQuery,
        remoteSessionId: context.remoteSessionId,
      });
    }
    return this.readFor(session, threadRef);
  }

  private async readFor(
    session: ResolvedSession,
    threadRef: string,
    before?: string,
  ): Promise<DialogueThreadReadModel> {
    const state = await this.repository.read(scope(session), threadRef, before);
    const focusWorkItemIds = JSON.parse(state.thread.focus_json) as string[];
    await this.context.authorize(session, [
      ...focusWorkItemIds,
      ...state.contributions.map((row) => row.work_item_id),
    ]);
    await this.authorizeMessages(session, state.messages);
    for (const contribution of state.contributions) {
      await this.authorizeMessages(
        session,
        await this.repository.contributionContext(scope(session), contribution),
      );
    }
    await this.settleMessages(session, state.messages);
    return {
      threadRef,
      revision: state.thread.revision,
      audience: 'PRIVATE',
      focusWorkItemIds,
      messages: state.messages.map(messageModel),
      contributions: state.contributions.map(contributionModel),
      aily: await this.aily.availability(scope(session)),
      nextMessageCursor: state.nextMessageCursor,
    };
  }

  private async settleMessages(
    session: ResolvedSession,
    messages: DialogueMessageRow[],
  ) {
    for (const row of messages) {
      if (
        row.query_ref &&
        (row.query_status === 'STARTING' || row.query_status === 'RUNNING')
      ) {
        const result = await this.aily.resultMessage(
          scope(session),
          row.message_ref,
          row.query_ref,
        );
        row.query_status = result.status;
        row.answer_text = result.answer;
        row.error_code = result.error;
      }
    }
  }

  private async authorizeMessages(
    session: ResolvedSession,
    messages: DialogueMessageRow[],
  ) {
    await this.context.authorize(
      session,
      messages.flatMap(dialogueContextWorkItemIds),
    );
  }
  private async session(request: Request) {
    const session = await this.sessions.resolve(request);
    if (!session) throw new UnauthorizedException('IDENTITY_SESSION_REQUIRED');
    return session;
  }
}

function scope(session: ResolvedSession) {
  return {
    tenantId: session.actor.tenantId,
    actorId: session.actor.canonicalSubject.id,
    sessionId: session.session.id,
  };
}
function messageModel(row: DialogueMessageRow): DialogueMessageReadModel {
  return {
    messageRef: row.message_ref,
    threadRef: row.thread_ref,
    userText: row.user_text,
    origin: row.origin,
    provenance:
      row.origin === 'HOST' ? 'HOST_USER_INPUT' : 'USER_SUBMITTED_EXCERPT',
    originDetails: JSON.parse(row.origin_json),
    focus: (JSON.parse(row.context_json) as DialogueGenerationContext).focus,
    purpose: row.purpose,
    executor: row.executor,
    receivedAt: new Date(row._created_at).toISOString(),
    threadRevision: row.thread_revision,
    response: row.query_ref
      ? {
          queryRef: row.query_ref,
          status: row.query_status as NonNullable<
            DialogueMessageReadModel['response']
          >['status'],
          answer: row.answer_text,
          error: row.error_code,
          incomplete: row.query_status !== 'COMPLETED',
        }
      : null,
  };
}
function contributionModel(
  row: DialogueContributionRow,
): DialogueContributionReadModel {
  return {
    contributionRef: row.contribution_ref,
    threadRef: row.thread_ref,
    messageRef: row.message_ref,
    sourcePart: row.source_part,
    selectedText: row.selected_text,
    workItemId: row.work_item_id,
    kind: row.kind,
    revision: row.revision,
    status: row.status,
    supersedesRef: row.supersedes_ref,
    audience: 'PRIVATE',
    createdAt: new Date(row._created_at).toISOString(),
    usedBy: JSON.parse(row.used_by_json),
    consumedWorkingRef: row.consumed_working_ref ?? null,
  };
}
