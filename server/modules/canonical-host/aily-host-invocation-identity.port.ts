/** Host transport credentials only. Never serialized into a task, tool or receipt. */
export const AILY_HOST_INVOCATION_IDENTITY = Symbol('AILY_HOST_INVOCATION_IDENTITY');
export interface AilyHostInvocationRequest {
  purpose: 'BROWSER' | 'BACKGROUND';
  tenantId: string;
  actorUserId: string;
  workItemId: string;
  principalId: string;
  agentId: string;
}
export type AilyHostInvocationIdentity = {
  status: 'READY'; accessToken: string; identityRef: string;
  transport?: 'APPLICATION';
  callerAppId?: string;
  tenantId: string; actorUserId: string; workItemId: string; principalId: string; agentId: string;
} | {status: 'UNAVAILABLE'; transport?: 'APPLICATION'; reason:
  | 'AILY_BACKGROUND_IDENTITY_NOT_CONFIGURED' | 'AILY_INVOCATION_IDENTITY_UNAVAILABLE'
  | 'AILY_ENTERPRISE_CONFIGURATION_DISABLED' | 'AILY_ENTERPRISE_CONFIGURATION_INVALID'
  | 'AILY_MCP_SIGNING_SECRET_REQUIRED' | 'AILY_APPLICATION_CALLER_NOT_CONFIGURED'
  | 'AILY_APPLICATION_IDENTITY_UNAVAILABLE'};
export interface AilyHostInvocationIdentityPort {
  resolve(request: AilyHostInvocationRequest): Promise<AilyHostInvocationIdentity>;
}
export const UNAVAILABLE_AILY_HOST_INVOCATION_IDENTITY: AilyHostInvocationIdentityPort = {
  resolve: async request => ({status: 'UNAVAILABLE', reason: request.purpose === 'BACKGROUND'
    ? 'AILY_BACKGROUND_IDENTITY_NOT_CONFIGURED' : 'AILY_INVOCATION_IDENTITY_UNAVAILABLE'}),
};

export function assertAilyInvocationBinding(identity: Extract<AilyHostInvocationIdentity, {status: 'READY'}>,
  request: AilyHostInvocationRequest): string {
  if (!identity.accessToken || !identity.identityRef || identity.tenantId !== request.tenantId ||
      identity.actorUserId !== request.actorUserId || identity.workItemId !== request.workItemId ||
      identity.principalId !== request.principalId || identity.agentId !== request.agentId)
    throw new Error('AILY_INVOCATION_IDENTITY_BINDING_CHANGED');
  return identity.accessToken;
}
