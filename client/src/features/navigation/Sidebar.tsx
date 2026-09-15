import { useState } from 'react';
import {
  BookMarked,
  FileClock,
  FileSearch2,
  History,
  LibraryBig,
  LifeBuoy,
  MessagesSquare,
  Palette,
  Share2,
  X,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';

import appIconUrl from '@client/src/assets/wiselink-app-icon.svg';
import {
  useWlTheme,
  type WlVisualMode,
} from '@client/src/app/providers/ThemeProvider';
import { useCurrentObjectContext } from '@client/src/app/providers/CurrentObjectContextProvider';
import { Image } from '@client/src/components/ui/image';
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
  shortId,
  type ShellObjectLink,
  type ShellRouteContext,
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
];

const SECONDARY_NAV: Array<{
  to: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}> = [{ to: '/external-discovery', label: '补充资料', icon: FileSearch2 }];

const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onMobileClose }) => {
  const location = useLocation();
  const routeContext: ShellRouteContext = deriveShellRouteContext(
    location.pathname,
    location.search,
  );
  const { workItemId, matterId, documentVersionId, workRef } = routeContext;
  const { currentObject } = useCurrentObjectContext();
  const { theme, toggleTheme, visualMode, setVisualMode } = useWlTheme();
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
      ? currentObject.displayCode
      : shortId(routeObjectId);

  const globalNavTarget = (target: string): string => {
    if (!workItemId || (target !== '/knowledge' && target !== '/graph')) {
      return target;
    }
    return `${target}?workItemId=${encodeURIComponent(workItemId)}`;
  };

  return (
    <>
      <aside
        id="wl-sidebar"
        className={`wl-sidebar wl-glass-panel${mobileOpen ? ' is-open' : ''}`}
        aria-label="WiseLink 全局导航"
      >
        <div className="wl-sidebar-brand">
          <span className="wiselink-app-mark" aria-hidden="true">
            <Image src={appIconUrl} alt="" />
          </span>
          <span className="wl-sidebar-brand-text">
            <strong>WiseLink</strong>
            <small>工程资料智能分析</small>
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
              >
                <item.icon aria-hidden="true" />
                {item.label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="wl-sidebar-object">
          <h3>{objectHeading}</h3>
          {hasRouteObject ? (
            <>
              <div className="wl-sidebar-object-title" title={routeObjectId}>
                {objectLabel}
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
            </>
          ) : (
            <p className="wl-sidebar-object-empty">
              尚未选择事项。请从资料库进入一个工程事项，这里会显示它的
              Wiki、问题、资料、复核与历史。
            </p>
          )}
        </div>

        <nav className="wl-sidebar-secondary" aria-label="次级入口">
          {SECONDARY_NAV.map(
            (item: {
              to: string;
              label: string;
              icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
            }) => (
              <NavLink key={item.to} to={item.to}>
                <item.icon aria-hidden="true" />
                {item.label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="wl-sidebar-footer">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-haspopup="dialog"
          >
            <Palette aria-hidden="true" /> 显示与效果
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-haspopup="dialog"
          >
            <LifeBuoy aria-hidden="true" /> 演示与帮助
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
                  (option: {
                    value: WlVisualMode;
                    label: string;
                  }) => (
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
