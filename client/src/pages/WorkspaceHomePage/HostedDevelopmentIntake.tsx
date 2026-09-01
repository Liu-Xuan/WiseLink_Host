import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  FileUp,
  FolderOpen,
  LoaderCircle,
  RotateCcw,
  Search,
  Shield,
  TriangleAlert,
  X,
} from 'lucide-react';

import {
  createDevelopmentWorkItem,
  getDocumentParsingPage,
  requireOfficialOauthSession,
} from '@client/src/api/canonical-host';
import { uploadFile } from '@client/src/components/business-ui/api/files/service';
import { Button } from '@client/src/components/ui/button';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { createRequestCorrelationId } from '@client/src/utils/request-correlation-id';

import {
  EXISTING_PDF_PAGE_SIZE,
  ExistingStoragePdfListError,
  type ExistingStoragePdfOption,
  existingStoragePdfVisibleText,
  listExistingStoragePdfs,
} from './existing-storage-pdfs';
import {
  beginHostedIntakeSubmission,
  developmentWorkItemRequest,
  endHostedIntakeSubmission,
  resolveHostedIntakeSelection,
  type HostedIntakeSource,
  type HostedUploadSelection,
} from './hosted-development-intake-flow';

const MAX_PDF_BYTES = 100 * 1024 * 1024;

type IntakePhase = 'idle' | 'uploading' | 'creating' | 'readback' | 'failed';

type ExistingPickerPhase = 'idle' | 'loading' | 'ready' | 'failed';

interface SelectedExistingPdf extends ExistingStoragePdfOption {
  selection: HostedUploadSelection;
}

