import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Clock, Compass, Network } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { getEngineeringMatter } from '@client/src/api/engineering-matter';
import { selectMatterTimelineSources } from '@client/src/features/navigation/shell-utils';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import { readDocumentActivityReading, readDocumentParsingStatus, subscribeCanonicalHostClientSession, getCanonicalHostClientSessionGeneration, getCanonicalLibraryDocuments } from '@client/src/api/canonical-host';
import type { DocumentActivityReadingResponse } from '@shared/document-activity.interface';
import type { DocumentOriginalBinding } from '@shared/document-original.interface';
import { activityEntryPins, activityEntryReason, loadActivityEntry, validateActivityEntry } from '@client/src/pages/DocumentParsingPage/document-activity-entry';
import { activityReadingParams, activityReadingReturnParams, activityWindowPin, revisionTextPin } from '@client/src/features/matter/reading-return';
import type { ActivityTimelineWindow } from '@client/src/features/trinity/document-activity-timeline';
import DocumentActivityReadingView from '@client/src/pages/DocumentParsingPage/DocumentActivityReadingView';
import DocumentActivityGraphView from '@client/src/features/trinity/DocumentActivityGraphView';
import DocumentActivityTimelineView from '@client/src/features/trinity/DocumentActivityTimelineView';

export interface EngineeringTimelinePageProps { view?: 'timeline' | 'graph'; onNavigateGraph?: (statementId: string) => void }
interface TimelineReadState { identity: string; reading: DocumentActivityReadingResponse | null; error: string | null }

