import { List } from 'lucide-react';
import type { ReaderViewMode } from './index';

interface ReaderControlsProps {
  mode: ReaderViewMode;
  outline: boolean;
  sync: boolean;
  mobileSide: 'left' | 'right';
  onModeChange: (mode: ReaderViewMode) => void;
  onOutlineToggle: () => void;
  onSyncToggle: () => void;
  onMobileSideChange: (side: 'left' | 'right') => void;
}

const MODE_OPTIONS: Array<[ReaderViewMode, string]> = [
  ['original-pdf', '原文＋原件'],
  ['bilingual', '中英对照'],
  ['chinese', '中文阅读'],
  ['original', '仅原文'],
  ['pdf', '仅原件'],
];

export default function ReaderControls({
  mode,
  outline,
  sync,
  mobileSide,
  onModeChange,
  onOutlineToggle,
  onSyncToggle,
  onMobileSideChange,
}: ReaderControlsProps) {
  return (
    <div className="reader-controls">
      <button
        className={`btn btn-icon ${outline ? 'active' : ''}`}
        onClick={onOutlineToggle}
        aria-label="切换目录"
        title="切换目录"
      >
        <List size={16} />
        目录
      </button>

      <div className="reader-mode-tabs">
        {MODE_OPTIONS.map(([value, label]) => (
          <button
            key={value}
            className={`mode-tab ${mode === value ? 'active' : ''}`}
            onClick={() => onModeChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="reader-sync-toggle">
        <input
          type="checkbox"
          checked={sync}
          onChange={(e) => onSyncToggle()}
        />
        <span>锚点同步</span>
      </label>

      <div className="reader-mobile-views">
        <button
          className={`btn btn-sm ${mobileSide === 'left' ? 'active' : ''}`}
          onClick={() => onMobileSideChange('left')}
        >
          正文
        </button>
        <button
          className={`btn btn-sm ${mobileSide === 'right' ? 'active' : ''}`}
          onClick={() => onMobileSideChange('right')}
        >
          对照
        </button>
      </div>
    </div>
  );
}
