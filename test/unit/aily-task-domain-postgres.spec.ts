import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { SQL } from 'drizzle-orm';
import { McpServer } from '@modelcontextprotocol/server';
import { workItem as workItemTable } from '../../server/database/schema';
import { autoWorkItemAuthorization } from '../../server/database/auto-work-item-authorization.schema';
import { canonicalJson, sealTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { AilyMcpIdentityService } from '../../server/modules/canonical-host/aily-mcp-identity.service';
import { AilyTaskAdmissionService } from '../../server/modules/canonical-host/aily-task-admission';
import { AilyTaskDomainService } from '../../server/modules/canonical-host/aily-task-domain.service';
import { CanonicalHostAilyMcpService } from '../../server/modules/canonical-host/canonical-host-aily-mcp.service';
import { AILY_TASK_ROLE_MAPPING, ailyExecutorRunSchema } from '../../server/modules/canonical-host/aily-executor-run';
import { assertAilyTrustedTaskContext } from '../../server/modules/canonical-host/aily-task-domain.types';
import { buildJobAidProblemTask, parseJobAidProblemTask } from '../../server/modules/canonical-host/jobaid-problem-task';
import { buildJobAidChecklistBinding } from '../../server/modules/canonical-host/jobaid-checklist-binding';
import { projectCommonAssessmentContext } from '../../server/modules/canonical-host/canonical-host-common-context.service';
import { syntheticAilyEnterpriseConfiguration } from '../support/aily-enterprise-configuration.fixture';
import { successorWorkItem } from '../support/aily-initial-successor.fixture';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

const mapping = { id: '00000000-0000-4000-8000-000000000771', revision: 1, status: 'ACTIVE',
  feishuOpenId: 'synthetic-open-id', feishuTenantKey: 'synthetic-tenant-key',
  miaodaUserId: 'synthetic-owner', miaodaTenantId: 'tenant-test', expectedClientId: 'cli_synthetic' };
const requestId = '00000000-0000-4000-8000-000000000772';
const sourceResult = { sourceRefs: ['synthetic-source'], text: '合成来源正文，非真实业务数据。' };
const selections = {
  read_assessment_sources: { sourceRefs: ['synthetic-source'], purpose: '核对合成来源' },
  validate_assessment_work: { workJson: '{}' },
  save_assessment_work: { candidateRef: '00000000-0000-4000-8000-000000000773' },
  read_assessment_work: { workRevisionRef: 'JAWR-synthetic' },
  project_assessment_stage_overall: { workRevisionRef: 'JAWR-synthetic' },
  finish_assessment_task: { workRevisionRef: 'JAWR-synthetic' },
};
type ToolName = keyof typeof selections;
let client: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle>;

beforeAll(async () => {
  // Explicit ephemeral fixture only. Never fall back to application credentials,
  // a default TCP server, or a real app database when the test variable is absent.
  const value = process.env.DOCUMENT_TRANSLATION_RESUME_TEST_DATABASE_URL;
  if (!value) throw new Error('AILY_DOMAIN_TEST_ISOLATED_PG_REQUIRED');
  const target = new URL(value);
  const host = target.searchParams.get('host');
  if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
      target.username !== 'wl_translation_test' || target.pathname !== '/wl_translation_test' ||
      !host || !/^\/private\/tmp\/wlpg-[A-Za-z0-9_-]+\/s$/u.test(host) ||
      target.searchParams.getAll('host').length !== 1)
    throw new Error('AILY_DOMAIN_TEST_ISOLATED_PG_REQUIRED');
  target.searchParams.delete('host');
  client = postgres(target.toString(), { host, max: 1, onnotice() {} });
  database = drizzle(client);
  // Session-local table, only the columns used by the unchanged predicate.
  await client.unsafe(`CREATE TEMPORARY TABLE identity_subject_mapping (
    id uuid PRIMARY KEY, revision integer NOT NULL, status varchar(32) NOT NULL,
    miaoda_user_id varchar(255) NOT NULL, miaoda_tenant_id varchar(128) NOT NULL,
    expected_client_id varchar(128) NOT NULL, feishu_open_id varchar(255) NOT NULL,
    feishu_tenant_key varchar(255) NOT NULL
  )`);
});

