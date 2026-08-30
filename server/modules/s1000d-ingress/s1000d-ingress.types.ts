import type { CanonicalHostActor } from '../canonical-host/canonical-host.types';

export type S1000dSourceClass =
  | 'REPOSITORY_CONTROLLED_SYNTHETIC_FIXTURE'
  | 'OEM_CONTROLLED';

export interface ResolvedS1000dDocumentSource {
  familyId: string;
  currentGeneration: number;
  documentId: string;
  documentVersionId: string;
  revisionId: string;
  canonicalRevisionIdentity: string;
  committedAt: string;
  sourceArtifactId: string;
  originalFilename: string;
  mediaType: 'application/xml' | 'text/xml';
  sha256: string;
  byteLength: number;
  providerObjectId: string;
  providerVersionId: string;
  /** Host-only FileService locator. Never include it in a browser projection. */
  fileServiceLocator: {
    bucketId: string;
    filePath: string;
  };
}

/**
 * The only S1000D source boundary. A production implementation must resolve an
 * existing canonical DocumentVersion/SourceArtifact and read through the same
 * FileService owner used by Document Management.
 */
export interface S1000dDocumentSourcePort {
  readonly available: boolean;
  resolveCurrent(
    documentVersionId: string,
  ): Promise<ResolvedS1000dDocumentSource>;
  readActualBytes(source: ResolvedS1000dDocumentSource): Promise<Uint8Array>;
  readAuthorizedActualBytes(
    artifact: S1000dAuthorizedSourceArtifact,
  ): Promise<Uint8Array>;
}

export type S1000dDependencyRelationship =
  | 'DM_REFERENCE'
  | 'PM_REFERENCE'
  | 'DELIVERY_MANIFEST'
  | 'SCHEMA_BINDING'
  | 'INFORMATION_ENTITY_REFERENCE';

/**
 * Server-owned authorization and Host source binding for every artifact that
 * a producer may place in frozen.2 source.artifactIds.
 */
export interface S1000dAuthorizedSourceArtifact {
  packageArtifactId: string;
  hostSourceArtifactId: string;
  packageRole: string;
  normalizedPath: string;
  mediaType: string;
  sha256: string;
  byteLength: number;
  providerObjectId: string;
  providerVersionId: string;
  /** Host-only FileService locator. Never include it in a browser projection. */
  fileServiceLocator: {
    bucketId: string;
    filePath: string;
  };
  authorizationEvidenceRef: string;
  dependency:
    | {
        kind: 'PRIMARY_DOCUMENT_VERSION';
        documentVersionId: string;
      }
    | {
        kind: 'AUTHORIZED_DEPENDENCY';
        parentPackageArtifactId: string;
        relationship: S1000dDependencyRelationship;
      };
}

export interface S1000dPackageSourceArtifact {
  authorization: S1000dAuthorizedSourceArtifact;
  actualBytes: Uint8Array;
}

export interface S1000dSourceUseAuthorization {
  status: 'AUTHORIZED';
  decisionId: string;
  permissionSnapshotVersion: string;
  sourceClass: S1000dSourceClass;
  sourceArtifactId: string;
  documentVersionId: string;
  processingAllowed: true;
  canonicalPackageStorageAllowed: true;
  browserProjectionAllowed: true;
  sourceRedistributionAllowed: boolean;
  /** Required for OEM-controlled bytes; resolved server-side, never by a request. */
  processingAuthorizationRef: string | null;
  /** Required for OEM-controlled browser projection; resolved server-side. */
  redistributionAuthorizationRef: string | null;
  authorizedSourceManifest: S1000dAuthorizedSourceArtifact[];
}

export interface S1000dSourceUseAuthorizerPort {
  readonly available: boolean;
  authorize(input: {
    actor: CanonicalHostActor;
    workItemId: string;
    requestId: string;
    source: ResolvedS1000dDocumentSource;
  }): Promise<S1000dSourceUseAuthorization>;
}

export interface S1000dStructuredPackageProducerResult {
  packageId: string;
  contractId: 'techpub.parsed-package.v1';
  contractRevision: 'frozen.2';
  bytes: Uint8Array;
  producerId: string;
  producerRevision: string;
}

export interface S1000dStructuredPackageProducerPort {
  readonly available: boolean;
  produce(input: {
    source: ResolvedS1000dDocumentSource;
    artifacts: readonly S1000dPackageSourceArtifact[];
    authorization: S1000dSourceUseAuthorization;
  }): Promise<S1000dStructuredPackageProducerResult>;
}

/** Server-only handoff into the one canonical Host vertical. */
export interface PreparedS1000dIngressCandidate {
  source: ResolvedS1000dDocumentSource;
  authorization: S1000dSourceUseAuthorization;
  produced: S1000dStructuredPackageProducerResult;
  summary: {
    resultStatus: 'complete' | 'partial';
    contentUnitCount: number;
    sourceRefCount: number;
    authorizedSourceArtifactCount: number;
  };
}

export interface S1000dIngressRequest {
  workItemId: string;
  requestId: string;
  documentVersionId: string;
}

/**
 * Browser-safe candidate status. The adapter does not persist, correlate or
 * create a Reader projection; those operations remain owned by the canonical
 * vertical. Internal document, package, unit, SourceRef and authorization
 * identities are deliberately absent.
 */
export interface S1000dIngressCandidateStatus {
  schemaVersion: 'wiselink.3_1.s1000d_ingress_candidate_status.v1';
  status: 'CANDIDATE_U0_VALIDATED';
  sourceKind: 'native_s1000d';
  contract: {
    id: 'techpub.parsed-package.v1';
    revision: 'frozen.2';
    validatorStatus: 'FULL_STRICT_VALIDATOR_PASSED';
  };
  summary: {
    resultStatus: 'complete' | 'partial';
    contentUnitCount: number;
    sourceRefCount: number;
    authorizedSourceArtifactCount: number;
  };
  boundary: {
    currentDocumentVersionRechecked: true;
    canonicalArtifactPersisted: false;
    professionalArtifactCorrelated: false;
    workItemStateChanged: false;
    readerProjectionCreated: false;
    actualSourceBytesExposed: false;
    internalIdentityExposed: false;
    applicabilityIsInstallationFact: false;
    publicationAuthorized: false;
    currentSelectionChanged: false;
  };
}
