import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ContextualDialogue from '@client/src/features/dialogue/ContextualDialogue';
import { useWorkbenchPanelActive } from '@client/src/features/workbench/RetainedWorkbenchPanel';
import { MessageSquareText, RefreshCw, TriangleAlert } from 'lucide-react';

import { canonicalHost } from '@client/src/api';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import {
  getHostedRuntimeFingerprint,
  type HostedRuntimeFingerprintResponse,
} from '@client/src/api/runtime-probe';
import { runtimeBuildFingerprint } from '@client/src/config/runtime-build';
import { Button } from '@client/src/components/ui/button';
import { Textarea } from '@client/src/components/ui/textarea';
import { createRequestCorrelationId } from '@client/src/utils/request-correlation-id';
import type {
  ConfirmReviewActionDraftResponse,
  AppendMatterReviewScope,
  ReviewConversationReadModel,
  ReviewScopeSelection,
  ReviewTurnReadModel,
} from '@shared/api.interface';

import ReviewConversationTurn from './ReviewConversationTurn';
import AssessmentUpdateControl from './AssessmentUpdateControl';
import useReviewDraft from './useReviewDraft';
import useReviewWorkingRefresh from './useReviewWorkingRefresh';
import {
  assertReviewConversationScope,
  reviewSourceBinding,
  type ReviewSourceBinding,
} from './review-scope';
import TaskModelPicker, { useTaskModelOptions } from './TaskModelPicker';
import ReviewMaterialsPanel, {
  type ReviewMaterialsContext,
} from './ReviewMaterialsPanel';
import { reviewConversationHasActiveExecution } from './review-execution';
import {
  automaticReviewAvailable,
  latestAssessmentCandidateId,
} from './review-submission';
import {
  continuousReviewControls,
  continuousReviewPresentation,
  reviewErrorRevokesReadback,
  reviewOperationErrorPresentation,
  reviewReadbackMessage,
  reviewTurnGroups,
  type ReviewOperationErrorPresentation,
} from './continuous-review-state';

import './continuous-review-panel.css';

type ReviewActionReceipt = ConfirmReviewActionDraftResponse['reviewAction'];

interface ContinuousReviewPanelProps {
  workItemId: string;
  draftScopeKey?: string;
  reviewScope?: AppendMatterReviewScope;
  discussionClaimText?: string;
  onWorkingRefresh?: () => Promise<void>;
  workItemRevision: number;
  workItemRefreshing?: boolean;
  selectedEvaluationItemId: string | null;
  confirmationReceipt: ReviewActionReceipt | null;
  onConfirmationReceipt: (receipt: ReviewActionReceipt) => void;
  onLocateSourceRef: (sourceRef: string) => void;
  onLocateSourceBinding?: (binding: ReviewSourceBinding) => void;
  onWorkItemRefresh: () => Promise<void>;
  materials?: ReviewMaterialsContext;
}

