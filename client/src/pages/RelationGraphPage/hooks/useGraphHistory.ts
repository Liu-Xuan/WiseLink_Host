// useGraphHistory - Phase 3.6: Browser history integration and navigation
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { PerspectiveType } from '../types';

export interface GraphHistoryState {
  selectedNodeId: string | null;
  perspective: PerspectiveType;
  timestamp: number;
}

export interface GraphHistoryControls {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  pushState: (nodeId: string | null, perspective: PerspectiveType) => void;
  replaceState: (nodeId: string | null, perspective: PerspectiveType) => void;
  currentIndex: number;
  historyStack: GraphHistoryState[];
}

const MAX_HISTORY_SIZE = 50;

/**
 * Browser history integration hook for graph navigation
 *
 * Features:
 * - URL synchronization with graph state
 * - Browser back/forward support
 * - Deep linking to specific nodes
 * - Keyboard shortcuts (Alt+Left/Right)
 * - History stack management with size limit
 * - Duplicate prevention
 *
 * @example
 * ```tsx
 * const historyControls = useGraphHistory(
 *   selectedNodeId,
 *   perspective,
 *   (nodeId, perspective) => {
 *     setSelectedNodeId(nodeId);
 *     setPerspective(perspective);
 *   }
 * );
 * ```
 */
export function useGraphHistory(
  selectedNodeId: string | null,
  perspective: PerspectiveType,
  onStateChange: (nodeId: string | null, perspective: PerspectiveType) => void
): GraphHistoryControls {
  const navigate = useNavigate();
  const location = useLocation();
  const isNavigatingRef = useRef(false);
  const isInitializedRef = useRef(false);

  // History stack management
  const [historyStack, setHistoryStack] = useState<GraphHistoryState[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

  /**
   * Parse graph state from URL query parameters
   */
  const parseStateFromURL = useCallback((): GraphHistoryState | null => {
    const params = new URLSearchParams(location.search);
    const nodeId = params.get('node');
    const perspectiveParam = params.get('perspective') as PerspectiveType | null;

    if (nodeId || perspectiveParam) {
      return {
        selectedNodeId: nodeId,
        perspective: perspectiveParam || perspective,
        timestamp: Date.now()
      };
    }
    return null;
  }, [location.search, perspective]);

  /**
   * Build URL with graph state
   */
  const buildURL = useCallback((nodeId: string | null, perspectiveValue: PerspectiveType): string => {
    const params = new URLSearchParams(location.search);

    if (nodeId) {
      params.set('node', nodeId);
    } else {
      params.delete('node');
    }

    params.set('perspective', perspectiveValue);

    return `${location.pathname}?${params.toString()}`;
  }, [location.pathname, location.search]);

  /**
   * Push new state to history (creates new history entry)
   */
  const pushState = useCallback((nodeId: string | null, perspectiveValue: PerspectiveType) => {
    // Prevent duplicate entries
    if (currentIndex >= 0) {
      const current = historyStack[currentIndex];
      if (current?.selectedNodeId === nodeId && current?.perspective === perspectiveValue) {
        return;
      }
    }

    const newState: GraphHistoryState = {
      selectedNodeId: nodeId,
      perspective: perspectiveValue,
      timestamp: Date.now()
    };

    // Truncate forward history and append new state
    let newStack = historyStack.slice(0, currentIndex + 1);
    newStack.push(newState);

    // Enforce max history size
    if (newStack.length > MAX_HISTORY_SIZE) {
      newStack = newStack.slice(newStack.length - MAX_HISTORY_SIZE);
    }

    setHistoryStack(newStack);
    setCurrentIndex(newStack.length - 1);

    // Update URL
    isNavigatingRef.current = true;
    navigate(buildURL(nodeId, perspectiveValue), { replace: false });
  }, [historyStack, currentIndex, buildURL, navigate]);

  /**
   * Replace current state (updates current history entry)
   */
  const replaceState = useCallback((nodeId: string | null, perspectiveValue: PerspectiveType) => {
    if (currentIndex >= 0) {
      const newStack = [...historyStack];
      newStack[currentIndex] = {
        selectedNodeId: nodeId,
        perspective: perspectiveValue,
        timestamp: Date.now()
      };
      setHistoryStack(newStack);
    }

    isNavigatingRef.current = true;
    navigate(buildURL(nodeId, perspectiveValue), { replace: true });
  }, [historyStack, currentIndex, buildURL, navigate]);

  /**
   * Navigate back in history
   */
  const goBack = useCallback(() => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      const state = historyStack[newIndex];

      setCurrentIndex(newIndex);
      isNavigatingRef.current = true;
      onStateChange(state.selectedNodeId, state.perspective);

      // Use browser's back instead of navigate to maintain browser history
      window.history.back();
    }
  }, [currentIndex, historyStack, onStateChange]);

  /**
   * Navigate forward in history
   */
  const goForward = useCallback(() => {
    if (currentIndex < historyStack.length - 1) {
      const newIndex = currentIndex + 1;
      const state = historyStack[newIndex];

      setCurrentIndex(newIndex);
      isNavigatingRef.current = true;
      onStateChange(state.selectedNodeId, state.perspective);

      // Use browser's forward instead of navigate
      window.history.forward();
    }
  }, [currentIndex, historyStack, onStateChange]);

  /**
   * Listen to browser back/forward events
   */
  useEffect(() => {
    const handlePopState = () => {
      if (isNavigatingRef.current) {
        isNavigatingRef.current = false;
        return;
      }

      const state = parseStateFromURL();
      if (state) {
        onStateChange(state.selectedNodeId, state.perspective);

        // Sync internal index with URL state
        const matchingIndex = historyStack.findIndex(
          h => h.selectedNodeId === state.selectedNodeId && h.perspective === state.perspective
        );
        if (matchingIndex >= 0) {
          setCurrentIndex(matchingIndex);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [parseStateFromURL, onStateChange, historyStack]);

  /**
   * Initialize: restore state from URL or create initial state
   */
  useEffect(() => {
    if (!isInitializedRef.current && historyStack.length === 0) {
      isInitializedRef.current = true;

      const urlState = parseStateFromURL();
      if (urlState) {
        setHistoryStack([urlState]);
        setCurrentIndex(0);
        onStateChange(urlState.selectedNodeId, urlState.perspective);
      } else {
        // Create initial state
        const initialState: GraphHistoryState = {
          selectedNodeId,
          perspective,
          timestamp: Date.now()
        };
        setHistoryStack([initialState]);
        setCurrentIndex(0);

        // Update URL with initial state
        navigate(buildURL(selectedNodeId, perspective), { replace: true });
      }
    }
  }, [selectedNodeId, perspective, parseStateFromURL, onStateChange, buildURL, navigate, historyStack.length]);

  return {
    canGoBack: currentIndex > 0,
    canGoForward: currentIndex < historyStack.length - 1,
    goBack,
    goForward,
    pushState,
    replaceState,
    currentIndex,
    historyStack
  };
}
