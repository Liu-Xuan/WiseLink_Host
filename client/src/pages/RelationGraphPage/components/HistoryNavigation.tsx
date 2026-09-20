// HistoryNavigation - Phase 3.6: Browser history navigation controls
import React, { useEffect } from 'react';
import type { GraphHistoryControls } from '../hooks/useGraphHistory';

interface HistoryNavigationProps {
  controls: GraphHistoryControls;
  compact?: boolean;
}

/**
 * History navigation controls component
 *
 * Features:
 * - Back/forward buttons with disabled states
 * - Keyboard shortcuts (Alt+Left, Alt+Right)
 * - Current position indicator
 * - Compact and full display modes
 *
 * @example
 * ```tsx
 * <HistoryNavigation controls={historyControls} compact={true} />
 * ```
 */
export function HistoryNavigation({ controls, compact = false }: HistoryNavigationProps) {
  const { canGoBack, canGoForward, goBack, goForward, currentIndex, historyStack } = controls;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt + Left Arrow = back
      if (e.altKey && e.key === 'ArrowLeft' && canGoBack) {
        e.preventDefault();
        goBack();
      }
      // Alt + Right Arrow = forward
      if (e.altKey && e.key === 'ArrowRight' && canGoForward) {
        e.preventDefault();
        goForward();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canGoBack, canGoForward, goBack, goForward]);

  if (compact) {
    return (
      <div className="history-navigation-compact">
        <button
          className="history-nav-button"
          onClick={goBack}
          disabled={!canGoBack}
          title="后退 (Alt+←)"
          aria-label="后退"
        >
          ←
        </button>
        <button
          className="history-nav-button"
          onClick={goForward}
          disabled={!canGoForward}
          title="前进 (Alt+→)"
          aria-label="前进"
        >
          →
        </button>
        <span className="history-position" aria-label={`位置 ${currentIndex + 1} / ${historyStack.length}`}>
          {currentIndex + 1} / {historyStack.length}
        </span>
      </div>
    );
  }

  return (
    <div className="history-navigation">
      <div className="history-nav-controls">
        <button
          className="history-nav-button history-nav-back"
          onClick={goBack}
          disabled={!canGoBack}
          title="后退 (Alt+←)"
          aria-label="后退"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M10 12L6 8L10 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>后退</span>
        </button>

        <button
          className="history-nav-button history-nav-forward"
          onClick={goForward}
          disabled={!canGoForward}
          title="前进 (Alt+→)"
          aria-label="前进"
        >
          <span>前进</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6 4L10 8L6 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className="history-position-indicator" aria-label={`位置 ${currentIndex + 1} / ${historyStack.length}`}>
          <span className="history-current">{currentIndex + 1}</span>
          <span className="history-separator">/</span>
          <span className="history-total">{historyStack.length}</span>
        </div>
      </div>
    </div>
  );
}
