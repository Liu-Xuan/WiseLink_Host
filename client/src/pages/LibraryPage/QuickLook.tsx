/**
 * QuickLook - 右侧快览面板
 *
 * 显示选中项的快速理解信息
 */

import React from 'react';
import type { DocumentItem, MatterItem, LibraryViewMode } from './index';

interface QuickLookProps {
  mode: LibraryViewMode;
  item?: DocumentItem | MatterItem | null;
  documents: DocumentItem[];
  onOpenReader?: (docId: string) => void;
  onOpenWiki?: (matterId: string) => void;
  onOpenGraph?: (matterId: string) => void;
}

export function QuickLook({
  mode,
  item,
  documents,
  onOpenReader,
  onOpenWiki,
  onOpenGraph,
}: QuickLookProps) {
  if (!item) {
    return (
      <aside className="panel quicklook scroll-region" data-scroll-key="library-quicklook">
        <div className="panel-head">
          <h3>快速理解</h3>
          <Icon name="bulb" />
        </div>
        <div className="empty">
          <p>选择一项资料</p>
          <small>查看它的主题、当前认识和关键条件。</small>
        </div>
      </aside>
    );
  }

  const isDoc = mode === 'documents';
  const doc = isDoc ? (item as DocumentItem) : null;
  const matter = !isDoc ? (item as MatterItem) : null;

  // 获取附件
  const attachments = doc
    ? doc.attachmentIds
        .map((id) => documents.find((d) => d.id === id))
        .filter(Boolean) as DocumentItem[]
    : [];

  const matterId = doc?.matterId || matter?.id;

  return (
    <aside className="panel quicklook scroll-region" data-scroll-key="library-quicklook">
      <div className="panel-head">
        <h3>快速理解</h3>
        <Icon name="bulb" />
      </div>

      <div className="quicklook-body">
        {/* 标签 */}
        <div className="inline">
          <span className="badge">
            {isDoc && doc ? doc.type : matter?.fleet}
          </span>
          <span className="badge">
            {isDoc && doc ? doc.version : matter?.overview}
          </span>
        </div>

        {/* 标题 */}
        <h2>{item.title}</h2>

        {/* 主要内容 */}
        <section>
          <h3>{isDoc ? '这份资料说明什么' : '当前认识'}</h3>
          <p>
            {isDoc && doc
              ? doc.brief || '解读准备中，请稍后查看完整精读内容。'
              : matter?.summary}
          </p>
        </section>

        {/* 范围说明 */}
        <section>
          <h3>{isDoc ? '阅读范围' : '重要条件与覆盖'}</h3>
          <p>
            {isDoc
              ? '所选文档版本与原文'
              : matter?.overallCovered
              ? '已保存的事项认识'
              : '最新问题正文可读，旧综合尚未纳入本轮变化。'}
          </p>
        </section>

        {/* 附件（仅文档） */}
        {isDoc && attachments.length > 0 && (
          <section>
            <h3>附件</h3>
            <div className="attachment-list">
              {attachments.map((att) => (
                <button
                  key={att.id}
                  className="btn btn-sm"
                  onClick={() => onOpenReader?.(att.id)}
                >
                  <Icon name="file" />
                  {att.title}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 操作按钮 */}
        <div className="action-buttons">
          <button
            className="btn btn-primary"
            onClick={() => {
              if (isDoc && doc) {
                onOpenReader?.(doc.id);
              } else if (matter) {
                onOpenWiki?.(matter.id);
              }
            }}
          >
            <Icon name={isDoc ? 'file' : 'book'} />
            {isDoc ? '进入精读工作台' : '阅读事项 Wiki'}
          </button>

          {matterId && (
            <button
              className="btn"
              onClick={() => onOpenGraph?.(matterId)}
            >
              <Icon name="graph" />
              查看关联图谱
            </button>
          )}
        </div>

        {/* 元数据 */}
        <section className="mini-meta">
          <span>来源与范围</span>
          <b>{isDoc && doc ? doc.familyId : matter?.code}</b>

          <span>对应机型</span>
          <b>{item.fleet}</b>

          <span>版本信息</span>
          <b>{isDoc && doc ? doc.effective : matter?.revision}</b>
        </section>
      </div>
    </aside>
  );
}

function Icon({ name }: { name: string }) {
  return <i className={`icon icon-${name}`} />;
}
