import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { OfficialOauthLink } from '@client/src/components/OfficialOauthLink';
import { useWorkbenchPanelActive } from '@client/src/features/workbench/RetainedWorkbenchPanel';
import { MessageSquareText, RefreshCw, TriangleAlert } from 'lucide-react';

import { canonicalHost } from '@client/src/api';
import {
  getCanonicalHostClientSessionGeneration,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';
import {
  getHostedRuntimeFingerprint,
  type HostedRuntimeFingerprintResponse,
} from '@client/src/api/runtime-probe';
import { runtimeBuildFingerprint } from '@client/src/config/runtime-build';
import { Button } from '@client/src/components/ui/button';
import type {
  ConfirmReviewActionDraftResponse,
  AppendMatterReviewScope,
  ReviewConversationReadModel,
  ReviewScopeSelection,
  ReviewTurnReadModel,
} from '@shared/api.interface';

import ReviewConversationTurn from './ReviewConversationTurn';
import ReviewAccessUnavailable from './ReviewAccessUnavailable';
import type { ReviewPrimaryMaterial } from './review-materials';
import AssessmentUpdateControl from './AssessmentUpdateControl';
import useReviewDraft, {
  usePendingReviewChat,
  useUnconfirmedReviewChats,
} from './useReviewDraft';
import ReviewChatComposer from './ReviewChatComposer';
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
  discussionMaterial?: ReviewPrimaryMaterial;
  onWorkingRefresh?: () => Promise<void>;
  workItemRevision: number;
  workItemRefreshing?: boolean;
  selectedEvaluationItemId: string | null;
  jobAidIssues?: Array<{ issueKey: string; question: string }>;
  confirmationReceipt: ReviewActionReceipt | null;
  onConfirmationReceipt: (receipt: ReviewActionReceipt) => void;
  onLocateSourceRef: (sourceRef: string) => void;
  onLocateSourceBinding?: (binding: ReviewSourceBinding) => void;
  onWorkItemRefresh: () => Promise<void>;
  materials?: ReviewMaterialsContext;
}

export default function ContinuousReviewPanel(
  props: ContinuousReviewPanelProps,
) {
  const session = useSyncExternalStore(
    subscribeCanonicalHostClientSession,
    getCanonicalHostClientSessionGeneration,
    getCanonicalHostClientSessionGeneration,
  );
  return (
    <ReviewPanel
      key={JSON.stringify([
        session,
        props.workItemId,
        props.reviewScope?.matterId ?? null,
        props.draftScopeKey,
      ])}
      {...props}
    />
  );
}

