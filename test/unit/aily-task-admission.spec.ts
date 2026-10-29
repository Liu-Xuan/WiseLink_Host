import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { AilyTaskAdmissionService, type AilyTaskConfiguration } from '../../server/modules/canonical-host/aily-task-admission';
import { isProgramAssessmentMode } from '../../server/modules/canonical-host/program-agent-policy';

const workItem = {workItemId: 'WI-test', requestId: 'original-intake'} as CanonicalWorkItemProjection;
function configuration(): AilyTaskConfiguration {
  // Synthetic trusted configuration, not evidence of any platform profile.
  return {enabled: true, tenantId: 'tenant-test', workItemId: workItem.workItemId, intakeRequestId: workItem.requestId,
    agentId: 'agent_synthetic', principalId: 'service:aily-synthetic', authorizationFingerprint: 'synthetic-scope',
    publicationRef: 'synthetic-publication', configurationSource: 'synthetic-approved-fixture',
    apiAccessVerified: true, trustedToolsVerified: true,
    modelOptions: [{modelRef: 'aily/deepseek-v4-pro', platformBuiltIn: true}]};
}

describe('exact Aily task admission', () => {
  it('is disabled by default without changing old program admission', () => {
    const admission = new AilyTaskAdmissionService();
    expect(admission.project('tenant-test', workItem)).toBeUndefined();
    expect(() => admission.require('tenant-test', workItem)).toThrow('INITIAL_CONTINUATION_AILY_NOT_CONFIGURED');
    expect(isProgramAssessmentMode('AILY_AGENT_V1')).toBe(false);
    expect(isProgramAssessmentMode('PROGRAM_AGENT_V1')).toBe(true);
  });

  it.each(['tenant', 'workItem', 'intake'])('requires the exact %s binding', changed => {
    const admission = new AilyTaskAdmissionService(configuration());
    const target = {...workItem, ...(changed === 'workItem' ? {workItemId: 'other'} : {}),
      ...(changed === 'intake' ? {requestId: 'other'} : {})};
    expect(admission.project(changed === 'tenant' ? 'other' : 'tenant-test', target)).toBeUndefined();
    expect(() => admission.require(changed === 'tenant' ? 'other' : 'tenant-test', target)).toThrow();
  });

  it('selects GLM-5.3 when available and otherwise the approved DeepSeek option, without a backup route', () => {
    const config = configuration(); const admission = new AilyTaskAdmissionService(config);
    expect(admission.require('tenant-test', workItem).model).toMatchObject({modelRef: 'aily/deepseek-v4-pro',
      displayName: 'DeepSeek V4 Pro', providerKind: 'BUILT_IN', settingsRevision: 0});
    config.modelOptions.push({modelRef: 'aily/glm-5.3', platformBuiltIn: true});
    expect(admission.require('tenant-test', workItem).model.modelRef).toBe('aily/glm-5.3');
    expect(() => admission.require('tenant-test', workItem, 'aily/deepseek-v4-pro')).toThrow('INITIAL_CONTINUATION_AILY_MODEL_UNAVAILABLE');
    expect(admission.require('tenant-test', workItem)).not.toHaveProperty('backup');
    expect(admission.requireScope('tenant-test', workItem)).toBe(config);
  });

  it.each(['apiAccessVerified', 'trustedToolsVerified'] as const)('fails closed for missing %s without a legacy fallback', key => {
    const config = configuration(); config[key] = false;
    const admission = new AilyTaskAdmissionService(config);
    expect(admission.project('tenant-test', workItem)).toMatchObject({executionMode: 'AILY_AGENT_V1', available: false});
    expect(() => admission.require('tenant-test', workItem)).toThrow('INITIAL_CONTINUATION_AILY_NOT_CONFIGURED');
  });

  it('requires a distinct trusted service principal rather than adopting the legacy owner', () => {
    const config = configuration(); config.principalId = 'service:openclaw-main';
    expect(() => new AilyTaskAdmissionService(config).require('tenant-test', workItem)).toThrow('INITIAL_CONTINUATION_AILY_NOT_CONFIGURED');
  });
});
