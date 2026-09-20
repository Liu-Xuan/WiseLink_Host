import { suiteDocumentPerspective } from './suite-document-perspective';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { graphReadingParams, readGraphReadingState, withGraphReturn, type SuiteGraphReadingState } from './suite-graph-return';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { matterDocumentRoute, matterReferencedWorkRoute, matterWorkRoute } from '@client/src/features/matter/matter-navigation';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import { getEngineeringMatterDirectory } from '@client/src/api/engineering-matter';
import { getCanonicalLibraryDocuments } from '@client/src/api/canonical-host';
import type { CanonicalLibraryDocumentSummary, EngineeringMatterDirectoryResponse } from '@shared/api.interface';
import { useSuiteMatterGraph } from './useSuiteMatterGraph';
import { useSuiteGraphDirectoryPage } from './useSuiteGraphDirectoryPage';
import { useSuiteGraphSources } from './useSuiteGraphSources';
import SuiteMatterGraphView, { type SuiteMatterGraphPerspective } from './SuiteMatterGraphView';
import {
  appendSuiteGraphActivityStatements,
  appendSuiteGraphCatalogDocuments,
  type SuiteMatterGraphRead,
  type SuiteMatterGraphTarget,
} from './suite-matter-graph';
import { buildSuiteGraphTimeline, type SuiteGraphTimelineEvent } from './suite-graph-timeline';
import { buildSuiteDomainGraph, buildSuitePanoramaGraph } from './suite-graph-perspectives';

export default function SuiteMatterGraphPage({matterId}: {matterId: string}) {
  const [params] = useSearchParams();
  const {sessionGeneration, authenticationRequired} = useCurrentUserSession();
  const workRefs = params.getAll('workRef');
  const workRef = workRefs[0] ?? '';
  if (workRefs.length > 1 || (workRefs.length === 1 && !workRef.trim())) return <p role="alert">指定工作身份无效，请从准确工作重新进入。</p>;
  return <MatterGraphContent key={JSON.stringify([matterId, workRef, sessionGeneration])} matterId={matterId} workRef={workRef} session={sessionGeneration} denied={authenticationRequired} />;
}

