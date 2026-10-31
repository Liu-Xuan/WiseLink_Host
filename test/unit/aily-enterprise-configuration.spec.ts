import { loadAilyEnterpriseConfiguration, type AilyEnterpriseConfigurationState } from '../../server/modules/canonical-host/aily-enterprise-configuration';
import { syntheticAilyEnterpriseJson, syntheticAilyHostServiceConfiguration } from '../support/aily-enterprise-configuration.fixture';
import type { Provider } from '@nestjs/common';
import { CanonicalHostModule } from '../../server/modules/canonical-host/canonical-host.module';
import { AilyHostInvocationIdentityProvider } from '../../server/modules/canonical-host/aily-host-invocation-identity.provider';
import { AilyBackgroundDispatchService } from '../../server/modules/canonical-host/aily-background-dispatch.service';
import { AILY_HOST_INVOCATION_IDENTITY } from '../../server/modules/canonical-host/aily-host-invocation-identity.port';
import { HierarchicalWikiAutomation } from '../../server/modules/canonical-host/hierarchical-wiki.automation';
import { AILY_MCP_CONFIGURATION } from '../../server/modules/canonical-host/aily-mcp-identity.service';
import { AILY_TASK_CONFIGURATION, AilyTaskAdmissionService } from '../../server/modules/canonical-host/aily-task-admission';
import { AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION } from '../../server/modules/canonical-host/automatic-work-item-source-authorization.port';
import { MiaodaAutomaticWorkItemSourceAuthorizationAdapter } from '../../server/modules/canonical-host/miaoda-automatic-work-item-source-authorization.adapter';
import { DocumentManagementRuntimeModule } from '../../server/modules/document-management-runtime/document-management-runtime.module';
import { JOBAID_METHOD_BINDING } from '../../server/modules/canonical-host/jobaid-method-pack';
import { buildJobAidChecklistBinding } from '../../server/modules/canonical-host/jobaid-checklist-binding';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import type { AilyAssessmentMaterialBinding } from '../../server/modules/canonical-host/aily-task-admission';

