import { ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import type { CanonicalAilyTaskAdmission, CanonicalExecutionModelSelection, CanonicalWorkItemProjection } from '@shared/api.interface';

export const AILY_TASK_CONFIGURATION = Symbol('AILY_TASK_CONFIGURATION');
export const AILY_TASK_MODE = 'AILY_AGENT_V1' as const;
export type AilyTaskModelRef = 'aily/glm-5.3' | 'aily/deepseek-v4-pro';

/** Supplied only after the exact profile/channel/tool binding is approved.
 * B registers null. Test fixtures are explicitly synthetic, not platform proof.
 */
export interface AilyTaskConfiguration {
  enabled: boolean;
  tenantId: string;
  workItemId: string;
  intakeRequestId: string;
  agentId: string;
  principalId: string;
  authorizationFingerprint: string;
  publicationRef: string;
  configurationSource: string;
  apiAccessVerified: boolean;
  trustedToolsVerified: boolean;
  modelOptions: Array<{modelRef: AilyTaskModelRef; platformBuiltIn: true}>;
}

export interface AilyTaskSelection {
  configuration: AilyTaskConfiguration;
  model: CanonicalExecutionModelSelection;
}

export interface AilyAssessmentAdmission extends AilyTaskSelection {
  executionMode: 'AILY_AGENT_V1';
  modelRef: string;
  actorUserId: string;
  agentPolicy?: never;
}

@Injectable()
export class AilyTaskAdmissionService {
  constructor(@Optional() @Inject(AILY_TASK_CONFIGURATION) private readonly config: AilyTaskConfiguration | null = null) {}

  matches(tenantId: string, workItem: CanonicalWorkItemProjection): boolean {
    return this.config?.enabled === true && this.config.tenantId === tenantId &&
      this.config.workItemId === workItem.workItemId && this.config.intakeRequestId === workItem.requestId;
  }

  project(tenantId: string, workItem: CanonicalWorkItemProjection): CanonicalAilyTaskAdmission | undefined {
    if (!this.matches(tenantId, workItem)) return undefined;
    try {
      const selected = this.require(tenantId, workItem);
      return {executionMode: AILY_TASK_MODE, modelRef: selected.model.modelRef, modelName: selected.model.displayName, available: true};
    } catch {
      return {executionMode: AILY_TASK_MODE, modelRef: '', modelName: '', available: false,
        reason: 'INITIAL_CONTINUATION_AILY_NOT_CONFIGURED'};
    }
  }

  require(tenantId: string, workItem: CanonicalWorkItemProjection, requestedModelRef?: string): AilyTaskSelection {
    const config = this.requireScope(tenantId, workItem);
    const option = config.modelOptions.find(item => item.modelRef === 'aily/glm-5.3' && item.platformBuiltIn === true) ??
      config.modelOptions.find(item => item.modelRef === 'aily/deepseek-v4-pro' && item.platformBuiltIn === true);
    if (!option || (requestedModelRef !== undefined && requestedModelRef !== option.modelRef))
      throw new ConflictException('INITIAL_CONTINUATION_AILY_MODEL_UNAVAILABLE');
    return {configuration: config, model: {
      modelRef: option.modelRef, displayName: option.modelRef === 'aily/glm-5.3' ? 'GLM-5.3' : 'DeepSeek V4 Pro',
      providerKind: 'BUILT_IN', settingsRevision: 0, selectedAt: new Date().toISOString(),
    }};
  }

  /** Original-run reads authorize the target, never select a model again. */
  requireScope(tenantId: string, workItem: CanonicalWorkItemProjection): AilyTaskConfiguration {
    const config=this.requireConfiguredScope();
    if(!this.matches(tenantId,workItem))throw new ConflictException('INITIAL_CONTINUATION_AILY_NOT_CONFIGURED');
    return config;
  }

  /** Trusted service admission, before resolving an actor or reading any task. */
  requireConfiguredScope(binding?:{tenantId:string;principalId:string;agentId:string}):AilyTaskConfiguration {
    const config = this.config;
    if (!config?.enabled || (binding && (binding.tenantId!==config.tenantId || binding.principalId!==config.principalId ||
        binding.agentId!==config.agentId)) || !config.tenantId.trim() || !config.workItemId.trim() || !config.intakeRequestId.trim() ||
        !/^agent_[A-Za-z0-9_-]{1,59}$/u.test(config.agentId) ||
        !/^service:[A-Za-z0-9:_-]{1,140}$/u.test(config.principalId) ||
        config.principalId === 'service:openclaw-main' || config.principalId === process.env.WL_CODEX_SERVICE_PRINCIPAL_ID ||
        config.principalId === process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID || !config.authorizationFingerprint.trim() ||
        !config.publicationRef.trim() || !config.configurationSource.trim() ||
        !config.apiAccessVerified || !config.trustedToolsVerified)
      throw new ConflictException('INITIAL_CONTINUATION_AILY_NOT_CONFIGURED');
    return config;
  }
}
