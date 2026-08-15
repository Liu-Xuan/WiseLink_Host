export type FeishuNativeOemResultStatus =
  | 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER'
  | 'ACCESS_DENIED'
  | 'PARTIAL_RESULTS'
  | 'TRUNCATED'
  | 'CANDIDATES_FOUND';

export interface FeishuNativeOemSearchCandidate {
  candidateRef: string;
  publisher: 'AIRBUS' | 'BOEING' | 'COMAC';
  title: string;
  url: string;
  disposition: string;
}

export interface FeishuNativeOemSearchRun {
  searchRunRef: string;
  sourceSystem: string;
  query: string;
  resultStatus: FeishuNativeOemResultStatus;
  observedAt: string;
  accessRestricted: boolean;
  truncated: boolean;
  partialOnly: boolean;
  candidates: FeishuNativeOemSearchCandidate[];
}

export interface FeishuNativeOemServerContext {
  actorUserId: string;
  tenantId: string;
  roles: string[];
}

export interface FeishuNativeOemHumanSelection {
  searchRunRef: string;
  candidateRef: string;
  decision: 'HUMAN_SELECTED_FOR_INGEST';
  reviewedBy: string;
  reviewedAt: string;
  publisher: string;
  sourceUrl: string;
}

export interface FeishuNativeOemHumanRejection {
  searchRunRef: string;
  candidateRef: string;
  decision: 'HUMAN_REJECTED';
  reviewedBy: string;
  reviewedAt: string;
  publisher: string;
  sourceUrl: string;
}

export interface FeishuNativeOemCandidateStore {
  recordSearchRun(
    searchRun: FeishuNativeOemSearchRun,
    context: FeishuNativeOemServerContext,
  ): Promise<unknown>;
  readSearchRun(
    searchRunRef: string,
    context: FeishuNativeOemServerContext,
  ): Promise<FeishuNativeOemSearchRun | null>;
  recordHumanSelection(
    selection: FeishuNativeOemHumanSelection,
    context: FeishuNativeOemServerContext,
  ): Promise<unknown>;
  recordHumanRejection(
    rejection: FeishuNativeOemHumanRejection,
    context: FeishuNativeOemServerContext,
  ): Promise<unknown>;
  readHumanSelection(
    searchRunRef: string,
    candidateRef: string,
    context: FeishuNativeOemServerContext,
  ): Promise<FeishuNativeOemHumanSelection | null>;
}

export interface OemMonitoringDocumentManagementPort {
  ingestFileServiceSelection(
    request: unknown,
    context: FeishuNativeOemServerContext,
  ): Promise<unknown>;
}

const SEARCH_RUN_STATUSES = new Set<FeishuNativeOemResultStatus>([
  'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
  'ACCESS_DENIED',
  'PARTIAL_RESULTS',
  'TRUNCATED',
  'CANDIDATES_FOUND',
]);
const OEM_PUBLISHERS = new Set(['AIRBUS', 'BOEING', 'COMAC']);
const DIRECT_MATCH = 'DIRECT_OFFICIAL_SOURCE_MATCH';

export class FeishuNativeOemMonitoringIngress {
  private readonly now: () => string;

  constructor(private readonly input: {
    candidateStore: FeishuNativeOemCandidateStore;
    documentManagement: OemMonitoringDocumentManagementPort;
    now?: () => string;
  }) {
    this.now = input.now ?? (() => new Date().toISOString());
  }

  recordSearchRun(
    searchRun: FeishuNativeOemSearchRun,
    context: FeishuNativeOemServerContext,
  ): Promise<unknown> {
    const normalizedContext = requiredServerContext(context);
    return this.input.candidateStore.recordSearchRun(
      normalizeSearchRun(searchRun),
      normalizedContext,
    );
  }

  async recordHumanSelection(
    input: unknown,
    context: FeishuNativeOemServerContext,
  ): Promise<unknown> {
    const value = ordinaryObject(input);
    rejectSelfReportedAuthority(value);
    if (value.decision !== 'HUMAN_SELECTED_FOR_INGEST') {
      fail('OEM_MONITORING_HUMAN_SELECTION_REQUIRED', 'Only explicit human selection can authorize admission.');
    }
    const normalizedContext = requiredServerContext(context);
    const searchRunRef = requiredText(value.searchRunRef, 'input.searchRunRef');
    const candidateRef = requiredText(value.candidateRef, 'input.candidateRef');
    const searchRun = await this.requiredSearchRun(searchRunRef, normalizedContext);
    const candidate = selectedCandidate(searchRun, candidateRef);
    return this.input.candidateStore.recordHumanSelection({
      searchRunRef,
      candidateRef,
      decision: 'HUMAN_SELECTED_FOR_INGEST',
      reviewedBy: normalizedContext.actorUserId,
      reviewedAt: this.now(),
      publisher: candidate.publisher,
      sourceUrl: candidate.url,
    }, normalizedContext);
  }

