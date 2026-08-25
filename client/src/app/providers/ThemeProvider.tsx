import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type WlTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'wiselink.ui.theme';

interface WlThemeContextValue {
  theme: WlTheme;
  toggleTheme: () => void;
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

export function WlThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<WlTheme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.wlTheme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* 仅偏好持久化失败，不影响当前会话 */
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

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
