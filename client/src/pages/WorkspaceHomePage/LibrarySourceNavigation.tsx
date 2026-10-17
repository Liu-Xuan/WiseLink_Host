import type { LibraryViewMode } from './library-view-mode';

export function LibrarySourceNavigation({ current, onModeChange }: {
  current: LibraryViewMode;
  onModeChange: (mode: LibraryViewMode) => void;
}) {
  return <nav className="library-source-navigation" aria-label="资料库视图">
    <button type="button" aria-pressed={current === 'document'}
      onClick={() => onModeChange('document')}>工程文档</button>
    <button type="button" aria-pressed={current === 'matter'}
      onClick={() => onModeChange('matter')}>工程事项</button>
  </nav>;
}
