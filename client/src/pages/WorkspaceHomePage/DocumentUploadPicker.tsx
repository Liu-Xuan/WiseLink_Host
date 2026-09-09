import { useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { DocumentLibraryUploadRequest } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import { uploadFile } from '@client/src/components/business-ui/api/files/service';
import { createRequestCorrelationId } from '@client/src/utils/request-correlation-id';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';

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
      await onSubmit({ requestId, selection: selected });
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
        <p>仅上传并登记到文档管理；不创建评估任务。原件不会被覆盖。</p>
      </div>
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
                ? '已取得处理回执'
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
