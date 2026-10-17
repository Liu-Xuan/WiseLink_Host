// Production components; localhost-only synthetic responses, never real business execution.
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from '../../../client/src/components/Layout';
import WikiGuideHomePage from '../../../client/src/pages/WikiGuideHomePage';
import DerivedSummaryReadingPage from '../../../client/src/features/derived-summary/DerivedSummaryReadingPage';
import KnowledgeLookupPage from '../../../client/src/pages/KnowledgeLookupPage/KnowledgeLookupPage';
import { WlThemeProvider } from '../../../client/src/app/providers/ThemeProvider';
import './theme.css';
import './metrics';
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><WlThemeProvider>
  <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes><Route element={<Layout />}>
    <Route path="/situation" element={<WikiGuideHomePage />} />
    <Route path="/summaries/:summaryId" element={<DerivedSummaryReadingPage />} />
    <Route path="/knowledge" element={<KnowledgeLookupPage />} />
  </Route></Routes></BrowserRouter></WlThemeProvider></QueryClientProvider>);
