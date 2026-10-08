import type { TdmsRawCode, TdmsRecordKind, TdmsRelationAssertion, TdmsSourceVersion } from '@shared/tdms-source.interface';

/** Explicit source labels do not verify a revision/completion rule with known endpoint, scope or basis gaps. */
export function tdmsRevisionRuleNeedsVerification(assertion: Pick<TdmsRelationAssertion, 'authority' | 'coverage'>): boolean {
  return assertion.authority !== 'SOURCE_EXPLICIT' ||
    assertion.coverage.gaps.some(gap => gap.startsWith('REVISION_RULE_'));
}

export const tdmsRecordKindLabel = (kind: TdmsRecordKind): string => ({
  MANUFACTURER_FILE: '厂家文件', PROCESSING_SHEET: '文件处理单',
  ENGINEER_ASSESSMENT: '专业评估单', COMMENT: '评论或补充意见',
  ENGINEERING_FILE: '工程文件', SOURCE_EVENT: '来源事件', OBSERVATION: '观察项',
})[kind] ?? kind;

export function tdmsRawCodeLabel(value: TdmsRawCode | null | undefined): string {
  if (!value) return '未取得';
  return [...new Set([value.rawCode, value.rawName].filter((item): item is string => Boolean(item)))].join(' · ') || '未取得';
}

export function tdmsSourceVersionLabel(value: TdmsSourceVersion, layer = 'TDMS 技术对象'): string {
  const parts: string[] = [];
  if (value.rawRevision !== null) parts.push(`${layer}版次 ${value.rawRevision}`);
  if (value.rawIteration !== null) parts.push(`${layer}迭代 ${value.rawIteration}`);
  parts.push(value.confirmation === 'VERSION_UNCONFIRMED' ? '源版本未确认' : '源声明版本');
  return parts.join(' · ');
}

/** General type guidance never supplies a missing target, interval, mandate or completion. */
export function tdmsFileTypeNote(type: TdmsRawCode | null): string | null {
  switch (type?.rawCode?.toUpperCase()) {
    case 'AEO': return 'AEO 常见为逐架一次性改装；本条对象、频次和要求以源记录为准。';
    case 'CEO-S': return 'CEO-S 用于控制附件送修；具体附件、要求和范围见源记录。';
    case 'MT': return 'MT 为非强制维护提示；保留原始建议、条件和范围。';
    case 'EB': return 'EB 有一定约束性；须核对原始要求和范围，不能仅凭类型判断法规强制。';
    default: return null;
  }
}

export const tdmsJsonText = (value: unknown): string => value === null || value === undefined
  ? '未取得' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
