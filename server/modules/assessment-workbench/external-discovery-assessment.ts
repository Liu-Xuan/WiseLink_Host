import type { EvaluationContextPackageResponse } from '@shared/assessment-host.interface';

import type { AilyJobAidEvaluationCandidate } from './assessment-aily-orchestration';
import { prepareOverallSynthesisForAily } from './assessment-aily-orchestration';

export type ExternalEngineeringProvider = 'BOEING' | 'AIRBUS' | 'COMAC';
export type ExternalDiscoveryResultStatus =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'ACCESS_DENIED'
  | 'ZERO_RESULT'
  | 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER'
  | 'TRUNCATED';

export interface HostedOpenClawDiscoveryCandidate {
  title: string;
  sourceUrl: string;
  documentNumber: string | null;
  revisionLabel: string | null;
  snippet: string | null;
  relationshipReason: string;
  matchLevel?: 'DIRECT' | 'TANGENTIAL';
}

/**
 * Ephemeral output of one Feishu-hosted OpenClaw website Skill. This is an
 * in-process handoff type, not a persisted contract or an authority envelope.
 * OpenClaw deliberately does not receive a WorkItem ID or a WiseLink API key.
 */
export interface HostedOpenClawDiscoveryResult {
  runtime: 'FEISHU_HOSTED_OPENCLAW';
  runtimeAppId?: string;
  provider: ExternalEngineeringProvider;
  query: string;
  resultStatus: ExternalDiscoveryResultStatus;
  observedAt: string | null;
  candidates: HostedOpenClawDiscoveryCandidate[];
  accessRestricted?: boolean;
  truncated?: boolean;
  partialOnly?: boolean;
  excludedNonOemCandidateCount?: number;
  error: {
    code: string;
    message: string;
  } | null;
}

export interface ExternalDiscoveryCandidateDraft {
  workItemId: string;
  operations: [
    'assessment.evaluate_by_job_aid',
    'assessment.synthesize_overall',
  ];
  ailyModelInput: {
    jobAidEvaluation: ReturnType<typeof prepareOverallSynthesisForAily>['transport'];
    externalDiscovery: {
      runtimeAppId: string | null;
      provider: ExternalEngineeringProvider;
      query: string;
      resultStatus: ExternalDiscoveryResultStatus;
      observedAt: string | null;
      accessRestricted: boolean;
      truncated: boolean;
      partialOnly: boolean;
      excludedNonOemCandidateCount: number;
      candidates: Array<HostedOpenClawDiscoveryCandidate & {
        adopted: false;
        usableAsEvidence: false;
      }>;
      gap: string | null;
      instruction: string[];
    };
  };
  candidateOnlyDraft: string;
  warningCodes: string[];
  authorityBoundary: AilyJobAidEvaluationCandidate['authorityBoundary'] & {
    externalDiscoveryIsEvidence: false;
    openClawOwnsWorkItem: false;
    openClawPersistsKnowledge: false;
  };
}

/**
 * Joins one external discovery result to an already evaluated WorkItem inside
 * the Aily orchestration layer. It does not persist SearchRun, DocumentVersion
 * or Assessment output. A later Document Management adoption is required
 * before any discovered source may become engineering evidence.
 */
