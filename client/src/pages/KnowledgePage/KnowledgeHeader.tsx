/**
 * KnowledgeHeader - 工程知识页面顶部控件
 *
 * 包含：
 * - 视图切换（工程认识/来源资料）
 * - 版本选择（当前/含历史/仅历史）
 * - 搜索框
 */

import React from 'react';
import type { KnowledgeViewKind, KnowledgeVersionScope } from './index';

interface KnowledgeHeaderProps {
  kind: KnowledgeViewKind;
  version: KnowledgeVersionScope;
  query: string;
  onKindChange: (kind: KnowledgeViewKind) => void;
  onVersionChange: (version: KnowledgeVersionScope) => void;
  onQueryChange: (query: string) => void;
}

export function KnowledgeHeader({
  kind,
  version,
  query,
  onKindChange,
  onVersionChange,
  onQueryChange,
}: KnowledgeHeaderProps) {
  return (
    <div className="knowledge-toolbar">
      {/* 视图切换 */}
      <div className="segmented">
        <button
          className={kind === 'works' ? 'active' : ''}
          onClick={() => onKindChange('works')}
        >
          工程认识
        </button>
        <button
          className={kind === 'sources' ? 'active' : ''}
          onClick={() => onKindChange('sources')}
        >
          来源资料
        </button>
      </div>

      {/* 版本选择（仅在工程认识视图显示） */}
      {kind === 'works' && (
        <div className="tabs">
          <button
            className={version === 'current' ? 'active' : ''}
            onClick={() => onVersionChange('current')}
          >
            当前
          </button>
          <button
            className={version === 'all' ? 'active' : ''}
            onClick={() => onVersionChange('all')}
          >
            含历史
          </button>
          <button
            className={version === 'historical' ? 'active' : ''}
            onClick={() => onVersionChange('historical')}
          >
            仅历史
          </button>
        </div>
      )}

      {/* 搜索框 */}
      <label className="table-search">
        <Icon name="search" size={15} />
        <input
          type="search"
          placeholder="问题、ATA章节与认识关键词…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </label>
    </div>
  );
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <i className={`icon icon-${name}`} style={{ fontSize: size }} />;
}
