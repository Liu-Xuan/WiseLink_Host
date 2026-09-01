import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Contrast,
  Focus,
  Maximize2,
  MoreHorizontal,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
} from 'lucide-react';

import { useWlTheme } from '@client/src/app/providers/ThemeProvider';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@client/src/components/ui/dropdown-menu';
import QuickOpen, {
  type QuickOpenItem,
} from '@client/src/features/workbench/QuickOpen';
import {
  resolveWorkbenchAdaptiveLayout,
  resolveWorkbenchContentLayout,
  resolveWorkbenchEvidenceVisibility,
  resolveWorkbenchMainInlineMinimum,
} from '@client/src/features/workbench/workbench-layout';

import './workbench-shell.css';

export interface WorkbenchTab {
  key: string;
  label: string;
  icon?: ReactNode;
  /** 窄屏（§10.1 390×844）底部标签文案；未提供的 tab 收入「更多」 */
  mobileLabel?: string;
  /** 窄屏底部标签顺序，与桌面专业工作流顺序可独立。 */
  mobileOrder?: number;
}

export interface WorkbenchShellProps {
  /** 左侧导航树 */
  navigator?: ReactNode;
  /** 专注模式与窄屏工具栏使用的用户可读资料上下文。 */
  contextLabel?: string;
  /** 右侧证据面板 */
  evidencePanel?: ReactNode;
  /** 当前证据面板实际可呈现的内容单元与来源引用总数。 */
  evidenceContentCount?: number;
  /** 当前证据工作流是否带有 active SourceRef；内联 PDF 定位不计入。 */
  evidenceActive?: boolean;
  /** 主内容中点击证据引用时递增；面板自动展开（§4.2 折叠策略） */
  evidenceSignal?: number;
  tabs: WorkbenchTab[];
  activeTab: string;
  /** 普通页面由主栏滚动；Reader/package 工作区把滚动交给各自内容窗格。 */
  contentMode?: 'flow' | 'workspace';
  /** 窄屏四项底栏的语义归组；例如解析结果归入「原文」。 */
  mobileActiveTab?: string;
  /** Quick Open 只接入当前 Host 已返回、当前用户可读取的真实对象。 */
  quickOpenItems?: QuickOpenItem[];
  onTabChange: (key: string) => void;
  children: ReactNode;
}

const NAV_MIN = 232;
const NAV_MAX = 440;
const NAV_DEFAULT = 304;
/** Spec R01 §4.2：右侧证据栏 280–360px */
const EVIDENCE_MIN = 280;
const EVIDENCE_MAX = 360;
const EVIDENCE_DEFAULT = 320;
/** Spec R01 §4.2：仅保存布局偏好，不保存 WorkItem/current（禁止平行真源） */
const LAYOUT_PREFS_KEY = 'wiselink.layout.workbench';

interface WorkbenchLayoutPrefs {
  treeWidth: number;
  evidenceWidth: number;
  evidenceOpen: boolean;
  navCollapsed: boolean;
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function defaultEvidenceOpen(): boolean {
  return typeof window === 'undefined' || window.innerWidth > 1360;
}

function defaultCompactViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 720px)').matches
  );
}

