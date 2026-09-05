import type {
  ImmutableReceiptArtifactDescriptor,
  UnifiedAcceptanceCandidateReceipt,
  UnifiedAcceptanceCorrelation,
  UnifiedParseFailureReport,
  UnifiedPackageArtifactDescriptor,
  UnifiedPackageSourceKind,
  U0Frozen2FailureAdapterReceipt,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';

export type { U0Frozen2FailureAdapterReceipt };

export interface ImmutableArtifactPersistResult {
  artifact: UnifiedPackageArtifactDescriptor;
  bytes: Uint8Array;
  reused: boolean;
}

/**
 * Attempt-private bytes which exist in the existing artifact owner but are not
 * published until a WorkItem CAS stores this exact descriptor. The ownerRef is
 * hashed by the adapter and is never exposed as a FileService locator.
 */
export interface StagedCandidateArtifactPersistResult extends ImmutableArtifactPersistResult {
  schemaVersion: 'wiselink.3_1.staged_candidate_artifact.v1';
  ownerRefHash: string;
}

/**
 * Attempt-owned immutable bytes which have completed the ordinary FileService
 * durability/readback boundary and are safe for the WorkItem CAS to publish.
 */
export interface FinalizedCandidateArtifactPersistResult extends ImmutableArtifactPersistResult {
  schemaVersion: 'wiselink.3_1.finalized_candidate_artifact.v1';
  ownerRefHash: string;
}

export type CandidateArtifactPersistResult =
  | StagedCandidateArtifactPersistResult
  | FinalizedCandidateArtifactPersistResult;

/**
 * Attempt-owned transport bytes for one large ResultEnvelope part. The
 * descriptor deliberately omits the FileService path: callers only receive
 * the part identity and actual-byte digest needed for a fenced finalize.
 */
export interface StagedResultEnvelopePart {
  schemaVersion: 'wiselink.3_1.staged_result_envelope_part.v1';
  ownerRefHash: string;
  partIndex: number;
  sha256: string;
  byteLength: number;
  reused: boolean;
}

/**
 * Exact host roles required by the official FileService adapter.  The host
 * supplies this binding; requests cannot choose any of these identities.
 */
export interface UnifiedHostActivationExactBinding {
  canonicalMiaodaHostId: string;
  tenantId: string;
  environment: string;
  roleResolutionRevision: string;
  roleResolutionFingerprint: string;
  canonicalArtifactStoreId: string;
  soleRegistrarServicePrincipal: string;
  immutableReceiptOwnerId: string;
  immutableReceiptOwnerAdapterRevision: string;
  immutableReceiptStoreId: string;
}

export interface UnifiedArtifactStorePort {
  persistAndReadback(
    bytes: Uint8Array,
  ): Promise<ImmutableArtifactPersistResult>;
  readActualBytes(
    artifact: UnifiedPackageArtifactDescriptor,
  ): Promise<Uint8Array>;
}

/**
 * Optional capability of the canonical ordinary artifact owner. Applicability
 * requires this capability so a failed WorkItem CAS cannot leave a published
 * orphan. This remains the same store/owner; it is not a second repository.
 */
export interface UnifiedCandidateArtifactStagingPort extends UnifiedArtifactStorePort {
  stageCandidateAndReadback(input: {
    bytes: Uint8Array;
    ownerRef: string;
  }): Promise<StagedCandidateArtifactPersistResult>;
  finalizeStagedCandidate(
    staged: StagedCandidateArtifactPersistResult,
  ): Promise<FinalizedCandidateArtifactPersistResult>;
  discardCandidateArtifact(
    candidate: CandidateArtifactPersistResult,
  ): Promise<void>;
}

/**
 * Optional capability of the same canonical FileService owner. It stages
 * bounded transport parts at a deterministic attempt-owned path so an exact
 * replay is idempotent and conflicting bytes for one part fail closed.
 */
export interface UnifiedResultEnvelopePartStagingPort extends UnifiedArtifactStorePort {
  stageResultEnvelopePartAndReadback(input: {
    bytes: Uint8Array;
    ownerRef: string;
    partIndex: number;
  }): Promise<StagedResultEnvelopePart>;
  readStagedResultEnvelopePart(input: {
    ownerRef: string;
    part: Omit<StagedResultEnvelopePart, 'reused'>;
  }): Promise<Uint8Array>;
}

export interface ImmutableAcceptanceReceiptOwnerPort {
  readonly activationBinding: UnifiedHostActivationExactBinding;
  persistAndReadback(input: {
    bytes: Uint8Array;
    correlation: UnifiedAcceptanceCorrelation;
    candidateReceipt: UnifiedAcceptanceCandidateReceipt;
  }): Promise<{
    artifact: ImmutableReceiptArtifactDescriptor;
    bytes: Uint8Array;
    reused: boolean;
  }>;
}

export interface U0FullValidationProof {
  status: 'FULL_STRICT_VALIDATOR_PASSED';
  validatorId: 'U0Frozen2SchemaSemanticValidator';
  validatorRevision: string;
  contractId: 'techpub.parsed-package.v1';
  contractRevision: 'frozen.2';
  contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900';
  packageId: string;
  artifactSha256: string;
}

export interface U0ParseFailureValidationProof {
  status: 'FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED';
  validatorId: 'U0Frozen2ParseFailureReportValidator';
  validatorRevision: string;
  contractId: 'techpub.parse-failure-report.v1';
  contractRevision: 'frozen.2';
  contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900';
  failureId: string;
  artifactSha256: string;
}

export interface U0FullPackageValidatorPort {
  validateActualBytes(input: {
    artifact: UnifiedPackageArtifactDescriptor;
    bytes: Uint8Array;
    packageId: string;
  }): Promise<U0FullValidationProof>;
  validateFailureReportActualBytes(input: {
    artifact: UnifiedPackageArtifactDescriptor;
    bytes: Uint8Array;
    failureId: string;
  }): Promise<U0ParseFailureValidationProof>;
}

export type U0FailureProjectStage =
  import('@shared/api.interface').U0FailureProjectStage;
export type U0FailureRetryClass =
  import('@shared/api.interface').U0FailureRetryClass;

export interface U0Frozen2FailureAdapterInput {
  schemaVersion: 'wiselink.3_1.u0_frozen2_failure_adapter_input.v0.candidate.1';
  observedAt: string;
  cause: {
    code: string;
    errorClass: string;
    parameters?: Record<string, string | number | boolean | string[]>;
  };
  source: {
    sourceKind: 'pdf' | 'native_s1000d' | 'unknown';
    sourceArtifactId: string;
    inputRef: string;
    inputHash: string;
  };
  correlation: {
    workItemId: string;
    requestId: string;
    documentId: string | null;
    documentVersionId: string;
    permissionSnapshotVersion: string;
    classificationFingerprint: string;
  };
  packageAttempt: {
    packageId: string;
    contractId: string;
    contractRevision: string;
  } | null;
  producer: {
    producerId: string;
    producerRevision: string;
    producerBuildHash: string;
    executionRoute: string;
  };
}

export interface U0Frozen2FailureBuildResult {
  report: UnifiedParseFailureReport;
  reportBytes: Uint8Array;
  taxonomy: import('@shared/api.interface').U0Frozen2FailureAdapterReceipt['taxonomy'];
}

export interface U0Frozen2FailureAdapterResult {
  report: UnifiedParseFailureReport;
  reportBytes: Uint8Array;
  artifact: UnifiedPackageArtifactDescriptor;
  receipt: import('@shared/api.interface').U0Frozen2FailureAdapterReceipt;
}

export interface U0Frozen2FailureAdapterPort {
  build(input: U0Frozen2FailureAdapterInput): U0Frozen2FailureBuildResult;
  validateActualBytes(input: {
    source: U0Frozen2FailureAdapterInput;
    artifact: UnifiedPackageArtifactDescriptor;
    actualBytes: Uint8Array;
  }): Promise<U0Frozen2FailureAdapterResult>;
}

export interface UnifiedReaderPackageSummary {
  packageId: string;
  contractId: string;
  contractRevision: string;
  sourceKind: UnifiedPackageSourceKind;
  contentHash: string;
  semanticHash: string;
  provenanceHash: string;
  coverageHash: string;
  resultStatus: 'complete' | 'partial';
  title: string;
  revisionLabel: string | null;
  contentUnitCount: number;
  sourceRefCount: number;
  sourceBoundUnitCount: number;
  summaryHash: string;
  queryResults: UnifiedReaderQueryResult[];
}

export type UnifiedReaderPackageInspection = Omit<
  UnifiedReaderPackageSummary,
  'queryResults'
>;

export interface UnifiedReaderSourcePackage {
  inspection: UnifiedReaderPackageInspection;
  units: UnifiedReaderQueryResult[];
}

export interface AeoSpecialistReaderInspection {
  packageId: string;
  contractId: 'aeo_structured_parse_v1';
  contractRevision: 'candidate.1';
  handlerId: string;
  handlerRevision: string;
  summaryHash: string;
  sourceBoundUnitCount: number;
}

export interface AeoSpecialistReaderPort {
  inspectActualBytes(input: {
    artifact: UnifiedPackageArtifactDescriptor;
    bytes: Uint8Array;
    packageId: string;
    context: import('@shared/api.interface').AeoSpecialistAcceptanceContext;
  }): Promise<AeoSpecialistReaderInspection>;
}

export interface UnifiedReaderHostBindingState {
  mode: 'DEFAULT_UNCONFIGURED' | 'HOST_CONFIGURED';
  artifactStoreConfigured: boolean;
  fullU0ValidatorConfigured: boolean;
  immutableAcceptanceReceiptOwnerConfigured: boolean;
  aeoSpecialistReaderConfigured: boolean;
  authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION';
}
