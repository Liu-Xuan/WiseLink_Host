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
    <div className="suite-graph-preview-shell">
      <p className="suite-graph-preview-note">
        隔离视觉样例：仅用于与 Suite 静态页面同条件对照；不读取生产数据，也不代表工程结论或线上验收。
      </p>
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
