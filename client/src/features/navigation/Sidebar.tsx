import { useEffect, useState } from 'react';
import {
  BookMarked,
  Compass,
  Clock3,
  FileSearch2,
  LibraryBig,
  LifeBuoy,
  Palette,
  Share2,
  X,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';

import {
  useWlTheme,
  type WlVisualMode,
} from '@client/src/app/providers/ThemeProvider';
import { useCurrentObjectContext } from '@client/src/app/providers/CurrentObjectContextProvider';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { getEngineeringMatter } from '@client/src/api/engineering-matter';
import WiseLinkBrandMark from '@client/src/components/WiseLinkBrandMark';
import { activityReadingParams } from '@client/src/features/matter/reading-return';
import type {
  EngineeringMatterCatalogEntry,
  EngineeringMatterReadModel,
} from '@shared/api.interface';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import {
  buildShellObjectLinks,
  deriveShellRouteContext,
  deriveShellUrlIdentity,
  selectMatterTimelineSources,
  shortId,
  type ShellObjectLink,
  type ShellRouteContext,
  type ShellUrlIdentity,
} from './shell-utils';

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

const EFFECT_OPTIONS: Array<{
  value: WlVisualMode;
  label: string;
  hint: string;
}> = [
  { value: 'default', label: '默认', hint: '基础磨玻璃与短促过渡' },
  { value: 'ultra', label: '最高', hint: '增强阴影层次，不增加额外运动' },
  {
    value: 'compatible',
    label: '兼容',
    hint: '关闭背景模糊，低性能设备更稳定',
  },
];

const GLOBAL_NAV: Array<{
  to: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  end?: boolean;
}> = [
  { to: '/library', label: '资料库', icon: LibraryBig },
  { to: '/knowledge', label: '工程知识', icon: BookMarked },
  { to: '/graph', label: '关系图谱', icon: Share2 },
  { to: '/situation', label: '工程态势', icon: Compass },
  { to: '/library?mode=tasks', label: '工作进展', icon: Clock3 },
];

const SECONDARY_NAV: Array<{
  to: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}> = [
  { to: '/timeline', label: '工程时间轴', icon: Clock3 },
  { to: '/external-discovery', label: '补充资料', icon: FileSearch2 },
];

const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onMobileClose }) => {
  const location = useLocation();
  const routeContext: ShellRouteContext = deriveShellRouteContext(
    location.pathname,
    location.search,
  );
  const { workItemId, matterId, documentVersionId, workRef } = routeContext;
  const urlIdentity: ShellUrlIdentity = deriveShellUrlIdentity(
    location.search,
  );
  const graphMatterId: string =
    matterId || urlIdentity.matterId || urlIdentity.librarySelectedMatterId;
  const pinnedDocumentVersionId: string =
    documentVersionId ||
    urlIdentity.documentVersionId ||
    urlIdentity.librarySelectedDocumentVersionId;
  const { sessionGeneration, authenticationRequired } =
    useCurrentUserSession();
  const { currentObject } = useCurrentObjectContext();
  const {
    theme,
    toggleTheme,
    visualMode,
    setVisualMode,
    motionEnabled,
    motionPausedByUser,
    systemReducedMotion,
    toggleMotion,
  } = useWlTheme();
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [helpOpen, setHelpOpen] = useState<boolean>(false);

  const activeEffectHint: string =
    EFFECT_OPTIONS.find(
      (option: { value: WlVisualMode }) => option.value === visualMode,
    )?.hint ?? '';

  const objectLinks: ShellObjectLink[] = buildShellObjectLinks(routeContext);
  const hasRouteObject: boolean = Boolean(
    workItemId || matterId || documentVersionId,
  );
  const objectHeading: string = matterId
    ? workRef
      ? '历史工作'
      : '当前工程事项'
    : documentVersionId
      ? '文档版本'
      : '当前事项';
  const routeObjectId: string =
    workRef || matterId || documentVersionId || workItemId;
  const objectLabel: string =
    !workRef && currentObject
      ? currentObject.title || currentObject.displayCode
      : shortId(routeObjectId);
  const objectCode: string =
    !workRef && currentObject ? currentObject.displayCode : '';

  const [matterTimelineSources, setMatterTimelineSources] = useState<
    EngineeringMatterCatalogEntry[] | null
  >(null);
  useEffect(() => {
    if (!graphMatterId || authenticationRequired) {
      setMatterTimelineSources(null);
      return;
    }
    const controller = new AbortController();
    setMatterTimelineSources(null);
    void getEngineeringMatter(graphMatterId, controller.signal)
      .then((read: EngineeringMatterReadModel) => {
        if (!controller.signal.aborted) {
          setMatterTimelineSources(
            selectMatterTimelineSources(read.catalog.entries),
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setMatterTimelineSources(null);
        }
      });
    return () => controller.abort();
  }, [graphMatterId, sessionGeneration, authenticationRequired]);

  const currentSearchParams = new URLSearchParams(location.search);
  // An illegal object pin stays visibly blocked: forward it as an empty pin so the
  // destination page rejects it, never degrade to a bare default entry.
  const blockedPins: string[] = urlIdentity.invalidPins
    .map((key: string) =>
      key === 'selectedMatterId'
        ? 'matterId'
        : key === 'selectedDocumentVersionId'
          ? 'documentVersionId'
          : key,
    )
    .filter(
      (key: string, index: number, all: string[]) =>
        (key === 'matterId' || key === 'documentVersionId') &&
        all.indexOf(key) === index,
    );

  const globalNavTarget = (target: string): string => {
    if (
      blockedPins.length > 0 &&
      (target === '/graph' ||
        target === '/timeline' ||
        target === '/activity-graph')
    ) {
      const blocked = new URLSearchParams();
      for (const key of blockedPins) blocked.set(key, '');
      return `${target}?${blocked}`;
    }
    if (target === '/graph') {
      if (graphMatterId) {
        // Explicit activity identity stays on the matter graph target so the
        // graph dispatcher runs its relation check with the exact pins; only
        // the library selection resolves through the matter catalog alone.
        const query = activityReadingParams(currentSearchParams);
        query.set('matterId', graphMatterId);
        const explicitDocumentVersionId: string =
          documentVersionId || urlIdentity.documentVersionId;
        if (explicitDocumentVersionId) {
          query.set('documentVersionId', explicitDocumentVersionId);
        }
        const pinnedWorkRef: string = workRef || urlIdentity.workRef;
        if (pinnedWorkRef) query.set('workRef', pinnedWorkRef);
        return `/graph?${query}`;
      }
      if (workItemId || urlIdentity.workItemId) {
        return `/graph?workItemId=${encodeURIComponent(
          workItemId || urlIdentity.workItemId,
        )}`;
      }
      if (pinnedDocumentVersionId) {
        const query = activityReadingParams(currentSearchParams);
        query.set('documentVersionId', pinnedDocumentVersionId);
        return `/activity-graph?${query}`;
      }
      return target;
    }
    if (target === '/timeline' || target === '/activity-graph') {
      // An explicit document version wins over the matter current-source discovery.
      if (pinnedDocumentVersionId) {
        const query = activityReadingParams(currentSearchParams);
        query.set('documentVersionId', pinnedDocumentVersionId);
        return `${target}?${query}`;
      }
      if (graphMatterId) {
        const query = activityReadingParams(currentSearchParams);
        const firstSource = matterTimelineSources?.[0];
        if (firstSource) {
          query.set(
            'documentVersionId',
            firstSource.document.documentVersionId,
          );
        } else {
          // Pending or unregistered matter source: keep the explicit matter identity.
          query.set('matterId', graphMatterId);
        }
        return `${target}?${query}`;
      }
      return target;
    }
    if (target === '/knowledge' && workItemId) {
      return `/knowledge?workItemId=${encodeURIComponent(workItemId)}`;
    }
    return target;
  };

  const isTasksRoute =
    location.pathname === '/library' &&
    new URLSearchParams(location.search).get('mode') === 'tasks';
  const isLibraryRoute = location.pathname === '/library' && !isTasksRoute;

  return (
    <>
      <aside
        id="wl-sidebar"
        className={`wl-sidebar${mobileOpen ? ' is-open' : ''}`}
        aria-label="WiseLink 全局导航"
      >
        <div className="wl-sidebar-brand">
          <span className="wiselink-app-mark" aria-hidden="true">
            <WiseLinkBrandMark size={33} />
          </span>
          <span className="wl-sidebar-brand-text">
            <strong>WiseLink</strong>
            <small>工程与知识协同</small>
          </span>
          <button
            type="button"
            className="wl-sidebar-close"
            onClick={onMobileClose}
            aria-label="关闭导航"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <nav className="wl-sidebar-nav" aria-label="全局入口">
          <small className="wl-sidebar-group-label">工程空间</small>
          {GLOBAL_NAV.map(
            (item: {
              to: string;
              label: string;
              icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
              end?: boolean;
            }) => (
              <NavLink
                key={item.to}
                end={item.end}
                to={globalNavTarget(item.to)}
                className={({ isActive }) => {
                  const active =
                    item.to === '/library'
                      ? isLibraryRoute
                      : item.to === '/library?mode=tasks'
                        ? isTasksRoute
                        : item.to === '/knowledge'
                          ? isActive && !isTasksRoute
                          : isActive;
                  return `wl-shell-nav-link${active ? ' active' : ''}`;
                }}
                aria-label={item.label}
                title={item.label}
              >
                <item.icon aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            ),
          )}
        </nav>

        <p className="wl-sidebar-quote">
          把分散资料，
          <br />
          转化为可核对的认识。
        </p>

        {hasRouteObject ? (
          <div className="wl-sidebar-object">
            <h3>{objectHeading}</h3>
            <div className="wl-sidebar-object-title" title={routeObjectId}>
              <strong>{objectLabel}</strong>
              {objectCode ? <small>{objectCode}</small> : null}
            </div>
            {objectLinks.length ? (
              <nav
                className="wl-sidebar-object-nav"
                aria-label={matterId ? '工程事项导航' : '当前事项导航'}
              >
                {objectLinks.map((link: ShellObjectLink) => (
                  <NavLink key={link.label} to={link.to}>
                    {link.label}
                  </NavLink>
                ))}
              </nav>
            ) : (
              <p className="wl-sidebar-object-empty">
                当前为独立文档版本阅读，可返回资料库选择事项或其他文档。
              </p>
            )}
          </div>
        ) : null}

        <nav className="wl-sidebar-secondary" aria-label="次级入口">
          {SECONDARY_NAV.map(
            (item: {
              to: string;
              label: string;
              icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
            }) => (
              <NavLink
                key={item.to}
                to={globalNavTarget(item.to)}
                aria-label={item.label}
                title={item.label}
              >
                <item.icon aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            ),
          )}
        </nav>

        <div className="wl-sidebar-footer">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-haspopup="dialog"
            aria-label="显示与效果"
            title="显示与效果"
          >
            <Palette aria-hidden="true" /> <span>显示与效果</span>
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-haspopup="dialog"
            aria-label="演示与帮助"
            title="演示与帮助"
          >
            <LifeBuoy aria-hidden="true" /> <span>演示与帮助</span>
          </button>
        </div>
      </aside>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>显示与效果</DialogTitle>
            <DialogDescription>
              设置保存在本机，仅影响当前浏览器的显示。
            </DialogDescription>
          </DialogHeader>
          <div className="wiselink-settings-group">
            <div className="wiselink-settings-row">
              <h3>外观主题</h3>
              <div
                className="wiselink-settings-segment"
                role="group"
                aria-label="外观主题"
              >
                <button
                  type="button"
                  aria-pressed={theme === 'light'}
                  onClick={() => {
                    if (theme !== 'light') toggleTheme();
                  }}
                >
                  Silver 浅色
                </button>
                <button
                  type="button"
                  aria-pressed={theme === 'dark'}
                  onClick={() => {
                    if (theme !== 'dark') toggleTheme();
                  }}
                >
                  Carbon 深色
                </button>
              </div>
              <p>
                {theme === 'dark'
                  ? '中性炭灰，弱光环境与大段精读更稳定。'
                  : '白灰环境，适合白天与常规阅读。'}
              </p>
            </div>
            <div className="wiselink-settings-row">
              <h3>效果档位</h3>
              <div
                className="wiselink-settings-segment"
                role="group"
                aria-label="效果档位"
              >
                {EFFECT_OPTIONS.map(
                  (option: { value: WlVisualMode; label: string }) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={visualMode === option.value}
                      onClick={() => setVisualMode(option.value)}
                    >
                      {option.label}
                    </button>
                  ),
                )}
              </div>
              <p>{activeEffectHint}</p>
            </div>
            <div className="wiselink-settings-row">
              <h3>环境动态</h3>
              <button
                type="button"
                className="wiselink-settings-motion"
                aria-pressed={motionPausedByUser}
                onClick={toggleMotion}
              >
                {motionPausedByUser
                  ? '恢复动态'
                  : systemReducedMotion
                    ? '系统减少动态'
                    : motionEnabled
                      ? '暂停动态'
                      : '恢复动态'}
              </button>
              <p>
                系统减少动态设置会自动降低动画；暂停后只保留必要的状态变化。
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>演示与帮助</DialogTitle>
            <DialogDescription>
              了解整体流程与当前版本的边界。
            </DialogDescription>
          </DialogHeader>
          <div className="wiselink-settings-group">
            <div className="wiselink-settings-row">
              <h3>业务流程总览</h3>
              <p>
                从<NavLink to="/library">资料库</NavLink>
                进入事项后，可按问题分析、来源精读、复核意见与变化历史继续工作。
              </p>
            </div>
            <div className="wiselink-settings-row">
              <h3>当前边界</h3>
              <p>
                候选意见在复核之前仅供参考；图谱只提供当前已接通的文档与事项范围，页面内容均按实际返回展示。
              </p>
            </div>
            <div className="wiselink-settings-row">
              <h3>连接诊断</h3>
              <p>
                <NavLink to="/runtime-probe">连接状态</NavLink>
                用于核对身份与读取链路，属于次级工具。
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Sidebar;
