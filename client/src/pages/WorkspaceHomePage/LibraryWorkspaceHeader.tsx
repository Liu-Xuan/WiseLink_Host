import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ChecklistManager from '@client/src/features/checklist/ChecklistManager';
import { LibrarySourceNavigation } from './LibrarySourceNavigation';
import type { LibraryViewMode } from './library-view-mode';

/** Route-owned controls share the shell's one pagebar, including immersive mode. */
export function LibraryWorkspaceHeader({ mode, onModeChange, children }: {
  mode: LibraryViewMode;
  onModeChange: (mode: LibraryViewMode) => void;
  children: ReactNode;
}) {
  const [slots, setSlots] = useState<{ navigation: HTMLElement; actions: HTMLElement } | null>(null);
  useLayoutEffect(() => {
    const navigation = document.getElementById('library-workspace-navigation');
    const actions = document.getElementById('library-workspace-actions');
    if (navigation && actions) setSlots({ navigation, actions });
  }, []);
  const navigation = <LibrarySourceNavigation current={mode} onModeChange={onModeChange} />;
  const actions = <div className="flex items-center gap-2"><ChecklistManager /><details className="suite-library-actions">
      <summary>接收资料</summary>
      <div className="suite-library-actions-panel">{children}</div>
    </details></div>;
  if (slots) return <>{createPortal(navigation, slots.navigation)}{createPortal(actions, slots.actions)}</>;
  return <header className="library-home-header library-workspace-header">
    {navigation}{actions}
  </header>;
}
