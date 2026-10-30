import { Logger, UnauthorizedException } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/server';
import { CanonicalHostAilyMcpService } from '../../server/modules/canonical-host/canonical-host-aily-mcp.service';
import { ailySourceCommand, ailyValidateCommand, ailySaveCommand, ailyReadCommand, ailyStageCommand, ailyFinishCommand } from '../../server/modules/canonical-host/aily-task-domain.types';
import { AilyMcpIdentityService, type AilyMcpIdentityDiagnostic } from '../../server/modules/canonical-host/aily-mcp-identity.service';
import { loadAilyEnterpriseConfiguration } from '../../server/modules/canonical-host/aily-enterprise-configuration';
import { syntheticAilyEnterpriseJson } from '../support/aily-enterprise-configuration.fixture';
import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';

function connectionFixture(configured = true) {
  const full=syntheticAilyEnterpriseJson();
  const state=loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON:JSON.stringify({
    schemaVersion:full.schemaVersion,enabled:true,host:full.host,mcp:full.mcp,
    task:{enabled:false},background:{enabled:false,allowOriginalRequest:false}}),WL_AILY_MCP_SIGNING_SECRET:'synthetic-only-signature'});
  if(state.status!=='MCP_ONLY')throw new Error('SYNTHETIC_MCP_ONLY_REQUIRED');
  const mapping=jest.fn(async(_input:{feishuOpenId:string;feishuTenantKey:string;expectedClientId:string}):
    Promise<{id:string;revision:number;miaodaUserId:string;miaodaTenantId:string}|null>=>
    ({id:'synthetic-mapping',revision:1,miaodaUserId:'synthetic-owner',miaodaTenantId:'synthetic-tenant'}));
  const identity=new AilyMcpIdentityService({resolveSubjectMapping:mapping} as never,configured?state.configuration.mcp:null);
  const domain={sources:jest.fn(),validate:jest.fn(),save:jest.fn(),read:jest.fn(),stageOverall:jest.fn(),finish:jest.fn()};
  const service=new CanonicalHostAilyMcpService(identity,domain as never);
  const jwt=(claims:Record<string,unknown>={})=>{
    const head=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({agent_id:state.configuration.mcp.agentId,user_id:'synthetic-open-id',
      tenant_id:'synthetic-tenant-key',exp:4102444800,...claims})).toString('base64url');
    return `${head}.${payload}.${createHmac('sha256',state.configuration.mcp.signingSecret).update(`${head}.${payload}`).digest('base64url')}`;
  };
  return {state,mapping,identity,domain,service,jwt};
}

function protocolResponse(contentType:string,wire:string,expectedId:string|number|null):Record<string,unknown> {
  const mediaType=contentType.split(';')[0].trim().toLowerCase();
  const messages:unknown[]=[];
  if(mediaType==='application/json')messages.push(JSON.parse(wire));
  else if(mediaType==='text/event-stream') {
    const stream=wire.replace(/^\uFEFF/u,'').replace(/\r\n?/gu,'\n');
    if(!stream.endsWith('\n\n'))throw new Error('SYNTHETIC_MCP_TRUNCATED_SSE');
    for(const frame of stream.split('\n\n')) {
      const data:string[]=[];let event='message';
      for(const line of frame.split('\n')) {
        if(!line||line.startsWith(':'))continue;
        const colon=line.indexOf(':');const field=colon<0?line:line.slice(0,colon);
        const value=colon<0?'':line.slice(colon+1).replace(/^ /u,'');
        if(field==='event')event=value;
        if(field==='data')data.push(value);
      }
      if(!data.length)continue;
      if(event!=='message')throw new Error('SYNTHETIC_MCP_UNEXPECTED_SSE_EVENT');
      messages.push(JSON.parse(data.join('\n')));
    }
  } else throw new Error('SYNTHETIC_MCP_UNEXPECTED_CONTENT_TYPE');
  const responses:Record<string,unknown>[]=[];
  for(const value of messages) {
    if(!value||typeof value!=='object'||Array.isArray(value)||!('jsonrpc'in value)||value.jsonrpc!=='2.0')
      throw new Error('SYNTHETIC_MCP_JSONRPC_INVALID');
    const message=value as Record<string,unknown>;
    if(!Object.hasOwn(message,'id')) {
      if(typeof message.method!=='string'||!message.method||Object.hasOwn(message,'result')||Object.hasOwn(message,'error'))
        throw new Error('SYNTHETIC_MCP_NOTIFICATION_INVALID');
      continue;
    }
    if(message.id!==expectedId)throw new Error('SYNTHETIC_MCP_RESPONSE_ID_MISMATCH');
    if(Object.hasOwn(message,'result')===Object.hasOwn(message,'error'))throw new Error('SYNTHETIC_MCP_RESPONSE_INVALID');
    if(Object.hasOwn(message,'error')) {
      const error=message.error;
      if(!error||typeof error!=='object'||Array.isArray(error)||!('code'in error)||!Number.isInteger(error.code)||
          !('message'in error)||typeof error.message!=='string')throw new Error('SYNTHETIC_MCP_ERROR_INVALID');
    }
    responses.push(message);
  }
  if(responses.length!==1)throw new Error('SYNTHETIC_MCP_EXACT_RESPONSE_REQUIRED');
  return responses[0];
}

