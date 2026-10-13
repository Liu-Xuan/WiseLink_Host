import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';

import { AppContainer } from '@lark-apaas/client-toolkit/components/AppContainer';
import { ErrorRender } from '@lark-apaas/client-toolkit/components/ErrorRender';
import { useAppInfo } from '@lark-apaas/client-toolkit/hooks/useAppInfo';

import RoutesComponent from './app.tsx';
import './index.css';
import { createPortal } from 'react-dom';
import { Toaster } from '@client/src/components/ui/sonner';
import { WlThemeProvider } from '@client/src/app/providers/ThemeProvider';
import { WISELINK_PAGE_TITLE } from '@client/src/config/wiselink-brand';

const CLIENT_BASE_PATH = process.env.CLIENT_BASE_PATH || '/';

const MainApp = () => {
  const appInfo = useAppInfo();

  // AppContainer applies published metadata after the initial bootstrap.
  // Rebind on every metadata update, including repeats of the same app name.
  useEffect(() => {
    document.title = WISELINK_PAGE_TITLE;
  }, [appInfo]);

  return (
    <BrowserRouter basename={CLIENT_BASE_PATH}>
      <AppContainer defaultTheme="light">
        <ErrorBoundary
          fallbackRender={({ error, resetErrorBoundary }) => (
            <ErrorRender
              error={error as Error}
              resetErrorBoundary={resetErrorBoundary}
            />
          )}
        >
          <WlThemeProvider>
            <RoutesComponent />
            {createPortal(<Toaster />, document.body)}
          </WlThemeProvider>
        </ErrorBoundary>
      </AppContainer>
    </BrowserRouter>
  );
};

document.title = WISELINK_PAGE_TITLE;
createRoot(document.getElementById('root')!).render(<MainApp />);
