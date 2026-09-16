import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@client/src/components/ui/dialog';
import type { DocumentTranslationReadingResponse } from '@shared/document-translation-reading.interface';
import { SemanticBilingualReader } from './SemanticBilingualReader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@client/src/components/ui/button';
import { readDocumentTranslationReading, readDocumentParsingStatus, readParsedDocument, startDocumentParsing, subscribeCanonicalHostClientSession } from '@client/src/api/canonical-host';
import type { DocumentParsedReading, DocumentParsingStatus, StartDocumentParseRequest } from '@shared/document-parsing.interface';
import type { MineruReaderSource } from '@shared/mineru-reading.interface';
import { MineruMarkdownReader } from './MineruMarkdownReader';
import { DocumentParsedImage } from './DocumentParsedImage';
import { DocumentOriginalPreview } from '../WorkspaceHomePage/DocumentOriginalPreview';
import './document-version-reading.css';
import { libraryReadingParams, readingReturnTarget } from '@client/src/features/matter/reading-return';
import { DocumentSourceReadingWorkspace, type DocumentSourceReaderMode } from './DocumentSourceReadingWorkspace';

export default function DocumentVersionReadingPage() {
  const { documentVersionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const requestedRun = searchParams.get('parseRunId') || null;
  const requestedSource = searchParams.get('sourceRef') || null;
  const returnTarget = readingReturnTarget(
    searchParams,
    documentVersionId,
    requestedRun,
  );
  const navigationIdentity = JSON.stringify([documentVersionId, requestedRun, requestedSource]);
  const [status, setStatus] = useState<DocumentParsingStatus | null>(null);
  const [readingNavigation, setReadingNavigation] = useState<string | null>(null);
  const [reading, setReading] = useState<DocumentParsedReading | null>(null);
  const [source, setSource] = useState<MineruReaderSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [translation, setTranslation] = useState<DocumentTranslationReadingResponse | null>(null);
  const [waitingForTranslationStart, setWaitingForTranslationStart] = useState(false);
  const [translationPage, setTranslationPage] = useState<number | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [view, setView] = useState<DocumentSourceReaderMode>('dual');
  const epoch = useRef(0);
  const [sending, setSending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const loaded = useRef('');
  const request = useRef<StartDocumentParseRequest | null>(null);
  const identity = useRef(navigationIdentity);
  identity.current = navigationIdentity;

  useEffect(() => {
    epoch.current++;
    setStatus(null); setReading(null); setSource(null); setError(null); setSending(false);
    setTranslation(null); setTranslationPage(null); setTranslationError(null); setView('dual');
    loaded.current = ''; request.current = null;
    return subscribeCanonicalHostClientSession(() => {
      epoch.current++;
      setStatus(null); setReading(null); setSource(null); setTranslation(null); setTranslationPage(null); setTranslationError(null);
      loaded.current = ''; request.current = null; setRefresh(value => value + 1);
    });
  }, [navigationIdentity]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const generation = epoch.current;
    const current = () => !controller.signal.aborted && identity.current === navigationIdentity && epoch.current === generation;
    const load = async () => {
      try {
        const next = await readDocumentParsingStatus(documentVersionId, controller.signal);
        if (!current()) return;
        setStatus(next); setError(null);
        const targetRun = requestedRun ?? next.publishedRun?.parseRunId;
        if (targetRun) {
          const result = await readParsedDocument(documentVersionId, targetRun, controller.signal);
          if (!current()) return;
          if (result.documentVersionId !== documentVersionId || result.parseRunId !== targetRun) throw new Error('读取结果与指定解析版本不一致。');
          loaded.current = result.parseRunId; setReadingNavigation(navigationIdentity); setReading(result); setSource(null);
        }
        if (!requestedRun && (next.latestRun && ['RUNNING', 'STAGING'].includes(next.latestRun.status)) && current())
          timer = setTimeout(() => { void load(); }, 5000);
      } catch (reason) {
        if (!current()) return;
        setError(reason instanceof Error ? reason.message : '读取未完成，请重试。');
        const code = reason && typeof reason === 'object' && 'statusCode' in reason ? reason.statusCode : null;
        if ([401, 403, 404].includes(Number(code))) { setReading(null); setStatus(null); setTranslation(null); loaded.current = ''; }
      }
    };
    void load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [navigationIdentity, refresh]);

  const currentStatus = status?.documentVersionId === documentVersionId ? status : null;
  const currentReading = readingNavigation === navigationIdentity && reading?.documentVersionId === documentVersionId && (!requestedRun || reading.parseRunId === requestedRun) ? reading : null;
  const currentTranslation = translation?.documentVersionId === documentVersionId && translation.parseRunId === currentReading?.parseRunId ? translation : null;
  useEffect(() => {
    const parseRunId = currentReading?.parseRunId;
    if (!parseRunId || !currentReading?.original) { setTranslation(null); return; }
    setTranslationPage(null); setTranslationError(null); setWaitingForTranslationStart(false);
    let unstartedChecks = 0;
    const controller = new AbortController();
    const generation = epoch.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => !controller.signal.aborted && identity.current === navigationIdentity && epoch.current === generation;
    const load = async () => {
      try {
        const result = await readDocumentTranslationReading(documentVersionId, parseRunId, controller.signal);
        if (!current()) return;
        setTranslation(result); setTranslationError(null);
        const waiting = !result.execution && ++unstartedChecks < 6;
        setWaitingForTranslationStart(waiting);
        if (waiting || (result.execution && ['PENDING', 'QUEUED', 'RUNNING', 'COMMITTING', 'RETRY_SCHEDULED'].includes(result.execution.status)))
          timer = setTimeout(() => { void load(); }, 5000);
      } catch (reason) {
        if (!current()) return;
        setTranslationError(reason instanceof Error ? reason.message : '中文读取未完成，请刷新重试。');
        const code = reason && typeof reason === 'object' && 'statusCode' in reason ? reason.statusCode : null;
        if ([401, 403, 404].includes(Number(code))) { setTranslation(null); setReading(null); loaded.current = ''; }
      }
    };
    void load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [navigationIdentity, currentReading?.parseRunId, refresh]);
  const locateTranslationSource = (unitId: string, sourceRef: string) => {
    const location = currentReading?.original?.locations.find(item => item.sourceRefId === sourceRef);
    if (location?.pageIndex !== null && location?.pageIndex !== undefined) {
      // The original preview consumes only the physical page, not a guessed box.
      setTranslationPage(location.pageIndex);
    }
    document.getElementById(unitId)?.scrollIntoView({ block: 'center' });
  };
  const selectedLocation = requestedSource ? currentReading?.original?.locations.find(item => item.sourceRefId === requestedSource) : null;
  const selectedUnit = requestedSource ? currentReading?.original?.source.units.find(unit => unit.sourceRefIds.includes(requestedSource)) : null;
  useEffect(() => {
    if (view !== 'bilingual' && selectedUnit) document.getElementById(selectedUnit.unitId)?.scrollIntoView({ block: 'center' });
  }, [navigationIdentity, selectedUnit?.unitId, view]);
  const latest = currentStatus?.latestRun;
  const expired = latest ? Date.parse(latest.deadlineAt) <= Date.now() : false;
  const busy = Boolean(latest && ['RUNNING', 'STAGING'].includes(latest.status) && !expired);
  // The activity entry is only available when the original reading exists for this exact
  // version and parse run; it pins the same parse run instead of the latest one.
  const activityEntryRoute = currentReading?.original ? (() => {
    const query = new URLSearchParams({ parseRunId: currentReading.parseRunId });
    const libraryQuery = searchParams.get('returnLibraryQuery');
    if (libraryQuery)
      query.set('returnLibraryQuery', libraryReadingParams(new URLSearchParams(libraryQuery)).toString());
    return `/document-versions/${encodeURIComponent(documentVersionId)}/activities?${query.toString()}`;
  })() : null;

  async function start() {
    if (!currentStatus || sending) return;
    const version = documentVersionId;
    const navigation = navigationIdentity;
    const generation = epoch.current;
    request.current ??= { requestId: `parse-${crypto.randomUUID()}`, expectedPublishedRevision: currentStatus.publishedRun?.parseRevision ?? 0 };
    setSending(true); setError(null);
    try {
      await startDocumentParsing(version, request.current);
      if (identity.current !== navigation || epoch.current !== generation) return;
      request.current = null; setRefresh(value => value + 1);
    } catch (reason) {
      if (identity.current !== navigation || epoch.current !== generation) return;
      const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : null;
      if (['DOCUMENT_PARSE_REVISION_CONFLICT', 'DOCUMENT_PARSE_ALREADY_RUNNING'].includes(String(code))) request.current = null;
      setError(reason instanceof Error ? reason.message : '请求结果尚未确认，重试会核对同一请求。');
    } finally { if (identity.current === navigation && epoch.current === generation) setSending(false); }
  }

  const renderImage = useCallback(({ path, alt }: { path: string; src: string; alt: string }) => currentReading
    ? <DocumentParsedImage documentVersionId={documentVersionId} parseRunId={currentReading.parseRunId} path={path} alt={alt} /> : null,
  [documentVersionId, currentReading?.parseRunId]);

  return <main className="document-version-reading">
    <header>
      <Link to={returnTarget?.route ?? '/library?mode=document'}>{returnTarget?.label ?? '返回文档库'}</Link>
      <h1>{currentStatus?.originalFilename ?? '文档阅读'}</h1>
      <details className="document-reading-maintenance">
        <summary>文档处理</summary>
        <div className="document-reading-actions">
          <Button onClick={() => { void start(); }} disabled={!currentStatus?.runtimeAvailable || busy || sending}>
            {sending ? '正在受理…' : request.current ? '核对解析请求' : busy ? '正在解析…' : currentStatus?.publishedRun ? '重新解析' : '解析文档'}
          </Button>
          <Button variant="outline" onClick={() => setRefresh(value => value + 1)}>刷新</Button>
          <DocumentOriginalPreview documentVersionId={documentVersionId}>打开原件</DocumentOriginalPreview>
        </div>
      </details>
      {error && <p role="alert">{error}</p>}
      {currentStatus && !currentStatus.runtimeAvailable && <p role="status">
        {currentStatus.runtime?.state === 'FAILED' ? '最近的文档处理未完成，已保存的范围仍可读取。' : '官方文档解析插件尚未配置。'}
      </p>}
      {latest && <p role="status">{latest.status === 'PUBLISHED' ? `解析版本 ${latest.parseRevision} 已发布。` :
        latest.status === 'FAILED' ? `解析未完成：${latest.errorCode ?? '请重试或联系维护人员'}` :
        expired ? '执行期限已过，可重新发起解析。' : latest.status === 'STAGING' ? `正在保存并核验产物，已核验 ${latest.verifiedArtifacts} 个文件。` : '正在解析原件，可离开页面后回来查看。'}</p>}
    </header>
    {currentReading ? <>
      {requestedRun && <p role="status">{currentStatus?.publishedRun?.parseRunId !== requestedRun ? '历史解析版本' : '指定解析版本'}：固定读取此版本，刷新不会切换到最新版本。 <Link to={`/document-versions/${encodeURIComponent(documentVersionId)}`}>查看最新版本</Link></p>}
      {requestedSource && <aside aria-label="检索命中来源">
        {selectedLocation ? <><strong>已定位检索命中来源</strong>{selectedLocation.pageIndex !== null
          ? <><p>原件第 {selectedLocation.pageIndex + 1} 页 · 页级定位</p><DocumentOriginalPreview documentVersionId={documentVersionId} page={selectedLocation.pageIndex + 1}>原件第 {selectedLocation.pageIndex + 1} 页（页级定位）</DocumentOriginalPreview></>
          : <p>此来源没有可用的物理页定位。</p>}</>
          : <p role="alert">此解析版本中未找到指定来源，未替换为其他来源。</p>}
      </aside>}
      {currentReading.titleEnhancement.status === 'FAILED' && <p role="status">标题层级增强未完成，当前显示解析器标题。{currentReading.titleEnhancement.code}</p>}
      <p className="document-reading-version">阅读版本 {currentReading.parseRevision} · {currentReading.parser.name} {currentReading.parser.version}</p>
      {currentReading.original ? <>
        <DocumentSourceReadingWorkspace
          original={currentReading.original}
          documentVersionId={documentVersionId}
          mode={view}
          onModeChange={(mode) => { setView(mode); if (mode !== 'bilingual') setTranslationPage(null); }}
          returnRoute={returnTarget?.route ?? '/library?mode=document'}
          returnLabel={returnTarget?.label ?? '返回原处'}
          initialPage={selectedLocation?.pageIndex !== null && selectedLocation?.pageIndex !== undefined ? selectedLocation.pageIndex + 1 : undefined}
          bilingualContent={<section aria-label="已保存中文阅读">
            {translationError && <p role="alert">{translationError}</p>}
            {currentTranslation && !currentTranslation.execution && <p role="status">{waitingForTranslationStart ? '正在等待中文任务启动…' : '尚未检测到中文任务启动，可稍后刷新。'}</p>}
            {currentTranslation?.execution && <p role="status">{translationExecutionLabel(currentTranslation.execution.status)}{currentTranslation.execution.errorCode ? `（${currentTranslation.execution.errorCode}）` : ''}</p>}
            {currentTranslation ? <SemanticBilingualReader translation={currentTranslation.translation} onSourceRefSelect={locateTranslationSource} mode="bilingual" />
              : <p role="status">正在读取已保存译文…</p>}
          </section>}
        />
        {activityEntryRoute ? <p className="document-reading-related"><Link to={activityEntryRoute}>查看同一解析版本的活动阅读</Link></p> : null}
        <Dialog open={translationPage !== null} onOpenChange={open => { if (!open) setTranslationPage(null); }}>
          <DialogContent><DialogHeader><DialogTitle>译段原件位置</DialogTitle></DialogHeader>
          <p>原件第 {(translationPage ?? 0) + 1} 页 · 页级定位</p>
          <DocumentOriginalPreview documentVersionId={documentVersionId} page={(translationPage ?? 0) + 1}>原件第 {(translationPage ?? 0) + 1} 页（页级定位）</DocumentOriginalPreview>
          </DialogContent>
        </Dialog>
      </> : <MineruMarkdownReader markdown={currentReading.markdown} assets={currentReading.assets} projection={currentReading.projection}
        renderImage={renderImage} onLocateSource={setSource} />}
      {source && <aside className="document-reading-source" aria-label="原件来源">
        <strong>原件第 {source.pageIndex + 1} 页</strong>
        <DocumentOriginalPreview documentVersionId={documentVersionId} page={source.pageIndex + 1}>打开对应原件页</DocumentOriginalPreview>
        <Button variant="ghost" onClick={() => setSource(null)}>关闭来源</Button>
      </aside>}
    </> : <p role="status">{error ? '内容未能读回，请查看上方错误或刷新重试。' : currentStatus ? requestedRun ? '指定解析版本尚未读回；请查看读取状态或刷新重试。' : '尚无已发布的解析内容。可以先查看原件。' : '正在读取文档状态…'}</p>}
  </main>;
}

function translationExecutionLabel(status: string) {
  const labels: Record<string, string> = { PENDING: '中文等待开始', QUEUED: '中文排队中', RUNNING: '正在生成中文，已保存段落可阅读',
    COMMITTING: '正在保存中文结果', RETRY_SCHEDULED: '等待续接，已保存段落可阅读', SUCCEEDED: '本次中文处理已结束，覆盖范围见下方',
    FAILED: '中文处理未完成，已保存段落保留', TIMED_OUT: '中文处理超时，已保存段落保留', CANCELLED: '中文处理已取消，已保存段落保留',
    CONFLICT: '原文已变化，请刷新读取当前版本', WAITING_INPUT: '中文处理等待补充输入' };
  return labels[status] ?? `中文处理状态：${status}`;
}