let discoveryLog:jest.SpyInstance;
beforeEach(()=>{discoveryLog=jest.spyOn(Logger.prototype,'log').mockImplementation(()=>undefined);});
afterEach(()=>{jest.restoreAllMocks();});

/** Actual Node adapter/protocol, with in-memory Node HTTP surfaces; no listener. */
async function protocolWire(service:CanonicalHostAilyMcpService,body:unknown,jwt:unknown=undefined) {
  let status=0;let responseHeaders:Record<string,string>={};const chunks:Buffer[]=[];
  const request={method:'POST',url:'/openapi/wiselink/aily-mcp',headers:{host:'localhost',
    'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'}};
  const response=Object.assign(new EventEmitter(),{destroyed:false,
    writeHead:(code:number,headers:Record<string,string>)=>{status=code;responseHeaders=headers;},
    write:(bytes:Uint8Array)=>{chunks.push(Buffer.from(bytes));return true;},end:()=>undefined});
  await service.handle(request as unknown as Parameters<CanonicalHostAilyMcpService['handle']>[0],
    response as unknown as Parameters<CanonicalHostAilyMcpService['handle']>[1],body,jwt);
  const contentType=Object.entries(responseHeaders).find(([name])=>name.toLowerCase()==='content-type')?.[1]??'';
  return {status,contentType,wire:Buffer.concat(chunks).toString('utf8')};
}

async function protocol(service:CanonicalHostAilyMcpService,body:unknown,jwt:unknown=undefined) {
  const response=await protocolWire(service,body,jwt);
  const id=response.status!==400&&body&&typeof body==='object'&&!Array.isArray(body)&&'id'in body&&
    (typeof body.id==='string'||typeof body.id==='number')?body.id:null;
  return {...response,body:response.status===202&&response.wire===''
    ?null:protocolResponse(response.contentType,response.wire,id)};
}

const toolInputs:[string,object][]=[
  ['read_assessment_sources',{taskContextRef:'AQ-synthetic',sourceRefs:['source:synthetic'],purpose:'核来源'}],
  ['validate_assessment_work',{taskContextRef:'AQ-synthetic',workJson:'{}'}],
  ['save_assessment_work',{taskContextRef:'AQ-synthetic',candidateRef:'00000000-0000-4000-8000-000000000001'}],
  ['read_assessment_work',{taskContextRef:'AQ-synthetic',workRevisionRef:'JAWR-synthetic'}],
  ['project_assessment_stage_overall',{taskContextRef:'AQ-synthetic',workRevisionRef:'JAWR-synthetic'}],
  ['finish_assessment_task',{taskContextRef:'AQ-synthetic',workRevisionRef:'JAWR-synthetic'}],
];
const initialize={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',
  capabilities:{},clientInfo:{name:'synthetic-client',version:'1'}}};
