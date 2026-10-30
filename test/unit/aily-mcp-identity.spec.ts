import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { AilyMcpIdentityService, readAilyMcpIdentityDiagnostic, type AilyMcpConfiguration, type AilyMcpIdentityDiagnostic } from '../../server/modules/canonical-host/aily-mcp-identity.service';

const config:AilyMcpConfiguration = {enabled:true,agentId:'agent_synthetic',expectedClientId:'synthetic-host',
  signingSecret:'synthetic-signature-only',subjectNamespace:'FEISHU_OPEN_ID',tenantNamespace:'FEISHU_TENANT_KEY'};
function jwt(claims:Record<string,unknown>={},algorithm='HS256',secret=config.signingSecret) {
  const head = Buffer.from(JSON.stringify({alg:algorithm})).toString('base64url');
  const body = Buffer.from(JSON.stringify({agent_id:config.agentId,user_id:'synthetic-open-id',tenant_id:'synthetic-tenant-key',
    exp:4102444800,...claims})).toString('base64url');
  return `${head}.${body}.${createHmac('sha256',secret).update(`${head}.${body}`).digest('base64url')}`;
}
function fixture(configuration:AilyMcpConfiguration|null=config) {
  const resolveSubjectMapping=jest.fn(async()=>({id:'synthetic-mapping',revision:7,miaodaUserId:'owner',miaodaTenantId:'tenant'}));
  const service=new AilyMcpIdentityService({resolveSubjectMapping} as never,configuration);
  return {service,resolveSubjectMapping};
}

describe('Aily official JWT and existing read-only subject mapping',()=>{
  it('maps a verified synthetic string namespace without bootstrap or credential exposure',async()=>{
    const h=fixture();const actor=await h.service.verify(jwt());
    expect(actor).toMatchObject({agentId:config.agentId,actorUserId:'owner',tenantId:'tenant',mappingRevision:7,platformToolCallId:null});
    expect(h.resolveSubjectMapping).toHaveBeenCalledWith({feishuOpenId:'synthetic-open-id',feishuTenantKey:'synthetic-tenant-key',expectedClientId:'synthetic-host'});
    expect(()=>h.service.assertVerified(actor)).not.toThrow();
    expect(()=>h.service.assertVerified({...actor})).toThrow('AILY_MCP_IDENTITY_REQUIRED');
    expect(JSON.stringify(actor)).not.toContain(config.signingSecret);
  });
  it.each([null,{...config,enabled:false},{...config,subjectNamespace:null},{...config,tenantNamespace:null}])(
    'fails closed before mapping when actual payload namespaces are not configured',async value=>{
      const h=fixture(value);await expect(h.service.verify(jwt())).rejects.toThrow('AILY_MCP_IDENTITY_NOT_CONFIGURED');
      expect(h.resolveSubjectMapping).not.toHaveBeenCalled();
    });
  it.each([{user_id:123},{tenant_id:123},{user_id:null},{exp:0},{exp:'4102444800'},{agent_id:'agent_other'}])(
    'never coerces or substitutes an unverified payload field: %j',async claims=>{
      const h=fixture();await expect(h.service.verify(jwt(claims))).rejects.toThrow('AILY_MCP_JWT_INVALID');
      expect(h.resolveSubjectMapping).not.toHaveBeenCalled();
    });
  it.each([jwt({},'none'),jwt({},'RS256'),jwt({},'HS256','wrong-synthetic-key'),'not.jwt','..'])(
    'rejects malformed or incorrectly signed JWT without identity reads',async token=>{
      const h=fixture();await expect(h.service.verify(token)).rejects.toThrow('AILY_MCP_JWT_INVALID');
      expect(h.resolveSubjectMapping).not.toHaveBeenCalled();
    });
  it('requires an existing mapping and rechecks actor expiry',async()=>{
    const h=fixture();h.resolveSubjectMapping.mockResolvedValueOnce(null as never);
    await expect(h.service.verify(jwt())).rejects.toThrow('AILY_MCP_SUBJECT_MAPPING_REQUIRED');
    const actor=await h.service.verify(jwt());jest.spyOn(Date,'now').mockReturnValue(actor.expiresAt);
    try {expect(()=>h.service.assertVerified(actor)).toThrow('AILY_MCP_IDENTITY_REQUIRED');} finally {jest.restoreAllMocks();}
  });
});


