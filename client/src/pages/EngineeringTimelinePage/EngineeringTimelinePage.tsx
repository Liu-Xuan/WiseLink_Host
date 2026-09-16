import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Clock, Compass, Network } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { readDocumentActivityReading, readDocumentParsingStatus, subscribeCanonicalHostClientSession } from '@client/src/api/canonical-host';
import type { DocumentActivityReadingResponse } from '@shared/document-activity.interface';
import type { DocumentOriginalBinding } from '@shared/document-original.interface';
import { activityEntryPins, activityEntryReason, loadActivityEntry, validateActivityEntry } from '@client/src/pages/DocumentParsingPage/document-activity-entry';
import { activityReadingParams, activityReadingReturnParams, revisionTextPin } from '@client/src/features/matter/reading-return';
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
  const blocker = documentError || activityEntryReason(entry);
  const [sessionRevision, setSessionRevision] = useState(0);
  // Statement and anchor are view selection, not candidate identity. Keeping them
  // out of the read key preserves the loaded candidate and graph camera while a
  // user explores nodes inside the same exact saved candidate.
  const identity = JSON.stringify([documentVersionId, pins.parseRunId, pins.candidateRevision, pins.runRef, blocker, sessionRevision]);
  const [state, setState] = useState<TimelineReadState | null>(null);
  const epoch = useRef(0);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const visible = state?.identity === identity ? state : null;
  const reading = !blocker ? visible?.reading ?? null : null;
  const error = blocker || visible?.error || null;
  const loading = Boolean(!blocker && documentVersionId && !visible);

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
          const query = new URLSearchParams(result.replaceQuery); query.set('documentVersionId', documentVersionId);
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
    {view === 'graph' && reading?.candidate ? <DocumentActivityGraphView reading={reading} selectedStatementId={pins.statementId} selectedAnchorId={pins.anchor} onSelectLocation={selectLocation} onReturnTimeline={() => navigate(pageRoute(searchParams, '/timeline'))} /> : <DocumentActivityTimelineView reading={reading} selectedStatementId={pins.statementId} onSelectStatement={selectStatement} onOpenReading={openReading} onOpenAnchor={openReading} onNavigateGraph={openGraph} loading={loading} error={error} hasExactSource={Boolean(documentVersionId && pins.parseRunId)} />}
    {!documentVersionId && !error ? <Link to="/library?mode=document">选择文档版本</Link> : null}
    {reading?.candidate && (pins.statementId || pins.anchor) ? <DocumentActivityReadingView binding={reading.binding} familyId={reading.familyId} candidate={reading.candidate} selectedStatementId={pins.statementId} selectedAnchorId={pins.anchor} returnParamsFor={returnParamsFor} onSelectStatement={selectStatement} onSelectAnchor={selectAnchor} /> : null}
  </main>;
}
