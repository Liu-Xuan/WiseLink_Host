import React, { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import Layout from './components/Layout';
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

class RouteChunkBoundary extends React.Component<
  { children: ReactNode; routeKey: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(previous: { routeKey: string }): void {
    if (previous.routeKey !== this.props.routeKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <section role="alert" className="wl-route-load-error">
        <h1>页面加载失败</h1>
        <p>当前页面代码未能加载，已有内容未受影响。</p>
        <button type="button" onClick={() => window.location.reload()}>
          重新加载页面
        </button>
      </section>
    );
  }
}

function RouteLoadingFallback() {
  return (
    <p role="status" className="wl-route-loading">
      正在加载页面…
    </p>
  );
}

const RoutesComponent = () => {
  const location = useLocation();
  return (
    <RouteChunkBoundary routeKey={location.pathname}>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route
            path="dev-preview/graph-legacy"
            element={<GraphRelationPreviewPage />}
          />
          <Route
            path="dev-preview/chronology"
            element={<EngineeringChronologyPreviewPage />}
          />
          <Route
            path="dev-preview/reader/:documentId"
            element={<ReaderPage />}
          />
          <Route
            path="dev-preview/version-comparison/:documentId"
            element={<VersionComparisonPage />}
          />
          <Route
            path="dev-preview/reactflow-validation"
            element={<ReactFlowValidationPlayground />}
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
            <Route
              path="matters/:matterId"
              element={<EngineeringMatterPage />}
            />
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
            <Route
              path="external-discovery"
              element={<ExternalDiscoveryPage />}
            />
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
          <Route path="client/oauth/callback" element={<OAuthCallbackPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </RouteChunkBoundary>
  );
};

export default RoutesComponent;
