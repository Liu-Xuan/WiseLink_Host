import type { ReaderDocument, OutlineType } from './index';

interface ReaderOutlineProps {
  document: ReaderDocument;
  outlineType: OutlineType;
  selectedBlockId: string;
  onOutlineTypeChange: (type: OutlineType) => void;
  onBlockSelect: (blockId: string) => void;
}

const BUSINESS_OUTLINE: Record<string, string> = {
  background: '问题背景',
  scope: '范围与条件',
  limitations: '限制与解释',
  comparison: '条件比较',
  revision: '本版变化',
  references: '参考与复看',
  general: '一般信息',
};

function getBusinessTitle(role: string, fallback: string): string {
  return BUSINESS_OUTLINE[role] || fallback;
}

export default function ReaderOutline({
  document,
  outlineType,
  selectedBlockId,
  onOutlineTypeChange,
  onBlockSelect,
}: ReaderOutlineProps) {
  return (
    <aside className="reader-outline panel">
      <div className="outline-tabs">
        <button
          className={outlineType === 'author' ? 'active' : ''}
          onClick={() => onOutlineTypeChange('author')}
        >
          作者章节
        </button>
        <button
          className={outlineType === 'business' ? 'active' : ''}
          onClick={() => onOutlineTypeChange('business')}
        >
          业务主题
        </button>
      </div>

      <div className="outline-list scroll-region">
        {document.blocks.map((block) => (
          <button
            key={block.id}
            className={`outline-item ${
              selectedBlockId === block.id ? 'selected' : ''
            }`}
            onClick={() => onBlockSelect(block.id)}
          >
            <span className="outline-title">
              {outlineType === 'author'
                ? block.zhTitle
                : getBusinessTitle(block.role, block.zhTitle)}
            </span>
            <small className="outline-page">P{block.page + 1}</small>
          </button>
        ))}
      </div>

      <div className="outline-source">
        <small>来源版本</small>
        <b>
          {document.familyId} · {document.version}
        </b>
        <span>{document.current ? '当前可读版本' : '保留历史绑定'}</span>
      </div>
    </aside>
  );
}
