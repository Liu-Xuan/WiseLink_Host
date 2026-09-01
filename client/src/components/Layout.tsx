import { Search } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import {
  CurrentObjectContextProvider,
  useCurrentObjectContext,
} from '@client/src/app/providers/CurrentObjectContextProvider';
import { CurrentUserSessionProvider } from '@client/src/app/providers/CurrentUserSessionProvider';
import CurrentUserControl from '@client/src/components/CurrentUserControl';
import FloatingDock from '@client/src/features/navigation/FloatingDock';

import './app-shell.css';

const Layout = () => {
  return (
    <CurrentUserSessionProvider>
      <CurrentObjectContextProvider>
        <LayoutChrome />
      </CurrentObjectContextProvider>
    </CurrentUserSessionProvider>
  );
};

function LayoutChrome() {
  const location = useLocation();
  const { currentObject } = useCurrentObjectContext();
  const isWorkbenchRoute: boolean =
    /\/work-items\/[^/]+\/documents(?:\/|$)/u.test(location.pathname);
  const pageLabel: string = derivePageLabel(location.pathname);

  return (
    <div
      className={`wiselink-app-shell wl-environment${isWorkbenchRoute ? ' is-workbench-route' : ''}`}
    >
      <div className="wl-ambient-field" aria-hidden="true">
        <span className="wl-light wl-light--cold" />
        <span className="wl-light wl-light--warm" />
        <span className="wl-light wl-light--reflect" />
      </div>

      <a href="#main-content" className="wiselink-skip-link">
        跳转到主内容
      </a>

      <FloatingDock />

      <div className="wiselink-app-chrome wl-glass-nav" data-wl-material="g1">
        <header className="wiselink-app-header" role="banner">
          <NavLink className="wiselink-app-brand" to="/library">
            <span className="wiselink-app-mark" aria-hidden="true">
              W
            </span>
            <span>
              <strong>WiseLink</strong>
              <small>工程资料智能分析</small>
            </span>
          </NavLink>

          <div
            className={`wiselink-object-context${currentObject ? ' has-object' : ' is-global'}`}
          >
            <div className="wiselink-object-context-main">
              <span className="wiselink-object-page-label">{pageLabel}</span>
              {currentObject ? (
                <>
                  <span
                    className={`wiselink-object-kind is-${currentObject.kind.toLowerCase()}`}
                  >
                    {currentObject.kind === 'DOCUMENT'
                      ? '文档'
                      : currentObject.kind === 'MATTER'
                        ? '事项'
                        : '工程评估'}
                  </span>
                  <strong>{currentObject.displayCode}</strong>
                  <span className="wiselink-object-title">
                    {currentObject.title}
                  </span>
                </>
              ) : (
                <strong>{pageLabel}</strong>
              )}
            </div>
            <div className="wiselink-object-context-sub">
              {currentObject ? (
                <>
                  {currentObject.parentLabel?.trim() ? (
                    <>
                      <span>{currentObject.parentLabel}</span>
                      <i aria-hidden="true" />
                    </>
                  ) : null}
                  <span>{currentObject.meta}</span>
                  <i aria-hidden="true" />
                  <span>{currentObject.statusLabel}</span>
                </>
              ) : (
                <span>受控资料、工程评估与候选结果按当前权限显示</span>
              )}
            </div>
          </div>

          <div className="wiselink-app-context">
            <NavLink
              className="wiselink-header-icon-action"
              to="/library#library-search"
              aria-label="搜索资料与事项"
              title="搜索资料与事项"
            >
              <Search aria-hidden="true" />
            </NavLink>
            <CurrentUserControl />
          </div>
        </header>
      </div>

      <div className="wiselink-app-body" id="main-content" tabIndex={-1}>
        <Outlet />
      </div>
    </div>
  );
}

export default Layout;

function derivePageLabel(pathname: string): string {
  if (pathname === '/' || pathname === '/library') return '资料库';
  if (/\/work-items\/[^/]+\/documents(?:\/|$)/u.test(pathname)) {
    return '工程分析工作台';
  }
  if (pathname.startsWith('/work-items/')) return '工程评估';
  if (pathname === '/external-discovery') return '补充资料';
  if (pathname === '/runtime-probe') return '连接状态';
  return 'WiseLink';
}