function syntheticMaterialBinding(): AilyAssessmentMaterialBinding {
  const original = originalFixture().binding;
  const checklist = buildJobAidChecklistBinding({workItemId: 'WI-test', documentVersionId: original.documentVersionId,
    basedOnWorkItemRevision: 5});
  return {workItemId: 'WI-test', basedOnWorkItemRevision: 5, expectedWorkRevision: 0,
    originalBinding: original, checklistBinding: {definitionId: checklist.definitionId, definitionVersion: checklist.definitionVersion,
      definitionContentHash: checklist.definitionContentHash, contractVersion: checklist.contractVersion},
    methodBinding: structuredClone(JOBAID_METHOD_BINDING), documentRevision: 9, materialFormat: 'HOST_TASK_SNAPSHOT_V1'};
}

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
  it('connects the service domain source token to the original production authorizer adapter',()=>{
    const module=CanonicalHostModule.forRoot({imports:[DocumentManagementRuntimeModule]});
    expect(module.imports).toContain(DocumentManagementRuntimeModule);
    expect(module.providers).toContainEqual({provide:AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION,
      useClass:MiaodaAutomaticWorkItemSourceAuthorizationAdapter});
    expect(Reflect.getMetadata('exports',DocumentManagementRuntimeModule)).toBeDefined();
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

  it('accepts reference registrations only within the exact application task configuration', () => {
    const value = syntheticAilyEnterpriseJson();
    const references = [{attachmentId: 'synthetic:registered/doc-one', documentUrl: 'https://tenant.example.com/docx/SYNTHETIC',
      registeredCallerAppId: 'cli_synthetic', expectedDocumentVersionId: 'DV-TEST', purpose: 'REFERENCE_SNAPSHOT',
      registrationSource: 'synthetic-registration-receipt'}];
    (value.task as Record<string, unknown>).referenceAttachments = references;
    const state = loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON: JSON.stringify(value),
      WL_AILY_MCP_SIGNING_SECRET: 'synthetic-only-key'});
    expect(state).toMatchObject({status: 'READY', configuration: {task: {referenceAttachments: references},
      caller: {browserTransport: 'APPLICATION'}}});
  });

  it('retains an explicitly checked complete material binding using existing original, checklist and method versions', () => {
    const value = syntheticAilyEnterpriseJson(); const materialBinding = syntheticMaterialBinding();
    (value.task as Record<string, unknown>).referenceAttachments = [{attachmentId: 'synthetic-checked-material',
      documentUrl: 'https://tenant.example.com/docx/SYNTHETIC', registeredCallerAppId: 'cli_synthetic',
      expectedDocumentVersionId: materialBinding.originalBinding.documentVersionId, purpose: 'REFERENCE_SNAPSHOT',
      registrationSource: 'synthetic-registration-and-material-check', materialBinding}];
    const state = loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON: JSON.stringify(value),
      WL_AILY_MCP_SIGNING_SECRET: 'synthetic-only-key'});
    expect(state).toMatchObject({status: 'READY', configuration: {task: {referenceAttachments: [{materialBinding}]}}});
  });

  it.each(['work-item', 'document-version', 'expected-revision', 'document-revision', 'format', 'missing-original',
    'missing-checklist-version', 'missing-method-limitation', 'missing-method-document-version', 'unknown-complete-flag', 'duplicate-material'] as const)(
    'refuses incomplete or ambiguous declared material %s instead of reverting to legacy references', changed => {
      const value = syntheticAilyEnterpriseJson(); const materialBinding = syntheticMaterialBinding();
      const reference = {attachmentId: 'synthetic-checked-material', documentUrl: 'https://tenant.example.com/docx/SYNTHETIC',
        registeredCallerAppId: 'cli_synthetic', expectedDocumentVersionId: 'DV-TEST', purpose: 'REFERENCE_SNAPSHOT',
        registrationSource: 'synthetic-material-check', materialBinding};
      if (changed === 'work-item') materialBinding.workItemId = 'WI-OTHER';
      if (changed === 'document-version') materialBinding.originalBinding.documentVersionId = 'DV-OTHER';
      if (changed === 'expected-revision') Object.assign(materialBinding, {expectedWorkRevision: 1});
      if (changed === 'document-revision') materialBinding.documentRevision = 0;
      if (changed === 'format') Object.assign(materialBinding, {materialFormat: 'UNVERIFIED_URL'});
      if (changed === 'missing-original') delete (materialBinding as unknown as Record<string, unknown>).originalBinding;
      if (changed === 'missing-checklist-version') delete (materialBinding.checklistBinding as unknown as Record<string, unknown>).contractVersion;
      if (changed === 'missing-method-limitation') delete (materialBinding.methodBinding as unknown as Record<string, unknown>).attachment5;
      if (changed === 'missing-method-document-version') delete (materialBinding.methodBinding.sources[0] as unknown as Record<string, unknown>).documentVersionId;
      if (changed === 'unknown-complete-flag') Object.assign(materialBinding, {complete: true});
      (value.task as Record<string, unknown>).referenceAttachments = changed === 'duplicate-material'
        ? [reference, {...reference, attachmentId: 'synthetic-second-material'}] : [reference];
      expect(loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON: JSON.stringify(value),
        WL_AILY_MCP_SIGNING_SECRET: 'synthetic-only-key'})).toEqual({status: 'UNAVAILABLE', reason: 'AILY_ENTERPRISE_CONFIGURATION_INVALID'});
    });

  it.each(['missing-id', 'empty-id', 'duplicate', 'too-many', 'empty-list', 'purpose', 'caller', 'user-transport',
    'document-url', 'document-version', 'registration-source', 'unknown-field'])(
    'rejects invalid reference attachment %s without falling back to a text-only configuration', reason => {
      const value = syntheticAilyEnterpriseJson();
      const reference: Record<string, unknown> = {attachmentId: 'synthetic:registered/doc-one',
        documentUrl: 'https://tenant.example.com/docx/SYNTHETIC', registeredCallerAppId: 'cli_synthetic',
        expectedDocumentVersionId: 'DV-TEST', purpose: 'REFERENCE_SNAPSHOT', registrationSource: 'synthetic-registration-receipt'};
      let references: Record<string, unknown>[] = [reference];
      if (reason === 'missing-id') delete reference.attachmentId;
      if (reason === 'empty-id') reference.attachmentId = ' ';
      if (reason === 'duplicate') references = [reference, {...reference}];
      if (reason === 'too-many') references = Array.from({length: 9}, (_, index) => ({...reference, attachmentId: `synthetic-${index}`}));
      if (reason === 'empty-list') references = [];
      if (reason === 'purpose') reference.purpose = 'PRIMARY_SOURCE_READ';
      if (reason === 'caller') reference.registeredCallerAppId = 'cli_other';
      if (reason === 'user-transport') (value.caller as Record<string, unknown>).browserTransport = 'USER_GRANT';
      if (reason === 'document-url') reference.documentUrl = 'http://tenant.example.com/docx/SYNTHETIC';
      if (reason === 'document-version') reference.expectedDocumentVersionId = '';
      if (reason === 'registration-source') reference.registrationSource = '';
      if (reason === 'unknown-field') reference.accessToken = 'synthetic-do-not-leak';
      (value.task as Record<string, unknown>).referenceAttachments = references;
      const state = loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON: JSON.stringify(value),
        WL_AILY_MCP_SIGNING_SECRET: 'synthetic-only-key'});
      expect(state).toEqual({status: 'UNAVAILABLE', reason: 'AILY_ENTERPRISE_CONFIGURATION_INVALID'});
      expect(JSON.stringify(state)).not.toContain('synthetic-do-not-leak');
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


