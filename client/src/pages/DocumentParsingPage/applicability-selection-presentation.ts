import type { CanonicalApplicabilitySelectionReadModel } from '@shared/api.interface';

export type ApplicabilitySelectionLoadState =
  | 'loading'
  | 'ready'
  | 'unconfigured'
  | 'error';

export type ApplicabilitySelectionViewState =
  | 'success'
  | 'unknown'
  | 'waiting'
  | 'error';

export interface ApplicabilitySelectionPresentation {
  state: ApplicabilitySelectionViewState;
  selectionLabel: string;
  sourceLabel: string;
  guidance: string;
}

const UNCONFIGURED_CODE = 'APPLICABILITY_CONTROLLED_SELECTION_NOT_CONFIGURED';

function rawErrorText(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) {
    return reason.message.trim();
  }
  return String(reason ?? '').trim();
}

export function isApplicabilitySelectionUnconfigured(reason: unknown): boolean {
  return rawErrorText(reason).includes(UNCONFIGURED_CODE);
}

export function presentApplicabilitySelectionError(reason: unknown): string {
  const raw: string = rawErrorText(reason).toUpperCase();

  if (/CONFLICT|STALE|REVISION/u.test(raw)) {
    return '事项资料已经更新，请刷新自动评估范围。';
  }
  if (/UNAUTHORIZED|FORBIDDEN|PERMISSION|ACCESS_DENIED/u.test(raw)) {
    return '当前账户无权读取这项自动评估范围。';
  }
  if (/WAITING_INPUT|INPUT_REQUIRED|VALIDATION_FAILED/u.test(raw)) {
    return '系统尚未形成完整评估范围；初始分析会保留未知项并继续。';
  }
  return '暂时无法读取自动评估范围；现有分析内容仍可查看。';
}

export function presentApplicabilitySelection(
  loadState: ApplicabilitySelectionLoadState,
  selection: CanonicalApplicabilitySelectionReadModel | null,
): ApplicabilitySelectionPresentation {
  if (loadState === 'loading') {
    return {
      state: 'waiting',
      selectionLabel: '正在读取自动范围',
      sourceLabel: '正在核对来源',
      guidance: '正在读取 Host 冻结的评估对象、时点与受控来源。',
    };
  }
  if (loadState === 'unconfigured') {
    return {
      state: 'unknown',
      selectionLabel: '分析时自动冻结',
      sourceLabel: '分析时由 Host 核对',
      guidance:
        '当前尚未形成冻结范围；初始分析开始时由 Host 自动确定，无需工程师输入或确认。',
    };
  }
  if (loadState === 'error') {
    return {
      state: 'error',
      selectionLabel: '自动范围状态未知',
      sourceLabel: '来源状态未知',
      guidance:
        '自动范围暂时无法读取；初始分析继续保持诚实未知项，现有分析内容仍可查看。',
    };
  }
  if (!selection) {
    return {
      state: 'unknown',
      selectionLabel: '未读取到冻结范围',
      sourceLabel: '来源状态未知',
      guidance: '当前没有可展示的 Host 冻结范围。',
    };
  }
  if (selection.currentness === 'STALE') {
    return {
      state: 'waiting',
      selectionLabel: '资料已更新',
      sourceLabel:
        selection.frozenSourceBinding.status === 'READY'
          ? '来源已绑定'
          : '来源待补齐',
      guidance:
        '事项资料已经更新；Host 将基于 current 资料重新冻结评估输入，无需人工重填。',
    };
  }
  if (selection.frozenSourceBinding.status === 'MISSING') {
    return {
      state: 'waiting',
      selectionLabel: '范围已冻结',
      sourceLabel: '来源待补齐',
      guidance: '评估范围已冻结，但受控来源尚未完整绑定。',
    };
  }
  return {
    state: 'success',
    selectionLabel: '系统范围已冻结',
    sourceLabel: '来源已绑定',
    guidance: 'Host 冻结的评估对象、时点与受控来源均已读取。',
  };
}
