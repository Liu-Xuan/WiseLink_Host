/**
 * FolderPane - 左侧资料分组面板
 *
 * 提供：
 * - 全部资料
 * - ATA 分类
 * - 我的负责范围
 * - 筛选控制
 */

import React from 'react';
import type { DocumentItem, MatterItem, LibraryFilters } from './index';

interface FolderPaneProps {
  documents: DocumentItem[];
  matters: MatterItem[];
  filters: LibraryFilters;
  onChangeFilters: (filters: LibraryFilters) => void;
}

export function FolderPane({
  documents,
  matters,
  filters,
  onChangeFilters,
}: FolderPaneProps) {
  // 提取所有 ATA 分类
  const ataCategories = React.useMemo(() => {
    const atas = new Set<string>();
    [...documents, ...matters].forEach((item) => {
      if (item.ata) atas.add(item.ata);
    });

    // ATA 名称映射
    const ataLabels: Record<string, string> = {
      '32': '起落架',
      '34': '导航',
      '29': '液压系统',
      // 可扩展更多
    };

    return Array.from(atas)
      .sort()
      .map((ata) => ({
        code: ata,
        label: ataLabels[ata] || '专业资料',
        count: documents.filter((d) => d.current && d.ata === ata).length,
      }));
  }, [documents, matters]);

  const currentDocsCount = documents.filter((d) => d.current).length;

  const updateFilter = (key: keyof LibraryFilters, value: any) => {
    onChangeFilters({ ...filters, [key]: value });
  };

  return (
    <aside className="panel folder-pane">
      <div className="panel-head">
        <h3>资料分组</h3>
        <Icon name="layers" />
      </div>

      <div className="scroll-region" data-scroll-key="library-folders">
        {/* 全部资料 */}
        <button
          className={`folder-row ${filters.tab === 'current' ? 'active' : ''}`}
          onClick={() => updateFilter('tab', 'current')}
        >
          <Icon name="file" />
          全部资料
          <span>{currentDocsCount}</span>
        </button>

        {/* ATA 分类 */}
        {ataCategories.map(({ code, label, count }) => (
          <button
            key={code}
            className={`folder-row ${filters.tab === `ata-${code}` ? 'active' : ''}`}
            onClick={() => updateFilter('tab', `ata-${code}`)}
          >
            <Icon name="chapter" />
            <span>
              ATA {code}
              <small>{label}</small>
            </span>
            <b>{count}</b>
          </button>
        ))}

        {/* 阅读范围分隔 */}
        <div className="folder-separator">阅读范围</div>

        {/* 我的负责范围 */}
        <button
          className={`folder-row ${filters.mine === 'mine' ? 'active' : ''}`}
          onClick={() =>
            updateFilter('mine', filters.mine === 'mine' ? 'all' : 'mine')
          }
        >
          <Icon name="work" />
          我的负责范围
        </button>

        {/* 清除筛选 */}
        <button
          className="folder-row"
          onClick={() =>
            onChangeFilters({
              tab: 'current',
              fleet: 'all',
              mine: 'all',
              query: '',
            })
          }
        >
          <Icon name="reset" />
          清除筛选
        </button>
      </div>
    </aside>
  );
}

function Icon({ name }: { name: string }) {
  return <i className={`icon icon-${name}`} />;
}
