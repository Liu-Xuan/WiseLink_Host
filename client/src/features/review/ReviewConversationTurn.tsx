import { Link2, RefreshCw } from 'lucide-react';

import { Button } from '@client/src/components/ui/button';
import type {
  ReviewConversationReadModel,
  ReviewTurnReadModel,
  ReviewTurnResponseType,
} from '@shared/api.interface';

interface ReviewConversationTurnProps {
  turn: ReviewTurnReadModel;
  conversation: ReviewConversationReadModel;
  currentRevision: number;
  busy: boolean;
  confirming: boolean;
  onBeginConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirm: () => void;
  onLocateSourceRef: (sourceRef: string) => void;
}

export default function ReviewConversationTurn(
  props: ReviewConversationTurnProps,
) {
  const candidate = props.turn.assistantCandidate;
  const draft = candidate?.reviewActionDraft ?? null;
  const draftCurrent =
    props.conversation.currentRevisionSynced &&
    draft?.baseRevision === props.currentRevision;

  return (
    <article className="continuous-review-turn">
      <div className="continuous-review-input">
        <header>
          <strong>工程师补充</strong>
          <span>
            事项版本 {props.turn.inputRevision} ·{' '}
            {formatReviewTime(props.turn.createdAt)}
          </span>
        </header>
        <p>{props.turn.engineerSuppliedInput.text}</p>
        <small>
          候选输入，尚未采纳
          {props.turn.engineerSuppliedInput.attachmentRefs.length
            ? ` · 已附 ${props.turn.engineerSuppliedInput.attachmentRefs.length} 份受控资料`
            : ''}
        </small>
      </div>

      {candidate ? (
        <div className="continuous-review-candidate">
          <header>
            <strong>{responseTypeLabel(candidate.responseType)}</strong>
            <span>待工程师复核</span>
          </header>
          <p>{candidate.answer}</p>
          {candidate.sourceRefs.length ? (
            <div className="continuous-review-sources">
              <span>原文依据</span>
              {candidate.sourceRefs.map((sourceRef, index) => (
                <button
                  type="button"
                  key={sourceRef}
                  onClick={() => props.onLocateSourceRef(sourceRef)}
                >
                  <Link2 aria-hidden="true" />
                  原文依据 {index + 1}
                </button>
              ))}
            </div>
          ) : null}
          {candidate.candidateEvidenceRefs.length ? (
            <p className="continuous-review-evidence-count">
              已形成 {candidate.candidateEvidenceRefs.length}{' '}
              条候选依据，确认前不会写入正式判断。
            </p>
          ) : null}
          {candidate.missingInputs.length ? (
            <div className="continuous-review-missing">
              <strong>仍需补充</strong>
              <ul>
                {candidate.missingInputs.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {draft ? (
            <div className="continuous-review-draft">
              <header>
                <div>
                  <span>待确认复核草稿</span>
                  <strong>
                    预计影响 {draft.affectedItemIds.length || 1} 个评估项
                  </strong>
                </div>
                <span>基于事项版本 {draft.baseRevision}</span>
              </header>
              {draft.assumptions.length ? (
                <div>
                  <span>确认前提</span>
                  <ul>
                    {draft.assumptions.map((item, index) => (
                      <li key={`${index}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {!draftCurrent ? (
                <p className="continuous-review-draft-stale">
                  事项版本已经变化，请同步后重新形成草稿。
                </p>
              ) : props.confirming ? (
                <div className="continuous-review-confirm">
                  <p>
                    确认会新增一版工程师复核记录，把整体意见标记为需更新，并仅安排受影响项目重新综合；不会立即得到完成结果。
                  </p>
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={props.busy}
                      onClick={props.onCancelConfirm}
                    >
                      取消
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={props.busy}
                      onClick={props.onConfirm}
                    >
                      {props.busy ? '正在确认…' : '确认写入复核意见'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={props.busy}
                  onClick={props.onBeginConfirm}
                >
                  检查并确认草稿
                </Button>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="continuous-review-pending" role="status">
          <RefreshCw aria-hidden="true" />
          <span>候选答复尚未形成，请稍后重新读取当前讨论。</span>
        </div>
      )}
    </article>
  );
}

function responseTypeLabel(type: ReviewTurnResponseType): string {
  const labels: Record<ReviewTurnResponseType, string> = {
    ANSWER: '候选答复',
    CLARIFYING_QUESTION: '需要进一步澄清',
    SOURCE_LINK: '原文定位建议',
    CANDIDATE_EVIDENCE: '候选依据',
    REVIEW_ACTION_DRAFT: '待确认复核草稿',
    INPUT_REQUEST: '补充输入请求',
    AFFECTED_ITEMS_PREVIEW: '影响范围预览',
    RESYNTHESIS_RESULT: '重新综合候选',
    TASK_STATUS: '处理状态',
  };
  return labels[type];
}

function formatReviewTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间待同步';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
