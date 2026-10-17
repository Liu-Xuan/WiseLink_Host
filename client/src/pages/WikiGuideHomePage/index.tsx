import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Search } from 'lucide-react';
import type { WikiGuideNode, WikiGuidePathSegment, WikiGuideIssueHit } from '@shared/wiki-guide.interface';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/src/components/ui/select';
import { ataDirectoryTitles } from '@client/src/pages/WorkspaceHomePage/library-ata-directory';
import {
  readWikiGuideState, wikiGuideStateParams, wikiGuideSummaryRoute, wikiGuideIssueRoute,
  wikiGuideIssueAnchor, type WikiGuideState, type WikiGuidePageState,
} from '@client/src/lib/wiki-guide-route';
import { useWikiGuideNavigation, useWikiGuideNode, useWikiGuideIssues, WIKI_GUIDE_QUERY_ROOT } from './resources';
import './wiki-guide.css';

const modelName = (node: WikiGuidePathSegment): string =>
  node.scope.fleetModelIds.join(' / ') || node.scope.fleetFamilyId;
const nodeTitle = (node: WikiGuidePathSegment): string => node.scope.title ||
  (node.scope.kind === 'FLEET' ? modelName(node) : 'ATA ' + (node.scope.ata4 ?? node.scope.ata2));
// A title-only catalog overlay on the exact registered ATA, never a scope inference.
const compactTitle = (node: WikiGuidePathSegment): string => {
  const code = node.scope.ata4 ?? node.scope.ata2;
  const names = code ? [...new Set(ataDirectoryTitles(code, 'ispec').map(title => title.titleZH || title.titleEN))] : [];
  return names.join(' / ') || nodeTitle(node);
};
const pathLabel = (path: WikiGuidePathSegment[]): string => path.map(node => node.scope.kind === 'FLEET'
  ? modelName(node) : 'ATA ' + (node.scope.ata4 ?? node.scope.ata2) + ' ' + compactTitle(node)).join(' / ');
const savedLabel = (node: WikiGuideNode): string => node.currentSummaryRef
  ? (node.currentBodyStatus === 'UPDATING_SCOPE' ? '上次保存修订 ' : '已保存修订 ') + node.currentRevision
  : '尚无已保存正文';
const primaryClick = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
// One in-memory focus hint survives a reader round trip; no body or persistent store.
let readFocus: { session: number; state: string; target: string } | null = null;

export default function WikiGuideHomePage() {
  const [params] = useSearchParams();
  const state = readWikiGuideState(params);
  return state ? <WikiGuide key="wiki-guide" state={state} /> : <main className="wiki-guide-home">
    <h1>Wiki 导览</h1><p role="alert">导览链接无效。</p><Link to="/situation">打开 Wiki 导览</Link>
  </main>;
}

