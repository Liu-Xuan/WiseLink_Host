import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { ActionAttemptRepository } from '../../server/modules/action-attempt/action-attempt.repository';
import type { AutomaticWorkItemSourceAuthorizationInput, AutomaticWorkItemSourceAuthorizationResult }
  from '../../server/modules/canonical-host/automatic-work-item-source-authorization.port';
import { McpServer } from '@modelcontextprotocol/server';
import { workItem as workItemTable, actionAttempt as attemptTable } from '../../server/database/schema';
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
let database: PostgresJsDatabase;

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
  // Minimal session-local columns used by the real service delegation/lease SQL.
  await client.unsafe(`CREATE TEMPORARY TABLE action_attempt (
    attempt_id text, operation_ref text, actor_user_id text, tenant_id text, work_item_id text,
    task_input_hash text, document_version_id text, input_revision integer, base_revision integer,
    request_origin text, action_type text, task_envelope_json text, lease_owner text, lease_token text,
    lease_generation integer, status text, cancel_requested_at timestamptz, lease_expires_at timestamptz,
    deadline_at timestamptz, probe_writes integer DEFAULT 0)`);
  await client.unsafe(`CREATE TEMPORARY TABLE work_item (
    work_item_id text, tenant_id text, requested_by_user_id text, request_id text, document_id text,
    document_version_id text, source_artifact_id text, source_file_sha256 text, source_byte_length bigint)`);
  await client.unsafe(`CREATE TEMPORARY TABLE auto_work_item_authorization (
    tenant_id text, work_item_id text, actor_user_id text, request_id text, document_id text,
    document_version_id text, source_artifact_id text, source_file_sha256 text, source_byte_length bigint,
    grant_kind text, status text, lease_owner text, lease_token text, lease_generation integer, lease_expires_at timestamptz)`);
});

