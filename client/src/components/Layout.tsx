import {
  Activity,
  BookOpenCheck,
  FileSearch2,
  Fingerprint,
  LibraryBig,
  Radar,
  ShieldCheck,
} from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import './app-shell.css';

const Layout = () => {
  const location = useLocation();
  const workItemId = decodeURIComponent(
    location.pathname.match(/\/work-items\/([^/]+)/)?.[1] ?? '',
  );

  return (
    <div className="wiselink-app-shell">
      <header className="wiselink-app-header">
        <NavLink className="wiselink-app-brand" to="/">
          <span className="wiselink-app-mark" aria-hidden="true">
            W
          </span>
          <span>
            <strong>WiseLink</strong>
            <small>3.1 / CANONICAL HOST</small>
          </span>
        </NavLink>

        <nav className="wiselink-app-navigation" aria-label="WiseLink 主导航">
          <NavLink end to="/">
            <LibraryBig aria-hidden="true" /> 资料库
          </NavLink>
          {workItemId ? (
            <NavLink
              to={`/work-items/${encodeURIComponent(workItemId)}/documents`}
            >
              <BookOpenCheck aria-hidden="true" /> WorkItem 工作台
            </NavLink>
          ) : (
            <span className="is-disabled">
              <BookOpenCheck aria-hidden="true" /> WorkItem 工作台
            </span>
          )}
          <NavLink to="/external-discovery">
            <Radar aria-hidden="true" /> 外部发现
          </NavLink>
          <NavLink to="/client/oauth/callback">
            <Fingerprint aria-hidden="true" /> 飞书身份
          </NavLink>
        </nav>

        <div className="wiselink-app-context">
          <span className="wiselink-app-host-status">
            <ShieldCheck aria-hidden="true" /> 唯一妙搭应用
          </span>
          {workItemId ? (
            <NavLink
              className="wiselink-app-work-item"
              title={workItemId}
              to={`/work-items/${encodeURIComponent(workItemId)}/documents`}
            >
              <FileSearch2 aria-hidden="true" />
              <span>{shortId(workItemId)}</span>
              <Activity aria-hidden="true" />
            </NavLink>
          ) : (
            <span className="is-boundary">尚未选择 WorkItem</span>
          )}
        </div>
      </header>
      <div className="wiselink-app-body">
        <Outlet />
      </div>
    </div>
  );
};

export default Layout;

function shortId(value: string): string {
  return value.length > 28 ? `${value.slice(0, 17)}…${value.slice(-8)}` : value;
}
