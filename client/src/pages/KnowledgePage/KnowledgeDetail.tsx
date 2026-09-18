/**
 * KnowledgeDetail - 工程知识详细内容
 *
 * 右侧完整正文区域
 */

import React from 'react';
import type { KnowledgeWork } from './index';

interface KnowledgeDetailProps {
  work?: KnowledgeWork;
  onNavigateToWiki?: (matterId: string, tab?: string) => void;
  onNavigateToGraph?: (matterId: string) => void;
}

export function KnowledgeDetail({
  work,
  onNavigateToWiki,
  onNavigateToGraph,
}: KnowledgeDetailProps) {
  if (!work) {
    return (
      <section className="panel knowledge-detail">
        <div className="empty">
          <p>选择一个工作</p>
          <small>查看完整解释和来源。</small>
        </div>
      </section>
    );
  }

  return (
    <section className="panel knowledge-detail scroll-region" data-scroll-key={`knowledge-${work.id}`}>
      {/* 顶部工具栏 */}
      <div className="article-tools">
        <span className="badge">{work.scope}</span>
        <span className="badge">{work.version}</span>
        {!work.current && <span className="badge badge-amber">历史工作</span>}
        <div className="push" />
        <small>{work.created}</small>
      </div>

      {/* 主标题 */}
      <h1>{work.title}</h1>

      {/* 摘要 */}
      <div className="knowledge-summary">
        <p>{work.summary}</p>
      </div>

      {/* 正文段落 */}
      {work.body.map((section) => (
        <section key={section.id} id={`section-${section.id}`}>
          <h2>{section.title}</h2>
          {section.paragraphs.map((para, index) => (
            <p key={index}>{para}</p>
          ))}

          {/* 来源链接 */}
          {section.sourceRefs.length > 0 && (
            <div className="source-links">
              <small>依据：</small>
              {section.sourceRefs.map((ref, index) => (
                <button
                  key={index}
                  className="source-link"
                  onClick={() => {
                    // TODO: 打开对应文档
                  }}
                >
                  {ref}
                </button>
              ))}
            </div>
          )}
        </section>
      ))}

      {/* 底部操作 */}
      <div className="knowledge-actions">
        <button
          className="btn btn-primary"
          onClick={() => {
            const tab = work.current && work.issueId ? `issue:${work.issueId}` : 'current';
            onNavigateToWiki?.(work.matterId, tab);
          }}
        >
          <Icon name="book" />
          {work.current ? '打开对应事项 Wiki' : '查看事项当前认识'}
        </button>

        <button
          className="btn"
          onClick={() => onNavigateToGraph?.(work.matterId)}
        >
          <Icon name="graph" />
          查看关系
        </button>
      </div>
    </section>
  );
}

function Icon({ name }: { name: string }) {
  return <i className={`icon icon-${name}`} />;
}
