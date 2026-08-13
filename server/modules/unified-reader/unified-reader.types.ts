import type {
  ImmutableReceiptArtifactDescriptor,
  UnifiedAcceptanceCandidateReceipt,
  UnifiedAcceptanceCorrelation,
  UnifiedParseFailureReport,
  UnifiedPackageArtifactDescriptor,
  UnifiedPackageSourceKind,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';

export interface ImmutableArtifactPersistResult {
  artifact: UnifiedPackageArtifactDescriptor;
  bytes: Uint8Array;
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
  cause: { code: string; errorClass: string };
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
  readonly sourceContract: {
    port: 'wiselink.3_1.port.u0_frozen2_failure_adapter.v0.candidate.1';
    sourceCommit: 'ebf84f87213227b0a4bdf2f9d4909ca1a58b3518';
    adapterRevision: 'candidate.1';
    adapterBuildHash: 'sha256:255b3354ee9aa0eebd9e2d0a2beb9338d9ce261330de0b1ebb1b3ce0ff804b84';
    manifestSha256: string;
    implementationSha256: string;
    inputSchemaSha256: string;
  };
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
