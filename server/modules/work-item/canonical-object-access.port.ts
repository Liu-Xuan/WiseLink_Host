export const CANONICAL_OBJECT_ACCESS = Symbol('CANONICAL_OBJECT_ACCESS');

export type CanonicalLegacyObjectAccessAction =
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

export type CanonicalObjectAccessAction =
  | CanonicalLegacyObjectAccessAction
  | 'READ_WORK_ITEM'
  | 'REQUEST_RESEARCH'
  | 'READ_SOURCE_REFS'
  | 'READ_ATTACHMENT'
  | 'INGEST_ATTACHMENT_SINGLE_REQUEST'
  | 'ISSUE_ATTACHMENT_INTAKE'
  | 'COMMIT_ATTACHMENT_INTAKE';

export type CanonicalGrantableObjectAccessAction = Exclude<
  CanonicalObjectAccessAction,
  | 'REQUEST_RESEARCH'
  | 'READ_SOURCE_REFS'
  | 'READ_ATTACHMENT'
  | 'ISSUE_ATTACHMENT_INTAKE'
  | 'COMMIT_ATTACHMENT_INTAKE'
>;

export type CanonicalAccessRoot =
  | { kind: 'WORK_ITEM'; id: string }
  | { kind: 'REVIEW_CONVERSATION'; id: string };

/**
 * A Feishu identifier is only an asserted namespace value. A future Aily
 * adapter may align it to the same canonical subject only with this
 * Host-controlled, tenant/application-bound fresh mapping evidence.
 */
export interface CanonicalFeishuSubjectMappingEvidence {
  assertedIdentity: {
    namespace: 'FEISHU_USER_ID' | 'FEISHU_OPEN_ID';
    id: string;
  };
  canonicalSubject: {
    namespace: 'MIAODA_USER_ID';
    id: string;
  };
  source: 'HOST_CONTROLLED_FRESH_SUBJECT_MAPPING';
  applicationScopeId: string;
  tenantId: string;
  version: string;
  decidedAt: string;
}

/**
 * This exported interface is only an asserted snapshot shape and is never
 * identity proof by itself. Production Miaoda browser routing remains
 * unavailable until Host can verify a platform identity exchange or a hosted
 * ingress trust contract; copying every field must never create a grant.
 */
export interface CanonicalMiaodaFinalUserActorContext {
  principalKind: 'FINAL_USER';
  transport: 'MIAODA_AUTHENTICATED_HTTP';
  canonicalSubject: {
    namespace: 'MIAODA_USER_ID';
    id: string;
  };
  subjectDecision: {
    source: 'MIAODA_GATEWAY_USER_CONTEXT';
    applicationScopeId: string;
    tenantId: string;
    version: 'miaoda-user-context.v1';
    decidedAt: string;
  };
  tenantId: string;
  applicationScopeId: string;
  applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT';
  workspaceId: null;
  workspaceProvenance: 'UNAVAILABLE';
  env: string;
  platformRoles: readonly string[];
  identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT';
  feishuUserId: null;
  feishuOpenId: null;
  feishuIdentityProvenance: 'UNAVAILABLE';
  sessionId: null;
  sessionRevision: null;
  sessionProvenance: 'UNAVAILABLE';
}

export interface CanonicalUnavailableActorContext {
  principalKind: 'UNAVAILABLE';
  unavailableReason:
    | 'AILY_FINAL_USER_HANDOFF_UNAVAILABLE'
    | 'SERVICE_OR_LEGACY_ACTOR_UNAVAILABLE';
}

export type CanonicalActorContext =
  | CanonicalMiaodaFinalUserActorContext
  | CanonicalUnavailableActorContext;

export type CanonicalObjectAccessDenyCode =
  | 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE'
  | 'CANONICAL_WORK_ITEM_NOT_FOUND'
  | 'CANONICAL_WORK_ITEM_REVISION_REQUIRED'
  | 'CANONICAL_WORK_ITEM_REVISION_MISMATCH'
  | 'CANONICAL_REVIEW_CONVERSATION_SOURCE_UNAVAILABLE'
  | 'CANONICAL_SOURCE_VISIBILITY_UNAVAILABLE'
  | 'CANONICAL_ATTACHMENT_BINDING_UNAVAILABLE'
  | 'CANONICAL_SESSION_PROVENANCE_UNAVAILABLE';

