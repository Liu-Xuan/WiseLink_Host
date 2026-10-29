import { z } from 'zod/v4';
import type {
  CanonicalProgramAssessmentExecutionMode,
  CanonicalExecutionModelSelection,
  CanonicalProgramAgentPolicy,
} from '@shared/api.interface';

export interface ProgramAssessmentAdmission {
  modelRef: string;
  executionMode?: CanonicalProgramAssessmentExecutionMode;
  agentPolicy?: CanonicalProgramAgentPolicy;
}

export const programAgentPolicySchema = z.strictObject({
  schemaVersion: z.literal('wiselink.program-agent-policy.v1'),
  maxModelRequests: z.null(),
  maxOutputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxToolCalls: z.null(),
  timeoutSeconds: z.literal(3600),
});

export function isProgramAssessmentMode(value: unknown): value is CanonicalProgramAssessmentExecutionMode {
  return value === 'PROGRAM_CONTROLLED_V1' || value === 'PROGRAM_AGENT_V1';
}

export function readProgramAgentPolicy(value: unknown): CanonicalProgramAgentPolicy {
  const parsed = programAgentPolicySchema.safeParse(value);
  if (!parsed.success) throw new Error('JOBAID_PROGRAM_AGENT_POLICY_INVALID');
  return parsed.data;
}

export function assertProgramAgentPolicyModel(
  value: unknown,
  selection: CanonicalExecutionModelSelection | null | undefined,
): CanonicalProgramAgentPolicy {
  const policy = readProgramAgentPolicy(value);
  if (!selection || selection.modelRef !== 'miaoda/glm-5.3' || !('schemaVersion' in selection) ||
      selection.schemaVersion !== 'wiselink.3_1.execution_model_selection.v2' ||
      !Number.isSafeInteger(selection.maxOutputTokens) || selection.maxOutputTokens < 1 ||
      policy.maxOutputTokens !== selection.maxOutputTokens)
    throw new Error('JOBAID_PROGRAM_AGENT_MODEL_BINDING_INVALID');
  return policy;
}

export function buildProgramAgentPolicy(
  selection: CanonicalExecutionModelSelection,
): CanonicalProgramAgentPolicy {
  return assertProgramAgentPolicyModel({
    schemaVersion: 'wiselink.program-agent-policy.v1',
    maxModelRequests: null,
    maxOutputTokens: 'maxOutputTokens' in selection ? selection.maxOutputTokens : null,
    maxToolCalls: null,
    timeoutSeconds: 3600,
  }, selection);
}
