import DocumentTranslationContinuation from './DocumentTranslationContinuation';
import DocumentTranslationRuntimeDiagnostic from './runtime-monitor/DocumentTranslationRuntimeDiagnostic';
import TdmsSourceEntry from '@client/src/features/tdms-source/TdmsSourceEntry';
import { TDMS_SOURCE_UI_ENABLED } from '@client/src/features/tdms-source/tdms-source-enabled';
import { documentParseRecoveryRequestId } from '@shared/document-parsing-recovery';
import type { DocumentTranslationReadingResponse } from '@shared/document-translation-reading.interface';
import LocalMineruImport from './LocalMineruImport';
import { SemanticBilingualReader } from './SemanticBilingualReader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@client/src/components/ui/button';
import { readDocumentTranslationReading, readDocumentParsingStatus, readParsedDocument, startDocumentParsing, subscribeCanonicalHostClientSession } from '@client/src/api/canonical-host';
import type { DocumentParsedReading, DocumentParsingStatus, DocumentParseRunSummary, StartDocumentParseRequest } from '@shared/document-parsing.interface';
import type { MineruReaderSource } from '@shared/mineru-reading.interface';
import { MineruMarkdownReader } from './MineruMarkdownReader';
import { DocumentParsedImage } from './DocumentParsedImage';
import { DocumentOriginalPreview } from '../WorkspaceHomePage/DocumentOriginalPreview';
import './document-version-reading.css';
import DocumentWikiReading from './DocumentWikiReading';
import { libraryReadingParams, readingReturnTarget } from '@client/src/features/matter/reading-return';
import { DocumentSourceReadingWorkspace, type DocumentSourceReaderMode } from './DocumentSourceReadingWorkspace';
import { documentIdentityPresentation, libraryVersionLabel } from '../WorkspaceHomePage/library-document-presentation';
import { DocumentReadingIdentity, DocumentReadingMore, DocumentReadingSavedLinks } from './DocumentVersionReadingToolbar';
import { useDocumentReadingLinks } from './useDocumentReadingLinks';
import DocumentSavedWorkPanels from './DocumentSavedWorkPanels';
import RetainedWorkbenchPanel from '@client/src/features/workbench/RetainedWorkbenchPanel';
import { documentWorkbenchPanelRoute, readDocumentWorkbenchPanel } from './document-workbench-panel';

