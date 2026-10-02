import type { ReviewConversationReadModel, ReviewTurnReadModel } from '@shared/api.interface';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import { assertReviewConversationScope } from '@client/src/features/review/review-scope';

/** Only fresh authorized Host reads may supply these immutable work objects. */
export type WikiSavedWork =
  | { kind: 'ENGINEERING_MATTER'; revision: EngineeringMatterWorkingRevisionReadModel }
  | { kind: 'WORK_ITEM'; revision: JobAidWorkRevision };
export type WikiWorkMode = 'CURRENT' | 'HISTORICAL';

/** A registered source choice, never an inferred first/primary document. */
export interface WikiTimelineSource {
  label: string;
  documentVersionId: string;
  parseRunId?: string | null;
  candidateRevision?: number;
  runRef?: string;
}

export interface WikiWorkSaveEvent {
  id: string;
  subjectKind: WikiSavedWork['kind'];
  subjectId: string;
  workRef: string;
  revision: number;
  savedAt: string | null;
  changeSummary: string;
  updateLabel: string;
  /** Database identity; deliberately not compared with a Review operationRef. */
  actionAttemptId: string | null;
  sourceReviewTurnId: string | null;
  documentVersionIds: string[];
  receipts: Array<{
    reviewTurnId: string;
    operationRef: string;
    completedAt: string | null;
  }>;
}

/** Preserve recorded time and timezone; absent/invalid time stays unknown. */
export function wikiStoredTime(value: string | null | undefined): string | null {
  const parts = value?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u);
  if (!parts || !value || !Number.isFinite(Date.parse(value))) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    hour < 24 && minute < 60 && second < 60 ? value : null;
}

export function wikiWorkIdentity(work: WikiSavedWork): string {
  const r = work.revision;
  return JSON.stringify(work.kind === 'ENGINEERING_MATTER'
    ? [work.kind, (r as EngineeringMatterWorkingRevisionReadModel).matterId,
      (r as EngineeringMatterWorkingRevisionReadModel).matterWorkRevisionId,
      (r as EngineeringMatterWorkingRevisionReadModel).workingRevision]
    : [work.kind, (r as JobAidWorkRevision).workItemId,
      (r as JobAidWorkRevision).workRevisionRef, (r as JobAidWorkRevision).workRevision]);
}

function eligibleTurn(turn: ReviewTurnReadModel): boolean {
  return turn.purpose === 'UPDATE_ASSESSMENT' && !!turn.assistantCandidate &&
    (!turn.execution || turn.execution.status === 'SUCCEEDED');
}

/**
 * A presentation of one persisted save, not a new event store or full history.
 * A receipt enriches that save only when its DTO names the same immutable work.
 */
export function buildWikiRecentChanges(
  work: WikiSavedWork | null,
  mode: WikiWorkMode,
  conversation: ReviewConversationReadModel | null = null,
): { events: WikiWorkSaveEvent[]; receiptNotice: string | null } {
  if (!work) return { events: [], receiptNotice: null };
  let event: WikiWorkSaveEvent;
  if (work.kind === 'ENGINEERING_MATTER') {
    const r = work.revision;
    event = {
      id: wikiWorkIdentity(work), subjectKind: work.kind, subjectId: r.matterId,
      workRef: r.matterWorkRevisionId, revision: r.workingRevision,
      savedAt: wikiStoredTime(r.createdAt), changeSummary: r.changeSummary,
      updateLabel: r.updateKind === 'CORRECTION' ? '更正工作已保存'
        : r.updateKind === 'MATERIAL_INCORPORATION' ? '材料核查工作已保存' : '工作已保存',
      actionAttemptId: r.source?.actionAttemptId ?? null,
      sourceReviewTurnId: r.source?.reviewTurnId ?? null,
      documentVersionIds: [...new Set([...r.state.substantiveInputs,
        ...r.state.coverage.map(item => item.binding)].map(item => item.documentVersionId))],
      receipts: [],
    };
  } else {
    const r = work.revision;
    event = {
      id: wikiWorkIdentity(work), subjectKind: work.kind, subjectId: r.workItemId,
      workRef: r.workRevisionRef, revision: r.workRevision,
      savedAt: wikiStoredTime(r.createdAt), changeSummary: r.content.changeSummary,
      updateLabel: '工作已保存', actionAttemptId: r.actionAttemptId,
      sourceReviewTurnId: null, documentVersionIds: [r.documentVersionId], receipts: [],
    };
  }
  if (mode === 'HISTORICAL') return {
    events: [event], receiptNotice: '只显示选定历史工作的保存记录；未读取当前讨论回执。',
  };
  if (!conversation) return { events: [event], receiptNotice: '该工作的关联回执未取得。' };
  // The caller uses the guarded current actor GET; this mapper also rejects mixed scopes.
  assertReviewConversationScope(conversation,
    work.kind === 'WORK_ITEM' ? work.revision.workItemId : conversation.workItemId,
    work.kind === 'WORK_ITEM' ? { kind: 'WORK_ITEM' }
      : { kind: 'ENGINEERING_MATTER', matterId: work.revision.matterId });
  if (work.kind === 'ENGINEERING_MATTER') return {
    events: [event],
    // The existing Matter DTO has no workRef or DB-attempt/operation mapping.
    // resultRef may be an older retained Overall and is not this work's identity.
    receiptNotice: '该工作的关联回执未取得：现有事项回执未提供确切工作引用。',
  };
  const r = work.revision;
  const receipts = conversation.turns.filter(turn => {
    const receipt = turn.assistantCandidate?.jobAidWorkingUpdate;
    return eligibleTurn(turn) && receipt?.status === 'APPLIED' &&
      receipt.workRevisionRef === r.workRevisionRef && receipt.workRevision === r.workRevision &&
      turn.inputRevision === r.basedOnWorkItemRevision &&
      r.requestId === `review-turn:${turn.reviewTurnId}`;
  }).map(turn => ({ reviewTurnId: turn.reviewTurnId,
    operationRef: turn.assistantCandidate!.actionAttemptRef,
    completedAt: wikiStoredTime(turn.assistantCandidate!.completedAt) }));
  const unique = new Map<string, (typeof receipts)[number]>();
  for (const receipt of receipts) {
    const prior = unique.get(receipt.reviewTurnId);
    if (prior && (prior.operationRef !== receipt.operationRef || prior.completedAt !== receipt.completedAt))
      return { events: [event], receiptNotice: '关联回执身份冲突，未合并到该工作。' };
    unique.set(receipt.reviewTurnId, receipt);
  }
  event.receipts = [...unique.values()];
  return { events: [event], receiptNotice: event.receipts.length ? null : '该工作的关联回执未取得。' };
}

/** Existing work DTOs do not persist activity candidate/run ownership. */
export function wikiSourceBlocker(mode: WikiWorkMode, source: WikiTimelineSource): string | null {
  if (mode === 'HISTORICAL')
    return '该历史工作未提供可核对归属的来源活动候选绑定；不会读取最新候选。';
  if (!/^[A-Za-z0-9_-]{1,96}$/u.test(source.documentVersionId)) return '登记来源的文档版本不合法。';
  return null;
}
