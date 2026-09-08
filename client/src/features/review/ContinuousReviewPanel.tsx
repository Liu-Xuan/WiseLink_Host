import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkbenchPanelActive } from '@client/src/features/workbench/RetainedWorkbenchPanel';
import { useDropzone } from 'react-dropzone';
import {
  FileCheck2,
  FileUp,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  Send,
  TriangleAlert,
  X,
} from 'lucide-react';

import { canonicalHost } from '@client/src/api';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import {
  getHostedRuntimeFingerprint,
  type HostedRuntimeFingerprintResponse,
} from '@client/src/api/runtime-probe';
import { uploadFile } from '@client/src/components/business-ui/api/files/service';
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
  reviewSubmissionIntent,
  type ReviewSubmissionIntent,
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

const MAX_PDF_BYTES = 100 * 1024 * 1024;

interface UploadedReviewSelection {
  bucketId: string;
  filePath: string;
}

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
    onWorkingRefresh,
  );
  const [currentRevision, setCurrentRevision] = useState(workItemRevision);
  const [message, setMessage] = useReviewDraft(draftScopeKey);
  const models = useTaskModelOptions();
  const [modelRef, setModelRef] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadedSelection, setUploadedSelection] =
    useState<UploadedReviewSelection | null>(null);
  const [busyAction, setBusyAction] = useState<
    'start' | 'append' | 'close' | 'confirm' | null
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
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [confirmingTurnId, setConfirmingTurnId] = useState<string | null>(null);
  const [rejectedDraftRefs, setRejectedDraftRefs] = useState<string[]>([]);
  const submissionRef = useRef<ReviewSubmissionIntent | null>(null);
  const errorEpochRef = useRef(0);
  const readEpochRef = useRef(0);
  const presentation = continuousReviewPresentation(conversation);
  const turns = reviewTurnGroups(conversation?.turns ?? []);
  const currentTurn = turns.current;
  const hasActiveExecution = reviewConversationHasActiveExecution(
    conversation?.turns ?? [],
  );
  const sendAutomatically = submissionRef.current
    ? submissionRef.current.executionMode === 'AUTOMATIC'
    : automaticReviewAvailable(conversation);

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
        setFile(null);
        setUploadedSelection(null);
        submissionRef.current = null;
        setActiveRequestId(null);
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

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const selected = acceptedFiles[0] ?? null;
      setUploadedSelection(null);
      submissionRef.current = null;
      setActiveRequestId(null);
      clearError();
      if (!selected) {
        setFile(null);
        setError(
          reviewInputError('REVIEW_PDF_REQUIRED', '请选择一个 PDF 文件。'),
        );
        return;
      }
      if (!selected.name.toLowerCase().endsWith('.pdf')) {
        setFile(null);
        setError(
          reviewInputError(
            'REVIEW_PDF_TYPE_INVALID',
            '当前补充资料入口仅接受 PDF。',
          ),
        );
        return;
      }
      if (selected.size <= 0 || selected.size > MAX_PDF_BYTES) {
        setFile(null);
        setError(
          reviewInputError(
            'REVIEW_PDF_SIZE_INVALID',
            'PDF 不能为空，且文件大小不能超过 100 MB。',
          ),
        );
        return;
      }
      setFile(selected);
    },
    [clearError],
  );

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
  const { getInputProps, getRootProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    disabled: editorDisabled,
    maxFiles: 1,
    multiple: false,
    onDrop,
  });

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

  async function appendTurn(): Promise<void> {
    const userMessage = message.trim();
    if (
      busy ||
      !conversation ||
      conversation.status !== 'ACTIVE' ||
      !conversation.currentRevisionSynced ||
      !userMessage ||
      !models.ready
    ) {
      return;
    }
    setBusyAction('append');
    clearError();
    try {
      const submission = reviewSubmissionIntent(
        submissionRef.current,
        submissionRef.current?.requestId ?? createRequestCorrelationId(),
        conversation,
        modelRef || undefined,
        reviewScope,
      );
      submissionRef.current = submission;
      const requestId = submission.requestId;
      setActiveRequestId(requestId);
      let selection = uploadedSelection;
      if (file && !selection) {
        await canonicalHost.requireOfficialOauthSession();
        const uploaded = await uploadFile(file, {
          filePath: `wiselink/review-input/${requestId}/${safePdfName(file.name)}`,
          contentType: 'application/pdf',
          upsert: false,
        });
        selection = {
          bucketId: uploaded.bucketId,
          filePath: uploaded.filePath,
        };
        setUploadedSelection(selection);
      }
      const response = await canonicalHost.appendReviewTextTurn(
        workItemId,
        conversation.reviewConversationId,
        {
          requestId,
          userMessage,
          ...(submission.modelRef ? { modelRef: submission.modelRef } : {}),
          selectedEvaluationItemId,
          ...(submission.reviewScope
            ? { reviewScope: submission.reviewScope }
            : {}),
          ...(submission.executionMode
            ? { executionMode: submission.executionMode }
            : {}),
          ...(selection ? { attachmentSelection: selection } : {}),
        },
      );
      assertReviewConversationScope(
        response.conversation,
        workItemId,
        conversationScope,
      );
      setConversation(response.conversation);
      setCurrentRevision(response.conversation.currentWorkItemRevision);
      setReadFailed(false);
      setMessage('');
      setModelRef('');
      setFile(null);
      setUploadedSelection(null);
      submissionRef.current = null;
      setActiveRequestId(null);
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
            {matterId
              ? '普通解释保存为讨论；关键纠正和有效材料贡献由 Host 保存为事项工作更新。正式采用与实施决定仍独立处理。'
              : '工程师补充只作为待复核输入；系统返回的依据与动作也都是候选，确认后仍需重新综合。'}
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
            <details className="continuous-review-history">
              <summary>历史回合 · {turns.history.length}</summary>
              <div>
                {turns.history.map((turn) => (
                  <ReviewConversationTurn
                    key={turn.reviewTurnId}
                    turn={turn}
                    conversation={conversation!}
                    currentRevision={currentRevision}
                    isCurrent={false}
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

      {active ? (
        <div className="continuous-review-composer">
          {discussionClaimText ? (
            <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm leading-7">
              本轮围绕：{discussionClaimText}
            </blockquote>
          ) : null}
          <TaskModelPicker
            id="review-model"
            label="新回合模型"
            value={modelRef}
            onChange={setModelRef}
            catalog={models}
            disabled={editorDisabled || submissionRef.current !== null}
            inheritLabel={
              conversation?.defaultModel?.displayName ?? '此事项的模型'
            }
          />
          {submissionRef.current && !busy ? (
            <small>
              提交结果待核对，重试保持本轮模型。编辑内容会开始新请求。
            </small>
          ) : null}
          <label htmlFor="continuous-review-message">
            {hasActiveExecution ? '下一轮指示' : '工程师补充'}
            <span>
              {hasActiveExecution
                ? sendAutomatically
                  ? '指示将保存并在下一轮处理；当前执行不会因此改变'
                  : '本次只保存下一轮输入；当前对象尚未开放自动处理'
                : sendAutomatically
                  ? '消息保存后由系统处理；生成结果仍为待复核候选'
                  : '当前对象未开放自动分析，本次只保存输入'}
            </span>
          </label>
          <Textarea
            id="continuous-review-message"
            value={message}
            maxLength={20_000}
            disabled={editorDisabled}
            placeholder="补充事实、提出疑问，或说明希望核对的判断"
            onChange={(event) => {
              submissionRef.current = null;
              setActiveRequestId(null);
              setMessage(event.target.value);
            }}
          />
          {busyAction === 'append' && activeRequestId ? (
            <div className="continuous-review-generation" role="status">
              <RefreshCw aria-hidden="true" />
              <div>
                <strong>
                  {sendAutomatically
                    ? '正在保存输入与执行请求'
                    : '正在保存补充输入'}
                </strong>
                <span title={activeRequestId}>
                  requestId {shortRequestId(activeRequestId)}
                  ；此阶段不会采纳输入，也不会修改 WorkItem current、revision 或
                  STALE 状态。
                </span>
              </div>
            </div>
          ) : null}
          <div className="continuous-review-compose-row">
            <div
              {...getRootProps({
                className: `continuous-review-drop${
                  isDragActive ? ' is-active' : ''
                }${file ? ' has-file' : ''}`,
                role: 'button',
                'aria-label': file
                  ? `更换补充 PDF，当前为 ${file.name}`
                  : '选择一份补充 PDF',
                'aria-disabled': editorDisabled,
              })}
            >
              <input {...getInputProps()} />
              {file ? (
                <FileCheck2 aria-hidden="true" />
              ) : (
                <Paperclip aria-hidden="true" />
              )}
              <span>{file ? file.name : '附加一份 PDF（可选）'}</span>
            </div>
            {file ? (
              <button
                type="button"
                className="continuous-review-remove-file"
                aria-label="移除补充 PDF"
                disabled={editorDisabled}
                onClick={() => {
                  setFile(null);
                  setUploadedSelection(null);
                  submissionRef.current = null;
                  setActiveRequestId(null);
                }}
              >
                <X aria-hidden="true" />
              </button>
            ) : null}
            <Button
              type="button"
              disabled={
                busy ||
                !presentation.composerEnabled ||
                !message.trim() ||
                !models.ready
              }
              onClick={() => void appendTurn()}
            >
              {file && !uploadedSelection ? (
                <FileUp aria-hidden="true" />
              ) : (
                <Send aria-hidden="true" />
              )}
              {busyAction === 'append'
                ? '正在提交…'
                : hasActiveExecution
                  ? '保存下一轮指示'
                  : sendAutomatically
                    ? '发送并分析'
                    : '保存补充'}
            </Button>
          </div>
          <div className="continuous-review-compose-footer">
            <span>单次最多附加 1 份 PDF，最大 100 MB。</span>
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
              <span>离开页面会保留未发送文字，不会关闭事项。</span>
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
            {activeRequestId ? (
              <small>
                当前输入与 requestId {shortRequestId(activeRequestId)}
                已保留；再次提交会复用同一标识，避免重复回合。
              </small>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function safePdfName(fileName: string): string {
  const base = fileName
    .normalize('NFKD')
    .replace(/\.pdf$/iu, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+/u, '')
    .slice(0, 120)
    .replace(/[^a-z0-9]+$/u, '');
  return `${base || 'review-attachment'}.pdf`;
}

function shortRequestId(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function reviewInputError(
  code: string,
  message: string,
): ReviewOperationErrorPresentation {
  return {
    title: '补充资料不可用',
    message,
    code,
    retryable: null,
    operatorAction: null,
  };
}