export default function DocumentVersionReadingPage() {
  const { documentVersionId = '' } = useParams();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRun = searchParams.get('parseRunId') || null;
  const requestedSource = searchParams.get('sourceRef') || null;
  const wikiSemantic = searchParams.get('semanticRevision');
  const wikiRevision = searchParams.get('readingRevision');
  const wikiRunRef = searchParams.get('readingRunRef') || undefined;
  const wikiRequested = ['semanticRevision','readingRevision','readingRunRef'].some(key => searchParams.has(key));
  const pinnedWiki = requestedRun && searchParams.getAll('parseRunId').length === 1 &&
    searchParams.getAll('semanticRevision').length === 1 && searchParams.getAll('readingRevision').length === 1 &&
    searchParams.getAll('readingRunRef').length <= 1 && (!searchParams.has('readingRunRef') || !!wikiRunRef?.trim()) &&
    wikiSemantic && wikiRevision && /^[1-9][0-9]*$/u.test(wikiSemantic) &&
    /^[1-9][0-9]*$/u.test(wikiRevision) && Number.isSafeInteger(Number(wikiSemantic)) && Number.isSafeInteger(Number(wikiRevision));
  const workbenchPanel = readDocumentWorkbenchPanel(searchParams, pinnedWiki ? 'interpretation' : 'reader');
  const unboundEvidence = searchParams.getAll('unboundEvidence').length === 1 &&
    searchParams.get('unboundEvidence') === '1';
  const returnTarget = readingReturnTarget(
    searchParams,
    documentVersionId,
    requestedRun,
    undefined,
    undefined,
    pathname,
  );
  const [status, setStatus] = useState<DocumentParsingStatus | null>(null);
  const [readingNavigation, setReadingNavigation] = useState<string | null>(null);
  const [reading, setReading] = useState<DocumentParsedReading | null>(null);
  const [source, setSource] = useState<MineruReaderSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [translation, setTranslation] = useState<DocumentTranslationReadingResponse | null>(null);
  const [translationObservedAt, setTranslationObservedAt] = useState<string | null>(null);
  const [translationRefreshing, setTranslationRefreshing] = useState(false);
  const [translationLocateRevision, setTranslationLocateRevision] = useState<{ revisionId: string; request: number } | null>(null);
  const translationContinuationRef = useRef<HTMLDivElement | null>(null);
  const [translationPage, setTranslationPage] = useState<number | null>(null);
  const [translationUnitId, setTranslationUnitId] = useState<string | null>(null);
  const [translationSourceContext, setTranslationSourceContext] = useState<string | null>(requestedSource);
  const [translationLocationRequest, setTranslationLocationRequest] = useState(0);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [view, setView] = useState<DocumentSourceReaderMode>('dual');
  const epoch = useRef(0);
  // Terminal rejection (401/403/404/revoked) for one identity/session/epoch must
  // invalidate BOTH the body reading and the translation, no matter which load
  // resolved first. bodyControllerRef lets the translation effect abort the body
  // epoch too; rejectedRef keeps late resolutions of either side from re-writing.
  const rejectedRef = useRef(false);
  const bodyControllerRef = useRef<AbortController | null>(null);
  const [sending, setSending] = useState(false);
  const parseInFlight = useRef(false);
  const [importReply, setImportReply] = useState<DocumentParseRunSummary | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const loaded = useRef('');
  const bodyPoll = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef<StartDocumentParseRequest | null>(null);
  const currentSettingsRequest = useRef<StartDocumentParseRequest | null>(null);
  const navigationScope = useRef({ documentVersionId, requestedRun, revision: 0,
    identity: JSON.stringify([documentVersionId, requestedRun, 0]) });
  if (navigationScope.current.documentVersionId !== documentVersionId || navigationScope.current.requestedRun !== requestedRun) {
    const previous = navigationScope.current;
    // Pinning the installed published run records a location, not a new reading.
    const preserve: boolean = previous.documentVersionId === documentVersionId && previous.requestedRun === null &&
      requestedRun !== null && searchParams.getAll('parseRunId').length === 1 && readingNavigation === previous.identity &&
      reading?.documentVersionId === documentVersionId && reading.parseRunId === requestedRun &&
      status?.documentVersionId === documentVersionId && status.publishedRun?.parseRunId === requestedRun &&
      loaded.current === requestedRun && !rejectedRef.current && error === null;
    const revision: number = previous.revision + (preserve ? 0 : 1);
    navigationScope.current = { documentVersionId, requestedRun, revision,
      identity: preserve ? previous.identity : JSON.stringify([documentVersionId, requestedRun, revision]) };
  }
  const readingIdentity = navigationScope.current.identity;
  const identity = useRef(readingIdentity);
  identity.current = readingIdentity;

  const rejectCurrentAccess = useCallback(() => {
    rejectedRef.current = true; epoch.current++; bodyControllerRef.current?.abort();
    request.current = null; currentSettingsRequest.current = null; parseInFlight.current = false;
    setImportReply(null); setParseError(null); setSending(false);
    setStatus(null); setReading(null); setTranslation(null); setSource(null); loaded.current = '';
    setTranslationObservedAt(null); setTranslationLocateRevision(null);
  }, []);

  useEffect(() => {
    epoch.current++;
    setStatus(null); setReading(null); setSource(null); setError(null); setSending(false);
    parseInFlight.current = false; setImportReply(null); setParseError(null);
    setTranslation(null); setTranslationPage(null); setTranslationUnitId(null); setTranslationSourceContext(requestedSource); setTranslationError(null); setView('dual');
    setTranslationLocationRequest(0);
    setTranslationObservedAt(null); setTranslationLocateRevision(null);
    loaded.current = ''; request.current = null; currentSettingsRequest.current = null;
    return subscribeCanonicalHostClientSession(() => {
      epoch.current++;
      rejectedRef.current = false;
      setStatus(null); setReading(null); setSource(null); setTranslation(null); setTranslationPage(null); setTranslationUnitId(null); setTranslationSourceContext(requestedSource); setTranslationError(null);
      setTranslationObservedAt(null); setTranslationLocateRevision(null);
      loaded.current = ''; request.current = null; currentSettingsRequest.current = null;
      parseInFlight.current = false; setImportReply(null); setParseError(null); setSending(false); setRefresh(value => value + 1);
    });
  }, [readingIdentity]);

  useEffect(() => { if (requestedRun) clearTimeout(bodyPoll.current); }, [requestedRun]);
  useEffect(() => {
    const controller = new AbortController();
    bodyControllerRef.current = controller;
    if (refresh > 0) loaded.current = '';
    // A fresh body load (identity change or explicit retry) clears the rejection.
    rejectedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const generation = epoch.current;
    const current = () => !controller.signal.aborted && identity.current === readingIdentity && epoch.current === generation;
    const fail = (reason: unknown) => {
      if (!current()) return;
      setError(reason instanceof Error ? reason.message : '读取未完成，请重试。');
      const code = reason && typeof reason === 'object' && 'statusCode' in reason ? Number(reason.statusCode) : null;
      if (code !== null && [401, 403, 404].includes(code)) {
        // A revoked / missing result is terminal for this identity/session/epoch:
        // drop every partial result and abort so no late body or translation
        // resolution can pass current() and re-display. The rejected state holds
        // until an explicit retry starts a new epoch.
        rejectCurrentAccess();
        controller.abort();
      }
    };
    const load = async () => {
      // A current-run pin stops latest polling; an in-flight authorization read may still reject access.
      if (!requestedRun && navigationScope.current.requestedRun) return;
      setError(null);
      if (requestedRun) {
        // A pinned run is authorized on its own: the body reading must never wait for the status read.
        void readParsedDocument(documentVersionId, requestedRun, controller.signal).then(result => {
          if (!current() || rejectedRef.current) return;
          if (result.documentVersionId !== documentVersionId || result.parseRunId !== requestedRun)
            throw new Error('读取结果与指定解析版本不一致。');
          loaded.current = result.parseRunId; setReadingNavigation(readingIdentity); setReading(result); setSource(null);
        }).catch(fail);
      }
      try {
        const next = await readDocumentParsingStatus(documentVersionId, controller.signal);
        if (!current()) return;
        setStatus(next);
        if (!navigationScope.current.requestedRun) {
          const targetRun = next.publishedRun?.parseRunId;
          // A status poll still runs on every cycle so authorization and the
          // latest-run state are rechecked, but a successfully painted body is
          // read once per run. An explicit refresh starts a new effect cycle
          // and clears this marker below.
          if (targetRun && loaded.current !== targetRun) {
            const result = await readParsedDocument(documentVersionId, targetRun, controller.signal);
            if (!current() || rejectedRef.current) return;
            if (result.documentVersionId !== documentVersionId || result.parseRunId !== targetRun)
              throw new Error('读取结果与指定解析版本不一致。');
            loaded.current = result.parseRunId; setReadingNavigation(readingIdentity); setReading(result); setSource(null);
          }
          if (next.latestRun && ['RUNNING', 'STAGING'].includes(next.latestRun.status) &&
              !next.latestRun.errorCode && Date.parse(next.latestRun.deadlineAt) > Date.now() && current()) {
            timer = setTimeout(() => { void load(); }, 5000);
            bodyPoll.current = timer;
          }
        }
      } catch (reason) {
        fail(reason);
      }
    };
    void load();
    return () => {
      if (bodyControllerRef.current === controller) bodyControllerRef.current = null;
      controller.abort(); if (timer) clearTimeout(timer);
    };
  }, [readingIdentity, refresh]);

  const currentStatus = status?.documentVersionId === documentVersionId ? status : null;
  const savedLinks = useDocumentReadingLinks(currentStatus, refresh, JSON.stringify([
    documentVersionId, requestedRun ?? currentStatus?.publishedRun?.parseRunId,
  ]));
  const currentReading = readingNavigation === readingIdentity && reading?.documentVersionId === documentVersionId && (!requestedRun || reading.parseRunId === requestedRun) ? reading : null;
  const currentTranslation = translation?.documentVersionId === documentVersionId && translation.parseRunId === currentReading?.parseRunId ? translation : null;
  const needsTranslation: boolean = view === 'bilingual' || view === 'translation';
  useEffect(() => {
    const parseRunId = currentReading?.parseRunId;
    // Chinese loads on demand only: the default dual mode never requests translation.
    // Both Chinese layouts share this reading and its in-flight request/poll deadline.
    if (!parseRunId || !currentReading?.original || !needsTranslation) { setTranslation(null); return; }
    setTranslationPage(null); setTranslationError(null);
    let unstartedChecks = 0;
    const controller = new AbortController();
    const generation = epoch.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => !controller.signal.aborted && identity.current === readingIdentity && epoch.current === generation;
    const load = async () => {
      setTranslationRefreshing(true);
      try {
        const result = await readDocumentTranslationReading(documentVersionId, parseRunId, controller.signal);
        if (!current()) return;
        if (result.documentVersionId !== documentVersionId || result.parseRunId !== parseRunId)
          throw new Error('译文读回与当前文档解析版本不一致。');
        setTranslation(result); setTranslationError(null);
        setTranslationObservedAt(new Date().toISOString());
        const waiting = !result.execution && ++unstartedChecks < 6;
        if (waiting || (result.execution && ['PENDING', 'QUEUED', 'RUNNING', 'COMMITTING', 'RETRY_SCHEDULED'].includes(result.execution.status)))
          timer = setTimeout(() => { void load(); }, 5000);
      } catch (reason) {
        if (!current()) return;
        const code = reason && typeof reason === 'object' && 'statusCode' in reason ? Number(reason.statusCode) : null;
        if (code !== null && [401, 403, 404].includes(code)) {
          // Terminal rejection of the translation must also invalidate the body
          // epoch of the same identity/session/reading epoch: a late body result
          // must not re-write reading and re-display over the rejected state.
          const message = reason instanceof Error ? reason.message : '读取未完成，请重试。';
          setError(message);
          setTranslationError(reason instanceof Error ? reason.message : '中文读取未完成，请刷新重试。');
          rejectCurrentAccess();
          controller.abort();
        } else {
          setTranslationError(reason instanceof Error ? reason.message : '中文读取未完成，请刷新重试。');
        }
      } finally {
        if (current()) setTranslationRefreshing(false);
      }
    };
    void load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [readingIdentity, currentReading?.parseRunId, needsTranslation, refresh]);
  const persistOriginalLocation = (page: number, unitId: string, revealOriginal: boolean = false) => {
    if (!currentReading?.original || !Number.isSafeInteger(page) || page < 1) return;
    const unit = currentReading.original.source.units.find(item => item.unitId === unitId);
    const sourceRef = unit?.sourceRefIds.find(ref => currentReading.original!.locations.some(
      location => location.sourceRefId === ref && location.pageIndex === page - 1,
    ));
    if (!sourceRef) return;
    // Record the actual registered page choice, including multi-page units.
    // Pin the saved parse before leaving; latest must not reinterpret an old anchor.
    const next = new URLSearchParams(searchParams);
    next.set('parseRunId', currentReading.parseRunId);
    next.set('sourceRef', sourceRef);
    if (revealOriginal) { next.set('panel', 'reader'); setView('dual'); }
    setSearchParams(next, { replace: true });
  };
  const locateTranslationSource = (unitId: string, sourceRef: string) => {
    const location = currentReading?.original?.locations.find(item => item.sourceRefId === sourceRef);
    setTranslationUnitId(unitId);
    // A click inside the current document is the newest navigation decision;
    // keep its exact sourceRef so it can override an older URL anchor.
    setTranslationSourceContext(sourceRef);
    setTranslationLocationRequest((value) => value + 1);
    setView('dual');
    if (location?.pageIndex !== null && location?.pageIndex !== undefined) {
      // The original preview consumes only the physical page, not a guessed box.
      setTranslationPage(location.pageIndex + 1);
    }
  };
  useEffect(() => {
    // A URL sourceRef is a new navigation decision. It must replace a prior
    // in-page translation selection without refetching the document body.
    setTranslationUnitId(null);
    setTranslationPage(null);
    setTranslationSourceContext(requestedSource);
    setTranslationLocationRequest((value) => value + 1);
  }, [requestedSource]);
  const localTranslationLocationIsCurrent = translationSourceContext !== null && translationUnitId !== null;
  const activeSourceRef = localTranslationLocationIsCurrent ? translationSourceContext : requestedSource;
  const selectedLocation = activeSourceRef ? currentReading?.original?.locations.find(item => item.sourceRefId === activeSourceRef) : null;
  const selectedUnit = activeSourceRef ? currentReading?.original?.source.units.find(unit => unit.sourceRefIds.includes(activeSourceRef)) : null;
  const initialLocationUnitId = localTranslationLocationIsCurrent ? translationUnitId : selectedUnit?.unitId;
  const initialLocationPage = localTranslationLocationIsCurrent ? translationPage : selectedLocation?.pageIndex != null ? selectedLocation.pageIndex + 1 : undefined;
  const latest = currentStatus?.latestRun;
  const documentIdentity = documentIdentityPresentation({ documentCode: currentStatus?.documentCode ?? '',
    documentTitle: currentStatus?.documentTitle });
  const documentVersionLabel = currentStatus ? libraryVersionLabel(currentStatus) : '版本未标注';
  const expired = latest ? Date.parse(latest.deadlineAt) <= Date.now() : false;
  const canRestartWithCurrentSettings = Boolean(latest && (latest.status === 'FAILED' || (latest.status !== 'PUBLISHED' && expired)));
  const busy = Boolean(latest && ['RUNNING', 'STAGING'].includes(latest.status) && !expired);
  const currentImportReply = currentStatus && importReply?.documentVersionId === documentVersionId ? importReply : null;
  const checkingImport = Boolean(request.current && currentImportReply?.executionMode === 'LOCAL_MINERU_IMPORT');
  const parseFailure = latest?.errorCode === 'DOCUMENT_PLUGIN_QUOTA_EXHAUSTED'
    ? '文档解析服务额度已用尽。'
    : latest && (latest.errorCode || latest.status === 'FAILED')
      ? '文档解析暂未完成。' : null;
  // The activity entry is only available when the original reading exists for this exact
  // version and parse run; it pins the same parse run instead of the latest one.
  const activityEntryRoute = currentReading?.original ? (() => {
    const query = new URLSearchParams({ parseRunId: currentReading.parseRunId });
    const libraryQuery = searchParams.get('returnLibraryQuery');
    if (libraryQuery)
      query.set('returnLibraryQuery', libraryReadingParams(new URLSearchParams(libraryQuery)).toString());
    return `/document-versions/${encodeURIComponent(documentVersionId)}/activities?${query.toString()}`;
  })() : null;

  async function start(withCurrentSettings = false) {
    if (!currentStatus || parseInFlight.current || sending || (withCurrentSettings ? request.current : currentSettingsRequest.current)) return;
    if (withCurrentSettings && !canRestartWithCurrentSettings && !currentSettingsRequest.current) return;
    const pendingRequest = withCurrentSettings ? currentSettingsRequest : request;
    const version = documentVersionId;
    const navigation = readingIdentity;
    const generation = epoch.current;
    const continuedRun = checkingImport ? currentImportReply : null;
    pendingRequest.current ??= {
      requestId: !withCurrentSettings && latest && (latest.status === 'FAILED' || (latest.status !== 'PUBLISHED' && expired))
        ? documentParseRecoveryRequestId(latest.parseRunId) : `parse-${crypto.randomUUID()}`,
      expectedPublishedRevision: currentStatus.publishedRun?.parseRevision ?? 0,
    };
    parseInFlight.current = true; setSending(true); setParseError(null);
    try {
      const result = await startDocumentParsing(version, pendingRequest.current);
      if (identity.current !== navigation || epoch.current !== generation) return;
      if (continuedRun && (result.documentVersionId !== version || result.parseRunId !== continuedRun.parseRunId ||
          result.parseRevision !== continuedRun.parseRevision || result.executionMode !== 'LOCAL_MINERU_IMPORT'))
        throw new Error('接续结果与原导入版本不一致，请核对原请求。');
      if (result.executionMode === 'LOCAL_MINERU_IMPORT') {
        if (result.documentVersionId !== version) throw new Error('导入结果与指定文档版本不一致，请核对原请求。');
        setImportReply(result);
      } else setImportReply(null);
      // Local imports advance one bounded step per explicit same-request check.
      // Keep the admitted recovery identity; a new request would lose this continuation.
      const continueImport = !withCurrentSettings && result.executionMode === 'LOCAL_MINERU_IMPORT' &&
        ['RUNNING', 'STAGING'].includes(result.status) && Date.parse(result.deadlineAt) > Date.now();
      if (!continueImport) pendingRequest.current = null;
      setRefresh(value => value + 1);
    } catch (reason) {
      if (identity.current !== navigation || epoch.current !== generation) return;
      const statusCode = reason && typeof reason === 'object' && 'statusCode' in reason ? Number(reason.statusCode) : null;
      if (statusCode !== null && [401, 403, 404].includes(statusCode)) {
        rejectCurrentAccess();
        setError(reason instanceof Error ? reason.message : '此文档暂不可访问，请重新核权。');
        return;
      }
      const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : null;
      if (['DOCUMENT_PARSE_REVISION_CONFLICT', 'DOCUMENT_PARSE_ALREADY_RUNNING', 'DOCUMENT_PARSE_RECOVERY_NOT_LATEST'].includes(String(code))) {
        pendingRequest.current = null; setImportReply(null);
      }
      setParseError(reason instanceof Error ? reason.message : '请求结果尚未确认，重试会核对同一请求。');
    } finally {
      if (identity.current === navigation && epoch.current === generation) {
        parseInFlight.current = false; setSending(false);
      }
    }
  }

  const renderImage = useCallback(({ path, alt }: { path: string; src: string; alt: string }) => currentReading
    ? <DocumentParsedImage documentVersionId={documentVersionId} parseRunId={currentReading.parseRunId} path={path} alt={alt} /> : null,
  [documentVersionId, currentReading?.parseRunId]);

  const toolbarIdentity = <DocumentReadingIdentity
    number={currentStatus ? documentIdentity.documentNumber : '文档阅读'}
    title={currentStatus ? documentIdentity.documentTitle : '正在读取文档…'}
    version={documentVersionLabel} current={currentStatus?.selectedVersionIsCurrent} />;
  const toolbarLinks = <DocumentReadingSavedLinks links={savedLinks} panelNavigation={{
    active: workbenchPanel.panel, routes: {
      reader: documentWorkbenchPanelRoute(searchParams, 'reader'),
      interpretation: pinnedWiki ? documentWorkbenchPanelRoute(searchParams, 'interpretation') : undefined,
      assessment: documentWorkbenchPanelRoute(searchParams, 'assessment'),
      wiki: documentWorkbenchPanelRoute(searchParams, 'wiki'),
    },
  }} />;
  const savedPanels = <><DocumentSavedWorkPanels key={JSON.stringify([savedLinks.scopeIdentity,
    savedLinks.assessment?.result?.sourceResultId, savedLinks.assessment?.result?.revision])}
    active={workbenchPanel.panel} links={savedLinks} onRetry={savedLinks.refreshSavedWork}
    onRejected={savedLinks.rejectSavedWork} />
    <RetainedWorkbenchPanel key={JSON.stringify([readingIdentity, wikiSemantic, wikiRevision, wikiRunRef,
      currentReading?.original?.binding])} active={workbenchPanel.panel === 'interpretation'}>
      <section className="document-saved-work-panel" aria-label="同版本文档解读">
        <div className="document-saved-work-scroll">
          {pinnedWiki && currentReading?.original ? <DocumentWikiReading documentVersionId={documentVersionId} parseRunId={requestedRun!}
            semanticRevision={Number(wikiSemantic)} readingRevision={Number(wikiRevision)} readingRunRef={wikiRunRef}
            originalBinding={currentReading.original.binding}
            onAccessRejected={rejectCurrentAccess} onLocate={unitId => {
              const unit = currentReading.original!.source.units.find(item => item.unitId === unitId);
              const location = unit && currentReading.original!.locations.find(item => unit.sourceRefIds.includes(item.sourceRefId));
              if (location) persistOriginalLocation(location.pageIndex + 1, unitId, true);
            }} /> : <p role="status">{pinnedWiki ? '正在读取同版原文与解读…' : '请从文档解读链接打开确切保存修订。'}</p>}
        </div>
      </section>
    </RetainedWorkbenchPanel>
  </>;
  const toolbarMore = <DocumentReadingMore>
    <h2>文档信息与处理</h2>
    {currentStatus ? <>
      <p className="document-reading-full-title">{documentIdentity.documentTitle}</p>
      <dl>
        <div><dt>业务版次</dt><dd>{documentVersionLabel} · {currentStatus.selectedVersionIsCurrent ? '库内当前版本' : '历史版本'}</dd></div>
        <div><dt>原始文件</dt><dd>{currentStatus.originalFilename || '未标注'}</dd></div>
      </dl>
    </> : null}
    {currentReading ? <p>阅读版本 {currentReading.parseRevision} · {currentReading.parser.name} {currentReading.parser.version}</p> : null}
    {requestedRun && currentReading ? <p>{currentStatus?.publishedRun?.parseRunId !== requestedRun ? '历史解析版本' : '指定解析版本'}：固定读取版本 {currentReading.parseRevision}。
      {' '}<Link to={`/document-versions/${encodeURIComponent(documentVersionId)}`}>查看最新版本</Link></p> : null}
    {currentReading?.titleEnhancement.status === 'FAILED' ? <p>标题层级增强未完成，当前显示解析器标题。{currentReading.titleEnhancement.code}</p> : null}
    {unboundEvidence ? <p>此保存依据未提供工作项身份。</p> : null}
    {activityEntryRoute ? <p><Link to={activityEntryRoute}>活动阅读</Link></p> : null}
    {currentStatus && !currentStatus.runtimeAvailable ? <p>
      {currentStatus.runtime?.state === 'FAILED' ? '最近的文档处理未完成。' : '官方文档解析插件尚未配置。'}
    </p> : null}
    {latest ? <p role="status">{parseFailure ?? (latest.status === 'PUBLISHED' ? `解析版本 ${latest.parseRevision} 已发布。` :
      latest.status === 'FAILED' ? `解析未完成：${latest.errorCode ?? '请重试或联系维护人员'}` :
      expired ? '执行期限已过。' : latest.waitingForLocalWorker ? '等待本机解析器接续。' : latest.status === 'STAGING' ? `正在保存并核验产物，已核验 ${latest.verifiedArtifacts} 个文件。` : '正在解析原件。')}</p> : null}
        <div className="document-reading-actions">
          <Button onClick={() => { void start(); }} disabled={!currentStatus?.runtimeAvailable || (busy && !request.current) || sending || Boolean(currentSettingsRequest.current)}>
            {sending ? '正在受理…' : checkingImport ? '核对同一导入请求（继续一步）' : request.current ? '核对解析请求' : busy ? (parseFailure ? '等待接续' : latest?.waitingForLocalWorker ? '等待本机解析' : '正在解析…') : currentStatus?.publishedRun ? '重新解析' : '解析文档'}
          </Button>
          {(canRestartWithCurrentSettings || currentSettingsRequest.current) && <Button variant="outline"
            onClick={() => { void start(true); }} disabled={!currentStatus?.runtimeAvailable || sending || Boolean(request.current)}>
            {currentSettingsRequest.current ? '核对当前设置请求' : '按当前设置重新解析'}
          </Button>}
          <Button variant="outline" onClick={() => setRefresh(value => value + 1)}>刷新</Button>
          <DocumentOriginalPreview documentVersionId={documentVersionId}>打开原件</DocumentOriginalPreview>
        </div>
        {currentImportReply && <p role={currentImportReply.status === 'FAILED' ||
            (currentImportReply.status !== 'PUBLISHED' && Date.parse(currentImportReply.deadlineAt) <= Date.now()) ? 'alert' : 'status'}>
          导入版本 {currentImportReply.parseRevision} 的本次回执：已核验 {currentImportReply.verifiedArtifacts} 个文件。
          {currentImportReply.status === 'FAILED' ? `解析未完成（${currentImportReply.errorCode ?? 'DOCUMENT_PARSE_FAILED'}）。`
            : currentImportReply.status === 'PUBLISHED' ? '已发布。'
              : Date.parse(currentImportReply.deadlineAt) <= Date.now() ? '执行期限已过。'
                : '处理中。'}
          执行期限：{currentImportReply.deadlineAt}。
        </p>}
        {currentStatus && !sending && !request.current && !currentSettingsRequest.current ? <LocalMineruImport key={documentVersionId} documentVersionId={documentVersionId}
          expectedPublishedRevision={currentStatus.publishedRun?.parseRevision ?? 0} onImported={() => setRefresh(value => value + 1)} /> : null}
        {latest?.errorCode && <p>处理原因：{latest.errorCode}</p>}
  </DocumentReadingMore>;
  const toolbarNotices = <>
    {workbenchPanel.error ? <p role="alert">{workbenchPanel.error}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {currentStatus && parseError ? <p role="alert">{parseError}</p> : null}
    {savedLinks.error ? <p className="document-reading-link-error" role="alert">{savedLinks.error}
      {' '}<Button size="sm" variant="ghost" onClick={() => setRefresh(value => value + 1)}>重试</Button></p> : null}
    {wikiRequested && !pinnedWiki ? <p role="alert">文档 Wiki 的确切版本参数不完整或有重复，请从 Wiki 成员链接重新打开。</p> : null}
    {currentReading && activeSourceRef ? <aside className="document-reading-location" aria-label="检索命中来源">
      {selectedLocation ? <p role="status">已定位原文{selectedLocation.pageIndex !== null ? ` · 第 ${selectedLocation.pageIndex + 1} 页` : ' · 无物理页定位'}</p>
        : <p role="alert">此解析版本中未找到指定来源。</p>}
    </aside> : null}
  </>;

  return <main className={`document-version-reading document-version-reading-compact${currentReading?.original ? ' is-source-workspace' : ''}`}>
    {!currentReading?.original ? <>
      <header className="document-reading-standalone-toolbar">
        {toolbarIdentity}{toolbarLinks}
        <Button asChild size="sm" variant="outline"><Link to={returnTarget?.route ?? '/library?mode=document'}>
          {returnTarget?.label ?? '返回文档库'}</Link></Button>
        {toolbarMore}
      </header>
      {toolbarNotices}
    </> : null}
    {TDMS_SOURCE_UI_ENABLED && (currentStatus || currentReading) && !rejectedRef.current ? <TdmsSourceEntry
      key={readingIdentity} context={{ documentVersionId }} enabled={TDMS_SOURCE_UI_ENABLED}
      onAccessRejected={() => {
        rejectCurrentAccess(); setError('此来源暂不可读取，文档与译文已隐藏，请重新核权。');
      }}
    /> : null}
    {currentReading ? <>
      {currentReading.original ? <>
        <DocumentSourceReadingWorkspace
          key={`${currentReading.documentVersionId}:${currentReading.parseRunId}`}
          original={currentReading.original}
          documentVersionId={documentVersionId}
          mode={view}
          onModeChange={(mode) => { setView(mode); if (mode !== 'bilingual' && mode !== 'translation') setTranslationPage(null); }}
          returnRoute={returnTarget?.route ?? '/library?mode=document'}
          returnLabel={returnTarget?.label ?? '返回原处'}
          title={currentStatus ? `${documentIdentity.documentNumber} · ${documentIdentity.documentTitle}` : '文档阅读'}
          toolbar={{ identity: toolbarIdentity, links: toolbarLinks, more: toolbarMore, notices: toolbarNotices }}
          activePanel={workbenchPanel.panel} savedPanels={savedPanels}
          initialPage={initialLocationPage}
          initialUnitId={initialLocationUnitId}
          initialLocationRequest={translationLocationRequest}
          onLocationSelect={persistOriginalLocation}
          bilingualContent={<section aria-label="已保存中文阅读">
            {currentReading && <div ref={translationContinuationRef} tabIndex={-1}><DocumentTranslationContinuation
              key={`${readingIdentity}:${currentReading.parseRunId}`}
              documentVersionId={documentVersionId} parseRunId={currentReading.parseRunId}
              observationKey={`${refresh}:${currentTranslation?.execution?.status ?? ''}:${currentTranslation?.execution?.errorCode ?? ''}`}
              onContinued={() => setRefresh(value => value + 1)}
              onAccessRejected={(message) => { rejectCurrentAccess(); setError(message); }} /></div>}
            {translationError && <p role="alert">{translationError}</p>}
            {currentTranslation && !currentTranslation.execution && currentTranslation.translation.status === 'UNAVAILABLE' &&
              <p role="status">此解析版本尚无中文任务记录；如已选择中文交付，当前尚未受理。</p>}
            {currentTranslation?.execution && <p role="status">{translationExecutionLabel(currentTranslation.execution.status)}{currentTranslation.execution.errorCode ? `（${currentTranslation.execution.errorCode}）` : ''}</p>}
            <DocumentTranslationRuntimeDiagnostic read={currentTranslation}
              documentVersionId={documentVersionId} parseRunId={currentReading.parseRunId}
              scopeKey={`${readingIdentity}:${epoch.current}:${currentReading.parseRunId}`}
              observedAt={translationObservedAt} error={translationError} refreshing={translationRefreshing}
              onRefresh={() => setRefresh(value => value + 1)}
              onOpenContinuation={() => { translationContinuationRef.current?.scrollIntoView({ block: 'center' }); translationContinuationRef.current?.focus(); }}
              onLocateRevision={revisionId => setTranslationLocateRevision(previous => ({ revisionId, request: (previous?.request ?? 0) + 1 }))} />
            {currentTranslation ? <SemanticBilingualReader translation={currentTranslation.translation} onSourceRefSelect={locateTranslationSource}
              locateRevision={translationLocateRevision}
              mode={view === 'translation' ? 'translation' : 'bilingual'} />
              : <p role="status">正在核对中文交付状态…</p>}
          </section>}
        />
      </> : <div hidden={workbenchPanel.panel !== 'reader'}><MineruMarkdownReader markdown={currentReading.markdown} assets={currentReading.assets} projection={currentReading.projection}
        renderImage={renderImage} onLocateSource={setSource} /></div>}
      {source && <aside className="document-reading-source" aria-label="原件来源">
        <strong>原件第 {source.pageIndex + 1} 页</strong>
        <DocumentOriginalPreview documentVersionId={documentVersionId} page={source.pageIndex + 1}>打开对应原件页</DocumentOriginalPreview>
        <Button variant="ghost" onClick={() => setSource(null)}>关闭来源</Button>
      </aside>}
    </> : workbenchPanel.panel === 'reader' ? <p role="status">{error ? '内容未能读回，请查看上方错误或刷新重试。'
      : currentStatus ? requestedRun ? '指定解析版本尚未读回；请查看读取状态或刷新重试。'
        : currentStatus.publishedRun ? '正在读取已发布的解析内容…'
          : '尚无已发布的解析内容。可以先查看原件。'
        : '正在读取文档状态…'}</p> : null}
    {!currentReading?.original && workbenchPanel.panel !== 'reader' ? savedPanels : null}
  </main>;
}

function translationExecutionLabel(status: string) {
  const labels: Record<string, string> = { PENDING: '中文等待开始', QUEUED: '中文排队中', RUNNING: '正在生成中文，已保存段落可阅读',
    COMMITTING: '正在保存中文结果', RETRY_SCHEDULED: '等待续接，已保存段落可阅读', SUCCEEDED: '本次中文处理已结束，覆盖范围见下方',
    FAILED: '中文处理未完成，已保存段落保留', TIMED_OUT: '中文处理超时，已保存段落保留', CANCELLED: '中文处理已取消，已保存段落保留',
    CONFLICT: '原文已变化，请刷新读取当前版本', WAITING_INPUT: '中文处理等待补充输入' };
  return labels[status] ?? `中文处理状态：${status}`;
}
