import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';

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
  /** 右侧证据面板 */
  evidencePanel?: ReactNode;
  /** 主内容中点击证据引用时递增；面板自动展开（§4.2 折叠策略） */
  evidenceSignal?: number;
  tabs: WorkbenchTab[];
  activeTab: string;
  /** 窄屏四项底栏的语义归组；例如解析结果归入「原文」。 */
  mobileActiveTab?: string;
  onTabChange: (key: string) => void;
  children: ReactNode;
}

const NAV_MIN = 180;
const NAV_MAX = 420;
/** Spec R01 §4.2：右侧证据栏 280–360px */
const EVIDENCE_MIN = 280;
const EVIDENCE_MAX = 360;
const EVIDENCE_DEFAULT = 320;
/** 1440px 设计视口优先保证结构化结果与 PDF 并排；证据栏改为按需浮层。 */
const EVIDENCE_INLINE_BREAKPOINT = 1480;
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
  return (
    typeof window === 'undefined' ||
    window.innerWidth > EVIDENCE_INLINE_BREAKPOINT
  );
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
      treeWidth: clampNumber(record.treeWidth, NAV_MIN, NAV_MAX, 272),
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
  evidencePanel,
  evidenceSignal = 0,
  tabs,
  activeTab,
  mobileActiveTab,
  onTabChange,
  children,
}: WorkbenchShellProps) {
  const [initialPrefs] = useState(readLayoutPrefs);
  const [navWidth, setNavWidth] = useState(initialPrefs.treeWidth ?? 272);
  const [navCollapsed, setNavCollapsed] = useState(
    initialPrefs.navCollapsed ?? false,
  );
  const [evidenceOpen, setEvidenceOpen] = useState(
    initialPrefs.evidenceOpen ?? defaultEvidenceOpen(),
  );
  const [evidenceWidth, setEvidenceWidth] = useState(
    initialPrefs.evidenceWidth ?? EVIDENCE_DEFAULT,
  );
  const [immersive, setImmersive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCompact, setIsCompact] = useState(defaultCompactViewport);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileEvidenceOpen, setMobileEvidenceOpen] = useState(false);
  const tabIdPrefix = useId().replace(/:/gu, '');
  const shellRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'nav' | 'evidence' | null>(null);
  const navTriggerRef = useRef<HTMLButtonElement>(null);
  const evidenceTriggerRef = useRef<HTMLButtonElement>(null);
  const navDrawerRef = useRef<HTMLElement>(null);
  const evidenceDrawerRef = useRef<HTMLElement>(null);

  /* ── §4.2 布局偏好持久化：仅界面偏好，不保存 WorkItem/current ── */
  useEffect(() => {
    writeLayoutPrefs({
      treeWidth: navWidth,
      evidenceWidth,
      evidenceOpen,
      navCollapsed,
    });
  }, [navWidth, evidenceWidth, evidenceOpen, navCollapsed]);

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
    if (isCompact) {
      setMobileNavOpen(false);
      setMobileEvidenceOpen(true);
    } else {
      setEvidenceOpen(true);
    }
  }, [evidenceSignal, isCompact]);

  /* 移动端使用显式抽屉，不继承桌面端“证据栏已展开”的布局偏好。 */
  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)');
    const sync = () => {
      setIsCompact(media.matches);
      if (!media.matches) {
        setMobileNavOpen(false);
        setMobileEvidenceOpen(false);
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

  /* 沉浸模式只隐藏应用外壳，不隐藏工作台的资料目录与证据栏。 */
  const navVisible = isCompact ? mobileNavOpen : !navCollapsed;
  const evidenceVisible =
    Boolean(evidencePanel) && (isCompact ? mobileEvidenceOpen : evidenceOpen);

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
          scope === 'desktop'
            ? desktopTabId(next.key)
            : mobileTabId(next.key),
        )
        ?.focus();
    });
  };

  const closeMobileDrawers = useCallback((restoreFocus: boolean): void => {
    const trigger = mobileNavOpen
      ? navTriggerRef.current
      : evidenceTriggerRef.current;
    setMobileNavOpen(false);
    setMobileEvidenceOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => trigger?.focus());
    }
  }, [mobileNavOpen]);

  const trapDrawerFocus = (
    event: ReactKeyboardEvent<HTMLElement>,
  ): void => {
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
    setMobileNavOpen(false);
    setMobileEvidenceOpen(false);
    onTabChange(key);
  };

  return (
    <div
      ref={shellRef}
      className={`wl-workbench-shell${immersive ? ' is-immersive' : ''}${isCompact ? ' is-compact' : ''}`}
      onPointerMove={(event) => {
        onDragMove(event);
        evidenceDragMove(event);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* ── 顶部工具条 ── */}
      <div
        className="wl-workbench-toolbar wl-glass-nav"
        role="toolbar"
        aria-label="工作台工具栏"
      >
        <button
          ref={navTriggerRef}
          type="button"
          className="wl-workbench-tool-btn"
          onClick={() => {
            if (isCompact) {
              setMobileEvidenceOpen(false);
              setMobileNavOpen((open) => !open);
            } else {
              setNavCollapsed((collapsed) => !collapsed);
            }
          }}
          title={navVisible ? '收起资料目录' : '展开资料目录'}
          aria-label={navVisible ? '收起资料目录' : '展开资料目录'}
          aria-pressed={navVisible}
        >
          {navVisible ? <PanelLeftClose /> : <PanelLeftOpen />}
        </button>

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
              onKeyDown={(event) =>
                focusTab(event, tabs, tab.key, 'desktop')
              }
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="wl-workbench-toolbar-actions">
          <button
            ref={evidenceTriggerRef}
            type="button"
            className="wl-workbench-tool-btn"
            onClick={() => {
              if (isCompact) {
                setMobileNavOpen(false);
                setMobileEvidenceOpen((open) => !open);
              } else {
                setEvidenceOpen((open) => !open);
              }
            }}
            title={evidenceVisible ? '收起原文依据' : '展开原文依据'}
            aria-label={evidenceVisible ? '收起原文依据' : '展开原文依据'}
            aria-pressed={evidenceVisible}
          >
            {evidenceVisible ? <PanelRightClose /> : <PanelRightOpen />}
          </button>
          <button
            type="button"
            className="wl-workbench-tool-btn"
            onClick={() => setImmersive((v) => !v)}
            title={immersive ? '退出沉浸模式' : '进入沉浸模式'}
            aria-label={immersive ? '退出沉浸模式' : '进入沉浸模式'}
            aria-pressed={immersive}
          >
            <Minimize2 className="wl-icon-exit" />
            <Maximize2 className="wl-icon-enter" />
          </button>
          <button
            type="button"
            className="wl-workbench-tool-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? '退出全屏' : '原生全屏'}
            aria-label={isFullscreen ? '退出全屏' : '原生全屏'}
          >
            <Maximize2 />
          </button>
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
      <div className="wl-workbench-body">
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
            <div
              className="wl-workbench-divider wl-workbench-divider--v"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整目录树宽度"
              aria-valuemin={NAV_MIN}
              aria-valuemax={NAV_MAX}
              aria-valuenow={navWidth}
              tabIndex={0}
              onPointerDown={startDrag('nav')}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                  setNavWidth((w) => Math.max(NAV_MIN, w - 16));
                } else if (event.key === 'ArrowRight') {
                  setNavWidth((w) => Math.min(NAV_MAX, w + 16));
                } else if (event.key === 'Home') {
                  setNavWidth(NAV_MIN);
                } else if (event.key === 'End') {
                  setNavWidth(NAV_MAX);
                }
              }}
            />
          </>
        ) : null}

        <div
          id={panelId}
          className="wl-workbench-main"
          role="tabpanel"
          aria-labelledby={activePanelLabelledBy}
          aria-label={activePanelLabelledBy ? undefined : '当前工作区'}
          tabIndex={0}
        >
          {children}
        </div>

        {evidenceVisible ? (
          <>
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
                  setEvidenceWidth((w) => Math.min(EVIDENCE_MAX, w + 16));
                } else if (event.key === 'ArrowRight') {
                  setEvidenceWidth((w) => Math.max(EVIDENCE_MIN, w - 16));
                } else if (event.key === 'Home') {
                  setEvidenceWidth(EVIDENCE_MIN);
                } else if (event.key === 'End') {
                  setEvidenceWidth(EVIDENCE_MAX);
                }
              }}
            />
            <section
              ref={evidenceDrawerRef}
              className="wl-workbench-evidence"
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
