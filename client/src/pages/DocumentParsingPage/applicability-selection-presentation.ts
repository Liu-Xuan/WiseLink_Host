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

export function presentApplicabilitySelectionError(
  reason: unknown,
  action: 'read' | 'save',
): string {
  const raw: string = rawErrorText(reason).toUpperCase();

  if (/CONFLICT|STALE|REVISION/u.test(raw)) {
    return '事项资料已经更新，请重新读取当前选择后再试。';
  }
  if (/UNAUTHORIZED|FORBIDDEN|PERMISSION|ACCESS_DENIED/u.test(raw)) {
    return '当前账户无权读取或修改这项飞机选择。';
  }
  if (/WAITING_INPUT|INPUT_REQUIRED|VALIDATION_FAILED/u.test(raw)) {
    return '需要先填写有效的飞机号和评估日期。';
  }
  return action === 'save'
    ? '暂时无法保存飞机选择，请稍后重试。'
    : '暂时无法读取飞机选择，请稍后重试；现有分析内容仍可查看。';
}

export function presentApplicabilitySelection(
  loadState: ApplicabilitySelectionLoadState,
  selection: CanonicalApplicabilitySelectionReadModel | null,
): ApplicabilitySelectionPresentation {
  if (loadState === 'loading') {
    return {
      state: 'waiting',
      selectionLabel: '正在读取可选调整',
      sourceLabel: '正在核对来源',
      guidance: '正在读取已保存的评估对象调整与受控来源。',
    };
  }
  if (loadState === 'unconfigured') {
    return {
      state: 'unknown',
      selectionLabel: '使用系统自动目标',
      sourceLabel: '分析时由 Host 核对',
      guidance:
        '未设置手动调整；初始分析仍会由 Host 自动冻结受控评估对象和时点，无需工程师确认。',
    };
  }
  if (loadState === 'error') {
    return {
      state: 'error',
      selectionLabel: '可选调整状态未知',
      sourceLabel: '来源状态未知',
      guidance:
        '可选调整暂时无法读取；初始分析仍按 Host 冻结目标运行，现有分析内容可继续查看。',
    };
  }
  if (!selection) {
    return {
      state: 'unknown',
      selectionLabel: '未读取到手动调整',
      sourceLabel: '来源状态未知',
      guidance: '当前没有可展示的手动调整读回。',
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
      guidance: '事项资料已经更新；Host 将基于 current 资料重新冻结评估输入。',
    };
  }
  if (selection.frozenSourceBinding.status === 'MISSING') {
    return {
      state: 'waiting',
      selectionLabel: '调整已保存',
      sourceLabel: '来源待补齐',
      guidance: '评估对象调整已保存，但受控来源尚未完整绑定。',
    };
  }
  return {
    state: 'success',
    selectionLabel: '调整已同步',
    sourceLabel: '来源已绑定',
    guidance: '评估对象调整与受控来源均已读取。',
  };
}
