import { useEffect, useRef, useState } from 'react';
import type {
  DocumentUploadRequest,
  DocumentUploadResponse,
} from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import {
  uploadLibraryDocument,
  confirmLibraryHistoricalImport,
  refreshLibraryHistoricalImport,
  getCanonicalHostClientSessionGeneration,
} from '@client/src/api/canonical-host';
import { DocumentUploadPicker } from './DocumentUploadPicker';
import { DocumentUploadReceipt } from './DocumentUploadReceipt';

export function DocumentUpload({
  disabled,
  onRefresh,
}: {
  disabled: boolean;
  onRefresh: () => void;
}) {
  const [receipt, setReceipt] = useState<DocumentUploadResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmationBlocked, setConfirmationBlocked] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function accept(next: DocumentUploadResponse) {
    setReceipt(next);
    setConfirmationBlocked(false);
    setDeclined(false);
    setError(null);
    if (next.status === 'COMMITTED') onRefresh();
  }

  async function upload(input: DocumentUploadRequest): Promise<void> {
    const generation = getCanonicalHostClientSessionGeneration();
    const next = await uploadLibraryDocument(input);
    if (
      mounted.current &&
      generation === getCanonicalHostClientSessionGeneration()
    )
      accept(next);
  }

  async function historical(action: 'confirm' | 'refresh'): Promise<void> {
    if (
      disabled ||
      inFlight.current ||
      !receipt?.historicalImport ||
      (action === 'confirm' && (confirmationBlocked || declined))
    )
      return;
    const candidate = receipt.historicalImport;
    const generation = getCanonicalHostClientSessionGeneration();
    const current = () =>
      mounted.current &&
      generation === getCanonicalHostClientSessionGeneration();
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const next =
        action === 'refresh'
          ? await refreshLibraryHistoricalImport(candidate.preflightId)
          : await confirmLibraryHistoricalImport(candidate.preflightId, {
              confirmed: true,
              expectedCurrentGeneration: candidate.expectedCurrentGeneration,
              expectedCurrentDocumentVersionId:
                candidate.expectedCurrentDocumentVersionId,
            });
      if (current()) accept(next);
    } catch (reason: unknown) {
      if (!current()) return;
      setConfirmationBlocked(true);
      setError(
        `历史版本操作未确认：${reason instanceof Error ? reason.message : '请求失败'}。请先刷新待导入信息，再核对并重新确认。`,
      );
    } finally {
      inFlight.current = false;
      if (current()) setBusy(false);
    }
  }

  return (
    <details className="library-document-upload">
      <summary>上传文档到资料库</summary>
      <p className="library-classification-note">
        上传本人有权使用的
        PDF。文档管理会核对重复文件、文档族和修订关系；旧版导入需单独确认。
      </p>
      <DocumentUploadPicker
        disabled={disabled || busy}
        onSubmit={upload}
        onReset={() => {
          setReceipt(null);
          setConfirmationBlocked(false);
          setDeclined(false);
          setError(null);
        }}
      />
      {receipt ? <DocumentUploadReceipt receipt={receipt} /> : null}
      {receipt?.status === 'REVIEW_REQUIRED' && receipt.historicalImport ? (
        <div className="library-grouping-controls">
          <Button
            disabled={disabled || busy || confirmationBlocked || declined}
            onClick={() => {
              void historical('confirm');
            }}
          >
            确认仅导入历史版本
          </Button>
          <Button
            variant="outline"
            disabled={disabled || busy}
            onClick={() => {
              void historical('refresh');
            }}
          >
            刷新待导入信息
          </Button>
          <Button
            variant="ghost"
            disabled={disabled || busy || declined}
            onClick={() => setDeclined(true)}
          >
            暂不导入
          </Button>
        </div>
      ) : null}
      {declined ? (
        <p role="status">
          已暂缓导入历史版本，当前版本未改变。已上传原件未删除。
        </p>
      ) : null}
      {busy ? <p role="status">正在核对文档版本状态…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
