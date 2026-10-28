import { SavedChecklist } from '@client/src/features/checklist/ChecklistPanel';
import TdmsSourceEntry from '@client/src/features/tdms-source/TdmsSourceEntry';
import { TDMS_SOURCE_UI_ENABLED } from '@client/src/features/tdms-source/tdms-source-enabled';
import { savedTdmsSourceRefs } from '@client/src/features/tdms-source/saved-tdms-source-refs';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { CanonicalLibraryDocumentsResponse, CanonicalLibraryDocumentVersionSummary, EngineeringMatterDirectoryResponse } from '@shared/api.interface';
import type { EngineeringKnowledgeEntry, EngineeringKnowledgeIdentity, EngineeringKnowledgeScope } from '@shared/engineering-issue-search.interface';
import { getCanonicalLibraryDocuments } from '@client/src/api/canonical-host';
import { getEngineeringMatterDirectory } from '@client/src/api/engineering-matter';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useEngineeringMatterQueryIdentity } from '@client/src/features/matter/useEngineeringMatter';
import { isRevokedMatterError } from '@client/src/features/matter/matter-read-error';
import EngineeringIssueBody from '@client/src/features/matter/EngineeringIssueBody';
import { compactReadingSummary } from '@client/src/features/matter/compact-reading-summary';
import { JobAidIssueArticle } from '@client/src/pages/DocumentParsingPage/JobAidIssueArticle';
import { SavedJobAidMethodNotice, JobAidEvidenceDetails } from '@client/src/features/matter/SavedJobAidReadingContext';
import { exactDocumentSourceRoute, matterWorkRoute } from '@client/src/features/matter/matter-navigation';
import { knowledgeReadingParams, knowledgeReadingIdentity } from '@client/src/features/matter/reading-return';
import {
  libraryVersionLabel,
  projectLibraryDocumentReading,
} from '@client/src/pages/WorkspaceHomePage/library-document-presentation';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import MatterDocumentSourceDialog from '@client/src/features/matter/MatterDocumentSourceDialog';
import SavedAssessmentReading from '@client/src/features/matter/SavedAssessmentReading';
import OverviewCorrectionNotices from '@client/src/features/matter/OverviewCorrectionNotices';
import ReferenceWorkNotices from '@client/src/features/matter/ReferenceWorkNotices';
import OverviewSourceWork from '@client/src/features/matter/OverviewSourceWork';
import { useKnowledgeResources } from './useKnowledgeResources';
import { SavedWorkIssueDirectory, savedWorkIssueRows } from './SavedWorkIssueDirectory';
import SavedDocumentReadingArticle from './SavedDocumentReadingArticle';
import KnowledgeAtaDirectory from './KnowledgeAtaDirectory';
import { libraryDocumentRequestFilters, type LibraryCatalogFilters } from '../WorkspaceHomePage/library-classification';
import './knowledge-lookup.css';
import './knowledge-suite.css';

const keyOf = (entry: EngineeringKnowledgeIdentity) => JSON.stringify([entry.subjectKind, entry.subjectId, entry.workRef]);
const failure = (error: unknown) => error instanceof Error
  ? error.message.includes('ENGINEERING_KNOWLEDGE_SCAN_LIMIT') ? '当前范围内需核验的记录较多，请增加关键词后继续查阅。' : error.message
  : '读取未完成，请重试。';
const displayDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '保存时间待核' : date.toLocaleDateString('zh-CN');
};
const workItemPin = (params: URLSearchParams):
  | { state: 'absent' | 'invalid' }
  | { state: 'ok'; workItemId: string } => {
  const values = params.getAll('workItemId');
  if (!values.length) return { state: 'absent' };
  const value = values[0];
  if (values.length !== 1 || !value || value !== value.trim() ||
    value.length > 255 || /[\u0000-\u001f\u007f]/u.test(value))
    return { state: 'invalid' };
  return { state: 'ok', workItemId: value };
};
const knowledgeKind = (params: URLSearchParams): 'works' | 'matters' | 'sources' => {
  const requestedKind = params.get('kind');
  const hasWorkPin = ['subjectKind', 'subjectId', 'workRef', 'workItemId']
    .some(key => params.has(key));
  return hasWorkPin || requestedKind === 'works' ? 'works'
    : requestedKind === 'matters' ? 'matters' : 'sources';
};
const directoryFilterKeys = ['normalizedFamily', 'ata', 'ata2', 'ata4', 'aircraftModel', 'aircraftModels', 'fleetFamily', 'fleetModel'] as const;
const directoryFilters = (params: URLSearchParams): LibraryCatalogFilters =>
  Object.fromEntries(directoryFilterKeys.map(key => [key, params.get(key) ?? '']));
const directoryRequestFilters = (params: URLSearchParams): LibraryCatalogFilters =>
  Object.fromEntries(Object.entries(directoryFilters(params)).filter(([, value]) => value));
const catalogueStateKey = (params: URLSearchParams) => JSON.stringify([
  params.get('query') ?? '', params.get('scope') === 'ALL' ? 'ALL' : params.get('scope') === 'HISTORICAL' ? 'HISTORICAL' : 'CURRENT',
  knowledgeKind(params), params.get('after') ?? undefined, directoryFilters(params),
]);