export default function ContinuousReviewPanel({
  workItemId,
  draftScopeKey = `work-item:${workItemId}`,
  reviewScope,
  discussionClaimText,
  onWorkingRefresh,
  workItemRevision,
  workItemRefreshing = false,
  selectedEvaluationItemId,
  confirmationReceipt,
  onConfirmationReceipt,
  onLocateSourceRef,
  onLocateSourceBinding,
  onWorkItemRefresh,
  materials,
}: ContinuousReviewPanelProps) {
  const panelActive: boolean = useWorkbenchPanelActive();
  const matterId: string = reviewScope?.matterId ?? '';
  const conversationScope: ReviewScopeSelection | undefined = useMemo(
    () => (matterId ? { kind: 'ENGINEERING_MATTER', matterId } : undefined),
    [matterId],
  );
  const [conversation, setConversation] =
    useState<ReviewConversationReadModel | null>(null);
  const workingRefreshError: string | null = useReviewWorkingRefresh(
    conversation,
    onWorkingRefresh ?? onWorkItemRefresh,
  );
  const [currentRevision, setCurrentRevision] = useState(workItemRevision);
  const [message, setMessage] = useReviewDraft(draftScopeKey);
  const models = useTaskModelOptions();
  const [modelRef, setModelRef] = useState('');
  const [dialogueOpen, setDialogueOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<
    'start' | 'update' | 'close' | 'confirm' | null
  >(null);
  const [refreshing, setRefreshing] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [error, setError] = useState<ReviewOperationErrorPresentation | null>(
    null,
  );
  const [accessUnavailable, setAccessUnavailable] = useState(false);
  const [errorFingerprint, setErrorFingerprint] =
    useState<HostedRuntimeFingerprintResponse | null>(null);
  const [errorFingerprintReading, setErrorFingerprintReading] = useState(false);
  const [confirmingTurnId, setConfirmingTurnId] = useState<string | null>(null);
  const [rejectedDraftRefs, setRejectedDraftRefs] = useState<string[]>([]);
  const errorEpochRef = useRef(0);
  const readEpochRef = useRef(0);
  const presentation = continuousReviewPresentation(conversation);
  const turns = reviewTurnGroups(conversation?.turns ?? []);
  const currentTurn = turns.current;
  const assessmentCandidateId = latestAssessmentCandidateId(
    conversation?.turns ?? [],
  );
  const hasActiveExecution = reviewConversationHasActiveExecution(
    conversation?.turns ?? [],
  );

  const clearError = useCallback((): void => {
    errorEpochRef.current += 1;
    setError(null);
    setErrorFingerprint(null);
    setErrorFingerprintReading(false);
  }, []);

  const captureError = useCallback(
    (reason: unknown, operation: 'action' | 'refresh' = 'action'): void => {
      if (reviewErrorRevokesReadback(reason)) {
        setConversation(null);
        setMessage('');
        setAccessUnavailable(true);
      }
      const errorEpoch = errorEpochRef.current + 1;
      errorEpochRef.current = errorEpoch;
      setError(reviewOperationErrorPresentation(reason, operation));
      setErrorFingerprint(null);
      setErrorFingerprintReading(true);
      void getHostedRuntimeFingerprint()
        .then((fingerprint) => {
          if (errorEpochRef.current === errorEpoch) {
            setErrorFingerprint(fingerprint);
            setErrorFingerprintReading(false);
          }
        })
        .catch(() => {
          if (errorEpochRef.current === errorEpoch) {
            setErrorFingerprintReading(false);
          }
        });
    },
    [setMessage],
  );

  const readCurrent = useCallback(async (): Promise<void> => {
    const epoch = ++readEpochRef.current;
    const session = getCanonicalHostClientSessionGeneration();
    setRefreshing(true);
    clearError();
    try {
      const response = await canonicalHost.reloadReviewConversation(
        workItemId,
        conversationScope,
      );
      if (
        epoch !== readEpochRef.current ||
        session !== getCanonicalHostClientSessionGeneration()
      )
        return;
      assertReviewConversationScope(
        response.conversation,
        workItemId,
        conversationScope,
      );
      setConversation(response.conversation);
      setCurrentRevision(response.currentWorkItemRevision);
      setAccessUnavailable(false);
      setReadFailed(false);
    } catch (reason) {
      if (epoch === readEpochRef.current) {
        setReadFailed(true);
        captureError(reason, 'refresh');
      }
    } finally {
      if (epoch === readEpochRef.current) setRefreshing(false);
    }
  }, [captureError, clearError, workItemId, conversationScope]);

  useEffect(() => {
    void readCurrent();
  }, [readCurrent, workItemRevision]);

  useEffect(
    () => () => {
      errorEpochRef.current += 1;
      readEpochRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    setCurrentRevision(workItemRevision);
  }, [workItemRevision]);

  useEffect(() => {
    if (
      !panelActive ||
      !hasActiveExecution ||
      conversation?.status !== 'ACTIVE' ||
      busyAction !== null ||
      refreshing ||
      readFailed ||
      error !== null
    ) {
      return;
    }
    const timer = window.setTimeout(() => void readCurrent(), 4_000);
    return () => window.clearTimeout(timer);
  }, [
    panelActive,
    busyAction,
    conversation?.status,
    error,
    hasActiveExecution,
    readCurrent,
    readFailed,
    refreshing,
    turns.current,
  ]);

  const { editorDisabled, actionsDisabled: busy } = continuousReviewControls(
    presentation,
    busyAction !== null,
    refreshing || workItemRefreshing,
    accessUnavailable,
  );
  const readbackMessage: string | null = reviewReadbackMessage(
    refreshing,
    readFailed,
  );
  async function startOrSync(): Promise<void> {
    if (busy || !presentation.canStartOrSync) return;
    setBusyAction('start');
    clearError();
    try {
      const response = await canonicalHost.createOrResumeReviewConversation(
        workItemId,
        conversationScope,
      );
      assertReviewConversationScope(
        response.conversation,
        workItemId,
        conversationScope,
      );
      setConversation(response.conversation);
      setCurrentRevision(response.conversation.currentWorkItemRevision);
      setReadFailed(false);
    } catch (reason) {
      captureError(reason);
    } finally {
      setBusyAction(null);
    }
  }

  async function closeConversation(): Promise<void> {
    if (matterId || busy || !conversation || conversation.status !== 'ACTIVE')
      return;
    setBusyAction('close');
    clearError();
    try {
      const response = await canonicalHost.closeReviewConversation(
        workItemId,
        conversation.reviewConversationId,
      );
      setConversation(response.conversation);
      setReadFailed(false);
      setConfirmingTurnId(null);
    } catch (reason) {
      captureError(reason);
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmDraft(turn: ReviewTurnReadModel): Promise<void> {
    if (
      matterId ||
      busy ||
      !conversation ||
      !turn.assistantCandidate?.reviewActionDraft
    ) {
      return;
    }
    setBusyAction('confirm');
    clearError();
    try {
      const response = await canonicalHost.confirmReviewActionDraft(
        workItemId,
        conversation.reviewConversationId,
        turn.reviewTurnId,
        {
          reviewActionDraftRef:
            turn.assistantCandidate.reviewActionDraft.reviewActionDraftRef,
          expectedRevision:
            turn.assistantCandidate.reviewActionDraft.baseRevision,
        },
      );
      onConfirmationReceipt(response.reviewAction);
      setConversation(response.conversation);
      setCurrentRevision(response.reviewAction.workItemRevision);
      setReadFailed(false);
      setConfirmingTurnId(null);
      await onWorkItemRefresh();
    } catch (reason) {
      captureError(reason);
    } finally {
      setBusyAction(null);
    }
  }

  function rejectDraft(turn: ReviewTurnReadModel): void {
    const draftRef =
      turn.assistantCandidate?.reviewActionDraft?.reviewActionDraftRef;
    if (draftRef) {
      setRejectedDraftRefs((current) =>
        current.includes(draftRef) ? current : [...current, draftRef],
      );
    }
    setConfirmingTurnId(null);
  }

  function locateTurnSource(
    turn: ReviewTurnReadModel,
    sourceRef: string,
  ): void {
    const binding: ReviewSourceBinding | null = reviewSourceBinding(
      turn,
      sourceRef,
    );
    if (binding && onLocateSourceBinding) {
      onLocateSourceBinding(binding);
      return;
    }
    if (binding?.workItemId === workItemId) {
      onLocateSourceRef(binding.originalSourceRefId);
      return;
    }
    if (matterId || binding) {
      setError(
        reviewInputError(
          'REVIEW_SOURCE_BINDING_UNAVAILABLE',
          '未读回这条引用的唯一文档与版本绑定，暂不能定位；不会自动跳到主文档。',
        ),
      );
      return;
    }
    onLocateSourceRef(sourceRef);
  }

  const active = presentation.state === 'ACTIVE';

  if (accessUnavailable) {
    return (
      <section className="continuous-review" aria-label="持续工程复核">
        <p role="alert">当前复核记录不可访问，已清除页面中的讨论与补充材料。</p>
        <Button
          type="button"
          disabled={refreshing}
          onClick={() => void readCurrent()}
        >
          {refreshing ? '正在读取…' : '重新读取'}
        </Button>
      </section>
    );
  }

  return (
    <section
      className="continuous-review"
      aria-labelledby="continuous-review-title"
    >
      <header className="continuous-review-header">
        <div>
          <span>持续工程复核</span>
          <h3 id="continuous-review-title">围绕当前事项继续核对</h3>
          <p>
            自由讨论不会改写当前评估。讨论充分后点击“更新评估”，核对范围后才重算；正式采用与实施决定仍独立处理。
          </p>
        </div>
        <div className="continuous-review-toolbar">
          <span
            className={`continuous-review-state${presentation.stateClassName}`}
            data-state={presentation.state.toLowerCase()}
          >
            {presentation.stateLabel}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void readCurrent()}
          >
            <RefreshCw aria-hidden="true" />
            {refreshing ? '正在读取…' : '重新读取'}
          </Button>
        </div>
      </header>
      {workingRefreshError ? <p role="alert">{workingRefreshError}</p> : null}

      {materials ? (
        <ReviewMaterialsPanel
          context={materials}
          turns={conversation?.turns ?? []}
          refreshing={refreshing}
          onLocateSourceRef={onLocateSourceRef}
        />
      ) : null}

      {confirmationReceipt ? (
        <div className="continuous-review-receipt" role="status">
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>
              复核意见已写入事项版本 {confirmationReceipt.workItemRevision}
            </strong>
            <span>
              {confirmationReceipt.overallStatus === 'STALE'
                ? '原整体意见已标记为需更新；'
                : '当前尚无可更新的整体意见；'}
              仅受影响项目进入下一轮重新综合，尚未执行完成。
            </span>
          </div>
        </div>
      ) : null}

      {conversation ? (
        <div
          className={`continuous-review-sync${refreshing ? ' is-refreshing' : ''}`}
          role="status"
        >
          <div>
            <span>讨论依据</span>
            <strong>
              {readFailed ? '上次读回：讨论版本 ' : '已同步至事项版本 '}
              {conversation.lastSyncedRevision} · 页面事项版本 {currentRevision}
            </strong>
            {readbackMessage ? (
              <small role={readFailed ? 'alert' : undefined}>
                {readbackMessage}
              </small>
            ) : null}
          </div>
          {presentation.state === 'STALE_CONTEXT' ? (
            <>
              <p>
                <strong>{presentation.contextTitle}</strong>
                {presentation.contextMessage}
              </p>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void startOrSync()}
              >
                同步到最新版本
              </Button>
            </>
          ) : null}
        </div>
      ) : (
        <div className="continuous-review-empty">
          <MessageSquareText aria-hidden="true" />
          <div>
            <strong>开始一轮可追溯的工程复核</strong>
            <p>讨论会自动绑定当前事项版本，不会在浏览器另建状态。</p>
          </div>
          <Button
            type="button"
            data-review-start
            disabled={busy}
            onClick={() => void startOrSync()}
          >
            {refreshing
              ? '正在读取…'
              : busyAction === 'start'
                ? '正在开始…'
                : '开始复核讨论'}
          </Button>
        </div>
      )}

      {currentTurn ? (
        <div className="continuous-review-turns" aria-label="复核讨论记录">
          {turns.history.length ? (
            <details
              className="continuous-review-history"
              open={
                currentTurn.purpose === 'CHAT' && Boolean(assessmentCandidateId)
              }
            >
              <summary>历史回合 · {turns.history.length}</summary>
              <div>
                {turns.history.map((turn) => (
                  <ReviewConversationTurn
                    key={turn.reviewTurnId}
                    turn={turn}
                    conversation={conversation!}
                    currentRevision={currentRevision}
                    isCurrent={false}
                    assessmentCurrent={
                      turn.reviewTurnId === assessmentCandidateId
                    }
                    formalActionsAllowed={!matterId}
                    busy={busy}
                    confirming={confirmingTurnId === turn.reviewTurnId}
                    rejected={
                      !!turn.assistantCandidate?.reviewActionDraft &&
                      rejectedDraftRefs.includes(
                        turn.assistantCandidate.reviewActionDraft
                          .reviewActionDraftRef,
                      )
                    }
                    onBeginConfirm={() =>
                      setConfirmingTurnId(turn.reviewTurnId)
                    }
                    onCancelConfirm={() => setConfirmingTurnId(null)}
                    onRejectDraft={() => rejectDraft(turn)}
                    onConfirm={() => void confirmDraft(turn)}
                    onLocateSourceRef={(sourceRef: string) =>
                      locateTurnSource(turn, sourceRef)
                    }
                  />
                ))}
              </div>
            </details>
          ) : null}
          <div className="continuous-review-current-label">
            <span>当前回合</span>
            <strong>Turn {currentTurn.turnNo}</strong>
          </div>
          <ReviewConversationTurn
            key={currentTurn.reviewTurnId}
            turn={currentTurn}
            conversation={conversation!}
            currentRevision={currentRevision}
            isCurrent
            assessmentCurrent={
              currentTurn.reviewTurnId === assessmentCandidateId
            }
            formalActionsAllowed={!matterId}
            busy={busy}
            confirming={confirmingTurnId === currentTurn.reviewTurnId}
            rejected={
              !!currentTurn.assistantCandidate?.reviewActionDraft &&
              rejectedDraftRefs.includes(
                currentTurn.assistantCandidate.reviewActionDraft
                  .reviewActionDraftRef,
              )
            }
            onBeginConfirm={() => setConfirmingTurnId(currentTurn.reviewTurnId)}
            onCancelConfirm={() => setConfirmingTurnId(null)}
            onRejectDraft={() => rejectDraft(currentTurn)}
            onConfirm={() => void confirmDraft(currentTurn)}
            onLocateSourceRef={(sourceRef: string) =>
              locateTurnSource(currentTurn, sourceRef)
            }
          />
        </div>
      ) : conversation ? (
        <p className="continuous-review-no-turns">当前讨论还没有补充内容。</p>
      ) : null}

      {!accessUnavailable && !readFailed && (
        <details
          className="space-y-3"
          onToggle={(event) => {
            if (event.currentTarget.open) setDialogueOpen(true);
          }}
        >
          <summary className="cursor-pointer font-medium">
            与 Aily 讨论当前资料
          </summary>
          {dialogueOpen && (
            <ContextualDialogue
              key={`${workItemId}:${matterId}`}
              document={{
                workItemId,
                label: materials?.primary.title ?? '当前资料',
                documentVersionId: materials?.primary.documentVersionId,
              }}
              assessmentEnabled={!matterId}
            />
          )}
        </details>
      )}

      {active ? (
        <div className="continuous-review-composer">
          {discussionClaimText ? (
            <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm leading-7">
              本轮围绕：{discussionClaimText}
            </blockquote>
          ) : null}
          <TaskModelPicker
            id="review-model"
            label="下次更新评估的模型"
            value={modelRef}
            onChange={setModelRef}
            catalog={models}
            disabled={editorDisabled}
            inheritLabel={
              conversation?.defaultModel?.displayName ?? '此事项的模型'
            }
          />
          {message ? (
            <div className="space-y-2">
              <p>此前未发送的草稿（可复制到上方对话）：</p>
              <Textarea value={message} readOnly />
              <Button variant="ghost" onClick={() => setMessage('')}>
                清除旧草稿
              </Button>
            </div>
          ) : null}
          {conversation ? (
            <AssessmentUpdateControl
              conversation={conversation}
              reviewScope={reviewScope}
              selectedEvaluationItemId={selectedEvaluationItemId}
              modelRef={modelRef || undefined}
              modelLabel={
                models.data?.options.find(
                  (model) => model.modelRef === modelRef,
                )?.displayName ??
                conversation.defaultModel?.displayName ??
                '此事项的模型'
              }
              disabled={
                busy ||
                hasActiveExecution ||
                readFailed ||
                !presentation.composerEnabled ||
                !models.ready ||
                !automaticReviewAvailable(conversation)
              }
              hasUnsentDraft={Boolean(message.trim())}
              materialTitle={materials?.primary.title}
              documentVersionId={materials?.primary.documentVersionId}
              onBusy={(value: boolean) => {
                setBusyAction(value ? 'update' : null);
                if (value) clearError();
              }}
              onResult={(next: ReviewConversationReadModel) => {
                setConversation(next);
                setCurrentRevision(next.currentWorkItemRevision);
                setReadFailed(false);
              }}
              onError={captureError}
            />
          ) : null}
          <div className="continuous-review-compose-footer">
            <span>本页保留评估历史、显式更新与正式采用。</span>
            {!matterId ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void closeConversation()}
              >
                结束本轮讨论
              </Button>
            ) : (
              <span>离开页面不会关闭事项。</span>
            )}
          </div>
        </div>
      ) : presentation.state === 'CLOSED' ? (
        <div className="continuous-review-closed">
          <strong>{presentation.contextTitle}</strong>
          <span>{presentation.contextMessage}</span>
        </div>
      ) : null}

      {error ? (
        <div className="continuous-review-error" role="alert">
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>{error.title}</strong>
            <span>{error.message}</span>
            {error.code === 'OFFICIAL_OAUTH_SESSION_REQUIRED' ? (
              <Button asChild>
                <Link to="/client/oauth/callback">连接飞书身份</Link>
              </Button>
            ) : (
              <dl>
                <div>
                  <dt>错误码</dt>
                  <dd>{error.code ?? 'UNAVAILABLE'}</dd>
                </div>
                <div>
                  <dt>重试语义</dt>
                  <dd>
                    {error.retryable === true
                      ? 'Host 允许原样重试'
                      : error.retryable === false
                        ? 'Host 不允许原样重试'
                        : 'Host 未返回'}
                  </dd>
                </div>
                {error.operatorAction ? (
                  <div>
                    <dt>运维动作</dt>
                    <dd>{error.operatorAction}</dd>
                  </div>
                ) : null}
                {!error.code?.startsWith('REVIEW_PDF_') ? (
                  <>
                    <div>
                      <dt>前端源码</dt>
                      <dd>{runtimeBuildFingerprint.sourceCommit}</dd>
                    </div>
                    <div>
                      <dt>Host 部署</dt>
                      <dd>
                        {errorFingerprintReading
                          ? '正在读取…'
                          : (errorFingerprint?.deployedCommit ?? 'UNAVAILABLE')}
                      </dd>
                    </div>
                    <div>
                      <dt>Release</dt>
                      <dd>
                        {errorFingerprintReading
                          ? '正在读取…'
                          : (errorFingerprint?.releaseId ?? 'UNAVAILABLE')}
                      </dd>
                    </div>
                    <div>
                      <dt>API 合同</dt>
                      <dd>
                        {errorFingerprintReading
                          ? '正在读取…'
                          : (errorFingerprint?.apiContractVersion ??
                            'UNAVAILABLE')}
                      </dd>
                    </div>
                  </>
                ) : null}
              </dl>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
function reviewInputError(
  code: string,
  message: string,
): ReviewOperationErrorPresentation {
  return {
    title: '引用暂不可用',
    message,
    code,
    retryable: null,
    operatorAction: null,
  };
}
