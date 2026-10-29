import { createHmac } from 'node:crypto';
import { AilyMcpIdentityService, type AilyMcpConfiguration } from '../../server/modules/canonical-host/aily-mcp-identity.service';

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
