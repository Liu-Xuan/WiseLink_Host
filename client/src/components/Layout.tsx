import { ChevronRight, FileSearch2 } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import CurrentUserControl from '@client/src/components/CurrentUserControl';
import FloatingDock from '@client/src/features/navigation/FloatingDock';
import './app-shell.css';

const Layout = () => {
  const location = useLocation();
  const workItemId = decodeURIComponent(
    location.pathname.match(/\/work-items\/([^/]+)/)?.[1] ?? '',
  );
  const isWorkbenchRoute = /\/work-items\/[^/]+\/documents(?:\/|$)/u.test(
    location.pathname,
  );
  const crumbs = deriveBreadcrumbs(location.pathname, workItemId);
  const pageLabel = derivePageLabel(location.pathname);

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

      <FloatingDock workItemId={workItemId} />

      <header className="wiselink-app-header wl-glass-nav" role="banner">
        <NavLink className="wiselink-app-brand" to="/library">
          <span className="wiselink-app-mark" aria-hidden="true">
            W
          </span>
          <span>
            <strong>WiseLink</strong>
            <small>工程资料与综合评估</small>
          </span>
        </NavLink>

        <p className="wiselink-app-page-label" aria-current="page">
          {pageLabel}
        </p>

        <div className="wiselink-app-context">
          {workItemId ? (
            <NavLink
              className="wiselink-app-work-item"
              to={`/work-items/${encodeURIComponent(workItemId)}`}
            >
              <FileSearch2 aria-hidden="true" />
              <span>当前工程事项</span>
            </NavLink>
          ) : (
            <span className="wiselink-app-context-note">
              资料与结果按权限显示
            </span>
          )}
          <CurrentUserControl />
        </div>
      </header>

      {crumbs.length > 1 && (
        <nav className="wiselink-breadcrumb" aria-label="面包屑">
          <ol>
            {crumbs.map((crumb, index) => (
              <li key={crumb.label} className="wiselink-breadcrumb-item">
                {index > 0 && (
                  <ChevronRight
                    className="wiselink-breadcrumb-sep"
                    aria-hidden="true"
                  />
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
      )}

      <div className="wiselink-app-body" id="main-content" tabIndex={-1}>
        <Outlet />
      </div>
    </div>
  );
};

export default Layout;

function deriveBreadcrumbs(
  pathname: string,
  workItemId: string,
): Array<{ label: string; to?: string }> {
  if (pathname === '/' || pathname === '/library') {
    return [{ label: '资料库' }];
  }

  const crumbs: Array<{ label: string; to?: string }> = [
    { label: '资料库', to: '/library' },
  ];

  if (pathname.startsWith('/work-items/') && workItemId) {
    crumbs.push({ label: '当前工程事项' });
  } else if (pathname === '/external-discovery') {
    crumbs.push({ label: '补充资料' });
  } else if (pathname === '/runtime-probe') {
    crumbs.push({ label: '连接状态' });
  } else {
    crumbs.push({ label: '页面未找到' });
  }

  return crumbs;
}

function derivePageLabel(pathname: string): string {
  if (pathname === '/' || pathname === '/library') return '资料库';
  if (/\/work-items\/[^/]+\/documents(?:\/|$)/u.test(pathname)) {
    return '工程分析工作台';
  }
  if (pathname.startsWith('/work-items/')) return '综合评估';
  if (pathname === '/external-discovery') return '补充资料';
  if (pathname === '/runtime-probe') return '连接状态';
  return 'WiseLink';
}