export function prepareExternalDiscoveryCandidateDraftForAily(
  evaluated: AilyJobAidEvaluationCandidate,
  external: HostedOpenClawDiscoveryResult,
  context: EvaluationContextPackageResponse = evaluated.context,
): ExternalDiscoveryCandidateDraft {
  const normalized = normalizeExternalDiscovery(external);
  const synthesis = prepareOverallSynthesisForAily(evaluated, context);
  const gap = resultGap(normalized);
  const externalDiscovery = {
    runtimeAppId: normalized.runtimeAppId ?? null,
    provider: normalized.provider,
    query: normalized.query,
    resultStatus: normalized.resultStatus,
    observedAt: normalized.observedAt,
    accessRestricted: normalized.accessRestricted ?? false,
    truncated: normalized.truncated ?? false,
    partialOnly: normalized.partialOnly ?? false,
    excludedNonOemCandidateCount:
      normalized.excludedNonOemCandidateCount ?? 0,
    candidates: normalized.candidates.map((candidate) => ({
      ...candidate,
      adopted: false as const,
      usableAsEvidence: false as const,
    })),
    gap,
    instruction: [
      '外部网站结果只用于发现相关资料，不得当作工程证据、current 版本或适用性事实。',
      '只有经 Document Management 采纳并形成 exact DocumentVersion、实际文件与解析定位后，才能进入正式证据复核。',
      '即使外部检索为 ACCESS_DENIED、ZERO_RESULT、PARTIAL 或 TRUNCATED，也要保留显式缺口并继续生成 candidate_only 草稿。',
      '只保留 Boeing、Airbus 或 COMAC 官方域名候选；其它来源在进入整体评估输入前剔除。',
    ],
  };
  const warningCodes = [...evaluated.warningCodes];
  if (normalized.candidates.length > 0) {
    warningCodes.push('EXTERNAL_DISCOVERY_NOT_ADOPTED');
  }
  if (gap) warningCodes.push(`EXTERNAL_DISCOVERY_${normalized.resultStatus}`);
  if (normalized.partialOnly) {
    warningCodes.push('EXTERNAL_DISCOVERY_PARTIAL_ONLY');
  }
  if ((normalized.excludedNonOemCandidateCount ?? 0) > 0) {
    warningCodes.push('EXTERNAL_DISCOVERY_NON_OEM_EXCLUDED');
  }

  return {
    workItemId: evaluated.workItemId,
    operations: [evaluated.operation, synthesis.operation],
    ailyModelInput: {
      jobAidEvaluation: synthesis.transport,
      externalDiscovery,
    },
    candidateOnlyDraft: buildCandidateOnlyDraft(
      evaluated,
      externalDiscovery,
    ),
    warningCodes: [...new Set(warningCodes)],
    authorityBoundary: {
      ...evaluated.authorityBoundary,
      externalDiscoveryIsEvidence: false,
      openClawOwnsWorkItem: false,
      openClawPersistsKnowledge: false,
    },
  };
}

function normalizeExternalDiscovery(
  input: HostedOpenClawDiscoveryResult,
): HostedOpenClawDiscoveryResult {
  const untrusted = input as unknown as Record<string, unknown>;
  for (const forbidden of [
    'workItemId',
    'documentVersionId',
    'artifactRef',
    'actor',
    'authority',
  ]) {
    if (forbidden in untrusted) {
      throw new Error(`EXTERNAL_DISCOVERY_FORBIDDEN_FIELD:${forbidden}`);
    }
  }
  if (input.runtime !== 'FEISHU_HOSTED_OPENCLAW') {
    throw new Error('EXTERNAL_DISCOVERY_RUNTIME_UNSUPPORTED');
  }
  if (!['BOEING', 'AIRBUS', 'COMAC'].includes(input.provider)) {
    throw new Error('EXTERNAL_DISCOVERY_PROVIDER_UNSUPPORTED');
  }
  if (![
    'COMPLETE',
    'PARTIAL',
    'ACCESS_DENIED',
    'ZERO_RESULT',
    'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
    'TRUNCATED',
  ].includes(input.resultStatus)) {
    throw new Error('EXTERNAL_DISCOVERY_RESULT_STATUS_UNSUPPORTED');
  }
  const query = requiredText(input.query, 'QUERY');
  const observedAt = input.observedAt === null
    ? null
    : new Date(input.observedAt);
  if (observedAt !== null && Number.isNaN(observedAt.getTime())) {
    throw new Error('EXTERNAL_DISCOVERY_OBSERVED_AT_INVALID');
  }
  if (!Array.isArray(input.candidates)) {
    throw new Error('EXTERNAL_DISCOVERY_CANDIDATES_INVALID');
  }
  const normalizedCandidates = input.candidates.map((candidate) => {
    const sourceUrl = requiredText(candidate.sourceUrl, 'SOURCE_URL');
    if (!sourceUrl.startsWith('https://')) {
      throw new Error('EXTERNAL_DISCOVERY_SOURCE_URL_INVALID');
    }
    return {
      title: requiredText(candidate.title, 'TITLE'),
      sourceUrl,
      documentNumber: optionalText(candidate.documentNumber),
      revisionLabel: optionalText(candidate.revisionLabel),
      snippet: optionalText(candidate.snippet),
      relationshipReason: requiredText(
        candidate.relationshipReason,
        'RELATIONSHIP_REASON',
      ),
      matchLevel: candidate.matchLevel === 'TANGENTIAL'
        ? 'TANGENTIAL' as const
        : 'DIRECT' as const,
    };
  });
  const candidates = normalizedCandidates.filter((candidate) =>
    isOfficialOemUrl(input.provider, candidate.sourceUrl));
  const filteredNonOemCount = normalizedCandidates.length - candidates.length;
  const declaredExcludedCount = input.excludedNonOemCandidateCount ?? 0;
  if (!Number.isInteger(declaredExcludedCount) || declaredExcludedCount < 0) {
    throw new Error('EXTERNAL_DISCOVERY_EXCLUDED_COUNT_INVALID');
  }
  if (
    input.resultStatus === 'COMPLETE' &&
    candidates.length === 0
  ) {
    throw new Error('EXTERNAL_DISCOVERY_COMPLETE_WITHOUT_CANDIDATE');
  }
  if (
    ['ACCESS_DENIED', 'ZERO_RESULT'].includes(input.resultStatus) &&
    candidates.length > 0
  ) {
    throw new Error('EXTERNAL_DISCOVERY_STATUS_CANDIDATE_CONFLICT');
  }
  if (
    input.resultStatus === 'ACCESS_DENIED' &&
    (!input.error?.code || !input.error.message)
  ) {
    throw new Error('EXTERNAL_DISCOVERY_ACCESS_ERROR_REQUIRED');
  }
  return {
    ...input,
    runtimeAppId: input.runtimeAppId
      ? requiredText(input.runtimeAppId, 'RUNTIME_APP_ID')
      : undefined,
    query,
    observedAt: observedAt?.toISOString() ?? null,
    candidates,
    accessRestricted: input.accessRestricted ?? false,
    truncated: input.truncated ?? false,
    partialOnly: input.partialOnly ?? false,
    excludedNonOemCandidateCount:
      declaredExcludedCount + filteredNonOemCount,
    error: input.error
      ? {
          code: requiredText(input.error.code, 'ERROR_CODE'),
          message: requiredText(input.error.message, 'ERROR_MESSAGE'),
        }
      : null,
  };
}

