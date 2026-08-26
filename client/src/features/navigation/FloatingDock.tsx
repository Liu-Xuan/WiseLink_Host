import { NavLink, useLocation } from 'react-router-dom';
import { BookOpenCheck, FileUp, LibraryBig, Moon, Sun } from 'lucide-react';

import { useWlTheme } from '@client/src/app/providers/ThemeProvider';

import './floating-dock.css';

/**
 * Apple Glass 浮动功能 Dock（Spec R01 §4.2 桌面布局 / §7 FloatingDock）。
 * 桌面 64–78px 垂直浮动；窄屏转为底部导航，工作台由专用标签栏接管。
 */
export default function FloatingDock({ workItemId }: { workItemId?: string }) {
  const { theme, toggleTheme } = useWlTheme();
  const location = useLocation();
  const items = [
    {
      key: 'library',
      label: '资料库',
      icon: LibraryBig,
      to: '/library',
      active: location.pathname === '/' || location.pathname === '/library',
    },
    ...(workItemId
      ? [
          {
            key: 'assessment',
            label: '综合评估',
            icon: BookOpenCheck,
            to: `/work-items/${encodeURIComponent(workItemId)}`,
            active:
              location.pathname ===
              `/work-items/${encodeURIComponent(workItemId)}`,
          },
        ]
      : []),
    {
      key: 'discovery',
      label: '补充资料',
      icon: FileUp,
      to: '/external-discovery',
      active: location.pathname === '/external-discovery',
    },
  ];

  return (
    <nav className="wl-dock wl-glass-nav" aria-label="WiseLink 主导航">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.key}
            to={item.to}
            className={`wl-dock-item${item.active ? ' is-active' : ''}`}
            title={item.label}
            aria-label={item.label}
            aria-current={item.active ? 'page' : undefined}
          >
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
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
        <span>{theme === 'dark' ? '浅色' : '深色'}</span>
      </button>
    </nav>
  );
}
