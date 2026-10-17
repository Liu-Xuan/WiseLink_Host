// Actual mounted Layout, page, hooks and API clients; only platform transports use local fixtures.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from '../../../client/src/components/Layout';
import WorkspaceHomePage from '../../../client/src/pages/WorkspaceHomePage/WorkspaceHomePage';
import { WlThemeProvider } from '../../../client/src/app/providers/ThemeProvider';
import { invalidateCanonicalHostClientSession } from '../../../client/src/api/canonical-host';
import './theme.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
Object.assign(window, { libraryFixtureSessionChange: invalidateCanonicalHostClientSession });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}>
  <WlThemeProvider><BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Routes><Route element={<Layout />}><Route path="/library" element={<WorkspaceHomePage />} /></Route></Routes>
  </BrowserRouter></WlThemeProvider>
</QueryClientProvider>);
