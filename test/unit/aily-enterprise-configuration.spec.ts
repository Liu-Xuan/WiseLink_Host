import { loadAilyEnterpriseConfiguration, type AilyEnterpriseConfigurationState } from '../../server/modules/canonical-host/aily-enterprise-configuration';
import { syntheticAilyEnterpriseJson } from '../support/aily-enterprise-configuration.fixture';
import type { Provider } from '@nestjs/common';
import { CanonicalHostModule } from '../../server/modules/canonical-host/canonical-host.module';
import { AilyHostInvocationIdentityProvider } from '../../server/modules/canonical-host/aily-host-invocation-identity.provider';
import { AilyBackgroundDispatchService } from '../../server/modules/canonical-host/aily-background-dispatch.service';
import { AILY_HOST_INVOCATION_IDENTITY } from '../../server/modules/canonical-host/aily-host-invocation-identity.port';
import { HierarchicalWikiAutomation } from '../../server/modules/canonical-host/hierarchical-wiki.automation';
import { AILY_MCP_CONFIGURATION } from '../../server/modules/canonical-host/aily-mcp-identity.service';
import { AILY_TASK_CONFIGURATION, AilyTaskAdmissionService } from '../../server/modules/canonical-host/aily-task-admission';

function mcpOnlyJson():Record<string,unknown> {
  const full=syntheticAilyEnterpriseJson();
  return {schemaVersion:full.schemaVersion,enabled:true,host:full.host,mcp:full.mcp,
    task:{enabled:false},background:{enabled:false,allowOriginalRequest:false}};
}

function configurationFactory(providers:Provider[],token:symbol):(state:AilyEnterpriseConfigurationState)=>unknown {
  const value=providers.find(provider=>typeof provider==='object'&&'provide'in provider&&provider.provide===token);
  if(!value||typeof value!=='object'||!('useFactory'in value)||typeof value.useFactory!=='function')
    throw new Error('SYNTHETIC_CONFIGURATION_FACTORY_MISSING');
  return value.useFactory as (state:AilyEnterpriseConfigurationState)=>unknown;
}