export default function EngineeringTimelinePage({ view = 'timeline', onNavigateGraph }: EngineeringTimelinePageProps) {
  const pagePath = view === 'graph' ? '/activity-graph' : '/timeline';
  const route = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const documentPin = revisionTextPin(searchParams, 'documentVersionId');
  const documentVersionId = route.documentVersionId || (documentPin.state === 'ok' ? documentPin.value : '');
  const documentError = documentPin.state !== 'ok' && documentPin.state !== 'absent'
    ? '文档版本参数为空、重复或不合法。' : route.documentVersionId && documentPin.state === 'ok' && route.documentVersionId !== documentPin.value
      ? '路径与查询的文档版本不一致。' : null;
  const entry = useMemo(() => validateActivityEntry(searchParams), [searchParams]);
  const pins = activityEntryPins(entry);
  // The window is a presentation choice, not candidate identity: it gates rendering
  // but stays out of the read key so switching windows never re-reads the candidate.
  const windowPin = activityWindowPin(searchParams);
  const windowMode: ActivityTimelineWindow = windowPin.state === 'ok' ? windowPin.value : 'all';
  const windowError = windowPin.state === 'duplicate'
    ? '时间窗参数出现重复，只允许 all 或 current-year。'
    : windowPin.state === 'empty'
      ? '时间窗参数为空，只允许 all 或 current-year。'
      : windowPin.state === 'invalid'
        ? '时间窗参数不在允许范围内，只允许 all 或 current-year。'
        : null;
  const blocker = documentError || windowError || activityEntryReason(entry);
  const matterIdPin = revisionTextPin(searchParams, 'matterId');
  const anyActivityPin =
    searchParams.has('parseRunId') ||
    searchParams.has('candidateRevision') ||
    searchParams.has('runRef') ||
    searchParams.has('statementId') ||
    searchParams.has('anchor');
  const orphanPinBlocker =
    !documentVersionId && !blocker && anyActivityPin
      ? '时间声明、候选或解析版本缺少所属文档版本，请从准确文档入口重新进入。'
      : null;
  const matterIdInvalid =
    matterIdPin.state !== 'ok' && matterIdPin.state !== 'absent'
      ? '事项标识为空、重复或不合法，请从准确事项入口重新进入。'
      : null;
  const matterIdentity: 'absent' | 'invalid' | 'matter' =
    matterIdPin.state === 'ok'
      ? 'matter'
      : matterIdPin.state !== 'absent'
        ? 'invalid'
        : 'absent';
  const [sessionRevision, setSessionRevision] = useState(0);
  // Statement and anchor are view selection, not candidate identity. Keeping them
  // out of the read key preserves the loaded candidate and graph camera while a
  // user explores nodes inside the same exact saved candidate.
  const identity = JSON.stringify([documentVersionId, pins.parseRunId, pins.candidateRevision, pins.runRef, blocker, sessionRevision]);
  const [state, setState] = useState<TimelineReadState | null>(null);
  const epoch = useRef(0);
  const currentIdentity = useRef(identity);
  const currentSearchParams = useRef(searchParams);
  currentIdentity.current = identity;
  currentSearchParams.current = searchParams;
  const visible = state?.identity === identity ? state : null;
  const mainBlocker = blocker || orphanPinBlocker;
  const reading = !mainBlocker ? visible?.reading ?? null : null;
  const error = mainBlocker || visible?.error || null;
  const loading = Boolean(!mainBlocker && documentVersionId && !visible);

  useEffect(() => subscribeCanonicalHostClientSession(() => {
    epoch.current += 1;
    setState(null);
    setSessionRevision((value) => value + 1);
  }), []);

  function pageRoute(query: URLSearchParams, target = pagePath): string {
    const next = activityReadingParams(query);
    if (documentVersionId) next.set('documentVersionId', documentVersionId);
    return `${target}?${next}`;
  }

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++epoch.current;
    const current = () => !controller.signal.aborted && currentIdentity.current === identity && epoch.current === generation;
    if (blocker || !documentVersionId) return () => controller.abort();
    void (async () => {
      try {
        const result = await loadActivityEntry({ documentVersionId, entry, baseParams: searchParams, deps: { readParsingStatus: readDocumentParsingStatus, readActivityReading: readDocumentActivityReading }, signal: controller.signal, current });
        if (!current()) return;
        if (result.replaceQuery) {
          const discovered = new URLSearchParams(result.replaceQuery);
          const query = activityReadingParams(currentSearchParams.current);
          for (const key of ['parseRunId', 'candidateRevision', 'runRef'] as const) {
            const value = discovered.get(key);
            if (value) query.set(key, value); else query.delete(key);
          }
          query.set('documentVersionId', documentVersionId);
          navigate(`${pagePath}?${query}`, { replace: true });
          return;
        }
        setState({ identity, reading: result.reading, error: result.error || result.unreadable });
      } catch (cause) {
        if (current()) setState({ identity, reading: null, error: cause instanceof Error ? cause.message : '时间轴读取未完成。' });
      }
    })();
    return () => controller.abort();
  }, [identity, blocker, documentVersionId, pagePath]);

  const selectLocation = (statementId: string | null, anchorId: string | null) => {
    const query = activityReadingParams(searchParams);
    if (statementId) query.set('statementId', statementId); else query.delete('statementId');
    if (anchorId) query.set('anchor', anchorId); else query.delete('anchor');
    navigate(pageRoute(query), { replace: true });
  };
  const openGraph = (statementId: string) => {
    if (onNavigateGraph) { onNavigateGraph(statementId); return; }
    const query = activityReadingParams(searchParams);
    if (pins.statementId !== statementId) query.delete('anchor');
    query.set('statementId', statementId);
    navigate(pageRoute(query, '/activity-graph'));
  };
  const selectStatement = (statementId: string) => {
    const query = activityReadingParams(searchParams); query.set('statementId', statementId); query.delete('anchor');
    navigate(pageRoute(query), { replace: true });
  };
  const selectAnchor = (anchorId: string) => {
    const query = activityReadingParams(searchParams); query.set('anchor', anchorId);
    navigate(pageRoute(query), { replace: true });
  };
  const changeWindow = (next: ActivityTimelineWindow) => {
    const query = activityReadingParams(searchParams);
    query.set('window', next);
    navigate(pageRoute(query), { replace: true });
  };
  const returnParamsFor = (binding: DocumentOriginalBinding, statementId: string | null, anchorId: string | null = null) => {
    if (!reading?.candidate || binding.documentVersionId !== reading.binding.documentVersionId || binding.parseRunId !== reading.binding.parseRunId) return null;
    const query = activityReadingParams(searchParams);
    query.set('parseRunId', reading.binding.parseRunId);
    query.set('candidateRevision', String(reading.candidate.candidateRevision));
    query.set('runRef', reading.candidate.runRef);
    if (statementId) query.set('statementId', statementId); else query.delete('statementId');
    if (anchorId) query.set('anchor', anchorId); else query.delete('anchor');
    return activityReadingReturnParams(query.toString(), binding.documentVersionId, view).toString();
  };
  const openReading = (statementId: string, anchorId?: string) => {
    if (!reading?.candidate) return;
    const query = activityReadingParams(searchParams); query.set('statementId', statementId);
    if (anchorId) query.set('anchor', anchorId); else query.delete('anchor');
    const back = returnParamsFor(reading.binding, statementId, anchorId || null);
    if (back) {
      query.delete('returnLibraryQuery');
      new URLSearchParams(back).forEach((value, key) => query.set(key, value));
    }
    navigate(`/document-versions/${encodeURIComponent(documentVersionId)}/activities?${query}`);
  };
  return <main className="trinity-activity-page">
    <header className="activity-page-head">
      <div><h1>{view === 'graph' ? '活动来源关系' : '工程时间轴'}</h1><p>按当前文档版本已保存的时间声明阅读；保存时间不替代发生、取得或生效时间。</p></div>
      <nav className="activity-view-nav" aria-label="三视图入口">
        <Button variant="ghost" onClick={() => navigate('/situation')}><Compass size={15} />态势</Button>
        <Button variant="ghost" className={view === 'timeline' ? 'active' : ''} onClick={() => navigate(pageRoute(searchParams, '/timeline'))}><Clock size={15} />时间轴</Button>
        <Button variant="ghost" className={view === 'graph' ? 'active' : ''} onClick={() => navigate(pageRoute(searchParams, '/activity-graph'))}><Network size={15} />图谱</Button>
      </nav>
    </header>
    <div className="activity-scope-bar">
      <strong>{documentVersionId ? `文档版本 ${documentVersionId}` : '尚未选择文档版本'}</strong>
      <span>{pins.parseRunId ? `解析版本 ${pins.parseRunId}` : '将从当前已发布解析版本发现已保存候选'}</span>
    </div>
    {documentVersionId || mainBlocker ? (
      view === 'graph' && reading?.candidate ? <DocumentActivityGraphView reading={reading} selectedStatementId={pins.statementId} selectedAnchorId={pins.anchor} onSelectLocation={selectLocation} onReturnTimeline={() => navigate(pageRoute(searchParams, '/timeline'))} /> : <DocumentActivityTimelineView reading={reading} selectedStatementId={pins.statementId} onSelectStatement={selectStatement} onOpenReading={openReading} onOpenAnchor={openReading} onNavigateGraph={openGraph} loading={loading} error={error} hasExactSource={Boolean(documentVersionId && pins.parseRunId)} window={windowMode} onWindowChange={changeWindow} />
    ) : matterIdentity === 'invalid' ? (
      <div className="activity-timeline-empty" role="alert">
        <h2>事项标识不合法</h2>
        <p>{matterIdInvalid}</p>
      </div>
    ) : matterIdentity === 'matter' && matterIdPin.state === 'ok' ? (
      <TimelineMatterSourceResolver
        matterId={matterIdPin.value}
        pagePath={pagePath}
        searchParams={searchParams}
      />
    ) : (
      <TimelineDefaultDocumentResolver pagePath={pagePath} searchParams={searchParams} />
    )}
    {reading?.candidate && (pins.statementId || pins.anchor) ? <DocumentActivityReadingView binding={reading.binding} familyId={reading.familyId} candidate={reading.candidate} selectedStatementId={pins.statementId} selectedAnchorId={pins.anchor} returnParamsFor={returnParamsFor} onSelectStatement={selectStatement} onSelectAnchor={selectAnchor} /> : null}
  </main>;
}