  async recordHumanRejection(
    input: unknown,
    context: FeishuNativeOemServerContext,
  ): Promise<unknown> {
    const value = ordinaryObject(input);
    rejectSelfReportedAuthority(value);
    if (value.decision !== 'HUMAN_REJECTED') {
      fail('OEM_MONITORING_HUMAN_REJECTION_REQUIRED', 'Only explicit human rejection can close the candidate.');
    }
    const normalizedContext = requiredServerContext(context);
    const searchRunRef = requiredText(value.searchRunRef, 'input.searchRunRef');
    const candidateRef = requiredText(value.candidateRef, 'input.candidateRef');
    const searchRun = await this.requiredSearchRun(searchRunRef, normalizedContext);
    const candidate = searchRun.candidates.find((entry) => entry.candidateRef === candidateRef);
    if (!candidate) {
      fail('OEM_MONITORING_CANDIDATE_NOT_FOUND', `Candidate not found: ${candidateRef}`);
    }
    return this.input.candidateStore.recordHumanRejection({
      searchRunRef,
      candidateRef,
      decision: 'HUMAN_REJECTED',
      reviewedBy: normalizedContext.actorUserId,
      reviewedAt: this.now(),
      publisher: candidate.publisher,
      sourceUrl: candidate.url,
    }, normalizedContext);
  }

  async ingestSelectedCandidate(
    input: unknown,
    context: FeishuNativeOemServerContext,
  ): Promise<unknown> {
    const value = ordinaryObject(input);
    rejectSelfReportedAuthority(value);
    const normalizedContext = requiredServerContext(context);
    const searchRunRef = requiredText(value.searchRunRef, 'input.searchRunRef');
    const candidateRef = requiredText(value.candidateRef, 'input.candidateRef');
    const searchRun = await this.requiredSearchRun(searchRunRef, normalizedContext);
    const candidate = selectedCandidate(searchRun, candidateRef);
    const review = await this.input.candidateStore.readHumanSelection(
      searchRunRef,
      candidateRef,
      normalizedContext,
    );
    if (!review) {
      fail('OEM_MONITORING_HUMAN_SELECTION_REQUIRED', 'Candidate must be selected before FileService/DM I/O.');
    }
    return this.input.documentManagement.ingestFileServiceSelection({
      sourceChannel: 'openclaw_external_monitor_review',
      sourceRef: candidateRef,
      selection: value.selection,
      descriptor: {
        ...ordinaryObject(value.descriptor ?? {}),
        externalDiscovery: {
          discoverySystem: searchRun.sourceSystem,
          publisher: candidate.publisher,
          searchRunRef,
          candidateRef,
          observedAt: searchRun.observedAt,
          sourceUrl: candidate.url,
          sourceLocator: 'MIAODA_FILE_SERVICE_SELECTION',
          disposition: 'HUMAN_SELECTED_FOR_INGEST',
          selectionReview: {
            decision: review.decision,
            reviewedBy: review.reviewedBy,
            reviewedAt: review.reviewedAt,
          },
        },
        authorityClass: 'OEM_REFERENCE_ONLY',
        engineeringConclusionAllowed: false,
        applicabilityConclusionAllowed: false,
      },
      idempotencyKey: requiredText(value.idempotencyKey, 'input.idempotencyKey'),
    }, normalizedContext);
  }

  private async requiredSearchRun(
    searchRunRef: string,
    context: FeishuNativeOemServerContext,
  ): Promise<FeishuNativeOemSearchRun> {
    const run = await this.input.candidateStore.readSearchRun(searchRunRef, context);
    if (!run) {
      fail('OEM_MONITORING_SEARCH_RUN_NOT_FOUND', `SearchRun not found: ${searchRunRef}`);
    }
    return run;
  }
}

