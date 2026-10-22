import { createElement, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import './wiselink-monitor.js';
import type {
  MonitorView,
  NavigationRequest,
  RuntimeProjection,
  VerificationSnapshot,
  WiseLinkMonitorElement,
} from './monitor-types';

export interface WiseLinkRuntimeMonitorProps {
  runtime: RuntimeProjection | null;
  verification?: VerificationSnapshot | null;
  /** Only changes the selected tab when this prop itself changes. */
  view?: MonitorView;
  /** A display option. Host remains responsible for authorization. */
  allowVerification?: boolean;
  className?: string;
  style?: CSSProperties;
  onRefresh?: (detail: { view: MonitorView }) => void;
  onNavigate?: (detail: NavigationRequest) => void;
}

/**
 * Embed inside the existing authorized workspace.
 * The parent supplies the same read snapshot used by the engineering body.
 * This wrapper performs no fetching, polling, state transition or permission check.
 */
export function WiseLinkRuntimeMonitor({
  runtime,
  verification = null,
  view = 'requests',
  allowVerification = false,
  className,
  style,
  onRefresh,
  onNavigate,
}: WiseLinkRuntimeMonitorProps) {
  const elementRef = useRef<WiseLinkMonitorElement | null>(null);
  const callbacks = useRef({ onRefresh, onNavigate });
  const appliedView = useRef<MonitorView | undefined>(undefined);

  useLayoutEffect(() => {
    callbacks.current = { onRefresh, onNavigate };
  }, [onRefresh, onNavigate]);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const refresh = (event: Event) => {
      callbacks.current.onRefresh?.(
        (event as CustomEvent<{ view: MonitorView }>).detail,
      );
    };
    const navigate = (event: Event) => {
      callbacks.current.onNavigate?.(
        (event as CustomEvent<NavigationRequest>).detail,
      );
    };
    element.addEventListener('wiselink-refresh', refresh);
    element.addEventListener('wiselink-navigate', navigate);
    return () => {
      element.removeEventListener('wiselink-refresh', refresh);
      element.removeEventListener('wiselink-navigate', navigate);
    };
  }, []);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    // Only a changed view prop overrides a tab chosen inside the monitor.
    const viewInput = appliedView.current !== view ? { view } : {};
    appliedView.current = view;
    element.updateInputs({ runtime, verification, allowVerification, allowRefresh: Boolean(onRefresh), ...viewInput });
  }, [runtime, verification, allowVerification, onRefresh, view]);

  return createElement('wiselink-monitor', {
    ref: elementRef,
    className,
    style: { display: 'block', minWidth: 0, ...style },
  });
}