function TimelineDefaultDocumentResolver({ pagePath, searchParams }: { pagePath: string; searchParams: URLSearchParams }) {
  const navigate = useNavigate();
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const [state, setState] = useState<'loading' | 'empty' | 'error'>('loading');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const epochRef = useRef(0);

  useEffect(() => {
    if (authenticationRequired) return;
    const controller = new AbortController();
    const epoch = ++epochRef.current;
    const session = getCanonicalHostClientSessionGeneration();
    setState('loading');
    void (async () => {
      try {
        const catalog = await getCanonicalLibraryDocuments(
          cursor ? { limit: 24, cursor } : { limit: 24 },
          controller.signal,
        );
        if (controller.signal.aborted || epochRef.current !== epoch || session !== getCanonicalHostClientSessionGeneration()) return;
        for (let index = 0; index < catalog.items.length; index += 1) {
          const version = catalog.items[index].versions.find(item => item.selectedVersionIsCurrent);
          if (version?.documentVersionId) {
            const query = activityReadingParams(searchParams);
            query.set('documentVersionId', version.documentVersionId);
            navigate(`${pagePath}?${query}`, { replace: true });
            return;
          }
        }
        setNextCursor(catalog.nextCursor);
        setState('empty');
      } catch (reason) {
        if (controller.signal.aborted || epochRef.current !== epoch) return;
        logger.error('工程时间轴默认文档目录读取失败', reason);
        setState('error');
      }
    })();
    return () => controller.abort();
  }, [pagePath, sessionGeneration, authenticationRequired, reloadKey, cursor, navigate, searchParams]);

  if (authenticationRequired) {
    return (
      <div className="activity-timeline-empty">
        <h2>请先登录</h2>
        <p>登录后才能读取当前账号有权访问的文档版本，再打开工程时间轴。</p>
      </div>
    );
  }
  if (state === 'loading') {
    return (
      <div className="activity-timeline-empty" role="status">
        <p>正在读取当前账号可访问的文档目录…</p>
      </div>
    );
  }
  if (state === 'empty') {
    return (
      <div className="activity-timeline-empty">
        <h2>本页未取到当前版本</h2>
        <p>
          工程时间轴基于某个确切文档版本已保存的时间活动候选。已读取当前账号文档目录的{nextCursor ? '当前页' : '最后一页'}，本页没有标记为当前版本的文档，这不代表当前账号没有任何文档版本。
          {nextCursor ? '目录还有后续页，可继续读取以扩大范围。' : '当前已读到目录末尾。'}
        </p>
        <div>
          {nextCursor ? (
            <Button variant="outline" onClick={() => { setCursor(nextCursor); setReloadKey(value => value + 1); }}>继续读取下一页</Button>
          ) : null}
          <Button variant="outline" onClick={() => navigate('/library?mode=document')}>去资料库</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="activity-timeline-empty" role="alert">
      <h2>目录读取受阻</h2>
      <p>文档目录服务暂时不可用，已停止而不是换用其他文档，请稍后重试。</p>
      <Button variant="outline" onClick={() => setReloadKey(value => value + 1)}>重试</Button>
    </div>
  );
}

function TimelineMatterSourceResolver({ matterId, pagePath, searchParams }: { matterId: string; pagePath: string; searchParams: URLSearchParams }) {
  const navigate = useNavigate();
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const [state, setState] = useState<'loading' | 'empty' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const epochRef = useRef(0);

  useEffect(() => {
    if (authenticationRequired) return;
    const controller = new AbortController();
    const epoch = ++epochRef.current;
    const session = getCanonicalHostClientSessionGeneration();
    setState('loading');
    void (async () => {
      try {
        const read = await getEngineeringMatter(matterId, controller.signal);
        if (controller.signal.aborted || epochRef.current !== epoch || session !== getCanonicalHostClientSessionGeneration()) return;
        const source = selectMatterTimelineSources(read.catalog.entries)[0];
        if (source) {
          const query = activityReadingParams(searchParams);
          query.set('documentVersionId', source.document.documentVersionId);
          navigate(`${pagePath}?${query}`, { replace: true });
          return;
        }
        setState('empty');
      } catch (reason) {
        if (controller.signal.aborted || epochRef.current !== epoch) return;
        logger.error('工程时间轴事项来源读取失败', reason);
        setState('error');
      }
    })();
    return () => controller.abort();
  }, [matterId, pagePath, sessionGeneration, authenticationRequired, reloadKey, navigate, searchParams]);

  if (authenticationRequired) {
    return (
      <div className="activity-timeline-empty">
        <h2>请先登录</h2>
        <p>登录后才能读取该事项已登记的资料，再打开工程时间轴。</p>
      </div>
    );
  }
  if (state === 'loading') {
    return (
      <div className="activity-timeline-empty" role="status">
        <p>正在读取该事项已登记的资料…</p>
      </div>
    );
  }
  if (state === 'empty') {
    return (
      <div className="activity-timeline-empty">
        <h2>该事项没有已登记的文档版本</h2>
        <p>工程时间轴只阅读该事项实际登记来源的时间声明；当前事项尚未登记可用于时间轴的文档版本，不会改读其他文档。</p>
        <Button variant="outline" onClick={() => navigate('/library?mode=matter')}>去资料库</Button>
      </div>
    );
  }
  return (
    <div className="activity-timeline-empty" role="alert">
      <h2>事项来源读取受阻</h2>
      <p>无法读取该事项已登记的资料，已停止而不是换用其他文档，请稍后重试。</p>
      <Button variant="outline" onClick={() => setReloadKey(value => value + 1)}>重试</Button>
    </div>
  );
}
