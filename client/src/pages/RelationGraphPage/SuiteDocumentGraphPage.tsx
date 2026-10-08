import { readLibraryGraphReturn } from './library-graph-return-memory';
import { LIBRARY_GRAPH_ROUTE } from './library-graph-entry';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { activateGraphLayoutSession } from './suite-graph-layout-memory';
import { documentGraphReadingParams, libraryGraphReturnToken, readGraphReadingState, withGraphReturn, type SuiteGraphReadingState } from './suite-graph-return';
import { useDocumentNeighborhood } from './useDocumentNeighborhood';
import { buildDocumentNeighborhood, documentNeighborhoodNodeId } from './suite-document-neighborhood';
import { useSuiteGraphSources } from './useSuiteGraphSources';
import { buildSuiteGraphTimeline, type SuiteGraphTimelineEvent } from './suite-graph-timeline';
import SuiteDocumentGraphView from './SuiteDocumentGraphView';
import DocumentNeighborhoodDetails from './DocumentNeighborhoodDetails';

export default function SuiteDocumentGraphPage({ documentVersionId, readerWorkItemId }: {
  documentVersionId: string; readerWorkItemId?: string;
}) {
  const { sessionGeneration, authenticationRequired, currentUser } = useCurrentUserSession();
  activateGraphLayoutSession(sessionGeneration, authenticationRequired);
  return <DocumentGraphContent key={JSON.stringify([documentVersionId, readerWorkItemId ?? null,
    sessionGeneration, currentUser?.user_id ?? null])} documentVersionId={documentVersionId}
    readerWorkItemId={readerWorkItemId} session={sessionGeneration} denied={authenticationRequired} />;
}
const EMPTY_SOURCES: never[] = [];
function DocumentGraphContent({ documentVersionId, readerWorkItemId, session, denied }: {
  documentVersionId: string; readerWorkItemId?: string; session: number; denied: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const paramsString = params.toString();
  const macroToken = libraryGraphReturnToken(params);
  const macroReturn = macroToken ? readLibraryGraphReturn(macroToken,session) : null;
  const request = useMemo(() => ({documentVersionId, readerWorkItemId,
    familyCursor: params.getAll('familyCursor').length === 1 ? params.get('familyCursor')! : undefined,
    matterCursor: params.getAll('matterCursor').length === 1 ? params.get('matterCursor')! : undefined,
  }), [documentVersionId, readerWorkItemId, params]);
  const [rejected, setRejected] = useState(false);
  const read = useDocumentNeighborhood(request, session, denied || rejected);
  const projection = useMemo(() => read.read ? buildDocumentNeighborhood(read.read) : null, [read.read]);
  const rejectAccess = useCallback(() => { activateGraphLayoutSession(session, true); setRejected(true); }, [session]);
  const [navigation, setNavigation] = useState(() => ({key: 0, state: readGraphReadingState(params)}));
  const [selectedId, setSelectedId] = useState(navigation.state.selectedId ?? documentNeighborhoodNodeId(documentVersionId));
  const [eventId, setEventId] = useState(navigation.state.eventId);
  const [selectedRelations, setSelectedRelations] = useState(navigation.state.selectedRelationIds ?? []);
  const relationSelection = useRef<string[]>(selectedRelations);
  const display = useRef<SuiteGraphReadingState>(navigation.state);
  const lastWritten = useRef(paramsString);
  const paramsRef = useRef(params); paramsRef.current = params;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sources = useSuiteGraphSources({ catalog: projection?.sources ?? EMPTY_SOURCES,
    enabled: Boolean(projection) && !rejected && !denied, session, denied: denied || rejected,
    restorePins: navigation.state.eventPins, onAccessRejected: rejectAccess });
  const timeline = useMemo(() => buildSuiteGraphTimeline({ read: null, revision: null,
    catalog: projection?.sources ?? EMPTY_SOURCES, activities: sources.activities }).events.map(event => ({
      ...event, nodeId: event.pins ? documentNeighborhoodNodeId(event.pins.documentVersionId) : null,
    })), [projection, sources.activities]);
  const persist = useCallback((state: SuiteGraphReadingState) => {
    const query = documentGraphReadingParams(documentVersionId, readerWorkItemId, state, paramsRef.current);
    if (query.toString() === lastWritten.current) return;
    lastWritten.current = query.toString(); setParams(query, {replace: true});
  }, [documentVersionId, readerWorkItemId, setParams]);
  const stateChanged = useCallback((incoming: SuiteGraphReadingState, beforeNavigation = false) => {
    const state = {...incoming, selectedRelationIds: relationSelection.current.length ? relationSelection.current : undefined};
    const structuralChange = JSON.stringify({...state, viewport: null}) !== JSON.stringify({...display.current, viewport: null});
    display.current = state;
    if (timer.current) clearTimeout(timer.current);
    if (beforeNavigation || structuralChange) persist(state);
    else timer.current = setTimeout(() => persist(display.current), 320);
  }, [persist]);
  useEffect(() => {
    if (paramsString === lastWritten.current) return;
    if (timer.current) clearTimeout(timer.current);
    lastWritten.current = paramsString;
    const state = readGraphReadingState(new URLSearchParams(paramsString));
    display.current = state;
    setSelectedId(state.selectedId ?? documentNeighborhoodNodeId(documentVersionId)); setEventId(state.eventId);
    relationSelection.current = state.selectedRelationIds ?? []; setSelectedRelations(relationSelection.current);
    setNavigation(previous => ({ key: previous.key + 1, state }));
  }, [paramsString, documentVersionId]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const currentQuery = () => documentGraphReadingParams(documentVersionId, readerWorkItemId, display.current, paramsRef.current);
  const openSource = (id: string) => {
    persist(display.current);
    navigate(withGraphReturn(`/document-versions/${encodeURIComponent(id)}`, currentQuery()));
  };
  const openTimeline = (event: SuiteGraphTimelineEvent) => {
    const pins = event.pins;
    if (!pins) return;
    persist(display.current);
    const query = new URLSearchParams({ documentVersionId: pins.documentVersionId, familyId: pins.familyId,
      parseRunId: pins.parseRunId, candidateRevision: String(pins.candidateRevision), runRef: pins.runRef,
      statementId: pins.statementId, returnGraphQuery: currentQuery().toString(),
      returnDocumentVersionId: pins.documentVersionId, returnGraphParseRunId: pins.parseRunId });
    if (pins.anchorId) query.set('anchor', pins.anchorId);
    navigate(`/timeline?${query}`);
  };
  const nextPage = (name: 'familyCursor' | 'matterCursor', cursor: string) => {
    const query = currentQuery(); query.set(name, cursor); query.delete('selectedId');
    query.delete('eventId'); query.delete('eventPins'); query.delete('layoutSnapshot'); query.delete('selectedRelationIds');
    navigate(`/graph?${query}`);
  };
  if (rejected) return <section role="alert"><p>来源授权已变化，邻域、认识与时间声明已清除。</p>
    <Button onClick={() => { read.refresh(); setRejected(false); }}>重新核对同一准确版本</Button></section>;
  if (read.error) return <section role="alert"><p>{read.error}</p><Button onClick={read.refresh}>重试同一准确版本</Button></section>;
  if (!read.read || !projection) return <p role="status">正在读取所选准确版本及有界关联…</p>;
  const selectedEvent = timeline.find(event => event.id === eventId) ?? null;
  const detail = <>
    <DocumentNeighborhoodDetails read={read.read} projection={projection} selectedId={selectedId} event={selectedEvent}
      relationshipIds={selectedRelations} onSelectRelationship={setSelectedId}
      session={session} onRejected={rejectAccess} onOpen={openSource}
      onCenter={target => { persist(display.current); navigate(`/graph?${documentGraphReadingParams(target.documentVersionId, target.readerWorkItemId, {})}`); }}
      onMatter={matterId => { persist(display.current); navigate(`/graph?${new URLSearchParams({matterId})}`); }}
      onMentionSource={(mention, sourceRef) => {
        if (!read.read?.quicklook || !mention.sourceRefIds.includes(sourceRef)) return;
        persist(display.current);
        const query = new URLSearchParams({ panel: 'reader', readerMode: 'structured', documentVersionId, sourceRef });
        navigate(withGraphReturn(`/work-items/${encodeURIComponent(read.read.quicklook.document.workItemId)}/analysis?${query}`, currentQuery()));
      }} />
    {read.read.family?.nextCursor ? <Button size="sm" variant="ghost" onClick={() => nextPage('familyCursor', read.read!.family!.nextCursor!)}>下一页同族登记版本</Button> : null}
    {read.read.matters?.nextCursor ? <Button size="sm" variant="ghost" onClick={() => nextPage('matterCursor', read.read!.matters!.nextCursor!)}>下一页此工作关联事项</Button> : null}
  </>;
  return <SuiteDocumentGraphView key={navigation.key} graph={projection.graph} detail={detail}
    selectedId={selectedId} notices={macroToken && !macroReturn ? [...read.read.notices,'概览返回状态已过期；返回将重新打开全库概览。'] : read.read.notices} initialState={display.current}
    layoutScope={JSON.stringify([session, documentVersionId, readerWorkItemId ?? null, request.familyCursor ?? null, request.matterCursor ?? null])}
    onStateChange={stateChanged} onSelect={(id, relationshipIds) => {
      relationSelection.current = relationshipIds ?? []; setSelectedRelations(relationSelection.current);
      setSelectedId(id); setEventId(undefined);
      const target = projection.targets.get(id);
      if (target?.kind === 'document') sources.selectSource(target.documentVersionId);
    }} timelineEvents={timeline} timelineSources={sources.sources} timelineLoading={sources.loading}
    onSelectEvent={event => { relationSelection.current = []; setSelectedRelations([]); setEventId(event.id); if (event.nodeId) setSelectedId(event.nodeId); }}
    onExpandTimelineSource={sources.expandSource} onOpenEventTimeline={openTimeline} onRefresh={read.refresh}
    onOpenSource={() => openSource(documentVersionId)} onBack={() => { persist(display.current); const token = libraryGraphReturnToken(paramsRef.current); const macro = token ? readLibraryGraphReturn(token,session) : null; if (macro) navigate(`/graph?${macro.query}`,{state:{libraryRoot:macro.root,libraryParent:macro.parent}}); else if (token) navigate(LIBRARY_GRAPH_ROUTE); else navigate(-1); }} />;
}
