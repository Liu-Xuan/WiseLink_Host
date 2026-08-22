import type { VerifiedIdentity } from './identity.types';
import type { CanonicalMiaodaFinalUserActorContext } from '../work-item/canonical-object-access.port';

/**
 * Builds a CanonicalMiaodaFinalUserActorContext from a server-verified
 * Feishu OAuth identity plus a server-created opaque session.
 *
 * This is the ONLY function that may produce a FINAL_USER actor context
 * from a Feishu OAuth verification. The identity must have already passed:
 *   1. Server-side PKCE-protected token exchange
 *   2. Server-side user_info call (official open_id + tenant_key)
 *   3. Host-owned subject/tenant/client mapping
 *
 * The resulting actor context carries:
 * - canonicalSubject = MIAODA_USER_ID (from Host mapping, NOT from caller)
 * - identityProvenance = FEISHU_OAUTH_USER_ACCESS_TOKEN
 * - feishuOpenId / feishuUserId from the official user_info response
 * - sessionId / sessionRevision from the opaque server session
 *
 * R08: no caller-constructible field appears in this actor context.
 * The caller cannot influence miaodaUserId, tenantId, feishuOpenId, or
 * the session token — all are server-owned.
 */
export function buildActorContextFromVerifiedIdentity(
  identity: VerifiedIdentity,
  session: { sessionId: string; sessionRevision: number },
  applicationScopeId: string,
  env: string,
): CanonicalMiaodaFinalUserActorContext {
  return {
    principalKind: 'FINAL_USER',
    transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: {
      namespace: 'MIAODA_USER_ID',
      id: identity.miaodaUserId,
    },
    subjectDecision: {
      source: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      applicationScopeId,
      tenantId: identity.tenantId,
      version: 'feishu-oauth-verified.v1',
      decidedAt: identity.verifiedAt,
    },
    tenantId: identity.tenantId,
    applicationScopeId,
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    env,
    platformRoles: [],
    identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
    feishuUserId: identity.feishuUserId,
    feishuOpenId: identity.feishuOpenId,
    feishuIdentityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
    sessionId: session.sessionId,
    sessionRevision: session.sessionRevision,
    sessionProvenance: 'SERVER_OPAQUE_SESSION',
  };
}
