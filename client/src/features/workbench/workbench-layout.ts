const WORKBENCH_MAIN_INLINE_MIN = 820;
const WORKBENCH_DIVIDER_WIDTH = 6;

export interface WorkbenchAdaptiveLayoutInput {
  bodyWidth: number;
  navWidth: number;
  evidenceWidth: number;
  evidenceOpen: boolean;
  isCompact: boolean;
  navigatorAvailable: boolean;
  evidenceAvailable: boolean;
  evidenceContentCount: number;
  evidenceActive: boolean;
  evidenceRequested: boolean;
}

export interface WorkbenchAdaptiveLayout {
  autoCollapseNavigator: boolean;
  useEvidenceOverlay: boolean;
  suppressEmptyEvidence: boolean;
}

/**
 * 根据工作台实际内容宽度分配三栏，而不是用浏览器视口猜测 Host 外壳占用。
 * 0/0 且无当前用户意图时先释放空证据栏；有真实证据或明确意图时再沿用
 * 目录临时收起与证据浮层策略，保住结构化内容与 PDF 的并排宽度。
 */
export function resolveWorkbenchAdaptiveLayout({
  bodyWidth,
  navWidth,
  evidenceWidth,
  evidenceOpen,
  isCompact,
  navigatorAvailable,
  evidenceAvailable,
  evidenceContentCount,
  evidenceActive,
  evidenceRequested,
}: WorkbenchAdaptiveLayoutInput): WorkbenchAdaptiveLayout {
  if (bodyWidth <= 0 || isCompact || !evidenceAvailable || !evidenceOpen) {
    return {
      autoCollapseNavigator: false,
      useEvidenceOverlay: false,
      suppressEmptyEvidence: false,
    };
  }

  const threeColumnMinimum =
    navWidth +
    evidenceWidth +
    WORKBENCH_MAIN_INLINE_MIN +
    WORKBENCH_DIVIDER_WIDTH * 2;
  const suppressEmptyEvidence =
    evidenceContentCount <= 0 &&
    !evidenceActive &&
    !evidenceRequested &&
    bodyWidth < threeColumnMinimum;

  if (suppressEmptyEvidence) {
    return {
      /* 空证据已经释放宽度；目录继续作为主要导航，中心内容自行按
       * container query 收敛为单列。不能同时静默隐藏两个辅助面板。 */
      autoCollapseNavigator: false,
      useEvidenceOverlay: false,
      suppressEmptyEvidence: true,
    };
  }

  const navigatorInlineMinimum =
    navWidth + WORKBENCH_MAIN_INLINE_MIN + WORKBENCH_DIVIDER_WIDTH;
  const evidenceInlineMinimum =
    evidenceWidth + WORKBENCH_MAIN_INLINE_MIN + WORKBENCH_DIVIDER_WIDTH;
  const useEvidenceOverlay = bodyWidth < evidenceInlineMinimum;

  return {
    autoCollapseNavigator:
      navigatorAvailable &&
      bodyWidth <
        (useEvidenceOverlay ? navigatorInlineMinimum : threeColumnMinimum),
    useEvidenceOverlay,
    suppressEmptyEvidence: false,
  };
}

export interface WorkbenchEvidenceVisibilityInput {
  evidenceAvailable: boolean;
  isCompact: boolean;
  desktopOpen: boolean;
  mobileOpen: boolean;
  suppressEmptyEvidence: boolean;
}

/** 移动端抽屉不继承桌面端的空面板抑制策略。 */
export function resolveWorkbenchEvidenceVisibility({
  evidenceAvailable,
  isCompact,
  desktopOpen,
  mobileOpen,
  suppressEmptyEvidence,
}: WorkbenchEvidenceVisibilityInput): boolean {
  if (!evidenceAvailable) return false;
  if (isCompact) return mobileOpen;
  return desktopOpen && !suppressEmptyEvidence;
}
