/**
 * GlobalNav - 全局导航组件
 *
 * 左侧边栏的全局导航，包括：
 * - 品牌 Logo
 * - 主要页面导航
 * - 设置入口
 * - 帮助入口
 */

import React from 'react';

interface NavItem {
  page: string;
  label: string;
  icon: string;
}

const PRIMARY_NAV: NavItem[] = [
  { page: 'library', label: '资料库', icon: 'file' },
  { page: 'knowledge', label: '工程知识', icon: 'book' },
  { page: 'graph', label: '关系图谱', icon: 'graph' },
  { page: 'situation', label: '工程态势', icon: 'activity' },
  { page: 'tasks', label: '工作进展', icon: 'list' },
];

interface GlobalNavProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  onOpenSettings: () => void;
}

export function GlobalNav({ currentPage, onNavigate, onOpenSettings }: GlobalNavProps) {
  return (
    <aside className="sidebar">
      {/* 品牌 */}
      <div className="brand">
        <div className="brand-logo">W</div>
        <div>
          <strong>WiseLink</strong>
          <small>工程知识 · 持续认识</small>
        </div>
      </div>

      {/* 主导航 */}
      <nav aria-label="全局导航">
        {PRIMARY_NAV.map(({ page, label, icon }) => (
          <button
            key={page}
            className={`nav-btn ${currentPage === page ? 'active' : ''}`}
            aria-label={label}
            title={label}
            onClick={() => onNavigate(page)}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* 底部 */}
      <div className="sidebar-bottom">
        <div className="sidebar-quote">
          把分散资料，
          <br />
          转化为可核对的认识。
        </div>
        <button className="nav-btn" onClick={onOpenSettings}>
          <Icon name="settings" />
          <span>显示与效果</span>
        </button>
        <button
          className={`nav-btn ${currentPage === 'demo' ? 'active' : ''}`}
          onClick={() => onNavigate('demo')}
        >
          <Icon name="help" />
          <span>演示与帮助</span>
        </button>
      </div>
    </aside>
  );
}

// 临时 Icon 组件（后续替换为实际实现）
function Icon({ name }: { name: string }) {
  return <i className={`icon icon-${name}`} />;
}
