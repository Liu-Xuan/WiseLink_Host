import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { AilyHostInvocationIdentityProvider } from '../../server/modules/canonical-host/aily-host-invocation-identity.provider';
import { AilyTaskAdmissionService } from '../../server/modules/canonical-host/aily-task-admission';
import type { AilyHostInvocationRequest } from '../../server/modules/canonical-host/aily-host-invocation-identity.port';
import { createAilyChat, serializeAilyChatRequest } from '../../server/modules/canonical-host/aily-chat-client';
import { syntheticAilyEnterpriseConfiguration } from '../support/aily-enterprise-configuration.fixture';

function fixture() {
  const state = syntheticAilyEnterpriseConfiguration();
  const projection = {workItemId: 'WI-test', requestId: 'original-intake', revision: 4} as CanonicalWorkItemProjection;
  const workItems = {loadAutoProcessingProjection: jest.fn(async () => ({row: {requestedByUserId: 'owner-test', revision: 4}, projection}))};
  const actors = {withActorScope: jest.fn(async (_actor: string, operation: () => Promise<unknown>) => operation())};
  const service = new AilyHostInvocationIdentityProvider(state, new AilyTaskAdmissionService(state.configuration.task), actors as never, workItems as never);
  const request: AilyHostInvocationRequest = {purpose: 'BACKGROUND', tenantId: 'tenant-test', actorUserId: 'owner-test',
    workItemId: 'WI-test', principalId: 'service:aily-synthetic', agentId: 'agent_synthetic'};
  return {state, service, request, workItems, actors};
}

describe('formal Aily application identity consumer', () => {
  const environment = {...process.env};
  beforeEach(() => {process.env.FEISHU_OAUTH_CLIENT_ID = 'cli_synthetic'; process.env.FEISHU_OAUTH_CLIENT_SECRET = 'synthetic-app-secret';});
  afterEach(() => {process.env = {...environment}; jest.restoreAllMocks();});

  it('uses H helper, cached TAT and actual chats adapter without putting the credential in the message', async () => {
    const h = fixture();
    const http = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).endsWith('/tenant_access_token/internal')) {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(JSON.parse(String(init?.body))).toEqual({app_id: 'cli_synthetic', app_secret: process.env.FEISHU_OAUTH_CLIENT_SECRET});
        return Response.json({code: 0, tenant_access_token: 'synthetic-only-tat', expire: 7200});
      }
      expect(String(url)).toBe('https://open.feishu.cn/open-apis/aily/v1/agents/agent_synthetic/chats');
      expect(init?.headers).toMatchObject({authorization: 'Bearer synthetic-only-tat'});
      expect(String(init?.body)).not.toMatch(/synthetic-only-tat|synthetic-app-secret/u);
      return Response.json({code: 0, data: {agent_chat_id: '123', session_id: 'original-remote'}});
    });
    const identity = await h.service.resolve(h.request);
    if (identity.status !== 'READY') throw new Error('SYNTHETIC_PROVIDER_NOT_READY');
    const message = 'Synthetic task with an exact taskContextRef';
    expect(await createAilyChat({agentId: h.request.agentId, accessToken: identity.accessToken, message,
      expectedRequestBody: serializeAilyChatRequest({message})})).toEqual({chatId: '123', remoteSessionId: 'original-remote'});
    await h.service.resolve(h.request);
    expect(http).toHaveBeenCalledTimes(2);
    process.env.FEISHU_OAUTH_CLIENT_SECRET = 'synthetic-rotated-secret';
    await h.service.resolve(h.request);
    expect(http).toHaveBeenCalledTimes(3);
    expect(h.actors.withActorScope).toHaveBeenCalledWith('owner-test', expect.any(Function));
  });

  it.each(['secret', 'app', 'tenant', 'agent', 'principal', 'intake', 'owner', 'role'])('refuses %s mismatch before any transport call', async reason => {
    const h = fixture();
    if (reason === 'secret') delete process.env.FEISHU_OAUTH_CLIENT_SECRET;
    if (reason === 'app') process.env.FEISHU_OAUTH_CLIENT_ID = 'cli_wrong';
    if (reason === 'tenant') h.request.tenantId = 'other';
    if (reason === 'agent') h.request.agentId = 'agent_other';
    if (reason === 'principal') h.request.principalId = 'service:other';
    if (reason === 'intake') h.workItems.loadAutoProcessingProjection.mockResolvedValue({row: {requestedByUserId: 'owner-test', revision: 4},
      projection: {...(await h.workItems.loadAutoProcessingProjection()).projection, requestId: 'other-intake'}});
    if (reason === 'owner') h.request.actorUserId = 'other';
    if (reason === 'role') h.actors.withActorScope.mockRejectedValue(new Error('ACTUAL_SERVICE_ROLE_REQUIRED'));
    const http = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('TRANSPORT_MUST_NOT_RUN'));
    expect(await h.service.resolve(h.request)).toMatchObject({status: 'UNAVAILABLE', transport: 'APPLICATION'});
    expect(http).not.toHaveBeenCalled();
  });

  it('sanitizes transport failures and never falls back after application selection', async () => {
    const h = fixture();
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('synthetic-app-secret synthetic-token URL private-cause'));
    const result = await h.service.resolve({...h.request, purpose: 'BROWSER'});
    expect(result).toEqual({status: 'UNAVAILABLE', transport: 'APPLICATION', reason: 'AILY_APPLICATION_IDENTITY_UNAVAILABLE'});
    expect(JSON.stringify(result)).not.toMatch(/synthetic-app-secret|synthetic-token|private-cause/u);
  });
});