function normalizeSearchRun(value: FeishuNativeOemSearchRun): FeishuNativeOemSearchRun {
  const input = ordinaryObject(value);
  rejectSelfReportedAuthority(input);
  const resultStatus = requiredText(input.resultStatus, 'searchRun.resultStatus') as FeishuNativeOemResultStatus;
  if (!SEARCH_RUN_STATUSES.has(resultStatus)) {
    fail('OEM_MONITORING_RESULT_STATUS_INVALID', `Unsupported SearchRun status: ${resultStatus}`);
  }
  if (!Array.isArray(input.candidates)) {
    fail('OEM_MONITORING_CANDIDATES_INVALID', 'searchRun.candidates must be an array.');
  }
  const candidates = input.candidates.map(normalizeCandidate);
  const directMatches = candidates.filter((candidate) => candidate.disposition === DIRECT_MATCH);
  if (resultStatus === 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER' && directMatches.length > 0) {
    fail('OEM_MONITORING_ZERO_RESULT_CONFLICT', 'ZERO_RESULTS cannot contain a direct target match.');
  }
  if (resultStatus === 'ACCESS_DENIED' && input.accessRestricted !== true) {
    fail('OEM_MONITORING_ACCESS_DENIED_INCONSISTENT', 'ACCESS_DENIED must be access restricted.');
  }
  if (resultStatus === 'PARTIAL_RESULTS' && input.partialOnly !== true && input.truncated !== true) {
    fail('OEM_MONITORING_PARTIAL_RESULT_INCONSISTENT', 'PARTIAL_RESULTS must be partial or truncated.');
  }
  if (resultStatus === 'TRUNCATED' && input.truncated !== true) {
    fail('OEM_MONITORING_TRUNCATED_FLAG_REQUIRED', 'TRUNCATED requires truncated=true.');
  }
  if (resultStatus === 'CANDIDATES_FOUND' && directMatches.length === 0) {
    fail('OEM_MONITORING_DIRECT_MATCH_REQUIRED', 'CANDIDATES_FOUND requires an official direct match.');
  }
  return {
    searchRunRef: requiredText(input.searchRunRef, 'searchRun.searchRunRef'),
    sourceSystem: requiredText(input.sourceSystem, 'searchRun.sourceSystem'),
    query: requiredText(input.query, 'searchRun.query'),
    resultStatus,
    observedAt: requiredText(input.observedAt, 'searchRun.observedAt'),
    accessRestricted: input.accessRestricted === true,
    truncated: input.truncated === true,
    partialOnly: input.partialOnly === true,
    candidates,
  };
}

function normalizeCandidate(value: unknown): FeishuNativeOemSearchCandidate {
  const input = ordinaryObject(value);
  rejectSelfReportedAuthority(input);
  const publisher = requiredText(input.publisher, 'candidate.publisher').toUpperCase();
  if (!OEM_PUBLISHERS.has(publisher)) {
    fail('OEM_MONITORING_PUBLISHER_INVALID', `Unsupported OEM publisher: ${publisher}`);
  }
  const url = requiredText(input.url, 'candidate.url');
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
  } catch {
    fail('OEM_MONITORING_URL_INVALID', 'candidate.url must be an absolute HTTP(S) URL.');
  }
  return {
    candidateRef: requiredText(input.candidateRef, 'candidate.candidateRef'),
    publisher: publisher as FeishuNativeOemSearchCandidate['publisher'],
    title: requiredText(input.title, 'candidate.title'),
    url,
    disposition: requiredText(input.disposition, 'candidate.disposition'),
  };
}

function selectedCandidate(
  searchRun: FeishuNativeOemSearchRun,
  candidateRef: string,
): FeishuNativeOemSearchCandidate {
  if (searchRun.resultStatus !== 'CANDIDATES_FOUND') {
    fail(
      `OEM_MONITORING_${searchRun.resultStatus}_NOT_ADOPTABLE`,
      `${searchRun.resultStatus} SearchRun cannot be adopted.`,
    );
  }
  const candidate = searchRun.candidates.find((entry) => entry.candidateRef === candidateRef);
  if (!candidate) fail('OEM_MONITORING_CANDIDATE_NOT_FOUND', `Candidate not found: ${candidateRef}`);
  if (candidate.disposition !== DIRECT_MATCH) {
    fail('OEM_MONITORING_CANDIDATE_NOT_ADOPTABLE', 'Only a direct official OEM source may be selected.');
  }
  if (searchRun.accessRestricted || searchRun.truncated || searchRun.partialOnly) {
    fail('OEM_MONITORING_SEARCH_RUN_INCOMPLETE', 'Restricted, truncated or partial SearchRun requires another review.');
  }
  return candidate;
}

function requiredServerContext(value: FeishuNativeOemServerContext): FeishuNativeOemServerContext {
  return {
    actorUserId: requiredText(value.actorUserId, 'serverContext.actorUserId'),
    tenantId: requiredText(value.tenantId, 'serverContext.tenantId'),
    roles: Array.isArray(value.roles) ? [...value.roles] : [],
  };
}

function rejectSelfReportedAuthority(value: Record<string, unknown>): void {
  const fields = [
    'actor',
    'authority',
    'reviewedBy',
    'selected',
    'selectionReceipt',
    'documentVersionId',
    'currentness',
    'tenantId',
  ].filter((field) => Object.hasOwn(value, field));
  if (fields.length > 0) {
    fail('OEM_MONITORING_AUTHORITY_FORBIDDEN', `Input cannot report server authority fields: ${fields.join(', ')}.`);
  }
}

function ordinaryObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('OEM_MONITORING_INPUT_INVALID', 'Input must be an object.');
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) fail('OEM_MONITORING_INPUT_INVALID', `${fieldName} is required.`);
  return normalized;
}

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code, statusCode: statusCodeFor(code) });
}

function statusCodeFor(code: string): number {
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('NOT_ADOPTABLE') || code.includes('CONFLICT') || code.includes('INCOMPLETE')) return 409;
  if (code.includes('AUTHORITY_FORBIDDEN')) return 403;
  return 400;
}
