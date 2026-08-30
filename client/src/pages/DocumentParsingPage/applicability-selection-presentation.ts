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
      selectionLabel: '正在读取选择',
      sourceLabel: '正在核对来源',
      guidance: '正在读取工程师已保存的选择与受控来源。',
    };
  }
  if (loadState === 'unconfigured') {
    return {
      state: 'waiting',
      selectionLabel: '等待工程师输入',
      sourceLabel: '保存后核对来源',
      guidance: '填写飞机号和评估日期后保存，系统不会自行推测。',
    };
  }
  if (loadState === 'error') {
    return {
      state: 'error',
      selectionLabel: '选择状态未知',
      sourceLabel: '来源状态未知',
      guidance: '读取暂时不可用，可稍后重试；现有分析内容仍可查看。',
    };
  }
  if (!selection) {
    return {
      state: 'unknown',
      selectionLabel: '选择状态未知',
      sourceLabel: '来源状态未知',
      guidance: '当前没有可展示的受控选择读回。',
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
      guidance: '事项资料已经更新，请重新读取当前选择后再继续评估。',
    };
  }
  if (selection.frozenSourceBinding.status === 'MISSING') {
    return {
      state: 'waiting',
      selectionLabel: '选择已同步',
      sourceLabel: '来源待补齐',
      guidance: '工程师选择已保存，但受控来源尚未完整绑定。',
    };
  }
  return {
    state: 'success',
    selectionLabel: '选择已同步',
    sourceLabel: '来源已绑定',
    guidance: '工程师选择与受控来源均已读取。',
  };
}