beforeEach(async () => {
  if (!client) throw new Error('AILY_DOMAIN_TEST_ISOLATED_PG_REQUIRED');
  await client.unsafe('TRUNCATE pg_temp.identity_subject_mapping, pg_temp.action_attempt, pg_temp.work_item, pg_temp.auto_work_item_authorization');
  await client.unsafe(`INSERT INTO pg_temp.identity_subject_mapping
    (id,revision,status,miaoda_user_id,miaoda_tenant_id,expected_client_id,feishu_open_id,feishu_tenant_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [mapping.id, mapping.revision, mapping.status,
    mapping.miaodaUserId, mapping.miaodaTenantId, mapping.expectedClientId, mapping.feishuOpenId, mapping.feishuTenantKey]);
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(async () => { if (client) await client.end({ timeout: 5 }); });

/** Real caller verification, registered MCP callbacks and domain context/authorize/run.
 * PostgreSQL executes mapping, exact service metadata and delegation/write predicates
 * through the unmodified postgres.js/Drizzle driver. Physical SDK role/actor scope,
 * source ACL and business readers stay explicit synthetic boundary ports.
 */
async function fixture(expiresAtSeconds = Math.floor(Date.now() / 1000) + 3600, hostService=false, missingSourceProvider=false) {
  const { configuration } = syntheticAilyEnterpriseConfiguration();
  const item = successorWorkItem(); const original = originalFixture();
  item.source = { documentId: 'DOC-test', documentVersionId: original.binding.documentVersionId,
    sourceArtifactId: original.binding.sourceArtifactId, sourceFileSha256: original.binding.sourceSha256,
    sourceByteLength: original.binding.sourceByteLength, parserRequestId: null, driveFileToken: null, driveSourceVersion: null };
  const config = { ...configuration.task, workItemId: item.workItemId, intakeRequestId: item.requestId };
  const resolveSubjectMapping=jest.fn(async()=>({...mapping}));
  const identity = new AilyMcpIdentityService({resolveSubjectMapping} as never,hostService?
    {authenticationMode:'HOST_SERVICE',enabled:true,agentId:config.agentId,expectedClientId:configuration.caller.appId,
      tenantId:config.tenantId,principalId:config.principalId}:configuration.mcp);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ agent_id: config.agentId, user_id: mapping.feishuOpenId,
    tenant_id: mapping.feishuTenantKey, exp: expiresAtSeconds })).toString('base64url');
  const jwt = `${header}.${payload}.${createHmac('sha256', configuration.mcp.signingSecret).update(`${header}.${payload}`).digest('base64url')}`;
  const jwtActor=hostService?null:await identity.verify(jwt);
  const actor=jwtActor??{actorUserId:mapping.miaodaUserId,tenantId:mapping.miaodaTenantId};
  const verify = jest.spyOn(identity, 'verify');
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
    assertHostedServiceRole:jest.fn(async()=>undefined),
    withActorScope: jest.fn(async (_actor: string, operation: () => Promise<unknown>) => operation()),
    withActorTransaction: jest.fn(async (_actor: string, operation: (input: { database: unknown }) => Promise<unknown>) =>
      database.transaction(async tx => operation({ database: {
        execute: async (statement: SQL) => {
          // No PgDialect replacement result, raw params conversion or serializer patch.
          const result = await tx.execute(statement); proofs.push(result[0]?.allowed); return result;
        }, select,
      } }))),
  };
  if(hostService) {
    await client!.unsafe(`INSERT INTO pg_temp.action_attempt
      (attempt_id,operation_ref,actor_user_id,tenant_id,work_item_id,task_input_hash,document_version_id,input_revision,
       base_revision,request_origin,action_type,task_envelope_json,lease_owner,lease_token,lease_generation,status,lease_expires_at,deadline_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [row.attemptId,row.operationRef,row.actorUserId,row.tenantId,row.workItemId,row.taskInputHash,row.documentVersionId,
        row.inputRevision,row.baseRevision,row.requestOrigin,row.actionType,row.taskEnvelopeJson,row.leaseOwner,row.leaseToken,
        row.leaseGeneration,row.status,row.leaseExpiresAt!.toISOString(),row.deadlineAt!.toISOString()]);
    await client!.unsafe(`INSERT INTO pg_temp.work_item VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [item.workItemId,actor.tenantId,actor.actorUserId,item.requestId,owner.documentId,owner.documentVersionId,
        owner.sourceArtifactId,owner.sourceFileSha256,owner.sourceByteLength]);
    await client!.unsafe(`INSERT INTO pg_temp.auto_work_item_authorization VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [outer.tenantId,outer.workItemId,outer.actorUserId,outer.requestId,outer.documentId,outer.documentVersionId,
        outer.sourceArtifactId,outer.sourceFileSha256,outer.sourceByteLength,outer.grantKind,outer.status,
        outer.leaseOwner,outer.leaseToken,outer.leaseGeneration,outer.leaseExpiresAt!.toISOString()]);
  }
  const actualRepository=new ActionAttemptRepository(database);
  const sourceAuthorization={authorizeSourceRead:jest.fn(async(input:AutomaticWorkItemSourceAuthorizationInput,
    _database?:PostgresJsDatabase):Promise<AutomaticWorkItemSourceAuthorizationResult>=>({...input,allowed:true,
    action:'DOCUMENT_READ',authorizationPolicy:'MIAODA_HOST_DOCUMENT_READ'}))};
  const repository = { readAilyTaskActorBinding:jest.fn(actualRepository.readAilyTaskActorBinding.bind(actualRepository)),
    readByOperationRef: jest.fn(async () => row), readAilyExecutorRun: jest.fn(async () => run),
    compareAndSetAilyDomainRun: jest.fn() };
  const work = { listForRuntime: jest.fn(async () => []), readAilySave: jest.fn(), recordWorkRead: jest.fn(), recordAilyStage: jest.fn() };
  const jobAid = { readSources: jest.fn(async (_input: unknown, context: Parameters<typeof assertAilyTrustedTaskContext>[0]) => {
    assertAilyTrustedTaskContext(context); return sourceResult;
  }), validateWork: jest.fn(), saveWork: jest.fn(), readAttemptWork: jest.fn(), projectAilyStage: jest.fn(), finishAily: jest.fn() };
  const registrar = { getTenantScopedByWorkItemId: jest.fn(async () => item) };
  const dispatch = { acknowledgeAilyWorkItem: jest.fn() };
  const domain = new AilyTaskDomainService(identity, actors as never, repository as never, work as never, jobAid as never,
    new AilyTaskAdmissionService(config), registrar as never, dispatch as never,
    missingSourceProvider?undefined:sourceAuthorization);
  const service = new CanonicalHostAilyMcpService(identity, domain);
  const handlers = new Map<string, (value: never) => Promise<unknown>>();
  const register = jest.spyOn(McpServer.prototype, 'registerTool').mockImplementation(function (name, _definition, call) {
    handlers.set(name, call as never); return { remove: jest.fn(), enable: jest.fn(), disable: jest.fn(), update: jest.fn() } as never;
  });
  try { (service as unknown as { server(jwt: unknown): McpServer }).server(hostService?undefined:jwt); }
  finally { register.mockRestore(); }
  const invoke = (name: ToolName) => handlers.get(name)!({ taskContextRef: task.operationRef, ...selections[name] } as never);
  return { actor, jwtActor, identity, verify, resolveSubjectMapping, item, row, outer, run, domain, sourceAuthorization, proofs, select, actors, repository, work, jobAid, dispatch, invoke, jwt };
}

function authorizationError() {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'AILY_DOMAIN_AUTHORIZATION_CHANGED' }) }] };
}

