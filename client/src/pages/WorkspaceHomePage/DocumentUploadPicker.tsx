import { useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { DocumentLibraryUploadRequest } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import { uploadFile } from '@client/src/components/business-ui/api/files/service';
import { createRequestCorrelationId } from '@client/src/utils/request-correlation-id';
import { getCanonicalHostClientSessionGeneration, requireOfficialOauthSession } from '@client/src/api/canonical-host';
import {
  DocumentDeliveryChoice,
  type DocumentDeliveryChoiceValue,
} from './DocumentDeliveryChoice';

interface DocumentUploadPickerProps {
  disabled: boolean;
  onSubmit: (request: DocumentLibraryUploadRequest) => Promise<void>;
  onReset: () => void;
}

export function DocumentUploadPicker({
  disabled,
  onSubmit,
  onReset,
}: DocumentUploadPickerProps) {
  const [file, setFile] = useState<File | null>(null);
  const [requestId, setRequestId] = useState('');
  const [documentDelivery, setDocumentDelivery] =
    useState<DocumentDeliveryChoiceValue>({
      reading: false,
      translation: 'NONE',
    });
  const [submittedDelivery, setSubmittedDelivery] =
    useState<DocumentDeliveryChoiceValue | null>(null);
  const [selection, setSelection] = useState<
    DocumentLibraryUploadRequest['selection'] | null
  >(null);
  const [phase, setPhase] = useState<
    'idle' | 'uploading' | 'registering' | 'received' | 'failed'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const busy = phase === 'uploading' || phase === 'registering';
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false,
    maxFiles: 1,
    maxSize: 100 * 1024 * 1024,
    minSize: 1,
    disabled: disabled || busy,
    onDrop: (files, rejected) => {
      if (inFlight.current) return;
      onReset();
      setSelection(null);
      setSubmittedDelivery(null);
      setDocumentDelivery({ reading: false, translation: 'NONE' });
      setPhase('idle');
      const next = files[0];
      if (
        !next ||
        rejected.length ||
        !next.name.toLowerCase().endsWith('.pdf')
      ) {
        setFile(null);
        setRequestId('');
        setError('请选择一个非空 PDF，大小不超过 100 MB。');
        return;
      }
      setFile(next);
      setRequestId(createRequestCorrelationId());
      setError(null);
    },
  });

  async function submit(): Promise<void> {
    if (inFlight.current || disabled || !file || !requestId) return;
    inFlight.current = true;
    const generation = getCanonicalHostClientSessionGeneration();
    const current = () =>
      mounted.current &&
      generation === getCanonicalHostClientSessionGeneration();
    setError(null);
    try {
      await requireOfficialOauthSession();
      if (!current()) return;
      let selected = selection;
      if (!selected) {
        setPhase('uploading');
        const filename = file.name
          .replace(/[^\p{L}\p{N}._-]/gu, '_')
          .slice(-150);
        const uploaded = await uploadFile(file, {
          filePath: `wiselink/document-library/${requestId}/${filename}`,
          contentType: 'application/pdf',
          upsert: false,
        });
        if (!current()) return;
        selected = { bucketId: uploaded.bucketId, filePath: uploaded.filePath };
        setSelection(selected);
      }
      setPhase('registering');
      const requestedDelivery = submittedDelivery ?? documentDelivery;
      setSubmittedDelivery(requestedDelivery);
      await onSubmit({
        requestId,
        selection: selected,
        documentDelivery: requestedDelivery,
      });
      if (current()) setPhase('received');
    } catch (reason: unknown) {
      if (!current()) return;
      setPhase('failed');
      setError(
        `操作未确认完成：${reason instanceof Error ? reason.message : '请求失败'}。保留本次请求信息；重试不会切换登记请求。`,
      );
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <>
      <div
        {...getRootProps()}
        className={`library-upload-dropzone${isDragActive ? ' is-dragging' : ''}`}
      >
        <input {...getInputProps()} aria-label="选择资料库 PDF" />
        <strong>{file ? file.name : '选择或拖入 PDF'}</strong>
        <p>
          默认只保存并登记原件；下方可另选文件解读和中文翻译，不创建评估任务。
        </p>
      </div>
      <DocumentDeliveryChoice
        idPrefix="library-document-delivery"
        context="library"
        value={submittedDelivery ?? documentDelivery}
        onChange={setDocumentDelivery}
        disabled={
          disabled || busy || submittedDelivery !== null || phase === 'received'
        }
      />
      {submittedDelivery && phase === 'failed' ? (
        <p className="library-classification-note">
          同一次登记请求保留原阅读选择；更换 PDF 可发起新请求。
        </p>
      ) : null}
      {submittedDelivery &&
      phase === 'received' &&
      (submittedDelivery.reading ||
        submittedDelivery.translation === 'ZH_FULL') ? (
        <p className="library-classification-note">
          所选阅读服务已随登记请求提交；请在文档页核对实际受理和交付。
        </p>
      ) : null}
      <div className="library-grouping-controls">
        <Button
          disabled={disabled || busy || !file || phase === 'received'}
          onClick={() => {
            void submit();
          }}
        >
          {phase === 'uploading'
            ? '正在上传原件…'
            : phase === 'registering'
              ? '正在识别与登记…'
              : phase === 'received'
                ? '已取得登记回执'
                : selection
                  ? '重试同一次登记'
                  : '上传并登记文档'}
        </Button>
        {selection ? (
          <span className="library-classification-note">
            原件已上传，重试复用同一文件。
          </span>
        ) : null}
      </div>
      {busy ? (
        <p role="status">
          {phase === 'uploading'
            ? '上传中，请勿关闭页面。'
            : '文档管理正在检查去重、文档族与版本。'}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
