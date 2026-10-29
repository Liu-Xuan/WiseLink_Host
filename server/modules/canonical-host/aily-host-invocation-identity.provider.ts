import { Inject, Injectable } from '@nestjs/common';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { FeishuApplicationToken } from '../document-management/src/hosted/nest/feishu-application-token';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { AilyTaskAdmissionService } from './aily-task-admission';
import { AILY_ENTERPRISE_CONFIGURATION, type AilyEnterpriseConfigurationState } from './aily-enterprise-configuration';
import type { AilyHostInvocationIdentity, AilyHostInvocationIdentityPort, AilyHostInvocationRequest } from './aily-host-invocation-identity.port';

@Injectable()
export class AilyHostInvocationIdentityProvider implements AilyHostInvocationIdentityPort {
  private readonly token = new FeishuApplicationToken((url, init) =>
    this.request(url, {...init, signal: AbortSignal.timeout(15_000)}));

  constructor(
    @Inject(AILY_ENTERPRISE_CONFIGURATION) private readonly state: AilyEnterpriseConfigurationState,
    private readonly admission: AilyTaskAdmissionService,
    private readonly actors: EngineeringMatterWorkingRepository,
    private readonly workItems: MiaodaWorkItemRepository,
  ) {}

  /** Overrideable HTTP boundary in isolated tests; production uses the official helper. */
  protected request(url: URL, init: RequestInit): Promise<Response> { return fetch(url, init); }

  async resolve(request: AilyHostInvocationRequest): Promise<AilyHostInvocationIdentity> {
    if (this.state.status !== 'READY') return {status: 'UNAVAILABLE', reason: this.state.reason,
      ...(this.state.status === 'UNAVAILABLE' || request.purpose === 'BACKGROUND' ? {transport: 'APPLICATION' as const} : {})};
    const config = this.state.configuration;
    if (request.purpose === 'BROWSER' && config.caller.browserTransport === 'USER_GRANT')
      return {status: 'UNAVAILABLE', reason: 'AILY_INVOCATION_IDENTITY_UNAVAILABLE'};
    const unavailable = (reason: Extract<AilyHostInvocationIdentity, {status: 'UNAVAILABLE'}>['reason']): AilyHostInvocationIdentity =>
      ({status: 'UNAVAILABLE', reason, transport: 'APPLICATION'});
    if (request.purpose === 'BACKGROUND' && !config.background.enabled)
      return unavailable('AILY_BACKGROUND_IDENTITY_NOT_CONFIGURED');
    if (request.tenantId !== config.task.tenantId || request.tenantId !== config.caller.tenantId ||
        request.workItemId !== config.task.workItemId ||
        request.agentId !== config.task.agentId || request.principalId !== config.task.principalId ||
        process.env.FEISHU_OAUTH_CLIENT_ID?.trim() !== config.caller.appId ||
        !process.env.FEISHU_OAUTH_CLIENT_SECRET?.trim())
      return unavailable('AILY_APPLICATION_CALLER_NOT_CONFIGURED');
    try {
      await this.actors.withActorScope(request.actorUserId, async () => {
        const current = await this.workItems.loadAutoProcessingProjection(request.workItemId, request.tenantId);
        if (!current?.projection || current.row.requestedByUserId !== request.actorUserId ||
            current.row.revision !== current.projection.revision)
          throw new Error('AILY_INVOCATION_WORK_ITEM_BINDING_CHANGED');
        const task = this.admission.requireScope(request.tenantId, current.projection);
        if (task.agentId !== request.agentId || task.principalId !== request.principalId ||
            task.intakeRequestId !== config.task.intakeRequestId)
          throw new Error('AILY_INVOCATION_WORK_ITEM_BINDING_CHANGED');
      });
      if (process.env.FEISHU_OAUTH_CLIENT_ID?.trim() !== config.caller.appId)
        return unavailable('AILY_APPLICATION_CALLER_NOT_CONFIGURED');
      const accessToken = await this.token.get({appId: config.caller.appId,
        appSecret: process.env.FEISHU_OAUTH_CLIENT_SECRET ?? ''});
      return {status: 'READY', accessToken, identityRef: config.caller.identityRef, callerAppId: config.caller.appId, transport: 'APPLICATION',
        tenantId: request.tenantId, actorUserId: request.actorUserId, workItemId: request.workItemId,
        principalId: request.principalId, agentId: request.agentId};
    } catch {
      // Provider/SQL/HTTP causes can contain private material. Expose only this code.
      return unavailable('AILY_APPLICATION_IDENTITY_UNAVAILABLE');
    }
  }
}