beforeEach(async () => {
  if (!client) throw new Error('AILY_DOMAIN_TEST_ISOLATED_PG_REQUIRED');
  await client.unsafe('TRUNCATE pg_temp.identity_subject_mapping');
  await client.unsafe(`INSERT INTO pg_temp.identity_subject_mapping
    (id,revision,status,miaoda_user_id,miaoda_tenant_id,expected_client_id,feishu_open_id,feishu_tenant_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [mapping.id, mapping.revision, mapping.status,
    mapping.miaodaUserId, mapping.miaodaTenantId, mapping.expectedClientId, mapping.feishuOpenId, mapping.feishuTenantKey]);
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(async () => { if (client) await client.end({ timeout: 5 }); });

/** Real JWT verification, registered MCP callbacks and domain context/authorize/run.
 * Owner/outer/task/source business ports are synthetic. Mapping predicates alone
 * run on real PostgreSQL with the installed unmodified postgres.js/Drizzle driver.
 */
async function fixture(expiresAtSeconds = Math.floor(Date.now() / 1000) + 3600) {
  const { configuration } = syntheticAilyEnterpriseConfiguration();
  const item = successorWorkItem(); const original = originalFixture();
  item.source = { documentId: 'DOC-test', documentVersionId: original.binding.documentVersionId,
    sourceArtifactId: original.binding.sourceArtifactId, sourceFileSha256: original.binding.sourceSha256,
    sourceByteLength: original.binding.sourceByteLength, parserRequestId: null, driveFileToken: null, driveSourceVersion: null };
  const config = { ...configuration.task, workItemId: item.workItemId, intakeRequestId: item.requestId };
  const identity = new AilyMcpIdentityService({ resolveSubjectMapping: async () => ({ ...mapping }) } as never, configuration.mcp);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ agent_id: config.agentId, user_id: mapping.feishuOpenId,
    tenant_id: mapping.feishuTenantKey, exp: expiresAtSeconds })).toString('base64url');
  const jwt = `${header}.${payload}.${createHmac('sha256', configuration.mcp.signingSecret).update(`${header}.${payload}`).digest('base64url')}`;
  const actor = await identity.verify(jwt);
  const input = buildJobAidProblemTask({ workItem: item, actorUserId: actor.actorUserId,
    permissionSnapshotVersion: 'synthetic-permission', purpose: 'INITIAL_PROBLEM_ASSESSMENT', sourceCatalog: [],
    sourceBindings: [{ kind: 'SOURCE_FILE', workItemId: item.workItemId, documentVersionId: item.source.documentVersionId,
      artifactRef: item.source.sourceArtifactId, artifactSha256: item.source.sourceFileSha256 }],
    automaticWorkItemLease: { requestId: item.requestId, leaseGeneration: 1 },
    common: projectCommonAssessmentContext(item, { context: { status: 'UNAVAILABLE', reason: 'SYNTHETIC' },
      documentReadingStatus: 'AVAILABLE', items: [], sections: [], resourceRefs: [] }, []),
    previousWork: null, expectedWorkRevision: 0, priorAssessmentRefs: [] });
  input.executionMode = 'AILY_AGENT_V1'; input.requestedModelRef = 'aily/deepseek-v4-pro';
  input.checklistBinding = buildJobAidChecklistBinding({ workItemId: item.workItemId,
    documentVersionId: item.source.documentVersionId, basedOnWorkItemRevision: item.revision });
  Object.assign(input.modelInput, { executionMode: input.executionMode, checklistBinding: structuredClone(input.checklistBinding),
    executionRoleMapping: structuredClone(AILY_TASK_ROLE_MAPPING), programOriginal: { binding: original.binding,
      coverage: original.coverage, units: original.source.units, sourceLocators: original.source.sourceLocators, findings: original.source.findings } });
  input.modelInput.documentOverview.original = { binding: original.binding, coverage: original.coverage, findings: original.source.findings };
  const model = { modelRef: input.requestedModelRef, displayName: 'DeepSeek V4 Pro', providerKind: 'BUILT_IN' as const,
    settingsRevision: 0, selectedAt: '2026-10-30T00:00:00.000Z' };
  const task = sealTaskEnvelope({ schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', actionAttemptId: 'ATT-time',
    operationRef: 'AQ-time', taskType: 'OPENCLAW_DYNAMIC_EVALUATION', priority: 100, tenantId: actor.tenantId,
    workItemId: item.workItemId, inputRevision: item.revision, baseRevision: item.revision, documentVersionId: item.source.documentVersionId,
    sourceRefs: [{ ref: item.source.sourceArtifactId, sha256: item.source.sourceFileSha256 }], allowedConnectors: [],
    hostResolvedMissingInputs: [], modelInput: input, executionModel: model, deadline: '2099-01-01T00:00:00.000Z',
    idempotencyKey: `openclaw-v2:dynamic:${item.workItemId}:${item.source.documentVersionId}:${requestId}` });
  expect(parseJobAidProblemTask(task)).toEqual(input);
  const row: ActionAttemptRow = { attemptId: task.actionAttemptId, operationRef: task.operationRef, triggerRequestId: 'REQ-time',
    workItemId: item.workItemId, actionType: task.taskType, attemptNo: 1, status: 'RUNNING', requestOrigin: 'OPENCLAW_MCP_V1',
    tenantId: actor.tenantId, actorUserId: actor.actorUserId, priority: 100, inputRevision: item.revision, baseRevision: item.revision,
    documentVersionId: task.documentVersionId, taskEnvelopeJson: canonicalJson(task), taskInputHash: task.inputHash,
    executionModelJson: canonicalJson(model), resultEnvelopeJson: null, resultContentHash: null, idempotencyKey: task.idempotencyKey,
    claimCount: 1, retryCount: 0, maxAttempts: 3, leaseOwner: config.principalId,
    leaseToken: '00000000-0000-4000-8000-000000000774', leaseGeneration: 1, leaseExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
    lastHeartbeatAt: null, nextAttemptAt: null, deadlineAt: new Date(task.deadline), cancelRequestedAt: null, cancelReason: null,
    terminalReason: null, projectionApplied: false, executorSessionKey: 'g2-action-attempt:AQ-time', commitStartedAt: null,
    leaseSlot: 0, startedAt: new Date('2026-10-30T00:00:00.000Z'), completedAt: null,
    createdAt: new Date('2026-10-30T00:00:00.000Z'), updatedAt: new Date('2026-10-30T00:00:00.000Z'), reviewActivityJson: '[]' };
  const run = ailyExecutorRunSchema.parse({ schemaVersion: 'wiselink.aily-executor-run.v1', executor: 'AILY_AGENT_V1', requestId,
    agentId: config.agentId, publicationRef: config.publicationRef, configurationSource: config.configurationSource,
    scope: { tenantId: actor.tenantId, workItemId: item.workItemId, intakeRequestId: item.requestId, principalId: config.principalId },
    hostSessionId: '00000000-0000-4000-8000-000000000775', leaseGeneration: row.leaseGeneration,
    modelEvidence: { selectedModelRef: model.modelRef, actualModelRef: null },
    post: { state: 'STARTED', startedAt: '2026-10-30T00:00:00.000Z', requestBody: '{}' } });
  const owner = { ...item.source, tenantId: actor.tenantId, workItemId: item.workItemId,
    requestedByUserId: actor.actorUserId, requestId: item.requestId, revision: item.revision };
  const outer: typeof autoWorkItemAuthorization.$inferSelect = { ...item.source, tenantId: actor.tenantId,
    workItemId: item.workItemId, actorUserId: actor.actorUserId, requestId: item.requestId,
    grantKind: 'MIAODA_CANONICAL_PARSE_REQUEST', status: 'LEASED', leaseOwner: config.principalId,
    leaseToken: '00000000-0000-4000-8000-000000000776', leaseGeneration: 1, leaseExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
    completedAt: null, completedLeaseGeneration: null, completedLeaseTokenHash: null, blockedAt: null, blockedCode: null,
    blockedLeaseGeneration: null, blockedLeaseTokenHash: null, createdAt: new Date(), updatedAt: new Date() };
  const proofs: unknown[] = [];
  const select = jest.fn(() => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => {
    if (table === workItemTable) return [owner];
    if (table === autoWorkItemAuthorization) return [outer];
    throw new Error('SYNTHETIC_UNEXPECTED_BUSINESS_TABLE');
  } }) }) }));
  const actors = {
    withActorScope: jest.fn(async (_actor: string, operation: () => Promise<unknown>) => operation()),
    withActorTransaction: jest.fn(async (_actor: string, operation: (input: { database: unknown }) => Promise<unknown>) =>
      database.transaction(async tx => operation({ database: {
        execute: async (statement: SQL) => {
          // No PgDialect replacement result, raw params conversion or serializer patch.
          const result = await tx.execute(statement); proofs.push(result[0]?.allowed); return result;
        }, select,
      } }))),
  };
  const repository = { readByOperationRef: jest.fn(async () => row), readAilyExecutorRun: jest.fn(async () => run),
    compareAndSetAilyDomainRun: jest.fn() };
  const work = { listForRuntime: jest.fn(async () => []), readAilySave: jest.fn(), recordWorkRead: jest.fn(), recordAilyStage: jest.fn() };
  const jobAid = { readSources: jest.fn(async (_input: unknown, context: Parameters<typeof assertAilyTrustedTaskContext>[0]) => {
    assertAilyTrustedTaskContext(context); return sourceResult;
  }), validateWork: jest.fn(), saveWork: jest.fn(), readAttemptWork: jest.fn(), projectAilyStage: jest.fn(), finishAily: jest.fn() };
  const registrar = { getTenantScopedByWorkItemId: jest.fn(async () => item) };
  const dispatch = { acknowledgeAilyWorkItem: jest.fn() };
  const domain = new AilyTaskDomainService(identity, actors as never, repository as never, work as never, jobAid as never,
    new AilyTaskAdmissionService(config), registrar as never, dispatch as never);
  const service = new CanonicalHostAilyMcpService(identity, domain);
  const handlers = new Map<string, (value: never) => Promise<unknown>>();
  const register = jest.spyOn(McpServer.prototype, 'registerTool').mockImplementation(function (name, _definition, call) {
    handlers.set(name, call as never); return { remove: jest.fn(), enable: jest.fn(), disable: jest.fn(), update: jest.fn() } as never;
  });
  try { (service as unknown as { server(value: typeof actor): McpServer }).server(actor); }
  finally { register.mockRestore(); }
  const invoke = (name: ToolName) => handlers.get(name)!({ taskContextRef: task.operationRef, ...selections[name] } as never);
  return { actor, identity, item, row, proofs, select, actors, repository, work, jobAid, dispatch, invoke };
}

function authorizationError() {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'AILY_DOMAIN_AUTHORIZATION_CHANGED' }) }] };
}

it('executes real mapping predicates before and after a successful registered source read', async () => {
  const h = await fixture();
  expect(await h.invoke('read_assessment_sources')).toEqual({ content: [{ type: 'text', text: JSON.stringify(sourceResult) }] });
  expect(h.proofs).toEqual([true, true]); expect(h.jobAid.readSources).toHaveBeenCalledTimes(1);
  expect(h.select).toHaveBeenCalledTimes(2);
  expect(h.actors.withActorTransaction).toHaveBeenCalledTimes(2);
  for (const [actor] of h.actors.withActorTransaction.mock.calls) expect(actor).toBe(mapping.miaodaUserId);
  expect(h.repository.compareAndSetAilyDomainRun).not.toHaveBeenCalled(); expect(h.jobAid.saveWork).not.toHaveBeenCalled();
});

it.each((Object.keys(selections) as ToolName[]).flatMap(name => ['inactive', 'revision'].map(reason => [name, reason] as const)))(
  'rejects %s at the first actual PG predicate when mapping is %s', async (name, reason) => {
    const h = await fixture();
    await client!.unsafe(reason === 'inactive' ? "UPDATE pg_temp.identity_subject_mapping SET status='INACTIVE' WHERE id=$1"
      : 'UPDATE pg_temp.identity_subject_mapping SET revision=revision+1 WHERE id=$1', [mapping.id]);
    expect(await h.invoke(name)).toEqual(authorizationError()); expect(h.proofs).toEqual([false]);
    expect(h.select).not.toHaveBeenCalled(); expect(h.work.listForRuntime).not.toHaveBeenCalled();
    expect(h.repository.compareAndSetAilyDomainRun).not.toHaveBeenCalled();
    for (const callback of Object.values(h.jobAid)) expect(callback).not.toHaveBeenCalled();
    expect(h.dispatch.acknowledgeAilyWorkItem).not.toHaveBeenCalled();
  });

it('rejects expiry by the real database clock even when the verified actor is still valid to the JS clock', async () => {
  const [clock] = await client!.unsafe<{ seconds: string }[]>('SELECT floor(extract(epoch FROM clock_timestamp()))::bigint AS seconds');
  const seconds = Number(clock.seconds);
  jest.spyOn(Date, 'now').mockReturnValue((seconds - 120) * 1000);
  const h = await fixture(seconds - 60);
  expect(() => h.identity.assertVerified(h.actor)).not.toThrow();
  expect(await h.invoke('read_assessment_sources')).toEqual(authorizationError()); expect(h.proofs).toEqual([false]);
  expect(h.select).not.toHaveBeenCalled(); expect(h.jobAid.readSources).not.toHaveBeenCalled();
  expect(h.repository.compareAndSetAilyDomainRun).not.toHaveBeenCalled();
});

it.each(['inactive', 'revision'] as const)('rejects %s mapping changes committed while the source read awaits, before returning its body', async reason => {
  const h = await fixture(); let release!: () => void; let entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  h.jobAid.readSources.mockImplementationOnce(async (_input, context) => {
    assertAilyTrustedTaskContext(context); entered(); await waiting; return sourceResult;
  });
  const pending = h.invoke('read_assessment_sources');
  try {
    expect(await Promise.race([started.then(() => ({ entered: true })),
      pending.then(result => ({ entered: false, result }))])).toEqual({ entered: true });
    expect(h.proofs).toEqual([true]);
    await client!.unsafe(reason === 'inactive' ? "UPDATE pg_temp.identity_subject_mapping SET status='INACTIVE' WHERE id=$1"
      : 'UPDATE pg_temp.identity_subject_mapping SET revision=revision+1 WHERE id=$1', [mapping.id]);
  } finally { release(); }
  expect(await pending).toEqual(authorizationError()); expect(h.proofs).toEqual([true, false]);
  expect(h.jobAid.readSources).toHaveBeenCalledTimes(1); expect(h.repository.compareAndSetAilyDomainRun).not.toHaveBeenCalled();
  expect(h.jobAid.saveWork).not.toHaveBeenCalled(); expect(h.dispatch.acknowledgeAilyWorkItem).not.toHaveBeenCalled();
});