function call(name=toolInputs[0][0],args=toolInputs[0][1],id=3) {
  return {jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}};
}
function noDomain(h:ReturnType<typeof connectionFixture>) {
  for(const method of Object.values(h.domain))expect(method).not.toHaveBeenCalled();
}
function authEvent(method:string,outcome:string,identityDiagnostic?:AilyMcpIdentityDiagnostic) {
  return JSON.stringify({event:'AILY_MCP_DISCOVERY_AUTH',method,outcome,domainDispatched:false,
    ...(identityDiagnostic?{identityDiagnostic}:{})});
}
function expectedDiagnostic(stage:AilyMcpIdentityDiagnostic['stage'],fields:Partial<Omit<AilyMcpIdentityDiagnostic,'stage'>>={}):AilyMcpIdentityDiagnostic {
  return {stage,signatureVerified:null,userIdType:null,tenantIdType:null,agentMatched:null,expiryValid:null,...fields};
}
const signedStringClaims={signatureVerified:true,userIdType:'STRING' as const,tenantIdType:'STRING' as const};

describe('enterprise MCP strict selectors',()=>{
  const candidate='00000000-0000-4000-8000-000000000001';
  const cases:[{safeParse(value:unknown):{success:boolean}},object][]=[
    [ailySourceCommand,{taskContextRef:'AQ-synthetic',sourceRefs:['source:synthetic'],purpose:'核来源'}],
    [ailyValidateCommand,{taskContextRef:'AQ-synthetic',workJson:'{}'}],
    [ailySaveCommand,{taskContextRef:'AQ-synthetic',candidateRef:candidate}],
    [ailyReadCommand,{taskContextRef:'AQ-synthetic',workRevisionRef:'JAWR-synthetic'}],
    [ailyStageCommand,{taskContextRef:'AQ-synthetic',workRevisionRef:'JAWR-synthetic'}],
    [ailyFinishCommand,{taskContextRef:'AQ-synthetic',workRevisionRef:'JAWR-synthetic'}],
  ];
  it.each(cases)('accepts only selection and domain content, never model authority', (schema,value)=>{
    expect(schema.safeParse(value).success).toBe(true);
    for (const field of ['actorUserId','tenantId','leaseToken','leaseGeneration','expectedWorkRevision','resultEnvelope','scope'])
      expect(schema.safeParse({...value,[field]:'forged'}).success).toBe(false);
  });
  it('registers the six actual facade methods without Native claim or queue tools',async()=>{
    const h=connectionFixture();const domain=h.domain;domain.sources.mockResolvedValue({read:true});
    const registered=new Map<string,{call:(input:never)=>Promise<unknown>}>();
    const spy=jest.spyOn(McpServer.prototype,'registerTool').mockImplementation(function(name,_definition,call){
      registered.set(name,{call:call as never});return {remove:jest.fn(),enable:jest.fn(),disable:jest.fn(),update:jest.fn()} as never;
    });
    try {
      (h.service as unknown as {server(jwt:unknown):McpServer}).server(h.jwt());
      expect([...registered.keys()]).toEqual(['read_assessment_sources','validate_assessment_work','save_assessment_work',
        'read_assessment_work','project_assessment_stage_overall','finish_assessment_task']);
      const input=ailySourceCommand.parse(cases[0][1]);
      await registered.get('read_assessment_sources')!.call(input as never);
      expect(domain.sources).toHaveBeenCalledWith(expect.objectContaining({actorUserId:'synthetic-owner',tenantId:'synthetic-tenant'}),input);
      expect(h.mapping).toHaveBeenCalledTimes(1);
      domain.sources.mockRejectedValueOnce(new Error('private body must not be returned'));
      expect(await registered.get('read_assessment_sources')!.call(input as never)).toMatchObject({isError:true,
        content:[{text:JSON.stringify({code:'AILY_DOMAIN_OPERATION_UNCONFIRMED'})}]});
    } finally {spy.mockRestore();}
  });

  it('handles initialize and tools/list in explicit MCP-only mode without invoking a domain consumer',async()=>{
    const h=connectionFixture();
    const initialized=await protocol(h.service,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',
      capabilities:{},clientInfo:{name:'synthetic-client',version:'1'}}},h.jwt());
    expect(initialized.status).toBe(200);expect(initialized.body).toMatchObject({jsonrpc:'2.0',id:1,result:{serverInfo:{name:'wiselink-aily-engineering'}}});
    expect(initialized.body).not.toHaveProperty('error');
    const listed=await protocol(h.service,{jsonrpc:'2.0',id:2,method:'tools/list',params:{}},h.jwt());
    expect(listed.status).toBe(200);expect(listed.body).toMatchObject({jsonrpc:'2.0',id:2});expect(listed.body).not.toHaveProperty('error');
    const tools=(listed.body as {result:{tools:Array<{name:string;inputSchema:unknown}>}}).result.tools;
    expect(tools.map(tool=>tool.name)).toEqual(['read_assessment_sources','validate_assessment_work','save_assessment_work',
      'read_assessment_work','project_assessment_stage_overall','finish_assessment_task']);
    expect(tools.every(tool=>typeof tool.inputSchema==='object')).toBe(true);
    expect(h.mapping).toHaveBeenCalledTimes(2);
    for(const method of Object.values(h.domain))expect(method).not.toHaveBeenCalled();
  });

  it.each(['NAMESPACE_UNKNOWN','WRONG_AGENT','NO_MAPPING'] as const)('observes %s without granting static discovery actor authority',async reason=>{
    const h=connectionFixture();
    if(reason==='NAMESPACE_UNKNOWN')h.state.configuration.mcp.subjectNamespace=null;
    if(reason==='NO_MAPPING')h.mapping.mockResolvedValueOnce(null);
    const result=await protocol(h.service,{jsonrpc:'2.0',id:1,method:'tools/list',params:{}},
      h.jwt(reason==='WRONG_AGENT'?{agent_id:'agent_other'}:{}));
    expect(result.status).toBe(200);expect(result.body).toHaveProperty('result.tools');noDomain(h);
    const outcome=reason==='NAMESPACE_UNKNOWN'?'NOT_CONFIGURED':reason==='NO_MAPPING'?'MAPPING_MISSING':'REJECTED';
    const diagnostic=reason==='NAMESPACE_UNKNOWN'?expectedDiagnostic('CONFIGURATION'):reason==='NO_MAPPING'
      ?expectedDiagnostic('SUBJECT_MAPPING',{...signedStringClaims,agentMatched:true,expiryValid:true})
      :expectedDiagnostic('JWT_AGENT',{signatureVerified:true,agentMatched:false});
    expect(discoveryLog).toHaveBeenCalledWith(authEvent('tools/list',outcome,diagnostic));
    if(reason!=='NO_MAPPING')expect(h.mapping).not.toHaveBeenCalled();
  });
});

