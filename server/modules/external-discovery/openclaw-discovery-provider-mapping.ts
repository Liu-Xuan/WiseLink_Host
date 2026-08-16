import type { FeishuNativeOemSearchRun } from './feishu-native-oem-monitoring-ingress';

const RESULT_STATUSES = new Set<FeishuNativeOemSearchRun['resultStatus']>([
  'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
  'ACCESS_DENIED',
  'PARTIAL_RESULTS',
  'TRUNCATED',
  'CANDIDATES_FOUND',
]);

export const OEM_OFFICIAL_DOMAIN_ROOTS = Object.freeze({
  AIRBUS: Object.freeze(['airbus.com']),
  BOEING: Object.freeze(['boeing.com']),
  COMAC: Object.freeze(['comac.cc']),
});

export const OPENCLAW_DISCOVERY_PROVIDER_MAPPING = Object.freeze({
  ownerCommit: 'ddb77bbf5bc8bb898f93a9e72f171dfee86230e9',
  inputAuthority: 'DISCOVERY_ONLY_NOT_ENGINEERING_EVIDENCE',
  serverOwner: 'CANONICAL_MIAODA_APP',
  searchRunTable: 'external_search_run',
  candidateTable: 'external_discovery_candidate',
  createsAcquisition: false,
  createsDocumentVersion: false,
  createsWorkItem: false,
});

export function isOfficialOemCandidateUrl(
  publisher: unknown,
  value: unknown,
): boolean {
  const normalizedPublisher = String(publisher ?? '').trim().toUpperCase();
  const roots = OEM_OFFICIAL_DOMAIN_ROOTS[
    normalizedPublisher as keyof typeof OEM_OFFICIAL_DOMAIN_ROOTS
  ];
  if (!roots) return false;
  try {
    const parsed = new URL(String(value ?? '').trim());
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    return roots.some(
      (root) => hostname === root || hostname.endsWith(`.${root}`),
    );
  } catch {
    return false;
  }
}

export function mapHostedOpenClawDiscoveryResult(input: {
  providerResult: Record<string, unknown>;
  searchRunRef: string;
  observedAt?: string;
  sourceSystem?: string;
}): FeishuNativeOemSearchRun {
  const result = ordinaryObject(input.providerResult, 'providerResult');
  const searchRunRef = requiredText(input.searchRunRef, 'searchRunRef');
  const resultStatus = requiredText(
    result.resultStatus,
    'providerResult.resultStatus',
  ) as FeishuNativeOemSearchRun['resultStatus'];
  if (!RESULT_STATUSES.has(resultStatus)) {
    fail(
      'OPENCLAW_DISCOVERY_STATUS_UNSUPPORTED',
      `Unsupported hosted OpenClaw resultStatus: ${resultStatus}`,
    );
  }
  if (!Array.isArray(result.candidates)) {
    fail(
      'OPENCLAW_DISCOVERY_RESULT_INVALID',
      'providerResult.candidates must be an array.',
    );
  }
  const failureCode = failureCodeOf(result);
  if (resultStatus === 'ACCESS_DENIED' && !failureCode) {
    fail(
      'OPENCLAW_DISCOVERY_FAILURE_CODE_REQUIRED',
      'ACCESS_DENIED requires a stable provider failureCode.',
    );
  }
  const defaultPublisher = String(result.provider ?? '').trim().toUpperCase();
  const candidates = result.candidates.map((candidateValue, index) => {
    const candidate = ordinaryObject(
      candidateValue,
      `providerResult.candidates[${index}]`,
    );
    const url = requiredText(
      candidate.sourceUrl ?? candidate.url,
      `providerResult.candidates[${index}].sourceUrl`,
    );
    return {
      candidateRef: `${searchRunRef}:candidate:${String(index + 1).padStart(3, '0')}`,
      publisher: requiredText(
        candidate.publisher ?? defaultPublisher,
        `providerResult.candidates[${index}].publisher`,
      ).toUpperCase() as 'AIRBUS' | 'BOEING' | 'COMAC',
      title: requiredText(
        candidate.title ?? url,
        `providerResult.candidates[${index}].title`,
      ),
      url,
      disposition: dispositionOf(candidate),
    };
  });
  return {
    searchRunRef,
    sourceSystem: requiredText(
      input.sourceSystem ?? 'FEISHU_HOSTED_OPENCLAW',
      'sourceSystem',
    ),
    query: requiredText(result.query, 'providerResult.query'),
    resultStatus,
    observedAt: requiredText(input.observedAt ?? result.observedAt, 'observedAt'),
    accessRestricted: result.accessRestricted === true,
    truncated: result.truncated === true,
    partialOnly: result.partialOnly === true,
    failureCode,
    candidates,
  };
}

function dispositionOf(candidate: Record<string, unknown>): string {
  const explicit = String(candidate.disposition ?? '').trim();
  if (explicit) return explicit;
  const matchLevel = String(candidate.matchLevel ?? '').trim().toUpperCase();
  if (matchLevel === 'DIRECT') return 'DIRECT_OFFICIAL_SOURCE_MATCH';
  if (matchLevel === 'TANGENTIAL') return 'TANGENTIAL_NO_DIRECT_MATCH';
  return 'DISCOVERY_CANDIDATE_UNCLASSIFIED';
}

function failureCodeOf(result: Record<string, unknown>): string | null {
  const nested =
    result.error && typeof result.error === 'object' && !Array.isArray(result.error)
      ? (result.error as Record<string, unknown>)
      : null;
  return optionalText(result.failureCode ?? result.errorCode ?? nested?.code);
}

function ordinaryObject(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('OPENCLAW_DISCOVERY_RESULT_INVALID', `${fieldName} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, fieldName: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    fail('OPENCLAW_DISCOVERY_RESULT_INVALID', `${fieldName} is required.`);
  }
  return normalized;
}

function optionalText(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}
