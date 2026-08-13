export const UNIFIED_READER = {
  readinessSchemaVersion:
    'wiselink.3_1.unified_reader_readiness.v0.candidate',
  readbackSchemaVersion:
    'wiselink.3_1.unified_package_readback.v0.candidate',
  receiptSchemaVersion:
    'wiselink.3_1.reader_candidate_receipt.v0.candidate',
  packageSchemaId: 'urn:techpub:schema:v1:parsed-package:frozen-2',
  packageSchemaVersion: 'techpub.parsed-package.v1',
  contractRevision: 'frozen.2',
  contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
  contractManifestSha256:
    '730baa88e7254bac6d3808ca2ddbfb1824c5891d6ce3d6d29ce177431cd5ffc0',
  failureReportSchemaId:
    'urn:techpub:schema:v1:parse-failure-report:frozen-2',
  failureReportSchemaVersion: 'techpub.parse-failure-report.v1',
  failureReportContractRevision: 'frozen.2',
  implementationRevision: 'unified-reader-source.candidate.1',
  artifactStoreRole: 'UnifiedArtifactStoreCandidate',
  artifactDirectory: 'unified-parsed-packages/sha256',
  acceptanceRequestSchemaVersion:
    'wiselink.3_1.unified_acceptance_request.v0.candidate',
  acceptanceReceiptSchemaVersion:
    'wiselink.3_1.unified_acceptance_receipt.v0.candidate.2',
  acceptanceRegistryRevision: 'unified-acceptance-registry.candidate.1',
  acceptanceFacadeRevision: 'unified-acceptance-facade.candidate.2',
} as const;

export const UNIFIED_ARTIFACT_STORE = Symbol('UNIFIED_ARTIFACT_STORE');
export const U0_FULL_PACKAGE_VALIDATOR = Symbol('U0_FULL_PACKAGE_VALIDATOR');
export const U0_FROZEN2_FAILURE_ADAPTER_PORT =
  'wiselink.3_1.port.u0_frozen2_failure_adapter.v0.candidate.1' as const;
export const AEO_SPECIALIST_READER_PORT =
  'wiselink.3_1.port.aeo_specialist_reader.v0.candidate' as const;
export const AEO_SPECIALIST_READER = Symbol('AEO_SPECIALIST_READER');
export const UNIFIED_READER_HOST_BINDING = Symbol(
  'UNIFIED_READER_HOST_BINDING',
);
