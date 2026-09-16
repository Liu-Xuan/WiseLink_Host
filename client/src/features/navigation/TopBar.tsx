import { Menu, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';

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

interface TopBarProps {
  pathname: string;
  search: string;
  mobileNavOpen: boolean;
  onToggleMobile: () => void;
}

const TopBar: React.FC<TopBarProps> = ({
  pathname,
  search,
  mobileNavOpen,
  onToggleMobile,
}) => {
  const { currentObject } = useCurrentObjectContext();
  const routeContext: ShellRouteContext = deriveShellRouteContext(
    pathname,
    search,
  );
  const { workItemId, matterId, documentVersionId, workRef } = routeContext;
  const crumbs: ShellCrumb[] = deriveBreadcrumbs(pathname, search);

  return (
    <header className="wl-topbar" role="banner">
      <button
        type="button"
        className="wl-topbar-toggle"
        aria-expanded={mobileNavOpen}
        aria-controls="wl-sidebar"
        aria-label={mobileNavOpen ? '关闭导航' : '打开导航'}
        onClick={onToggleMobile}
      >
        {mobileNavOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>

      <nav className="wiselink-breadcrumb" aria-label="当前位置">
        <ol>
          {crumbs.map((crumb: ShellCrumb, index: number) => (
            <li key={crumb.label} className="wiselink-breadcrumb-item">
              {index > 0 && (
                <span className="wiselink-breadcrumb-sep" aria-hidden="true">
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
  );
};

export default TopBar;
