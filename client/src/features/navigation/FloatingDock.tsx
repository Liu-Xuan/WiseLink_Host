import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  BookOpenCheck,
  ClipboardList,
  FileClock,
  Files,
  LibraryBig,
  MessagesSquare,
  Search,
  Waypoints,
} from 'lucide-react';

import {
  currentObjectKindLabel,
  useCurrentObjectContext,
} from '@client/src/app/providers/CurrentObjectContextProvider';
import VisualModeControl from '@client/src/components/VisualModeControl';
import WiseLinkBrandMark from '@client/src/components/WiseLinkBrandMark';
import { libraryViewMode } from '@client/src/pages/WorkspaceHomePage/library-view-mode';

import './floating-dock.css';

interface DockItemView {
  key: string;
  label: string;
  to: string;
  icon: typeof LibraryBig;
  active: boolean;
  badge?: number | string;
}

export default function FloatingDock() {
  const location = useLocation();
  const { currentObject } = useCurrentObjectContext();
  const params = new URLSearchParams(location.search);
  const activeNode: string = params.get('node') ?? '';
  const libraryMode =
    location.pathname === '/library' || location.pathname === '/'
      ? libraryViewMode(params)
      : null;
  const globalItems: DockItemView[] = [
    {
      key: 'library',
      label: '资料库',
      icon: LibraryBig,
      to: '/library',
      active: libraryMode === 'document',
    },
    {
      key: 'matters',
      label: '工程事项',
      icon: BookOpenCheck,
      to: '/library?mode=matter',
      active: libraryMode === 'matter',
    },
    {
      key: 'tasks',
      label: '最近任务',
      icon: ClipboardList,
      to: '/library?mode=tasks',
      active: libraryMode === 'tasks',
    },
    {
      key: 'dialogues',
      label: '开放式对话',
      icon: MessagesSquare,
      to: '/dialogues',
      active: location.pathname.startsWith('/dialogues'),
    },
    {
      key: 'search',
      label: '搜索',
      icon: Search,
      to: '/library#library-search',
      active: location.hash === '#library-search',
    },
  ];
  const contextItems: DockItemView[] = currentObject
    ? currentObject.kind === 'MATTER' && currentObject.routeMatterId
      ? [
          {
            key: 'workspace',
            label: '简报',
            icon: BookOpenCheck,
            to: currentObject.routes.overview,
            active: !params.get('panel') || params.get('panel') === 'brief',
          },
          {
            key: 'review',
            label: '讨论',
            icon: MessagesSquare,
            to: currentObject.routes.review,
            active: params.get('panel') === 'review',
          },
          {
            key: 'family',
            label: '关联资料',
            icon: Files,
            to: currentObject.routes.family,
            active: params.get('panel') === 'materials',
          },
        ]
      : [
          {
            key: 'workspace',
            label: '工作台',
            icon: BookOpenCheck,
            to: currentObject.routes.workspace,
            active:
              location.pathname.includes('/documents') &&
              (activeNode === 'reader' || activeNode === 'package'),
          },
          {
            key: 'process',
            label: '过程',
            icon: Activity,
            to: currentObject.routes.process,
            active:
              activeNode === 'overall' &&
              location.hash !== '#workspace-history',
            badge: currentObject.badges?.process,
          },
          {
            key: 'job-aid',
            label: 'Job-Aid',
            icon: Waypoints,
            to: currentObject.routes.jobAid,
            active: activeNode === 'assessment',
            badge: currentObject.badges?.jobAid,
          },
          {
            key: 'review',
            label: '复核',
            icon: MessagesSquare,
            to: currentObject.routes.review,
            active: activeNode === 'review',
            badge: currentObject.badges?.review,
          },
          {
            key: 'history',
            label: '历史',
            icon: FileClock,
            to: currentObject.routes.history,
            active: location.hash === '#workspace-history',
          },
          {
            key: 'family',
            label: '资料族',
            icon: Files,
            to: currentObject.routes.family,
            active: activeNode === 'document',
            badge: currentObject.badges?.family,
          },
        ]
    : [];

  return (
    <aside
      className="wl-dock wl-glass-nav"
      data-wl-material="g1"
      aria-label="WiseLink 导航"
    >
      <NavLink
        className="wl-dock-logo"
        to="/library"
        aria-label="WiseLink 资料库"
      >
        <WiseLinkBrandMark size={46} />
      </NavLink>

      <nav className="wl-dock-group wl-dock-global" aria-label="全局导航">
        <span className="wl-dock-group-label">全局</span>
        {globalItems.map((item: DockItemView) => (
          <DockItem key={item.key} item={item} />
        ))}
      </nav>

      <span className="wl-dock-divider" aria-hidden="true" />

      <nav
        className={`wl-dock-group wl-dock-context${currentObject ? '' : ' is-empty'}`}
        aria-label="当前对象操作"
      >
        <span className="wl-dock-group-label">当前对象</span>
        {currentObject ? (
          <>
            <NavLink
              className="wl-dock-context-anchor"
              to={currentObject.routes.overview}
              aria-label={`当前${currentObjectKindLabel(currentObject.kind)}：${currentObject.displayCode}`}
              title={`${currentObject.displayCode} · ${currentObject.title}`}
            >
              <span>
                {currentObject.kind === 'DOCUMENT'
                  ? '文'
                  : currentObject.kind === 'WORK_ITEM'
                    ? '任'
                    : '事'}
              </span>
              <small>{currentObject.displayCode}</small>
              <i aria-hidden="true" />
            </NavLink>
            {contextItems.map((item: DockItemView) => (
              <DockItem key={item.key} item={item} />
            ))}
          </>
        ) : (
          <div className="wl-dock-context-empty" aria-disabled="true">
            <span>—</span>
            <small>选择资料</small>
          </div>
        )}
      </nav>

      <div className="wl-dock-footer">
        <VisualModeControl compact />
        <span>显示</span>
      </div>
    </aside>
  );
}

function DockItem({ item }: { item: DockItemView }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      className={`wl-dock-item${item.active ? ' is-active' : ''}`}
      title={item.label}
      aria-label={item.label}
      aria-current={item.active ? 'page' : undefined}
    >
      <Icon aria-hidden="true" />
      <span>{item.label}</span>
      {item.badge !== undefined ? (
        <small className="wl-dock-badge">{item.badge}</small>
      ) : null}
    </NavLink>
  );
}
