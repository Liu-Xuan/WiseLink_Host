import { ArrowLeft, Maximize2, Menu, Minimize2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import CurrentUserControl from '@client/src/components/CurrentUserControl';
import AtlasLauncher from '@client/src/features/atlas/AtlasLauncher';
import {
  currentObjectKindLabel,
  useCurrentObjectContext,
} from '@client/src/app/providers/CurrentObjectContextProvider';
import {
  deriveShellRouteContext,
  deriveBreadcrumbs,
  shortId,
  type ShellCrumb,
  type ShellRouteContext,
} from './shell-utils';
import { readingReturnTarget } from '@client/src/features/matter/reading-return';

interface TopBarProps {
  pathname: string;
  search: string;
  mobileNavOpen: boolean;
  onToggleMobile: () => void;
  immersive?: boolean;
  onToggleImmersive?: () => void;
}

const TopBar: React.FC<TopBarProps> = ({
  pathname,
  search,
  mobileNavOpen,
  onToggleMobile,
  immersive = false,
  onToggleImmersive = () => undefined,
}) => {
  const navigate = useNavigate();
  const { currentObject } = useCurrentObjectContext();
  const routeContext: ShellRouteContext = deriveShellRouteContext(
    pathname,
    search,
  );
  const { workItemId, matterId, documentVersionId, workRef } = routeContext;
  const crumbs: ShellCrumb[] = deriveBreadcrumbs(pathname, search);
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const [query, setQuery] = useState(searchParams.get('query') ?? '');
  useEffect(() => {
    setQuery(searchParams.get('query') ?? '');
  }, [searchParams]);
  const requestedParseRun =
    pathname.includes('/activities') ||
    pathname.match(/^\/document-versions\/[^/]+$/u)
      ? searchParams.get('parseRunId')
      : null;
  const returnTarget = readingReturnTarget(
    searchParams,
    documentVersionId || undefined,
    requestedParseRun,
  );
  const returnIntentKeys = [
    'returnMatterId',
    'returnKnowledgeQuery',
    'returnLibraryQuery',
    'returnRevisionQuery',
    'returnActivityQuery',
    'returnLibraryWorkItemId',
    'returnWorkItemId',
    'returnDocumentVersionId',
    'returnRevisionSide',
    'returnActivityView',
  ];
  const returnRejected =
    returnIntentKeys.some((key) => searchParams.has(key)) && !returnTarget;
  const backTarget = returnRejected
    ? null
    : (returnTarget?.route ??
      (workItemId
        ? `/work-items/${encodeURIComponent(workItemId)}`
        : matterId
          ? `/matters/${encodeURIComponent(matterId)}${workRef ? `?workRef=${encodeURIComponent(workRef)}` : ''}`
          : documentVersionId
            ? '/library?mode=document'
            : '/library'));

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    navigate(
      value ? `/knowledge?query=${encodeURIComponent(value)}` : '/knowledge',
    );
  };

  return (
    <>
      <header className="wl-topbar" role="banner">
        <button
          type="button"
          className="wl-topbar-toggle"
          aria-expanded={mobileNavOpen}
          aria-controls="wl-sidebar"
          aria-label={mobileNavOpen ? '关闭导航' : '打开导航'}
          onClick={onToggleMobile}
        >
          {mobileNavOpen ? (
            <X aria-hidden="true" />
          ) : (
            <Menu aria-hidden="true" />
          )}
        </button>

        <form
          className="wl-global-search"
          role="search"
          onSubmit={submitSearch}
        >
          <Search aria-hidden="true" />
          <input
            id="global-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索工程问题、ATA章节、文件与已有认识…"
            aria-label="搜索工程问题、ATA章节、文件与已有认识"
          />
          <kbd aria-hidden="true">/</kbd>
        </form>

        {workRef ? (
          <span className="wl-topbar-item" title={workRef}>
            历史工作 · {shortId(workRef)}
          </span>
        ) : currentObject ? (
          <span
            className="wl-topbar-item"
            title={`${currentObjectKindLabel(currentObject.kind)} · ${currentObject.displayCode} · ${currentObject.title}`}
          >
            {currentObjectKindLabel(currentObject.kind)} ·{' '}
            {shortId(currentObject.displayCode)}
          </span>
        ) : workItemId ? (
          <NavLink
            className="wl-topbar-item"
            title={workItemId}
            to={`/work-items/${encodeURIComponent(workItemId)}`}
          >
            {shortId(workItemId)}
          </NavLink>
        ) : matterId ? (
          <span className="wl-topbar-item" title={matterId}>
            工程事项 · {shortId(matterId)}
          </span>
        ) : documentVersionId ? (
          <span className="wl-topbar-item" title={documentVersionId}>
            文档版本 · {shortId(documentVersionId)}
          </span>
        ) : null}
        <div className="wl-topbar-actions">
          <AtlasLauncher />
          <CurrentUserControl />
        </div>
      </header>

      <div className="wl-pagebar" role="navigation" aria-label="页面工具栏">
        <div className="wl-pagebar-breadcrumb">
          <button
            type="button"
            className="wl-pagebar-back"
            onClick={() => {
              if (backTarget) navigate(backTarget);
            }}
            disabled={!backTarget}
            aria-label={
              returnRejected
                ? '返回目标与当前版本不匹配'
                : (returnTarget?.label ?? '返回原阅读位置')
            }
            title={
              returnRejected
                ? '返回目标与当前版本不匹配，已拒绝跳转'
                : (returnTarget?.label ?? '返回原阅读位置')
            }
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <nav className="wiselink-breadcrumb" aria-label="当前位置">
            <ol>
              {crumbs.map((crumb: ShellCrumb, index: number) => (
                <li
                  key={`${crumb.label}-${index}`}
                  className="wiselink-breadcrumb-item"
                >
                  {index > 0 && (
                    <span
                      className="wiselink-breadcrumb-sep"
                      aria-hidden="true"
                    >
                      /
                    </span>
                  )}
                  {crumb.to ? (
                    <NavLink to={crumb.to}>{crumb.label}</NavLink>
                  ) : (
                    <span
                      aria-current={
                        index === crumbs.length - 1 ? 'page' : undefined
                      }
                    >
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        </div>
        <div className="wl-pagebar-actions">
          <button
            type="button"
            className="wl-pagebar-action"
            onClick={onToggleImmersive}
            aria-pressed={immersive}
            aria-label={immersive ? '退出全屏工作区' : '展开全屏工作区'}
            title={immersive ? '退出全屏工作区' : '展开全屏工作区'}
          >
            {immersive ? (
              <Minimize2 aria-hidden="true" />
            ) : (
              <Maximize2 aria-hidden="true" />
            )}
            <span>{immersive ? '退出全屏' : '全屏'}</span>
          </button>
        </div>
      </div>
    </>
  );
};

export default TopBar;
