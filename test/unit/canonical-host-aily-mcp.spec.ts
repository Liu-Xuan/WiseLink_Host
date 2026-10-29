import { McpServer } from '@modelcontextprotocol/server';
import { CanonicalHostAilyMcpService } from '../../server/modules/canonical-host/canonical-host-aily-mcp.service';
import { ailySourceCommand, ailyValidateCommand, ailySaveCommand, ailyReadCommand, ailyStageCommand, ailyFinishCommand } from '../../server/modules/canonical-host/aily-task-domain.types';
import { AilyMcpIdentityService } from '../../server/modules/canonical-host/aily-mcp-identity.service';
import { loadAilyEnterpriseConfiguration } from '../../server/modules/canonical-host/aily-enterprise-configuration';
import { syntheticAilyEnterpriseJson } from '../support/aily-enterprise-configuration.fixture';
import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';

function connectionFixture() {
  const full=syntheticAilyEnterpriseJson();
  const state=loadAilyEnterpriseConfiguration({WL_AILY_ENTERPRISE_CONFIGURATION_JSON:JSON.stringify({
    schemaVersion:full.schemaVersion,enabled:true,host:full.host,mcp:full.mcp,
    task:{enabled:false},background:{enabled:false,allowOriginalRequest:false}}),WL_AILY_MCP_SIGNING_SECRET:'synthetic-only-signature'});
  if(state.status!=='MCP_ONLY')throw new Error('SYNTHETIC_MCP_ONLY_REQUIRED');
  const mapping=jest.fn(async()=>({id:'synthetic-mapping',revision:1,miaodaUserId:'synthetic-owner',miaodaTenantId:'synthetic-tenant'}));
  const identity=new AilyMcpIdentityService({resolveSubjectMapping:mapping} as never,state.configuration.mcp);
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

function protocolResponse(contentType:string,wire:string,expectedId:string|number):Record<string,unknown> {
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

/** Actual Node adapter/protocol, with in-memory Node HTTP surfaces; no listener. */
async function protocol(service:CanonicalHostAilyMcpService,body:{jsonrpc:'2.0';id:string|number;method:string;params?:unknown},jwt:string) {
  let status=0;let responseHeaders:Record<string,string>={};const chunks:Buffer[]=[];
  const request={method:'POST',url:'/openapi/wiselink/aily-mcp',headers:{host:'localhost',
    'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'}};
  const response=Object.assign(new EventEmitter(),{destroyed:false,
    writeHead:(code:number,headers:Record<string,string>)=>{status=code;responseHeaders=headers;},
    write:(bytes:Uint8Array)=>{chunks.push(Buffer.from(bytes));return true;},end:()=>undefined});
  await service.handle(request as unknown as Parameters<CanonicalHostAilyMcpService['handle']>[0],
    response as unknown as Parameters<CanonicalHostAilyMcpService['handle']>[1],body,jwt);
  const contentType=Object.entries(responseHeaders).find(([name])=>name.toLowerCase()==='content-type')?.[1]??'';
  return {status,contentType,body:protocolResponse(contentType,Buffer.concat(chunks).toString('utf8'),body.id)};
}

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
    const actor={actorUserId:'synthetic-owner'};
    const domain={sources:jest.fn(async()=>({read:true})),validate:jest.fn(),save:jest.fn(),read:jest.fn(),stageOverall:jest.fn(),finish:jest.fn()};
    const registered=new Map<string,{call:(input:never)=>Promise<unknown>}>();
    const spy=jest.spyOn(McpServer.prototype,'registerTool').mockImplementation(function(name,_definition,call){
      registered.set(name,{call:call as never});return {remove:jest.fn(),enable:jest.fn(),disable:jest.fn(),update:jest.fn()} as never;
    });
    try {
      const service=new CanonicalHostAilyMcpService({} as never,domain as never);
      (service as unknown as {server(actor:never):McpServer}).server(actor as never);
      expect([...registered.keys()]).toEqual(['read_assessment_sources','validate_assessment_work','save_assessment_work',
        'read_assessment_work','project_assessment_stage_overall','finish_assessment_task']);
      const input=ailySourceCommand.parse(cases[0][1]);
      await registered.get('read_assessment_sources')!.call(input as never);
      expect(domain.sources).toHaveBeenCalledWith(actor,input);
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

  it.each(['NAMESPACE_UNKNOWN','WRONG_AGENT','NO_MAPPING'] as const)('keeps %s rejected in the actual connection handler',async reason=>{
    const h=connectionFixture();
    if(reason==='NAMESPACE_UNKNOWN')h.state.configuration.mcp.subjectNamespace=null;
    if(reason==='NO_MAPPING')h.mapping.mockResolvedValueOnce(null as never);
    await expect(protocol(h.service,{jsonrpc:'2.0',id:1,method:'tools/list',params:{}},
      h.jwt(reason==='WRONG_AGENT'?{agent_id:'agent_other'}:{}))).rejects.toThrow(reason==='NAMESPACE_UNKNOWN'
      ?'AILY_MCP_IDENTITY_NOT_CONFIGURED':reason==='NO_MAPPING'?'AILY_MCP_SUBJECT_MAPPING_REQUIRED':'AILY_MCP_JWT_INVALID');
    for(const method of Object.values(h.domain))expect(method).not.toHaveBeenCalled();
    if(reason!=='NO_MAPPING')expect(h.mapping).not.toHaveBeenCalled();
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
