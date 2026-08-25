import React from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import WorkItemOverviewPage from './features/workitem/WorkItemOverviewPage';
import DocumentParsingPage from './pages/DocumentParsingPage/DocumentParsingPage';
import WorkspaceHomePage from './pages/WorkspaceHomePage/WorkspaceHomePage';
import NotFound from './pages/NotFound/NotFound';
import RuntimeProbePage from './pages/RuntimeProbePage/RuntimeProbePage';
import ExternalDiscoveryPage from './pages/ExternalDiscoveryPage/ExternalDiscoveryPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage/OAuthCallbackPage';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<WorkspaceHomePage />} />
        <Route path="library" element={<WorkspaceHomePage />} />
        <Route
          path="work-items/:workItemId"
          element={<WorkItemOverviewPage />}
        />
        <Route path="runtime-probe" element={<RuntimeProbePage />} />
        <Route path="external-discovery" element={<ExternalDiscoveryPage />} />
        <Route
          path="work-items/:workItemId/documents"
          element={<DocumentParsingPage />}
        />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="client/oauth/callback" element={<OAuthCallbackPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