export interface CanonicalObjectAccessDenied {
  allowed: false;
  action: CanonicalObjectAccessAction;
  accessRoot: CanonicalAccessRoot;
  code: CanonicalObjectAccessDenyCode;
  statusCode: 400 | 404 | 409 | 503;
  denialSource:
    | 'MIAODA_OBJECT_ACCESS'
    | 'MIAODA_BROWSER_UNAVAILABLE_ADAPTER'
    | 'AILY_UNAVAILABLE_ADAPTER'
    | 'SERVICE_UNAVAILABLE_ADAPTER'
    | 'SESSION_UNAVAILABLE_ADAPTER';
}

export interface CanonicalObjectAccessGrant {
  allowed: true;
  action: CanonicalGrantableObjectAccessAction;
  accessRoot: { kind: 'WORK_ITEM'; id: string };
  workItemId: string;
  workItemRevision: number;
  requestId: string;
  documentVersionId: string;
  tenantId: string;
  applicationScopeId: string;
  applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT';
  workspaceId: null;
  workspaceProvenance: 'UNAVAILABLE';
  actorUserId: string;
  canonicalSubject: {
    namespace: 'MIAODA_USER_ID';
    id: string;
  };
  actorFingerprint: string;
  ownerFact: {
    isOwner: true;
    ownerUserId: string;
    source: 'HOST_WORK_ITEM_REQUESTED_BY';
  };
  memberFact: {
    isMember: false;
    source: 'UNAVAILABLE';
  };
  actionPolicy: {
    action: CanonicalGrantableObjectAccessAction;
    objectRelation: 'OWNER';
    source: 'HOST_SERVER_ACTION_POLICY';
    requiredPlatformRoles: readonly string[];
    platformRoleEvaluation: 'NOT_REQUIRED' | 'SATISFIED';
    policyRevision: 'creator-only.v1';
  };
  accessRevision: string;
  authorizationFingerprint: string;
  freshReadAt: string;
  auditProvenance: {
    identity: 'MIAODA_GATEWAY_USER_CONTEXT';
    applicationScope: 'MIAODA_GATEWAY_APP_CONTEXT';
    workspace: 'UNAVAILABLE';
    objectAuthorization: 'HOST_WORK_ITEM_REQUESTED_BY';
    memberAuthorization: 'UNAVAILABLE';
    session: 'UNAVAILABLE';
    correlationFieldsAreAuthorizationInputs: false;
    platformRolesAreObjectGrantInputs: false;
    platformRolesMayBeActionPolicyInputs: true;
  };
}

export type CanonicalObjectAccessResult =
  | CanonicalObjectAccessGrant
  | CanonicalObjectAccessDenied;

type RevisionBoundMutationRequest = {
  action: 'INGEST_ATTACHMENT_SINGLE_REQUEST';
  accessRoot: { kind: 'WORK_ITEM'; id: string };
  expectedWorkItemRevision: number;
};

type NonRevisionBoundRequest = {
  action: Exclude<
    CanonicalObjectAccessAction,
    'INGEST_ATTACHMENT_SINGLE_REQUEST'
  >;
  accessRoot: CanonicalAccessRoot;
  expectedWorkItemRevision?: never;
};

export type CanonicalObjectAccessInput = {
  actor: CanonicalActorContext;
} & (RevisionBoundMutationRequest | NonRevisionBoundRequest);

export interface CanonicalObjectAccessPort {
  /** Every grant-capable call must re-read Host-owned object relation facts. */
  freshRead(
    input: CanonicalObjectAccessInput,
  ): Promise<CanonicalObjectAccessResult>;
}

export function unavailableAilyActorContext(): CanonicalUnavailableActorContext {
  return {
    principalKind: 'UNAVAILABLE',
    unavailableReason: 'AILY_FINAL_USER_HANDOFF_UNAVAILABLE',
  };
}

export function unavailableServiceActorContext(): CanonicalUnavailableActorContext {
  return {
    principalKind: 'UNAVAILABLE',
    unavailableReason: 'SERVICE_OR_LEGACY_ACTOR_UNAVAILABLE',
  };
}
