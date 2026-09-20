/**
 * Breadcrumb - 面包屑导航
 *
 * 显示当前位置并提供返回、全屏、事项切换等功能
 */

import React from 'react';

interface BreadcrumbProps {
  currentPage: string;
  currentMatter?: {
    id: string;
    title: string;
  };
  currentDocument?: {
    id: string;
    title: string;
    version: string;
  };
  immersive: boolean;
  onBack?: () => void;
  onToggleImmersive: () => void;
  onNavigate: (page: string, params?: Record<string, any>) => void;
  matters?: Array<{ id: string; title: string }>;
}

const PAGE_TITLES: Record<string, string> = {
  library: '资料库',
  knowledge: '工程知识',
  graph: '关系图谱',
  wiki: '事项 Wiki',
  reader: '精读工作台',
  timeline: '工程时间轴',
  revision: '文件换版比较',
  review: '复核与交流',
  process: '分析过程',
  tasks: '工作进展',
  situation: '工程态势',
  demo: '使用导览',
};

export function Breadcrumb({
  currentPage,
  currentMatter,
  currentDocument,
  immersive,
  onBack,
  onToggleImmersive,
  onNavigate,
  matters = [],
}: BreadcrumbProps) {
  const pageTitle = PAGE_TITLES[currentPage] || '阅读';
  const showMatterSelector = currentPage !== 'library' && currentPage !== 'knowledge' && currentPage !== 'reader' && currentPage !== 'tasks' && currentPage !== 'demo';

  return (
    <div className="pagebar">
      {/* 面包屑路径 */}
      <div className="breadcrumb">
        {onBack && (
          <button className="back-button" onClick={onBack} aria-label="返回原阅读位置">
            <Icon name="chevron" />
          </button>
        )}

        <span>{pageTitle}</span>

        {currentPage === 'reader' && currentDocument && (
          <>
            <i>/</i>
            <strong>{currentDocument.title} · {currentDocument.version}</strong>
          </>
        )}

        {showMatterSelector && currentMatter && (
          <>
            <i>/</i>
            <strong>{currentMatter.title}</strong>
          </>
        )}
      </div>

      {/* 页面操作 */}
      <div className="page-actions">
        {showMatterSelector && matters.length > 0 && (
          <select
            aria-label="切换工程事项"
            value={currentMatter?.id || ''}
            onChange={(e) => {
              if (e.target.value) {
                onNavigate(currentPage, { matter: e.target.value, event: '' });
              }
            }}
          >
            {matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        )}

        <button
          className="btn"
          aria-label={immersive ? '退出全屏工作区' : '展开全屏工作区'}
          onClick={onToggleImmersive}
        >
          <Icon name="fit" />
          {immersive ? '退出全屏' : '全屏'}
        </button>
      </div>
    </div>
  );
}

function Icon({ name }: { name: string }) {
  return <i className={`icon icon-${name}`} />;
}