describe('gateway static discovery and fresh business authentication',()=>{
  it.each([undefined,'synthetic-private-invalid-jwt'])(
    'serves identical SDK metadata without signer for header %s, never a domain reader',async header=>{
      const h=connectionFixture(false);const verify=jest.spyOn(h.identity,'verify');
      expect(loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON:JSON.stringify({
        schemaVersion:'wiselink.aily-enterprise-configuration.v1',enabled:true,
        host:h.state.configuration.host,mcp:syntheticAilyEnterpriseJson().mcp,
        task:{enabled:false},background:{enabled:false,allowOriginalRequest:false}})}))
        .toEqual({status:'UNAVAILABLE',reason:'AILY_MCP_SIGNING_SECRET_REQUIRED'});
      const initialized=await protocol(h.service,initialize,header);
      expect(initialized.status).toBe(200);expect(initialized.body).toMatchObject({jsonrpc:'2.0',id:1,
        result:{serverInfo:{name:'wiselink-aily-engineering',version:'1.0.0'}}});
      const listed=await protocol(h.service,{jsonrpc:'2.0',id:2,method:'tools/list'},header);
      expect(listed.status).toBe(200);expect(listed.body).not.toHaveProperty('error');
      const tools=(listed.body as {result:{tools:Array<{name:string;inputSchema:unknown}>}}).result.tools;
      expect(tools.map(tool=>tool.name)).toEqual(toolInputs.map(([name])=>name));
      for(const tool of tools)expect(tool.inputSchema).toMatchObject({type:'object',additionalProperties:false});
      const ping=await protocol(h.service,{jsonrpc:'2.0',id:4,method:'ping'},header);
      expect(ping.body).toMatchObject({jsonrpc:'2.0',id:4,result:{}});
      const notified=await protocol(h.service,{jsonrpc:'2.0',method:'notifications/initialized'},header);
      expect(notified.status).toBe(202);expect(notified.body).toBeNull();
      expect(verify).toHaveBeenCalledTimes(header===undefined?0:4);
      const outcome=header===undefined?'MISSING_JWT':'NOT_CONFIGURED';
      for(const method of ['initialize','tools/list','ping','notifications/initialized'])
        expect(discoveryLog).toHaveBeenCalledWith(authEvent(method,outcome,
          header===undefined?undefined:expectedDiagnostic('CONFIGURATION')));
      expect(h.mapping).not.toHaveBeenCalled();noDomain(h);
    });

  it.each([
    [{user_id:123},'REJECTED',expectedDiagnostic('JWT_SUBJECT',{signatureVerified:true,userIdType:'NUMBER',agentMatched:true})],
    [{tenant_id:123},'REJECTED',expectedDiagnostic('JWT_SUBJECT',{...signedStringClaims,tenantIdType:'NUMBER',agentMatched:true})],
    [{agent_id:'agent_other'},'REJECTED',expectedDiagnostic('JWT_AGENT',{signatureVerified:true,agentMatched:false})],
    [{exp:0},'REJECTED',expectedDiagnostic('JWT_EXPIRY',{...signedStringClaims,agentMatched:true,expiryValid:false})],
    [{},'VERIFIED',undefined],
  ] as const)('observes original verifier claims %j only as %s',async(claims,outcome,diagnostic)=>{
    const h=connectionFixture();const result=await protocol(h.service,{jsonrpc:'2.0',id:2,method:'tools/list'},h.jwt(claims));
    expect(result.body).toHaveProperty('result.tools');expect(discoveryLog).toHaveBeenCalledTimes(1);
    expect(discoveryLog).toHaveBeenCalledWith(authEvent('tools/list',outcome,diagnostic));noDomain(h);
    expect(h.mapping).toHaveBeenCalledTimes(outcome==='VERIFIED'?1:0);
  });

  it.each(['inactive','missing','lookup-error'] as const)('does not report VERIFIED for %s mapping',async reason=>{
    const marker='synthetic-private-error-token-https://credential.invalid';const h=connectionFixture();
    if(reason==='lookup-error')h.mapping.mockRejectedValueOnce(new Error(marker));
    else h.mapping.mockResolvedValueOnce(null); // Existing resolver returns null for absent/inactive mappings.
    const result=await protocol(h.service,{jsonrpc:'2.0',id:2,method:'tools/list',params:{cursor:marker}},h.jwt({email:marker}));
    expect(result.body).toHaveProperty('result.tools');noDomain(h);
    expect(discoveryLog.mock.calls).toEqual([[authEvent('tools/list',reason==='lookup-error'?'UNCONFIRMED':'MAPPING_MISSING',
      reason==='lookup-error'?undefined:expectedDiagnostic('SUBJECT_MAPPING',{...signedStringClaims,agentMatched:true,expiryValid:true}))]]);
    expect(JSON.stringify(discoveryLog.mock.calls)).not.toContain(marker);expect(result.wire).not.toContain(marker);
  });

  it('never logs sensitive header/body/claim or error text, including successful observation',async()=>{
    const marker='synthetic-private-signature-marker';const h=connectionFixture();
    await protocol(h.service,{jsonrpc:'2.0',id:2,method:'tools/list',params:{cursor:marker}},marker);
    await protocol(h.service,{jsonrpc:'2.0',id:2,method:'tools/list'},h.jwt({email:marker,employee_no:marker}));
    expect(discoveryLog.mock.calls).toEqual([[authEvent('tools/list','REJECTED',expectedDiagnostic('JWT_FORMAT'))],
      [authEvent('tools/list','VERIFIED')]]);
    const serialized=JSON.stringify(discoveryLog.mock.calls);
    for(const value of [marker,h.state.configuration.mcp.signingSecret,'synthetic-owner','synthetic-mapping','synthetic-open-id'])
      expect(serialized).not.toContain(value);
    noDomain(h);
  });

  it('logs no claims before a real signature comparison rejects the original JWT',async()=>{
    const marker='synthetic-private-subject-token-marker';const h=connectionFixture();
    const token=h.jwt({user_id:marker,tenant_id:marker,email:marker});
    h.state.configuration.mcp.signingSecret='synthetic-other-signing-secret';
    const result=await protocol(h.service,{jsonrpc:'2.0',id:2,method:'tools/list',params:{cursor:marker}},token);
    expect(result.body).toHaveProperty('result.tools');noDomain(h);expect(h.mapping).not.toHaveBeenCalled();
    expect(discoveryLog.mock.calls).toEqual([[authEvent('tools/list','REJECTED',expectedDiagnostic('JWT_SIGNATURE',{signatureVerified:false}))]]);
    for(const value of [marker,token,h.state.configuration.mcp.signingSecret])expect(JSON.stringify(discoveryLog.mock.calls)).not.toContain(value);
  });

  it('never copies forged diagnostic properties or invokes their getters when observing a foreign exception',async()=>{
    const marker='synthetic-private-forged-diagnostic-marker';const h=connectionFixture();
    const cause=new UnauthorizedException('AILY_MCP_JWT_INVALID');const getter=jest.fn(()=>{throw new Error(marker);});
    Object.defineProperty(cause,'identityDiagnostic',{get:getter});
    Object.assign(cause,{diagnostic:{stage:marker,signatureVerified:true,userIdType:marker},token:marker});
    jest.spyOn(h.identity,'verify').mockRejectedValueOnce(cause);
    const result=await protocol(h.service,{jsonrpc:'2.0',id:2,method:'tools/list'});
    expect(result.body).toHaveProperty('result.tools');noDomain(h);expect(getter).not.toHaveBeenCalled();
    expect(discoveryLog.mock.calls).toEqual([[authEvent('tools/list','MISSING_JWT')]]);
    await protocol(h.service,{jsonrpc:'2.0',id:2,method:'tools/list'},'synthetic-header');
    expect(discoveryLog.mock.calls).toEqual([[authEvent('tools/list','MISSING_JWT')],[authEvent('tools/list','REJECTED')]]);
    expect(getter).not.toHaveBeenCalled();noDomain(h);
    expect(JSON.stringify(discoveryLog.mock.calls)).not.toContain(marker);
  });

  it.each([
    {...initialize,id:{}},{...initialize,params:{}},
  ])('leaves invalid discovery protocol/params to SDK rejection: %j',async body=>{
    const h=connectionFixture(false);const verify=jest.spyOn(h.identity,'verify');
    const result=await protocol(h.service,body);
    expect(result.body).toHaveProperty('error.code');expect(result.body).not.toHaveProperty('result');
    expect(verify).not.toHaveBeenCalled();noDomain(h);
  });


  it('rejects numeric tools/list params with the SDK InvalidRequest and exact original id',async()=>{
    const h=connectionFixture(false);const verify=jest.spyOn(h.identity,'verify');
    const response=await protocolWire(h.service,{jsonrpc:'2.0',id:1,method:'tools/list',params:42});
    expect(response.status).toBe(400);
    expect(response.contentType.split(';')[0]).toBe('application/json');
    const result=protocolResponse(response.contentType,response.wire,1);
    expect(result).toEqual({jsonrpc:'2.0',id:1,error:{code:-32600,
      message:'Bad Request: the request body is not a valid JSON-RPC message'}});
    expect(result).not.toHaveProperty('result');
    expect(verify).not.toHaveBeenCalled();noDomain(h);
  });

  it.each([
    [],[initialize],[{jsonrpc:'2.0',id:2,method:'tools/list'},call()],
    {jsonrpc:'2.0',id:1,params:{method:'tools/list'}},
    {jsonrpc:'1.0',id:1,method:'tools/list'},
    {jsonrpc:'2.0',id:1,method:'resources/list',params:{method:'tools/list'}},
  ])('never lets arrays, nested method or non-static methods bypass the HTTP check: %j',async body=>{
    const h=connectionFixture();const verify=jest.spyOn(h.identity,'verify');
    await expect(protocolWire(h.service,body)).rejects.toThrow('AILY_MCP_JWT_INVALID');
    expect(verify).toHaveBeenCalledTimes(1);expect(discoveryLog).not.toHaveBeenCalled();noDomain(h);
  });

  it('does not dispatch an embedded tools/call inside static list parameters',async()=>{
    const h=connectionFixture(false);
    const listed=await protocol(h.service,{jsonrpc:'2.0',id:2,method:'tools/list',params:{method:'tools/call',...call().params}});
    expect(listed.body).toHaveProperty('result.tools');noDomain(h);
    expect(h.mapping).not.toHaveBeenCalled();
  });

  it.each(toolInputs.flatMap(([name,args])=>
    ['no-config','no-jwt','bad-signature','numeric-subject','wrong-agent','expired','no-mapping','namespace'].map(reason=>({name,args,reason}))))(
    'refuses $name before SDK/domain when $reason',async({name,args,reason})=>{
      const h=connectionFixture(reason!=='no-config');let jwt:unknown=h.jwt();
      if(reason==='no-jwt')jwt=undefined;
      if(reason==='bad-signature')jwt='synthetic-private-invalid-jwt';
      if(reason==='numeric-subject')jwt=h.jwt({user_id:123});
      if(reason==='wrong-agent')jwt=h.jwt({agent_id:'agent_other'});
      if(reason==='expired')jwt=h.jwt({exp:0});
      if(reason==='no-mapping')h.mapping.mockResolvedValue(null);
      if(reason==='namespace')h.state.configuration.mcp.subjectNamespace=null;
      const code=reason==='no-config'||reason==='namespace'?'AILY_MCP_IDENTITY_NOT_CONFIGURED':
        reason==='no-mapping'?'AILY_MCP_SUBJECT_MAPPING_REQUIRED':'AILY_MCP_JWT_INVALID';
      await expect(protocol(h.service,call(name,args),jwt)).rejects.toThrow(code);
      expect(discoveryLog).not.toHaveBeenCalled();noDomain(h);
    });

  it.each(toolInputs)('revalidates mapping after HTTP precheck before the actual %s callback',async(name,args)=>{
    const h=connectionFixture();
    h.mapping.mockResolvedValueOnce({id:'synthetic-mapping',revision:1,miaodaUserId:'synthetic-owner',miaodaTenantId:'synthetic-tenant'})
      .mockResolvedValue(null);
    const result=await protocol(h.service,call(name,args),h.jwt());
    expect(result.body).toMatchObject({id:3,result:{isError:true,content:[{type:'text',
      text:JSON.stringify({code:'AILY_MCP_SUBJECT_MAPPING_REQUIRED'})}]}});
    expect(h.mapping).toHaveBeenCalledTimes(2);expect(discoveryLog).not.toHaveBeenCalled();noDomain(h);
  });

  it('freshly verifies both actual callbacks in one authenticated HTTP batch',async()=>{
    const h=connectionFixture();h.domain.sources.mockResolvedValue({syntheticRead:true});
    const result=await protocolWire(h.service,[call(undefined,undefined,31),call(undefined,undefined,32)],h.jwt());
    expect(result.status).toBe(200);expect(result.wire).toContain('"id":31');expect(result.wire).toContain('"id":32');
    expect(h.mapping).toHaveBeenCalledTimes(3);expect(h.domain.sources).toHaveBeenCalledTimes(2);
    const actors=h.domain.sources.mock.calls.map(([actor])=>actor);
    expect(actors[0]).not.toBe(actors[1]);for(const actor of actors)expect(()=>h.identity.assertVerified(actor)).not.toThrow();
    expect(discoveryLog).not.toHaveBeenCalled();
  });

  it('keeps concurrent HTTP requests bound to their own original JWT and new mapped actor',async()=>{
    const h=connectionFixture();h.domain.sources.mockResolvedValue({syntheticRead:true});
    h.mapping.mockImplementation(async input=>({id:`synthetic-${input.feishuOpenId}`,revision:1,
      miaodaUserId:input.feishuOpenId,miaodaTenantId:'synthetic-tenant'}));
    const results=await Promise.all(['synthetic-reader-a','synthetic-reader-b'].map(user_id=>
      protocol(h.service,call(),h.jwt({user_id}))));
    for(const result of results)expect(result.body).toMatchObject({result:{content:[{text:JSON.stringify({syntheticRead:true})}]}});
    expect(h.mapping).toHaveBeenCalledTimes(4);
    const actors=h.domain.sources.mock.calls.map(([actor])=>actor);
    expect(actors.map(actor=>actor.actorUserId).sort()).toEqual(['synthetic-reader-a','synthetic-reader-b']);
    for(const actor of actors)expect(actor.feishuOpenId).toBe(actor.actorUserId);
    expect(actors[0]).not.toBe(actors[1]);expect(discoveryLog).not.toHaveBeenCalled();
  });
});

