import type {
  TdmsArtifactSelection,
  TdmsAttachmentAcquisitionFact,
} from '@shared/tdms-file-service-import.interface';
import type {
  TdmsArtifactBinding,
  TdmsImportReceipt,
  TdmsReadContext,
  TdmsReadReceipt,
  TdmsRecordRevision,
  TdmsRelationAssertion,
  TdmsSourcePackage,
} from '@shared/tdms-source.interface';
import type { CanonicalMiaodaFinalUserActorContext } from '../work-item/canonical-object-access.port';
import type { TdmsDocumentUploadBinding } from '../document-management/src/hosted/nest/document-upload-authority';
import type {
  TdmsDailyMetadataEnvelope,
  TdmsDailyMetadataImportReceipt,
  TdmsDailyMetadataProjectedImportReceipt,
} from './tdms-daily-metadata-contract';
import type { TdmsDailyArtifactObservation } from './tdms-daily-metadata-contract';
import type {
  TdmsDailyNativeRetention,
  TdmsDailySourceAdapterCapture,
} from './tdms-daily-source-adapter';

export const TDMS_REPOSITORY = Symbol('TDMS_REPOSITORY');
export const TDMS_SOURCE_AUTHORIZATION = Symbol('TDMS_SOURCE_AUTHORIZATION');
export const TDMS_ARTIFACT_STORE = Symbol('TDMS_ARTIFACT_STORE');
export const TDMS_DOCUMENT_ACCESS = Symbol('TDMS_DOCUMENT_ACCESS');
export const TDMS_FORMAL_REGISTRATION = Symbol('TDMS_FORMAL_REGISTRATION');

export interface TdmsFormalRegistrationPort {
  project(actor: TdmsPublicActor, scope: TdmsSourceScope, envelope: TdmsDailyMetadataEnvelope,
    receipt: TdmsDailyMetadataImportReceipt, read: TdmsFormalReceiptRead): Promise<TdmsDailyMetadataProjectedImportReceipt>;
}
export interface TdmsFormalReceiptRead {
  action: 'READ_HISTORY' | 'READ_RECORD';
  claims: TdmsImportMemberClaims;
  bindingIds: string[];
}
export interface TdmsSourceScope {
  tenantId: string;
  sourceKey: string;
  sourceInstanceId: string;
  scopeId: string;
}
/** Only public, verified Host ingress can construct this actor. Runtime callers get a separate port. */
export type TdmsPublicActor = CanonicalMiaodaFinalUserActorContext;
export type TdmsAction =
  | 'IMPORT'
  | 'CATALOGUE'
  | 'READ_HISTORY'
  | 'READ_RECORD'
  | 'READ_RELATIONS';
export interface TdmsSourceGrant {
  scope: TdmsSourceScope;
  permissionRevision: string;
  /** Present for member-bounded Host decisions; omitted only by whole-scope providers. */
  permittedMembers?: TdmsImportMemberClaims;
  /** Earliest controlled Source/grant/action expiry; checked synchronously at release. */
  validUntil?: string;
}
/** All are untrusted source claims until a Host provider checks current membership and rights. */
export interface TdmsImportMemberClaims {
  records: Array<{ recordKind: string; sourceRecordId: string }>;
  artifacts: Array<{
    memberId: string;
    sourceAttachmentId: string | null;
    sourceAttachmentVersion: string | null;
    metadataOnly?: true;
    owners: Array<{ recordKind: string; sourceRecordId: string }>;
  }>;
  relationIds: string[];
  /** Server-parsed package context, never independent document read authority.
   * Optional for existing providers; bounded first-slice admission requires it empty. */
  relatedDocumentVersionIds?: string[];
}
export interface TdmsImportAdmission extends TdmsSourceGrant {
  authorityRef: string;
  captureRetentionAllowed: true;
  nativeProjectionAllowed: true;
  permittedMembers: TdmsImportMemberClaims;
}
/** Independent current read decisions, never inferred from a prior import admission. */
export interface TdmsReadMemberAdmission extends TdmsSourceGrant {
  authorityRef: string;
  retainedCaptureReadAllowed: true;
  permittedMembers: TdmsImportMemberClaims;
}
/** Host-owned provider must freshly verify BOTH native source audience and selected object ACL.
 * A package, a source identity, a cached roster and roles alone are never such proof. */
