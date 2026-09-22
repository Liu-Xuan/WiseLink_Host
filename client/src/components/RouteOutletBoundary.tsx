import React, { Suspense, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import './route-outlet-boundary.css';

interface RouteOutletBoundaryProps {
  children: ReactNode;
  label?: string;
}

/**
 * Keeps a lazy route chunk's wait and failure inside the routed content area.
 * The app shell, identity providers and QueryClient stay mounted above it.
 */
export default function RouteOutletBoundary({
  children,
  label = '页面',
}: RouteOutletBoundaryProps) {
  const location = useLocation();
  return (
    <RouteOutletErrorBoundary routeKey={location.pathname}>
      <Suspense
        fallback={
          <p role="status" className="wl-route-loading">
            正在加载{label}…
          </p>
        }
      >
        {children}
      </Suspense>
    </RouteOutletErrorBoundary>
  );
}

class RouteOutletErrorBoundary extends React.Component<
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
        <h2>页面加载失败</h2>
        <p>
          当前页面的代码未能加载，应用外壳和已读取的资料仍然保留。请手动重新加载页面后重试。
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          重新加载页面
        </button>
      </section>
    );
  }
}