describe('strict server enterprise configuration', () => {
  it('registers the same real identity and background consumers in both canonical module entry paths', () => {
    const staticProviders = Reflect.getMetadata('providers', CanonicalHostModule) as Provider[];
    for (const providers of [staticProviders, CanonicalHostModule.forRoot().providers!]) {
      expect(providers).toEqual(expect.arrayContaining([AilyHostInvocationIdentityProvider, AilyBackgroundDispatchService, HierarchicalWikiAutomation]));
      expect(providers.find(provider => typeof provider === 'object' && 'provide' in provider && provider.provide === AILY_HOST_INVOCATION_IDENTITY))
        .toEqual({provide: AILY_HOST_INVOCATION_IDENTITY, useExisting: AilyHostInvocationIdentityProvider});
    }
  });
  it('defaults off without reading other credential/config sources', () => {
    expect(loadAilyEnterpriseConfiguration({})).toEqual({status: 'DISABLED', reason: 'AILY_ENTERPRISE_CONFIGURATION_DISABLED'});
    expect(loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON: '{"enabled":false}'}).status).toBe('DISABLED');
  });

  it('assembles the existing task and MCP types with a separately supplied signing key', () => {
    const value = loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON: JSON.stringify(syntheticAilyEnterpriseJson()),
      WL_AILY_MCP_SIGNING_SECRET: 'synthetic-only-key'});
    expect(value).toMatchObject({status: 'READY', configuration: {task: {workItemId: 'WI-test'},
      mcp: {signingSecret: 'synthetic-only-key', expectedClientId: 'cli_synthetic'}}});
  });

  it('injects only MCP in both real module factories and refuses formal identity/background before any I/O',async()=>{
    const state=loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON:JSON.stringify(mcpOnlyJson()),
      WL_AILY_MCP_SIGNING_SECRET:'synthetic-only-key'});
    expect(state).toMatchObject({status:'MCP_ONLY',reason:'AILY_ENTERPRISE_CONFIGURATION_DISABLED'});
    const staticProviders=Reflect.getMetadata('providers',CanonicalHostModule) as Provider[];
    for(const providers of [staticProviders,CanonicalHostModule.forRoot().providers!]) {
      expect(configurationFactory(providers,AILY_MCP_CONFIGURATION)(state)).toMatchObject({enabled:true,agentId:'agent_synthetic'});
      expect(configurationFactory(providers,AILY_TASK_CONFIGURATION)(state)).toBeNull();
    }
    const admission=new AilyTaskAdmissionService(null);
    const actors={withActorScope:jest.fn(),withActorTransaction:jest.fn()};
    const workItems={loadAutoProcessingProjection:jest.fn(),loadActiveAutoProcessingLease:jest.fn()};
    const provider=new AilyHostInvocationIdentityProvider(state,admission,actors as never,workItems as never);
    const http=jest.spyOn(provider as unknown as {request:(url:URL,init:RequestInit)=>Promise<Response>},'request');
    const execution={execute:jest.fn(),preflight:jest.fn()};const lifecycle={tick:jest.fn()};
    const repository={readByOperationRef:jest.fn()};const jobAid={enqueueAilyBackground:jest.fn()};
    const dispatch={claimAilyWorkItem:jest.fn()};const status={project:jest.fn()};
    const background=new AilyBackgroundDispatchService(state,admission,actors as never,workItems as never,status as never,
      repository as never,jobAid as never,{} as never,execution as never,lifecycle as never,dispatch as never);
    for(const purpose of ['BROWSER','BACKGROUND'] as const)
      expect(await provider.resolve({purpose,tenantId:'tenant-test',actorUserId:'owner-test',workItemId:'WI-test',
        principalId:'service:aily-synthetic',agentId:'agent_synthetic'})).toMatchObject({status:'UNAVAILABLE',reason:'AILY_ENTERPRISE_CONFIGURATION_DISABLED'});
    expect(await background.runOnce()).toEqual({status:'UNAVAILABLE',reason:'AILY_ENTERPRISE_CONFIGURATION_DISABLED'});
    for(const fn of [http,actors.withActorScope,actors.withActorTransaction,workItems.loadAutoProcessingProjection,
      workItems.loadActiveAutoProcessingLease,execution.execute,execution.preflight,lifecycle.tick,repository.readByOperationRef,
      jobAid.enqueueAilyBackground,dispatch.claimAilyWorkItem,status.project])expect(fn).not.toHaveBeenCalled();
    http.mockRestore();
  });

  it('keeps unknown connection namespaces explicit and requires the dedicated signing key',()=>{
    const value=mcpOnlyJson();const mcp=value.mcp as Record<string,unknown>;mcp.subjectNamespace=null;mcp.tenantNamespace=null;
    expect(loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON:JSON.stringify(value),
      WL_AILY_MCP_SIGNING_SECRET:'synthetic-only-key'})).toMatchObject({status:'MCP_ONLY',configuration:{mcp:{subjectNamespace:null,tenantNamespace:null}}});
    expect(loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON:JSON.stringify(value)}))
      .toEqual({status:'UNAVAILABLE',reason:'AILY_MCP_SIGNING_SECRET_REQUIRED'});
  });

  it.each(['caller','task-scope','task-secret','background','background-original','unknown-field','agent','client','host','namespace'])(
    'rejects hidden authority or malformed MCP-only %s',reason=>{
      const value=mcpOnlyJson();
      if(reason==='caller')value.caller=(syntheticAilyEnterpriseJson()).caller;
      if(reason==='task-scope')(value.task as Record<string,unknown>).workItemId='WI-unapproved';
      if(reason==='task-secret')(value.mcp as Record<string,unknown>).signingSecret='synthetic-do-not-leak';
      if(reason==='background')(value.background as Record<string,unknown>).enabled=true;
      if(reason==='background-original')(value.background as Record<string,unknown>).allowOriginalRequest=true;
      if(reason==='unknown-field')value.actorUserId='synthetic-owner';
      if(reason==='agent')(value.mcp as Record<string,unknown>).agentId='arbitrary-agent';
      if(reason==='client')(value.mcp as Record<string,unknown>).expectedClientId='arbitrary-client';
      if(reason==='host')(value.host as Record<string,unknown>).appId='app_other';
      if(reason==='namespace')(value.mcp as Record<string,unknown>).subjectNamespace='EMPLOYEE_NO';
      const state=loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON:JSON.stringify(value),
        WL_AILY_MCP_SIGNING_SECRET:'synthetic-do-not-leak'});
      expect(state).toEqual({status:'UNAVAILABLE',reason:'AILY_ENTERPRISE_CONFIGURATION_INVALID'});
      expect(JSON.stringify(state)).not.toContain('synthetic-do-not-leak');
    });

  it.each(['secret-in-json', 'actor', 'unknown-field', 'wrong-app', 'tenant', 'agent', 'client', 'namespace', 'unverified', 'duplicate-model'])
  ('keeps %s configuration unavailable without exposing values', reason => {
    const input = syntheticAilyEnterpriseJson();
    const object = (key: string) => input[key] as Record<string, unknown>;
    if (reason === 'secret-in-json') object('caller').appSecret = 'synthetic-do-not-leak';
    if (reason === 'actor') object('task').actorUserId = 'untrusted-actor';
    if (reason === 'unknown-field') input.queue = [];
    if (reason === 'wrong-app') object('host').appId = 'app_wrong';
    if (reason === 'tenant') object('caller').tenantId = 'different-tenant';
    if (reason === 'agent') object('mcp').agentId = 'agent_other';
    if (reason === 'client') object('mcp').expectedClientId = 'cli_other';
    if (reason === 'namespace') object('mcp').subjectNamespace = null;
    if (reason === 'unverified') object('task').apiAccessVerified = false;
    if (reason === 'duplicate-model') object('task').modelOptions = [
      {modelRef: 'aily/deepseek-v4-pro', platformBuiltIn: true}, {modelRef: 'aily/deepseek-v4-pro', platformBuiltIn: true}];
    const value = loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON: JSON.stringify(input),
      WL_AILY_MCP_SIGNING_SECRET: 'synthetic-do-not-leak'});
    expect(value).toEqual({status: 'UNAVAILABLE', reason: 'AILY_ENTERPRISE_CONFIGURATION_INVALID'});
    expect(JSON.stringify(value)).not.toContain('synthetic-do-not-leak');
  });

  it('requires the dedicated signing key rather than accepting an incomplete write route', () => {
    expect(loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON: JSON.stringify(syntheticAilyEnterpriseJson())}))
      .toEqual({status: 'UNAVAILABLE', reason: 'AILY_MCP_SIGNING_SECRET_REQUIRED'});
  });
});
