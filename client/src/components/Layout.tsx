import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation } from 'react-router-dom';

import { CurrentObjectContextProvider } from '@client/src/app/providers/CurrentObjectContextProvider';
import { CurrentUserSessionProvider } from '@client/src/app/providers/CurrentUserSessionProvider';
import { subscribeCanonicalHostClientSession } from '@client/src/api/canonical-host';
import { clearEngineeringMatterQueries } from '@client/src/features/matter/useEngineeringMatter';
import Sidebar from '@client/src/features/navigation/Sidebar';
import TopBar from '@client/src/features/navigation/TopBar';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';

import './app-shell.css';

const Layout = () => {
  return (
    <CurrentUserSessionProvider>
      <MatterQuerySessionBoundary>
        <CurrentObjectContextProvider>
          <LayoutChrome />
        </CurrentObjectContextProvider>
      </MatterQuerySessionBoundary>
    </CurrentUserSessionProvider>
  );
};

function MatterQuerySessionBoundary({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      subscribeCanonicalHostClientSession(() => {
        void clearEngineeringMatterQueries(queryClient);
      }),
    [queryClient],
  );
  return children;
}

function LayoutChrome() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [immersive, setImmersive] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
        setImmersive(false);
        return;
      }
      if (
        event.key === '/' &&
        target &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) &&
        !target.isContentEditable
      ) {
        event.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className={`wiselink-app-shell wl-environment${immersive ? ' is-immersive' : ''}`}
      data-motion-state={immersive ? 'immersive' : 'normal'}
    >
      <UniversalLink to="#main-content" className="wiselink-skip-link">
        跳转到主内容
      </UniversalLink>

      <Sidebar
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <div className="wiselink-app-main">
        <TopBar
          pathname={location.pathname}
          search={location.search}
          mobileNavOpen={mobileNavOpen}
          onToggleMobile={() => setMobileNavOpen((open) => !open)}
          immersive={immersive}
          onToggleImmersive={() => setImmersive((open) => !open)}
        />

        <div
          className="wiselink-app-body"
          id="main-content"
          data-reading-scroll-container
          tabIndex={-1}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default Layout;
