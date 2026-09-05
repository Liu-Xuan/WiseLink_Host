import { CheckCircle2, Link2, RefreshCw } from 'lucide-react';

import { Button } from '@client/src/components/ui/button';
import type {
  ReviewConversationReadModel,
  ReviewDecisionMaturity,
  ReviewTurnReadModel,
  ReviewTurnResponseType,
  ReviewUncertaintyDispositionKind,
} from '@shared/api.interface';
import { reviewSourceRefLabel } from './continuous-review-state';
import ReviewExecutionStatus from './ReviewExecutionStatus';

interface ReviewConversationTurnBaseProps {
  turn: ReviewTurnReadModel;
  conversation: ReviewConversationReadModel;
  currentRevision: number;
  isCurrent: boolean;
}

interface ReviewConversationTurnActions {
  busy: boolean;
  confirming: boolean;
  rejected: boolean;
  onBeginConfirm: () => void;
  onCancelConfirm: () => void;
  onRejectDraft: () => void;
  onConfirm: () => void;
  onLocateSourceRef: (sourceRef: string) => void;
}

type ReviewConversationTurnProps = ReviewConversationTurnBaseProps &
  ({ readOnly: true } | ({ readOnly?: false } & ReviewConversationTurnActions));

export default function ReviewConversationTurn(
  props: ReviewConversationTurnProps,
) {
  const interactive: ReviewConversationTurnActions | null =
    !props.readOnly && 'onConfirm' in props ? props : null;
  const candidate = props.turn.assistantCandidate;
  const draft = candidate?.reviewActionDraft ?? null;
  const snapshot = draft?.decisionSnapshot ?? null;
  const dispositions = draft?.uncertaintyDispositions ?? [];
  const draftCurrent =
    interactive !== null &&
    props.isCurrent &&
    props.conversation.status === 'ACTIVE' &&
    props.conversation.currentRevisionSynced &&
    draft?.baseRevision === props.currentRevision;

  return (
    <article
      className={`continuous-review-turn${props.isCurrent ? ' is-current' : ' is-history'}`}
      data-generation-state={candidate ? 'candidate-ready' : 'not-read-back'}
    >
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
          {props.readOnly ? '已保存的工程师输入' : '候选输入，尚未采纳'}
          {props.turn.engineerSuppliedInput.attachmentRefs.length
            ? ` · 已附 ${props.turn.engineerSuppliedInput.attachmentRefs.length} 份受控资料`
            : ''}
        </small>
      </div>

      <ReviewExecutionStatus turn={props.turn} />

      {candidate ? (
        <div className="continuous-review-candidate">
          <header>
            <strong>{responseTypeLabel(candidate.responseType)}</strong>
            <span>
              <CheckCircle2 aria-hidden="true" />
              {props.readOnly ? '已保存候选 · 仅供追溯' : '候选已生成 · 未采纳'}
            </span>
          </header>
          <p>{candidate.answer}</p>
          {candidate.sourceRefs.length ? (
            <SourceRefButtons
              label="原文依据"
              sourceRefs={candidate.sourceRefs}
              onLocateSourceRef={interactive?.onLocateSourceRef}
            />
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
                <span>
                  {interactive?.rejected
                    ? '已拒绝，未写入'
                    : `基于事项版本 ${draft.baseRevision}`}
                </span>
              </header>
              <div>
                <span>修改范围</span>
                <ul>
                  <li>当前绑定：Host current 事项版本 {draft.baseRevision}</li>
                  <li>
                    拟写入：{draft.evaluationItemId} → {draft.proposedStatus}
                  </li>
                  <li>
                    Overall：{draft.overallImpact ? '需要重新综合' : '不受影响'}
                  </li>
                </ul>
              </div>
              {draft.sourceRefs.length || draft.adoptedInputRefs.length ? (
                <div>
                  <span>使用的证据与输入</span>
                  {draft.sourceRefs.length ? (
                    <SourceRefButtons
                      label="草稿 SourceRef"
                      sourceRefs={draft.sourceRefs}
                      onLocateSourceRef={interactive?.onLocateSourceRef}
                    />
                  ) : null}
                  <ul>
                    {draft.adoptedInputRefs.map((item) => (
                      <li key={`input-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
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
              {dispositions.length ? (
                <div>
                  <span>剩余不确定性的处置</span>
                  <ul>
                    {dispositions.map((item) => (
                      <li key={item.gapRef}>
                        {item.gapRef} · {dispositionLabel(item.disposition)}：
                        {item.rationale}
                        {item.reviewBy
                          ? `；复核日期 ${formatReviewTime(item.reviewBy)}`
                          : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {snapshot ? (
                <div>
                  <span>Decision Snapshot</span>
                  <ul>
                    <li>当前最佳判断：{snapshot.currentBestJudgment}</li>
                    <li>
                      判断成熟度：{maturityLabel(snapshot.decisionMaturity)}
                    </li>
                    <li>
                      评估时点：{formatReviewTime(snapshot.assessmentAsOf)}
                    </li>
                    {snapshot.reviewBy ? (
                      <li>再次复核：{formatReviewTime(snapshot.reviewBy)}</li>
                    ) : null}
                    {snapshot.residualUncertainties.map((item) => (
                      <li key={`uncertainty-${item}`}>剩余未知：{item}</li>
                    ))}
                    {snapshot.controlsAndMitigations.map((item) => (
                      <li key={`control-${item}`}>控制措施：{item}</li>
                    ))}
                    {snapshot.reopenTriggers.map((item) => (
                      <li key={`reopen-${item}`}>重开条件：{item}</li>
                    ))}
                    {snapshot.whatWouldChangeDecision.map((item) => (
                      <li key={`change-${item}`}>结论改变条件：{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {!interactive ? (
                <p className="continuous-review-draft-stale">
                  已保存草稿仅供追溯；当前只读展示不提供确认或采用操作。
                </p>
              ) : interactive.rejected ? (
                <p className="continuous-review-draft-stale">
                  此草稿已在当前页面拒绝；没有修改 Host
                  current，也没有推进事项版本。继续对话可形成新草稿。
                </p>
              ) : !props.isCurrent ? (
                <p className="continuous-review-draft-stale">
                  历史回合草稿仅供追溯；请在当前回合核对并显式确认最新草稿。
                </p>
              ) : !draftCurrent ? (
                <p className="continuous-review-draft-stale">
                  事项版本已经变化，请同步后重新形成草稿。
                </p>
              ) : interactive.confirming ? (
                <div className="continuous-review-confirm">
                  <p>
                    确认会新增一版工程师复核记录，把整体意见标记为需更新，并仅安排受影响项目重新综合；不会立即得到完成结果。
                  </p>
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={interactive.busy}
                      onClick={interactive.onCancelConfirm}
                    >
                      继续对话调整
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={interactive.busy}
                      onClick={interactive.onRejectDraft}
                    >
                      拒绝草案
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={interactive.busy}
                      onClick={interactive.onConfirm}
                    >
                      {interactive.busy ? '正在确认…' : '确认修改'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={interactive.busy}
                  onClick={interactive.onBeginConfirm}
                >
                  查看详细差异
                </Button>
              )}
            </div>
          ) : null}
          <footer className="continuous-review-candidate-runtime">
            <span>
              候选阶段没有采纳输入，也不会修改 WorkItem current、revision 或
              STALE 状态。
            </span>
            <span title={candidate.actionAttemptRef}>
              Attempt {shortRef(candidate.actionAttemptRef)} · Model{' '}
              {candidate.provenance.modelVersion} · Skill{' '}
              {candidate.provenance.skillVersion} ·{' '}
              {formatReviewTime(candidate.completedAt)}
            </span>
            {candidate.warnings.length ? (
              <span>提示：{candidate.warnings.join('；')}</span>
            ) : null}
          </footer>
        </div>
      ) : (
        <div className="continuous-review-pending" role="status">
          <RefreshCw aria-hidden="true" />
          <div>
            <strong>候选尚未读回</strong>
            <span>
              工程师输入已经记录，候选结果尚未返回。
              保存输入不会自动采用意见，WorkItem current、revision 与 STALE
              状态均未因此改变。
            </span>
          </div>
        </div>
      )}
    </article>
  );
}

function SourceRefButtons({
  label,
  sourceRefs,
  onLocateSourceRef,
}: {
  label: string;
  sourceRefs: string[];
  onLocateSourceRef?: (sourceRef: string) => void;
}) {
  return (
    <div className="continuous-review-sources">
      <span>{label}</span>
      {sourceRefs.map((sourceRef, index) => (
        <button
          type="button"
          key={`${index}-${sourceRef}`}
          title={
            onLocateSourceRef ? sourceRef : `原文暂时无法读取 · ${sourceRef}`
          }
          disabled={!onLocateSourceRef}
          onClick={() => onLocateSourceRef?.(sourceRef)}
        >
          <Link2 aria-hidden="true" />
          {reviewSourceRefLabel(sourceRef, index)}
        </button>
      ))}
    </div>
  );
}

function shortRef(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function dispositionLabel(value: ReviewUncertaintyDispositionKind): string {
  const labels: Record<ReviewUncertaintyDispositionKind, string> = {
    RESOLVE_NOW: '立即补证',
    ACCEPT_WITH_ASSUMPTION: '接受假设',
    APPLY_CONSERVATIVE_BOUND: '采用保守边界',
    MITIGATE_AND_MONITOR: '控制并监控',
    DEFER_TO_REVIEW_DATE: '延期复核',
    PROFESSIONAL_JUDGMENT: '专业判断',
    OUT_OF_CURRENT_SCOPE: '当前范围外',
    LIFECYCLE_NOT_REACHED: '生命周期未到',
    RESOLVED_BY_EVIDENCE: '证据已解决',
    NOT_APPLICABLE: '不适用',
  };
  return labels[value];
}

function maturityLabel(value: ReviewDecisionMaturity): string {
  const labels: Record<ReviewDecisionMaturity, string> = {
    PRELIMINARY: '初步判断',
    REVIEWABLE: '可复核',
    CONFIRMABLE: '可有条件确认',
    DEFERRED_WITH_MONITORING: '延期并监控',
  };
  return labels[value];
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
