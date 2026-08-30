import type {
  CanonicalStructuredContentSourceLocator,
  CanonicalStructuredContentUnit,
} from '@shared/api.interface';

import type { CanonicalHostActor } from '../canonical-host/canonical-host.types';

export type S1000dSourceClass =
  | 'REPOSITORY_CONTROLLED_SYNTHETIC_FIXTURE'
  | 'OEM_CONTROLLED';

export interface ResolvedS1000dDocumentSource {
  documentId: string;
  documentVersionId: string;
  sourceArtifactId: string;
  originalFilename: string;
  mediaType: 'application/xml' | 'text/xml';
  sha256: string;
  byteLength: number;
  providerObjectId: string;
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
  resolveCurrent(
    documentVersionId: string,
  ): Promise<ResolvedS1000dDocumentSource>;
  readActualBytes(source: ResolvedS1000dDocumentSource): Promise<Uint8Array>;
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
}

export interface S1000dSourceUseAuthorizerPort {
  authorize(input: {
    actor: CanonicalHostActor;
    workItemId: string;
    requestId: string;
    source: ResolvedS1000dDocumentSource;
  }): Promise<S1000dSourceUseAuthorization>;
}

export interface S1000dStructuredPackageProducerPort {
  produce(input: {
    source: ResolvedS1000dDocumentSource;
    actualBytes: Uint8Array;
    authorization: S1000dSourceUseAuthorization;
  }): Promise<{
    packageId: string;
    contractId: 'techpub.parsed-package.v1';
    contractRevision: 'frozen.2';
    bytes: Uint8Array;
    producerId: string;
    producerRevision: string;
  }>;
}

export interface S1000dIngressRequest {
  workItemId: string;
  requestId: string;
  documentVersionId: string;
  query: string;
}

export interface S1000dBrowserQueryUnit extends Omit<
  CanonicalStructuredContentUnit,
  'ordinal'
> {
  resultIndex: number;
  unitId: string;
  sourceLocators: CanonicalStructuredContentSourceLocator[];
}

/**
 * Browser-safe read model. It deliberately excludes FileService locators,
 * artifact refs, raw XML bytes, XPath/element ids and authorization evidence
 * refs. It is a candidate projection, not a publication or applicability fact.
 */
export interface S1000dIngressReadModel {
  schemaVersion: 'wiselink.3_1.s1000d_ingress_read_model.v1.candidate';
  status: 'CANDIDATE_READBACK_VERIFIED';
  workItemId: string;
  requestId: string;
  documentVersionId: string;
  sourceKind: 'native_s1000d';
  package: {
    packageId: string;
    contractId: 'techpub.parsed-package.v1';
    contractRevision: 'frozen.2';
    resultStatus: 'complete' | 'partial';
    title: string;
    revisionLabel: string | null;
    contentUnitCount: number;
    sourceRefCount: number;
  };
  authorization: {
    decisionId: string;
    sourceClass: S1000dSourceClass;
    processingAuthorized: true;
    canonicalPackageStorageAuthorized: true;
    browserProjectionAuthorized: true;
  };
  query: {
    text: string;
    resultCount: number;
    units: S1000dBrowserQueryUnit[];
  };
  boundary: {
    actualSourceBytesExposed: false;
    fileServiceLocatorExposed: false;
    packageArtifactLocatorExposed: false;
    nativeXmlLocatorExposed: false;
    applicabilityIsInstallationFact: false;
    publicationAuthorized: false;
    currentSelectionChanged: false;
  };
}