describe('strict fixed-service configuration',()=>{
  function full():Record<string,unknown> {
    const {configuration}=syntheticAilyHostServiceConfiguration();
    return {schemaVersion:'wiselink.aily-enterprise-configuration.v1',enabled:true,...configuration};
  }
  it('accepts explicit HOST_SERVICE without a signer and leaves original verified facts unchanged',()=>{
    const value=full();const state=loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON:JSON.stringify(value)});
    expect(state).toMatchObject({status:'READY',configuration:{mcp:{authenticationMode:'HOST_SERVICE',tenantId:'tenant-test',
      principalId:'service:aily-synthetic'},caller:{browserTransport:'APPLICATION'}}});
    if(state.status!=='READY')throw new Error('SYNTHETIC_READY_REQUIRED');
    expect(state.configuration.mcp).not.toHaveProperty('signingSecret');
    expect(state.configuration.mcp).not.toHaveProperty('subjectNamespace');
    expect(state.configuration.task.apiAccessVerified).toBe(true);expect(state.configuration.task.trustedToolsVerified).toBe(true);
  });
  it('permits service MCP-only while Task/provider/background remain disabled',()=>{
    const value=full();value.task={enabled:false};value.background={enabled:false,allowOriginalRequest:false};delete value.caller;
    const state=loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON:JSON.stringify(value)});
    expect(state.status).toBe('MCP_ONLY');
    const providers=Reflect.getMetadata('providers',CanonicalHostModule) as Provider[];
    expect(configurationFactory(providers,AILY_TASK_CONFIGURATION)(state)).toBeNull();
    expect(configurationFactory(providers,AILY_MCP_CONFIGURATION)(state)).toMatchObject({authenticationMode:'HOST_SERVICE'});
  });
  it.each(['tenant','principal','agent','app','user-transport','mixed-namespace','mixed-secret','unverified','unknown-mode'])(
    'rejects %s instead of inferring service authority or falling back',reason=>{
      const value=full();const mcp=value.mcp as Record<string,unknown>;const task=value.task as Record<string,unknown>;
      if(reason==='tenant')mcp.tenantId='tenant-other';if(reason==='principal')mcp.principalId='service:other';
      if(reason==='agent')mcp.agentId='agent_other';if(reason==='app')mcp.expectedClientId='cli_other';
      if(reason==='user-transport')(value.caller as Record<string,unknown>).browserTransport='USER_GRANT';
      if(reason==='mixed-namespace')mcp.subjectNamespace='FEISHU_OPEN_ID';if(reason==='mixed-secret')mcp.signingSecret='synthetic-private';
      if(reason==='unverified')task.trustedToolsVerified=false;if(reason==='unknown-mode')mcp.authenticationMode='INFER';
      expect(loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON:JSON.stringify(value)}))
        .toEqual({status:'UNAVAILABLE',reason:'AILY_ENTERPRISE_CONFIGURATION_INVALID'});
    });
});
