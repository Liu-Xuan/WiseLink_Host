import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import {
  CurrentObjectContextProvider,
} from '@client/src/app/providers/CurrentObjectContextProvider';
import { CurrentUserSessionProvider } from '@client/src/app/providers/CurrentUserSessionProvider';
import Sidebar from '@client/src/features/navigation/Sidebar';
import TopBar from '@client/src/features/navigation/TopBar';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';

import './app-shell.css';

const Layout = () => {
  return (
    <CurrentUserSessionProvider>
      <CurrentObjectContextProvider>
        <LayoutChrome />
      </CurrentObjectContextProvider>
    </CurrentUserSessionProvider>
  );
};

function LayoutChrome() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="wiselink-app-shell wl-environment">
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
          mobileNavOpen={mobileNavOpen}
          onToggleMobile={() => setMobileNavOpen((open) => !open)}
        />

        <div className="wiselink-app-body" id="main-content" tabIndex={-1}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default Layout;
