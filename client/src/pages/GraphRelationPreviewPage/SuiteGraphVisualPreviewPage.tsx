import { useState } from 'react';

import SuiteMatterGraphView, {
  type SuiteMatterGraphPerspective,
} from '@client/src/pages/RelationGraphPage/SuiteMatterGraphView';
import {
  SUITE_GRAPH_VISUAL_READS,
  SUITE_GRAPH_VISUAL_REVISION,
  SUITE_GRAPH_VISUAL_TIMELINE,
} from './suite-graph-visual-fixture';

/**
 * Visual-only fixture for screenshot comparison. It renders the production Suite
 * graph component without identity discovery, API reads, writes or production links.
 */
export default function SuiteGraphVisualPreviewPage() {
  const [perspective, setPerspective] =
    useState<SuiteMatterGraphPerspective>('matter');
  return (
    <div className="suite-graph-preview-shell" data-preview="isolated-graph-fixture">
      <SuiteMatterGraphView
        read={SUITE_GRAPH_VISUAL_READS[perspective]}
        revision={SUITE_GRAPH_VISUAL_REVISION}
        perspective={perspective}
        onPerspectiveChange={setPerspective}
        availablePerspectives={['matter', 'documents', 'domain', 'panorama']}
        timelineEvents={SUITE_GRAPH_VISUAL_TIMELINE}
      />
    </div>
  );
}
