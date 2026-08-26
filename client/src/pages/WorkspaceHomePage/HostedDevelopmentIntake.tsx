import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import {
  FileCheck2,
  FileUp,
  LoaderCircle,
  RotateCcw,
  Shield,
  TriangleAlert,
} from 'lucide-react';

import {
  createDevelopmentWorkItem,
  getDocumentParsingPage,
  requireOfficialOauthSession,
} from '@client/src/api/canonical-host';
import { uploadFile } from '@client/src/components/business-ui/api/files/service';
import { Button } from '@client/src/components/ui/button';

const MAX_PDF_BYTES = 100 * 1024 * 1024;

type IntakePhase = 'idle' | 'uploading' | 'creating' | 'readback' | 'failed';

interface UploadedSelection {
  bucketId: string;
  filePath: string;
  developmentRunToken: string;
}

export function HostedDevelopmentIntake() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<UploadedSelection | null>(null);
  const [phase, setPhase] = useState<IntakePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const busy =
    phase === 'uploading' || phase === 'creating' || phase === 'readback';

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const next = acceptedFiles[0] ?? null;
    setUploaded(null);
    setError(null);
    setPhase('idle');
    if (!next) {
      setFile(null);
      setError('请选择一个 PDF 文件。');
      return;
    }
    if (!next.name.toLowerCase().endsWith('.pdf')) {
      setFile(null);
      setError('当前入口仅接受 PDF。');
      return;
    }
    if (next.size <= 0 || next.size > MAX_PDF_BYTES) {
      setFile(null);
      setError('PDF 不能为空，且文件大小不能超过 100 MB。');
      return;
    }
    setFile(next);
  }, []);

  const { getInputProps, getRootProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    multiple: false,
    disabled: busy,
    onDrop,
  });

  async function createWorkItem(): Promise<void> {
    if (!file || busy) return;
    setError(null);
    try {
      setPhase('creating');
      await requireOfficialOauthSession();
      const localSha256 = await sha256File(file);
      let selection = uploaded;
      if (!selection) {
        setPhase('uploading');
        const uploadId = randomUuid();
        const uploadedFile = await uploadFile(file, {
          filePath: `wiselink/dev-intake/${uploadId}/${safePdfName(file.name)}`,
          contentType: 'application/pdf',
          upsert: false,
        });
        selection = {
          bucketId: uploadedFile.bucketId,
          filePath: uploadedFile.filePath,
          developmentRunToken: randomUuid(),
        };
        setUploaded(selection);
      }

      setPhase('creating');
      const created = await createDevelopmentWorkItem({
        selection: {
          bucketId: selection.bucketId,
          filePath: selection.filePath,
        },
        developmentRunToken: selection.developmentRunToken,
        query: 'applicability',
      });
      const workItemId = created.result.workItem.workItemId;
      setPhase('readback');
      const readback = await getDocumentParsingPage(
        workItemId,
        'applicability',
      );
      const createdSource = created.result.workItem.source;
      const readbackSource = readback.workItem.source;
      if (
        created.result.status !== 'CANDIDATE_VERTICAL_VERIFIED' ||
        readback.workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
        readback.workItem.workItemId !== workItemId ||
        readback.workItem.requestId !== created.result.workItem.requestId ||
        readbackSource.documentVersionId !== createdSource.documentVersionId ||
        readbackSource.sourceArtifactId !== createdSource.sourceArtifactId ||
        readbackSource.sourceFileSha256 !== createdSource.sourceFileSha256 ||
        readbackSource.sourceByteLength !== createdSource.sourceByteLength ||
        readbackSource.sourceFileSha256 !== `sha256:${localSha256}` ||
        readbackSource.sourceByteLength !== file.size
      ) {
        throw new Error('CANONICAL_SAME_USER_READBACK_MISMATCH');
      }
      // 新建完成后先进入事项综合概述；原文与解析结果由用户按需下钻。
      navigate(`/work-items/${encodeURIComponent(workItemId)}`);
    } catch (reason) {
      setPhase('failed');
      setError(intakeError(reason));
    }
  }

  return (
    <section className="hosted-intake" aria-labelledby="hosted-intake-title">
      <div className="hosted-intake-copy">
        <span className="library-section-label">新建工程事项</span>
        <h2 id="hosted-intake-title">上传 PDF 并新建工程事项</h2>
        <p>
          选择文件后，系统会校验资料完整性并建立受控工程事项。创建成功后先进入综合评估概述。
        </p>
        <div className="hosted-intake-boundary">
          <Shield aria-hidden="true" />
          <span>仅限已授权用户访问；资料仍按当前权限范围显示。</span>
        </div>
      </div>

      <div className="hosted-intake-action">
        <div
          {...getRootProps({
            className: `hosted-intake-drop${isDragActive ? ' is-active' : ''}`,
            role: 'button',
            'aria-label': file
              ? `更换 PDF 文件，当前为 ${file.name}`
              : '选择一个 PDF 文件',
            'aria-disabled': busy,
          })}
        >
          <input {...getInputProps()} />
          {file ? (
            <FileCheck2 aria-hidden="true" />
          ) : (
            <FileUp aria-hidden="true" />
          )}
          <div>
            <strong>{file ? file.name : '拖入或选择一个 PDF'}</strong>
            <span>
              {file
                ? fileSizeLabel(file.size)
                : '最大 100 MB'}
            </span>
          </div>
        </div>
        <Button
          type="button"
          size="lg"
          disabled={!file || busy}
          onClick={() => void createWorkItem()}
        >
          {busy ? (
            <LoaderCircle className="library-spin" aria-hidden="true" />
          ) : uploaded ? (
            <RotateCcw aria-hidden="true" />
          ) : (
            <FileUp aria-hidden="true" />
          )}
          {phaseLabel(phase, Boolean(uploaded))}
        </Button>
        {error ? (
          <p className="hosted-intake-error" role="alert">
            <TriangleAlert aria-hidden="true" /> {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function randomUuid(): string {
  if (typeof crypto.randomUUID !== 'function') {
    throw new Error('BROWSER_RANDOM_UUID_UNAVAILABLE');
  }
  return crypto.randomUUID().toLowerCase();
}

async function sha256File(file: File): Promise<string> {
  if (!crypto.subtle) throw new Error('BROWSER_SHA256_UNAVAILABLE');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
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
  return `${base || 'document'}.pdf`;
}

function phaseLabel(phase: IntakePhase, uploaded: boolean): string {
  if (phase === 'uploading') return '上传受控文件…';
  if (phase === 'creating') return '校验并创建…';
  if (phase === 'readback') return '核验资料关联…';
  if (phase === 'failed' && uploaded) return '重新提交';
  return '上传并创建工程事项';
}

function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes.toLocaleString('zh-CN')} 字节`;
}

function intakeError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message.trim() : '';
  if (/IDENTITY|LOGIN|OAUTH|401|UNAUTHORIZED/iu.test(message)) {
    return '请先完成飞书授权，再上传并创建工程事项。';
  }
  if (/SAME_USER_READBACK_MISMATCH/iu.test(message)) {
    return '文件已上传，但事项校验尚未完成。请保留当前文件后重试；未通过校验的结果不会作为当前事项。';
  }
  if (/BROWSER_(RANDOM_UUID|SHA256)_UNAVAILABLE/iu.test(message)) {
    return '当前浏览器缺少安全校验能力，请使用最新版飞书或受支持浏览器重试。';
  }
  return '工程事项创建失败，请保留当前文件后重试。';
}
