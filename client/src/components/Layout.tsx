import { useEffect } from 'react';
import { Search, Settings2 } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import {
  CurrentObjectContextProvider,
  useCurrentObjectContext,
  currentObjectKindLabel,
} from '@client/src/app/providers/CurrentObjectContextProvider';
import { CurrentUserSessionProvider } from '@client/src/app/providers/CurrentUserSessionProvider';
import CurrentUserControl from '@client/src/components/CurrentUserControl';
import AtlasLauncher from '@client/src/features/atlas/AtlasLauncher';
import FloatingDock from '@client/src/features/navigation/FloatingDock';

import './app-shell.css';

const Layout = () => {
  useEffect(() => {
    // The hosted HTML template replaces the favicon with the platform avatar.
    const favicon: HTMLLinkElement | null =
      document.querySelector('link[rel="icon"]');
    if (favicon) {
      favicon.href = `${import.meta.env.BASE_URL}wiselink-brand.png`;
      favicon.type = 'image/png';
      favicon.sizes.value = '256x256';
    }
  }, []);

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
          <div
            className={`wiselink-object-context${currentObject ? ' has-object' : ' is-global'}`}
          >
            <div className="wiselink-object-context-main">
              {currentObject ? (
                <>
                  <span className="wiselink-object-page-label">{pageLabel}</span>
                  <span
                    className={`wiselink-object-kind is-${currentObject.kind.toLowerCase()}`}
                  >
                    {currentObjectKindLabel(currentObject.kind)}
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
                  {currentObject.parentLabel ? (
                    <>
                      <span>{currentObject.parentLabel}</span>
                      <i aria-hidden="true" />
                    </>
                  ) : null}
                  <span>{currentObject.meta}</span>
                  {currentObject.statusLabel ? (
                    <>
                      <i aria-hidden="true" />
                      <span>{currentObject.statusLabel}</span>
                    </>
                  ) : null}
                </>
              ) : (
                <span>受控资料、工程事项与候选结果按当前权限显示</span>
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
            <AtlasLauncher />
            <CurrentUserControl />
            <NavLink
              className="wiselink-header-icon-action"
              to="/settings/models"
              aria-label="分析模型设置"
              title="分析模型设置"
            >
              <Settings2 aria-hidden="true" />
            </NavLink>
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
  if (pathname.startsWith('/matters/')) return '事项阅读与讨论';
  if (pathname === '/external-discovery') return '补充资料';
  if (pathname === '/runtime-probe') return '连接状态';
  if (pathname === '/settings/models') return '分析模型设置';
  return 'WiseLink';
}
