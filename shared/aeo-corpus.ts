export const TDMS_AEO_CORPUS_CONTRACT_VERSION =
  'tdms_aeo_corpus_v1.candidate.1' as const;

export const TDMS_AEO_CORPUS_PROVIDER_ENVELOPE_VERSION =
  'tdms_aeo_corpus_provider_envelope_v1.candidate.1' as const;

export const TDMS_AEO_CORPUS_PROVIDER_PROFILE =
  'tdms_aeo_corpus_read_only_v1' as const;

export const TDMS_AEO_CORPUS_LOCAL_BRIDGE_PROFILE =
  'aeo_corpus_read_only_v1' as const;

export const TDMS_AEO_CORPUS_LOCAL_BRIDGE_ACTION =
  'acquire-issued-aeo-corpus-release' as const;

export const TDMS_AEO_CORPUS_EXTENSION_ACTION =
  'tdms.aeo.acquire_issued_corpus_release' as const;

export const TDMS_AEO_CORPUS_ACTIONS = [
  'scan_issued_aeo_candidates',
  'resolve_aeo_publication_identity',
  'read_aeo_revision_lineage_and_lifecycle',
  'resolve_aeo_source_package',
  'list_aeo_related_documents',
  'resolve_related_source_primary_content',
  'verify_aeo_acquisition_readback',
] as const;

export type TdmsAeoCorpusAction = (typeof TDMS_AEO_CORPUS_ACTIONS)[number];

export type AeoCorpusScopeKind =
  | 'issued_aeo_register'
  | 'controlled_search'
  | 'release_directory'
  | 'my_assignments_sample';

export type AeoNormalizedLifecycle =
  | 'ISSUED'
  | 'CANCELLED'
  | 'SUPERSEDED'
  | 'UNKNOWN';

export type AeoRelatedSourceAuthority =
  | 'TDMS_EXPLICIT_RELATION'
  | 'ENGINEER_CONFIRMED'
  | 'CANDIDATE_ONLY';

export type AeoCorpusChangeType =
  | 'NEW_AEO'
  | 'NEW_REVISION_OR_ITERATION'
  | 'LIFECYCLE_CHANGED'
  | 'CANCELLED_OR_SUPERSEDED'
  | 'RELATED_SOURCE_CHANGED'
  | 'IDENTITY_CONTENT_CONFLICT'
  | 'UNCHANGED';

export interface AeoFormalIdentity {
  organization: string;
  formalAeoIdentity: string;
  revision: string;
  iteration: string;
}

export interface AeoPublicationPackageMember {
  path: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
}

export interface AeoPublicationSourcePackage {
  acquisitionState: 'complete' | 'partial';
  members: AeoPublicationPackageMember[];
  packageHash: string | null;
  blockerCodes: string[];
}

export interface AeoRelatedSourceObservation {
  sourceKind: 'SB' | 'SL' | 'OTHER';
  formalDocumentIdentity: string;
  revision: string;
  iteration: string;
  relationAuthority: AeoRelatedSourceAuthority;
  relationTypeRaw: string;
  sourceSha256: string | null;
}

export interface AeoCorpusSafetyReadback {
  verified: boolean;
  observedAt: string;
  verificationKind: string;
  tdmsMutationObserved: false;
  cookiesExported: false;
  signedUrlPersisted: false;
  signedUrlReturned: false;
  rawDomReturned: false;
}

export interface AeoReleaseObservation {
  contractVersion: typeof TDMS_AEO_CORPUS_CONTRACT_VERSION;
  connectorId: string;
  continuityKey: string;
  corpusKey: string;
  idempotencyKey: string | null;
  formalIdentity: AeoFormalIdentity;
  lifecycleRaw: string;
  normalizedLifecycle: AeoNormalizedLifecycle;
  sourcePackage: AeoPublicationSourcePackage;
  relatedSources: AeoRelatedSourceObservation[];
  readback: AeoCorpusSafetyReadback;
}

export interface AeoReleaseObservationInput {
  connectorId: string;
  formalIdentity: AeoFormalIdentity;
  lifecycleRaw: string;
  normalizedLifecycle: AeoNormalizedLifecycle;
  sourcePackage: {
    acquisitionState: 'complete' | 'partial';
    members: AeoPublicationPackageMember[];
    blockerCodes?: string[];
  };
  relatedSources?: AeoRelatedSourceObservation[];
  readback: AeoCorpusSafetyReadback;
}

export interface AeoCorpusScanReadback {
  scopeKind: AeoCorpusScopeKind;
  queryConditionsReadBack: boolean;
  paginationComplete: boolean;
  lastPageReached: boolean;
  timedOut: boolean;
  observedCount: number;
  advertisedCount: number | null;
  partialReadFailures: string[];
}

export interface AeoCursorAdvanceDecision {
  allowed: boolean;
  blockerCodes: string[];
}

export interface TdmsAeoCorpusProviderEnvelope {
  schemaVersion: typeof TDMS_AEO_CORPUS_PROVIDER_ENVELOPE_VERSION;
  providerProfile: typeof TDMS_AEO_CORPUS_PROVIDER_PROFILE;
  connectorId: string;
  completedActions: TdmsAeoCorpusAction[];
  mutationCapabilitiesAvailable: false;
  scanReadback: AeoCorpusScanReadback;
  release: Omit<AeoReleaseObservationInput, 'connectorId'>;
}

export interface TdmsAeoCorpusProviderResult {
  observation: AeoReleaseObservation;
  scanReadback: AeoCorpusScanReadback;
  cursorAdvance: AeoCursorAdvanceDecision;
  completedActions: TdmsAeoCorpusAction[];
}
