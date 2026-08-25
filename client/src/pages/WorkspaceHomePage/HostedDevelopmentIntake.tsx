import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  FileCheck2,
  FileUp,
  LoaderCircle,
  ShieldCheck,
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
      setError('PDF 必须大于 0 bytes 且不超过 100 MiB。');
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
      navigate(
        `/work-items/${encodeURIComponent(workItemId)}/documents?node=document&tab=source`,
      );
    } catch (reason) {
      setPhase('failed');
      setError(intakeError(reason));
    }
  }

  return (
    <section className="hosted-intake" aria-labelledby="hosted-intake-title">
      <div className="hosted-intake-copy">
        <span className="library-section-label">受控资料上传</span>
        <h2 id="hosted-intake-title">上传 PDF 并新建工程事项</h2>
        <p>
          文件先进入当前用户的受控文件空间；系统随后按实际字节校验文件、
          形成文件版本与工程事项，并立即校验资料关联与完整性。
        </p>
        <div className="hosted-intake-boundary">
          <ShieldCheck aria-hidden="true" />
          <span>仅限已授权用户；非本人文件与未授权环境均拒绝。</span>
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
                ? `${file.size.toLocaleString('zh-CN')} bytes`
                : '最大 100 MiB'}
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
            <CheckCircle2 aria-hidden="true" />
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
  if (phase === 'readback') return '同用户回读…';
  if (phase === 'failed' && uploaded) return '重新提交';
  return '上传并创建测试事项';
}

function intakeError(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  return '工程事项创建失败，请保留当前文件后重试。';
}