export default function KnowledgeLookupPage() {
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const [params] = useSearchParams();
  const { identityQuery, identity } = useEngineeringMatterQueryIdentity(!authenticationRequired, sessionGeneration);
  // The source directory owns the preview props as well as the full reader.
  // A denial also replaces this instance and aborts its reads. Later identity
  // failures cannot restore those discarded props without a new directory read.
  const catalogueIdentity = JSON.stringify([identity?.appId, identity?.tenantId, identity?.actorId,
    sessionGeneration, knowledgeKind(params) === 'sources' && isRevokedMatterError(identityQuery.error)]);
  return <main className="wl-knowledge-suite" aria-label="工程知识">
    <header className="page-heading"><h1>工程知识</h1></header>
    {authenticationRequired ? <p role="alert">请先登录。</p>
      : <KnowledgeCatalogue key={catalogueIdentity}
        sourceIdentityReady={Boolean(identity) && !identityQuery.error}
        sourceIdentityError={identityQuery.error}
        retrySourceIdentity={() => { void identityQuery.refetch({ cancelRefetch: false }); }} />}
  </main>;
}

function KnowledgeCatalogue({ sourceIdentityReady, sourceIdentityError, retrySourceIdentity }: {
  sourceIdentityReady: boolean; sourceIdentityError: unknown; retrySourceIdentity: () => void;
}) {
  const { sessionGeneration } = useCurrentUserSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.get('query') ?? '';
  const scope: EngineeringKnowledgeScope = params.get('scope') === 'ALL' ? 'ALL' : params.get('scope') === 'HISTORICAL' ? 'HISTORICAL' : 'CURRENT';
  const kind = knowledgeKind(params);
  const after = params.get('after') ?? undefined;
  const identityPin = knowledgeReadingIdentity(params);
  const identity = identityPin.state === 'ok' ? identityPin.identity : null;
  const itemPin = workItemPin(params);
  const resolveWorkItemId = kind === 'works' && identityPin.state === 'absent' &&
    itemPin.state === 'ok' ? itemPin.workItemId : null;
  const selection = identity ? keyOf(identity) : '';
  const filters = directoryFilters(params);
  const filterKey = JSON.stringify(filters);
  const listKey = catalogueStateKey(params);
  const knowledge = useKnowledgeResources(query, scope, after, identity,
    resolveWorkItemId, kind === 'works');
  const [sourceBlockedSelection, setSourceBlockedSelection] = useState<string | null>(null);
  const [sourceSuspendedSelection, setSourceSuspendedSelection] = useState<string | null>(null);
  const refreshSavedRead = useRef(knowledge.refresh); refreshSavedRead.current = knowledge.refresh;
  const rejectTdmsAccess = useCallback(() => {
    if (kind !== 'works') return;
    const expected = selection;
    setSourceBlockedSelection(expected); setSourceSuspendedSelection(expected);
    // refresh returns no authorization verdict; keep the rejected selection hidden until an explicit retry.
    void refreshSavedRead.current().catch(() => undefined);
  }, [kind, selection]);
  const [loadedDocuments, setDocuments] = useState<CanonicalLibraryDocumentsResponse | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState('');
  const [loadedKey, setLoadedKey] = useState('');
  const [matters, setMatters] = useState<EngineeringMatterDirectoryResponse | null>(null);
  const [mattersLoading, setMattersLoading] = useState(false);
  const [mattersError, setMattersError] = useState('');
  const [relatedMatters, setRelatedMatters] = useState<EngineeringMatterDirectoryResponse | null>(null);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState('');
  const [relatedKey, setRelatedKey] = useState('');
  const documents = loadedKey === listKey ? loadedDocuments : null;
  const versionPin = params.getAll('documentVersionId');
  const selectedVersion = versionPin.length === 1
    ? documents?.items.flatMap(document => document.versions).find(version =>
      version.documentVersionId === versionPin[0]) ?? null
    : versionPin.length === 0
      ? documents?.items.flatMap(document => document.versions).find(version =>
        version.selectedVersionIsCurrent) ?? null
      : null;
  const selectedRelatedKey = selectedVersion
    ? `${selectedVersion.documentVersionId}:${selectedVersion.readerWorkItemId}` : '';
  const visibleRelated = relatedKey === selectedRelatedKey ? relatedMatters : null;
  const visibleRelatedError = relatedKey === selectedRelatedKey ? relatedError : '';
  const visibleRelatedLoading = Boolean(selectedVersion?.readerWorkItemId) &&
    (relatedKey !== selectedRelatedKey || relatedLoading);
  const sourceReadingBlocked = sourceBlockedSelection === selection;
  const page = sourceReadingBlocked ? null : knowledge.page, read = sourceReadingBlocked ? null : knowledge.read;
  const sourceError = sourceIdentityError ? failure(sourceIdentityError) : documentsError;
  const sourceLoading = documentsLoading && !documents && !sourceError;
  const loading = kind === 'works' ? knowledge.loading : kind === 'matters' ? mattersLoading : sourceLoading;
  const error = kind === 'works' ? knowledge.catalogueError ? failure(knowledge.catalogueError) : ''
    : kind === 'matters' ? mattersError : sourceError;
  const reading = knowledge.reading;
  const readError = knowledge.workError ? failure(knowledge.workError) : '';
  const selectedIssueKey = params.getAll('knowledgeIssueKey').length === 1 ? params.get('knowledgeIssueKey') ?? '' : '';
  const issueRows = read ? savedWorkIssueRows(read.content.issues) : [];
  const visibleIssues = issueRows.filter(row => !selectedIssueKey || row.issueKey === selectedIssueKey).flatMap(row => row.variants);
  const [retry, setRetry] = useState(0);
  function retryRead() {
    setSourceBlockedSelection(null); setSourceSuspendedSelection(null); setRetry(value => value + 1);
    if (kind === 'sources' && sourceIdentityError) retrySourceIdentity();
    void knowledge.refresh();
  }
  const [source, setSource] = useState<{ documentVersionId: string; sourceRef: string | null } | null>(null);
  const [expandedFamilies, setExpandedFamilies] = useState<Record<string, boolean>>({});
  const [expandedConditions, setExpandedConditions] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLElement>(null), articleRef = useRef<HTMLElement>(null);
  const currentParams = useRef(params); currentParams.current = params;
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScroll = useRef<Record<string, string>>({});
  const priorSourceIdentityReady = useRef(sourceIdentityReady);

  function clearPendingScroll() {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    pendingScroll.current = {};
  }
  function select(entry: EngineeringKnowledgeEntry) {
    clearPendingScroll();
    setParams(prior => { const next = new URLSearchParams(prior); next.set('subjectKind', entry.subjectKind); next.set('subjectId', entry.subjectId); next.set('workRef', entry.workRef); next.delete('workItemId'); next.delete('articleY'); next.delete('knowledgeIssueKey'); return next; }, { replace: true });
  }
  function change(key: string, value: string) {
    clearPendingScroll();
    setParams(prior => { const next = new URLSearchParams(prior); next.set(key, value); ['after', 'subjectKind', 'subjectId', 'workRef', 'workItemId', 'documentVersionId', 'knowledgeIssueKey', 'listY', 'articleY'].forEach(name => next.delete(name)); return next; }, { replace: true });
  }
  function filterDirectory(value: LibraryCatalogFilters) {
    clearPendingScroll();
    setParams(prior => {
      const next = new URLSearchParams(prior);
      for (const key of directoryFilterKeys) {
        if (value[key]) next.set(key, value[key]!); else next.delete(key);
      }
      if (knowledgeKind(prior) === 'sources') ['after', 'documentVersionId', 'listY', 'articleY'].forEach(key => next.delete(key));
      return next;
    }, { replace: true });
  }
  function rememberScroll(key: 'listY' | 'articleY', top: number) {
    pendingScroll.current[key] = String(Math.min(9999999, Math.max(0, Math.round(top))));
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    const expectedIdentity = selection, expectedList = listKey;
    scrollTimer.current = setTimeout(() => {
      const pin = knowledgeReadingIdentity(currentParams.current);
      const actualIdentity = pin.state === 'ok' ? keyOf(pin.identity) : '';
      const actualList = catalogueStateKey(currentParams.current);
      if (expectedIdentity !== actualIdentity || expectedList !== actualList) { pendingScroll.current = {}; return; }
      const values = pendingScroll.current; pendingScroll.current = {};
      setParams(prior => { const next = new URLSearchParams(prior); Object.entries(values).forEach(([name, value]) => next.set(name, value)); return next; }, { replace: true });
    }, 200);
  }
  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current); }, []);

  useEffect(() => {
    if (kind !== 'works' || !page) return;
    if (knowledgeReadingIdentity(currentParams.current).state === 'absent' &&
      workItemPin(currentParams.current).state === 'absent' && page.entries[0])
      select(page.entries[0]);
  }, [page, kind, selection, identityPin.state]);

  useEffect(() => {
    if (kind !== 'works' || identityPin.state !== 'absent' ||
      itemPin.state !== 'ok' || !knowledge.currentWork ||
      knowledge.currentWork.workItemId !== itemPin.workItemId) return;
    const current = knowledge.currentWork;
    setParams(prior => {
      if (knowledgeReadingIdentity(prior).state !== 'absent' ||
        workItemPin(prior).state !== 'ok' ||
        prior.get('workItemId') !== current.workItemId) return prior;
      const next = new URLSearchParams(prior);
      next.set('subjectKind', 'WORK_ITEM');
      next.set('subjectId', current.workItemId);
      next.set('workRef', current.workRevisionRef);
      next.delete('workItemId');
      next.delete('articleY');
      return next;
    }, { replace: true });
  }, [kind, identityPin.state, itemPin.state,
    itemPin.state === 'ok' ? itemPin.workItemId : null, knowledge.currentWork, setParams]);

  useEffect(() => {
    const identityResumed = !priorSourceIdentityReady.current && sourceIdentityReady;
    priorSourceIdentityReady.current = sourceIdentityReady;
    if (kind !== 'sources' || !sourceIdentityReady) return;
    const controller = new AbortController();
    const requestFilters = directoryRequestFilters(currentParams.current);
    // Keep the already displayed directory/body during a same-scope identity
    // recovery. Denial and scope changes have already mounted an empty catalogue.
    if (!identityResumed) setDocuments(null);
    setDocumentsError(''); setDocumentsLoading(true);
    const timer = setTimeout(() => {
      void Promise.resolve().then(() => getCanonicalLibraryDocuments({ search: query, cursor: after, limit: 24,
        ...libraryDocumentRequestFilters(requestFilters) }, controller.signal)).then(value => {
        if (!controller.signal.aborted) { setDocuments(value); setLoadedKey(listKey); }
      }).catch(cause => {
        if (controller.signal.aborted) return;
        if (isRevokedMatterError(cause)) setDocuments(null);
        setDocumentsError(failure(cause));
      })
        .finally(() => { if (!controller.signal.aborted) setDocumentsLoading(false); });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, scope, kind, after, retry, filterKey, sourceIdentityReady]);

  useEffect(() => {
    if (kind !== 'matters') return;
    const controller = new AbortController();
    setMatters(null); setMattersError(''); setMattersLoading(true);
    const timer = setTimeout(() => {
      void getEngineeringMatterDirectory({ search: query, cursor: after, limit: 24 }, controller.signal)
        .then(value => { if (!controller.signal.aborted) setMatters(value); })
        .catch(cause => { if (!controller.signal.aborted) setMattersError(failure(cause)); })
        .finally(() => { if (!controller.signal.aborted) setMattersLoading(false); });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, kind, after, retry]);

  useEffect(() => {
    if (kind !== 'sources' || !selectedVersion?.readerWorkItemId) {
      setRelatedMatters(null); setRelatedError(''); setRelatedLoading(false); setRelatedKey('');
      return;
    }
    const controller = new AbortController();
    setRelatedMatters(null); setRelatedError(''); setRelatedLoading(true);
    void getEngineeringMatterDirectory({
      workItemId: selectedVersion.readerWorkItemId, limit: 24,
    }, controller.signal).then(value => {
      if (!controller.signal.aborted) { setRelatedMatters(value); setRelatedKey(selectedRelatedKey); }
    }).catch(cause => {
      if (!controller.signal.aborted) { setRelatedError(failure(cause)); setRelatedKey(selectedRelatedKey); }
    }).finally(() => { if (!controller.signal.aborted) setRelatedLoading(false); });
    return () => controller.abort();
  }, [kind, selectedRelatedKey, selectedVersion?.readerWorkItemId, retry]);

  useEffect(() => { setSource(null); }, [selection, kind]);
  useEffect(() => { if (!read) setSource(null); }, [read]);

  useEffect(() => {
    if (!loading && listRef.current) listRef.current.scrollTop = Number(currentParams.current.get('listY') ?? 0);
  }, [loading, page, documents]);
  useEffect(() => {
    if ((read || selectedVersion) && articleRef.current)
      articleRef.current.scrollTop = Number(currentParams.current.get('articleY') ?? 0);
  }, [read, selectedVersion]);

  function openDocument(route: string, documentVersionId: string) {
    if (kind === 'works' && (!read || keyOf(read.entry) !== selection)) return;
    clearPendingScroll();
    const queryStart = route.indexOf('?');
    const path = queryStart === -1 ? route : route.slice(0, queryStart);
    const raw = queryStart === -1 ? '' : route.slice(queryStart + 1);
    const next = new URLSearchParams(raw);
    const state = knowledgeReadingParams(currentParams.current);
    if (kind === 'sources') state.set('documentVersionId', documentVersionId);
    state.set('listY', String(Math.round(listRef.current?.scrollTop ?? 0)));
    state.set('articleY', String(Math.round(articleRef.current?.scrollTop ?? 0)));
    next.set('returnKnowledgeQuery', state.toString()); next.set('returnDocumentVersionId', documentVersionId);
    navigate(`${path}?${next}`);
  }
  function locate(evidence: DocumentAssessmentEvidence) {
    const exact = exactDocumentSourceRoute(evidence);
    if (exact) openDocument(exact, evidence.documentVersionId);
    else setSource({ documentVersionId: evidence.documentVersionId, sourceRef: evidence.sourceRefId ?? null });
  }
  function openIssue(issueKey: string) {
    clearPendingScroll();
    if (articleRef.current) articleRef.current.scrollTop = 0;
    setParams(prior => { const next = new URLSearchParams(prior); if (issueKey) next.set('knowledgeIssueKey', issueKey); else next.delete('knowledgeIssueKey'); next.delete('articleY'); return next; }, { replace: true });
  }
  function workWikiRoute(entry: EngineeringKnowledgeEntry) {
    const state = knowledgeReadingParams(currentParams.current);
    state.set('listY', String(Math.round(listRef.current?.scrollTop ?? 0)));
    state.set('articleY', String(Math.round(articleRef.current?.scrollTop ?? 0)));
    return `${matterWorkRoute(entry.subjectId, entry.workRef)}&${new URLSearchParams({ returnKnowledgeWorkQuery: state.toString() })}`;
  }
  function treeDocumentRoute(documentVersionId: string) {
    const state = knowledgeReadingParams(currentParams.current);
    state.set('documentVersionId', documentVersionId);
    return `/document-versions/${encodeURIComponent(documentVersionId)}?${new URLSearchParams({
      returnKnowledgeQuery: state.toString(), returnDocumentVersionId: documentVersionId,
    })}`;
  }
  function selectTreeVersion(documentVersionId: string) {
    clearPendingScroll();
    if (kind !== 'sources') { navigate(treeDocumentRoute(documentVersionId)); return; }
    setParams(prior => { const next = new URLSearchParams(prior); next.set('documentVersionId', documentVersionId); next.delete('articleY'); return next; });
  }
  function treeWikiRoute(summaryId: string) {
    const state = knowledgeReadingParams(currentParams.current);
    state.set('kind', kind);
    state.set('listY', String(Math.round(listRef.current?.scrollTop ?? 0)));
    state.set('articleY', String(Math.round(articleRef.current?.scrollTop ?? 0)));
    return `/summaries/${encodeURIComponent(summaryId)}?${new URLSearchParams({ returnKnowledgeQuery: state.toString() })}`;
  }
  function nextPage(cursor: string) {
    clearPendingScroll();
    setParams(prior => { const next = new URLSearchParams(prior); next.set('after', cursor); ['subjectKind', 'subjectId', 'workRef', 'documentVersionId', 'knowledgeIssueKey', 'listY', 'articleY'].forEach(key => next.delete(key)); return next; });
  }
  const nextCursor = kind === 'works' ? page?.nextCursor
    : kind === 'matters' ? matters?.nextCursor : documents?.nextCursor;
  const pagination = <div className="knowledge-pagination">
    {after && <button onClick={() => change('kind', kind)}>回到首批</button>}
    {nextCursor && <button onClick={() => nextPage(nextCursor)}>下一批</button>}
  </div>;
  return <>
    <div className="knowledge-toolbar">
      <div className="tabs" role="group" aria-label="知识类型"><button aria-pressed={kind === 'sources'} onClick={() => change('kind', 'sources')}>工程文档</button><button aria-pressed={kind === 'matters'} onClick={() => change('kind', 'matters')}>工程事项</button><button aria-pressed={kind === 'works'} onClick={() => change('kind', 'works')}>工作与历史</button></div>
      <label className="knowledge-search"><Search size={18} /><input aria-label="搜索工程知识" maxLength={200} placeholder="搜索文档、事项或已保存工作…" value={query} onChange={event => change('query', event.target.value)} /></label>
      {kind === 'works' && <select aria-label="知识版本范围" value={scope} onChange={event => change('scope', event.target.value)}><option value="CURRENT">当前工作</option><option value="ALL">包含历史工作</option><option value="HISTORICAL">仅历史工作</option></select>}
      <details className="knowledge-more-functions"><summary>更多功能</summary><div>
        <Link to="/summaries">资料综合</Link><Link to="/summaries#hierarchical-wiki">分层 Wiki 设置</Link>
      </div></details>
    </div>
    {identityPin.state === 'invalid' && <p role="alert">知识工作身份不完整或有重复参数，请重新选择确切工作。</p>}
    {kind === 'works' && identityPin.state === 'absent' && itemPin.state === 'invalid' &&
      <p role="alert">文档工作身份无效，请重新打开确切事项。</p>}
    {resolveWorkItemId && knowledge.workItemError &&
      <p role="alert">{failure(knowledge.workItemError)} <button onClick={retryRead}>重试</button></p>}
    {error && <p role="alert">{error} <button onClick={retryRead}>重试</button></p>}
    <div className="knowledge-directory-layout">
      <KnowledgeAtaDirectory kind={kind} session={sessionGeneration} refreshRevision={retry}
        sourceDirectory={documents} sourceLoading={sourceLoading} sourceError={sourceError}
        filters={filters} onFilterChange={filterDirectory} scheme={params.get('ataTitleScheme') === 'jasc' ? 'jasc' : 'ispec'}
        onSchemeChange={scheme => setParams(prior => { const next = new URLSearchParams(prior); next.set('ataTitleScheme', scheme); return next; }, { replace: true })}
        onRefresh={retryRead} onNextSourcePage={nextPage} selectedDocumentVersionId={versionPin.length === 1 ? versionPin[0] : ''}
        onSelectVersion={selectTreeVersion} documentReadingRoute={treeDocumentRoute} wikiReadingRoute={treeWikiRoute}
        onOpenWiki={summaryId => { clearPendingScroll(); navigate(treeWikiRoute(summaryId)); }} />
      <div className="knowledge-catalogue-content">
    {kind === 'works' ? <div className="knowledge-layout">
      <section className="panel knowledge-results" aria-label="已有工程认识" ref={listRef} onScroll={event => rememberScroll('listY', event.currentTarget.scrollTop)}>
        <div className="panel-head"><h2>{loading ? '正在读取已有认识…' : `本批 ${page?.entries.length ?? 0} 条可查阅工作`}</h2></div>
        {page?.entries.map(entry => <button className={`knowledge-hit${selection === keyOf(entry) ? ' selected' : ''}`} key={keyOf(entry)} aria-pressed={selection === keyOf(entry)} onClick={() => select(entry)}>
          <small className={entry.current ? 'knowledge-badge' : 'knowledge-badge historical'}>{entry.current ? '当前工作' : '历史工作'} · 修订 {entry.workRevision}</small>
          <h2>{entry.headline || '认识主题待补齐'}</h2>{compactReadingSummary(entry.headline, entry.listBrief) !== entry.headline && <p>{compactReadingSummary(entry.headline, entry.listBrief)}</p>}
          <small>{entry.subjectKind === 'ENGINEERING_MATTER' ? '工程事项' : '文档工作'} · {displayDate(entry.createdAt)}</small>
          {entry.subjectKind === 'ENGINEERING_MATTER' && entry.overviewStatus === 'STALE' &&
            <span className="coverage-hint">综合尚未覆盖本轮问题</span>}
        </button>)}
        {!loading && !error && !page?.entries.length && <p className="knowledge-empty">没有匹配的已保存认识，可调整关键词或版本范围。</p>}{pagination}
      </section>
      <section className="panel knowledge-preview" aria-label="完整工程认识" ref={articleRef} onScroll={event => rememberScroll('articleY', event.currentTarget.scrollTop)}>
        {resolveWorkItemId && knowledge.workItemLoading ? <p role="status">正在定位该事项的当前工作…</p> :
        resolveWorkItemId && knowledge.workItemResolved && !knowledge.currentWork ? <p role="alert">该事项尚无可读的已保存工作。</p> :
        resolveWorkItemId && knowledge.currentWork?.workItemId !== resolveWorkItemId ? <p role="alert">当前工作与所请求事项不一致。</p> :
        reading ? <p role="status">正在读取确切工作…</p> : read ? <>
          {readError ? <p role="alert">{readError} <button onClick={retryRead}>重试</button></p> : null}
          <div className="article-kicker">{read.entry.current ? '已保存的工程认识' : '当时的工程认识'} · 工作修订 {read.entry.workRevision}</div>
          <h1>{read.entry.headline || '已保存的工程认识'}</h1>{read.overall?.status !== 'CANDIDATE_ONLY' && compactReadingSummary(read.entry.headline, read.entry.listBrief) !== read.entry.headline && <p className="article-lead">{compactReadingSummary(read.entry.headline, read.entry.listBrief)}</p>}
          <small>{read.entry.subjectKind === 'ENGINEERING_MATTER' ? '工程事项' : '文档工作'} · {displayDate(read.entry.createdAt)}</small>
          {read.entry.listBrief && <details className="knowledge-work-details"><summary>展开本工作保存的简明意见</summary>
            <p className="whitespace-pre-wrap">{read.entry.listBrief}</p>
          </details>}
          <SavedJobAidMethodNotice work={read.content} />
          {read.entry.subjectKind === 'WORK_ITEM' ? <SavedChecklist work={read.content} workRef={read.entry.workRef}
            onIssue={openIssue} renderEvidence={refs => <JobAidEvidenceDetails refs={refs}
              evidence={read.content.evidence} onLocateDocument={locate} />} /> : null}
          {read.entry.subjectKind === 'ENGINEERING_MATTER' && read.entry.overviewStatus !== 'CURRENT' &&
            <div className="knowledge-notice">{read.entry.overviewStatus === 'STALE' ? '问题已更新，综合尚未覆盖。本页保留各部分的确切保存范围。' : '当前已保存问题解释，综合认识尚未形成。'}</div>}
          {read.entry.subjectKind === 'WORK_ITEM' && (read.overall ? <section className="knowledge-prose" aria-label="确切综合意见">
            <h2>综合意见</h2>
            {read.overall.status === 'STALE' && <p className="knowledge-notice">这份综合意见已过时，保留当时的判断和来源供核对。</p>}
            {read.overall.status === 'CANDIDATE_ONLY' && <p>{compactReadingSummary(read.overall.readingResult.content.headline, read.overall.readingResult.content.listBrief)}</p>}
            <details className="knowledge-work-details"><summary>展开综合判断与依据</summary>
              <p className="whitespace-pre-wrap">{read.overall.readingResult.content.listBrief}</p>
              <SavedAssessmentReading result={read.overall.readingResult} depth="brief" onLocateDocument={locate} />
            </details>
          </section> : <div className="knowledge-notice">这份问题分析尚无与该修订绑定的综合意见。</div>)}
          {read.content.understanding && <section className="knowledge-prose"><h2>本工作的问题理解</h2><EngineeringIssueBody body={read.content.understanding} evidence={read.content.evidence} onLocateDocument={locate} /></section>}
          <SavedWorkIssueDirectory read={read} selectedIssueKey={selectedIssueKey} onOpen={openIssue} />
          {selectedIssueKey && !visibleIssues.length ? <p role="alert">该问题不在当前读回的确切工作中，请重新选择。</p> : null}
          {visibleIssues.map((issue, index) => <section className="knowledge-prose" key={`${issue.issueKey}:${index}`} data-saved-issue-key={issue.issueKey}><JobAidIssueArticle issue={issue} evidence={read.content.evidence} onLocateDocument={locate} /></section>)}
          {read.entry.subjectKind === 'ENGINEERING_MATTER' && <>
            <OverviewSourceWork matterId={read.entry.subjectId} source={read.overviewSourceWork} overviewStatus={read.entry.overviewStatus} />
            <OverviewCorrectionNotices matterId={read.entry.subjectId} notices={read.overviewCorrectionNotices} />
          </>}
          {read.correctionNotices?.map(notice => <p role="note" key={`${notice.issueKey}:${notice.attemptRef}`}>{notice.unchanged ? '已核对并保留原认识：' : notice.correctedWorkRef ? '已有后继更正：' : '仍有待核更正：'}{notice.reason}</p>)}
          <ReferenceWorkNotices notices={read.referenceWorkNotices} />
          {TDMS_SOURCE_UI_ENABLED ? <TdmsSourceEntry
            key={selection} enabled={TDMS_SOURCE_UI_ENABLED && sourceSuspendedSelection !== selection} onAccessRejected={rejectTdmsAccess}
            context={read.entry.subjectKind === 'ENGINEERING_MATTER' ? { matterId: read.entry.subjectId } : read.reading?.scope.kind === 'WORK_ITEM' ? { documentVersionId: read.reading.scope.documentVersionId } : {}}
            exactRevisionRefs={savedTdmsSourceRefs([
              ...read.content.evidence, ...(read.overall?.readingResult.evidence ?? []),
            ])}
            openDocument={documentVersionId => openDocument(`/document-versions/${encodeURIComponent(documentVersionId)}`, documentVersionId)}
          /> : null}
          <div className="knowledge-actions">{read.entry.subjectKind === 'ENGINEERING_MATTER' ? <>
            <Link to={workWikiRoute(read.entry)} onClick={event => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault(); clearPendingScroll(); navigate(workWikiRoute(read.entry));
            }}><BookOpen size={16} />打开对应工作 Wiki</Link>
            {!read.entry.current && <Link to={`/matters/${encodeURIComponent(read.entry.subjectId)}`}>查看事项当前认识</Link>}
          </> : <Link to={`/work-items/${encodeURIComponent(read.entry.subjectId)}`}>查看文档工作</Link>}</div>
        </> : readError ? <p role="alert">{readError} <button onClick={retryRead}>重试</button></p>
          : <p className="knowledge-empty">选择一条已有认识，阅读完整解释与来源。</p>}
      </section>
    </div> : kind === 'matters' ? <section className="panel knowledge-sources" aria-label="工程事项目录">
      <div className="panel-head"><h2>工程事项 Wiki</h2></div>
      {loading ? <p role="status">正在读取工程事项…</p> : matters?.items.map(matter =>
        <Link className="knowledge-source knowledge-catalog-link" key={matter.matterId}
          to={`/matters/${encodeURIComponent(matter.matterId)}`}>
          <div><small>工程事项 · {displayDate(matter.updatedAt)}</small>
            <h2>{matter.title}</h2>
            <p>{matter.result?.listBrief || '尚无已保存的事项综合认识。'}</p>
            {matter.overallStatus === 'STALE' && <small className="coverage-hint">问题已更新，综合尚未覆盖</small>}
          </div><span>打开事项 Wiki →</span>
        </Link>)}
      {!loading && !error && !matters?.items.length && <p className="knowledge-empty">没有匹配的可读事项。</p>}{pagination}
    </section> : <div className="knowledge-layout">
    <section className="panel knowledge-sources" aria-label="工程文档目录" ref={listRef}
      onScroll={event => rememberScroll('listY', event.currentTarget.scrollTop)}>
      <div className="panel-head"><h2>工程文档与确切版本</h2></div>
      {loading ? <p role="status">正在读取来源资料…</p> : documents?.items.map(document => {
        const current = document.versions.find(item => item.selectedVersionIsCurrent);
        const historical = document.versions.filter(item => !item.selectedVersionIsCurrent);
        const expanded = Boolean(expandedFamilies[document.familyId]);
        const sourceBody = (version: CanonicalLibraryDocumentVersionSummary) => {
          const reading = projectLibraryDocumentReading(version);
          const foldedLines = reading.conditionLines;
          const conditionsOpen = Boolean(
            expandedConditions[version.documentVersionId],
          );
          return (
            <div>
              <small>{document.normalizedFamily} · {libraryVersionLabel(version)}{version.selectedVersionIsCurrent ? '' : ' · 历史版本'}</small>
              <h2>{document.documentCode}</h2>
              <p
                className="knowledge-source-reading"
                data-reading-run-ref={reading.readingRunRef ?? undefined}
                data-reading-revision={reading.readingRevision ?? undefined}
              >
                <strong>{reading.brief ? reading.headline : reading.fileTitle}</strong>
                {reading.brief ?? reading.note}
              </p>
              {foldedLines.length ? (
                <div className="knowledge-source-conditions">
                  {foldedLines.length ? (
                    <>
                      <button
                        type="button"
                        className="knowledge-source-conditions-toggle"
                        aria-expanded={conditionsOpen}
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedConditions((prior) => ({
                            ...prior,
                            [version.documentVersionId]:
                              !prior[version.documentVersionId],
                          }));
                        }}
                      >
                        {conditionsOpen
                          ? '收起关键条件与阅读限制'
                          : `关键条件与阅读限制（${foldedLines.length}）`}
                      </button>
                      {conditionsOpen ? (
                        <ul>
                          {foldedLines.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        };
        const selectVersion = (version: CanonicalLibraryDocumentVersionSummary) => {
          clearPendingScroll();
          setParams(prior => {
            const next = new URLSearchParams(prior);
            next.set('documentVersionId', version.documentVersionId);
            next.delete('articleY');
            return next;
          }, { replace: true });
        };
        return (
          <Fragment key={document.familyId}>
            {current ? (
              <div
                className={`knowledge-source${selectedVersion?.documentVersionId === current.documentVersionId ? ' selected' : ''}`}
                aria-current={selectedVersion?.documentVersionId === current.documentVersionId ? 'true' : undefined}
                tabIndex={0}
                onClick={() => selectVersion(current)}
                onKeyDown={(event) => event.target === event.currentTarget && event.key === 'Enter' && selectVersion(current)}
              >
                {historical.length ? (
                  <button
                    type="button"
                    className="knowledge-source-toggle"
                    aria-expanded={expanded}
                    aria-label={expanded ? '收起版本历史' : '展开版本历史'}
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedFamilies((prior) => ({ ...prior, [document.familyId]: !prior[document.familyId] }));
                    }}
                  >
                    {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                  </button>
                ) : null}
                {sourceBody(current)}
                <span aria-hidden="true">阅读 →</span>
              </div>
            ) : (
              <div className="knowledge-source">
                {historical.length ? (
                  <button
                    type="button"
                    className="knowledge-source-toggle"
                    aria-expanded={expanded}
                    aria-label={expanded ? '收起版本历史' : '展开版本历史'}
                    onClick={() => setExpandedFamilies((prior) => ({ ...prior, [document.familyId]: !prior[document.familyId] }))}
                  >
                    {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                  </button>
                ) : null}
                <div>
                  <small>{document.normalizedFamily} · 当前版本不可见</small>
                  <h2>{document.documentCode}</h2>
                  <p className="knowledge-source-reading">当前版本不可见，主题待补齐；可展开查看可见的历史版本。</p>
                </div>
              </div>
            )}
            {expanded ? historical.map((version) => (
              <div
                className={`knowledge-source knowledge-source-history${selectedVersion?.documentVersionId === version.documentVersionId ? ' selected' : ''}`}
                aria-current={selectedVersion?.documentVersionId === version.documentVersionId ? 'true' : undefined}
                key={version.documentVersionId}
                tabIndex={0}
                onClick={() => selectVersion(version)}
                onKeyDown={(event) => event.target === event.currentTarget && event.key === 'Enter' && selectVersion(version)}
              >
                {sourceBody(version)}
                <span aria-hidden="true">阅读 →</span>
              </div>
            )) : null}
          </Fragment>
        );
      })}
      {!loading && !error && !documents?.items.length && <p className="knowledge-empty">没有匹配的可读资料。</p>}{pagination}
    </section>
    <section className="panel knowledge-preview" aria-label="文档 Wiki" ref={articleRef}
      onScroll={event => rememberScroll('articleY', event.currentTarget.scrollTop)}>
      {versionPin.length > 1 ? <p role="alert">文档版本身份有重复参数，请重新选择确切版本。</p>
        : versionPin.length === 1 && !loading && !selectedVersion
          ? <p role="alert">指定版本不在当前可读目录结果，请调整筛选或重新选择。</p>
        : selectedVersion ? <>
        <div className="article-kicker">工程文档 · {libraryVersionLabel(selectedVersion)} · {selectedVersion.selectedVersionIsCurrent ? '当前版本' : '历史版本'}</div>
        <h1>{documents?.items.find(document => document.versions.some(version =>
          version.documentVersionId === selectedVersion.documentVersionId))?.documentCode ?? '文档版本'}</h1>
        <SavedDocumentReadingArticle key={`${selectedVersion.documentVersionId}:${selectedVersion.documentReading?.reading?.readingRunRef ?? ''}`}
          version={selectedVersion} onOpenSource={route => openDocument(route, selectedVersion.documentVersionId)} />
        {TDMS_SOURCE_UI_ENABLED ? <TdmsSourceEntry key={selectedVersion.documentVersionId}
          context={{ documentVersionId: selectedVersion.documentVersionId }} enabled={TDMS_SOURCE_UI_ENABLED}
          openDocument={documentVersionId => openDocument(`/document-versions/${encodeURIComponent(documentVersionId)}`, documentVersionId)} /> : null}
        <section className="knowledge-prose"><h2>关联工程事项</h2>
          {visibleRelatedLoading ? <p role="status">正在核对已登记关联…</p>
            : visibleRelatedError ? <p role="alert">{visibleRelatedError} <button onClick={retryRead}>重试</button></p>
            : visibleRelated?.items.length ? visibleRelated.items.map(matter =>
              <p key={matter.matterId}><Link to={`/matters/${encodeURIComponent(matter.matterId)}`}>{matter.title}</Link>
                {matter.result?.listBrief ? ` · ${matter.result.listBrief}` : ' · 尚无已保存综合认识'}</p>)
            : <p>没有通过该版本的文档工作登记的可读事项。</p>}
          {visibleRelated?.nextCursor && <p>还有其他关联事项，可在事项目录按名称查找。</p>}
        </section>
        {selectedVersion.readerWorkItemId && <section className="knowledge-prose">
          <h2>该版本的评估工作</h2>
          <Link to={`/knowledge?${new URLSearchParams({
            ...directoryRequestFilters(params), ...(params.get('ataTitleScheme') ? { ataTitleScheme: params.get('ataTitleScheme')! } : {}),
            kind: 'works', workItemId: selectedVersion.readerWorkItemId,
          })}`}>查看该版本评估</Link>
        </section>}
        <div className="knowledge-actions"><button onClick={() => openDocument(
          `/document-versions/${encodeURIComponent(selectedVersion.documentVersionId)}`,
          selectedVersion.documentVersionId)}>精读该文档版本与原文</button></div>
      </> : <p className="knowledge-empty">选择一份工程文档，阅读其简明解读、条件和已登记关联事项。</p>}
    </section></div>}
      </div>
    </div>
    {source && kind === 'works' && read && keyOf(read.entry) === selection && <MatterDocumentSourceDialog key={`${source.documentVersionId}:${source.sourceRef}`} {...source} onClose={() => setSource(null)} />}
  </>;
}