function resultGap(input: HostedOpenClawDiscoveryResult): string | null {
  switch (input.resultStatus) {
    case 'COMPLETE':
      return null;
    case 'ACCESS_DENIED':
      return `ACCESS_DENIED：${input.error?.message ?? '当前账号无法访问来源。'}`;
    case 'ZERO_RESULT':
      return 'ZERO_RESULT：本次查询未发现候选，不能推断 OEM 没有相关文件。';
    case 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER':
      return 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER：未发现目标编号的直接命中；旁相关候选不能证明目标文件存在或不存在。';
    case 'PARTIAL':
      return `PARTIAL：结果不完整，未见内容不能视为不存在。${input.error?.message ? ` ${input.error.message}` : ''}`;
    case 'TRUNCATED':
      return 'TRUNCATED：结果被截断，需要补充分页或缩小查询范围。';
  }
}

function buildCandidateOnlyDraft(
  evaluated: AilyJobAidEvaluationCandidate,
  external: ExternalDiscoveryCandidateDraft['ailyModelInput']['externalDiscovery'],
): string {
  const lines = [
    `候选评估草稿（仅供工程师复核）`,
    `WorkItem：${evaluated.workItemId}`,
    `Job Aid：已完成 ${evaluated.context.criterionCards.length} 个检查项的候选评估；当前输出不得形成工程结论。`,
    `外部检索：${external.provider} / ${external.query} / ${external.resultStatus}。`,
  ];
  if (external.candidates.length > 0) {
    lines.push(`发现 ${external.candidates.length} 条未采纳候选：`);
    for (const candidate of external.candidates) {
      const identity = [candidate.documentNumber, candidate.revisionLabel]
        .filter(Boolean)
        .join(' / ');
      lines.push(
        `- ${candidate.title}${identity ? `（${identity}）` : ''}：[${candidate.matchLevel}] ${candidate.relationshipReason}；仅作发现线索，尚不是证据。`,
      );
    }
  }
  if (external.gap) lines.push(`显式缺口：${external.gap}`);
  if (external.partialOnly) {
    lines.push('覆盖缺口：本次结果为 partialOnly，Airbus/COMAC 等未覆盖来源不能被视为已排除。');
  }
  if (external.excludedNonOemCandidateCount > 0) {
    lines.push(`来源治理：已剔除 ${external.excludedNonOemCandidateCount} 条非 OEM 候选。`);
  }
  lines.push(
    '下一步：工程师选择是否将相关候选送入 Document Management；在 exact DocumentVersion、实际文件和解析定位形成前，保持 candidate_only。',
  );
  return lines.join('\n');
}

function isOfficialOemUrl(
  provider: ExternalEngineeringProvider,
  value: string,
): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  const roots: Record<ExternalEngineeringProvider, string[]> = {
    BOEING: ['boeing.com'],
    AIRBUS: ['airbus.com'],
    COMAC: ['comac.cc'],
  };
  return roots[provider].some((root) =>
    hostname === root || hostname.endsWith(`.${root}`));
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`EXTERNAL_DISCOVERY_${field}_REQUIRED`);
  return normalized;
}

function optionalText(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized || null;
}
