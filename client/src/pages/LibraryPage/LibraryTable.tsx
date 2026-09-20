/**
 * LibraryTable - 统一资料表格
 *
 * 支持文档和事项两种模式
 * 5列布局：对象/版本/解读/范围/操作
 */

import React from 'react';
import type { DocumentItem, MatterItem, LibraryViewMode, LibraryFilters } from './index';

interface LibraryTableProps {
  mode: LibraryViewMode;
  items: Array<DocumentItem | MatterItem>;
  documents: DocumentItem[];
  selection?: string;
  expanded: string[];
  compact: boolean;
  filters: LibraryFilters;
  onSelect: (id: string) => void;
  onToggleExpand: (familyId: string) => void;
  onChangeMode: (mode: LibraryViewMode) => void;
  onChangeFilters: (filters: LibraryFilters) => void;
  onToggleCompact: () => void;
  onOpen: (id: string) => void;
}

export function LibraryTable({
  mode,
  items,
  documents,
  selection,
  expanded,
  compact,
  filters,
  onSelect,
  onToggleExpand,
  onChangeMode,
  onChangeFilters,
  onToggleCompact,
  onOpen,
}: LibraryTableProps) {
  // 获取所有机型
  const fleets = React.useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      if (item.fleet) set.add(item.fleet);
    });
    return Array.from(set);
  }, [items]);

  // 获取 family 的历史版本
  const getVersionRows = (familyId: string) => {
    if (!expanded.includes(familyId)) return null;

    return documents
      .filter((d) => d.familyId === familyId && !d.current)
      .map((doc) => (
        <tr
          key={doc.id}
          className={`version-row ${selection === doc.id ? 'selected' : ''}`}
          onClick={() => onSelect(doc.id)}
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onSelect(doc.id)}
        >
          <td>
            <div className="doc-cell">
              <Icon name="clock" />
              <span>
                <b>{doc.title}</b>
                <small>该文件自己的历史版本</small>
              </span>
            </div>
          </td>
          <td>
            <span className="badge">{doc.version}</span>
          </td>
          <td colSpan={2}>{doc.brief || '历史版本解读'}</td>
          <td>
            <button
              className="btn"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(doc.id);
              }}
            >
              精读
            </button>
          </td>
        </tr>
      ));
  };

  return (
    <section className="panel library-main">
      {/* 工具栏 */}
      <div className="table-toolbar">
        {/* 模式切换 */}
        <div className="segmented">
          <button
            className={mode === 'documents' ? 'active' : ''}
            onClick={() => onChangeMode('documents')}
          >
            工程文档
          </button>
          <button
            className={mode === 'matters' ? 'active' : ''}
            onClick={() => onChangeMode('matters')}
          >
            工程事项
          </button>
        </div>

        {/* 搜索框 */}
        <label className="table-search">
          <Icon name="search" size={15} />
          <input
            aria-label="筛选资料"
            placeholder="名称、内容与版本…"
            value={filters.query || ''}
            onChange={(e) =>
              onChangeFilters({ ...filters, query: e.target.value })
            }
          />
        </label>

        {/* 机型筛选 */}
        <select
          aria-label="机型筛选"
          value={filters.fleet || 'all'}
          onChange={(e) =>
            onChangeFilters({ ...filters, fleet: e.target.value })
          }
        >
          <option value="all">全部机型</option>
          {fleets.map((fleet) => (
            <option key={fleet} value={fleet}>
              {fleet}
            </option>
          ))}
        </select>

        {/* 紧凑模式 */}
        <button
          className="btn"
          aria-label="切换紧凑行距"
          onClick={onToggleCompact}
        >
          <Icon name="list" />
        </button>
      </div>

      {/* 表格 */}
      <div
        className={`table-wrap scroll-region ${compact ? 'dense' : ''}`}
        data-scroll-key="library-table"
      >
        <table className="library-table">
          <thead>
            <tr>
              <th>{mode === 'documents' ? '文件与主题' : '工程事项'}</th>
              <th>{mode === 'documents' ? '来源版本' : '当前工作'}</th>
              <th>解读与当前认识</th>
              <th>范围 / 变化</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  <div className="empty">
                    <p>没有匹配的资料</p>
                    <small>可调整关键词或范围，原有资料未被删除。</small>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const isDoc = mode === 'documents';
                const doc = isDoc ? (item as DocumentItem) : null;
                const matter = !isDoc ? (item as MatterItem) : null;

                return (
                  <React.Fragment key={item.id}>
                    <tr
                      className={selection === item.id ? 'selected' : ''}
                      onClick={() => onSelect(item.id)}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && onSelect(item.id)}
                    >
                      {/* 第1列：对象 */}
                      <td>
                        <div className="doc-cell">
                          {isDoc && doc ? (
                            <>
                              <button
                                className="expand-button"
                                aria-label={`展开${doc.familyId}历史版本`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleExpand(doc.familyId);
                                }}
                              >
                                <Icon
                                  name={
                                    expanded.includes(doc.familyId)
                                      ? 'down'
                                      : 'chevron'
                                  }
                                  size={13}
                                />
                              </button>
                              <span>
                                <b>{doc.title}</b>
                                <small>
                                  {doc.type} · ATA {doc.ata}
                                </small>
                              </span>
                            </>
                          ) : (
                            matter && (
                              <>
                                <Icon name="topic" />
                                <span>
                                  <b>{matter.title}</b>
                                  <small>{matter.code}</small>
                                </span>
                              </>
                            )
                          )}
                        </div>
                      </td>

                      {/* 第2列：版本/工作 */}
                      <td>
                        <span
                          className={`badge ${
                            !isDoc && matter && !matter.overallCovered
                              ? 'badge-amber'
                              : ''
                          }`}
                        >
                          {isDoc && doc ? doc.version : matter?.overview}
                        </span>
                      </td>

                      {/* 第3列：解读/认识 ⭐ 关键 */}
                      <td className="meaning">
                        {isDoc && doc
                          ? doc.brief || '解读准备中…'
                          : matter?.summary}
                      </td>

                      {/* 第4列：范围/变化 */}
                      <td>
                        <span>
                          {item.fleet} · ATA {item.ata}
                        </span>
                        <small>
                          {isDoc && doc
                            ? doc.effective
                            : matter?.overallCovered
                            ? '已有保存认识'
                            : '问题已更新，综合未覆盖'}
                        </small>
                      </td>

                      {/* 第5列：操作 */}
                      <td>
                        <button
                          className="btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(item.id);
                          }}
                        >
                          打开
                        </button>
                      </td>
                    </tr>

                    {/* 历史版本行 */}
                    {isDoc && doc && getVersionRows(doc.familyId)}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 表格底部 */}
      <div className="table-footer">
        显示 {items.length} {mode === 'documents' ? '个文档族' : '个事项'}
        <span>单击快览 · 打开后精读</span>
      </div>
    </section>
  );
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <i className={`icon icon-${name}`} style={{ fontSize: size }} />;
}
