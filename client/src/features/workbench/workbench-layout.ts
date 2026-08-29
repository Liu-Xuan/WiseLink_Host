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
}

export interface WorkbenchAdaptiveLayout {
  autoCollapseNavigator: boolean;
  useEvidenceOverlay: boolean;
}

/**
 * 根据工作台实际内容宽度分配三栏，而不是用浏览器视口猜测 Host 外壳占用。
 * 先临时收起目录以保住结构化内容与 PDF 的并排宽度；再窄时证据改为浮层。
 */
export function resolveWorkbenchAdaptiveLayout({
  bodyWidth,
  navWidth,
  evidenceWidth,
  evidenceOpen,
  isCompact,
  navigatorAvailable,
  evidenceAvailable,
}: WorkbenchAdaptiveLayoutInput): WorkbenchAdaptiveLayout {
  if (bodyWidth <= 0 || isCompact || !evidenceAvailable || !evidenceOpen) {
    return {
      autoCollapseNavigator: false,
      useEvidenceOverlay: false,
    };
  }

  const evidenceInlineMinimum =
    evidenceWidth + WORKBENCH_MAIN_INLINE_MIN + WORKBENCH_DIVIDER_WIDTH;
  const useEvidenceOverlay = bodyWidth < evidenceInlineMinimum;
  const threeColumnMinimum =
    navWidth +
    evidenceWidth +
    WORKBENCH_MAIN_INLINE_MIN +
    WORKBENCH_DIVIDER_WIDTH * 2;

  return {
    autoCollapseNavigator:
      navigatorAvailable &&
      !useEvidenceOverlay &&
      bodyWidth < threeColumnMinimum,
    useEvidenceOverlay,
  };
}
