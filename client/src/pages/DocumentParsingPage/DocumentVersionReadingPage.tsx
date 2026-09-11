import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@client/src/components/ui/button';
import { readDocumentParsingStatus, readParsedDocument, startDocumentParsing, subscribeCanonicalHostClientSession } from '@client/src/api/canonical-host';
import type { DocumentParsedReading, DocumentParsingStatus, StartDocumentParseRequest } from '@shared/document-parsing.interface';
import type { MineruReaderSource } from '@shared/mineru-reading.interface';
import { MineruMarkdownReader } from './MineruMarkdownReader';
import { DocumentParsedImage } from './DocumentParsedImage';
import { DocumentOriginalPreview } from '../WorkspaceHomePage/DocumentOriginalPreview';
import './document-version-reading.css';

export default function DocumentVersionReadingPage() {
  const { documentVersionId = '' } = useParams();
  const [status, setStatus] = useState<DocumentParsingStatus | null>(null);
  const [reading, setReading] = useState<DocumentParsedReading | null>(null);
  const [source, setSource] = useState<MineruReaderSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const loaded = useRef('');
  const request = useRef<StartDocumentParseRequest | null>(null);
  const identity = useRef(documentVersionId);
  identity.current = documentVersionId;

  useEffect(() => {
    setStatus(null); setReading(null); setSource(null); setError(null); setSending(false);
    loaded.current = ''; request.current = null;
    return subscribeCanonicalHostClientSession(() => {
      setStatus(null); setReading(null); setSource(null);
      loaded.current = ''; request.current = null; setRefresh(value => value + 1);
    });
  }, [documentVersionId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => !controller.signal.aborted && identity.current === documentVersionId;
    const load = async () => {
      try {
        const next = await readDocumentParsingStatus(documentVersionId, controller.signal);
        if (!current()) return;
        setStatus(next); setError(null);
        if (next.publishedRun && next.publishedRun.parseRunId !== loaded.current) {
          const result = await readParsedDocument(documentVersionId, next.publishedRun.parseRunId, controller.signal);
          if (!current()) return;
          loaded.current = result.parseRunId; setReading(result); setSource(null);
        }
        if ((next.runtime?.state === 'PREPARING' || (next.latestRun && ['RUNNING', 'STAGING'].includes(next.latestRun.status))) && current())
          timer = setTimeout(() => { void load(); }, 5000);
      } catch (reason) {
        if (!current()) return;
        setError(reason instanceof Error ? reason.message : '读取未完成，请重试。');
        const code = reason && typeof reason === 'object' && 'statusCode' in reason ? reason.statusCode : null;
        if ([401, 403, 404].includes(Number(code))) { setReading(null); setStatus(null); loaded.current = ''; }
      }
    };
    void load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [documentVersionId, refresh]);

  const currentStatus = status?.documentVersionId === documentVersionId ? status : null;
  const currentReading = reading?.documentVersionId === documentVersionId ? reading : null;
  const latest = currentStatus?.latestRun;
  const expired = latest ? Date.parse(latest.deadlineAt) <= Date.now() : false;
  const busy = Boolean(latest && ['RUNNING', 'STAGING'].includes(latest.status) && !expired);

  async function start() {
    if (!currentStatus || sending) return;
    const version = documentVersionId;
    request.current ??= { requestId: `parse-${crypto.randomUUID()}`, expectedPublishedRevision: currentStatus.publishedRun?.parseRevision ?? 0 };
    setSending(true); setError(null);
    try {
      await startDocumentParsing(version, request.current);
      if (identity.current !== version) return;
      request.current = null; setRefresh(value => value + 1);
    } catch (reason) {
      if (identity.current !== version) return;
      const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : null;
      if (['DOCUMENT_PARSE_REVISION_CONFLICT', 'DOCUMENT_PARSE_ALREADY_RUNNING'].includes(String(code))) request.current = null;
      setError(reason instanceof Error ? reason.message : '请求结果尚未确认，重试会核对同一请求。');
    } finally { if (identity.current === version) setSending(false); }
  }

  const renderImage = useCallback(({ path, alt }: { path: string; src: string; alt: string }) => currentReading
    ? <DocumentParsedImage documentVersionId={documentVersionId} parseRunId={currentReading.parseRunId} path={path} alt={alt} /> : null,
  [documentVersionId, currentReading?.parseRunId]);

  return <main className="document-version-reading">
    <header>
      <Link to="/library">返回文档库</Link>
      <h1>{currentStatus?.originalFilename ?? '文档阅读'}</h1>
      <div className="document-reading-actions">
        <Button onClick={() => { void start(); }} disabled={!currentStatus?.runtimeAvailable || busy || sending}>
          {sending ? '正在受理…' : request.current ? '核对解析请求' : busy ? '正在解析…' : currentStatus?.publishedRun ? '重新解析' : '解析文档'}
        </Button>
        <Button variant="outline" onClick={() => setRefresh(value => value + 1)}>刷新</Button>
        <DocumentOriginalPreview documentVersionId={documentVersionId}>打开原件</DocumentOriginalPreview>
      </div>
      {error && <p role="alert">{error}</p>}
      {currentStatus && !currentStatus.runtimeAvailable && <p role="status">
        {currentStatus.runtime?.state === 'PREPARING'
          ? currentStatus.runtime.stage === 'FILES'
            ? `正在准备解析环境，已恢复 ${currentStatus.runtime.verifiedFiles}/${currentStatus.runtime.totalFiles} 个文件。`
            : '正在检查解析依赖，请稍候。'
          : currentStatus.runtime?.state === 'FAILED'
            ? '解析环境准备失败，请稍后刷新重试。'
            : '解析环境尚未配置。'}
      </p>}
      {latest && <p role="status">{latest.status === 'PUBLISHED' ? `解析版本 ${latest.parseRevision} 已发布。` :
        latest.status === 'FAILED' ? `解析未完成：${latest.errorCode ?? '请重试或联系维护人员'}` :
        expired ? '执行期限已过，可重新发起解析。' : latest.status === 'STAGING' ? `正在保存并核验产物，已核验 ${latest.verifiedArtifacts} 个文件。` : '正在解析原件，可离开页面后回来查看。'}</p>}
    </header>
    {currentReading ? <>
      {currentReading.titleEnhancement.status === 'FAILED' && <p role="status">标题层级增强未完成，当前显示解析器标题。{currentReading.titleEnhancement.code}</p>}
      <p className="document-reading-version">阅读版本 {currentReading.parseRevision} · MinerU {currentReading.parser.version}</p>
      <MineruMarkdownReader markdown={currentReading.markdown} assets={currentReading.assets} projection={currentReading.projection}
        renderImage={renderImage} onLocateSource={setSource} />
      {source && <aside className="document-reading-source" aria-label="原件来源">
        <strong>原件第 {source.pageIndex + 1} 页</strong>
        <DocumentOriginalPreview documentVersionId={documentVersionId} page={source.pageIndex + 1}>打开对应原件页</DocumentOriginalPreview>
        <Button variant="ghost" onClick={() => setSource(null)}>关闭来源</Button>
      </aside>}
    </> : <p role="status">{currentStatus ? '尚无已发布的解析内容。可以先查看原件。' : '正在读取文档状态…'}</p>}
  </main>;
}
