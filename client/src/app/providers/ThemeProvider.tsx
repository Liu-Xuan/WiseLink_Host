import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type WlTheme = 'light' | 'dark';
export type WlVisualMode = 'default' | 'ultra' | 'compatible';

const THEME_STORAGE_KEY = 'wiselink.ui.theme';
const TRANSPARENCY_STORAGE_KEY = 'wiselink.ui.reduce-transparency';
const VISUAL_MODE_STORAGE_KEY = 'wiselink.ui.visual-mode';

interface WlThemeContextValue {
  theme: WlTheme;
  visualMode: WlVisualMode;
  reduceTransparency: boolean;
  setVisualMode: (mode: WlVisualMode) => void;
  toggleTheme: () => void;
  toggleTransparency: () => void;
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

export function WlThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<WlTheme>(readInitialTheme);
  const [visualMode, setVisualMode] = useState<WlVisualMode>(
    readInitialVisualMode,
  );
  const [reduceTransparency, setReduceTransparency] = useState(
    readInitialTransparency,
  );

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

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const toggleTransparency = useCallback(() => {
    setReduceTransparency((current) => !current);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      visualMode,
      reduceTransparency,
      setVisualMode,
      toggleTheme,
      toggleTransparency,
    }),
    [reduceTransparency, theme, toggleTheme, toggleTransparency, visualMode],
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
