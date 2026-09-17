import { suiteDocumentPerspective } from './suite-document-perspective';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { graphReadingParams, readGraphReadingState, withGraphReturn, type SuiteGraphReadingState } from './suite-graph-return';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { matterDocumentRoute, matterReferencedWorkRoute, matterWorkRoute } from '@client/src/features/matter/matter-navigation';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import { useSuiteMatterGraph } from './useSuiteMatterGraph';
import SuiteMatterGraphView from './SuiteMatterGraphView';
import type { SuiteMatterGraphTarget } from './suite-matter-graph';

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
  const [perspective, setPerspective] = useState(navigation.state.perspective ?? 'matter');
  const read = useSuiteMatterGraph(matterId, workRef, session, denied);
  const visibleGraph = useMemo(() => read.graph && perspective === 'documents' ? suiteDocumentPerspective(read.graph) : read.graph, [read.graph, perspective]);
  const open = (route: string) => navigate(withGraphReturn(route, graphReadingParams(matterId, read.graph?.workRef ?? (workRef || null), displayState.current)));
  const openWiki = () => open(read.graph?.workRef ? matterWorkRoute(matterId, read.graph.workRef) : `/matters/${encodeURIComponent(matterId)}`);
  const locateEvidence = (evidence: DocumentAssessmentEvidence) => open(matterDocumentRoute(matterId, evidence, 'brief', read.graph?.workRef ?? undefined));
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
    const structural = JSON.stringify([state.selectedId ?? null, state.hiddenGroups ?? [], state.page ?? 0, state.density ?? 4, state.relationMode ?? 'aggregated', state.perspective ?? 'matter']);
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
    const version = target.kind === 'document' ? target.documentVersionId : target.kind === 'input' ? target.binding.documentVersionId : target.kind === 'material' ? target.material.documentVersionId : null;
    if (!version) { openWiki(); return; }
    const query = new URLSearchParams();
    if (target.kind === 'input' && target.binding.original) query.set('parseRunId', target.binding.original.parseRunId);
    open(`/document-versions/${encodeURIComponent(version)}${query.size ? `?${query}` : ''}`);
  };
  if (read.error) return <section role="alert"><p>{read.error}</p><button onClick={() => void read.refresh().catch(() => undefined)}>重新读取</button></section>;
  if (read.loading || !read.graph) return <p role="status">正在读取事项及指定保存工作…</p>;
  return <SuiteMatterGraphView key={navigation.key} initialState={navigation.state} onStateChange={handleStateChange} read={visibleGraph!} perspective={perspective} onPerspectiveChange={setPerspective} availablePerspectives={['matter', 'documents']} revision={read.revision} onOpenWiki={openWiki} onLocateEvidence={locateEvidence} onOpenTarget={openTarget} />;
}
