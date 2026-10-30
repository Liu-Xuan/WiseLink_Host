import type { AilyUserJwtMcpConfiguration, AilyHostServiceMcpConfiguration } from '../../server/modules/canonical-host/aily-mcp-identity.service';
import type { AilyEnterpriseConfigurationState } from '../../server/modules/canonical-host/aily-enterprise-configuration';

/** Explicit synthetic approved-facts fixture, never a platform or credential sample. */
export function syntheticAilyEnterpriseConfiguration(): Extract<AilyEnterpriseConfigurationState, {status: 'READY'}> & {configuration:{mcp:AilyUserJwtMcpConfiguration}} {
  return {status: 'READY', configuration: {
    host: {appId: 'app_17bzc551rsg', environment: 'development'},
    task: {enabled: true, tenantId: 'tenant-test', workItemId: 'WI-test', intakeRequestId: 'original-intake',
      agentId: 'agent_synthetic', principalId: 'service:aily-synthetic', authorizationFingerprint: 'synthetic-scope',
      publicationRef: 'synthetic-publication', configurationSource: 'synthetic-approved-fixture',
      apiAccessVerified: true, trustedToolsVerified: true,
      modelOptions: [{modelRef: 'aily/deepseek-v4-pro', platformBuiltIn: true}]},
    caller: {appId: 'cli_synthetic', tenantId: 'tenant-test', identityRef: 'synthetic-approved-caller',
      configurationSource: 'synthetic-caller-proof', sameHostApplicationVerified: true, targetAccessVerified: true,
      browserTransport: 'APPLICATION'},
    mcp: {enabled: true, agentId: 'agent_synthetic', expectedClientId: 'cli_synthetic',
      signingSecret: 'synthetic-mcp-secret', subjectNamespace: 'FEISHU_OPEN_ID', tenantNamespace: 'FEISHU_TENANT_KEY'},
    background: {enabled: true, allowOriginalRequest: true},
  }};
}

export function syntheticAilyEnterpriseJson(): Record<string, unknown> {
  const {configuration} = syntheticAilyEnterpriseConfiguration();
  const {signingSecret: _secret, ...mcp} = configuration.mcp;
  return {schemaVersion: 'wiselink.aily-enterprise-configuration.v1', enabled: true,
    host: configuration.host, task: configuration.task, caller: configuration.caller, mcp, background: configuration.background};
}

/** Service trust fixture; no JWT subject, expiry, mapping or signing material. */
export function syntheticAilyHostServiceConfiguration():Extract<AilyEnterpriseConfigurationState,{status:'READY'}> &
  {configuration:{mcp:AilyHostServiceMcpConfiguration}} {
  const {configuration}=syntheticAilyEnterpriseConfiguration();
  return {status:'READY',configuration:{...configuration,mcp:{authenticationMode:'HOST_SERVICE',enabled:true,
    agentId:configuration.task.agentId,expectedClientId:configuration.caller.appId,
    tenantId:configuration.task.tenantId,principalId:configuration.task.principalId}}};
}
