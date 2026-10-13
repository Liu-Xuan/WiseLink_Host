/** TDMS native records are immutable source observations, never current engineering decisions. */
export const TDMS_SOURCE_PACKAGE_SCHEMA =
  'wiselink.tdms-source-package.v1' as const;
export type TdmsRecordKind =
  | 'MANUFACTURER_FILE'
  | 'PROCESSING_SHEET'
  | 'ENGINEER_ASSESSMENT'
  | 'COMMENT'
  | 'ENGINEERING_FILE'
  | 'SOURCE_EVENT'
  | 'OBSERVATION';
export interface TdmsRawCode {
  rawCode: string | null;
  rawName: string | null;
  controlledMapping?: string | null;
}
export interface TdmsSourceVersion {
  rawRevision: string | null;
  rawIteration: string | null;
  confirmation: 'SOURCE_DECLARED' | 'VERSION_UNCONFIRMED';
}
export interface TdmsPerson {
  sourcePersonId: string | null;
  name: string | null;
  role: string | null;
}
export interface TdmsCoverage {
  status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  gaps: string[];
  readback: 'CONSISTENT' | 'NON_ATOMIC' | 'NOT_VERIFIED';
}
export interface TdmsFieldProvenance {
  fieldPath: string;
  selector: string;
  sourceModifiedAt: string | null;
  observationRef: string;
}
export type TdmsCompleteOwnedValueState =
  | 'VALUE'
  | 'BLANK'
  | 'ABSENT'
  | 'NOT_APPLICABLE'
  | 'NOT_LOADED'
  | 'NOT_READ'
  | 'TRUNCATED'
  | 'ACCESS_DENIED';
export interface TdmsCompleteOwnedField {
  fieldId: string;
  tabId: string;
  sectionId: string;
  labelOrigin: 'NATIVE_SOURCE_DECLARED' | 'PROFILE_EXPECTED';
  nativeControl: {
    tag: string;
    readOnly: boolean | null;
    disabled: boolean | null;
  };
  value: {
    state: TdmsCompleteOwnedValueState;
    actualLabel: string;
    rawValue: string | null;
    locator: string;
    observedTotalCodepoints: number;
  };
  links: Array<{
    rawHref: string;
    targetRef: string | null;
    numberRaw: string;
    nativeRole: string;
    locator: string;
    nativeColumnLabel?: string;
    nativeColumnToken?: string | null;
  }>;
}
export interface TdmsSourceContent {
  /** Complete1 own-part literals remain PARTIAL and independently authorized. */
  completeOwnedFields?: TdmsCompleteOwnedField[];
  /** Source51 v2 bounded observation, not complete content or an approved opinion. */
  boundedOwnedBody?: TdmsBoundedOwnedBodyField[];
  /** Bounded native form literals, independently authorized; never an approved opinion. */
  ownedVisibleBusinessContent?: Array<Record<string, unknown>>;
  opinions?: Array<{
    text: string;
    author: TdmsPerson | null;
    state: TdmsRawCode | null;
    conditions: string[];
    requiredActions: string[];
    sourceSelector: string;
  }>;
  conditions?: string[];
  requiredActions?: string[];
  approvers?: TdmsPerson[];
  sourceEvents?: Array<{
    rawKind: string;
    occurredAt: string | null;
    actor: TdmsPerson | null;
    selector: string;
  }>;
  executionDeclaration?: {
    target: {
      rawCode: string | null;
      rawName: string | null;
      scope: Record<string, unknown>;
    };
    frequency: {
      rawCode: string | null;
      rawName: string | null;
      rarePeriodicExtension?: Record<string, unknown>;
    };
    completionRecognition: {
      rawCode: string | null;
      rawName: string | null;
      details: Record<string, unknown>;
    };
  };
  /** LCM remains the software configuration authority; these are unverified external references only. */
  futureLcmLinks?: Array<{
    externalRecordId: string | null;
    aircraftRef: string | null;
    softwareItemRef: string | null;
    aeoVersionRef: string | null;
    feedbackRef: string | null;
    integrationStatus: 'NOT_CONNECTED';
  }>;
}

