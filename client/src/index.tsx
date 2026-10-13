import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';

import { AppContainer } from '@lark-apaas/client-toolkit/components/AppContainer';
import { ErrorRender } from '@lark-apaas/client-toolkit/components/ErrorRender';

import RoutesComponent from './app.tsx';
import './index.css';
import { createPortal } from 'react-dom';
import { Toaster } from '@client/src/components/ui/sonner';
import { WlThemeProvider } from '@client/src/app/providers/ThemeProvider';
import { WISELINK_PAGE_TITLE } from '@client/src/config/wiselink-brand';

const CLIENT_BASE_PATH = process.env.CLIENT_BASE_PATH || '/';

const MainApp = () => {
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
