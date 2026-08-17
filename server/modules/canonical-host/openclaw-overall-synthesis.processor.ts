import type {
  CanonicalBaseRuleCandidateProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import type { FeishuNativeOemSearchRun } from '../external-discovery/feishu-native-oem-monitoring-ingress';

const RULE_COLUMNS = [
  'ruleId',
  'result',
  'factsConsidered',
  'ruleApplication',
  'analysisSummary',
  'conclusion',
  'sourceRefs',
  'missingInputs',
  'humanReviewRequired',
] as const;
const OUTPUT_KEYS = [
  'sourceResultId', 'documentVersionId', 'packageId', 'baseRuleRevision',
  'baseRuleArtifactSha256', 'discoveryStatus', 'gap', 'candidateRefCount',
  'findingCount', 'unresolvedCount', 'authorityLevel',
  'externalDiscoveryIsEvidence', 'overallCandidate', 'findings',
  'missingInputs', 'applicabilityStatus', 'engineeringReviewRequired',
  'adopted', 'usableAsEvidence', 'providers',
] as const;

export interface OpenClawOverallSynthesisInput {
  operation: 'SYNTHESIZE_OVERALL_CANDIDATE';
  outputCorrelationRef: string;
  baseRuleResult: Record<string, unknown>;
  unifiedSourceContext: Record<string, unknown>;
  adoptedDocumentVersions: Array<Record<string, unknown>>;
  externalDiscoveryResults: Array<Record<string, unknown>>;
}

export function buildOpenClawOverallSynthesisInput(input: {
  workItem: CanonicalWorkItemProjection;
  baseRules: CanonicalBaseRuleCandidateProjection;
  baseArtifactBytes: Uint8Array;
  packageBytes: Uint8Array;
  discoveries: FeishuNativeOemSearchRun[];
  sourceEvidenceCandidates: unknown[];
  outputCorrelationRef: string;
}): OpenClawOverallSynthesisInput {
  const baseOutput = parseObject(input.baseArtifactBytes, 'BASE_ARTIFACT_JSON_INVALID');
  const pkg = parseObject(input.packageBytes, 'PACKAGE_ARTIFACT_JSON_INVALID');
  const sourceRefs = requiredArray(pkg.sourceRefs, 'SOURCE_CONTEXT_REFS_INVALID')
    .map((value) => {
      const ref = object(value, 'SOURCE_CONTEXT_REF_INVALID');
      const id = text(ref.sourceRefId, 'SOURCE_CONTEXT_REF_ID_INVALID');
      return {
        sourceRefId: id,
        locator: `page ${integer(ref.pageStart, 'SOURCE_PAGE_INVALID')}-${integer(ref.pageEnd, 'SOURCE_PAGE_INVALID')}`,
        excerpt: null,
      };
    });
  const knownRefs = new Set(sourceRefs.map(({ sourceRefId }) => sourceRefId));
  const candidateRefs = sourceEvidenceCandidateRefs(
    input.sourceEvidenceCandidates,
    knownRefs,
  );
  const ruleResults = object(baseOutput.ruleResults, 'BASE_RULE_RESULTS_INVALID');
  if (JSON.stringify(ruleResults.columns) !== JSON.stringify(RULE_COLUMNS)) {
    throw new Error('BASE_RULE_RESULT_COLUMNS_INVALID');
  }
  const rows = requiredArray(ruleResults.rows, 'BASE_RULE_RESULT_ROWS_INVALID');
  if (
    rows.length !== input.baseRules.criterionCount ||
    rows.length !== input.baseRules.evaluationItemCount
  ) {
    throw new Error('BASE_DYNAMIC_N_INCOMPLETE');
  }
  const ids = new Set<string>();
  const items = rows.map((raw, index) => {
    if (!Array.isArray(raw) || raw.length !== RULE_COLUMNS.length) {
      throw new Error(`BASE_RULE_RESULT_ROW_INVALID:${index}`);
    }
    const criterionId = text(raw[0], 'BASE_RULE_ID_INVALID');
    if (ids.has(criterionId)) throw new Error(`BASE_DUPLICATE_CRITERION:${criterionId}`);
    ids.add(criterionId);
    const sourceRefIds = expandBaseSourceRefs(
      textArray(raw[6], 'BASE_ITEM_SOURCE_REFS_INVALID'),
      candidateRefs,
      knownRefs,
    );
    return {
      criterionId,
      status: text(raw[1], 'BASE_ITEM_STATUS_INVALID'),
      sourceRefIds,
      fact: compactFact(raw[2]),
      analysis: `${text(raw[3], 'BASE_ITEM_RULE_APPLICATION_INVALID')}\n${text(raw[4], 'BASE_ITEM_ANALYSIS_INVALID')}`,
      candidateConclusion: text(raw[5], 'BASE_ITEM_CONCLUSION_INVALID'),
      missingInputs: textArray(raw[7], 'BASE_ITEM_MISSING_INPUTS_INVALID'),
      authorityLevel: 'candidate_only',
    };
  });
  const unresolvedCount = items.filter((item) => item.missingInputs.length > 0).length;
  const sourceBoundCandidateCount = items.filter((item) => item.sourceRefIds.length > 0).length;
  if (
    unresolvedCount !== input.baseRules.unresolvedCount ||
    sourceBoundCandidateCount !== input.baseRules.sourceBoundCandidateCount
  ) {
    throw new Error('BASE_RULE_RESULT_SUMMARY_MISMATCH');
  }
  const documentIdentity = input.workItem.package?.documentIdentity;
  const documentNumber = documentIdentity?.documentCode ?? input.workItem.source.documentId;
  const revisionLabel = documentIdentity?.businessRevision ?? 'UNSPECIFIED';
  const modelInput: OpenClawOverallSynthesisInput = {
    operation: 'SYNTHESIZE_OVERALL_CANDIDATE',
    outputCorrelationRef: input.outputCorrelationRef,
    baseRuleResult: {
      sourceResultId: input.baseRules.sourceResultId,
      revision: input.baseRules.revision,
      artifactSha256: `sha256:${input.baseRules.artifact.sha256}`,
      documentVersionId: input.workItem.source.documentVersionId,
      packageId: input.workItem.package?.packageId,
      packageArtifactSha256: `sha256:${input.workItem.package?.artifact.sha256}`,
      criterionSetId: input.baseRules.criterionSetId,
      criterionCount: input.baseRules.criterionCount,
      evaluationItemCount: input.baseRules.evaluationItemCount,
      unresolvedCount,
      sourceBoundCandidateCount,
      items,
    },
    unifiedSourceContext: {
      documentVersionId: input.workItem.source.documentVersionId,
      packageId: input.workItem.package?.packageId,
      packageArtifactSha256: `sha256:${input.workItem.package?.artifact.sha256}`,
      contractRevision: input.workItem.package?.contractRevision,
      contentUnitCount: input.workItem.package?.contentUnitCount,
      sourceRefCount: sourceRefs.length,
      sourceRefs,
    },
    adoptedDocumentVersions: [{
      documentVersionId: input.workItem.source.documentVersionId,
      publisher: publisher(input.workItem.classification.parserProfileId),
      documentNumber,
      revisionLabel,
      adoptionStatus: 'ADOPTED',
      currentness: 'CURRENT',
    }],
    externalDiscoveryResults: input.discoveries.map(toHostedDiscovery),
  };
  rejectPrivateAuthority(modelInput);
  return modelInput;
}

function sourceEvidenceCandidateRefs(
  candidates: unknown[],
  knownRefs: Set<string>,
): Map<string, string[]> {
  if (!Array.isArray(candidates)) {
    throw new Error('BASE_SOURCE_EVIDENCE_CATALOG_INVALID');
  }
  const result = new Map<string, string[]>();
  for (const value of candidates) {
    const candidate = object(value, 'BASE_SOURCE_EVIDENCE_CANDIDATE_INVALID');
    const candidateId = text(
      candidate.candidateId,
      'BASE_SOURCE_EVIDENCE_CANDIDATE_ID_INVALID',
    );
    const refs = requiredArray(
      candidate.sourceRefs,
      'BASE_SOURCE_EVIDENCE_CANDIDATE_REFS_INVALID',
    ).map((sourceRef) => {
      const sourceRefId = text(
        object(sourceRef, 'BASE_SOURCE_EVIDENCE_CANDIDATE_REF_INVALID')
          .sourceRefId,
        'BASE_SOURCE_EVIDENCE_CANDIDATE_REF_ID_INVALID',
      );
      if (!knownRefs.has(sourceRefId)) {
        throw new Error(`BASE_SOURCE_EVIDENCE_UNKNOWN_SOURCE_REF:${sourceRefId}`);
      }
      return sourceRefId;
    });
    if (refs.length === 0) {
      throw new Error(`BASE_SOURCE_EVIDENCE_CANDIDATE_UNBOUND:${candidateId}`);
    }
    const normalized = [...new Set(refs)];
    const existing = result.get(candidateId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) {
      throw new Error(`BASE_SOURCE_EVIDENCE_CANDIDATE_DRIFT:${candidateId}`);
    }
    result.set(candidateId, normalized);
  }
  return result;
}

function expandBaseSourceRefs(
  refs: string[],
  candidateRefs: Map<string, string[]>,
  knownRefs: Set<string>,
): string[] {
  const expanded: string[] = [];
  for (const ref of refs) {
    if (knownRefs.has(ref)) {
      expanded.push(ref);
      continue;
    }
    const mapped = candidateRefs.get(ref);
    if (!mapped) throw new Error(`BASE_UNKNOWN_SOURCE_REF:${ref}`);
    expanded.push(...mapped);
  }
  return [...new Set(expanded)];
}

export function consumeOpenClawOverallSynthesisOutput(
  input: OpenClawOverallSynthesisInput,
  output: string,
): Record<string, unknown> {
  const parsed = parseObject(new TextEncoder().encode(output), 'OVERALL_OUTPUT_JSON_INVALID');
  exactKeys(parsed, OUTPUT_KEYS, 'OVERALL_OUTPUT');
  same(parsed.sourceResultId, input.outputCorrelationRef, 'OVERALL_CORRELATION_MISMATCH');
  same(parsed.documentVersionId, input.baseRuleResult.documentVersionId, 'OVERALL_DOCUMENT_VERSION_MISMATCH');
  same(parsed.packageId, input.baseRuleResult.packageId, 'OVERALL_PACKAGE_ID_MISMATCH');
  same(parsed.baseRuleRevision, input.baseRuleResult.revision, 'OVERALL_BASE_REVISION_MISMATCH');
  same(parsed.baseRuleArtifactSha256, input.baseRuleResult.artifactSha256, 'OVERALL_BASE_ARTIFACT_MISMATCH');
  same(parsed.authorityLevel, 'candidate_only', 'OVERALL_AUTHORITY_INVALID');
  same(parsed.externalDiscoveryIsEvidence, false, 'OVERALL_DISCOVERY_EVIDENCE_INVALID');
  same(parsed.adopted, false, 'OVERALL_ADOPTION_INVALID');
  same(parsed.usableAsEvidence, false, 'OVERALL_DISCOVERY_USE_AS_EVIDENCE_INVALID');
  same(parsed.engineeringReviewRequired, true, 'OVERALL_ENGINEER_REVIEW_REQUIRED');
  if (!['UNKNOWN/WAITING_INPUT', 'CANDIDATE_REVIEW_REQUIRED'].includes(String(parsed.applicabilityStatus))) {
    throw new Error('OVERALL_APPLICABILITY_STATUS_INVALID');
  }
  text(parsed.overallCandidate, 'OVERALL_CANDIDATE_INVALID');
  nullableText(parsed.gap, 'OVERALL_GAP_INVALID');
  const findings = requiredArray(parsed.findings, 'OVERALL_FINDINGS_INVALID');
  same(parsed.findingCount, findings.length, 'OVERALL_FINDING_COUNT_MISMATCH');
  const knownRefs = new Set(
    requiredArray(input.unifiedSourceContext.sourceRefs, 'SOURCE_CONTEXT_REFS_INVALID')
      .map((value) => text(object(value, 'SOURCE_REF_INVALID').sourceRefId, 'SOURCE_REF_ID_INVALID')),
  );
  findings.forEach((value) => {
    const finding = object(value, 'OVERALL_FINDING_INVALID');
    exactKeys(finding, ['finding', 'basis', 'sourceRefIds', 'assumptions', 'uncertainty'], 'OVERALL_FINDING');
    text(finding.finding, 'OVERALL_FINDING_INVALID');
    text(finding.basis, 'OVERALL_FINDING_BASIS_INVALID');
    text(finding.uncertainty, 'OVERALL_UNCERTAINTY_INVALID');
    textArray(finding.assumptions, 'OVERALL_ASSUMPTIONS_INVALID');
    textArray(finding.sourceRefIds, 'OVERALL_SOURCE_REFS_INVALID').forEach((ref) => {
      if (!knownRefs.has(ref)) throw new Error(`OVERALL_UNKNOWN_SOURCE_REF:${ref}`);
    });
  });
  textArray(parsed.missingInputs, 'OVERALL_MISSING_INPUTS_INVALID');
  const candidateCount = input.externalDiscoveryResults.reduce(
    (total, value) => total + requiredArray(value.candidates, 'DISCOVERY_CANDIDATES_INVALID').length,
    0,
  );
  same(parsed.candidateRefCount, candidateCount, 'OVERALL_CANDIDATE_COUNT_MISMATCH');
  same(parsed.discoveryStatus, canonicalDiscoveryStatus(input.externalDiscoveryResults), 'OVERALL_DISCOVERY_STATUS_MISMATCH');
  same(JSON.stringify(parsed.providers), JSON.stringify(providerSummaries(input.externalDiscoveryResults)), 'OVERALL_PROVIDER_SUMMARY_MISMATCH');
  rejectAuthoritativeNarrative(parsed, findings);
  count(parsed.unresolvedCount, 'OVERALL_UNRESOLVED_COUNT_INVALID');
  return parsed;
}

function toHostedDiscovery(run: FeishuNativeOemSearchRun): Record<string, unknown> {
  const provider = providerFromRun(run);
  const resultStatus = {
    CANDIDATES_FOUND: 'COMPLETE',
    PARTIAL_RESULTS: 'PARTIAL',
    ZERO_RESULTS_FOR_TARGET_IDENTIFIER: 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
    ACCESS_DENIED: 'ACCESS_DENIED',
    TRUNCATED: 'TRUNCATED',
  }[run.resultStatus];
  return {
    runtime: 'FEISHU_HOSTED_OPENCLAW',
    runtimeAppId: 'app_17c3zn24kv2',
    provider,
    query: run.query,
    resultStatus,
    observedAt: run.observedAt,
    candidates: run.candidates.map((candidate) => ({
      title: candidate.title,
      sourceUrl: candidate.url,
      documentNumber: null,
      revisionLabel: null,
      snippet: null,
      relationshipReason: candidate.disposition,
      matchLevel: candidate.disposition === 'DIRECT_OFFICIAL_SOURCE_MATCH' ? 'DIRECT' : 'TANGENTIAL',
    })),
    accessRestricted: run.accessRestricted,
    truncated: run.truncated,
    partialOnly: run.partialOnly,
    excludedNonOemCandidateCount: 0,
    error: run.failureCode ? { code: run.failureCode, message: `Discovery provider reported ${run.failureCode}.` } : null,
  };
}

function providerFromRun(run: FeishuNativeOemSearchRun): 'AIRBUS' | 'BOEING' | 'COMAC' {
  if (run.sourceSystem !== 'FEISHU_HOSTED_OPENCLAW') {
    throw new Error('OPENCLAW_DISCOVERY_SOURCE_SYSTEM_INVALID');
  }
  const match = /^search:(airbus|boeing|comac):/u.exec(run.searchRunRef);
  if (!match) throw new Error('OPENCLAW_DISCOVERY_PROVIDER_IDENTITY_INVALID');
  const provider = match[1].toUpperCase() as 'AIRBUS' | 'BOEING' | 'COMAC';
  if (run.candidates.some((candidate) => candidate.publisher !== provider)) {
    throw new Error('OPENCLAW_DISCOVERY_PROVIDER_CANDIDATE_DRIFT');
  }
  return provider;
}

function publisher(profileId: string): string {
  return /issuer\.([a-z]+)/u.exec(profileId)?.[1]?.toUpperCase() ?? 'CONTROLLED_DOCUMENT_MANAGEMENT';
}

function canonicalDiscoveryStatus(results: Array<Record<string, unknown>>): string {
  if (results.length === 0) return 'NO_DISCOVERY';
  return [...results]
    .sort((a, b) => String(a.provider).localeCompare(String(b.provider)))
    .map((value) => `${String(value.provider)}:${value.resultStatus === 'PARTIAL' ? 'PARTIAL_RESULTS' : String(value.resultStatus)}`)
    .join(';');
}

function providerSummaries(results: Array<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(results
    .map((value) => {
      const candidates = requiredArray(value.candidates, 'DISCOVERY_CANDIDATES_INVALID');
      return [String(value.provider).toLowerCase(), {
        status: value.resultStatus === 'PARTIAL' ? 'PARTIAL_RESULTS' : value.resultStatus,
        match: candidates.some((candidate) => object(candidate, 'DISCOVERY_CANDIDATE_INVALID').matchLevel === 'DIRECT')
          ? 'DIRECT_OFFICIAL_SOURCE_MATCH' : 'NO_DIRECT_OFFICIAL_SOURCE_MATCH',
        accessRestricted: value.accessRestricted,
        candidateCount: candidates.length,
        failureCode: objectOrNull(value.error)?.code ?? null,
        source: 'OFFICIAL_OEM_PUBLIC_SOURCE',
        baiduAcceptedAsOfficial: false,
      }] as [string, Record<string, unknown>];
    })
    .sort(([left], [right]) => left.localeCompare(right)));
}

function rejectPrivateAuthority(value: unknown): void {
  const textValue = JSON.stringify(value);
  for (const key of ['workItemId', 'actionAttemptId', 'expectedRevision', 'actor', 'authority', 'apiKey', 'headers']) {
    if (textValue.includes(`\"${key}\"`)) throw new Error(`FORBIDDEN_AUTHORITY_INPUT:${key}`);
  }
}

function rejectAuthoritativeNarrative(output: Record<string, unknown>, findings: unknown[]): void {
  const narrative = [output.overallCandidate, ...findings.flatMap((value) => {
    const finding = object(value, 'OVERALL_FINDING_INVALID');
    return [finding.finding, finding.basis, finding.uncertainty, ...requiredArray(finding.assumptions, 'OVERALL_ASSUMPTIONS_INVALID')];
  })].join('\n');
  if ([/(?:已确认|确认)(?:该)?(?:机队)?(?:不)?适用/u, /(?:已批准|批准执行|批准放行|可直接实施|可以直接实施)/u, /\b(?:approved|airworthiness conclusion|confirmed applicable|confirmed inapplicable|safe to release)\b/iu].some((pattern) => pattern.test(narrative))) {
    throw new Error('OVERALL_AUTHORITATIVE_NARRATIVE_FORBIDDEN');
  }
}

function parseObject(bytes: Uint8Array, code: string): Record<string, unknown> {
  try { return object(JSON.parse(new TextDecoder().decode(bytes)), code); } catch { throw new Error(code); }
}
function object(value: unknown, code: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code); return value as Record<string, unknown>; }
function objectOrNull(value: unknown): Record<string, unknown> | null { return value === null ? null : object(value, 'OBJECT_INVALID'); }
function requiredArray(value: unknown, code: string): unknown[] { if (!Array.isArray(value)) throw new Error(code); return value; }
function text(value: unknown, code: string): string { if (typeof value !== 'string' || value.trim() === '') throw new Error(code); return value; }
function textArray(value: unknown, code: string): string[] { const values = requiredArray(value, code); if (values.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(code); return values as string[]; }
function nullableText(value: unknown, code: string): void { if (value !== null && (typeof value !== 'string' || !value.trim())) throw new Error(code); }
function integer(value: unknown, code: string): number { if (!Number.isSafeInteger(value)) throw new Error(code); return Number(value); }
function count(value: unknown, code: string): number { const result = integer(value, code); if (result < 0) throw new Error(code); return result; }
function same(actual: unknown, expected: unknown, code: string): void { if (actual !== expected) throw new Error(code); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[], code: string): void { if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value)) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`${code}_SHAPE_INVALID`); }
function compactFact(value: unknown): string | null { if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return null; if (typeof value === 'string') return value.trim() || null; return JSON.stringify(value); }