export interface TdmsBoundedOwnedBodyField {
  actualLabel: string;
  labelOrigin: 'NATIVE_VISIBLE_LABEL' | 'PROFILE_EXPECTED_LABEL';
  sectionLabel: string;
  panelLocator: string;
  locator: string;
  fieldType: 'DISPLAY_TEXT' | 'UNOBSERVED';
  presence: 'PRESENT_VALUE' | 'PRESENT_BLANK' | 'ABSENT' | 'NOT_LOADED';
  rawBoundedValue: string | null;
  nativeControl: {
    tag: 'TD';
    readOnly: boolean | null;
    disabled: boolean | null;
    visibleControls: [];
  } | null;
  truncation: {
    truncated: boolean;
    limit: 8000;
    capturedCodepoints: number;
    observedTotalCodepoints: number;
  };
  observedAt: string;
}
export interface TdmsUnreadAttachment {
  sourceAttachmentId: string;
  sourceAttachmentVersion: string | null;
  fileName: string;
  mediaType: string | null;
  byteLength: number | null;
  readStatus: 'NOT_READ' | 'FAILED';
  gap: string;
  selector: string;
}
export interface TdmsPackageRecord {
  itemId: string;
  recordKind: TdmsRecordKind;
  sourceRecordId: string;
  /** null permits creating an object; updating an existing head requires its exact revision. */
  expectedHeadRevisionRef: string | null;
  sourceVersion: TdmsSourceVersion;
  /** Business revision stays separate from the TDMS technical object version. */
  businessVersion?: TdmsSourceVersion | null;
  title: string;
  fileType: TdmsRawCode | null;
  state: TdmsRawCode | null;
  authors: TdmsPerson[];
  sourceModifiedAt: string | null;
  observedAt: string;
  coverage: TdmsCoverage;
  rawFields: Record<string, unknown>;
  content: TdmsSourceContent;
  fieldProvenance: TdmsFieldProvenance[];
  artifactMemberIds: string[];
  unreadAttachments?: TdmsUnreadAttachment[];
  /** Existing exact Host versions, separately access-checked; never a caller-created document identity. */
  relatedDocumentVersionIds: string[];
  /** Only these native kinds may request existing DM PDF identity-owner registration. */
  formalDocumentArtifactMemberId?: string | null;
}
export type TdmsPackageEndpoint =
  | { kind: 'PACKAGE_RECORD'; itemId: string }
  | { kind: 'NATIVE_RECORD_REVISION'; sourceRevisionRef: string }
  | { kind: 'DOCUMENT_VERSION'; documentVersionId: string }
  | { kind: 'UNRESOLVED'; rawIdentity: string; versionGap: string };
export type TdmsExactEndpoint = Exclude<
  TdmsPackageEndpoint,
  { kind: 'PACKAGE_RECORD' }
>;
export interface TdmsPackageRelation {
  sourceRelationId: string;
  expectedHeadAssertionRef: string | null;
  rawKind: string;
  controlledKind:
    | 'FILE_PROCESSING'
    | 'PROCESSING_ASSESSMENT'
    | 'ASSESSMENT_COMMENT'
    | 'REFERENCES'
    | 'PRODUCES_ENGINEERING_FILE'
    | 'VERSION_CHANGE'
    | 'OTHER'
    | null;
  from: TdmsPackageEndpoint;
  to: TdmsPackageEndpoint;
  authority: 'SOURCE_EXPLICIT' | 'CANDIDATE_ONLY';
  selector: string;
  observedAt: string;
  coverage: TdmsCoverage;
  scope: Record<string, unknown>;
  /** No inference from a generic supersedes label. Both endpoints and scope must be explicit. */
  completionEffect:
    | 'OLD_COMPLETION_RECOGNIZED'
    | 'REEXECUTE_NEW_VERSION'
    | 'UNSPECIFIED';
  changeClass: 'EQUIVALENT' | 'REPLACES' | 'UNSPECIFIED';
  rawFields: Record<string, unknown>;
}
export interface TdmsPackageArtifact {
  memberId: string;
  sourceAttachmentId: string;
  sourceAttachmentVersion: string | null;
  fileName: string;
  mediaType: string;
  sha256: string;
  byteLength: number;
  bytesBase64: string;
}
export interface TdmsSourcePackage {
  schemaVersion: typeof TDMS_SOURCE_PACKAGE_SCHEMA;
  packageId: string;
  observedAt: string;
  coverage: TdmsCoverage;
  query: {
    requestedCriteria: Record<string, unknown>;
    actualCriteria: Record<string, unknown> | null;
    scopeMatch: 'MATCHED' | 'MISMATCH' | 'UNKNOWN';
    /** Exact source declaration retained by the Complete1 adapter; not a Host selection. */
    originalAcquisition?: {
      contentMode: 'COMPLETE_OWN_SOURCE@1';
      originalRevision: 'tdms-complete-primary-bytes@1';
      operationId: string;
      ownOperationId: string;
      receiptSha256: string;
      sourceAttachmentId: string;
      bytesSha256: string;
      byteLength: number;
      mediaType: string;
    };
  };
  readFailures: Array<{
    sourceRecordId: string | null;
    code: string;
    detail: string;
  }>;
  records: TdmsPackageRecord[];
  relations: TdmsPackageRelation[];
  artifacts: TdmsPackageArtifact[];
}
export interface TdmsArtifactBinding {
  memberId: string;
  sourceArtifactId: string;
  acquisitionId: string;
  fileName: string;
  mediaType: string;
  sha256: string;
  byteLength: number;
  immutableReadbackVerified: true;
  documentVersionId: string | null;
  registrationGap: string | null;
}
export interface TdmsRecordSummary {
  recordRef: string;
  sourceRevisionRef: string;
  recordKind: TdmsRecordKind;
  sourceRecordId: string;
  sourceKey: string;
  sourceInstanceId: string;
  title: string;
  fileType: TdmsRawCode | null;
  sourceVersion: TdmsSourceVersion;
  /** Business revision stays separate from the TDMS technical object version. */
  businessVersion?: TdmsSourceVersion | null;
  state: TdmsRawCode | null;
  authors: TdmsPerson[];
  observedAt: string;
  capturedAt: string;
  coverage: TdmsCoverage;
  relatedDocumentVersionIds: string[];
  fieldSelectors: Array<{ fieldPath: string; selector: string }>;
  sourceVerification: 'DECLARED_ONLY';
  currentness: 'SELECTED_HOST_OBSERVATION';
}
export interface TdmsRecordRevision extends TdmsRecordSummary {
  captureRef: string;
  sourceModifiedAt: string | null;
  rawFields: Record<string, unknown>;
  content: TdmsSourceContent;
  fieldProvenance: TdmsFieldProvenance[];
  artifacts: TdmsArtifactBinding[];
  unreadAttachments: TdmsUnreadAttachment[];
  /** Exact history stays readable; this flag never claims latest official publication. */
  selectedHead: boolean;
}
export interface TdmsRelationAssertion extends Omit<
  TdmsPackageRelation,
  'from' | 'to' | 'expectedHeadAssertionRef'