describe('in-memory MCP protocol response boundary',()=>{
  it.each(['application/json','text/event-stream; charset=utf-8'])('preserves the exact success and error under %s',contentType=>{
    for(const response of [{jsonrpc:'2.0',id:7,result:{complete:true}},{jsonrpc:'2.0',id:7,error:{code:-32600,message:'synthetic error'}}]) {
      const json=JSON.stringify(response);const wire=contentType==='application/json'?json:`: heartbeat\r\n\r\nevent: message\r\ndata: ${json}\r\n\r\n`;
      expect(protocolResponse(contentType,wire,7)).toEqual(response);
    }
  });
  it('consumes full SSE frames and notifications before matching the sole response',()=>{
    const response={jsonrpc:'2.0',id:'original',result:{complete:true}};
    const wire='event: message\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n'+
      'event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":"original","result":{"complete":true}}\n\n';
    expect(protocolResponse('text/event-stream',wire,'original')).toEqual(response);
  });
  it.each(['wrong-id','duplicate','truncated','invalid-jsonrpc','result-and-error','missing-response'])(
    'rejects %s rather than guessing an SSE data record',reason=>{
      const message={jsonrpc:'2.0',id:7,result:{complete:true}};
      let wire=`event: message\ndata: ${JSON.stringify(message)}\n\n`;
      if(reason==='wrong-id')wire=`event: message\ndata: ${JSON.stringify({...message,id:8})}\n\n`;
      if(reason==='duplicate')wire+=wire;
      if(reason==='truncated')wire=wire.trimEnd();
      if(reason==='invalid-jsonrpc')wire=`event: message\ndata: ${JSON.stringify({...message,jsonrpc:'1.0'})}\n\n`;
      if(reason==='result-and-error')wire=`event: message\ndata: ${JSON.stringify({...message,error:{code:1,message:'synthetic'}})}\n\n`;
      if(reason==='missing-response')wire=': heartbeat\n\n';
      expect(()=>protocolResponse('text/event-stream',wire,7)).toThrow();
    });
});
