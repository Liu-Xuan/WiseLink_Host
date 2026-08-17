import { BookOpenCheck, FileSearch2, Gauge, Radar } from 'lucide-react';
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
          <span className="wiselink-app-mark">WL</span>
          <span>
            <strong>WiseLink</strong>
            <small>工程资料与综合评估</small>
          </span>
        </NavLink>

        <nav className="wiselink-app-navigation" aria-label="WiseLink 主导航">
          <NavLink end to="/">
            <Gauge aria-hidden="true" /> 入口
          </NavLink>
          {workItemId ? (
            <NavLink
              to={`/work-items/${encodeURIComponent(workItemId)}/documents`}
            >
              <BookOpenCheck aria-hidden="true" /> 工作台
            </NavLink>
          ) : (
            <span className="is-disabled">
              <BookOpenCheck aria-hidden="true" /> 工作台
            </span>
          )}
          <NavLink to="/external-discovery">
            <Radar aria-hidden="true" /> 外部资料
          </NavLink>
        </nav>

        <div className="wiselink-app-context">
          {workItemId ? (
            <span title={workItemId}>
              <FileSearch2 aria-hidden="true" /> {shortId(workItemId)}
            </span>
          ) : (
            <span className="is-boundary">唯一妙搭应用</span>
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
