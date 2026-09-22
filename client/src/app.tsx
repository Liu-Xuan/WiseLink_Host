import React, { lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import Layout from './components/Layout';
import RouteOutletBoundary from './components/RouteOutletBoundary';
import WorkspaceHomePage from './pages/WorkspaceHomePage/WorkspaceHomePage';

// Route chunks load on demand. AppContainer, identity providers and the
// QueryClient stay mounted above the lazy boundary so navigation does not
// rebuild them.
const DialoguePage = lazy(() => import('./pages/DialoguePage'));
const WorkItemOverviewPage = lazy(
  () => import('./features/workitem/WorkItemOverviewPage'),
);
const EngineeringMatterPage = lazy(
  () => import('./features/matter/EngineeringMatterPage'),
);
const MatterProblemAnalysisPage = lazy(
  () => import('./features/matter/MatterProblemAnalysisPage'),
);
const EngineeringSituationPage = lazy(
  () => import('./pages/EngineeringSituationPage/EngineeringSituationPage'),
);
const EngineeringSituationVisualPreviewPage = lazy(
  () =>
    import('./pages/EngineeringSituationPage/EngineeringSituationVisualPreviewPage'),
);
const EngineeringTimelinePage = lazy(
  () => import('./pages/EngineeringTimelinePage/EngineeringTimelinePage'),
);
const DocumentParsingPage = lazy(
  () => import('./pages/DocumentParsingPage/DocumentParsingPage'),
);
const LegacyDocumentWorkbenchRoute = lazy(
  () => import('./pages/DocumentParsingPage/LegacyDocumentWorkbenchRoute'),
);
const DocumentVersionReadingPage = lazy(
  () => import('./pages/DocumentParsingPage/DocumentVersionReadingPage'),
);
const DocumentRevisionReadingPage = lazy(
  () => import('./pages/DocumentParsingPage/DocumentRevisionReadingPage'),
);
const DocumentActivityReadingPage = lazy(
  () => import('./pages/DocumentParsingPage/DocumentActivityReadingPage'),
);
const NotFound = lazy(() => import('./pages/NotFound/NotFound'));
const RuntimeProbePage = lazy(
  () => import('./pages/RuntimeProbePage/RuntimeProbePage'),
);
const ExternalDiscoveryPage = lazy(
  () => import('./pages/ExternalDiscoveryPage/ExternalDiscoveryPage'),
);
const OAuthCallbackPage = lazy(
  () => import('./pages/OAuthCallbackPage/OAuthCallbackPage'),
);
const ModelSettingsPage = lazy(
  () => import('./pages/ModelSettingsPage/ModelSettingsPage'),
);
const RelationGraphPage = lazy(() =>
  import('./pages/RelationGraphPage/RelationGraphPage').then((module) => ({
    default: module.RelationGraphPage,
  })),
);
const KnowledgeLookupPage = lazy(
  () => import('./pages/KnowledgeLookupPage/KnowledgeLookupPage'),
);
const GraphRelationPreviewPage = lazy(
  () => import('./pages/GraphRelationPreviewPage/GraphRelationPreviewPage'),
);
const SuiteGraphVisualPreviewPage = lazy(
  () => import('./pages/GraphRelationPreviewPage/SuiteGraphVisualPreviewPage'),
);
const EngineeringChronologyPreviewPage = lazy(
  () =>
    import('./pages/EngineeringChronologyPreviewPage/EngineeringChronologyPreviewPage'),
);
const ReaderPage = lazy(() => import('./pages/ReaderPage'));
const ReaderWorkspaceVisualPreviewPage = lazy(
  () => import('./pages/DocumentParsingPage/ReaderWorkspaceVisualPreviewPage'),
);
const VersionComparisonPage = lazy(
  () => import('./pages/VersionComparisonPage'),
);
const ReaderPageAdapter = lazy(() => import('./adapters/ReaderPageAdapter'));
const VersionComparisonPageAdapter = lazy(
  () => import('./adapters/VersionComparisonPageAdapter'),
);
const ReactFlowValidationPlayground = lazy(() =>
  import('./playground/ReactFlowValidationPlayground').then((module) => ({
    default: module.ReactFlowValidationPlayground,
  })),
);

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
      <Route
        path="dev-preview/graph-legacy"
        element={
          <RouteOutletBoundary>
            <GraphRelationPreviewPage />
          </RouteOutletBoundary>
        }
      />
      <Route
        path="dev-preview/chronology"
        element={
          <RouteOutletBoundary>
            <EngineeringChronologyPreviewPage />
          </RouteOutletBoundary>
        }
      />
      <Route
        path="dev-preview/reader/:documentId"
        element={
          <RouteOutletBoundary>
            <ReaderPage />
          </RouteOutletBoundary>
        }
      />
      <Route
        path="dev-preview/version-comparison/:documentId"
        element={
          <RouteOutletBoundary>
            <VersionComparisonPage />
          </RouteOutletBoundary>
        }
      />
      <Route
        path="dev-preview/reactflow-validation"
        element={
          <RouteOutletBoundary>
            <ReactFlowValidationPlayground />
          </RouteOutletBoundary>
        }
      />
      <Route element={<Layout />}>
        <Route index element={<LibraryIndexRedirect />} />
        <Route
          path="dev-preview/graph"
          element={<SuiteGraphVisualPreviewPage />}
        />
        <Route
          path="dev-preview/reader-workspace"
          element={<ReaderWorkspaceVisualPreviewPage />}
        />
        <Route
          path="dev-preview/situation"
          element={<EngineeringSituationVisualPreviewPage />}
        />
        <Route path="dialogues" element={<DialoguePage />} />
        <Route path="dialogues/:threadRef" element={<DialoguePage />} />
        <Route path="library" element={<WorkspaceHomePage />} />
        <Route
          path="document-revisions"
          element={<DocumentRevisionReadingPage />}
        />
        <Route
          path="document-versions/:documentVersionId/activities"
          element={<DocumentActivityReadingPage />}
        />
        <Route
          path="document-versions/:documentVersionId"
          element={<DocumentVersionReadingPage />}
        />
        <Route path="matters/:matterId" element={<EngineeringMatterPage />} />
        <Route
          path="matters/:matterId/process"
          element={<MatterProblemAnalysisPage />}
        />
        <Route
          path="matters/:matterId/posture"
          element={<EngineeringSituationPage />}
        />
        <Route
          path="work-items/:workItemId"
          element={<WorkItemOverviewPage />}
        />
        <Route path="runtime-probe" element={<RuntimeProbePage />} />
        <Route path="settings/models" element={<ModelSettingsPage />} />
        <Route path="external-discovery" element={<ExternalDiscoveryPage />} />
        <Route path="situation" element={<EngineeringSituationPage />} />
        <Route path="timeline" element={<EngineeringTimelinePage />} />
        <Route
          path="activity-graph"
          element={<EngineeringTimelinePage view="graph" />}
        />
        <Route path="graph" element={<RelationGraphPage />} />
        <Route path="knowledge" element={<KnowledgeLookupPage />} />
        <Route
          path="work-items/:workItemId/analysis"
          element={<DocumentParsingPage />}
        />
        <Route
          path="work-items/:workItemId/documents"
          element={<LegacyDocumentWorkbenchRoute />}
        />
        {/* Compatibility entries resolve only to existing authorized version readers. */}
        <Route path="reader/:documentId" element={<ReaderPageAdapter />} />
        <Route
          path="version-comparison/:documentId"
          element={<VersionComparisonPageAdapter />}
        />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route
        path="client/oauth/callback"
        element={
          <RouteOutletBoundary>
            <OAuthCallbackPage />
          </RouteOutletBoundary>
        }
      />
      <Route
        path="*"
        element={
          <RouteOutletBoundary>
            <NotFound />
          </RouteOutletBoundary>
        }
      />
    </Routes>
  );
};

export default RoutesComponent;
