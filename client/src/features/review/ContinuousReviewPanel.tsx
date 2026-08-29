import { useCallback, useEffect, useRef, useState } from 'react';
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
import { uploadFile } from '@client/src/components/business-ui/api/files/service';
import { Button } from '@client/src/components/ui/button';
import { Textarea } from '@client/src/components/ui/textarea';
import { createRequestCorrelationId } from '@client/src/utils/request-correlation-id';
import type {
  ConfirmReviewActionDraftResponse,
  ReviewConversationReadModel,
  ReviewTurnReadModel,
} from '@shared/api.interface';

import ReviewConversationTurn from './ReviewConversationTurn';

import './continuous-review-panel.css';

const MAX_PDF_BYTES = 100 * 1024 * 1024;

interface UploadedReviewSelection {
  bucketId: string;
  filePath: string;
}

type ReviewActionReceipt = ConfirmReviewActionDraftResponse['reviewAction'];

interface ContinuousReviewPanelProps {
  workItemId: string;
  workItemRevision: number;
  confirmationReceipt: ReviewActionReceipt | null;
  onConfirmationReceipt: (receipt: ReviewActionReceipt) => void;
  onLocateSourceRef: (sourceRef: string) => void;
  onWorkItemRefresh: () => Promise<void>;
}

export default function ContinuousReviewPanel({
  workItemId,
  workItemRevision,
  confirmationReceipt,
  onConfirmationReceipt,
  onLocateSourceRef,
  onWorkItemRefresh,
}: ContinuousReviewPanelProps) {
  const [conversation, setConversation] =
    useState<ReviewConversationReadModel | null>(null);
  const [currentRevision, setCurrentRevision] = useState(workItemRevision);
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadedSelection, setUploadedSelection] =
    useState<UploadedReviewSelection | null>(null);
  const [busyAction, setBusyAction] = useState<
    'load' | 'start' | 'append' | 'close' | 'confirm' | null
  >('load');
  const [error, setError] = useState<string | null>(null);
  const [confirmingTurnId, setConfirmingTurnId] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  const readCurrent = useCallback(async (): Promise<void> => {
    setBusyAction('load');
    setError(null);
    try {
      const response = await canonicalHost.reloadReviewConversation(workItemId);
      setConversation(response.conversation);
      setCurrentRevision(response.currentWorkItemRevision);
    } catch (reason) {
      setError(reviewErrorLabel(reason));
    } finally {
      setBusyAction(null);
    }
  }, [workItemId]);

  useEffect(() => {
    void readCurrent();
  }, [readCurrent]);

  useEffect(() => {
    setCurrentRevision(workItemRevision);
  }, [workItemRevision]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selected = acceptedFiles[0] ?? null;
    setUploadedSelection(null);
    requestIdRef.current = null;
    setError(null);
    if (!selected) {
      setFile(null);
      setError('请选择一个 PDF 文件。');
      return;
    }
    if (!selected.name.toLowerCase().endsWith('.pdf')) {
      setFile(null);
      setError('当前补充资料入口仅接受 PDF。');
      return;
    }
    if (selected.size <= 0 || selected.size > MAX_PDF_BYTES) {
      setFile(null);
      setError('PDF 不能为空，且文件大小不能超过 100 MB。');
      return;
    }
    setFile(selected);
  }, []);

  const busy = busyAction !== null;
  const { getInputProps, getRootProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    disabled: busy || conversation?.currentRevisionSynced !== true,
    maxFiles: 1,
    multiple: false,
    onDrop,
  });

  async function startOrSync(): Promise<void> {
    if (busy) return;
    setBusyAction('start');
    setError(null);
    try {
      const response =
        await canonicalHost.createOrResumeReviewConversation(workItemId);
      setConversation(response.conversation);
      setCurrentRevision(response.conversation.currentWorkItemRevision);
    } catch (reason) {
      setError(reviewErrorLabel(reason));
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
      !userMessage
    ) {
      return;
    }
    setBusyAction('append');
    setError(null);
    try {
      const requestId = requestIdRef.current ?? createRequestCorrelationId();
      requestIdRef.current = requestId;
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
          ...(selection ? { attachmentSelection: selection } : {}),
        },
      );
      setConversation(response.conversation);
      setCurrentRevision(response.conversation.currentWorkItemRevision);
      setMessage('');
      setFile(null);
      setUploadedSelection(null);
      requestIdRef.current = null;
    } catch (reason) {
      setError(reviewErrorLabel(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function closeConversation(): Promise<void> {
    if (busy || !conversation || conversation.status !== 'ACTIVE') return;
    setBusyAction('close');
    setError(null);
    try {
      const response = await canonicalHost.closeReviewConversation(
        workItemId,
        conversation.reviewConversationId,
      );
      setConversation(response.conversation);
      setConfirmingTurnId(null);
    } catch (reason) {
      setError(reviewErrorLabel(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmDraft(turn: ReviewTurnReadModel): Promise<void> {
    if (busy || !conversation || !turn.assistantCandidate?.reviewActionDraft) {
      return;
    }
    setBusyAction('confirm');
    setError(null);
    try {
      const response = await canonicalHost.confirmReviewActionDraft(
        workItemId,
        conversation.reviewConversationId,
        turn.reviewTurnId,
      );
      onConfirmationReceipt(response.reviewAction);
      setConversation(response.conversation);
      setCurrentRevision(response.reviewAction.workItemRevision);
      setConfirmingTurnId(null);
      await onWorkItemRefresh();
    } catch (reason) {
      setError(reviewErrorLabel(reason));
    } finally {
      setBusyAction(null);
    }
  }

  const active = conversation?.status === 'ACTIVE';
  const synced = conversation?.currentRevisionSynced === true;

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
            工程师补充只作为待复核输入；系统返回的依据与动作也都是候选，确认后仍需重新综合。
          </p>
        </div>
        <div className="continuous-review-toolbar">
          <span
            className={`continuous-review-state${active ? ' is-active' : ''}`}
          >
            {active ? '讨论进行中' : conversation ? '本轮已结束' : '尚未开始'}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void readCurrent()}
          >
            <RefreshCw aria-hidden="true" />
            重新读取
          </Button>
        </div>
      </header>

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
        <div className="continuous-review-sync" role="status">
          <div>
            <span>讨论依据</span>
            <strong>
              已同步至事项版本 {conversation.lastSyncedRevision} · 当前版本{' '}
              {currentRevision}
            </strong>
          </div>
          {!synced && active ? (
            <>
              <p>事项已有更新，请先同步讨论上下文再继续补充。</p>
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
            disabled={busy}
            onClick={() => void startOrSync()}
          >
            {busyAction === 'start' ? '正在开始…' : '开始复核讨论'}
          </Button>
        </div>
      )}

      {conversation?.turns.length ? (
        <div className="continuous-review-turns" aria-label="复核讨论记录">
          {conversation.turns.map((turn) => (
            <ReviewConversationTurn
              key={turn.reviewTurnId}
              turn={turn}
              conversation={conversation}
              currentRevision={currentRevision}
              busy={busy}
              confirming={confirmingTurnId === turn.reviewTurnId}
              onBeginConfirm={() => setConfirmingTurnId(turn.reviewTurnId)}
              onCancelConfirm={() => setConfirmingTurnId(null)}
              onConfirm={() => void confirmDraft(turn)}
              onLocateSourceRef={onLocateSourceRef}
            />
          ))}
        </div>
      ) : conversation ? (
        <p className="continuous-review-no-turns">当前讨论还没有补充内容。</p>
      ) : null}

      {active ? (
        <div className="continuous-review-composer">
          <label htmlFor="continuous-review-message">
            工程师补充
            <span>将作为候选输入保存，提交成功不代表已被结论采纳</span>
          </label>
          <Textarea
            id="continuous-review-message"
            value={message}
            maxLength={20_000}
            disabled={busy || !synced}
            placeholder="补充事实、提出疑问，或说明希望核对的判断"
            onChange={(event) => {
              requestIdRef.current = null;
              setMessage(event.target.value);
            }}
          />
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
                'aria-disabled': busy || !synced,
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
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  setUploadedSelection(null);
                  requestIdRef.current = null;
                }}
              >
                <X aria-hidden="true" />
              </button>
            ) : null}
            <Button
              type="button"
              disabled={busy || !synced || !message.trim()}
              onClick={() => void appendTurn()}
            >
              {file && !uploadedSelection ? (
                <FileUp aria-hidden="true" />
              ) : (
                <Send aria-hidden="true" />
              )}
              {busyAction === 'append' ? '正在提交…' : '提交补充'}
            </Button>
          </div>
          <div className="continuous-review-compose-footer">
            <span>单次最多附加 1 份 PDF，最大 100 MB。</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void closeConversation()}
            >
              结束本轮讨论
            </Button>
          </div>
        </div>
      ) : conversation?.status === 'CLOSED' ? (
        <div className="continuous-review-restart">
          <span>
            已保留本轮记录。需要继续时会从事项当前版本开始新一轮讨论。
          </span>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void startOrSync()}
          >
            开始新一轮复核
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="continuous-review-error" role="alert">
          <TriangleAlert aria-hidden="true" />
          {error}
        </p>
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

function reviewErrorLabel(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/LOGIN|IDENTITY|OAUTH|UNAUTHORIZED|401/iu.test(message)) {
    return '请先完成飞书授权，再继续当前复核。';
  }
  if (/NOT_FOUND|FORBIDDEN|403|404/iu.test(message)) {
    return '当前事项或复核讨论不可用，请返回资料库重新进入。';
  }
  if (/REVISION|STALE|CONFLICT|409/iu.test(message)) {
    return '事项已经更新，请重新读取并同步到最新版本。';
  }
  if (/ATTACHMENT/iu.test(message)) {
    return '补充资料未能受控接入，请保留文件并重试。';
  }
  if (/BROWSER_RANDOM_UUID_UNAVAILABLE/iu.test(message)) {
    return '当前浏览器缺少安全请求标识能力，请使用受支持的飞书客户端或浏览器。';
  }
  return '本次复核操作未完成，请保留当前输入后重试。';
}
