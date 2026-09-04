import type { CanonicalConfigurationEvidenceStatusReadModel } from '@shared/api.interface';

export type ConfigurationEvidenceViewState =
  | 'NOT_QUERIED'
  | 'RUNNING'
  | 'NOT_CONNECTED'
  | 'PARTIAL_OR_FAILED_VALIDATION'
  | 'COMPLETE_WITH_EVIDENCE'
  | 'COMPLETE_TRUSTED_NO_RECORD'
  | 'EVIDENCE_COVERAGE_UNPROVEN'
  | 'NO_RECORD_COVERAGE_UNPROVEN'
  | 'INCONSISTENT_READ_MODEL'
  | 'ACCESS_DENIED'
  | 'CONFLICT'
  | 'TIMEOUT'
  | 'CANCELED';

export interface ConfigurationEvidencePresentation {
  state: ConfigurationEvidenceViewState;
  sourceLabel: string;
  queryLabel: string;
  guidance: string;
  currentCoverageLabel: string;
}

export function presentConfigurationEvidence(
  status: CanonicalConfigurationEvidenceStatusReadModel | null,
): ConfigurationEvidencePresentation {
  const sourceLabel = status
    ? status.source.configured
      ? '查询适配器已配置'
      : '受控事件账本未接通'
    : '查询能力状态不可用';
  const latest = status?.latestQuery;
  if (!status || !latest) {
    return {
      state: 'NOT_QUERIED',
      sourceLabel,
      queryLabel: '尚无查询',
      guidance: status?.source.configured
        ? '尚无构型事件查询记录；缺失事实继续保持 UNKNOWN。'
        : '受控事件账本或跨层复合覆盖合同尚未接通；缺失事实继续保持 UNKNOWN。',
      currentCoverageLabel: currentCoverageLabel(status),
    };
  }

  const latestAdoptedAsCurrent =
    latest.adoptionStatus === 'ADOPTED' && status.current !== null;
  const completeCurrent =
    latestAdoptedAsCurrent && status.current?.sourceCompleteness === 'COMPLETE';
  const completeWithEvidence =
    completeCurrent &&
    latest.terminalStatus === 'SUCCEEDED_EVIDENCE' &&
    latest.sourceRecordCount > 0;
  const completeTrustedNoRecord =
    completeCurrent &&
    latest.terminalStatus === 'SUCCEEDED_NO_RECORD' &&
    latest.sourceRecordCount === 0;
  const terminalCountMismatch =
    (latest.terminalStatus === 'SUCCEEDED_EVIDENCE' &&
      latest.sourceRecordCount === 0) ||
    (latest.terminalStatus === 'SUCCEEDED_NO_RECORD' &&
      latest.sourceRecordCount !== 0);

  if (terminalCountMismatch) {
    return presentation(
      'INCONSISTENT_READ_MODEL',
      sourceLabel,
      '查询状态与记录数不一致',
      'Host 返回的终态与记录数相互矛盾；前端拒绝推断覆盖完整或可信无记录。',
      status,
    );
  }

  if (completeWithEvidence) {
    return presentation(
      'COMPLETE_WITH_EVIDENCE',
      sourceLabel,
      '完整覆盖，已有受控证据',
      'Host current 已证明覆盖完整且包含受控记录；判断仍以当前证据快照为准。',
      status,
    );
  }
  if (completeTrustedNoRecord) {
    return presentation(
      'COMPLETE_TRUSTED_NO_RECORD',
      sourceLabel,
      '完整覆盖，可信无记录',
      'Host current 已证明受控事件账本或跨层复合覆盖完整且无记录；无记录不等于事实为 FALSE。',
      status,
    );
  }

  switch (latest.terminalStatus) {
    case 'RUNNING':
      return presentation(
        'RUNNING',
        sourceLabel,
        '查询中',
        '正在查询受控构型事件；完成前缺失事实继续保持 UNKNOWN。',
        status,
      );
    case 'NOT_CONNECTED':
      return presentation(
        'NOT_CONNECTED',
        sourceLabel,
        '受控事件账本未接通',
        '本次真实查询未取得受控安装事件；不能据此推断无记录或事实为 FALSE。',
        status,
      );
    case 'FAILED_VALIDATION':
      return presentation(
        'PARTIAL_OR_FAILED_VALIDATION',
        sourceLabel,
        '部分结果／校验未通过',
        '查询结果不完整或未通过覆盖校验，不可作为 COMPLETE，也不可闭合无记录判断。',
        status,
      );
    case 'SUCCEEDED_EVIDENCE':
      return presentation(
        'EVIDENCE_COVERAGE_UNPROVEN',
        sourceLabel,
        '已返回记录候选，覆盖未证明',
        '本次查询返回了记录，但浏览器读模型未证明覆盖合同为 COMPLETE；采纳前不能扩张为完整构型事实。',
        status,
      );
    case 'SUCCEEDED_NO_RECORD':
      return presentation(
        'NO_RECORD_COVERAGE_UNPROVEN',
        sourceLabel,
        '零记录候选，覆盖未证明',
        '这里只能证明本次候选返回零记录；只有 Host current 明确证明受控事件账本或跨层复合覆盖 COMPLETE，才能称为可信无记录。',
        status,
      );
    case 'ACCESS_DENIED':
      return presentation(
        'ACCESS_DENIED',
        sourceLabel,
        '事件账本拒绝访问',
        '当前身份无权读取受控事件账本；不可把拒绝访问解释为无记录。',
        status,
      );
    case 'CONFLICT':
      return presentation(
        'CONFLICT',
        sourceLabel,
        '记录存在冲突',
        '受控记录存在冲突，必须完成工程复核后才能继续使用。',
        status,
      );
    case 'TIMEOUT':
      return presentation(
        'TIMEOUT',
        sourceLabel,
        '查询超时',
        '查询未形成可用候选；超时不代表无记录。',
        status,
      );
    case 'CANCELED':
      return presentation(
        'CANCELED',
        sourceLabel,
        '查询已取消',
        '查询已取消，缺失事实继续保持 UNKNOWN。',
        status,
      );
  }
}

