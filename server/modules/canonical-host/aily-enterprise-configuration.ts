import { z } from 'zod/v4';
import type { AilyTaskConfiguration } from './aily-task-admission';
import type { AilyMcpConfiguration } from './aily-mcp-identity.service';

export const AILY_ENTERPRISE_CONFIGURATION = Symbol('AILY_ENTERPRISE_CONFIGURATION');

const text = z.string().min(1).max(255).refine(value => value === value.trim());
const agentId = z.string().regex(/^agent_[A-Za-z0-9_-]{1,59}$/u);
const callerAppId = z.string().max(255).regex(/^cli_[A-Za-z0-9_-]+$/u);
const hostSchema = z.strictObject({appId: z.literal('app_17bzc551rsg'), environment: z.enum(['development', 'online'])});
const principalId = z.string().regex(/^service:[A-Za-z0-9:_-]{1,140}$/u);
const jwtMcpSchema = z.strictObject({
  authenticationMode: z.literal('AILY_USER_JWT').optional(),
  enabled: z.literal(true), agentId, expectedClientId: callerAppId,
  subjectNamespace: z.literal('FEISHU_OPEN_ID'), tenantNamespace: z.literal('FEISHU_TENANT_KEY'),
});
const serviceMcpSchema = z.strictObject({authenticationMode:z.literal('HOST_SERVICE'),enabled:z.literal(true),
  agentId,expectedClientId:callerAppId,tenantId:text,principalId});
const mcpSchema=z.union([jwtMcpSchema,serviceMcpSchema]);
const materialBindingSchema = z.strictObject({
  workItemId: text, basedOnWorkItemRevision: z.number().int().nonnegative(), expectedWorkRevision: z.literal(0),
  originalBinding: z.strictObject({documentVersionId: text, parseRunId: text, parseRevision: z.number().int().positive(),
    sourceArtifactId: text, sourceSha256: z.string().regex(/^[0-9a-f]{64}$/u), sourceByteLength: z.number().int().nonnegative()}),
  checklistBinding: z.strictObject({definitionId: z.literal('wiselink.engineering-assessment'),
    definitionVersion: z.literal('0.1.0-rc1'), definitionContentHash: text, contractVersion: z.literal('0.1.0-rc1')}),
  methodBinding: z.strictObject({packRef: text, version: text,
    sources: z.array(z.strictObject({sourceIdentity: text, versionLabel: text, documentVersionId: text.nullable(),
      status: z.enum(['CONFIRMED', 'VERSION_UNCONFIRMED'])})
      .transform(source => ({...source, documentVersionId: source.documentVersionId}))).min(1),
    attachment5: z.literal('R00_CONTENT_REPORTED_R01_LINK_UNCONFIRMED')}),
  documentRevision: z.number().int().positive(), materialFormat: z.literal('HOST_TASK_SNAPSHOT_V1'),
});
const referenceAttachmentSchema = z.strictObject({
  attachmentId: z.string().min(1).refine(value => value === value.trim()),
  documentUrl: z.string().url().refine(value => new URL(value).protocol === 'https:' && value === value.trim()),
  registeredCallerAppId: callerAppId,
  expectedDocumentVersionId: text,
  purpose: z.literal('REFERENCE_SNAPSHOT'),
  registrationSource: text,
  materialBinding: materialBindingSchema.optional(),
});
const taskSchema = z.strictObject({
  enabled: z.literal(true), tenantId: text, workItemId: text, intakeRequestId: text,
  agentId,
  principalId,
  authorizationFingerprint: text, publicationRef: text, configurationSource: text,
  apiAccessVerified: z.literal(true), trustedToolsVerified: z.literal(true),
  modelOptions: z.array(z.strictObject({
    modelRef: z.enum(['aily/glm-5.3', 'aily/deepseek-v4-pro']), platformBuiltIn: z.literal(true),
  })).min(1).max(2),
  referenceAttachments: z.array(referenceAttachmentSchema).min(1).max(8).optional(),
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
      (value.mcp.authenticationMode==='HOST_SERVICE' && (value.mcp.tenantId!==value.task.tenantId ||
        value.mcp.principalId!==value.task.principalId || value.caller.browserTransport!=='APPLICATION')) ||
      new Set(value.task.modelOptions.map(option => option.modelRef)).size !== value.task.modelOptions.length)
    context.addIssue({code: 'custom', message: 'Exact enterprise bindings required'});
  const attachments = value.task.referenceAttachments;
  if (attachments && (value.caller.browserTransport !== 'APPLICATION' ||
      attachments.some(item => item.registeredCallerAppId !== value.caller.appId) ||
      new Set(attachments.map(item => item.attachmentId)).size !== attachments.length))
    context.addIssue({code: 'custom', message: 'Exact application attachment registration required'});
  const materials = attachments?.filter(item => item.materialBinding !== undefined) ?? [];
  if (materials.length > 1 || materials.some(item => {
    const binding = item.materialBinding;
    return !binding || binding.workItemId !== value.task.workItemId ||
      binding.originalBinding.documentVersionId !== item.expectedDocumentVersionId;
  }))
    context.addIssue({code: 'custom', message: 'One exact assessment material binding required'});
});

// Explicit connection setup only. It cannot inherit a rejected task/caller
// block, and unknown identity namespaces still fail in the original verifier.
const mcpOnlySchema = z.strictObject({
  schemaVersion: z.literal('wiselink.aily-enterprise-configuration.v1'), enabled: z.literal(true),
  host: hostSchema, task: z.strictObject({enabled: z.literal(false)}),
  mcp: z.union([jwtMcpSchema.extend({subjectNamespace:jwtMcpSchema.shape.subjectNamespace.nullable(),
    tenantNamespace:jwtMcpSchema.shape.tenantNamespace.nullable()}),serviceMcpSchema]),
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
    let mcp:AilyMcpConfiguration;
    if(parsed.mcp.authenticationMode==='HOST_SERVICE') mcp=parsed.mcp;
    else {
      const signingSecret=environment.WL_AILY_MCP_SIGNING_SECRET;
      if(!signingSecret?.trim())return {status:'UNAVAILABLE',reason:'AILY_MCP_SIGNING_SECRET_REQUIRED'};
      mcp={...parsed.mcp,signingSecret,subjectNamespace:parsed.mcp.subjectNamespace??null,
        tenantNamespace:parsed.mcp.tenantNamespace??null};
    }
    if(mcpOnly.success)return {status:'MCP_ONLY',reason:'AILY_ENTERPRISE_CONFIGURATION_DISABLED',
      configuration:{host:mcpOnly.data.host,mcp}};
    // A rejected full configuration cannot silently fall back to MCP-only.
    const ready=configurationSchema.parse(parsed);
    return {status:'READY',configuration:{host:ready.host,task:ready.task,caller:ready.caller,mcp,background:ready.background}};
  } catch {
    return {status: 'UNAVAILABLE', reason: 'AILY_ENTERPRISE_CONFIGURATION_INVALID'};
  }
}
