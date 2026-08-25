import { useEffect, useState } from 'react';
import {
  BookOpenCheck,
  ChevronRight,
  FileSearch2,
  Fingerprint,
  LayoutDashboard,
  LibraryBig,
  Menu,
  Radar,
  ShieldCheck,
  X,
} from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import FloatingDock from '@client/src/features/navigation/FloatingDock';
import './app-shell.css';

const Layout = () => {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const workItemId = decodeURIComponent(
    location.pathname.match(/\/work-items\/([^/]+)/)?.[1] ?? '',
  );

  // Close mobile nav on route change
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const crumbs = deriveBreadcrumbs(location.pathname, workItemId);

  return (
    <div className="wiselink-app-shell wl-environment">
      <a href="#main-content" className="wiselink-skip-link">
        跳转到主内容
      </a>

      <FloatingDock />

      <header className="wiselink-app-header wl-glass-nav" role="banner">
        <NavLink className="wiselink-app-brand" to="/">
          <span className="wiselink-app-mark" aria-hidden="true">
            W
          </span>
          <span>
            <strong>WiseLink</strong>
            <small>工程资料与综合评估</small>
          </span>
        </NavLink>

        <button
          type="button"
          className="wiselink-app-nav-toggle"
          aria-expanded={mobileNavOpen}
          aria-controls="primary-navigation"
          aria-label={mobileNavOpen ? '关闭导航' : '打开导航'}
          onClick={() => setMobileNavOpen((open) => !open)}
        >
          {mobileNavOpen ? (
            <X aria-hidden="true" />
          ) : (
            <Menu aria-hidden="true" />
          )}
        </button>

        <nav
          id="primary-navigation"
          className={`wiselink-app-navigation${mobileNavOpen ? ' is-open' : ''}`}
          aria-label="WiseLink 主导航"
        >
          <NavLink to="/">
            <LayoutDashboard aria-hidden="true" /> 任务总览
          </NavLink>
          <NavLink to="/library">
            <LibraryBig aria-hidden="true" /> 资料库
          </NavLink>
          {workItemId ? (
            <NavLink to={`/work-items/${encodeURIComponent(workItemId)}`}>
              <BookOpenCheck aria-hidden="true" /> 综合评估
            </NavLink>
          ) : (
            <span className="is-disabled" aria-disabled="true">
              <BookOpenCheck aria-hidden="true" /> 综合评估
            </span>
          )}
          <NavLink to="/external-discovery">
            <Radar aria-hidden="true" /> 补充资料
          </NavLink>
          <NavLink to="/client/oauth/callback">
            <Fingerprint aria-hidden="true" /> 飞书身份
          </NavLink>
        </nav>

        <div className="wiselink-app-context">
          <span className="wiselink-app-host-status">
            <ShieldCheck aria-hidden="true" /> AI 初步意见需复核
          </span>
          {workItemId ? (
            <NavLink
              className="wiselink-app-work-item"
              title={workItemId}
              to={`/work-items/${encodeURIComponent(workItemId)}`}
            >
              <FileSearch2 aria-hidden="true" />
              <span>当前工程事项</span>
            </NavLink>
          ) : (
            <span className="is-boundary" aria-label="尚未选择工程事项">
              尚未选择工程事项
            </span>
          )}
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
  if (pathname === '/') {
    return [{ label: '总览' }];
  }

  const crumbs: Array<{ label: string; to?: string }> = [
    { label: '总览', to: '/' },
  ];

  if (pathname === '/library') {
    crumbs.push({ label: '资料库' });
  } else if (pathname.startsWith('/work-items/') && workItemId) {
    crumbs.push({ label: '资料库', to: '/library' });
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
