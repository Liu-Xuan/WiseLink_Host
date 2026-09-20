/**
 * MatterNav - 当前事项导航
 *
 * 当选中事项时显示在左侧边栏的下方
 * 提供事项相关页面的快速导航
 */

import React from 'react';

interface MatterNavProps {
  matter: {
    id: string;
    title: string;
    code: string;
  };
  currentPage: string;
  onNavigate: (page: string, params?: Record<string, any>) => void;
}

const MATTER_NAV_ITEMS = [
  { page: 'wiki', label: '事项综述', icon: 'book' },
  { page: 'timeline', label: '变化与时间轴', icon: 'clock' },
  { page: 'process', label: '问题与分析', icon: 'work' },
  { page: 'review', label: '复核与交流', icon: 'discussion' },
];

export function MatterNav({ matter, currentPage, onNavigate }: MatterNavProps) {
  return (
    <div className="object-nav">
      <small>当前事项</small>
      <button className="current-matter" onClick={() => onNavigate('wiki', { matter: matter.id })}>
        <b>{matter.title}</b>
        <span>{matter.code}</span>
      </button>

      <nav aria-label="当前事项导航">
        {MATTER_NAV_ITEMS.map(({ page, label, icon }) => (
          <button
            key={page}
            className={`nav-btn ${currentPage === page ? 'active' : ''}`}
            aria-label={label}
            title={label}
            onClick={() => onNavigate(page, { matter: matter.id })}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Icon({ name }: { name: string }) {
  return <i className={`icon icon-${name}`} />;
}
