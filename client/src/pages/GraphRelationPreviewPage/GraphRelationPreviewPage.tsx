import GraphRelationSamplesView from '@client/src/features/review/GraphRelationSamplesView';
import {
  GRAPH_RELATION_SAMPLE_ENTRIES,
  GRAPH_RELATION_SAMPLE_PROJECTION,
} from '@client/src/features/review/graph-samples';

/**
 * DEV/QA harness：T2 图谱联动同组件隔离样例。
 * 生产导航不链接此页；样例数据仅演示交互骨架，不进入生产读取。
 */
export default function GraphRelationPreviewPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">
          图谱联动（隔离样例）
        </h1>
        <p className="text-sm text-muted-foreground">
          条目选择、关联定位、来源打开及返回的交互骨架；关系真实读取合同待主控交付后接真实数据。
        </p>
      </header>
      <GraphRelationSamplesView
        projection={GRAPH_RELATION_SAMPLE_PROJECTION}
        entries={GRAPH_RELATION_SAMPLE_ENTRIES}
      />
    </div>
  );
}
