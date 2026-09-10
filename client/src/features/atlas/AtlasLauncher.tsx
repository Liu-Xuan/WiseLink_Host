import { lazy, Suspense, useState, useRef } from 'react';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import type { AtlasSnapshot } from './atlas-model';
import { Network } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@client/src/components/ui/dialog';
import {
  currentRouteWorkItemId,
  currentRouteMatterId,
} from '@client/src/app/providers/CurrentObjectContextProvider';
const AtlasWorkspace = lazy(() => import('./AtlasWorkspace'));
export default function AtlasLauncher() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { sessionGeneration } = useCurrentUserSession();
  const snapshot = useRef<{ key: string; value: AtlasSnapshot } | null>(null);
  const snapshotKey = JSON.stringify([
    sessionGeneration,
    location.pathname,
    location.search,
  ]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        className="wiselink-header-icon-action"
        aria-label="打开图谱与自动演示"
        title="图谱与自动演示"
        onClick={() => setOpen(true)}
      >
        <Network aria-hidden="true" />
      </button>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (document.querySelector('.atlas-workspace[data-guiding="true"]')) {
            event.preventDefault();
            window.dispatchEvent(new Event('atlas-exit-guide'));
          }
        }}
        className="!h-[98dvh] !w-[99vw] !max-w-none !p-0 !gap-0 overflow-hidden"
      >
        <DialogTitle className="sr-only">图谱与自动演示</DialogTitle>
        <DialogDescription className="sr-only">
          在独立面板阅读真实资料关系或探索明确标记的示例，关闭后回到原页面。
        </DialogDescription>
        <Suspense fallback={<p role="status">正在加载图谱与讲解…</p>}>
          <AtlasWorkspace
            initialSnapshot={
              snapshot.current?.key === snapshotKey
                ? snapshot.current.value
                : undefined
            }
            onSnapshot={(value) => {
              snapshot.current = { key: snapshotKey, value };
            }}
            workItemId={currentRouteWorkItemId(
              location.pathname,
              location.search,
            )}
            matterId={currentRouteMatterId(location.pathname)}
            onClose={() => setOpen(false)}
            onNavigate={(route) => {
              setOpen(false);
              navigate(route);
            }}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