export interface TdmsSourceAuthorization<Actor = TdmsPublicActor> {
  readonly available: boolean;
  authorizeImport(
    actor: Actor,
    scope: TdmsSourceScope,
    claims: TdmsImportMemberClaims,
  ): Promise<TdmsImportAdmission>;
  authorizeReadMembers?(
    actor: Actor,
    scope: TdmsSourceScope,
    action: 'READ_RECORD' | 'READ_HISTORY',
    claims: TdmsImportMemberClaims,
  ): Promise<TdmsReadMemberAdmission>;
  catalogue(
    actor: Actor,
    context: TdmsReadContext,
  ): Promise<TdmsSourceGrant[]>;
  authorize(
    actor: Actor,
    scope: TdmsSourceScope,
    action: TdmsAction,
    context: TdmsReadContext,
  ): Promise<TdmsSourceGrant>;
}
export interface TdmsDocumentAccess<Actor = TdmsPublicActor> {
  assertRead(actor: Actor, documentVersionId: string): Promise<void>;
  /** Verified committed DM lineage only; never a caller-selected latest version. */
  sourceBindings?(actor: Actor, documentVersionId: string): Promise<TdmsDocumentUploadBinding[]>;
}
export interface TdmsCapture {
  scope: TdmsSourceScope;
  packageId: string;
  packageHash: string;
  actorId: string;
  receipt: TdmsImportReceipt;
  query: TdmsSourcePackage['query'];
  capturedAt: string;
  permissionRevision: string;
  admissionAuthorityRef?: string;
  /** Lossless collector envelope and, for the wider adapter, same native retention refs. */
  dailyMetadata?: {
    applicationScopeId: string;
    envelope: TdmsDailyMetadataEnvelope;
    receipt: TdmsDailyMetadataImportReceipt;
    adapter?: TdmsDailySourceAdapterCapture;
    nativeRetention?: TdmsDailyNativeRetention;
  };
}
export interface TdmsRecordHead {
  scope: TdmsSourceScope;
  recordRef: string;
  sourceRecordId: string;
  recordKind: TdmsRecordRevision['recordKind'];
  sourceRevisionRef: string;
  observedAt: string;
}
export interface TdmsStoredRevision {
  scope: TdmsSourceScope;
  record: TdmsRecordRevision;
  /** Private capture metadata, not a second artifact store or a browser identity. */
  attachmentAcquisitions?: Array<
    Omit<
      TdmsAttachmentAcquisitionFact,
      | 'currentSourcePermissionChecked'
      | 'semanticReadPerformed'
      | 'engineeringExecutionVerified'
    >
  >;
  artifactIdentities?: Array<{
    sourceAttachmentId: string;
    sourceAttachmentVersion: string | null;
    memberId: string;
    sha256: string;
    byteLength: number;
  }>;
}
export interface TdmsRelationHead {
  scope: TdmsSourceScope;
  relationRef: string;
  sourceRelationId: string;
  assertionRef: string;
  observedAt: string;
}
export interface TdmsStoredAssertion {
  scope: TdmsSourceScope;
  assertion: TdmsRelationAssertion;
}
export interface TdmsStoredReceipt {
  scope: TdmsSourceScope;
  actorId: string;
  receipt: TdmsReadReceipt;
  context: TdmsReadContext;
}
export interface TdmsCataloguePage {
  /** Filter before pagination, using the current Host decision, never request input. */
  permittedRecords?: TdmsImportMemberClaims['records'];
  after?: string;
  /** Existing explicit bindings only; an unresolved relation never matches. */
  documentVersionId?: string;
  /** Includes the one lookahead record; never exceeds the public page plus one. */
  limit: number;
}
export interface TdmsDocumentCataloguePage extends TdmsCataloguePage {
  documentVersionId: string;
  sourceRevisionRefs?: string[];
}
export interface TdmsTransaction {
  capture(
    scope: TdmsSourceScope,
    packageId: string,
  ): Promise<TdmsCapture | null>;
  capturesBySourceRef(
    scope: TdmsSourceScope,
    sourceRef: string,
  ): Promise<TdmsCapture[]>;
  recordHead(
    scope: TdmsSourceScope,
    recordKind: string,
    sourceRecordId: string,
  ): Promise<TdmsRecordHead | null>;
  revision(tenantId: string, ref: string): Promise<TdmsStoredRevision | null>;
  catalogue(
    scope: TdmsSourceScope,
    page?: TdmsCataloguePage,
  ): Promise<TdmsStoredRevision[]>;
  /** Explicit port for version-bound historical observations; absence fails closed. */
  documentVersionCatalogue?(
    scope: TdmsSourceScope,
    page: TdmsDocumentCataloguePage,
  ): Promise<TdmsStoredRevision[]>;
  history(
    scope: TdmsSourceScope,
    recordRef: string,
  ): Promise<TdmsStoredRevision[]>;
  relationHead(
    scope: TdmsSourceScope,
    sourceRelationId: string,
  ): Promise<TdmsRelationHead | null>;
  relations(tenantId: string, ref: string): Promise<TdmsStoredAssertion[]>;
  saveRevision(
    head: TdmsRecordHead,
    expected: string | null,
    revision: TdmsStoredRevision,
  ): Promise<void>;
  saveAssertion(
    head: TdmsRelationHead,
    expected: string | null,
    assertion: TdmsStoredAssertion,
  ): Promise<void>;
  saveCapture(capture: TdmsCapture): Promise<void>;
  saveReceipt(receipt: TdmsStoredReceipt): Promise<void>;
}
export interface TdmsRepository {
  transaction<T>(operation: (tx: TdmsTransaction) => Promise<T>): Promise<T>;
}
export interface TdmsArtifactStore {
  /** A separately bound, source-authorized transport supplies an exact candidate selection.
   * A collector hash/local CAS path is not a selection or a right to read. Default absent. */
  resolveDailySelection?(input: {
    scope: TdmsSourceScope;
    actor: TdmsPublicActor;
    packageId: string;
    /** Host-computed digest of the unchanged package, not source authority. */
    payloadDigest: string;
    observation: TdmsDailyArtifactObservation;
  }): Promise<TdmsArtifactSelection>;
  /** Current owner/default bucket/exact object and bytes checks; never ordinary DV ingestion. */
  acquireSelection?(input: {
    scope: TdmsSourceScope;
    actor: TdmsPublicActor;
    packageId: string;
    artifact: TdmsArtifactSelection;
  }): Promise<TdmsArtifactBinding>;
  /** No ordinary DM version creation, parsing, or adoption. May leave an unlinked acquisition on a later failure. */
  acquire(input: {
    scope: TdmsSourceScope;
    actor: TdmsPublicActor;
    packageId: string;
    artifact: TdmsSourcePackage['artifacts'][number];
  }): Promise<TdmsArtifactBinding>;
}
export function tdmsError(
  code: string,
  statusCode = 400,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}
