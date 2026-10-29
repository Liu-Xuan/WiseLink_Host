import { z } from 'zod/v4';
import type { AilyTaskConfiguration } from './aily-task-admission';
import type { AilyMcpConfiguration } from './aily-mcp-identity.service';

export const AILY_ENTERPRISE_CONFIGURATION = Symbol('AILY_ENTERPRISE_CONFIGURATION');

const text = z.string().min(1).max(255).refine(value => value === value.trim());
const agentId = z.string().regex(/^agent_[A-Za-z0-9_-]{1,59}$/u);
const callerAppId = z.string().max(255).regex(/^cli_[A-Za-z0-9_-]+$/u);
const hostSchema = z.strictObject({appId: z.literal('app_17bzc551rsg'), environment: z.enum(['development', 'online'])});
const mcpSchema = z.strictObject({
  enabled: z.literal(true), agentId, expectedClientId: callerAppId,
  subjectNamespace: z.literal('FEISHU_OPEN_ID'), tenantNamespace: z.literal('FEISHU_TENANT_KEY'),
});
const taskSchema = z.strictObject({
  enabled: z.literal(true), tenantId: text, workItemId: text, intakeRequestId: text,
  agentId,
  principalId: z.string().regex(/^service:[A-Za-z0-9:_-]{1,140}$/u),
  authorizationFingerprint: text, publicationRef: text, configurationSource: text,
  apiAccessVerified: z.literal(true), trustedToolsVerified: z.literal(true),
  modelOptions: z.array(z.strictObject({
    modelRef: z.enum(['aily/glm-5.3', 'aily/deepseek-v4-pro']), platformBuiltIn: z.literal(true),
  })).min(1).max(2),
}) satisfies z.ZodType<AilyTaskConfiguration>;

const configurationSchema = z.strictObject({
  schemaVersion: z.literal('wiselink.aily-enterprise-configuration.v1'), enabled: z.literal(true),
  host: hostSchema,
  task: taskSchema,
  caller: z.strictObject({
    appId: callerAppId, tenantId: text,
    identityRef: text, configurationSource: text,
    sameHostApplicationVerified: z.literal(true), targetAccessVerified: z.literal(true),
    browserTransport: z.enum(['USER_GRANT', 'APPLICATION']),
  }),
  mcp: mcpSchema,
  background: z.strictObject({enabled: z.boolean(), allowOriginalRequest: z.boolean()}),
}).superRefine((value, context) => {
  if (value.caller.tenantId !== value.task.tenantId || value.mcp.agentId !== value.task.agentId ||
      value.mcp.expectedClientId !== value.caller.appId ||
      new Set(value.task.modelOptions.map(option => option.modelRef)).size !== value.task.modelOptions.length)
    context.addIssue({code: 'custom', message: 'Exact enterprise bindings required'});
});

// Explicit connection setup only. It cannot inherit a rejected task/caller
// block, and unknown identity namespaces still fail in the original verifier.
const mcpOnlySchema = z.strictObject({
  schemaVersion: z.literal('wiselink.aily-enterprise-configuration.v1'), enabled: z.literal(true),
  host: hostSchema, task: z.strictObject({enabled: z.literal(false)}),
  mcp: mcpSchema.extend({subjectNamespace: mcpSchema.shape.subjectNamespace.nullable(),
    tenantNamespace: mcpSchema.shape.tenantNamespace.nullable()}),
  background: z.strictObject({enabled: z.literal(false), allowOriginalRequest: z.literal(false)}),
});

export interface AilyEnterpriseConfiguration {
  host: z.infer<typeof configurationSchema>['host'];
  task: AilyTaskConfiguration;
  caller: z.infer<typeof configurationSchema>['caller'];
  mcp: AilyMcpConfiguration;
  background: z.infer<typeof configurationSchema>['background'];
}

export type AilyEnterpriseConfigurationState =
  | {status: 'READY'; configuration: AilyEnterpriseConfiguration}
  | {status: 'MCP_ONLY'; reason: 'AILY_ENTERPRISE_CONFIGURATION_DISABLED';
      configuration: {host: z.infer<typeof hostSchema>; mcp: AilyMcpConfiguration}}
  | {status: 'DISABLED'; reason: 'AILY_ENTERPRISE_CONFIGURATION_DISABLED'}
  | {status: 'UNAVAILABLE'; reason: 'AILY_ENTERPRISE_CONFIGURATION_INVALID' | 'AILY_MCP_SIGNING_SECRET_REQUIRED'};

/** Only these two proposed server keys are read. Neither is configured by this code.
 * The non-secret JSON records approved facts; it is not platform verification.
 * An invalid supplied configuration disables its route, without exposing JSON or secrets.
 */
export function loadAilyEnterpriseConfiguration(
  environment: Partial<Pick<NodeJS.ProcessEnv, 'WL_AILY_ENTERPRISE_CONFIGURATION_JSON' | 'WL_AILY_MCP_SIGNING_SECRET'>>,
): AilyEnterpriseConfigurationState {
  const raw = environment.WL_AILY_ENTERPRISE_CONFIGURATION_JSON;
  if (!raw?.trim()) return {status: 'DISABLED', reason: 'AILY_ENTERPRISE_CONFIGURATION_DISABLED'};
  try {
    const value: unknown = JSON.parse(raw);
    if (z.strictObject({enabled: z.literal(false)}).safeParse(value).success)
      return {status: 'DISABLED', reason: 'AILY_ENTERPRISE_CONFIGURATION_DISABLED'};
    const mcpOnly = mcpOnlySchema.safeParse(value);
    const parsed = mcpOnly.success ? mcpOnly.data : configurationSchema.parse(value);
    const signingSecret = environment.WL_AILY_MCP_SIGNING_SECRET;
    if (!signingSecret?.trim()) return {status: 'UNAVAILABLE', reason: 'AILY_MCP_SIGNING_SECRET_REQUIRED'};
    if (mcpOnly.success) return {status: 'MCP_ONLY', reason: 'AILY_ENTERPRISE_CONFIGURATION_DISABLED',
      configuration: {host: mcpOnly.data.host, mcp: {...mcpOnly.data.mcp, signingSecret,
        subjectNamespace:mcpOnly.data.mcp.subjectNamespace??null,tenantNamespace:mcpOnly.data.mcp.tenantNamespace??null}}};
    // Parse the full shape separately so no partial configuration can acquire
    // task authority through the connection-only branch.
    const ready = configurationSchema.parse(parsed);
    return {status: 'READY', configuration: {host: ready.host, task: ready.task, caller: ready.caller,
      mcp: {...ready.mcp, signingSecret}, background: ready.background}};
  } catch {
    return {status: 'UNAVAILABLE', reason: 'AILY_ENTERPRISE_CONFIGURATION_INVALID'};
  }
}
