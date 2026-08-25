import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Maximize2,
  Minimize2,
  MoreHorizontal,
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
  onTabChange: (key: string) => void;
  children: ReactNode;
}

const NAV_MIN = 180;
const NAV_MAX = 420;
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
        typeof record.evidenceOpen === 'boolean' ? record.evidenceOpen : true,
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
  onTabChange,
  children,
}: WorkbenchShellProps) {
  const [initialPrefs] = useState(readLayoutPrefs);
  const [navWidth, setNavWidth] = useState(initialPrefs.treeWidth ?? 272);
  const [navCollapsed, setNavCollapsed] = useState(
    initialPrefs.navCollapsed ?? false,
  );
  const [evidenceOpen, setEvidenceOpen] = useState(
    initialPrefs.evidenceOpen ?? true,
  );
  const [evidenceWidth, setEvidenceWidth] = useState(
    initialPrefs.evidenceWidth ?? EVIDENCE_DEFAULT,
  );
  const [immersive, setImmersive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileEvidenceOpen, setMobileEvidenceOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'nav' | 'evidence' | null>(null);

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
      const width = Math.min(NAV_MAX, Math.max(NAV_MIN, event.clientX));
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

  const navVisible = !immersive && (isCompact ? mobileNavOpen : !navCollapsed);
  const evidenceVisible =
    Boolean(evidencePanel) &&
    !immersive &&
    (isCompact ? mobileEvidenceOpen : evidenceOpen);

  const mobileTabs = tabs.filter((tab) => tab.mobileLabel);
  const overflowTabs = tabs.filter((tab) => !tab.mobileLabel);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const activateTab = (key: string) => {
    setMobileMoreOpen(false);
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
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`wl-workbench-tab${activeTab === tab.key ? ' is-active' : ''}`}
              onClick={() => onTabChange(tab.key)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="wl-workbench-toolbar-actions">
          <button
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

      {/* ── §10.1 窄屏底部标签：概述、原文、评估、活动；其余收「更多」 ── */}
      <nav
        className="wl-workbench-mobilebar"
        role="tablist"
        aria-label="底部视图标签"
      >
        {mobileTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`wl-workbench-mobile-tab${
              activeTab === tab.key ? ' is-active' : ''
            }`}
            onClick={() => activateTab(tab.key)}
          >
            {tab.icon}
            <span>{tab.mobileLabel}</span>
          </button>
        ))}
        {overflowTabs.length ? (
          <div className="wl-workbench-mobile-more">
            <button
              type="button"
              className={`wl-workbench-mobile-tab${
                overflowTabs.some((tab) => tab.key === activeTab)
                  ? ' is-active'
                  : ''
              }`}
              aria-expanded={mobileMoreOpen}
              onClick={() => setMobileMoreOpen((v) => !v)}
            >
              <MoreHorizontal aria-hidden="true" />
              <span>更多</span>
            </button>
            {mobileMoreOpen ? (
              <ul className="wl-workbench-mobile-sheet wl-glass-content">
                {overflowTabs.map((tab) => (
                  <li key={tab.key}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab.key}
                      className={activeTab === tab.key ? 'is-active' : ''}
                      onClick={() => activateTab(tab.key)}
                    >
                      {tab.icon}
                      <span>{tab.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </nav>

      {isCompact && (mobileNavOpen || mobileEvidenceOpen) ? (
        <button
          type="button"
          className="wl-workbench-drawer-scrim"
          aria-label="关闭工作台抽屉"
          onClick={() => {
            setMobileNavOpen(false);
            setMobileEvidenceOpen(false);
          }}
        />
      ) : null}

      {/* ── 主体：左目录树 · 中内容 · 右证据栏并排（§4.2 1440×900 可并排复核） ── */}
      <div className="wl-workbench-body">
        {navVisible ? (
          <>
            <aside
              className="wl-workbench-nav"
              style={{ width: navWidth }}
              aria-label="目录树"
            >
              {navigator}
            </aside>
            <div
              className="wl-workbench-divider wl-workbench-divider--v"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整目录树宽度"
              tabIndex={0}
              onPointerDown={startDrag('nav')}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                  setNavWidth((w) => Math.max(NAV_MIN, w - 16));
                } else if (event.key === 'ArrowRight') {
                  setNavWidth((w) => Math.min(NAV_MAX, w + 16));
                }
              }}
            />
          </>
        ) : null}

        <div className="wl-workbench-main" role="tabpanel">
          {children}
        </div>

        {evidenceVisible ? (
          <>
            <div
              className="wl-workbench-divider wl-workbench-divider--v"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整证据栏宽度"
              tabIndex={0}
              onPointerDown={startDrag('evidence')}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                  setEvidenceWidth((w) => Math.min(EVIDENCE_MAX, w + 16));
                } else if (event.key === 'ArrowRight') {
                  setEvidenceWidth((w) => Math.max(EVIDENCE_MIN, w - 16));
                }
              }}
            />
            <section
              className="wl-workbench-evidence"
              style={{ width: evidenceWidth }}
              aria-label="证据面板"
            >
              {evidencePanel}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
