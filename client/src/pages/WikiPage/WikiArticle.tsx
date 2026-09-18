/**
 * WikiArticle - Wiki 主正文区
 *
 * 显示连贯的正文内容
 */

import React from 'react';
import type { WikiMatter } from './index';

interface WikiArticleProps {
  matter: WikiMatter;
  onNavigateToDoc?: (docId: string) => void;
}

export function WikiArticle({ matter, onNavigateToDoc }: WikiArticleProps) {
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

      {/* 摘要 */}
      <div className="matter-summary">
        <p>{matter.summary}</p>
      </div>

      {/* 正文段落 */}
      {matter.body.map((section) => (
        <section key={section.id} id={`issue-${section.id}`}>
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
                    const docId = section.sources[index];
                    onNavigateToDoc?.(docId);
                  }}
                >
                  {ref}
                </button>
              ))}
            </div>
          )}
        </section>
      ))}
    </section>
  );
}

function Icon({ name }: { name: string }) {
  return <i className={`icon icon-${name}`} />;
}
