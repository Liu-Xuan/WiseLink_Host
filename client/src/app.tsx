import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import DialoguePage from './pages/DialoguePage';
import Layout from './components/Layout';
import WorkItemOverviewPage from './features/workitem/WorkItemOverviewPage';
import EngineeringMatterPage from './features/matter/EngineeringMatterPage';
import EngineeringSituationPage from './pages/EngineeringSituationPage/EngineeringSituationPage';
import EngineeringTimelinePage from './pages/EngineeringTimelinePage/EngineeringTimelinePage';
import DocumentParsingPage from './pages/DocumentParsingPage/DocumentParsingPage';
import DocumentVersionReadingPage from './pages/DocumentParsingPage/DocumentVersionReadingPage';
import DocumentRevisionReadingPage from './pages/DocumentParsingPage/DocumentRevisionReadingPage';
import DocumentActivityReadingPage from './pages/DocumentParsingPage/DocumentActivityReadingPage';
import WorkspaceHomePage from './pages/WorkspaceHomePage/WorkspaceHomePage';
import NotFound from './pages/NotFound/NotFound';
import RuntimeProbePage from './pages/RuntimeProbePage/RuntimeProbePage';
import ExternalDiscoveryPage from './pages/ExternalDiscoveryPage/ExternalDiscoveryPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage/OAuthCallbackPage';
import ModelSettingsPage from './pages/ModelSettingsPage/ModelSettingsPage';
import RelationGraphPage from './pages/RelationGraphPage/RelationGraphPage';
import KnowledgeLookupPage from './pages/KnowledgeLookupPage/KnowledgeLookupPage';

import GraphRelationPreviewPage from './pages/GraphRelationPreviewPage/GraphRelationPreviewPage';
import EngineeringChronologyPreviewPage from './pages/EngineeringChronologyPreviewPage/EngineeringChronologyPreviewPage';

const LibraryIndexRedirect = () => {
  const location = useLocation();

  return (
    <Navigate
      replace
      to={{
        pathname: '/library',
        search: location.search,
        hash: location.hash,
      }}
    />
  );
};

const RoutesComponent = () => {
  return (
    <Routes>
      <Route path="dev-preview/graph" element={<GraphRelationPreviewPage />} />
      <Route path="dev-preview/chronology" element={<EngineeringChronologyPreviewPage />} />
      <Route element={<Layout />}>
        <Route index element={<LibraryIndexRedirect />} />
        <Route path="dialogues" element={<DialoguePage />} />
        <Route path="dialogues/:threadRef" element={<DialoguePage />} />
        <Route path="library" element={<WorkspaceHomePage />} />
        <Route path="document-revisions" element={<DocumentRevisionReadingPage />} />
        <Route path="document-versions/:documentVersionId/activities" element={<DocumentActivityReadingPage />} />
        <Route path="document-versions/:documentVersionId" element={<DocumentVersionReadingPage />} />
        <Route path="matters/:matterId" element={<EngineeringMatterPage />} />
        <Route path="matters/:matterId/posture" element={<EngineeringSituationPage />} />
        <Route
          path="work-items/:workItemId"
          element={<WorkItemOverviewPage />}
        />
        <Route path="runtime-probe" element={<RuntimeProbePage />} />
        <Route path="settings/models" element={<ModelSettingsPage />} />
        <Route path="external-discovery" element={<ExternalDiscoveryPage />} />
        <Route path="situation" element={<EngineeringSituationPage />} />
        <Route path="timeline" element={<EngineeringTimelinePage />} />
        <Route path="activity-graph" element={<EngineeringTimelinePage view="graph" />} />
        <Route path="graph" element={<RelationGraphPage />} />
        <Route path="knowledge" element={<KnowledgeLookupPage />} />
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