function readLayoutPrefs(): Partial<WorkbenchLayoutPrefs> {
  try {
    const raw = window.localStorage.getItem(LAYOUT_PREFS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    return {
      treeWidth: clampNumber(record.treeWidth, NAV_MIN, NAV_MAX, NAV_DEFAULT),
      evidenceWidth: clampNumber(
        record.evidenceWidth,
        EVIDENCE_MIN,
        EVIDENCE_MAX,
        EVIDENCE_DEFAULT,
      ),
      evidenceOpen:
        typeof record.evidenceOpen === 'boolean'
          ? record.evidenceOpen
          : defaultEvidenceOpen(),
      navCollapsed:
        typeof record.navCollapsed === 'boolean' ? record.navCollapsed : false,
    };
  } catch {
    return {};
  }
}

function writeLayoutPrefs(prefs: WorkbenchLayoutPrefs): void {
  try {
    window.localStorage.setItem(LAYOUT_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* localStorage 不可用（隐私模式/配额）时静默降级为不记忆 */
  }
}

/**
 * 全屏工作台外壳（Spec R01 §4.2）。
 * 三栏结构：左目录树 · 中内容标签页 · 右证据面板；
 * 分栏可拖拽调整；支持沉浸模式与原生全屏。
 */
export default function WorkbenchShell({
  navigator,
  contextLabel = '当前工程资料',
  evidencePanel,
  evidenceContentCount = 0,
  evidenceActive = false,
  evidenceSignal = 0,
  tabs,
  activeTab,
  contentMode = 'flow',
  mobileActiveTab,
  quickOpenItems = [],
  onTabChange,
  children,
}: WorkbenchShellProps) {
  const { reduceTransparency, toggleTransparency } = useWlTheme();
  const [initialPrefs] = useState(readLayoutPrefs);
  const [navWidth, setNavWidth] = useState(
    initialPrefs.treeWidth ?? NAV_DEFAULT,
  );
  const [navCollapsed, setNavCollapsed] = useState(
    initialPrefs.navCollapsed ?? false,
  );
  const [evidenceOpen, setEvidenceOpen] = useState(
    initialPrefs.evidenceOpen ?? defaultEvidenceOpen(),
  );
  const [evidenceRequested, setEvidenceRequested] = useState(false);
  const [evidenceWidth, setEvidenceWidth] = useState(
    initialPrefs.evidenceWidth ?? EVIDENCE_DEFAULT,
  );
  const [immersive, setImmersive] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCompact, setIsCompact] = useState(defaultCompactViewport);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileEvidenceOpen, setMobileEvidenceOpen] = useState(false);
  const [bodyWidth, setBodyWidth] = useState(0);
  const [mainInlineSize, setMainInlineSize] = useState(0);
  const tabIdPrefix = useId().replace(/:/gu, '');
  const shellRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'nav' | 'evidence' | null>(null);
  const navTriggerRef = useRef<HTMLButtonElement>(null);
  const evidenceTriggerRef = useRef<HTMLButtonElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const navDrawerRef = useRef<HTMLElement>(null);
  const evidenceDrawerRef = useRef<HTMLElement>(null);
  const drawerOriginRef = useRef<HTMLElement | null>(null);
  const focusRestoreRef = useRef({
    navCollapsed: initialPrefs.navCollapsed ?? false,
    evidenceOpen: initialPrefs.evidenceOpen ?? defaultEvidenceOpen(),
    immersive: false,
  });

  const rememberDrawerOrigin = useCallback((): void => {
    const active = document.activeElement;
    drawerOriginRef.current =
      active instanceof HTMLElement && active.isConnected ? active : null;
  }, []);

  /* ── §4.2 布局偏好持久化：仅界面偏好，不保存 WorkItem/current ── */
  useEffect(() => {
    if (focusMode) return;
    writeLayoutPrefs({
      treeWidth: navWidth,
      evidenceWidth,
      evidenceOpen,
      navCollapsed,
    });
  }, [navWidth, evidenceWidth, evidenceOpen, focusMode, navCollapsed]);

  /* Host 顶栏、Dock 与容器留白会改变真实可用宽度，不能只依赖 viewport media query。 */
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const updateWidth = (width = body.getBoundingClientRect().width) => {
      const nextWidth = Math.round(width);
      setBodyWidth((current) => (current === nextWidth ? current : nextWidth));
    };
    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => updateWidth();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const updateWidth = (width = main.getBoundingClientRect().width) => {
      const nextWidth = Math.round(width);
      setMainInlineSize((current) =>
        current === nextWidth ? current : nextWidth,
      );
    };
    updateWidth();
    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => updateWidth();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(main);
    return () => observer.disconnect();
  }, []);

  /* ── 拖拽分栏 ── */
  const startDrag = useCallback(
    (which: 'nav' | 'evidence') =>
      (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        draggingRef.current = which;
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
      },
    [],
  );

  const onDragMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const which = draggingRef.current;
    if (!which) return;
    if (which === 'nav') {
      const rect = shellRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(
        NAV_MAX,
        Math.max(NAV_MIN, event.clientX - rect.left),
      );
      setNavWidth(width);
    }
  }, []);

  const endDrag = useCallback(() => {
    draggingRef.current = null;
  }, []);

  /* ── 右侧证据栏拖拽（横向） ── */
  const evidenceDragMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const which = draggingRef.current;
      if (which !== 'evidence') return;
      const rect = shellRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(
        EVIDENCE_MAX,
        Math.max(EVIDENCE_MIN, rect.right - event.clientX),
      );
      setEvidenceWidth(width);
    },
    [],
  );

  /* ── 点证据自动展开（§4.2）：主内容中点击来源引用时展开证据栏 ── */
  useEffect(() => {
    if (evidenceSignal <= 0) return;
    setEvidenceRequested(true);
    if (isCompact) {
      rememberDrawerOrigin();
      setMobileNavOpen(false);
      setMobileEvidenceOpen(true);
    } else {
      setEvidenceOpen(true);
    }
  }, [evidenceSignal, isCompact, rememberDrawerOrigin]);

  /* 移动端使用显式抽屉，不继承桌面端“证据栏已展开”的布局偏好。 */
  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)');
    const sync = () => {
      setIsCompact(media.matches);
      if (!media.matches) {
        setMobileNavOpen(false);
        setMobileEvidenceOpen(false);
        setEvidenceRequested(false);
        drawerOriginRef.current = null;
      }
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  /* ── 沉浸模式：联动隐藏 AppShell 顶栏 ── */
  useEffect(() => {
    if (immersive) {
      document.body.dataset.wlImmersive = 'true';
    } else {
      delete document.body.dataset.wlImmersive;
    }
    return () => {
      delete document.body.dataset.wlImmersive;
    };
  }, [immersive]);

  /* ── 原生全屏 ── */
  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (shellRef.current?.requestFullscreen) {
      void shellRef.current.requestFullscreen();
    }
  }, []);

  const toggleFocusMode = useCallback(() => {
    if (focusMode) {
      const previous = focusRestoreRef.current;
      setNavCollapsed(previous.navCollapsed);
      setEvidenceOpen(previous.evidenceOpen);
      setImmersive(previous.immersive);
      setFocusMode(false);
      return;
    }

    focusRestoreRef.current = {
      navCollapsed,
      evidenceOpen,
      immersive,
    };
    setMobileNavOpen(false);
    setMobileEvidenceOpen(false);
    setNavCollapsed(true);
    setEvidenceOpen(false);
    setImmersive(true);
    setFocusMode(true);
  }, [evidenceOpen, focusMode, immersive, navCollapsed]);

  const adaptiveLayout = resolveWorkbenchAdaptiveLayout({
    bodyWidth,
    navWidth,
    evidenceWidth,
    evidenceOpen,
    isCompact,
    navigatorAvailable: Boolean(navigator),
    evidenceAvailable: Boolean(evidencePanel),
    evidenceContentCount,
    evidenceActive,
    evidenceRequested,
    mainInlineMinimum: resolveWorkbenchMainInlineMinimum(activeTab),
  });
  const contentLayout = resolveWorkbenchContentLayout(
    activeTab,
    mainInlineSize,
  );

  /* 沉浸模式只隐藏应用外壳，不隐藏工作台的资料目录与证据栏。 */
  /* 自适应收起只保护中心内容宽度，不写入用户的目录偏好。 */
  const navVisible = isCompact
    ? mobileNavOpen
    : Boolean(navigator) &&
      !navCollapsed &&
      !adaptiveLayout.autoCollapseNavigator;
  const evidenceVisible = resolveWorkbenchEvidenceVisibility({
    evidenceAvailable: Boolean(evidencePanel),
    isCompact,
    desktopOpen: evidenceOpen,
    mobileOpen: mobileEvidenceOpen,
    suppressEmptyEvidence: adaptiveLayout.suppressEmptyEvidence,
  });
  const navToggleLabel = navVisible
    ? '收起资料目录'
    : adaptiveLayout.autoCollapseNavigator
      ? '展开资料目录并收起原文依据'
      : '展开资料目录';

  const toggleNavigator = useCallback(() => {
    if (isCompact) {
      if (!mobileNavOpen) rememberDrawerOrigin();
      setMobileEvidenceOpen(false);
      setMobileNavOpen((open) => !open);
      return;
    }
    if (adaptiveLayout.autoCollapseNavigator && evidenceOpen) {
      setEvidenceRequested(false);
      setEvidenceOpen(false);
      setNavCollapsed(false);
      return;
    }
    setNavCollapsed((collapsed) => !collapsed);
  }, [
    adaptiveLayout.autoCollapseNavigator,
    evidenceOpen,
    isCompact,
    mobileNavOpen,
    rememberDrawerOrigin,
  ]);

  const toggleEvidence = useCallback((): void => {
    if (isCompact) {
      const nextOpen: boolean = !mobileEvidenceOpen;
      if (nextOpen) rememberDrawerOrigin();
      setMobileNavOpen(false);
      setMobileEvidenceOpen(nextOpen);
      setEvidenceRequested(nextOpen);
      return;
    }

    const nextOpen: boolean = !evidenceVisible;
    setEvidenceOpen(nextOpen);
    setEvidenceRequested(nextOpen);
  }, [evidenceVisible, isCompact, mobileEvidenceOpen, rememberDrawerOrigin]);

  const mobileTabs = tabs
    .filter((tab) => tab.mobileLabel)
    .sort((a, b) => (a.mobileOrder ?? 99) - (b.mobileOrder ?? 99));
  const resolvedMobileActiveTab = mobileActiveTab ?? activeTab;
  const panelId = `${tabIdPrefix}-panel`;
  const desktopTabId = (key: string) => `${tabIdPrefix}-desktop-${key}`;
  const mobileTabId = (key: string) => `${tabIdPrefix}-mobile-${key}`;
  const hasDesktopActiveTab = tabs.some((tab) => tab.key === activeTab);
  const hasMobileActiveTab = mobileTabs.some(
    (tab) => tab.key === resolvedMobileActiveTab,
  );
  const activePanelLabelledBy =
    isCompact && hasMobileActiveTab
      ? mobileTabId(resolvedMobileActiveTab)
      : hasDesktopActiveTab
        ? desktopTabId(activeTab)
        : undefined;

  const focusTab = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    orderedTabs: WorkbenchTab[],
    currentKey: string,
    scope: 'desktop' | 'mobile',
  ): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = orderedTabs.findIndex((tab) => tab.key === currentKey);
    if (currentIndex < 0) return;
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? orderedTabs.length - 1
          : event.key === 'ArrowRight'
            ? (currentIndex + 1) % orderedTabs.length
            : (currentIndex - 1 + orderedTabs.length) % orderedTabs.length;
    const next = orderedTabs[nextIndex];
    onTabChange(next.key);
    window.requestAnimationFrame(() => {
      document
        .getElementById(
          scope === 'desktop' ? desktopTabId(next.key) : mobileTabId(next.key),
        )
        ?.focus();
    });
  };

  const closeMobileDrawers = useCallback(
    (restoreFocus: boolean): void => {
      const fallbackTrigger = mobileNavOpen
        ? navTriggerRef.current
        : (evidenceTriggerRef.current ?? moreTriggerRef.current);
      const origin = drawerOriginRef.current;
      if (mobileEvidenceOpen) setEvidenceRequested(false);
      setMobileNavOpen(false);
      setMobileEvidenceOpen(false);
      if (restoreFocus) {
        window.requestAnimationFrame(() => {
          const target =
            origin?.isConnected && origin.getClientRects().length > 0
              ? origin
              : fallbackTrigger;
          target?.focus();
          drawerOriginRef.current = null;
        });
      } else {
        drawerOriginRef.current = null;
      }
    },
    [mobileEvidenceOpen, mobileNavOpen],
  );

  const trapDrawerFocus = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    if (!isCompact || (!mobileNavOpen && !mobileEvidenceOpen)) return;
    const drawer = mobileNavOpen
      ? navDrawerRef.current
      : evidenceDrawerRef.current;
    window.requestAnimationFrame(() => {
      const first = drawer?.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled])',
      );
      (first ?? drawer)?.focus();
    });
  }, [isCompact, mobileEvidenceOpen, mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen && !mobileEvidenceOpen) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMobileDrawers(true);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [closeMobileDrawers, mobileEvidenceOpen, mobileNavOpen]);
  const activateTab = (key: string) => {
    if (mobileEvidenceOpen) setEvidenceRequested(false);
    setMobileNavOpen(false);
    setMobileEvidenceOpen(false);
    onTabChange(key);
  };

  const resolvedQuickOpenItems: QuickOpenItem[] = [
    ...quickOpenItems,
    {
      id: 'workbench:focus',
      label: focusMode ? '退出专注阅读' : '进入专注阅读',
      description: focusMode
        ? '恢复进入专注模式前的目录与证据布局'
        : '收起全局外壳、目录与证据，保留当前专业内容',
      keywords: 'focus mode 专注 聚焦 阅读',
      group: '工作台操作',
      icon: <Focus aria-hidden="true" />,
      onSelect: toggleFocusMode,
    },
    {
      id: 'workbench:navigator',
      label: navToggleLabel,
      description: '切换当前资料的目录树',
      keywords: '目录 tree navigator',
      group: '工作台操作',
      icon: navVisible ? (
        <PanelLeftClose aria-hidden="true" />
      ) : (
        <PanelLeftOpen aria-hidden="true" />
      ),
      onSelect: toggleNavigator,
    },
    ...(evidencePanel
      ? [
          {
            id: 'workbench:evidence',
            label: evidenceVisible ? '收起原文依据' : '展开原文依据',
            description: '查看当前结果绑定的来源与定位',
            keywords: '证据 来源 SourceRef evidence',
            group: '工作台操作',
            icon: evidenceVisible ? (
              <PanelRightClose aria-hidden="true" />
            ) : (
              <PanelRightOpen aria-hidden="true" />
            ),
            onSelect: toggleEvidence,
          } satisfies QuickOpenItem,
        ]
      : []),
  ];

  return (
    <div
      ref={shellRef}
      className={`wl-workbench-shell${immersive ? ' is-immersive' : ''}${focusMode ? ' is-focus-mode' : ''}${isCompact ? ' is-compact' : ''}`}
      data-wl-material="g3"
      onPointerMove={(event) => {
        onDragMove(event);
        evidenceDragMove(event);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <QuickOpen
        open={quickOpen}
        onOpenChange={setQuickOpen}
        items={resolvedQuickOpenItems}
      />

      {/* ── 顶部工具条 ── */}
      <div
        className="wl-workbench-toolbar wl-glass-nav"
        data-wl-material="g1"
        role="toolbar"
        aria-label="工作台工具栏"
      >
        <button
          ref={navTriggerRef}
          type="button"
          className="wl-workbench-tool-btn"
          onClick={toggleNavigator}
          title={navToggleLabel}
          aria-label={navToggleLabel}
          aria-pressed={navVisible}
        >
          {navVisible ? <PanelLeftClose /> : <PanelLeftOpen />}
        </button>

        <span className="wl-workbench-context-title">
          <strong>WiseLink</strong>
          <span title={contextLabel}>{contextLabel}</span>
        </span>

        <div
          className="wl-workbench-tabs"
          role="tablist"
          aria-label="工作台视图"
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.key}
              id={desktopTabId(tab.key)}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls={panelId}
              tabIndex={
                activeTab === tab.key || (!hasDesktopActiveTab && index === 0)
                  ? 0
                  : -1
              }
              className={`wl-workbench-tab${activeTab === tab.key ? ' is-active' : ''}`}
              onClick={() => onTabChange(tab.key)}
              onKeyDown={(event) => focusTab(event, tabs, tab.key, 'desktop')}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="wl-workbench-toolbar-actions">
          {!isCompact ? (
            <button
              type="button"
              className="wl-workbench-tool-btn wl-workbench-quick-open-trigger"
              onClick={() => setQuickOpen(true)}
              title="快速打开（Command 或 Control + K）"
              aria-label="快速打开"
            >
              <Search aria-hidden="true" />
              <kbd>⌘K</kbd>
            </button>
          ) : null}
          {!isCompact ? (
            <>
              <button
                ref={evidenceTriggerRef}
                type="button"
                className="wl-workbench-tool-btn"
                onClick={toggleEvidence}
                title={evidenceVisible ? '收起原文依据' : '展开原文依据'}
                aria-label={evidenceVisible ? '收起原文依据' : '展开原文依据'}
                aria-pressed={evidenceVisible}
              >
                {evidenceVisible ? <PanelRightClose /> : <PanelRightOpen />}
              </button>
              <button
                type="button"
                className="wl-workbench-tool-btn wl-workbench-focus-trigger"
                onClick={toggleFocusMode}
                title={focusMode ? '退出专注阅读' : '进入专注阅读'}
                aria-label={focusMode ? '退出专注阅读' : '进入专注阅读'}
                aria-pressed={focusMode}
              >
                <Focus aria-hidden="true" />
                <span>{focusMode ? '退出专注' : '专注阅读'}</span>
              </button>
            </>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                ref={moreTriggerRef}
                type="button"
                className="wl-workbench-tool-btn"
                title="更多工作台设置"
                aria-label="更多工作台设置"
              >
                <MoreHorizontal aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="wl-workbench-more-menu"
            >
              {isCompact ? (
                <>
                  <DropdownMenuLabel>移动端快捷操作</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => setQuickOpen(true)}>
                    <Search aria-hidden="true" />
                    快速打开
                  </DropdownMenuItem>
                  <DropdownMenuCheckboxItem
                    checked={evidenceVisible}
                    onCheckedChange={() => toggleEvidence()}
                  >
                    {evidenceVisible ? (
                      <PanelRightClose aria-hidden="true" />
                    ) : (
                      <PanelRightOpen aria-hidden="true" />
                    )}
                    {evidenceVisible ? '收起原文依据' : '展开原文依据'}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={focusMode}
                    onCheckedChange={() => toggleFocusMode()}
                  >
                    <Focus aria-hidden="true" />
                    {focusMode ? '退出专注阅读' : '进入专注阅读'}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuLabel>工作台显示</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={reduceTransparency}
                onCheckedChange={toggleTransparency}
                className="wl-workbench-transparency-toggle"
              >
                <Contrast aria-hidden="true" />
                降低透明效果
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={immersive}
                onCheckedChange={() => setImmersive((value) => !value)}
              >
                {immersive ? (
                  <Minimize2 aria-hidden="true" />
                ) : (
                  <Maximize2 aria-hidden="true" />
                )}
                仅隐藏应用外壳
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={toggleFullscreen}>
                <Maximize2 aria-hidden="true" />
                {isFullscreen ? '退出系统全屏' : '进入系统全屏'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── §10.1 窄屏底部标签：总体、原文、复核、动态 ── */}
      <nav
        className="wl-workbench-mobilebar"
        role="tablist"
        aria-label="底部视图标签"
      >
        {mobileTabs.map((tab, index) => (
          <button
            key={tab.key}
            id={mobileTabId(tab.key)}
            type="button"
            role="tab"
            aria-selected={resolvedMobileActiveTab === tab.key}
            aria-controls={panelId}
            tabIndex={
              resolvedMobileActiveTab === tab.key ||
              (!hasMobileActiveTab && index === 0)
                ? 0
                : -1
            }
            className={`wl-workbench-mobile-tab${
              resolvedMobileActiveTab === tab.key ? ' is-active' : ''
            }`}
            onClick={() => activateTab(tab.key)}
            onKeyDown={(event) =>
              focusTab(event, mobileTabs, tab.key, 'mobile')
            }
          >
            {tab.icon}
            <span>{tab.mobileLabel}</span>
          </button>
        ))}
      </nav>

      {isCompact && (mobileNavOpen || mobileEvidenceOpen) ? (
        <button
          type="button"
          className="wl-workbench-drawer-scrim"
          aria-label="关闭工作台抽屉"
          tabIndex={-1}
          onClick={() => closeMobileDrawers(true)}
        />
      ) : null}

      {/* ── 主体：左目录树 · 中内容 · 右证据栏并排（§4.2 1440×900 可并排复核） ── */}
      <div
        ref={bodyRef}
        className={`wl-workbench-body${adaptiveLayout.useEvidenceOverlay ? ' is-evidence-overlay' : ''}`}
      >
        {navVisible ? (
          <>
            <aside
              ref={navDrawerRef}
              className="wl-workbench-nav"
              style={{ width: navWidth }}
              aria-label="目录树"
              role={isCompact ? 'dialog' : undefined}
              aria-modal={isCompact ? true : undefined}
              tabIndex={isCompact ? -1 : undefined}
              onKeyDown={isCompact ? trapDrawerFocus : undefined}
            >
              {isCompact ? (
                <button
                  type="button"
                  className="wl-workbench-drawer-close"
                  onClick={() => closeMobileDrawers(true)}
                >
                  <PanelLeftClose aria-hidden="true" /> 关闭资料目录
                </button>
              ) : null}
              {navigator}
            </aside>
            {!isCompact ? (
              <div
                className="wl-workbench-divider wl-workbench-divider--v"
                role="separator"
                aria-orientation="vertical"
                aria-label="调整目录树宽度"
                aria-valuemin={NAV_MIN}
                aria-valuemax={NAV_MAX}
                aria-valuenow={navWidth}
                title="拖动或使用方向键调整目录宽度；双击恢复推荐宽度"
                tabIndex={0}
                onPointerDown={startDrag('nav')}
                onDoubleClick={() => setNavWidth(NAV_DEFAULT)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    setNavWidth((w) => Math.max(NAV_MIN, w - 16));
                  } else if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    setNavWidth((w) => Math.min(NAV_MAX, w + 16));
                  } else if (event.key === 'Home') {
                    event.preventDefault();
                    setNavWidth(NAV_MIN);
                  } else if (event.key === 'End') {
                    event.preventDefault();
                    setNavWidth(NAV_MAX);
                  }
                }}
              />
            ) : null}
          </>
        ) : null}

        <div
          ref={mainRef}
          id={panelId}
          className={`wl-workbench-main is-${contentMode}`}
          data-content-mode={contentMode}
          data-content-layout={contentLayout}
          role="tabpanel"
          aria-labelledby={activePanelLabelledBy}
          aria-label={activePanelLabelledBy ? undefined : '当前工作区'}
          tabIndex={contentMode === 'flow' ? 0 : -1}
        >
          {children}
        </div>

        {evidenceVisible ? (
          <>
            {!isCompact && !adaptiveLayout.useEvidenceOverlay ? (
              <div
                className="wl-workbench-divider wl-workbench-divider--v"
                role="separator"
                aria-orientation="vertical"
                aria-label="调整证据栏宽度"
                aria-valuemin={EVIDENCE_MIN}
                aria-valuemax={EVIDENCE_MAX}
                aria-valuenow={evidenceWidth}
                tabIndex={0}
                onPointerDown={startDrag('evidence')}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    setEvidenceWidth((w) => Math.min(EVIDENCE_MAX, w + 16));
                  } else if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    setEvidenceWidth((w) => Math.max(EVIDENCE_MIN, w - 16));
                  } else if (event.key === 'Home') {
                    event.preventDefault();
                    setEvidenceWidth(EVIDENCE_MIN);
                  } else if (event.key === 'End') {
                    event.preventDefault();
                    setEvidenceWidth(EVIDENCE_MAX);
                  }
                }}
              />
            ) : null}
            <section
              ref={evidenceDrawerRef}
              className="wl-workbench-evidence"
              data-wl-material="g2"
              style={{ width: evidenceWidth }}
              aria-label="证据面板"
              role={isCompact ? 'dialog' : undefined}
              aria-modal={isCompact ? true : undefined}
              tabIndex={isCompact ? -1 : undefined}
              onKeyDown={isCompact ? trapDrawerFocus : undefined}
            >
              {isCompact ? (
                <button
                  type="button"
                  className="wl-workbench-drawer-close"
                  onClick={() => closeMobileDrawers(true)}
                >
                  <PanelRightClose aria-hidden="true" /> 关闭原文依据
                </button>
              ) : null}
              {evidencePanel}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
