/**
 * WikiArticle - Wiki 主正文区
 *
 * 显示连贯的正文内容，突出有价值的摘要信息
 * 详细分析、过程描述等内容可折叠展开
 */

import React from 'react';
import type { WikiMatter } from './types';

interface WikiArticleProps {
  matter: WikiMatter;
  onNavigateToDoc?: (docId: string) => void;
}

export function WikiArticle({ matter, onNavigateToDoc }: WikiArticleProps) {
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(new Set());

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  return (
    <section className="panel article-panel scroll-region" data-scroll-key={`wiki-${matter.id}`}>
      {/* 顶部工具栏 */}
      <div className="article-tools">
        <span className="badge">{matter.fleet} · ATA {matter.ata}</span>
        <span className="badge">{matter.overview}</span>
        <div className="push" />
        {matter.primaryDocId && (
          <button
            className="btn btn-sm"
            onClick={() => onNavigateToDoc?.(matter.primaryDocId!)}
          >
            <Icon name="file" />
            主要来源
          </button>
        )}
      </div>

      {/* 标题 */}
      <h1>{matter.title}</h1>
      <div className="matter-code">{matter.code} · {matter.revision}</div>

      {/* 核心摘要 - 突出显示 */}
      <div className="matter-summary-highlight">
        <p>{matter.summary}</p>
      </div>

      {/* 正文段落 */}
      {matter.body.map((section) => {
        const isExpanded = expandedSections.has(section.id);
        return (
          <section key={section.id} id={`issue-${section.id}`} className="content-section">
            <div className="section-header" onClick={() => toggleSection(section.id)}>
              <h2>{section.title}</h2>
              <button className="expand-toggle" aria-expanded={isExpanded}>
                <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} />
              </button>
            </div>

            {isExpanded && (
              <div className="section-content">
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
                        onClick={(e) => {
                          e.stopPropagation();
                          const docId = section.sources[index];
                          onNavigateToDoc?.(docId);
                        }}
                      >
                        {ref}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </section>
  );
}

function Icon({ name }: { name: string }) {
  return <i className={`icon icon-${name}`} />;
}
