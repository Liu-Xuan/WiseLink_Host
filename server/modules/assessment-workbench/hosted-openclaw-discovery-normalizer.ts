import type {
  ExternalEngineeringProvider,
  HostedOpenClawDiscoveryResult,
} from './external-discovery-assessment';

/** Shared public-input normalization for the hosted OpenClaw discovery seam. */
export function normalizeHostedOpenClawDiscoveryResult(
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
  if (input.resultStatus === 'COMPLETE' && candidates.length === 0) {
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
