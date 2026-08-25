import { NavLink } from 'react-router-dom';
import {
  Compass,
  Gauge,
  LibraryBig,
  Radar,
  Search,
  Settings,
} from 'lucide-react';

import { useWlTheme } from '@client/src/app/providers/ThemeProvider';
import { Moon, Sun } from 'lucide-react';

import './floating-dock.css';

interface DockItem {
  key: string;
  label: string;
  icon: typeof Compass;
  to?: string;
  disabled?: boolean;
}

const DOCK_ITEMS: DockItem[] = [
  { key: 'overview', label: '总览', icon: Compass, to: '/' },
  { key: 'library', label: '资料库', icon: LibraryBig, to: '/library' },
  /* §7 FloatingDock 职责：首页、资料库、事项、任务、搜索、设置。
   * 事项/任务当前无对应 read model 路由，以禁用态占位（§11.3 不伪造入口）。 */
  { key: 'matters', label: '事项', icon: Radar },
  { key: 'tasks', label: '任务', icon: Gauge },
  { key: 'search', label: '搜索', icon: Search },
  { key: 'settings', label: '设置', icon: Settings },
];

/**
 * Apple Glass 浮动功能 Dock（Spec R01 §4.2 桌面布局 / §7 FloatingDock）。
 * 桌面 64–78px 垂直浮动；全屏时保留必要图标；窄屏隐藏（由顶栏接管）。
 */
export default function FloatingDock() {
  const { theme, toggleTheme } = useWlTheme();

  return (
    <nav className="wl-dock wl-glass-nav" aria-label="WiseLink 功能 Dock">
      {DOCK_ITEMS.map((item) => {
        const Icon = item.icon;
        if (item.disabled || !item.to) {
          return (
            <span
              key={item.key}
              className="wl-dock-item is-disabled"
              title={item.label}
              aria-disabled="true"
            >
              <Icon aria-hidden="true" />
            </span>
          );
        }
        return (
          <NavLink
            key={item.key}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `wl-dock-item${isActive ? ' is-active' : ''}`
            }
            title={item.label}
            aria-label={item.label}
          >
            <Icon aria-hidden="true" />
          </NavLink>
        );
      })}
      <span className="wl-dock-divider" aria-hidden="true" />
      <button
        type="button"
        className="wl-dock-item"
        onClick={toggleTheme}
        title={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
        aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
      >
        {theme === 'dark' ? (
          <Sun aria-hidden="true" />
        ) : (
          <Moon aria-hidden="true" />
        )}
      </button>
    </nav>
  );
}
