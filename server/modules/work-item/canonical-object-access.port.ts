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
  | 'RUN_AEO_CANDIDATE_LOOP'
  | 'CREATE_AEO_EDITING_DRAFT'
  | 'READ_AEO_EDITING_DRAFT'
  | 'RECORD_AEO_DRAFT_FEEDBACK';

export type CanonicalObjectAccessAction =
  | CanonicalLegacyObjectAccessAction
  | 'READ_WORK_ITEM'
  | 'CONFIGURE_APPLICABILITY_SELECTION'
  | 'CREATE_BATCH_APPLICABILITY_RUN'
  | 'READ_BATCH_APPLICABILITY_RUN'
  | 'CONFIRM_BATCH_APPLICABILITY_CLUSTER'
  | 'REQUEST_OVERALL_REGENERATION'
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
 * identity proof by itself. Application controllers may construct it only
 * after the platform-hosted ingress has accepted the native user context;
 * external request bodies must never supply this object.
 */
export interface CanonicalMiaodaFinalUserActorContext {
  principalKind: 'FINAL_USER';
  transport: 'MIAODA_AUTHENTICATED_HTTP';
  canonicalSubject: {
    namespace: 'MIAODA_USER_ID';
    id: string;
  };
  subjectDecision: {
    source: 'MIAODA_GATEWAY_USER_CONTEXT' | 'FEISHU_OAUTH_USER_ACCESS_TOKEN';
    applicationScopeId: string;
    tenantId: string;
    version: string;
    decidedAt: string;
  };
  tenantId: string;
  applicationScopeId: string;
  applicationScopeProvenance:
    | 'MIAODA_GATEWAY_APP_CONTEXT'
    | 'HOST_CONFIGURED_MIAODA_APP_ID';
  workspaceId: null;
  workspaceProvenance: 'UNAVAILABLE';
  env: string;
  platformRoles: readonly string[];
  identityProvenance:
    | 'MIAODA_GATEWAY_USER_CONTEXT'
    | 'FEISHU_OAUTH_USER_ACCESS_TOKEN';
  feishuUserId: string | null;
  feishuOpenId: string | null;
  feishuIdentityProvenance: 'UNAVAILABLE' | 'FEISHU_OAUTH_USER_ACCESS_TOKEN';
  sessionId: string | null;
  sessionRevision: number | null;
  sessionProvenance: 'UNAVAILABLE' | 'SERVER_OPAQUE_SESSION';
}

/** Legacy disabled adapter shape retained for negative-path compatibility. */
export interface CanonicalAilyFinalUserActorContext {
  principalKind: 'FINAL_USER';
  transport: 'AILY_SIGNED_MCP_HTTP';
  canonicalSubject: { namespace: 'MIAODA_USER_ID'; id: string };
  subjectDecision: {
    source: 'AILY_SIGNED_JWT_AND_MIAODA_AUTHNPAAS_ID_CONVERT';
    applicationScopeId: string;
    tenantId: string;
    version: 'aily-jwt-hs256.authnpaas-user-convert.v1';
    decidedAt: string;
  };
  tenantId: string;
  applicationScopeId: string;
  applicationScopeProvenance: 'HOST_CONFIGURED_MIAODA_APP_ID';
  workspaceId: null;
  workspaceProvenance: 'UNAVAILABLE';
  env: string;
  platformRoles: readonly string[];
  identityProvenance: 'AILY_SIGNED_JWT';
  feishuUserId: string;
  feishuOpenId: null;
  feishuIdentityProvenance: 'AILY_SIGNED_JWT';
  agentId: string;
  tokenExpiresAt: string;
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
  | CanonicalAilyFinalUserActorContext
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
    | 'AILY_SIGNED_MCP_OBJECT_ACCESS'
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
  applicationScopeProvenance:
    | 'MIAODA_GATEWAY_APP_CONTEXT'
    | 'HOST_CONFIGURED_MIAODA_APP_ID';
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
    identity:
      | 'MIAODA_GATEWAY_USER_CONTEXT'
      | 'FEISHU_OAUTH_USER_ACCESS_TOKEN_AND_HOST_MAPPING'
      | 'AILY_SIGNED_JWT_AND_MIAODA_AUTHNPAAS_ID_CONVERT';
    applicationScope:
      | 'MIAODA_GATEWAY_APP_CONTEXT'
      | 'HOST_CONFIGURED_MIAODA_APP_ID';
    workspace: 'UNAVAILABLE';
    objectAuthorization: 'HOST_WORK_ITEM_REQUESTED_BY';
    memberAuthorization: 'UNAVAILABLE';
    session: 'UNAVAILABLE' | 'SERVER_OPAQUE_SESSION';
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