export function HostedDevelopmentIntake() {
  const navigate = useNavigate();
  const { invalidateSession, sessionGeneration } = useCurrentUserSession();
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<HostedUploadSelection | null>(null);
  const [existingPdf, setExistingPdf] = useState<SelectedExistingPdf | null>(
    null,
  );
  const [phase, setPhase] = useState<IntakePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPhase, setPickerPhase] = useState<ExistingPickerPhase>('idle');
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerItems, setPickerItems] = useState<ExistingStoragePdfOption[]>(
    [],
  );
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [pickerOffset, setPickerOffset] = useState(0);
  const [pickerHasNext, setPickerHasNext] = useState(false);
  const [pickerReload, setPickerReload] = useState(0);
  const submissionInFlightRef = useRef(false);
  const busy =
    phase === 'uploading' || phase === 'creating' || phase === 'readback';

  useEffect(() => {
    setFile(null);
    setUploaded(null);
    setExistingPdf(null);
    setPhase('idle');
    setError(null);
    setPickerOpen(false);
    setPickerPhase('idle');
    setPickerError(null);
    setPickerItems([]);
    setSearchDraft('');
    setSearchQuery('');
    setPickerOffset(0);
    setPickerHasNext(false);
  }, [sessionGeneration]);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const controller = new AbortController();
    setPickerPhase('loading');
    setPickerError(null);
    void listExistingStoragePdfs({
      search: searchQuery,
      offset: pickerOffset,
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return;
        setPickerItems(page.items);
        setPickerHasNext(page.hasNextPage);
        setPickerPhase('ready');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (
          reason instanceof ExistingStoragePdfListError &&
          reason.code === 'AUTH_REQUIRED'
        ) {
          invalidateSession();
        }
        setPickerItems([]);
        setPickerHasNext(false);
        setPickerPhase('failed');
        setPickerError(existingPickerError(reason));
      });
    return () => controller.abort();
  }, [
    invalidateSession,
    pickerOffset,
    pickerOpen,
    pickerReload,
    searchQuery,
    sessionGeneration,
  ]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const next = acceptedFiles[0] ?? null;
    setUploaded(null);
    setExistingPdf(null);
    setPickerOpen(false);
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
    const selectedFile = file;
    const selectedExistingPdf = existingPdf;
    if (
      (!selectedFile && !selectedExistingPdf) ||
      busy ||
      !beginHostedIntakeSubmission(submissionInFlightRef)
    ) {
      return;
    }
    setError(null);
    try {
      setPhase('creating');
      await requireOfficialOauthSession();
      const localSha256 = selectedFile ? await sha256File(selectedFile) : null;
      if (selectedFile && !uploaded) {
        setPhase('uploading');
      }
      let intakeSource: HostedIntakeSource;
      if (selectedExistingPdf) {
        intakeSource = {
          kind: 'existing',
          selection: selectedExistingPdf.selection,
        };
      } else if (selectedFile) {
        intakeSource = {
          kind: 'local',
          file: selectedFile,
          cachedUpload: uploaded,
        };
      } else {
        return;
      }
      const resolved = await resolveHostedIntakeSelection(intakeSource, {
        createToken: createRequestCorrelationId,
        upload: async (localFile: File, uploadId: string) => {
          const uploadedFile = await uploadFile(localFile, {
            filePath: `wiselink/dev-intake/${uploadId}/${safePdfName(localFile.name)}`,
            contentType: 'application/pdf',
            upsert: false,
          });
          return {
            bucketId: uploadedFile.bucketId,
            filePath: uploadedFile.filePath,
          };
        },
      });
      if (resolved.uploadedNow) setUploaded(resolved.selection);

      setPhase('creating');
      const created = await createDevelopmentWorkItem(
        developmentWorkItemRequest(resolved.selection),
      );
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
        (resolved.localFile !== null &&
          (readbackSource.sourceFileSha256 !== `sha256:${localSha256}` ||
            readbackSource.sourceByteLength !== resolved.localFile.size))
      ) {
        throw new Error('CANONICAL_SAME_USER_READBACK_MISMATCH');
      }
      // 新建完成后先进入事项综合概述；原文与解析结果由用户按需下钻。
      navigate(`/work-items/${encodeURIComponent(workItemId)}`);
    } catch (reason) {
      setPhase('failed');
      setError(intakeError(reason));
    } finally {
      endHostedIntakeSubmission(submissionInFlightRef);
    }
  }

  function selectExistingPdf(option: ExistingStoragePdfOption): void {
    setExistingPdf({
      ...option,
      selection: {
        ...option.selection,
        developmentRunToken: createRequestCorrelationId(),
      },
    });
    setFile(null);
    setUploaded(null);
    setError(null);
    setPhase('idle');
    setPickerOpen(false);
  }

  function submitStorageSearch(): void {
    setPickerPhase('loading');
    setPickerOffset(0);
    setSearchQuery(searchDraft.trim());
    setPickerReload((value) => value + 1);
  }

  return (
    <section className="hosted-intake" aria-labelledby="hosted-intake-title">
      <div className="hosted-intake-copy">
        <span className="library-section-label">新建工程评估</span>
        <h2 id="hosted-intake-title">选择或上传 PDF 并新建工程评估</h2>
        <p>
          可选择当前会话中的已上传
          PDF，或从本机上传。创建成功后先进入综合评估概述。
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
              : existingPdf
                ? `改为上传本机 PDF，当前已选择 ${existingPdf.displayName}`
                : '选择一个 PDF 文件',
            'aria-disabled': busy,
          })}
        >
          <input {...getInputProps()} />
          {file || existingPdf ? (
            <FileCheck2 aria-hidden="true" />
          ) : (
            <FileUp aria-hidden="true" />
          )}
          <div>
            <strong>
              {file
                ? file.name
                : existingPdf
                  ? existingPdf.displayName
                  : '拖入或选择一个 PDF'}
            </strong>
            <span>
              {file
                ? fileSizeLabel(file.size)
                : existingPdf
                  ? existingPdf.updatedLabel
                  : '最大 100 MB'}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="hosted-intake-existing-trigger"
          disabled={busy}
          aria-expanded={pickerOpen}
          aria-controls="hosted-existing-pdf-picker"
          onClick={() => {
            if (!pickerOpen) setPickerPhase('loading');
            setPickerOpen((open) => !open);
          }}
        >
          <FolderOpen aria-hidden="true" />
          选择已上传 PDF
        </Button>
        <Button
          type="button"
          size="lg"
          disabled={(!file && !existingPdf) || busy}
          onClick={() => void createWorkItem()}
        >
          {busy ? (
            <LoaderCircle className="library-spin" aria-hidden="true" />
          ) : uploaded ? (
            <RotateCcw aria-hidden="true" />
          ) : (
            <FileUp aria-hidden="true" />
          )}
          {phaseLabel(
            phase,
            Boolean(uploaded || existingPdf),
            Boolean(existingPdf),
          )}
        </Button>
        {pickerOpen ? (
          <section
            id="hosted-existing-pdf-picker"
            className="hosted-intake-existing-picker"
            aria-labelledby="hosted-existing-pdf-title"
          >
            <div className="hosted-intake-existing-heading">
              <div>
                <strong id="hosted-existing-pdf-title">选择已上传 PDF</strong>
                <span>列表来自当前登录会话；创建时仍会校验资料绑定。</span>
              </div>
              <button
                type="button"
                aria-label="关闭已上传 PDF 列表"
                onClick={() => setPickerOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <form
              className="hosted-intake-existing-search"
              onSubmit={(event) => {
                event.preventDefault();
                submitStorageSearch();
              }}
            >
              <label htmlFor="hosted-existing-pdf-search">搜索文件名</label>
              <div>
                <input
                  id="hosted-existing-pdf-search"
                  type="search"
                  value={searchDraft}
                  placeholder="输入 PDF 文件名"
                  disabled={pickerPhase === 'loading'}
                  onChange={(event) => setSearchDraft(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={pickerPhase === 'loading'}
                >
                  <Search aria-hidden="true" />
                  搜索
                </Button>
              </div>
            </form>
            <div
              className="hosted-intake-existing-results"
              aria-live="polite"
              aria-busy={pickerPhase === 'loading'}
            >
              {pickerPhase === 'loading' ? (
                <p className="hosted-intake-existing-state">
                  <LoaderCircle className="library-spin" aria-hidden="true" />
                  正在读取当前会话中的 PDF…
                </p>
              ) : pickerPhase === 'failed' ? (
                <p
                  className="hosted-intake-existing-state is-error"
                  role="alert"
                >
                  <TriangleAlert aria-hidden="true" />
                  {pickerError}
                </p>
              ) : pickerItems.length === 0 ? (
                <p className="hosted-intake-existing-state">
                  当前页没有可选择的 PDF。
                </p>
              ) : (
                <ul>
                  {pickerItems.map((option: ExistingStoragePdfOption) => {
                    const visible = existingStoragePdfVisibleText(option);
                    return (
                      <li
                        key={`${option.selection.bucketId}:${option.selection.filePath}`}
                      >
                        <button
                          type="button"
                          onClick={() => selectExistingPdf(option)}
                        >
                          <FileCheck2 aria-hidden="true" />
                          <span>
                            <strong>{visible.name}</strong>
                            <small>{visible.updated}</small>
                          </span>
                          {existingPdf?.selection.bucketId ===
                            option.selection.bucketId &&
                          existingPdf.selection.filePath ===
                            option.selection.filePath ? (
                            <Check aria-label="当前已选择" />
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="hosted-intake-existing-pagination">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pickerOffset === 0 || pickerPhase === 'loading'}
                onClick={() => {
                  setPickerPhase('loading');
                  setPickerOffset((value) =>
                    Math.max(0, value - EXISTING_PDF_PAGE_SIZE),
                  );
                }}
              >
                <ChevronLeft aria-hidden="true" />
                上一页
              </Button>
              <span>第 {pickerOffset / EXISTING_PDF_PAGE_SIZE + 1} 页</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!pickerHasNext || pickerPhase === 'loading'}
                onClick={() => {
                  setPickerPhase('loading');
                  setPickerOffset((value) => value + EXISTING_PDF_PAGE_SIZE);
                }}
              >
                下一页
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </section>
        ) : null}
        {error ? (
          <p className="hosted-intake-error" role="alert">
            <TriangleAlert aria-hidden="true" /> {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

async function sha256File(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('BROWSER_SHA256_UNAVAILABLE');
  }
  const digest = await globalThis.crypto.subtle.digest(
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

function phaseLabel(
  phase: IntakePhase,
  prepared: boolean,
  existing: boolean,
): string {
  if (phase === 'uploading') return '上传受控文件…';
  if (phase === 'creating') return '校验并创建…';
  if (phase === 'readback') return '核验资料关联…';
  if (phase === 'failed' && prepared) return '重新提交';
  if (existing) return '用所选 PDF 创建工程评估';
  return '上传并创建工程评估';
}

function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes.toLocaleString('zh-CN')} 字节`;
}

function intakeError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message.trim() : '';
  if (/IDENTITY|LOGIN|OAUTH|401|UNAUTHORIZED/iu.test(message)) {
    return '请先完成飞书授权，再上传并创建工程评估。';
  }
  if (/SAME_USER_READBACK_MISMATCH/iu.test(message)) {
    return '文件已上传，但事项校验尚未完成。请保留当前文件后重试；未通过校验的结果不会作为当前事项。';
  }
  if (/BROWSER_(RANDOM_UUID|SHA256)_UNAVAILABLE/iu.test(message)) {
    return '当前浏览器缺少安全校验能力，请使用最新版飞书或受支持浏览器重试。';
  }
  return '工程评估创建失败，请保留当前文件后重试。';
}

function existingPickerError(reason: unknown): string {
  if (reason instanceof ExistingStoragePdfListError) {
    if (reason.code === 'AUTH_REQUIRED') {
      return '登录状态已失效，请重新登录后再读取已上传 PDF。';
    }
    if (reason.code === 'BUCKET_UNAVAILABLE') {
      return '当前会话尚未提供可用的文件空间，请稍后重试或改为本机上传。';
    }
  }
  return '暂时无法读取已上传 PDF，请稍后重试或改为本机上传。';
}
