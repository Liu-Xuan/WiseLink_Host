import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { CanonicalLibraryDocumentsResponse, CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import type { EngineeringKnowledgeEntry, EngineeringKnowledgeIdentity, EngineeringKnowledgePage, EngineeringKnowledgeRead, EngineeringKnowledgeScope } from '@shared/engineering-issue-search.interface';
import { getCanonicalLibraryDocuments, readEngineeringKnowledgeCatalogue, readEngineeringKnowledgeWork } from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import EngineeringIssueBody from '@client/src/features/matter/EngineeringIssueBody';
import { JobAidIssueArticle } from '@client/src/pages/DocumentParsingPage/JobAidIssueArticle';
import { exactDocumentSourceRoute, matterWorkRoute } from '@client/src/features/matter/matter-navigation';
import { knowledgeReadingParams, knowledgeReadingIdentity } from '@client/src/features/matter/reading-return';
import {
  libraryVersionLabel,
  projectLibraryDocumentReading,
} from '@client/src/pages/WorkspaceHomePage/library-document-presentation';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import MatterDocumentSourceDialog from '@client/src/features/matter/MatterDocumentSourceDialog';
import OverviewCorrectionNotices from '@client/src/features/matter/OverviewCorrectionNotices';
import ReferenceWorkNotices from '@client/src/features/matter/ReferenceWorkNotices';
import OverviewSourceWork from '@client/src/features/matter/OverviewSourceWork';
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

export default function KnowledgeLookupPage() {
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  return <main className="wl-knowledge-suite" aria-label="工程知识">
    <header className="page-heading"><div><h1>工程知识</h1><p>先找到已有解释，再核对它的条件、来源和确切工作范围。</p></div><small>直接读取已保存工作</small></header>
    {authenticationRequired ? <p role="alert">请先登录，再读取当前账户有权查看的工程知识。</p>
      : <KnowledgeCatalogue key={sessionGeneration} />}
  </main>;
}

function KnowledgeCatalogue() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.get('query') ?? '';
  const scope: EngineeringKnowledgeScope = params.get('scope') === 'ALL' ? 'ALL' : params.get('scope') === 'HISTORICAL' ? 'HISTORICAL' : 'CURRENT';
  const kind = params.get('kind') === 'sources' ? 'sources' : 'works';
  const after = params.get('after') ?? undefined;
  const identityPin = knowledgeReadingIdentity(params);
  const identity = identityPin.state === 'ok' ? identityPin.identity : null;
  const selection = identity ? keyOf(identity) : '';
  const listKey = JSON.stringify([query, scope, kind, after]);
  const [loadedPage, setPage] = useState<EngineeringKnowledgePage | null>(null);
  const [loadedDocuments, setDocuments] = useState<CanonicalLibraryDocumentsResponse | null>(null);
  const [loadedRead, setRead] = useState<EngineeringKnowledgeRead | null>(null);
  const [loading, setLoading] = useState(true), [readBusy, setReading] = useState(false);
  const [error, setError] = useState(''), [readFailure, setReadError] = useState('');
  const [readRequestKey, setReadRequestKey] = useState('');
  const reading = Boolean(selection && (readRequestKey !== selection || readBusy));
  const readError = readRequestKey === selection ? readFailure : '';
  const [loadedKey, setLoadedKey] = useState('');
  const page = loadedKey === listKey ? loadedPage : null;
  const documents = loadedKey === listKey ? loadedDocuments : null;
  const read = loadedRead && keyOf(loadedRead.entry) === selection ? loadedRead : null;
  const [retry, setRetry] = useState(0);
  const [source, setSource] = useState<{ documentVersionId: string; sourceRef: string | null } | null>(null);
  const [expandedFamilies, setExpandedFamilies] = useState<Record<string, boolean>>({});
  const [expandedConditions, setExpandedConditions] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLElement>(null), articleRef = useRef<HTMLElement>(null);
  const currentParams = useRef(params); currentParams.current = params;
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScroll = useRef<Record<string, string>>({});

  function clearPendingScroll() {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    pendingScroll.current = {};
  }
  function select(entry: EngineeringKnowledgeEntry) {
    clearPendingScroll();
    setParams(prior => { const next = new URLSearchParams(prior); next.set('subjectKind', entry.subjectKind); next.set('subjectId', entry.subjectId); next.set('workRef', entry.workRef); next.delete('articleY'); return next; }, { replace: true });
  }
  function change(key: string, value: string) {
    clearPendingScroll();
    setParams(prior => { const next = new URLSearchParams(prior); next.set(key, value); ['after', 'subjectKind', 'subjectId', 'workRef', 'listY', 'articleY'].forEach(name => next.delete(name)); return next; }, { replace: true });
  }
  function rememberScroll(key: 'listY' | 'articleY', top: number) {
    pendingScroll.current[key] = String(Math.min(9999999, Math.max(0, Math.round(top))));
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    const expectedIdentity = selection, expectedList = listKey;
    scrollTimer.current = setTimeout(() => {
      const pin = knowledgeReadingIdentity(currentParams.current);
      const actualIdentity = pin.state === 'ok' ? keyOf(pin.identity) : '';
      const actualList = JSON.stringify([currentParams.current.get('query') ?? '', currentParams.current.get('scope') ?? 'CURRENT', currentParams.current.get('kind') ?? 'works', currentParams.current.get('after') ?? undefined]);
      if (expectedIdentity !== actualIdentity || expectedList !== actualList) { pendingScroll.current = {}; return; }
      const values = pendingScroll.current; pendingScroll.current = {};
      setParams(prior => { const next = new URLSearchParams(prior); Object.entries(values).forEach(([name, value]) => next.set(name, value)); return next; }, { replace: true });
    }, 200);
  }
  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current); }, []);

  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setDocuments(null); setError(''); setLoading(true);
    const timer = setTimeout(() => {
      void (kind === 'works'
        ? readEngineeringKnowledgeCatalogue(query, scope, after, controller.signal).then(value => {
            if (controller.signal.aborted) return;
            setPage(value); setLoadedKey(listKey);
            if (knowledgeReadingIdentity(currentParams.current).state === 'absent' && value.entries[0]) select(value.entries[0]);
          })
        : getCanonicalLibraryDocuments({ search: query, cursor: after, limit: 24 }, controller.signal).then(value => {
            if (!controller.signal.aborted) { setDocuments(value); setLoadedKey(listKey); }
          }))
        .catch(cause => { if (!controller.signal.aborted) setError(failure(cause)); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, scope, kind, after, retry]);

  useEffect(() => {
    const controller = new AbortController();
    setReadRequestKey(selection); setRead(null); setReadError(''); setSource(null);
    if (!selection || kind !== 'works') { setReading(false); return; }
    setReading(true);
    const pin = knowledgeReadingIdentity(currentParams.current);
    if (pin.state !== 'ok') return;
    const selected = pin.identity;
    void readEngineeringKnowledgeWork(selected, controller.signal).then(value => {
      if (!controller.signal.aborted) setRead(value);
    }).catch(cause => { if (!controller.signal.aborted) setReadError(failure(cause)); })
      .finally(() => { if (!controller.signal.aborted) setReading(false); });
    return () => controller.abort();
  }, [selection, kind, retry]);

  useEffect(() => {
    if (!loading && listRef.current) listRef.current.scrollTop = Number(currentParams.current.get('listY') ?? 0);
  }, [loading]);
  useEffect(() => {
    if (read && articleRef.current) articleRef.current.scrollTop = Number(currentParams.current.get('articleY') ?? 0);
  }, [read]);

  function openDocument(route: string, documentVersionId: string) {
    if (kind === 'works' && (!read || keyOf(read.entry) !== selection)) return;
    clearPendingScroll();
    const queryStart = route.indexOf('?');
    const path = queryStart === -1 ? route : route.slice(0, queryStart);
    const raw = queryStart === -1 ? '' : route.slice(queryStart + 1);
    const next = new URLSearchParams(raw);
    const state = knowledgeReadingParams(currentParams.current);
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
  const nextCursor = kind === 'works' ? page?.nextCursor : documents?.nextCursor;
  const pagination = <div className="knowledge-pagination">
    {after && <button onClick={() => change('kind', kind)}>回到首批</button>}
    {nextCursor && <button onClick={() => { clearPendingScroll(); setParams(prior => { const next = new URLSearchParams(prior); next.set('after', nextCursor); ['subjectKind', 'subjectId', 'workRef', 'listY', 'articleY'].forEach(key => next.delete(key)); return next; }); }}>下一批</button>}
  </div>;
  return <>
    <div className="knowledge-toolbar">
      <div className="tabs" role="group" aria-label="知识类型"><button aria-pressed={kind === 'works'} onClick={() => change('kind', 'works')}>工程认识</button><button aria-pressed={kind === 'sources'} onClick={() => change('kind', 'sources')}>来源资料</button></div>
      <label className="knowledge-search"><Search size={18} /><input aria-label="搜索工程知识" maxLength={200} placeholder="问题、对象、条件或来源标识…" value={query} onChange={event => change('query', event.target.value)} /></label>
      {kind === 'works' && <select aria-label="知识版本范围" value={scope} onChange={event => change('scope', event.target.value)}><option value="CURRENT">当前工作</option><option value="ALL">包含历史工作</option><option value="HISTORICAL">仅历史工作</option></select>}
    </div>
    {identityPin.state === 'invalid' && <p role="alert">知识工作身份不完整或有重复参数，请重新选择确切工作。</p>}
    {error && <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>重试</button></p>}
    {kind === 'works' ? <div className="knowledge-layout">
      <section className="panel knowledge-results" aria-label="已有工程认识" ref={listRef} onScroll={event => rememberScroll('listY', event.currentTarget.scrollTop)}>
        <div className="panel-head"><h2>{loading ? '正在读取已有认识…' : `本批 ${page?.entries.length ?? 0} 条可查阅工作`}</h2></div>
        {page?.entries.map(entry => <button className={`knowledge-hit${selection === keyOf(entry) ? ' selected' : ''}`} key={keyOf(entry)} aria-pressed={selection === keyOf(entry)} onClick={() => select(entry)}>
          <small className={entry.current ? 'knowledge-badge' : 'knowledge-badge historical'}>{entry.current ? '当前工作' : '历史工作'} · 修订 {entry.workRevision}</small>
          <h2>{entry.headline || '认识主题待补齐'}</h2><p>{entry.listBrief || '简明解读待补齐，可打开已保存正文。'}</p>
          <small>{entry.subjectKind === 'ENGINEERING_MATTER' ? '工程事项' : '文档工作'} · {displayDate(entry.createdAt)}</small>
          {entry.overviewStatus === 'STALE' && <span className="coverage-hint">综合尚未覆盖本轮问题</span>}
        </button>)}
        {!loading && !error && !page?.entries.length && <p className="knowledge-empty">没有匹配的已保存认识，可调整关键词或版本范围。</p>}{pagination}
      </section>
      <section className="panel knowledge-preview" aria-label="完整工程认识" ref={articleRef} onScroll={event => rememberScroll('articleY', event.currentTarget.scrollTop)}>
        {reading ? <p role="status">正在读取确切工作…</p> : readError ? <p role="alert">{readError} <button onClick={() => setRetry(value => value + 1)}>重试</button></p> : read ? <>
          <div className="article-kicker">{read.entry.current ? '已保存的工程认识' : '当时的工程认识'} · 工作修订 {read.entry.workRevision}</div>
          <h1>{read.entry.headline || '已保存的工程认识'}</h1><p className="article-lead">{read.entry.listBrief}</p>
          <small>{read.entry.subjectKind === 'ENGINEERING_MATTER' ? '工程事项' : '文档工作'} · {displayDate(read.entry.createdAt)}</small>
          {!read.entry.current && <div className="knowledge-notice">当前显示当时保存的解释；查看当前事项是独立导航，不替换本条历史内容。</div>}
          {read.entry.overviewStatus !== 'CURRENT' && <div className="knowledge-notice">{read.entry.overviewStatus === 'STALE' ? '问题已更新，综合尚未覆盖。本页保留各部分的确切保存范围。' : '当前已保存问题解释，综合认识尚未形成。'}</div>}
          {read.content.understanding && <section className="knowledge-prose"><h2>本工作的问题理解</h2><EngineeringIssueBody body={read.content.understanding} evidence={read.content.evidence} onLocateDocument={locate} /></section>}
          {read.content.issues.map(issue => <section className="knowledge-prose" key={issue.issueKey}><JobAidIssueArticle issue={issue} evidence={read.content.evidence} onLocateDocument={locate} /></section>)}
          {read.entry.subjectKind === 'ENGINEERING_MATTER' && <>
            <OverviewSourceWork matterId={read.entry.subjectId} source={read.overviewSourceWork} overviewStatus={read.entry.overviewStatus} />
            <OverviewCorrectionNotices matterId={read.entry.subjectId} notices={read.overviewCorrectionNotices} />
          </>}
          {read.correctionNotices?.map(notice => <p role="note" key={`${notice.issueKey}:${notice.attemptRef}`}>{notice.unchanged ? '已核对并保留原认识：' : notice.correctedWorkRef ? '已有后继更正：' : '仍有待核更正：'}{notice.reason}</p>)}
          <ReferenceWorkNotices notices={read.referenceWorkNotices} />
          <div className="knowledge-actions">{read.entry.subjectKind === 'ENGINEERING_MATTER' ? <>
            <Link to={matterWorkRoute(read.entry.subjectId, read.entry.workRef)}><BookOpen size={16} />打开对应工作 Wiki</Link>
            {!read.entry.current && <Link to={`/matters/${encodeURIComponent(read.entry.subjectId)}`}>查看事项当前认识</Link>}
          </> : <Link to={`/work-items/${encodeURIComponent(read.entry.subjectId)}`}>查看文档工作</Link>}</div>
        </> : <p className="knowledge-empty">选择一条已有认识，阅读完整解释与来源。</p>}
      </section>
    </div> : <section className="panel knowledge-sources" aria-label="来源资料">
      <div className="panel-head"><h2>资料标题与确切版本</h2></div>
      {loading ? <p role="status">正在读取来源资料…</p> : documents?.items.map(document => {
        const current = document.versions.find(item => item.selectedVersionIsCurrent);
        const historical = document.versions.filter(item => !item.selectedVersionIsCurrent);
        const expanded = Boolean(expandedFamilies[document.familyId]);
        const sourceBody = (version: CanonicalLibraryDocumentVersionSummary) => {
          const reading = projectLibraryDocumentReading(version);
          const partialCoverageLine =
            reading.coverageStatus === 'PARTIAL_DELIVERY'
              ? (reading.conditionLines[0] ?? null)
              : null;
          const foldedLines = partialCoverageLine
            ? reading.conditionLines.slice(1)
            : reading.conditionLines;
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
              {partialCoverageLine || foldedLines.length ? (
                <div className="knowledge-source-conditions">
                  {partialCoverageLine ? (
                    <p className="knowledge-source-coverage">{partialCoverageLine}</p>
                  ) : null}
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
        const openVersion = (version: CanonicalLibraryDocumentVersionSummary) => openDocument(`/document-versions/${encodeURIComponent(version.documentVersionId)}`, version.documentVersionId);
        return (
          <Fragment key={document.familyId}>
            {current ? (
              <div
                className="knowledge-source"
                tabIndex={0}
                onClick={() => openVersion(current)}
                onKeyDown={(event) => event.target === event.currentTarget && event.key === 'Enter' && openVersion(current)}
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
                <span aria-hidden="true">精读 →</span>
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
                className="knowledge-source knowledge-source-history"
                key={version.documentVersionId}
                tabIndex={0}
                onClick={() => openVersion(version)}
                onKeyDown={(event) => event.target === event.currentTarget && event.key === 'Enter' && openVersion(version)}
              >
                {sourceBody(version)}
                <span aria-hidden="true">精读 →</span>
              </div>
            )) : null}
          </Fragment>
        );
      })}
      {!loading && !error && !documents?.items.length && <p className="knowledge-empty">没有匹配的可读资料。</p>}{pagination}
    </section>}
    {source && <MatterDocumentSourceDialog key={`${source.documentVersionId}:${source.sourceRef}`} {...source} onClose={() => setSource(null)} />}
  </>;
}