function presentation(
  state: ConfigurationEvidenceViewState,
  sourceLabel: string,
  queryLabel: string,
  guidance: string,
  status: CanonicalConfigurationEvidenceStatusReadModel,
): ConfigurationEvidencePresentation {
  return {
    state,
    sourceLabel,
    queryLabel,
    guidance: [guidance, operationalGuidance(status)]
      .filter((value: string) => value !== '')
      .join(' '),
    currentCoverageLabel: currentCoverageLabel(status),
  };
}

function operationalGuidance(
  status: CanonicalConfigurationEvidenceStatusReadModel,
): string {
  const latest = status.latestQuery;
  if (latest?.adoptionBlockReason === 'WORK_ITEM_REVISION_CHANGED') {
    return '事项已更新，旧候选不可采纳；请基于当前版本重新查询。';
  }
  if (status.reevaluation?.servingCurrentPreserved) {
    return 'P0B 正在按适用性、逐项规则、综合评估顺序重算；全部成功前继续提供原当前结果。';
  }
  if (latest?.adoptionStatus === 'ADOPTED') {
    return '构型证据候选已采纳，当前状态由 Host 记录。';
  }
  if (latest?.adoptionEligible) {
    return '候选经 Host 校验为可采纳；采纳后仍需完成适用性、逐项规则和综合评估重算。';
  }
  return '';
}

function currentCoverageLabel(
  status: CanonicalConfigurationEvidenceStatusReadModel | null,
): string {
  const completeness = status?.current?.sourceCompleteness;
  if (completeness === 'COMPLETE') return '当前覆盖：完整';
  if (completeness === 'PARTIAL') return '当前覆盖：不完整';
  if (completeness === 'CONFLICT') return '当前覆盖：存在冲突';
  if (completeness === 'UNKNOWN') return '当前覆盖：未知';
  return '当前覆盖：尚无已采纳证据';
}
