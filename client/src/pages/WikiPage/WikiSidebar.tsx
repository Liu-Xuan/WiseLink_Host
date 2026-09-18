/**
 * WikiSidebar - Wiki 侧边栏
 *
 * 包含目录、继续关注、关键依据、认识历史
 */

import React from 'react';
import type { WikiMatter } from './index';

interface TocItem {
  id: string;
  title: string;
  level: number;
  anchor: string;
}

interface WikiSidebarProps {
  matter: WikiMatter;
  toc: TocItem[];
  activeSection: string | null;
  onNavigateToDoc?: (docId: string) => void;
  onNavigateToTimeline?: (matterId: string) => void;
  onNavigateToGraph?: (matterId: string) => void;
}

export function WikiSidebar({
  matter,
  toc,
  activeSection,
  onNavigateToDoc,
  onNavigateToTimeline,
  onNavigateToGraph,
}: WikiSidebarProps) {
  // 滚动到指定章节
  const scrollToSection = (anchor: string) => {
    const element = document.getElementById(anchor);
    if (element) {
      element.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  return (
    <aside className="wiki-sidebar">
      {/* 目录 */}
      <section className="panel">
        <div className="panel-head">
          <h3>阅读目录</h3>
        </div>
        <div className="outline-links">
          {toc.map((item) => (
            <button
              key={item.id}
              className={activeSection === item.id ? 'active' : ''}
              onClick={() => scrollToSection(item.anchor)}
            >
              {item.title}
            </button>
          ))}
        </div>
      </section>

      {/* 继续关注 */}
      {matter.open.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>继续关注</h3>
          </div>
          <div className="aside-body">
            {matter.open.map((item, index) => (
              <p key={index}>{item}</p>
            ))}
            <button
              className="btn"
              onClick={() => onNavigateToTimeline?.(matter.id)}
            >
              <Icon name="clock" />
              变化与时间轴
            </button>
          </div>
        </section>
      )}

      {/* 关键依据 */}
      {matter.evidenceDocIds.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>关键依据</h3>
          </div>
          <div className="aside-body">
            <div className="evidence-list">
              {matter.evidenceDocIds.map((docId) => (
                <button
                  key={docId}
                  className="evidence-link"
                  onClick={() => onNavigateToDoc?.(docId)}
                >
                  <Icon name="file" />
                  <span>文档 {docId}</span>
                </button>
              ))}
            </div>
            <button
              className="btn"
              onClick={() => onNavigateToGraph?.(matter.id)}
            >
              <Icon name="graph" />
              查看实际关系
            </button>
          </div>
        </section>
      )}

      {/* 认识的历史 */}
      {matter.workHistory.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>认识的历史</h3>
          </div>
          <div className="aside-body">
            {matter.workHistory.map((history) => (
              <div className="history-entry" key={history.version}>
                <small>
                  {history.date} · {history.version}
                </small>
                <p>{history.summary}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}

function Icon({ name }: { name: string }) {
  return <i className={`icon icon-${name}`} />;
}
