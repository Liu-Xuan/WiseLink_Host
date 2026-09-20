/**
 * LibraryPage - 资料库页面
 *
 * 基于 Suite 1.1 设计的三栏布局：
 * - 左侧：资料分组
 * - 中间：统一表格
 * - 右侧：快览面板
 */

import React, { useState, useMemo, useEffect } from 'react';
import { FolderPane } from './FolderPane';
import { LibraryTable } from './LibraryTable';
import { QuickLook } from './QuickLook';
import './library.css';

export type LibraryViewMode = 'documents' | 'matters';

export interface LibraryFilters {
  tab?: string;
  fleet?: string;
  mine?: 'all' | 'mine';
  query?: string;
}

export interface DocumentItem {
  id: string;
  familyId: string;
  title: string;
  type: string;
  version: string;
  ata: string;
  fleet: string;
  current: boolean;
  effective: string;
  brief?: string;  // 短解读 - 来自 DocumentReading
  attachmentIds: string[];
  matterId?: string;
}

export interface MatterItem {
  id: string;
  code: string;
  title: string;
  fleet: string;
  ata: string;
  overview: string;
  summary: string;  // 短认识
  overallCovered: boolean;
  responsible?: boolean;
  revision: string;
}

interface LibraryPageProps {
  mode: LibraryViewMode;
  documents: DocumentItem[];
  matters: MatterItem[];
  onNavigateToDoc?: (docId: string) => void;
  onNavigateToWiki?: (matterId: string) => void;
  onNavigateToGraph?: (matterId: string) => void;
  onOpenIntake?: () => void;
}

export function LibraryPage({
  mode: initialMode,
  documents,
  matters,
  onNavigateToDoc,
  onNavigateToWiki,
  onNavigateToGraph,
  onOpenIntake,
}: LibraryPageProps) {
  // 状态管理
  const [mode, setMode] = useState<LibraryViewMode>(initialMode);
  const [selection, setSelection] = useState<string>();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [filters, setFilters] = useState<LibraryFilters>({
    tab: 'current',
    fleet: 'all',
    mine: 'all',
    query: '',
  });
  const [compact, setCompact] = useState(false);

  // 初始化选择
  useEffect(() => {
    if (!selection) {
      const firstItem =
        mode === 'documents'
          ? documents.find((d) => d.current && d.type !== '附件')?.id
          : matters[0]?.id;
      setSelection(firstItem);
    }
  }, [mode, documents, matters, selection]);

  // 过滤数据
  const filteredItems = useMemo(() => {
    const items = mode === 'documents' ? documents : matters;
    const query = filters.query?.toLowerCase() || '';

    return items.filter((item) => {
      // 文档：只显示当前版本，排除附件
      if (mode === 'documents') {
        const doc = item as DocumentItem;
        if (!doc.current || doc.type === '附件') return false;
      }

      // 机型筛选
      if (filters.fleet !== 'all' && item.fleet !== filters.fleet) {
        return false;
      }

      // 负责范围筛选
      if (filters.mine === 'mine') {
        const matter =
          mode === 'matters'
            ? (item as MatterItem)
            : matters.find((m) => m.id === (item as DocumentItem).matterId);
        if (!matter?.responsible) return false;
      }

      // ATA 筛选
      if (filters.tab?.startsWith('ata-')) {
        const targetAta = filters.tab.slice(4);
        if (item.ata !== targetAta) return false;
      }

      // 搜索关键词
      if (query) {
        const searchText = JSON.stringify(item).toLowerCase();
        if (!searchText.includes(query)) return false;
      }

      return true;
    });
  }, [mode, documents, matters, filters]);

  // 选中项
  const selectedItem = useMemo(() => {
    if (!selection) return null;
    return mode === 'documents'
      ? documents.find((d) => d.id === selection)
      : matters.find((m) => m.id === selection);
  }, [mode, selection, documents, matters]);

  // 切换模式
  const handleModeChange = (newMode: LibraryViewMode) => {
    setMode(newMode);
    setSelection(undefined); // 重置选择
    setExpanded([]); // 重置展开
  };

  // 展开/收起 family
  const handleToggleExpand = (familyId: string) => {
    setExpanded((prev) =>
      prev.includes(familyId)
        ? prev.filter((id) => id !== familyId)
        : [...prev, familyId]
    );
  };

  return (
    <>
      {/* 页面标题 */}
      <div className="page-heading">
        <div>
          <h1>资料库</h1>
          <p>从文件与事项，快速理解问题、当前认识和下一关注。</p>
        </div>
        <div className="inline">
          <span className="badge">
            {documents.filter((d) => d.current).length} 份当前资料
          </span>
          <span className="badge">{matters.length} 个工程事项</span>
          {onOpenIntake && (
            <button className="btn btn-primary" onClick={onOpenIntake}>
              <Icon name="plus" />
              上传资料
            </button>
          )}
        </div>
      </div>

      {/* 三栏布局 */}
      <div className="library-layout">
        {/* 左侧：资料分组 */}
        <FolderPane
          documents={documents}
          matters={matters}
          filters={filters}
          onChangeFilters={setFilters}
        />

        {/* 中间：统一表格 */}
        <LibraryTable
          mode={mode}
          items={filteredItems}
          documents={documents}
          selection={selection}
          expanded={expanded}
          compact={compact}
          filters={filters}
          onSelect={setSelection}
          onToggleExpand={handleToggleExpand}
          onChangeMode={handleModeChange}
          onChangeFilters={setFilters}
          onToggleCompact={() => setCompact(!compact)}
          onOpen={(id) => {
            if (mode === 'documents') {
              onNavigateToDoc?.(id);
            } else {
              onNavigateToWiki?.(id);
            }
          }}
        />

        {/* 右侧：快览面板 */}
        <QuickLook
          mode={mode}
          item={selectedItem}
          documents={documents}
          onOpenReader={onNavigateToDoc}
          onOpenWiki={onNavigateToWiki}
          onOpenGraph={onNavigateToGraph}
        />
      </div>
    </>
  );
}

// 临时 Icon 占位
function Icon({ name }: { name: string }) {
  return <i className={`icon icon-${name}`} />;
}