function WikiGuide({ state }: { state: WikiGuideState }) {
  const navigate = useNavigate(), client = useQueryClient();
  const { sessionGeneration: session, authenticationRequired } = useCurrentUserSession();
  if (readFocus && readFocus.session !== session) readFocus = null;
  const [revision, setRevision] = useState(0), [denied, setDenied] = useState<number | null>(null);
  const enabled = !authenticationRequired && denied !== session;
  const onDenied = useCallback(() => {
    setDenied(session);
    void client.cancelQueries({ queryKey: [...WIKI_GUIDE_QUERY_ROOT, session] });
    client.removeQueries({ queryKey: [...WIKI_GUIDE_QUERY_ROOT, session] });
  }, [client, session]);
  const roots = useWikiGuideNavigation({}, session, revision, enabled, onDenied);
  // A deep link may name a chapter outside the first root/child page.
  const pathRead = useWikiGuideNode(!state.rootSummaryId ? state.chapterSummaryId : null,
    session, revision, enabled, onDenied);
  const pathRoot = pathRead.node?.path.find(node => node.scope.kind === 'FLEET' && node.parentSummaryId === null);
  const rootId = state.rootSummaryId ?? pathRoot?.summaryId ??
    (!state.chapterSummaryId ? roots.items[0]?.summaryId : null) ?? null;
  const knownRoot = roots.items.find(node => node.summaryId === rootId) ?? null;
  const rootRead = useWikiGuideNode(knownRoot ? null : rootId, session, revision, enabled, onDenied);
  const root = knownRoot ?? rootRead.node;
  const rootValid = root?.scope.kind === 'FLEET' && root.parentSummaryId === null;
  const chapters = useWikiGuideNavigation({ parentSummaryId: rootId ?? undefined },
    session, revision, enabled && Boolean(rootValid), onDenied);
  const chapterRows = chapters.items.filter(node => node.scope.kind === 'ATA2' && node.parentSummaryId === rootId);
  const chapterId = state.chapterSummaryId ?? chapterRows[0]?.summaryId ?? null;
  const knownChapter = chapterRows.find(node => node.summaryId === chapterId) ??
    (pathRead.node?.summaryId === chapterId ? pathRead.node : null);
  const chapterRead = useWikiGuideNode(knownChapter ? null : chapterId, session, revision,
    enabled && Boolean(rootValid), onDenied);
  const chapter = knownChapter ?? chapterRead.node;
  const chapterValid = chapter?.scope.kind === 'ATA2' && chapter.parentSummaryId === rootId &&
    chapter.path.some(node => node.summaryId === rootId);
  const search = state.search.trim();
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search), 250); return () => clearTimeout(timer); }, [search]);
  const searching = Boolean(search), readySearch = searching && debouncedSearch === search;
  const sections = useWikiGuideNavigation({ parentSummaryId: chapterId ?? undefined }, session, revision,
    enabled && Boolean(chapterValid) && !searching, onDenied, state.page?.kind === 'SECTIONS' ? state.page.after : null);
  const searchChapters = useWikiGuideNavigation({ rootSummaryId: rootId ?? undefined, search }, session, revision,
    enabled && Boolean(rootValid) && readySearch, onDenied, state.page?.kind === 'SEARCH_CHAPTERS' ? state.page.after : null);
  const issues = useWikiGuideIssues({ rootSummaryId: rootId ?? '', search, scope: 'CURRENT' }, session, revision,
    enabled && Boolean(rootValid) && readySearch, onDenied, state.page?.kind === 'ISSUES' ? state.page.after : null);

  const page = useRef<HTMLElement | null>(null), stateRef = useRef(state); stateRef.current = state;
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restored = useRef('');
  const [restoreGap, setRestoreGap] = useState('');
  const scrollContainer = (): HTMLElement | null => page.current?.closest<HTMLElement>('[data-reading-scroll-container]') ?? page.current;
  const findReadLink = (anchor: string): HTMLAnchorElement | undefined =>
    [...page.current?.querySelectorAll<HTMLAnchorElement>('[data-wiki-read-key]') ?? []]
      .find(item => item.dataset.wikiReadKey === anchor);
  const viewportOffset = (link: HTMLElement): number => Math.min(10_000, Math.max(-10_000, Math.round(
    link.getBoundingClientRect().top - (scrollContainer()?.getBoundingClientRect().top ?? 0))));
  const clearScroll = (): void => { if (scrollTimer.current) clearTimeout(scrollTimer.current); scrollTimer.current = null; };
  const currentState = (): WikiGuideState => {
    const value = stateRef.current, anchor = value.page && findReadLink(value.page.anchor);
    return { ...value, scrollTop: Math.min(9_999_999, Math.max(0, Math.round(scrollContainer()?.scrollTop ?? value.scrollTop))),
      ...(value.page && anchor ? { page: { ...value.page, offset: viewportOffset(anchor) } } : {}) };
  };
  function change(next: WikiGuideState, replace = false): void {
    clearScroll(); stateRef.current = next;
    const query = wikiGuideStateParams(next).toString();
    navigate('/situation' + (query ? '?' + query : ''), { replace });
  }
  useEffect(() => {
    if (!enabled || !rootValid || !root) return;
    if (state.rootSummaryId === null || (state.chapterSummaryId === null && chapterValid && chapter)) {
      change({ ...state, rootSummaryId: root.summaryId,
        chapterSummaryId: chapterValid && chapter ? chapter.summaryId : state.chapterSummaryId }, true);
    }
  }, [enabled, root?.summaryId, rootValid, chapter?.summaryId, chapterValid, state.rootSummaryId, state.chapterSummaryId]);
  const scopeOf = (value: WikiGuideState): string => JSON.stringify([session, value.rootSummaryId,
    value.chapterSummaryId, value.search, value.page ? [value.page.kind, value.page.after, value.page.anchor] : null]);
  const restoreScope = scopeOf(state);
  const searchingLoading = searching && (!readySearch || searchChapters.loading || issues.loading);
  const ready = enabled && !roots.loading && !rootRead.loading && !pathRead.loading &&
    !chapters.loading && !chapterRead.loading && (searching ? !searchingLoading : !sections.loading);
  useLayoutEffect(() => {
    if (!ready || restored.current === restoreScope) return;
    const target = scrollContainer();
    if (state.page) {
      const source = state.page.kind === 'SECTIONS' ? sections : state.page.kind === 'SEARCH_CHAPTERS' ? searchChapters : issues;
      const link = source.pageFor(state.page.anchor) === state.page.after ? findReadLink(state.page.anchor) : undefined;
      if (!link || !target) { if (restoreGap !== restoreScope) setRestoreGap(restoreScope); return; }
      target.scrollTop = Math.max(0, target.scrollTop + viewportOffset(link) - state.page.offset);
      link.focus({ preventScroll: true });
    } else if (target) target.scrollTop = state.scrollTop;
    if (readFocus?.session === session && readFocus.state === wikiGuideStateParams(state).toString()) {
      const link = findReadLink(readFocus.target);
      if (link) { link.focus({ preventScroll: true }); readFocus = null; }
    }
    restored.current = restoreScope;
    if (restoreGap) setRestoreGap('');
  }, [ready, restoreScope, state.scrollTop, sections.items.length, searchChapters.items.length, issues.items.length]);
  useEffect(() => {
    const target = scrollContainer();
    if (!target) return;
    const remember = (): void => {
      clearScroll();
      const scope = restoreScope;
      scrollTimer.current = setTimeout(() => {
        if (scope !== scopeOf(stateRef.current)) return;
        const next = currentState();
        if (next.scrollTop !== stateRef.current.scrollTop || next.page?.offset !== stateRef.current.page?.offset) change(next, true);
      }, 160);
    };
    target.addEventListener('scroll', remember);
    return () => { target.removeEventListener('scroll', remember); clearScroll(); };
  }, [restoreScope, session]);
  const withPage = (base: WikiGuideState, kind?: WikiGuidePageState['kind'], anchor?: string, offset = 0): WikiGuideState => {
    const after = kind === 'SECTIONS' ? sections.pageFor(anchor!) : kind === 'SEARCH_CHAPTERS'
      ? searchChapters.pageFor(anchor!) : kind === 'ISSUES' ? issues.pageFor(anchor!) : undefined;
    return { ...base, page: kind && anchor && after !== undefined ? { kind, after, anchor, offset } : undefined };
  };
  const openSummary = (event: MouseEvent<HTMLAnchorElement>, node: WikiGuideNode, kind?: WikiGuidePageState['kind']): void => {
    if (!primaryClick(event)) return;
    const state = withPage(currentState(), kind, node.summaryId, viewportOffset(event.currentTarget));
    const route = wikiGuideSummaryRoute(node, state);
    if (route) {
      readFocus = { session, state: wikiGuideStateParams(state).toString(), target: node.summaryId };
      event.preventDefault(); change(state, true); navigate(route);
    }
  };
  const openIssue = (event: MouseEvent<HTMLAnchorElement>, hit: WikiGuideIssueHit): void => {
    if (!primaryClick(event)) return;
    const anchor = wikiGuideIssueAnchor(hit);
    const state = withPage(currentState(), 'ISSUES', anchor, viewportOffset(event.currentTarget));
    const route = wikiGuideIssueRoute(hit, state);
    if (route) {
      readFocus = { session, state: wikiGuideStateParams(state).toString(), target: anchor };
      event.preventDefault(); change(state, true); navigate(route);
    }
  };
  const summaryLink = (node: WikiGuideNode, label: string, className = 'wg-text-action', kind?: WikiGuidePageState['kind']) => {
    const route = wikiGuideSummaryRoute(node, withPage(state, kind, node.summaryId));
    return route ? <Link className={className} data-wiki-read-key={node.summaryId} to={route} onClick={event => openSummary(event, node, kind)}>
      {label}<BookOpen size={14} aria-hidden="true" /></Link> : <span className="wg-empty-label">
        {node.currentSummaryRef ? '阅读入口无效' : '尚无已保存正文'}</span>;
  };
  const rootRows = [...new Map([...(rootValid && root && !knownRoot ? [root] : []), ...roots.items]
    .map(node => [node.summaryId, node])).values()];
  const visibleChapters = [...new Map([...(chapterValid && chapter ? [chapter] : []), ...chapterRows]
    .map(node => [node.summaryId, node])).values()]
    .sort((a, b) => (a.scope.ata2 ?? '').localeCompare(b.scope.ata2 ?? '', 'en', { numeric: true }));
  const badRoot = root && !rootValid;
  const badChapter = chapter && !chapterValid;
  const errors = [...new Set([roots.error, pathRead.error, rootRead.error, chapters.error, chapterRead.error,
    searching ? searchChapters.error : sections.error, searching ? issues.error : null].filter(Boolean))];
  const missingRoot = Boolean(rootId && !root && rootRead.resolved);
  const missingChapter = Boolean(chapterId && !chapter && chapterRead.resolved);

  return <main ref={page} className="wiki-guide-home" aria-label="Wiki 导览" aria-busy={enabled && !ready}>
    <header className="wg-heading"><h1>Wiki 导览</h1><div className="wg-heading-actions">
      <Link to="/knowledge?kind=works">已保存工作</Link>
      <Button type="button" variant="ghost" size="sm" disabled={authenticationRequired}
        onClick={() => { setDenied(null); setRevision(value => value + 1); }}>刷新</Button>
    </div></header>
    {authenticationRequired ? <p role="alert">请先登录，再读取工程知识。</p>
      : denied === session ? <p role="alert">此知识内容暂不可读取。</p> : null}
    {enabled ? <>
      <div className="wg-toolbar">
        <div className="wg-models" role="group" aria-label="选择机型">
          {rootRows.map(node => <Button type="button" key={node.summaryId} variant="ghost" size="sm"
            aria-pressed={node.summaryId === rootId} onClick={() => change({
              rootSummaryId: node.summaryId, chapterSummaryId: null, search: state.search, scrollTop: 0,
            })}>{modelName(node)}</Button>)}
          {roots.hasMore ? <Button type="button" variant="ghost" size="sm" disabled={roots.loadingMore}
            onClick={roots.loadMore}>{roots.loadingMore ? '正在读取…' : '更多机型'}</Button> : null}
        </div>
        <label className="wg-search" htmlFor="global-search"><Search size={16} aria-hidden="true" />
          <Input id="global-search" type="search" aria-label="搜索章节或已保存问题" maxLength={200}
            placeholder={root ? '在 ' + modelName(root) + ' 中查找章节或问题' : '查找章节或问题'}
            value={state.search} onChange={event => change({ ...state, search: event.target.value, scrollTop: 0, page: undefined }, true)} />
        </label>
      </div>
      {errors.map(error => <p className="wg-message" role="alert" key={error}>{error}</p>)}
      {badRoot || badChapter || missingRoot || missingChapter ? <p role="alert">所选机型或章节不可读取。</p> : null}
      {state.page ? <div className="wg-more">
        {restoreGap === restoreScope ? <p role="status">返回项暂不可定位。</p> : null}
        <Button type="button" variant="ghost" size="sm"
          onClick={() => change({ ...state, page: undefined, scrollTop: 0 }, true)}>回到首项</Button>
      </div> : null}
      {roots.loading || rootRead.loading || pathRead.loading ? <p role="status">正在读取 Wiki 目录…</p> : null}
      {!roots.loading && !roots.error && !rootId && !state.chapterSummaryId ? <p role="status">暂无已注册 Wiki。</p> : null}
      {rootValid && root ? <section className="wg-workbench" aria-label="分层 Wiki 目录">
        <div className="wg-model-bar"><div><strong>{modelName(root)}</strong><span>机型知识</span></div>
          {summaryLink(root, '阅读机型 Wiki')}</div>
        <div className="wg-browser">
          <aside className="wg-chapter-sidebar" aria-label="ATA 两位章节目录"><h2>ATA 章节</h2>
            <ul>{visibleChapters.map(node => <li key={node.summaryId}><Button type="button" variant="ghost"
              className="wg-chapter" title={node.scope.title} aria-current={node.summaryId === chapterId ? 'true' : undefined}
              onClick={() => change({ ...state, chapterSummaryId: node.summaryId, search: '', scrollTop: 0, page: undefined })}>
              <span className="wg-code">{node.scope.ata2}</span><span>{compactTitle(node)}</span>
            </Button></li>)}</ul>
            {chapters.loading ? <p role="status">正在读取章节…</p> : null}
            {chapters.hasMore ? <Button type="button" variant="ghost" size="sm" disabled={chapters.loadingMore}
              onClick={chapters.loadMore}>{chapters.loadingMore ? '正在读取…' : '更多章节'}</Button> : null}
          </aside>
          <div className="wg-browser-content">
            {visibleChapters.length ? <div className="wg-mobile-chapters"><label htmlFor="wiki-mobile-chapter">ATA 章节</label>
              <Select value={chapterValid && chapter ? chapter.summaryId : undefined}
                onValueChange={value => change({ ...state, chapterSummaryId: value, search: '', scrollTop: 0, page: undefined })}>
                <SelectTrigger id="wiki-mobile-chapter" aria-label="选择 ATA 章节"><SelectValue placeholder="选择章节" /></SelectTrigger>
                <SelectContent>{visibleChapters.map(node => <SelectItem key={node.summaryId} value={node.summaryId} title={node.scope.title}>
                  {node.scope.ata2} · {compactTitle(node)}</SelectItem>)}</SelectContent>
              </Select>
              {chapters.hasMore ? <Button variant="ghost" size="sm" onClick={chapters.loadMore}
                disabled={chapters.loadingMore}>更多章节</Button> : null}
            </div> : null}
            {searching ? <section aria-label="章节与问题搜索结果">
              <div className="wg-search-heading"><h2>{modelName(root)} 中的搜索结果</h2>
                <Button variant="ghost" size="sm" onClick={() => change({ ...state, search: '', scrollTop: 0, page: undefined }, true)}>返回目录</Button></div>
              {searchingLoading ? <p role="status">正在查找…</p> : null}
              {readySearch ? <ul className="wg-results">
                {searchChapters.items.map(node => <li key={node.summaryId}><span className="wg-result-kind">
                  {node.scope.kind === 'ATA4' ? '子章节 Wiki' : '章节 Wiki'}</span>
                  <div className="wg-result-title">{summaryLink(node, nodeTitle(node), 'wg-text-action', 'SEARCH_CHAPTERS')}</div>
                  <p className="wg-result-path" title={node.path.map(item => item.scope.title).join(' / ')}>{pathLabel(node.path)}</p></li>)}
                {issues.items.map(hit => <li key={wikiGuideIssueAnchor(hit)}>
                  <span className="wg-result-kind">已保存问题</span>
                  {wikiGuideIssueRoute(hit, withPage(state, 'ISSUES', wikiGuideIssueAnchor(hit))) ? <Link className="wg-result-title"
                    to={wikiGuideIssueRoute(hit, withPage(state, 'ISSUES', wikiGuideIssueAnchor(hit)))!}
                    data-wiki-read-key={wikiGuideIssueAnchor(hit)}
                    onClick={event => openIssue(event, hit)}>{hit.question}</Link>
                    : <span className="wg-result-title">{hit.question}</span>}
                  {hit.paths.map(path => <p className="wg-result-path" title={path.map(item => item.scope.title).join(' / ')}
                    key={path.map(node => node.summaryId).join('/')}>{pathLabel(path)}</p>)}
                  {!hit.paths.length ? <p className="wg-result-path">未登记 Wiki 路径</p> : null}
                </li>)}
              </ul> : null}
              {!searchingLoading && readySearch && !searchChapters.error && !issues.error &&
                !searchChapters.items.length && !issues.items.length ? <p role="status">未找到匹配的章节或已保存问题。</p> : null}
              <div className="wg-more">
                {searchChapters.hasMore ? <Button variant="outline" size="sm" onClick={searchChapters.loadMore}
                  disabled={searchChapters.loadingMore}>更多章节结果</Button> : null}
                {issues.hasMore ? <Button variant="outline" size="sm" onClick={issues.loadMore}
                  disabled={issues.loadingMore}>更多问题</Button> : null}
              </div>
            </section> : chapterValid && chapter ? <section aria-label="当前章节 Wiki">
              <span className="wg-eyebrow">ATA {chapter.scope.ata2}</span>
              <div className="wg-chapter-title"><h2>{nodeTitle(chapter)}</h2>{summaryLink(chapter, '阅读本章 Wiki', 'wg-read-chapter')}</div>
              <p className="wg-saved-label">{savedLabel(chapter)}</p>
              <div className="wg-index-heading"><h3>子章节 Wiki</h3></div>
              {sections.loading ? <p role="status">正在读取子章节…</p> : null}
              <ul className="wg-sections">{sections.items.filter(node => node.scope.kind === 'ATA4' && node.parentSummaryId === chapter.summaryId)
                .map(node => <li key={node.summaryId}><div className="wg-section-entry">
                  <span className="wg-section-code">{node.scope.ata4}</span><div>
                    <strong>{nodeTitle(node)}</strong><p>{savedLabel(node)}</p></div>
                  {summaryLink(node, '阅读', 'wg-section-action', 'SECTIONS')}
                </div></li>)}</ul>
              {!sections.loading && !sections.error && !sections.items.length ? <p role="status">暂无子章节 Wiki。</p> : null}
              {sections.hasMore ? <Button type="button" variant="outline" size="sm" onClick={sections.loadMore}
                disabled={sections.loadingMore}>{sections.loadingMore ? '正在读取…' : '更多子章节'}</Button> : null}
            </section> : !chapters.loading && !chapterRead.loading && !chapters.error && !chapterId
              ? <p role="status">本机型暂无章节 Wiki。</p> : null}
          </div>
        </div>
      </section> : null}
    </> : null}
  </main>;
}
