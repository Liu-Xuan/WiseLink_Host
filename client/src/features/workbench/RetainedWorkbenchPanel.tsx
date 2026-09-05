import {
  createContext,
  memo,
  useContext,
  useState,
  type ReactNode,
} from 'react';

const PanelActiveContext = createContext(true);

export function useWorkbenchPanelActive(): boolean {
  return useContext(PanelActiveContext);
}

interface RetainedWorkbenchPanelProps {
  active: boolean;
  children: ReactNode;
}

// Preserve component state and defer new projection props while hidden. This
// holds only the mounted subtree; no DTO cache, persistence, or preloading.
const PanelContent = memo(
  function PanelContent({ children }: RetainedWorkbenchPanelProps) {
    return <>{children}</>;
  },
  (_previous, next) => !next.active,
);

/** The enclosing WorkbenchShell must be keyed by session and WorkItem. */
export default function RetainedWorkbenchPanel({
  active,
  children,
}: RetainedWorkbenchPanelProps) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  if (!active && !visited) return null;

  return (
    <PanelActiveContext.Provider value={active}>
      <div className="wl-retained-panel" hidden={!active} inert={!active}>
        <PanelContent active={active}>{children}</PanelContent>
      </div>
    </PanelActiveContext.Provider>
  );
}