> {
  relationRef: string;
  assertionRef: string;
  /** False identifies retained assertion history; it does not declare a currently selected source relation. */
  selectedHead?: boolean;
  captureRef: string;
  from: TdmsExactEndpoint;
  to: TdmsExactEndpoint;
  sourceVerification: 'DECLARED_ONLY';
}
export interface TdmsReadContext {
  matterId?: string;
  documentVersionId?: string;
  workItemId?: string;
  jobAidAttemptRef?: string;
}
export interface TdmsCatalogueResponse {
  records: TdmsRecordSummary[];
  sourceStatus: 'DISABLED' | 'AVAILABLE';
  hasMore: boolean;
  nextAfter: string | null;
  readPerformed: false;
  limitations: string[];
}
/** Every entry is one saved Host observation, not a collapsed TDMS business version. */
export interface TdmsHistoryEntry extends TdmsRecordSummary {
  captureRef: string;
  sourceModifiedAt: string | null;
  /** Current selected Host observation only, not the latest official/approved source version. */
  selectedHead: boolean;
}
export interface TdmsHistoryResponse {
  recordRef: string;
  versions: TdmsHistoryEntry[];
  hasMore: boolean;
  nextAfter: string | null;
  readPerformed: false;
  limitations: string[];
}
export interface TdmsReadReceipt {
  receiptRef: string;
  sourceRevisionRef: string;
  readAt: string;
  purpose:
    | 'WIKI_NATIVE_RECORD'
    | 'WIKI_NATIVE_RELATIONS'
    | 'JOB_AID_NATIVE_RECORD';
  fieldPaths: string[] | null;
  taskContextRef: string | null;
  readPerformed: true;
  permissionRevision: string;
  engineeringAdoption: 'NOT_CREATED';
  executionVerified: false;
}
export interface TdmsRecordReadResponse {
  record: TdmsRecordRevision;
  selectedFields: Array<{
    fieldPath: string;
    selector: string;
    value: unknown;
  }> | null;
  receipt: TdmsReadReceipt;
  limitations: string[];
}
export interface TdmsRelationReadResponse {
  sourceRevisionRef: string;
  relations: TdmsRelationAssertion[];
  receipt: TdmsReadReceipt;
  limitations: string[];
}
export interface TdmsImportReceipt {
  captureRef: string;
  packageId: string;
  status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  created: boolean;
  sourceVerification: 'DECLARED_ONLY';
  recordRevisionRefs: string[];
  assertionRefs: string[];
  artifactBindings: TdmsArtifactBinding[];
  gaps: string[];
  engineeringAdoption: 'NOT_CREATED';
  executionVerified: false;
}