const cryptoModule=jest.requireActual<typeof import('node:crypto')>('node:crypto');
afterEach(()=>{jest.restoreAllMocks();});
async function rejected(promise:Promise<unknown>):Promise<UnauthorizedException> {
  try {await promise;throw new Error('SYNTHETIC_REJECTION_REQUIRED');}
  catch(cause) {
    expect(cause).toBeInstanceOf(UnauthorizedException);
    if(!(cause instanceof UnauthorizedException))throw cause;
    return cause;
  }
}
function signedPayload(value:unknown) {
  const header=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256',config.signingSecret).update(`${header}.${payload}`).digest('base64url')}`;
}
function expectedDiagnostic(stage:AilyMcpIdentityDiagnostic['stage'],fields:Partial<Omit<AilyMcpIdentityDiagnostic,'stage'>>={}):AilyMcpIdentityDiagnostic {
  return {stage,signatureVerified:null,userIdType:null,tenantIdType:null,agentMatched:null,expiryValid:null,...fields};
}
const signedStringClaims={signatureVerified:true,userIdType:'STRING' as const,tenantIdType:'STRING' as const};

describe('trusted fixed diagnostics on the original verification path',()=>{
  const shortSignature=jwt().split('.').slice(0,2).join('.')+'.YQ';
  const malformedJson=Buffer.from('{').toString('base64url')+'.'+Buffer.from('{}').toString('base64url')+'.YQ';
  it.each([
    {name:'configuration',header:jwt(),configuration:null,code:'AILY_MCP_IDENTITY_NOT_CONFIGURED',comparisons:0,
      diagnostic:expectedDiagnostic('CONFIGURATION')},
    {name:'format',header:'synthetic-private-invalid-token',configuration:config,code:'AILY_MCP_JWT_INVALID',comparisons:0,
      diagnostic:expectedDiagnostic('JWT_FORMAT')},
    {name:'JSON before signature',header:malformedJson,configuration:config,code:'AILY_MCP_JWT_INVALID',comparisons:0,
      diagnostic:expectedDiagnostic('JWT_JSON')},
    {name:'algorithm before signature',header:jwt({},'none'),configuration:config,code:'AILY_MCP_JWT_INVALID',comparisons:0,
      diagnostic:expectedDiagnostic('JWT_ALGORITHM')},
    {name:'signature comparison not executed',header:shortSignature,configuration:config,code:'AILY_MCP_JWT_INVALID',comparisons:0,
      diagnostic:expectedDiagnostic('JWT_SIGNATURE')},
    {name:'actual signature mismatch',header:jwt({user_id:'synthetic-private-subject'},'HS256','synthetic-wrong-secret'),
      configuration:config,code:'AILY_MCP_JWT_INVALID',comparisons:1,
      diagnostic:expectedDiagnostic('JWT_SIGNATURE',{signatureVerified:false})},
    {name:'signed non-object payload',header:signedPayload(null),configuration:config,code:'AILY_MCP_JWT_INVALID',comparisons:1,
      diagnostic:expectedDiagnostic('JWT_PAYLOAD',{signatureVerified:true})},
    {name:'signed wrong agent',header:jwt({agent_id:'agent_other'}),configuration:config,code:'AILY_MCP_JWT_INVALID',comparisons:1,
      diagnostic:expectedDiagnostic('JWT_AGENT',{signatureVerified:true,agentMatched:false})},
    {name:'signed numeric subject',header:jwt({user_id:123}),configuration:config,code:'AILY_MCP_JWT_INVALID',comparisons:1,
      diagnostic:expectedDiagnostic('JWT_SUBJECT',{signatureVerified:true,userIdType:'NUMBER',agentMatched:true})},
    {name:'signed numeric tenant',header:jwt({tenant_id:123}),configuration:config,code:'AILY_MCP_JWT_INVALID',comparisons:1,
      diagnostic:expectedDiagnostic('JWT_SUBJECT',{...signedStringClaims,tenantIdType:'NUMBER',agentMatched:true})},
    {name:'signed expired claims',header:jwt({exp:0}),configuration:config,code:'AILY_MCP_JWT_INVALID',comparisons:1,
      diagnostic:expectedDiagnostic('JWT_EXPIRY',{...signedStringClaims,agentMatched:true,expiryValid:false})},
  ])('keeps the original public 401 and exact comparison stage for $name',async test=>{
    const comparison=jest.spyOn(cryptoModule,'timingSafeEqual');const h=fixture(test.configuration);
    const error=await rejected(h.service.verify(test.header));
    expect(comparison).toHaveBeenCalledTimes(test.comparisons);
    expect(readAilyMcpIdentityDiagnostic(error)).toEqual(test.diagnostic);
    const original=new UnauthorizedException(test.code);
    expect(error.message).toBe(original.message);expect(error.name).toBe(original.name);
    expect(error.getStatus()).toBe(original.getStatus());expect(error.getResponse()).toEqual(original.getResponse());
    expect(JSON.parse(JSON.stringify(error))).toEqual(JSON.parse(JSON.stringify(original)));
    expect(h.resolveSubjectMapping).not.toHaveBeenCalled();
    const serialized=JSON.stringify(readAilyMcpIdentityDiagnostic(error));
    for(const value of [test.header,config.signingSecret,'synthetic-private-subject','agent_other'])
      expect(serialized).not.toContain(value);
  });

  it('records only signed string types and checked booleans when the existing mapping is absent',async()=>{
    const comparison=jest.spyOn(cryptoModule,'timingSafeEqual');const h=fixture();
    h.resolveSubjectMapping.mockResolvedValueOnce(null as never);
    const error=await rejected(h.service.verify(jwt()));const original=new UnauthorizedException('AILY_MCP_SUBJECT_MAPPING_REQUIRED');
    expect(comparison).toHaveBeenCalledTimes(1);expect(h.resolveSubjectMapping).toHaveBeenCalledTimes(1);
    expect(error.getResponse()).toEqual(original.getResponse());expect(error.getStatus()).toBe(401);
    const diagnostic=readAilyMcpIdentityDiagnostic(error);
    expect(diagnostic).toEqual(expectedDiagnostic('SUBJECT_MAPPING',{...signedStringClaims,agentMatched:true,expiryValid:true}));
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Reflect.set(diagnostic!,'stage','SYNTHETIC_FORGED_STAGE')).toBe(false);
  });

  it('keeps successful mapping and the opaque verified actor unchanged after the real signature comparison',async()=>{
    const comparison=jest.spyOn(cryptoModule,'timingSafeEqual');const h=fixture();
    const actor=await h.service.verify(jwt());expect(comparison).toHaveBeenCalledTimes(1);
    expect(()=>h.service.assertVerified(actor)).not.toThrow();
    expect(readAilyMcpIdentityDiagnostic(actor)).toBeNull();
    expect(Object.keys(actor).sort()).toEqual(['agentId','actorUserId','tenantId','mappingId','mappingRevision',
      'expiresAt','feishuOpenId','feishuTenantKey','expectedClientId','platformToolCallId'].sort());
  });

  it('does not trust copied diagnostics, exception properties or objects sharing a rejection prototype',async()=>{
    const error=await rejected(fixture().service.verify('synthetic-private-token'));
    const diagnostic=readAilyMcpIdentityDiagnostic(error);
    Object.assign(error,{identityDiagnostic:{stage:'synthetic-secret'},signatureVerified:true});
    expect(readAilyMcpIdentityDiagnostic(error)).toBe(diagnostic);
    for(const forged of [new UnauthorizedException(error.message),Object.create(Object.getPrototypeOf(error)),
      {identityDiagnostic:diagnostic},null,'synthetic-secret'])expect(readAilyMcpIdentityDiagnostic(forged)).toBeNull();
  });
});
