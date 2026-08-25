/**
 * Identity verification seam — DEV/UAT only.
 *
 * The Miaoda gateway header `x-larkgw-suda-webuser` is caller-constructible.
 * `@NeedLogin` checks header presence, not authenticity. `AuthNPaasService`
 * performs ID conversion, not identity proof. None of these may serve as a
 * trusted final-user source for object access.
 *
 * Until a verifiable identity exchange exists (feishu OAuth user_access_token
 * or a signed hosted-ingress contract), every identity-verification port
 * remains unavailable and returns 503. No session table is created.
 */

/** Provenance of the identity claim. */
export type IdentityProvenance =
  /** Claimed by Miaoda gateway header — NOT verifiable, caller-constructible. */
  | 'MIAODA_GATEWAY_USER_CONTEXT'
  /** Verified by feishu OAuth user_access_token exchange (DEV/UAT fallback). */
  | 'FEISHU_OAUTH_USER_ACCESS_TOKEN'
  /** Verified by a signed hosted-ingress trust contract (future). */
  | 'SIGNED_HOSTED_INGRESS';

/**
 * Namespace for a namespaced subject identifier. A final-user subject is never
 * a bare string or plain object — it always carries a namespace so that a
 * bot-open-id or an opaque payload cannot be silently cast into a final user.
 */
export type SubjectNamespace =
  /** Feishu open_id, namespaced by tenant_key. */
  | 'FEISHU_OPEN_ID'
  /** Miaoda internal user_id (reserved for a future verified adapter). */
  | 'MIAODA_USER_ID';

/**
 * A namespaced subject. `tenantKey` scopes a FEISHU_OPEN_ID to a specific
 * Feishu tenant so that cross-tenant replay is impossible. A null subject
 * means no verified final user was resolved.
 */
export interface NamespacedSubject {
  namespace: SubjectNamespace;
  /** The subject identifier within the namespace (e.g. an open_id). */
  subject: string;
  /**
   * Feishu tenant key. Required when namespace is FEISHU_OPEN_ID; null for
   * MIAODA_USER_ID.
   */
  tenantKey: string | null;
}

/** What the identity verification port can resolve to. */
export type VerifiedIdentityResult =
  | { kind: 'VERIFIED'; identity: VerifiedIdentity }
  | { kind: 'UNAVAILABLE'; reason: IdentityUnavailableReason };

export interface VerifiedIdentity {
  /** Host-owned mapping row; required before a persistent session is issued. */
  subjectMappingId: string;
  provenance: IdentityProvenance;
  miaodaUserId: string;
  tenantId: string;
  feishuUserId: string | null;
  feishuOpenId: string | null;
  /**
   * Namespaced subject — the only acceptable form for a final-user
   * identifier. A bot open_id or a plain object can never appear here.
   */
  namespacedSubject: NamespacedSubject;
  verifiedAt: string;
}

export type IdentityUnavailableReason =
  | 'FEISHU_OAUTH_NOT_CONFIGURED'
  | 'SIGNED_INGRESS_NOT_CONFIGURED'
  | 'NO_VERIFIABLE_SOURCE'
  | 'FEISHU_OAUTH_NO_ACCESS_TOKEN'
  | 'FEISHU_OAUTH_USER_INFO_FAILED'
  | 'FEISHU_SUBJECT_MAPPING_MISSING'
  | 'FEISHU_TENANT_MISMATCH'
  | 'FEISHU_CLIENT_MISMATCH';

/** Stable error object for the 503 path (caught by GlobalExceptionFilter). */
export interface IdentityUnavailableError {
  code: 'IDENTITY_VERIFICATION_UNAVAILABLE';
  message: string;
  statusCode: 503;
  details: {
    reason: IdentityUnavailableReason;
    contextUserId: string | null;
    contextTenantId: string | null;
  };
}

/** Whoami response shape. */
export interface WhoamiResponse {
  authenticated: true;
  verifiedIdentity: {
    provenance: IdentityProvenance;
    miaodaUserId: string;
    tenantId: string;
    feishuUserId: string | null;
    feishuOpenId: string | null;
    namespacedSubject: NamespacedSubject | null;
    verifiedAt: string | null;
  };
  session: {
    id: string;
    revision: number;
    expiresAt: string;
    provenance: 'SERVER_OPAQUE_SESSION';
  };
}

/**
 * Live probe of the canonical object-access port. This is NOT a grant
 * attempt — it demonstrates that the identity-to-object-access seam is
 * wired and that an unverified identity produces a real 503 denial from
 * the production adapter, not a synthetic constant.
 */
export interface WhoamiObjectAccessProbe {
  /**
   * The ActorContext principalKind that was submitted to the port.
   * Always 'UNAVAILABLE' in G0 because no verified final user can be
   * resolved from the caller-constructible gateway header.
   */
  actorKind: 'FINAL_USER' | 'UNAVAILABLE';
  /**
   * When actorKind is UNAVAILABLE, the reason string from the
   * CanonicalUnavailableActorContext. Null when a FINAL_USER actor
   * was submitted (only possible after a future verified adapter).
   */
  unavailableReason: string | null;
  /**
   * The access result from the real CanonicalObjectAccessPort.
   * Null only when the probe could not be submitted (e.g. the port
   * is not wired). In G0 this is always a 503 denial.
   */
  accessResult: {
    allowed: false;
    code: string;
    statusCode: 503;
    denialSource: string;
  } | null;
}
