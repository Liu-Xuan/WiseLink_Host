import { Component, useEffect, useState, type ReactNode } from 'react';
import type { TdmsSourceRelationGraphProps } from './TdmsSourceRelationGraph';
import { loadTdmsSourceRelationGraph } from './tdms-relation-graph-loader';

type GraphModule = Awaited<ReturnType<typeof loadTdmsSourceRelationGraph>>;

class GraphRenderBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <GraphUnavailable onRetry={this.props.onRetry} />
    ) : (
      this.props.children
    );
  }
}

function GraphUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <p role="alert">
      关系图谱显示未完成；未切换来源或版本。{' '}
      <button type="button" onClick={onRetry}>
        重试显示此关系图谱
      </button>
    </p>
  );
}

/** Mounted only with a current authorized relation read; no extra opening action. */
export default function DeferredTdmsSourceRelationGraph(
  { enabled = false, ...props }: TdmsSourceRelationGraphProps & { enabled?: boolean },
) {
  const [module, setModule] = useState<GraphModule | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    setFailed(false);
    void loadTdmsSourceRelationGraph()
      .then((value) => {
        if (mounted) setModule(value);
      })
      .catch(() => {
        if (mounted) setFailed(true);
      });
    return () => {
      mounted = false;
    };
  }, [attempt, enabled]);
  const retry = () => {
    setFailed(false);
    setAttempt((value) => value + 1);
  };
  if (!enabled) return null;
  if (failed) return <GraphUnavailable onRetry={retry} />;
  if (!module) return <p role="status">正在显示此准确来源的关系图谱…</p>;
  const Graph = module.default;
  return (
    <GraphRenderBoundary key={attempt} onRetry={retry}>
      <Graph {...props} />
    </GraphRenderBoundary>
  );
}
