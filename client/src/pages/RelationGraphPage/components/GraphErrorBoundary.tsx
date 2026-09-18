import React, { Component, ReactNode } from 'react';

interface GraphErrorBoundaryProps {
  children: ReactNode;
}

interface GraphErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * GraphErrorBoundary - Error boundary for graph visualization
 * Catches and displays errors that occur during graph rendering
 */
export class GraphErrorBoundary extends Component<GraphErrorBoundaryProps, GraphErrorBoundaryState> {
  constructor(props: GraphErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): GraphErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Graph rendering error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-state">
          <h2>图谱加载失败</h2>
          <p>
            {this.state.error?.message || '图谱渲染时发生错误，请刷新页面重试'}
          </p>
          <button onClick={this.handleReload}>重新加载</button>
        </div>
      );
    }

    return this.props.children;
  }
}
