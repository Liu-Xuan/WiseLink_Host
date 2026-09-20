/**
 * WikiSidebar - Wiki 侧边栏
 *
 * 包含目录、继续关注、关键依据、认识历史、关联事项
 * 所有面板均可折叠，默认只展开目录
 */

import React from 'react';
import type { WikiMatter, TocItem } from './types';

interface WikiSidebarProps {
  matter: WikiMatter;
  toc: TocItem[];
  activeSection: string | null;
  onNavigateToDoc?: (docId: string) => void;
  onNavigateToTimeline?: (matterId: string) => void;
  onNavigateToGraph?: (matterId: string) => void;
  onNavigateToMatter?: (matterId: string) => void;
}

export function WikiSidebar({
  matter,
  toc,
  activeSection,
  onNavigateToDoc,
  onNavigateToTimeline,
  onNavigateToGraph,
  onNavigateToMatter,
}: WikiSidebarProps) {
  const [expandedPanels, setExpandedPanels] = React.useState<Set<string>>(
    new Set(['toc']) // 默认只展开目录
  );

  const togglePanel = (panelId: string) => {
    setExpandedPanels(prev => {
      const next = new Set(prev);
      if (next.has(panelId)) {
        next.delete(panelId);
      } else {
        next.add(panelId);
      }
      return next;
    });
  };

  // 滚动到指定章节
  const scrollToSection = (anchor: string) => {
    const element = document.getElementById(anchor);
    if (element) {
      element.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  return (
    <aside className="wiki-sidebar">
      {/* 目录 - 始终可见 */}
      <section className="panel">
        <div className="panel-head" onClick={() => togglePanel('toc')}>
          <h3>阅读目录</h3>
          <Icon name={expandedPanels.has('toc') ? 'chevron-up' : 'chevron-down'} />
        </div>
        {expandedPanels.has('toc') && (
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
        )}
      </section>

      {/* 继续关注 - 可折叠 */}
      {matter.open.length > 0 && (
        <section className="panel collapsible-panel">
          <div className="panel-head" onClick={() => togglePanel('open')}>
            <h3>继续关注</h3>
            <span className="badge-count">{matter.open.length}</span>
            <Icon name={expandedPanels.has('open') ? 'chevron-up' : 'chevron-down'} />
          </div>
          {expandedPanels.has('open') && (
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
          )}
        </section>
      )}

      {/* 关键依据 - 可折叠 */}
      {matter.evidenceDocIds.length > 0 && (
        <section className="panel collapsible-panel">
          <div className="panel-head" onClick={() => togglePanel('evidence')}>
            <h3>关键依据</h3>
            <span className="badge-count">{matter.evidenceDocIds.length}</span>
            <Icon name={expandedPanels.has('evidence') ? 'chevron-up' : 'chevron-down'} />
          </div>
          {expandedPanels.has('evidence') && (
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
          )}
        </section>
      )}

      {/* 认识的历史 - 可折叠 */}
      {matter.workHistory.length > 0 && (
        <section className="panel collapsible-panel">
          <div className="panel-head" onClick={() => togglePanel('history')}>
            <h3>认识的历史</h3>
            <span className="badge-count">{matter.workHistory.length}</span>
            <Icon name={expandedPanels.has('history') ? 'chevron-up' : 'chevron-down'} />
          </div>
          {expandedPanels.has('history') && (
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
          )}
        </section>
      )}

      {/* 关联事项 - 可折叠，借鉴 LLM Wiki 的交叉引用概念 */}
      {matter.relatedMatters && matter.relatedMatters.length > 0 && (
        <section className="panel collapsible-panel">
          <div className="panel-head" onClick={() => togglePanel('related')}>
            <h3>关联事项</h3>
            <span className="badge-count">{matter.relatedMatters.length}</span>
            <Icon name={expandedPanels.has('related') ? 'chevron-up' : 'chevron-down'} />
          </div>
          {expandedPanels.has('related') && (
            <div className="aside-body">
              <div className="related-matters">
                {matter.relatedMatters.map((related) => (
                  <button
                    key={related.id}
                    className={`related-link relationship-${related.relationship}`}
                    onClick={() => onNavigateToMatter?.(related.id)}
                  >
                    <span className="relationship-badge">{getRelationshipLabel(related.relationship)}</span>
                    <span className="related-title">{related.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </aside>
  );
}

function getRelationshipLabel(relationship: string): string {
  const labels: Record<string, string> = {
    related: '相关',
    depends: '依赖',
    blocks: '阻塞',
    supersedes: '替代',
  };
  return labels[relationship] || relationship;
}

function Icon({ name }: { name: string }) {
  return <i className={`icon icon-${name}`} />;
}