function MatterGraphContent({matterId, workRef, session, denied}: {matterId: string; workRef: string; session: number; denied: boolean}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const paramsString = params.toString();
  const [navigation, setNavigation] = useState(() => ({key: 0, state: readGraphReadingState(params)}));
  const displayState = useRef<SuiteGraphReadingState>(navigation.state);
  const structuralRef = useRef('');
  const lastWritten = useRef(paramsString);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [perspective, setPerspective] = useState<SuiteMatterGraphPerspective>(navigation.state.perspective ?? 'matter');
  const read = useSuiteMatterGraph(matterId, workRef, session, denied);
  const historical = Boolean(read.graph?.historical);
  const catalog = useMemo(() => read.workspace?.matter.catalog.entries ?? [], [read.workspace]);
  const sourceCatalog = useMemo(() => historical ? [] : catalog, [historical, catalog]);
  const sources = useSuiteGraphSources({
    catalog: sourceCatalog,
    enabled: !historical,
    session,
    denied,
    restorePins: navigation.state.eventPins,
  });
  const matterGraph = useMemo<SuiteMatterGraphRead | null>(() => {
    if (!read.graph) return null;
    const withCatalog = appendSuiteGraphCatalogDocuments(read.graph, catalog);
    return appendSuiteGraphActivityStatements(withCatalog, sources.activities);
  }, [read.graph, catalog, sources.activities]);
  const documentsGraph = useMemo(() => matterGraph ? suiteDocumentPerspective(matterGraph) : null, [matterGraph]);
  const timeline = useMemo(
    () => buildSuiteGraphTimeline({ read: matterGraph, catalog, activities: sources.activities, revision: read.revision }),
    [matterGraph, catalog, sources.activities, read.revision],
  );
  const loadDomain = useCallback((cursor: string | undefined, signal: AbortSignal) => getCanonicalLibraryDocuments({ limit: 50, cursor }, signal), []);
  const loadPanorama = useCallback((cursor: string | undefined, signal: AbortSignal) => getEngineeringMatterDirectory({ limit: 20, cursor }, signal), []);
  const domainKey = useCallback((item: CanonicalLibraryDocumentSummary) => item.familyId, []);
  const panoramaKey = useCallback((item: EngineeringMatterDirectoryResponse['items'][number]) => item.matterId, []);
  const domainPage = useSuiteGraphDirectoryPage(perspective === 'domain' && !historical && !denied, session, loadDomain, domainKey);
  const panoramaPage = useSuiteGraphDirectoryPage(perspective === 'panorama' && !historical && !denied, session, loadPanorama, panoramaKey);
  const domainGraph = useMemo<SuiteMatterGraphRead | null>(() => {
    if (!domainPage.loaded || !read.workspace || historical) return null;
    return buildSuiteDomainGraph({
      matterId,
      matterTitle: read.workspace.matter.title,
      catalog,
      documents: domainPage.items,
    });
  }, [domainPage.loaded, domainPage.items, read.workspace, historical, matterId, catalog]);
  const panoramaGraph = useMemo<SuiteMatterGraphRead | null>(() => {
    if (!panoramaPage.loaded || !matterGraph || historical) return null;
    return buildSuitePanoramaGraph({
      directory: { items: panoramaPage.items, nextCursor: panoramaPage.nextCursor },
      currentMatterId: matterId,
      currentMatter: matterGraph,
    });
  }, [panoramaPage.loaded, panoramaPage.items, panoramaPage.nextCursor, matterGraph, historical, matterId]);
  const open = (route: string) => navigate(withGraphReturn(route, graphReadingParams(matterId, read.graph?.workRef ?? (workRef || null), displayState.current)));
  const openWiki = () => open(read.graph?.workRef ? matterWorkRoute(matterId, read.graph.workRef) : `/matters/${encodeURIComponent(matterId)}`);
  const openProcess = () => open(`/matters/${encodeURIComponent(matterId)}/process${read.graph?.workRef ? `?${new URLSearchParams({workRef: read.graph.workRef})}` : ''}`);
  const locateEvidence = (evidence: DocumentAssessmentEvidence) => open(matterDocumentRoute(matterId, evidence, 'brief', read.graph?.workRef ?? undefined));
  const openEventTimeline = useCallback((event: SuiteGraphTimelineEvent) => {
    const pins = event.pins;
    if (!pins) return;
    const returnQuery = graphReadingParams(matterId, read.graph?.workRef ?? (workRef || null), displayState.current);
    const query = new URLSearchParams({
      documentVersionId: pins.documentVersionId,
      parseRunId: pins.parseRunId,
      candidateRevision: String(pins.candidateRevision),
      runRef: pins.runRef,
      statementId: pins.statementId,
      returnGraphQuery: returnQuery.toString(),
      returnDocumentVersionId: pins.documentVersionId,
    });
    if (pins.anchorId) query.set('anchor', pins.anchorId);
    navigate(`/timeline?${query}`);
  }, [matterId, read.graph, workRef, navigate]);
  useEffect(() => () => { if (persistTimer.current) clearTimeout(persistTimer.current); }, []);
  useEffect(() => {
    if (paramsString === lastWritten.current) return;
    lastWritten.current = paramsString;
    const next = readGraphReadingState(new URLSearchParams(paramsString));
    displayState.current = next;
    structuralRef.current = '';
    if (persistTimer.current) { clearTimeout(persistTimer.current); persistTimer.current = null; }
    setPerspective(next.perspective ?? 'matter');
    setNavigation((current) => ({key: current.key + 1, state: next}));
  }, [paramsString]);
  const persistState = useCallback((state: SuiteGraphReadingState) => {
    const next = graphReadingParams(matterId, workRef || null, state);
    const serialized = next.toString();
    if (serialized === lastWritten.current) return;
    lastWritten.current = serialized;
    setParams(next, {replace: true});
  }, [matterId, workRef, setParams]);
  const handleStateChange = useCallback((state: SuiteGraphReadingState) => {
    displayState.current = state;
    const structural = JSON.stringify([state.selectedId ?? null, state.hiddenGroups ?? [], state.page ?? 0, state.density ?? 4, state.relationMode ?? 'aggregated', state.layoutMode ?? 'force', state.perspective ?? 'matter', state.eventId ?? null, state.wikiTab ?? 'knowledge']);
    const structuralChanged = structural !== structuralRef.current;
    structuralRef.current = structural;
    if (persistTimer.current) { clearTimeout(persistTimer.current); persistTimer.current = null; }
    if (structuralChanged) { persistState(state); return; }
    persistTimer.current = setTimeout(() => { persistTimer.current = null; persistState(displayState.current); }, 320);
  }, [persistState]);
  const openTarget = (target: SuiteMatterGraphTarget) => {
    if (target.kind === 'evidence') {
      if (target.evidence.kind === 'DOCUMENT_PASSAGE') locateEvidence(target.evidence);
      else if (target.evidence.kind === 'PRIOR_RESULT' && target.evidence.sourceWork) open(matterReferencedWorkRoute(target.evidence.sourceWork));
      return;
    }
    if (target.kind === 'statement') {
      const event = timeline.events.find((item) => item.pins?.statementId === target.statement.statementId && item.pins.documentVersionId === target.documentVersionId);
      if (event) openEventTimeline(event);
      return;
    }
    if (target.kind === 'matter-node') {
      if (target.matterId !== matterId) navigate(`/graph?${new URLSearchParams({matterId: target.matterId})}`);
      return;
    }
    const version = target.kind === 'document'
      ? target.documentVersionId
      : target.kind === 'catalog-document'
        ? target.entry.document.documentVersionId
        : target.kind === 'input'
          ? target.binding.documentVersionId
          : target.kind === 'material'
            ? target.material.documentVersionId
            : null;
    if (!version) { openWiki(); return; }
    const query = new URLSearchParams();
    if (target.kind === 'input' && target.binding.original) query.set('parseRunId', target.binding.original.parseRunId);
    open(`/document-versions/${encodeURIComponent(version)}${query.size ? `?${query}` : ''}`);
  };
  if (read.error) return <section role="alert"><p>{read.error}</p><button onClick={() => void read.refresh().catch(() => undefined)}>重新读取</button></section>;
  if (read.loading || !read.graph) return <p role="status">正在读取事项及指定保存工作…</p>;
  let displayRead: SuiteMatterGraphRead | null = null;
  if (perspective === 'matter') displayRead = matterGraph;
  else if (perspective === 'documents') displayRead = documentsGraph;
  else if (perspective === 'domain') displayRead = domainGraph;
  else displayRead = panoramaGraph;
  const directoryPage = perspective === 'domain' ? domainPage : perspective === 'panorama' ? panoramaPage : null;
  const unavailable = historical && (perspective === 'domain' || perspective === 'panorama');
  const perspectiveNotice = unavailable ? '指定历史工作没有绑定该视角数据。请切回事项或工程文档；历史工作身份保持不变。'
    : directoryPage?.error ? `读取该视角失败：${directoryPage.error}`
      : !displayRead ? '正在读取该视角的授权数据…' : null;
  // Keep the view mounted so tabs, return state and per-perspective cameras survive requests.
  displayRead ??= { ...read.graph, graph: { ...read.graph.graph, groups: [], relations: [] }, targets: new Map(), relationDetails: new Map() };

  const availablePerspectives: SuiteMatterGraphPerspective[] = historical ? ['matter', 'documents'] : ['matter', 'documents', 'domain', 'panorama'];
  return <SuiteMatterGraphView key={navigation.key} initialState={navigation.state} onStateChange={handleStateChange} read={displayRead} perspectiveNotice={perspectiveNotice} perspectiveError={Boolean(directoryPage?.error)} onRetryPerspective={directoryPage?.retry} nextDirectoryPage={directoryPage?.nextCursor ? directoryPage.loadMore : undefined} directoryLoading={directoryPage?.loading} perspective={perspective} onPerspectiveChange={setPerspective} availablePerspectives={availablePerspectives} revision={read.revision} timelineEvents={timeline.events} timelineSources={sources.sources} timelineLoading={sources.loading} onExpandTimelineSource={sources.expandSource} onOpenEventTimeline={openEventTimeline} onOpenWiki={openWiki} onOpenProcess={openProcess} onLocateEvidence={locateEvidence} onOpenTarget={openTarget} />;
}
