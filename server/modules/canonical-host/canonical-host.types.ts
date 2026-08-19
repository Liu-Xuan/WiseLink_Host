import type {
  CanonicalEntryQueryRequest,
  CanonicalFailureValidationWriteReceipt,
  CanonicalParsedPackageUsagePolicy,
  CanonicalPdfVerticalRunRequest,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import type {
  U0Frozen2FailureAdapterInput,
  U0Frozen2FailureBuildResult,
} from '../unified-reader/unified-reader.types';

export interface CanonicalHostActor {
  userId: string;
  tenantId: string;
  appId: string;
  roles: string[];
  env: string;
}

export interface CanonicalAuthorizationDecision {
  action:
    | 'PARSE_PDF'
    | 'READ_DOCUMENT_PARSING'
    | 'READ_LIBRARY_INDEX'
    | 'QUERY_PARSED_UNITS'
    | 'EVALUATE_JOB_AID'
    | 'RESYNTHESIZE_ASSESSMENT'
    | 'PERSIST_BASE_RULE_RESULT'
    | 'PERSIST_OPENCLAW_DYNAMIC_EVALUATION'
    | 'PERSIST_OPENCLAW_OVERALL'
    | 'RECORD_ENGINEER_REVIEW'
    | 'RECORD_OEM_DISCOVERY_RUN'
    | 'CONFIRM_OPENCLAW_OVERALL_FOR_AEO'
    | 'RUN_AEO_CANDIDATE_LOOP';
  allowed: boolean;
  actorFingerprint: string;
  decisionId: string;
  decisionHash: string;
  permissionSnapshotVersion: string;
}

export interface CanonicalHostActionContext {
  actor: CanonicalHostActor;
  decision: CanonicalAuthorizationDecision;
}

export type CanonicalPdfProducerResult =
  | {
      kind: 'PACKAGE';
      packageId: string;
      contractId: 'techpub.parsed-package.v1';
      contractRevision: 'frozen.2';
      bytes: Uint8Array;
      strictReaderValidated: true;
      executionRoute: string;
      usagePolicy?: CanonicalParsedPackageUsagePolicy;
      documentIdentity?: {
        documentCode: string;
        businessRevision: string | null;
      };
    }
  | {
      kind: 'FAILURE_SIGNAL';
      failureCode: string;
      message: string;
      executionRoute: string;
    };

export interface CanonicalPdfProducerPort {
  producePdf(
    request: CanonicalPdfVerticalRunRequest,
  ): Promise<CanonicalPdfProducerResult>;
}

export interface CanonicalMiaodaAppBindingPort {
  deepLinkForWorkItem(workItemId: string): {
    bindingStatus: 'VERIFIED_CANONICAL';
    appId: string;
    origin: string;
    deepLink: string;
  };
}

export interface CanonicalHostClockPort {
  nowIso(): string;
}

export interface CanonicalFailureValidationWriteAuthorizationPort {
  authorize(input: {
    source: U0Frozen2FailureAdapterInput;
    built: U0Frozen2FailureBuildResult;
  }): Promise<CanonicalFailureValidationWriteReceipt>;
}

export interface CanonicalAuthorizationPort {
  authorize(input: {
    actor: CanonicalHostActor;
    action: CanonicalAuthorizationDecision['action'];
    workItemId: string;
    requestId: string;
    documentVersionId: string;
  }): Promise<CanonicalAuthorizationDecision>;
}

export interface CanonicalPermissionSnapshotPort {
  freshRead(input: {
    actor: CanonicalHostActor;
    decision: CanonicalAuthorizationDecision;
    workItemId: string;
    requestId: string;
    documentVersionId: string;
  }): Promise<{ permissionSnapshotVersion: string }>;
}

export interface CanonicalWorkItemRegistrarPort {
  loadOrCreate(
    seed: Omit<CanonicalWorkItemProjection, 'revision'>,
  ): Promise<CanonicalWorkItemProjection>;
  compareAndSet(input: {
    workItemId: string;
    expectedRevision: number;
    next: Omit<CanonicalWorkItemProjection, 'revision'>;
    syncPrimaryAttempt?: boolean;
  }): Promise<CanonicalWorkItemProjection>;
  getExact(input: {
    workItemId: string;
    requestId: string;
    documentVersionId: string;
  }): Promise<CanonicalWorkItemProjection>;
  getByWorkItemId(workItemId: string): Promise<CanonicalWorkItemProjection>;
}

export interface CanonicalHostBindingState {
  mode: 'DEFAULT_UNCONFIGURED' | 'HOST_CONFIGURED';
  workItemRegistrarConfigured: boolean;
  pdfProducerConfigured: boolean;
  authorizationConfigured: boolean;
  permissionSnapshotConfigured: boolean;
  miaodaAppBindingConfigured: boolean;
  failureValidationWriteAuthorizationConfigured: boolean;
  authority: 'CANDIDATE_COMPOSITION_NOT_CANONICAL_ACTIVATION';
}

export interface CanonicalStatusInput {
  workItemId: string;
  requestId: string;
  documentVersionId: string;
}

export interface CanonicalPageInput {
  workItemId: string;
  query: string;
}

export type CanonicalQueryInput = CanonicalEntryQueryRequest;

export interface CanonicalBaseRuleResult {
  sourceResultId: string;
  workItemId: string;
  documentVersionId: string;
  packageId: string;
  packageArtifactSha256: string;
  criterionSetId: string;
  criterionCount: number;
  evaluationItemCount: number;
  unresolvedCount: number;
  sourceBoundCandidateCount: number;
  artifactBytes: Uint8Array;
}

export interface CanonicalBaseRuleResultProviderPort {
  readonly configured: boolean;
  readResult(input: {
    workItem: CanonicalWorkItemProjection;
    /** Server-owned ActionAttempt identity; the Base trigger must use it as Client-Token. */
    actionAttemptId: string;
    /** WorkItem revision that the eventual candidate must be compared-and-set against. */
    expectedRevision: number;
  }): Promise<CanonicalBaseRuleResult>;
}

export interface CanonicalOpenClawOverallResult {
  sourceResultId: string;
  workItemId: string;
  documentVersionId: string;
  packageId: string;
  baseRuleRevision: number;
  baseRuleArtifactSha256: string;
  discoveryStatus: string;
  gap: string | null;
  candidateRefCount: number;
  findingCount: number;
  unresolvedCount: number;
  authorityLevel: 'candidate_only';
  externalDiscoveryIsEvidence: false;
  artifactBytes: Uint8Array;
}

export interface CanonicalOpenClawOverallProviderPort {
  readonly configured: boolean;
  synthesize(input: {
    workItem: CanonicalWorkItemProjection;
    baseRules: import('@shared/api.interface').CanonicalBaseRuleCandidateProjection;
    /** Server-owned ActionAttempt identity; any external trigger must use it idempotently. */
    actionAttemptId: string;
    expectedRevision: number;
  }): Promise<CanonicalOpenClawOverallResult>;
}