function ReviewPanel({
  workItemId,
  draftScopeKey,
  reviewScope,
  discussionClaimText,
  discussionMaterial,
  onWorkingRefresh,
  workItemRevision,
  workItemRefreshing = false,
  selectedEvaluationItemId,
  jobAidIssues,
  confirmationReceipt,
  onConfirmationReceipt,
  onLocateSourceRef,
  onLocateSourceBinding,
  onWorkItemRefresh,
  materials,
}: ContinuousReviewPanelProps) {
  const panelActive: boolean = useWorkbenchPanelActive();
  const matterId: string = reviewScope?.matterId ?? '';
  const dialogueMaterial = discussionMaterial ?? materials?.primary;
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
  const scopeKey =
    draftScopeKey ??
    (matterId
      ? `work-item:${workItemId}:matter:${matterId}`
      : `work-item:${workItemId}`);
  const [message, setMessage] = useReviewDraft(scopeKey);
  const [pendingChat, setPendingChat] = usePendingReviewChat(scopeKey);
  const [unconfirmedChats, retainUnconfirmedChat] =
    useUnconfirmedReviewChats(scopeKey);
  const models = useTaskModelOptions();
  const [modelRef, setModelRef] = useState('');
  const [busyAction, setBusyAction] = useState<
    'start' | 'chat' | 'update' | 'close' | 'confirm' | null
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
  const lifecycleEpochRef = useRef(0);
  const presentation = continuousReviewPresentation(conversation);
  const turns = reviewTurnGroups(
    (conversation?.turns ?? []).filter((turn) => turn.purpose !== 'CHAT'),
  );
  const chatTurns = reviewTurnGroups(
    (conversation?.turns ?? []).filter((turn) => turn.purpose === 'CHAT'),
  );
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
        setPendingChat(null);
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
    [setMessage, setPendingChat],
  );

  const readCurrent = useCallback(async (): Promise<void> => {
    const epoch = ++readEpochRef.current;
    const session = getCanonicalHostClientSessionGeneration();
    const current = (): boolean =>
      epoch === readEpochRef.current &&
      session === getCanonicalHostClientSessionGeneration();
    setRefreshing(true);
    clearError();
    try {
      const response = await canonicalHost.reloadReviewConversation(
        workItemId,
        conversationScope,
      );
      if (!current()) return;
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
      if (current()) {
        setReadFailed(true);
        captureError(reason, 'refresh');
      }
    } finally {
      if (current()) setRefreshing(false);
    }
  }, [captureError, clearError, workItemId, conversationScope]);

  useEffect(() => {
    void readCurrent();
  }, [readCurrent, workItemRevision]);

  useEffect(
    () => () => {
      errorEpochRef.current += 1;
      readEpochRef.current += 1;
      lifecycleEpochRef.current += 1;
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
    conversation,
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
  function operationIsCurrent(): () => boolean {
    const epoch = lifecycleEpochRef.current;
    const session = getCanonicalHostClientSessionGeneration();
    return () =>
      epoch === lifecycleEpochRef.current &&
      session === getCanonicalHostClientSessionGeneration();
  }

  async function startOrSync(): Promise<void> {
    if (
      busy ||
      pendingChat ||
      (!presentation.canStartOrSync && presentation.state !== 'CLOSED')
    )
      return;
    const current = operationIsCurrent();
    readEpochRef.current += 1;
    setRefreshing(false);
    setBusyAction('start');
    clearError();
    try {
      const response = await canonicalHost.createOrResumeReviewConversation(
        workItemId,
        conversationScope,
      );
      if (!current()) return;
      assertReviewConversationScope(
        response.conversation,
        workItemId,
        conversationScope,
      );
      setConversation(response.conversation);
      setCurrentRevision(response.conversation.currentWorkItemRevision);
      setReadFailed(false);
    } catch (reason) {
      if (current()) captureError(reason);
    } finally {
      if (current()) setBusyAction(null);
    }
  }

  async function closeConversation(): Promise<void> {
    if (
      matterId ||
      busy ||
      pendingChat ||
      !conversation ||
      conversation.status !== 'ACTIVE'
    )
      return;
    const current = operationIsCurrent();
    setBusyAction('close');
    clearError();
    try {
      const response = await canonicalHost.closeReviewConversation(
        workItemId,
        conversation.reviewConversationId,
      );
      if (!current()) return;
      setConversation(response.conversation);
      setReadFailed(false);
      setConfirmingTurnId(null);
    } catch (reason) {
      if (current()) captureError(reason);
    } finally {
      if (current()) setBusyAction(null);
    }
  }

  async function confirmDraft(turn: ReviewTurnReadModel): Promise<void> {
    if (
      matterId ||
      busy ||
      pendingChat ||
      turn.purpose === 'CHAT' ||
      !conversation ||
      !turn.assistantCandidate?.reviewActionDraft
    ) {
      return;
    }
    const current = operationIsCurrent();
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
      if (!current()) return;
      onConfirmationReceipt(response.reviewAction);
      if (!current()) return;
      setConversation(response.conversation);
      setCurrentRevision(response.reviewAction.workItemRevision);
      setReadFailed(false);
      setConfirmingTurnId(null);
      await onWorkItemRefresh();
    } catch (reason) {
      if (current()) captureError(reason);
    } finally {
      if (current()) setBusyAction(null);
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
    requireExactBinding = false,
  ): void {
    const binding: ReviewSourceBinding | null = reviewSourceBinding(
      turn,
      sourceRef,
    );
    if (binding && onLocateSourceBinding) {
      onLocateSourceBinding(binding);
      return;
    }
    if (!requireExactBinding && binding?.workItemId === workItemId) {
      onLocateSourceRef(binding.originalSourceRefId);
      return;
    }
    if (requireExactBinding || matterId || binding) {
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

  function renderTurn(turn: ReviewTurnReadModel, isCurrent: boolean) {
    return (
      <ReviewConversationTurn
        key={turn.reviewTurnId}
        turn={turn}
        conversation={conversation!}
        currentRevision={currentRevision}
        isCurrent={isCurrent}
        assessmentCurrent={turn.reviewTurnId === assessmentCandidateId}
        formalActionsAllowed={!matterId && turn.purpose !== 'CHAT'}
        busy={busy || Boolean(pendingChat)}
        confirming={confirmingTurnId === turn.reviewTurnId}
        rejected={Boolean(
          turn.assistantCandidate?.reviewActionDraft &&
          rejectedDraftRefs.includes(
            turn.assistantCandidate.reviewActionDraft.reviewActionDraftRef,
          ),
        )}
        onBeginConfirm={() => setConfirmingTurnId(turn.reviewTurnId)}
        onCancelConfirm={() => setConfirmingTurnId(null)}
        onRejectDraft={() => rejectDraft(turn)}
        onConfirm={() => void confirmDraft(turn)}
        onLocateSourceRef={(sourceRef: string) =>
          locateTurnSource(turn, sourceRef)
        }
      />
    );
  }

  const active = presentation.state === 'ACTIVE';
  const canRetainUnconfirmed = Boolean(
    pendingChat &&
    (!conversation ||
      conversation.status === 'CLOSED' ||
      conversation.reviewConversationId !== pendingChat.reviewConversationId ||
      error?.code === 'REVIEW_CONVERSATION_CLOSED' ||
      presentation.state === 'STALE_CONTEXT'),
  );
  const unresolvedReason = !conversation
    ? '当前没有可读取的活动对话。'
    : conversation.reviewConversationId !== pendingChat?.reviewConversationId
      ? '当前已是另一段对话，现有接口不能读取原对话。'
      : conversation.status === 'CLOSED' ||
          error?.code === 'REVIEW_CONVERSATION_CLOSED'
        ? '原对话已关闭，现有读回尚未确认这条发送的结果。'
        : '讨论依据已变化，原样核对仍使用原请求号和原内容。';

  if (accessUnavailable) {
    return (
      <ReviewAccessUnavailable
        error={error}
        refreshing={refreshing}
        onReload={() => void readCurrent()}
      />
    );
  }

  return (
    <section
      className="continuous-review"
      aria-labelledby="continuous-review-title"
    >
      <header className="continuous-review-header">
        <div>
          <span>资料讨论</span>
          <h3 id="continuous-review-title">围绕当前资料继续讨论</h3>
          <p>提出问题、查看答复，并可回到实际原文依据。</p>
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
                disabled={busy || Boolean(pendingChat)}
                onClick={() => void startOrSync()}
              >
                同步到最新版本
              </Button>
            </>
          ) : null}
          {presentation.state === 'CLOSED' ? (
            <Button
              type="button"
              disabled={busy || Boolean(pendingChat)}
              onClick={() => void startOrSync()}
            >
              开始新对话
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="continuous-review-empty">
          <MessageSquareText aria-hidden="true" />
          <div>
            <strong>开始当前资料的对话</strong>
            <p>讨论会自动绑定当前事项版本，不会在浏览器另建状态。</p>
          </div>
          <Button
            type="button"
            data-review-start
            disabled={busy || Boolean(pendingChat)}
            onClick={() => void startOrSync()}
          >
            {refreshing
              ? '正在读取…'
              : busyAction === 'start'
                ? '正在开始…'
                : '开始对话'}
          </Button>
        </div>
      )}

      {canRetainUnconfirmed && pendingChat ? (
        <div className="continuous-review-sync" role="status">
          <div>
            <strong>上次发送结果未知</strong>
            <p>{unresolvedReason}</p>
            <p className="whitespace-pre-wrap break-words">
              原问题：{pendingChat.request.userMessage}
            </p>
            <small>原请求号：{pendingChat.request.requestId}</small>
          </div>
          <Button
            type="button"
            disabled={busy || refreshing}
            onClick={retainUnconfirmedChat}
          >
            保留待核对记录，继续当前对话
          </Button>
        </div>
      ) : null}
      {unconfirmedChats.length ? (
        <details
          className="continuous-review-history"
          aria-label="待核对发送记录"
        >
          <summary>待核对发送记录 · {unconfirmedChats.length}</summary>
          <div>
            {unconfirmedChats.map((intent) => (
              <article
                key={JSON.stringify([
                  intent.reviewConversationId,
                  intent.request.requestId,
                ])}
              >
                <strong>结果未知</strong>
                <p className="whitespace-pre-wrap break-words">
                  {intent.request.userMessage}
                </p>
                <p>原请求号：{intent.request.requestId}</p>
                <p>原对话：{intent.reviewConversationId}</p>
              </article>
            ))}
          </div>
        </details>
      ) : null}
      <div aria-label="资料对话">
        <p className="text-sm text-muted-foreground">
          本页资料：{dialogueMaterial?.title ?? '资料名称未提供'}
          {dialogueMaterial?.versionLabel
            ? ` · ${dialogueMaterial.versionLabel}`
            : ''}
        </p>
        {chatTurns.current ? (
          <div className="continuous-review-turns" aria-label="对话记录">
            {chatTurns.history.length ? (
              <details className="continuous-review-history">
                <summary>较早对话 · {chatTurns.history.length}</summary>
                <div>
                  {chatTurns.history.map((turn) => renderTurn(turn, false))}
                </div>
              </details>
            ) : null}
            {renderTurn(chatTurns.current, true)}
          </div>
        ) : active ? (
          <p className="continuous-review-no-turns">还没有讨论消息。</p>
        ) : null}
        {discussionClaimText ? (
          <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm leading-7">
            本轮围绕：{discussionClaimText}
          </blockquote>
        ) : null}
        {conversation && (active || pendingChat) ? (
          <ReviewChatComposer
            conversation={conversation}
            reviewScope={reviewScope}
            message={message}
            pending={pendingChat}
            onMessageChange={setMessage}
            onPendingChange={setPendingChat}
            disabled={
              busy ||
              hasActiveExecution ||
              readFailed ||
              (!pendingChat && !presentation.composerEnabled)
            }
            editorDisabled={editorDisabled}
            onBusy={(value) => {
              setBusyAction(value ? 'chat' : null);
              if (value) {
                readEpochRef.current += 1;
                setRefreshing(false);
                clearError();
              }
            }}
            onResult={(next) => {
              readEpochRef.current += 1;
              setRefreshing(false);
              setConversation(next);
              setCurrentRevision(next.currentWorkItemRevision);
              setReadFailed(false);
            }}
            onError={captureError}
          />
        ) : null}
      </div>
      <details className="space-y-4">
        <summary className="cursor-pointer text-sm font-medium">
          评估记录与更新
        </summary>
        {workingRefreshError ? <p role="alert">{workingRefreshError}</p> : null}

        {materials ? (
          <ReviewMaterialsPanel
            context={materials}
            turns={conversation?.turns ?? []}
            refreshing={refreshing}
            onLocateSourceRef={(turn, sourceRef) =>
              locateTurnSource(turn, sourceRef, true)
            }
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

        {currentTurn ? (
          <div className="continuous-review-turns" aria-label="评估复核记录">
            {turns.history.length ? (
              <details className="continuous-review-history">
                <summary>历史回合 · {turns.history.length}</summary>
                <div>
                  {turns.history.map((turn) => renderTurn(turn, false))}
                </div>
              </details>
            ) : null}
            <div className="continuous-review-current-label">
              <span>最近评估回合</span>
              <strong>Turn {currentTurn.turnNo}</strong>
            </div>
            {renderTurn(currentTurn, true)}
          </div>
        ) : null}
        {active ? (
          <div className="continuous-review-composer">
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
            {conversation ? (
              <AssessmentUpdateControl
                conversation={conversation}
                reviewScope={reviewScope}
                selectedEvaluationItemId={selectedEvaluationItemId}
                jobAidIssues={jobAidIssues}
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
                  Boolean(pendingChat) ||
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
                  disabled={busy || Boolean(pendingChat)}
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
      </details>

      {error ? (
        <div className="continuous-review-error" role="alert">
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>{error.title}</strong>
            <span>{error.message}</span>
            {error.code === 'OFFICIAL_OAUTH_SESSION_REQUIRED' ? (
              <Button asChild>
                <OfficialOauthLink>连接飞书身份</OfficialOauthLink>
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
