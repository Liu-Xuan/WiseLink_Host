const WORKBENCH_FLOW_MAIN_INLINE_MIN = 820;
const WORKBENCH_READER_PAIRED_INLINE_MIN = 901;
const WORKBENCH_PACKAGE_PAIRED_INLINE_MIN = 941;
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
  mainInlineMinimum: number;
}

export interface WorkbenchAdaptiveLayout {
  autoCollapseNavigator: boolean;
  useEvidenceOverlay: boolean;
  suppressEmptyEvidence: boolean;
}

export type WorkbenchContentLayout =
  | 'flow'
  | 'paired'
  | 'reader-single'
  | 'package-single';

/**
 * Reader 与 package 的单/双面板阈值使用真实主栏宽度计算，并由 DOM state
 * 与 CSS 共同消费。这样侧栏 resize 后也不会留下“CSS 已换行、外层却裁切”
 * 的中间状态。
 */
export function resolveWorkbenchContentLayout(
  activeTab: string,
  mainInlineSize: number,
): WorkbenchContentLayout {
  if (activeTab !== 'reader' && activeTab !== 'package') return 'flow';
  if (mainInlineSize <= 0) return 'paired';
  if (
    activeTab === 'reader' &&
    mainInlineSize < WORKBENCH_READER_PAIRED_INLINE_MIN
  ) {
    return 'reader-single';
  }
  if (
    activeTab === 'package' &&
    mainInlineSize < WORKBENCH_PACKAGE_PAIRED_INLINE_MIN
  ) {
    return 'package-single';
  }
  return 'paired';
}

/**
 * Allocation must protect the same width that content layout needs. Using the
 * old generic 820px floor allowed an empty evidence rail to leave package at
 * 910px and silently switch the main stage to a single PDF panel.
 */
export function resolveWorkbenchMainInlineMinimum(activeTab: string): number {
  if (activeTab === 'reader') return WORKBENCH_READER_PAIRED_INLINE_MIN;
  if (activeTab === 'package') return WORKBENCH_PACKAGE_PAIRED_INLINE_MIN;
  return WORKBENCH_FLOW_MAIN_INLINE_MIN;
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
  mainInlineMinimum,
}: WorkbenchAdaptiveLayoutInput): WorkbenchAdaptiveLayout {
  if (bodyWidth <= 0 || isCompact || !evidenceAvailable || !evidenceOpen) {
    return {
      autoCollapseNavigator: false,
      useEvidenceOverlay: false,
      suppressEmptyEvidence: false,
    };
  }

  const threeColumnMinimum =
    navWidth + evidenceWidth + mainInlineMinimum + WORKBENCH_DIVIDER_WIDTH * 2;
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
    navWidth + mainInlineMinimum + WORKBENCH_DIVIDER_WIDTH;
  const evidenceInlineMinimum =
    evidenceWidth + mainInlineMinimum + WORKBENCH_DIVIDER_WIDTH;
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
