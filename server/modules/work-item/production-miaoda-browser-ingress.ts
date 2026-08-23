import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';

import { CANONICAL_MIAODA_APP_ID } from '../canonical-host/canonical-host.constants';
import type { CanonicalMiaodaFinalUserActorContext } from './canonical-object-access.port';

const HOSTED_ENVS = new Set(['preview', 'runtime']);
const HOSTED_FRAMEWORK_ENVS = new Set(['boe', 'pre', 'online']);

export interface MiaodaHostedUserContext {
  userId?: unknown;
  tenantId?: unknown;
  appId?: unknown;
  env?: unknown;
  roles?: unknown;
  isSystemAccount?: unknown;
}

/**
 * The native Miaoda identity header is trusted only at the platform-hosted
 * ingress. Direct/local Host execution remains closed because the application
 * cannot cryptographically authenticate a caller-constructed copy of it.
 * Hosted ingress must strip/replace the header before this process receives
 * the request; exact app and hosted environment binding keep that trust
 * boundary explicit in application code.
 */
export function assertProductionMiaodaBrowserIdentityAvailable(
  context?: MiaodaHostedUserContext,
): void {
  if (
    process.env.MIAODA_LOCAL_DEV === '1' ||
    !hasHostedProcessProvenance() ||
    !isRequiredText(context?.userId) ||
    !isRequiredTenantId(context?.tenantId) ||
    context?.appId !== CANONICAL_MIAODA_APP_ID ||
    !isRequiredText(context?.env) ||
    !HOSTED_ENVS.has(context.env) ||
    context?.isSystemAccount === true
  ) {
    throw identityHandoffUnavailable();
  }
}

function hasHostedProcessProvenance(): boolean {
  const sandboxId = process.env.SANDBOX_ID?.trim();
  const frameworkEnv =
    process.env.FORCE_FRAMEWORK_ENVIRONMENT?.trim().toLowerCase();
  return Boolean(
    sandboxId || (frameworkEnv && HOSTED_FRAMEWORK_ENVS.has(frameworkEnv)),
  );
}

export function miaodaHostedFinalUserActor(
  context: MiaodaHostedUserContext | undefined,
): CanonicalMiaodaFinalUserActorContext {
  assertProductionMiaodaBrowserIdentityAvailable(context);
  const userId = String(context?.userId).trim();
  const tenantId = String(context?.tenantId).trim();
  const appId = String(context?.appId).trim();
  const env = String(context?.env).trim();
  const platformRoles = Array.isArray(context?.roles)
    ? context.roles.filter(isRequiredText).map((role) => role.trim())
    : [];
  return {
    principalKind: 'FINAL_USER',
    transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: userId },
    subjectDecision: {
      source: 'MIAODA_GATEWAY_USER_CONTEXT',
      applicationScopeId: appId,
      tenantId,
      version: 'miaoda-hosted-native-sso.v1',
      decidedAt: new Date().toISOString(),
    },
    tenantId,
    applicationScopeId: appId,
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    env,
    platformRoles,
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    feishuUserId: null,
    feishuOpenId: null,
    feishuIdentityProvenance: 'UNAVAILABLE',
    sessionId: null,
    sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE',
  };
}

@Injectable()
export class ProductionMiaodaBrowserObjectIngressGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      userContext?: MiaodaHostedUserContext;
    }>();
    assertProductionMiaodaBrowserIdentityAvailable(request.userContext);
    return true;
  }
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRequiredTenantId(value: unknown): value is string | number {
  return (
    isRequiredText(value) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  );
}

function identityHandoffUnavailable(): Error & {
  code: string;
  statusCode: number;
  denialSource: string;
} {
  return Object.assign(new Error('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE'), {
    code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
    statusCode: 503,
    denialSource: 'MIAODA_BROWSER_UNAVAILABLE_ADAPTER',
  });
}