it('executes real mapping predicates before and after a successful registered source read', async () => {
  const h = await fixture();
  expect(await h.invoke('read_assessment_sources')).toEqual({ content: [{ type: 'text', text: JSON.stringify(sourceResult) }] });
  expect(h.verify).toHaveBeenCalledTimes(1); expect(h.verify).toHaveBeenCalledWith(h.jwt);
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
    expect(h.verify).toHaveBeenCalledTimes(1); expect(h.verify).toHaveBeenCalledWith(h.jwt);
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
  if(!h.jwtActor)throw new Error('SYNTHETIC_JWT_ACTOR_REQUIRED');
  expect(() => h.identity.assertVerified(h.jwtActor!)).not.toThrow();
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


describe('real PostgreSQL Host service delegation predicates',()=>{
  it('reads exact metadata and source through the real facade without any user JWT mapping',async()=>{
    const h=await fixture(undefined,true);
    expect(await h.invoke('read_assessment_sources')).toEqual({content:[{type:'text',text:JSON.stringify(sourceResult)}]});
    expect(h.resolveSubjectMapping).not.toHaveBeenCalled();expect(h.verify).not.toHaveBeenCalled();
    expect(h.actors.assertHostedServiceRole).toHaveBeenCalledTimes(1);
    expect(h.repository.readAilyTaskActorBinding).toHaveBeenCalledWith({operationRef:h.row.operationRef,tenantId:h.row.tenantId,workItemId:h.row.workItemId});
    expect(h.sourceAuthorization.authorizeSourceRead).toHaveBeenCalledTimes(2);
    expect(h.proofs).toEqual([true,true,true]);expect(h.jobAid.readSources).toHaveBeenCalledTimes(1);
  });

  it.each(['foreign-ref','foreign-tenant','foreign-work-item','non-aily'] as const)(
    'does not derive an actor for a %s task outside the exact metadata selector',async reason=>{
      const h=await fixture(undefined,true);
      const update=reason==='foreign-ref'?"UPDATE pg_temp.action_attempt SET operation_ref='AQ-other'":
        reason==='foreign-tenant'?"UPDATE pg_temp.action_attempt SET tenant_id='tenant-other'":
        reason==='foreign-work-item'?"UPDATE pg_temp.action_attempt SET work_item_id='WI-other'":
        `UPDATE pg_temp.action_attempt SET task_envelope_json=jsonb_set(task_envelope_json::jsonb,
          '{modelInput,executionMode}','"PROGRAM_AGENT_V1"'::jsonb)::text`;
      await client!.unsafe(update);
      expect(await h.invoke('read_assessment_sources')).toEqual({isError:true,
        content:[{type:'text',text:JSON.stringify({code:'AILY_DOMAIN_TASK_NOT_FOUND'})}]});
      expect(h.repository.readByOperationRef).not.toHaveBeenCalled();expect(h.actors.withActorScope).not.toHaveBeenCalled();
      expect(h.sourceAuthorization.authorizeSourceRead).not.toHaveBeenCalled();expect(h.jobAid.readSources).not.toHaveBeenCalled();
    });

  it('fails before metadata/body reads when the actual service role port denies access',async()=>{
    const h=await fixture(undefined,true);h.actors.assertHostedServiceRole.mockRejectedValueOnce(new Error('SYNTHETIC_ROLE_DENIED'));
    expect(await h.invoke('read_assessment_sources')).toMatchObject({isError:true});
    expect(h.repository.readAilyTaskActorBinding).not.toHaveBeenCalled();expect(h.repository.readByOperationRef).not.toHaveBeenCalled();
    expect(h.jobAid.readSources).not.toHaveBeenCalled();expect(h.resolveSubjectMapping).not.toHaveBeenCalled();
  });
  it('does not omit source authorization when the production port is missing',async()=>{
    const h=await fixture(undefined,true,true);
    expect(await h.invoke('read_assessment_sources')).toEqual({isError:true,content:[{type:'text',text:JSON.stringify({code:'AILY_DOMAIN_SOURCE_AUTHORIZATION_REQUIRED'})}]});
    expect(h.jobAid.readSources).not.toHaveBeenCalled();expect(h.proofs).toEqual([]);
  });

  it.each(['owner','hash'] as const)('rejects a %s change between metadata lookup and full task binding',async reason=>{
    const h=await fixture(undefined,true);
    h.repository.readByOperationRef.mockImplementationOnce(async()=>({...h.row,...(reason==='owner'?{actorUserId:'synthetic-other-owner'}:{taskInputHash:'b'.repeat(64)})}));
    expect(await h.invoke('read_assessment_sources')).toMatchObject({isError:true});
    expect(h.sourceAuthorization.authorizeSourceRead).not.toHaveBeenCalled();expect(h.jobAid.readSources).not.toHaveBeenCalled();
  });

  it.each(['owner','source','grant-actor'] as const)('rejects the persisted %s change in the actual delegation SQL',async reason=>{
    const h=await fixture(undefined,true);
    const query=reason==='owner'?"UPDATE pg_temp.work_item SET requested_by_user_id='synthetic-other-owner'":
      reason==='source'?"UPDATE pg_temp.work_item SET source_file_sha256=repeat('b',64)":
      "UPDATE pg_temp.auto_work_item_authorization SET actor_user_id='synthetic-other-owner'";
    await client!.unsafe(query);
    expect(await h.invoke('read_assessment_sources')).toMatchObject({isError:true});
    expect(h.jobAid.readSources).not.toHaveBeenCalled();expect(h.repository.compareAndSetAilyDomainRun).not.toHaveBeenCalled();
  });

  it.each(['cancel','expiry','generation','grant','owner','source','hash'] as const)('keeps the real atomic write predicate false after %s changes during the source await',async reason=>{
    const h=await fixture(undefined,true);
    h.jobAid.readSources.mockImplementationOnce(async(_input,context)=>{
      assertAilyTrustedTaskContext(context);
      const update=reason==='cancel'?"UPDATE pg_temp.action_attempt SET cancel_requested_at=clock_timestamp()":
        reason==='expiry'?"UPDATE pg_temp.action_attempt SET lease_expires_at=clock_timestamp()-interval '1 second'":
        reason==='generation'?"UPDATE pg_temp.action_attempt SET lease_generation=lease_generation+1":
        reason==='grant'?"UPDATE pg_temp.auto_work_item_authorization SET status='BLOCKED'":
        reason==='owner'?"UPDATE pg_temp.work_item SET requested_by_user_id='synthetic-other-owner'":
        reason==='hash'?"UPDATE pg_temp.action_attempt SET task_input_hash=repeat('b',64)":
        "UPDATE pg_temp.work_item SET source_artifact_id='synthetic-other-source'";
      await client!.unsafe(update);
      const writes=await database.execute(sql`UPDATE ${attemptTable} SET probe_writes=probe_writes+1
        WHERE ${context.snapshot.writePredicate} RETURNING attempt_id`);
      expect(writes).toHaveLength(0);
      return sourceResult;
    });
    expect(await h.invoke('read_assessment_sources')).toMatchObject({isError:true});
    const [row]=await client!.unsafe<{probe_writes:number}[]>('SELECT probe_writes FROM pg_temp.action_attempt');
    expect(row.probe_writes).toBe(0);expect(h.jobAid.saveWork).not.toHaveBeenCalled();expect(h.dispatch.acknowledgeAilyWorkItem).not.toHaveBeenCalled();
  });

  it('rejects source policy denial before any domain body or write',async()=>{
    const h=await fixture(undefined,true);
    h.sourceAuthorization.authorizeSourceRead.mockResolvedValueOnce({allowed:false,code:'SYNTHETIC_DOCUMENT_READ_DENIED'});
    expect(await h.invoke('read_assessment_sources')).toEqual({isError:true,
      content:[{type:'text',text:JSON.stringify({code:'AILY_DOMAIN_SOURCE_AUTHORIZATION_REQUIRED'})}]});
    expect(h.proofs).toEqual([]);expect(h.jobAid.readSources).not.toHaveBeenCalled();
    expect(h.repository.compareAndSetAilyDomainRun).not.toHaveBeenCalled();
  });

  it.each(['TIMED_OUT','CANCELLED'] as const)(
    'allows exact saved READ for inner %s with the original outer lease still active, but refuses writes',async status=>{
      const h=await fixture(undefined,true);h.row.status=status;
      await client!.unsafe('UPDATE pg_temp.action_attempt SET status=$1',[status]);
      const result={revision:{workRevisionRef:'JAWR-synthetic',requestId:'SAVE-synthetic',workRevision:1}};
      h.jobAid.readAttemptWork.mockResolvedValueOnce(result);
      expect(await h.invoke('read_assessment_work')).toEqual({content:[{type:'text',text:JSON.stringify(result)}]});
      expect(h.outer.status).toBe('LEASED');expect(h.proofs.every(proof=>proof===true)).toBe(true);
      expect(h.jobAid.readAttemptWork).toHaveBeenCalledTimes(1);expect(h.work.recordWorkRead).not.toHaveBeenCalled();
      expect(h.repository.compareAndSetAilyDomainRun).not.toHaveBeenCalled();
      expect(await h.invoke('validate_assessment_work')).toEqual({isError:true,
        content:[{type:'text',text:JSON.stringify({code:'JOBAID_WORK_LEASE_FENCE_REJECTED'})}]});
      expect(h.jobAid.validateWork).not.toHaveBeenCalled();expect(h.jobAid.saveWork).not.toHaveBeenCalled();
      expect(h.dispatch.acknowledgeAilyWorkItem).not.toHaveBeenCalled();
    });

  it('preserves exact completed READ without any active inner or outer lease',async()=>{
    const h=await fixture(undefined,true);h.row.status='SUCCEEDED';h.row.leaseOwner=null;h.row.leaseToken=null;h.row.leaseExpiresAt=null;
    h.outer.status='COMPLETED';h.outer.leaseOwner=null;h.outer.leaseToken=null;h.outer.leaseExpiresAt=null;
    await client!.unsafe("UPDATE pg_temp.action_attempt SET status='SUCCEEDED',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL");
    await client!.unsafe("UPDATE pg_temp.auto_work_item_authorization SET status='COMPLETED',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL");
    const result={revision:{workRevisionRef:'JAWR-synthetic',requestId:'SAVE-synthetic',workRevision:1}};
    h.jobAid.readAttemptWork.mockResolvedValueOnce(result);
    expect(await h.invoke('read_assessment_work')).toEqual({content:[{type:'text',text:JSON.stringify(result)}]});
    expect(h.resolveSubjectMapping).not.toHaveBeenCalled();expect(h.jobAid.saveWork).not.toHaveBeenCalled();
  });
});
