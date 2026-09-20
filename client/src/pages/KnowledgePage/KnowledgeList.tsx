/**
 * KnowledgeList - 工程知识列表
 *
 * 左侧已有解释列表
 */

import React from 'react';
import type { KnowledgeWork } from './index';

interface KnowledgeListProps {
  works: KnowledgeWork[];
  selected: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
}

export function KnowledgeList({
  works,
  selected,
  loading,
  onSelect,
}: KnowledgeListProps) {
  if (loading) {
    return (
      <aside className="panel knowledge-list">
        <div className="panel-head">
          <h3>已有解释</h3>
        </div>
        <div className="loading-container">
          <div className="spinner" />
        </div>
      </aside>
    );
  }

  if (works.length === 0) {
    return (
      <aside className="panel knowledge-list">
        <div className="panel-head">
          <h3>已有解释</h3>
        </div>
        <div className="empty">
          <p>没有匹配的工作</p>
          <small>可调整关键词或版本范围。</small>
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel knowledge-list scroll-region" data-scroll-key="knowledge-list">
      <div className="panel-head">
        <h3>已有解释</h3>
        <span className="badge">{works.length}</span>
      </div>

      <div className="knowledge-items">
        {works.map((work) => (
          <button
            key={work.id}
            className={`knowledge-item ${selected === work.id ? 'active' : ''} ${!work.current ? 'historical' : ''}`}
            onClick={() => onSelect(work.id)}
          >
            <div className="knowledge-item-header">
              <strong>{work.title}</strong>
              {!work.current && <span className="badge badge-amber">历史</span>}
            </div>
            <div className="knowledge-item-meta">
              <span>{work.scope}</span>
              <span>·</span>
              <span>{work.version}</span>
            </div>
            <p className="knowledge-item-summary">{work.summary}</p>
          </button>
        ))}
      </div>
    </aside>
  );
}
