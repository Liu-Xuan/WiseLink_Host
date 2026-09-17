import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type WlTheme = 'light' | 'dark';
export type WlVisualMode = 'default' | 'ultra' | 'compatible';

const THEME_STORAGE_KEY = 'wiselink.ui.theme';
const TRANSPARENCY_STORAGE_KEY = 'wiselink.ui.reduce-transparency';
const VISUAL_MODE_STORAGE_KEY = 'wiselink.ui.visual-mode';
const MOTION_STORAGE_KEY = 'wiselink.ui.motion';

interface WlThemeContextValue {
  theme: WlTheme;
  visualMode: WlVisualMode;
  reduceTransparency: boolean;
  motionEnabled: boolean;
  motionPausedByUser: boolean;
  systemReducedMotion: boolean;
  documentHidden: boolean;
  setVisualMode: (mode: WlVisualMode) => void;
  toggleTheme: () => void;
  toggleTransparency: () => void;
  toggleMotion: () => void;
}

const WlThemeContext = createContext<WlThemeContextValue | null>(null);

function readInitialTheme(): WlTheme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage 不可用时回退浅色 */
  }
  return 'light';
}

function readInitialTransparency(): boolean {
  try {
    const stored = window.localStorage.getItem(TRANSPARENCY_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-transparency: reduce)').matches
    );
  } catch {
    return false;
  }
}

function readInitialVisualMode(): WlVisualMode {
  try {
    const stored = window.localStorage.getItem(VISUAL_MODE_STORAGE_KEY);
    if (stored === 'default' || stored === 'ultra' || stored === 'compatible') {
      return stored;
    }
  } catch {
    /* localStorage 不可用时回退正式生产基线 */
  }
  return 'default';
}

function readInitialMotionPreference(): boolean | null {
  try {
    const stored = window.localStorage.getItem(MOTION_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

export function WlThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<WlTheme>(readInitialTheme);
  const [visualMode, setVisualMode] = useState<WlVisualMode>(
    readInitialVisualMode,
  );
  const [reduceTransparency, setReduceTransparency] = useState(
    readInitialTransparency,
  );
  const [motionPreference, setMotionPreference] = useState<boolean | null>(
    readInitialMotionPreference,
  );
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [documentHidden, setDocumentHidden] = useState(() => document.hidden);

  useEffect(() => {
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const onPreferenceChange = (event: MediaQueryListEvent) =>
      setSystemReducedMotion(event.matches);
    const onVisibilityChange = () => setDocumentHidden(document.hidden);
    media?.addEventListener?.('change', onPreferenceChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      media?.removeEventListener?.('change', onPreferenceChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const motionEnabled =
    !systemReducedMotion && !documentHidden && motionPreference !== false;
  const motionPausedByUser = motionPreference === false;

  useLayoutEffect(() => {
    document.documentElement.dataset.wlTheme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* 仅偏好持久化失败，不影响当前会话 */
    }
  }, [theme]);

  useLayoutEffect(() => {
    document.documentElement.dataset.wlVisualMode = visualMode;
    document.documentElement.dataset.effects = visualMode;
    try {
      window.localStorage.setItem(VISUAL_MODE_STORAGE_KEY, visualMode);
    } catch {
      /* 仅视觉偏好持久化失败，不影响当前会话 */
    }
  }, [visualMode]);

  useLayoutEffect(() => {
    document.documentElement.dataset.wlTransparency = reduceTransparency
      ? 'reduced'
      : 'full';
    try {
      window.localStorage.setItem(
        TRANSPARENCY_STORAGE_KEY,
        String(reduceTransparency),
      );
    } catch {
      /* 仅视觉偏好持久化失败，不影响当前会话 */
    }
  }, [reduceTransparency]);

  useLayoutEffect(() => {
    document.documentElement.dataset.wlMotion = motionEnabled ? 'on' : 'off';
    try {
      if (motionPreference === null) {
        window.localStorage.removeItem(MOTION_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          MOTION_STORAGE_KEY,
          String(motionPreference),
        );
      }
    } catch {
      /* 仅视觉偏好持久化失败，不影响当前会话 */
    }
  }, [motionEnabled, motionPreference]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const toggleTransparency = useCallback(() => {
    setReduceTransparency((current) => !current);
  }, []);

  const toggleMotion = useCallback(() => {
    setMotionPreference((current) => (current !== false ? false : true));
  }, []);

  const value = useMemo(
    () => ({
      theme,
      visualMode,
      reduceTransparency,
      motionEnabled,
      motionPausedByUser,
      systemReducedMotion,
      documentHidden,
      setVisualMode,
      toggleTheme,
      toggleTransparency,
      toggleMotion,
    }),
    [
      documentHidden,
      motionEnabled,
      motionPausedByUser,
      reduceTransparency,
      theme,
      systemReducedMotion,
      toggleMotion,
      toggleTheme,
      toggleTransparency,
      visualMode,
    ],
  );

  return (
    <WlThemeContext.Provider value={value}>{children}</WlThemeContext.Provider>
  );
}

export function useWlTheme(): WlThemeContextValue {
  const context = useContext(WlThemeContext);
  if (!context) {
    throw new Error('useWlTheme 必须在 WlThemeProvider 内使用');
  }
  return context;
}
