import type { AilyInitialAnalysisStatus, CanonicalWorkItemProjection } from '@shared/api.interface';
import type { Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SqlExecutionContextMiddleware } from '@lark-apaas/fullstack-nestjs-core';
import { CanonicalHostModule } from '../../server/modules/canonical-host/canonical-host.module';
import { CanonicalInitialAnalysisContinuationController } from '../../server/modules/canonical-host/canonical-initial-analysis-continuation.controller';
import { CanonicalHostInitialAnalysisStatusService } from '../../server/modules/canonical-host/canonical-host-initial-analysis-status.service';
import { CanonicalHostOpenClawTranslationService } from '../../server/modules/canonical-host/canonical-host-openclaw-translation.service';
import { AutomaticWorkItemDispatchService } from '../../server/modules/canonical-host/automatic-work-item-dispatch.service';
import { EngineeringMatterWorkingRepository } from '../../server/modules/canonical-host/engineering-matter-working.repository';
import { SessionResolver } from '../../server/modules/identity/session-resolver.service';
import { SessionStore } from '../../server/modules/identity/session.store';
import { OAUTH_CONFIG, type OAuthConfigPort } from '../../server/modules/identity/oauth-config.port';
import { AILY_ENTERPRISE_CONFIGURATION, type AilyEnterpriseConfigurationState } from '../../server/modules/canonical-host/aily-enterprise-configuration';
import { AILY_TASK_CONFIGURATION } from '../../server/modules/canonical-host/aily-task-admission';
import { AILY_TASK_CHAT_CLIENT } from '../../server/modules/canonical-host/aily-task-execution.service';
import { AILY_HOST_INVOCATION_IDENTITY } from '../../server/modules/canonical-host/aily-host-invocation-identity.port';
import { AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION } from '../../server/modules/canonical-host/automatic-work-item-source-authorization.port';
import { CANONICAL_AUTHORIZATION, CANONICAL_PERMISSION_SNAPSHOT, CANONICAL_WORK_ITEM_REGISTRAR } from '../../server/modules/canonical-host/canonical-host.constants';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { JOBAID_PROBLEM_WORK_SCHEMA } from '@shared/jobaid-problem-assessment.interface';
import { JOBAID_CHECKLIST_RC1, JOBAID_CHECKLIST_RC1_CONTENT_HASH } from '@shared/jobaid-checklist-rc1';
import { canonicalJson, parseTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope';
import type { OpenClawTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope.types';
import { ActionAttemptLifecycleService } from '../../server/modules/action-attempt/action-attempt-lifecycle.service';
import { ActionAttemptRepository } from '../../server/modules/action-attempt/action-attempt.repository';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { AilyTaskAdmissionService, type AilyTaskConfiguration } from '../../server/modules/canonical-host/aily-task-admission';
import { AilyTaskExecutionService } from '../../server/modules/canonical-host/aily-task-execution.service';
import { type AilyExecutorRun, AILY_TASK_ROLE_MAPPING } from '../../server/modules/canonical-host/aily-executor-run';
import { serializeAilyChatRequest } from '../../server/modules/canonical-host/aily-chat-client';
import { CanonicalInitialAnalysisContinuationService } from '../../server/modules/canonical-host/canonical-initial-analysis-continuation.service';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import { projectCommonAssessmentContext } from '../../server/modules/canonical-host/canonical-host-common-context.service';
import { JOBAID_METHOD_BINDING } from '../../server/modules/canonical-host/jobaid-method-pack';
import { parseJobAidProblemTask } from '../../server/modules/canonical-host/jobaid-problem-task';
import * as grantCodec from '../../server/modules/identity/aily-user-grant.codec';
import type { ResolvedSession } from '../../server/modules/identity/session-resolver.service';
import { fixedModelSettings } from '../support/fixed-model-settings';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { createHash, createHmac } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import { AilyMcpIdentityService } from '../../server/modules/canonical-host/aily-mcp-identity.service';
import type { AilyMcpVerifiedActor } from '../../server/modules/canonical-host/aily-mcp-identity.service';
import { AilyTaskDomainService } from '../../server/modules/canonical-host/aily-task-domain.service';
import { CanonicalHostAilyMcpService } from '../../server/modules/canonical-host/canonical-host-aily-mcp.service';
import { workItem as workItemTable,actionAttempt as attemptTable } from '../../server/database/schema';
import { autoWorkItemAuthorization } from '../../server/database/auto-work-item-authorization.schema';
import { assertJobAidWorkFence } from '../../server/modules/canonical-host/jobaid-work.repository';
import { UNAVAILABLE_AILY_HOST_INVOCATION_IDENTITY } from '../../server/modules/canonical-host/aily-host-invocation-identity.port';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';
import { MiaodaCanonicalWorkItemRegistrarAdapter } from '../../server/modules/work-item/miaoda-canonical-work-item-registrar.adapter';
import { AilyHostInvocationIdentityProvider } from '../../server/modules/canonical-host/aily-host-invocation-identity.provider';
import { AilyBackgroundDispatchService } from '../../server/modules/canonical-host/aily-background-dispatch.service';
import { AilyTaskLifecycleService } from '../../server/modules/canonical-host/aily-task-lifecycle.service';
import { HierarchicalWikiAutomation } from '../../server/modules/canonical-host/hierarchical-wiki.automation';
import { AILY_TASK_CHAT_ADAPTER } from '../../server/modules/canonical-host/aily-task-execution.service';
import { syntheticAilyEnterpriseConfiguration, syntheticAilyHostServiceConfiguration } from '../support/aily-enterprise-configuration.fixture';
import { ailyInitialSuccessorFixture } from '../support/aily-initial-successor.fixture';
import { MiaodaDocumentVersionSourceResolver } from '../../server/modules/work-item/miaoda-document-version-source.resolver';
import type { Request } from 'express';

const requestId = '00000000-0000-4000-8000-000000000101';
const sessionId = '00000000-0000-4000-8000-000000000102';
const leaseToken = '00000000-0000-4000-8000-000000000103';
const actor = {userId: 'owner-test', tenantId: 'tenant-test', appId: 'app_17bzc551rsg', roles: [], env: 'test'};

/** In-memory repository exercises real reservation/preparation/claim/consumer code.
 * All identity/config/client inputs are synthetic; this is not PostgreSQL or platform proof.
 */
function harness(authenticationMode:'AILY_USER_JWT'|'HOST_SERVICE'='AILY_USER_JWT', initialAilySessionId:string|null=sessionId) {
  const original = originalFixture();
  original.source.units[0].payload = {text: `完整原文起点${'原始条件不得截断。'.repeat(12000)}完整原文终点`};
  const workItem = {schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-test', requestId: 'original-intake', revision: 5, phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-test', source: {documentId: 'DOC-test', documentVersionId: original.binding.documentVersionId,
      sourceArtifactId: original.binding.sourceArtifactId, sourceFileSha256: original.binding.sourceSha256,
      sourceByteLength: original.binding.sourceByteLength}, classification: {status: 'CONFIRMED', normalizedFamily: 'SB'},
    package: {packageId: 'PKG-test', title: 'Synthetic source', artifact: {ref: 'artifact://synthetic-package',
      sha256: 'a'.repeat(64), byteLength: 100, mediaType: 'application/json', storeRole: 'U0_PARSED_PACKAGE'}},
    integratedAssessment: null, failure: null, recordingFailure: null} as unknown as CanonicalWorkItemProjection;
  const config: AilyTaskConfiguration = {enabled: true, tenantId: actor.tenantId, workItemId: workItem.workItemId,
    intakeRequestId: workItem.requestId, agentId: 'agent_synthetic', principalId: 'service:aily-synthetic',
    authorizationFingerprint: 'synthetic-scope', publicationRef: 'synthetic-publication', configurationSource: 'synthetic-approved-fixture',
    apiAccessVerified: true, trustedToolsVerified: true, modelOptions: [{modelRef: 'aily/deepseek-v4-pro', platformBuiltIn: true}]};
  let row: ActionAttemptRow | null = null;
  let run: AilyExecutorRun | null = null;
  const order: string[] = [];
  const repository = {
    readWorkItemBinding: jest.fn(async () => ({workItemId: workItem.workItemId, tenantId: actor.tenantId,
      documentVersionId: workItem.source.documentVersionId, revision: workItem.revision, projectionJson: canonicalJson(workItem)})),
    readByIdempotency: jest.fn(async () => row),
    readLatestByExactIdempotency: jest.fn(async () => row),
    readByAttemptId: jest.fn(async () => row), readByOperationRef: jest.fn(async () => row),
    readAilyTaskActorBinding:jest.fn(async(input:{operationRef:string;tenantId:string;workItemId:string})=>row&&
      row.operationRef===input.operationRef&&row.tenantId===input.tenantId&&row.workItemId===input.workItemId
      ?{attemptId:row.attemptId,operationRef:row.operationRef,actorUserId:row.actorUserId,tenantId:row.tenantId,workItemId:row.workItemId,
        taskInputHash:row.taskInputHash,documentVersionId:row.documentVersionId,inputRevision:row.inputRevision,baseRevision:row.baseRevision}:null),
    readControlByOperationRef: jest.fn(async () => row),
    heartbeat: jest.fn(async (input: {leaseToken: string; leaseGeneration: number; now: Date; leaseMs: number}) => {
      if (!row || row.status !== 'RUNNING' || row.cancelRequestedAt || row.leaseToken !== input.leaseToken ||
          row.leaseGeneration !== input.leaseGeneration || !row.leaseExpiresAt || row.leaseExpiresAt <= input.now ||
          !row.deadlineAt || row.deadlineAt <= input.now) return false;
      row = {...row, leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs)}; return true;
    }),
    terminalizeExpiredActiveForSuccessor: jest.fn(async () => false), nextAttemptNo: jest.fn(async () => 1),
    reserve: jest.fn(async (value: Record<string, unknown>) => {
      order.push('reservation');
      row = {...value, subjectKind:'WORK_ITEM',claimCount: 0, retryCount: 0, leaseGeneration: 0, leaseOwner: null, leaseToken: null,
        leaseSlot:null,lastHeartbeatAt:null,
        leaseExpiresAt: null, startedAt: null, cancelRequestedAt: null, commitStartedAt: null,
        resultEnvelopeJson: null, resultContentHash: null, projectionApplied: false, executorSessionKey: null,
        completedAt: null, terminalReason: null, errorCode: null, errorMessage: null} as unknown as ActionAttemptRow;
      return {row, created: true};
    }),
    prepareInitialRequestInput: jest.fn(async (_old: ActionAttemptRow, task: OpenClawTaskEnvelope) => {
      order.push('prepared'); row = {...row!, taskEnvelopeJson: canonicalJson(task), taskInputHash: task.inputHash}; return row;
    }),
    failInitialRequestPreparation: jest.fn(),
    claimExact: jest.fn(async (input: {leaseOwner: string; leaseSlot: number; now: Date; leaseMs: number; ailyExecution?: true}) => {
      order.push('claim');
      if (!input.ailyExecution) throw new Error('OLD_NATIVE_MUST_NOT_CLAIM_ENTERPRISE');
      row = {...row!, status: 'RUNNING', claimCount: 1, leaseOwner: input.leaseOwner, leaseToken, leaseGeneration: 1,
        leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs), startedAt: input.now,
        executorSessionKey: `g2-action-attempt:${row!.operationRef}`, leaseSlot: input.leaseSlot}; return row;
    }),
    recoverExpiredRunning: jest.fn(),
    markCommitting:jest.fn<Promise<ActionAttemptRow|null>,[Parameters<ActionAttemptRepository['markCommitting']>[0]]>(),
    finishTerminal:jest.fn<Promise<boolean>,[Parameters<ActionAttemptRepository['finishTerminal']>[0]]>(),
    assertAilyExecutorStorage: jest.fn(async () => undefined),
    readAilyExecutorRun: jest.fn(async () => run),
    compareAndSetAilyObservation: jest.fn(async (input: {expected: AilyExecutorRun; observation: NonNullable<AilyExecutorRun['observation']>}) => {
      if (!run || canonicalJson({...run, pending: undefined, observation: undefined}) !==
          canonicalJson({...input.expected, pending: undefined, observation: undefined})) return false;
      run = {...run, observation: input.observation}; return true;
    }),
    compareAndSetAilyExecutorRun: jest.fn(async (input: {row: ActionAttemptRow; principalId: string; expected: AilyExecutorRun | null; next: AilyExecutorRun}) => {
      if (input.expected === null ? run !== null : canonicalJson(run && {...run,pending:undefined}) !== canonicalJson({...input.expected,pending:undefined})) return false;
      if (!row || row.status !== 'RUNNING' || row.cancelRequestedAt || !row.leaseExpiresAt || row.leaseExpiresAt <= new Date() ||
          !row.deadlineAt || row.deadlineAt <= new Date() || row.leaseOwner !== input.principalId ||
          row.leaseToken !== input.row.leaseToken || row.leaseGeneration !== input.row.leaseGeneration) return false;
      order.push(input.next.post.state); run = {...structuredClone(input.next),...(run?.pending ? {pending:run.pending} : {})}; return true;
    }),
    compareAndSetAilyDomainRun: jest.fn(async (input: {expected:AilyExecutorRun;next:AilyExecutorRun}) => {
      if (canonicalJson(run) !== canonicalJson(input.expected)) return false;
      run = structuredClone(input.next); return true;
    }),
  };
  const models = fixedModelSettings();
  const capture = jest.spyOn(models, 'captureForWorkItem');
  const attempts = new ActionAttemptLifecycleService(repository as never, models);
  const previous: JobAidWorkRevision = {workRevisionRef: 'JAWR-previous', workItemId: workItem.workItemId, workRevision: 3,
    previousWorkRevisionRef: null, requestId: 'previous-save', actionAttemptId: 'ATT-previous', basedOnWorkItemRevision: 5,
    documentVersionId: workItem.source.documentVersionId, createdAt: '2026-10-28T00:00:00.000Z', content: {
      schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA, overviewStatus: 'CURRENT', headline: 'Synthetic prior work',
      listBrief: 'Synthetic', understanding: '前版完整认识与未解决事项', decisiveIssueKeys: [], issues: [],
      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS', completionReason: '保留未知', changeSummary: 'Synthetic',
      unchangedExplanation: '继承', methodBinding: structuredClone(JOBAID_METHOD_BINDING), evidence: [], readSourceRefs: [],
      capabilities: [], historyReview: {required: false, priorAssessmentRefs: [], engineeringDocumentRefs: [], coverage: 'NOT_REQUIRED', limitation: null}}};
  const binding = {kind: 'SOURCE_FILE', workItemId: workItem.workItemId, documentVersionId: workItem.source.documentVersionId,
    artifactRef: workItem.source.sourceArtifactId, artifactSha256: workItem.source.sourceFileSha256};
  const saved: JobAidWorkRevision[] = [];
  const commands = new Map<string,string>();
  const artifactBytes = new Map<string,Uint8Array>();
  const artifacts = {persistAndReadback: jest.fn(async (bytes:Uint8Array) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const ref = `artifact://synthetic/${sha256}`; artifactBytes.set(ref,bytes);
    return {bytes,artifact:{ref,sha256,byteLength:bytes.byteLength,mediaType:'application/json',storeRole:'UnifiedArtifactStoreCandidate'}};
  }),readActualBytes:jest.fn(async (artifact:{ref:string}) => artifactBytes.get(artifact.ref)!)};
  const journal = (record:object) => {row = {...row!,reviewActivityJson:canonicalJson([
    ...JSON.parse(row!.reviewActivityJson ?? '[]') as object[],record])};};
  const work = {publishedOriginalBinding: jest.fn(async () => ({parseRunId: original.binding.parseRunId})),
    publishedOriginalBindingForRequest: jest.fn(async () => ({parseRunId: original.binding.parseRunId, parseRevision: 2})),
    publishedOriginalBindingInTransaction:jest.fn(async(input:{tenantId:string;actorUserId:string;workItemId:string;documentVersionId:string},database:unknown)=>{
      expect(input).toEqual({tenantId:actor.tenantId,actorUserId:actor.userId,workItemId:workItem.workItemId,
        documentVersionId:workItem.source.documentVersionId});
      expect(database).toBe(grantDatabase);
      return {parseRunId:original.binding.parseRunId,parseRevision:2};
    }),
    listHeadersForRuntime: jest.fn(async () => [{workRevisionRef: previous.workRevisionRef, workRevision: 3}]),
    readByRefForRuntime: jest.fn(async (input:{workRevisionRef:string}) => [...saved,previous].find(item => item.workRevisionRef === input.workRevisionRef) ?? null),
    listForRuntime:jest.fn(async () => [...saved,previous]),
    readValidationSnapshot:jest.fn(async (input:{fence:Parameters<typeof assertJobAidWorkFence>[1]}) => {
      assertJobAidWorkFence(row!,input.fence);return {reviewActivityJson:row!.reviewActivityJson,previous:saved[0] ?? previous};
    }),
    readAilySave:jest.fn(async (input:{requestId:string;command:unknown}) => {
      const found = saved.find(item => item.requestId === input.requestId);
      if (found && commands.get(input.requestId) !== canonicalJson(input.command)) throw new Error('JOBAID_SAVE_REQUEST_REUSED');
      return found ?? null;
    }),
    save:jest.fn(async (input:{requestId:string;expectedWorkRevision:number;content:JobAidWorkRevision['content'];command:unknown;fence:Parameters<typeof assertJobAidWorkFence>[1]}) => {
      assertJobAidWorkFence(row!,input.fence);
      if (input.expectedWorkRevision !== (saved[0]?.workRevision ?? previous.workRevision)) throw new Error('JOBAID_WORK_REVISION_CONFLICT');
      const revision:JobAidWorkRevision = {workRevisionRef:`JAWR-synthetic-${input.expectedWorkRevision+1}`,workItemId:workItem.workItemId,
        workRevision:input.expectedWorkRevision+1,previousWorkRevisionRef:saved[0]?.workRevisionRef ?? previous.workRevisionRef,
        requestId:input.requestId,actionAttemptId:row!.attemptId,basedOnWorkItemRevision:row!.baseRevision!,
        documentVersionId:row!.documentVersionId!,createdAt:new Date().toISOString(),content:input.content};
      commands.set(input.requestId,canonicalJson(input.command));saved.unshift(revision);return {revision,replayed:false};
    }),
    recordSourceRead:jest.fn(async (input:{sourceRefs:string[];purpose:string}) => journal({kind:'ASSESSMENT_SOURCES_READ',sourceRefs:input.sourceRefs,purpose:input.purpose,observedAt:new Date().toISOString()})),
    recordWorkRead:jest.fn(async (input:{revision:JobAidWorkRevision}) => journal({kind:'ASSESSMENT_WORK_READ',
      workRevisionRef:input.revision.workRevisionRef,workRevision:input.revision.workRevision,saveRequestId:input.revision.requestId,observedAt:new Date().toISOString()})),
    recordAilyStage:jest.fn(async (input:{receipt:unknown}) => journal({kind:'AILY_STAGE_OVERALL',attemptId:row!.attemptId,
      receipt:input.receipt,observedAt:(input.receipt as {observedAt:string}).observedAt})),
    loadOwnedSourceBinding: jest.fn(async () => binding),
    withActorScope: jest.fn(async (_actor: string, operation: () => Promise<unknown>) => operation()),
    withActorTransaction: jest.fn(async (_actor: string, operation: (db: object) => Promise<unknown>) => operation({})),
  };
  const registrar = {getTenantScopedByWorkItemId: jest.fn(async () => workItem),
    compareAndSet:jest.fn<Promise<CanonicalWorkItemProjection>,[Parameters<MiaodaWorkItemRepository['compareAndSet']>[0]]>()};
  const authorization = {authorize: jest.fn(async () => ({action: 'EVALUATE_JOB_AID', allowed: true, permissionSnapshotVersion: 'permission-test'}))};
  const permissions = {freshRead: jest.fn(async () => ({permissionSnapshotVersion: 'permission-test'}))};
  const originalReader = {readDocumentOriginal: jest.fn(async () => ({original, structuredSource: original.source,
    run: {...original.binding, manifestArtifact: {relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'b'.repeat(64), byteLength: 100}}}))};
  const jobAid = new CanonicalJobAidProblemService(registrar as never, artifacts as never, {} as never,
    authorization as never, permissions as never, attempts, {loadTenantScopedProjection: async () => ({
      row: {requestedByUserId: actor.userId, initialAilySessionId, documentVersionId: workItem.source.documentVersionId}, projection: workItem})} as never,
    {hasActiveOfficialActorMapping: async () => true} as never,
    {buildForWorkItemWithEvidence: async () => ({common: projectCommonAssessmentContext(workItem,
      {context: {status: 'UNAVAILABLE', reason: 'SYNTHETIC_TEST'}, documentReadingStatus: 'AVAILABLE', items: [], sections: [], resourceRefs: []}, []),
      availableReadingEvidence: []})} as never, work as never, undefined, originalReader as never, {read: async () => null} as never);
  const admission = new AilyTaskAdmissionService(config);
  const client = {configured: true, serialize: serializeAilyChatRequest,
    create: jest.fn(async (_request: {message: string; expectedRequestBody: string}) => {order.push('POST'); return {chatId: '9'.repeat(64), remoteSessionId: 'original-remote-session'};}),
    read: jest.fn(async (_request: {agentId: string; accessToken: string; chatId: string; remoteSessionId?: string}) =>
      ({chatId: '9'.repeat(64), answer: 'private result', remoteStatus: 'UnverifiedStatus'}))};
  const grantLimit = jest.fn(async () => [{sealed: 'synthetic-sealed-grant', tokenHash: 'synthetic-hash', mappingId: 'synthetic-mapping'}]);
  const owner = {tenantId:actor.tenantId,workItemId:workItem.workItemId,requestedByUserId:actor.userId,requestId:workItem.requestId,
    ...workItem.source,sourceFileSha256:workItem.source.sourceFileSha256};
  const outer:typeof autoWorkItemAuthorization.$inferSelect = {tenantId:actor.tenantId,workItemId:workItem.workItemId,actorUserId:actor.userId,requestId:workItem.requestId,
    ...workItem.source,sourceFileSha256:workItem.source.sourceFileSha256,grantKind:'MIAODA_CANONICAL_PARSE_REQUEST',
    status:'LEASED',leaseOwner:config.principalId,leaseToken:'synthetic-outer-token',leaseGeneration:1,leaseExpiresAt:new Date('2099-01-01'),
    completedAt:null,completedLeaseGeneration:null,completedLeaseTokenHash:null,blockedAt:null,blockedCode:null,
    blockedLeaseGeneration:null,blockedLeaseTokenHash:null,createdAt:new Date(),updatedAt:new Date()};
  let authorized = true;
  const dialect=new PgDialect();const sqlStatements:Array<{sql:string;params:unknown[]}>=[];
  const grantDatabase = {transaction:jest.fn(),execute:jest.fn(async(statement:SQL) => {
    const query=dialect.sqlToQuery(statement);
    if(query.sql.includes('latest.assessment_work_revision_id'))return [{workRevisionRef:saved[0]?.workRevisionRef,
      documentVersionId:workItem.source.documentVersionId}];
    return [{allowed:authorized}];
  }),select: () => ({from: (table:unknown) => {
    let joined=false;
    const values=async():Promise<unknown[]>=>joined?grantLimit():table===workItemTable?[{...owner,revision:workItem.revision,
      packageId:workItem.package?.packageId,projectionJson:canonicalJson(workItem)}]:table===autoWorkItemAuthorization?[outer]:
      table===attemptTable&&row?[{...row,automaticLease:canonicalJson(parseTaskEnvelope(row.taskEnvelopeJson).modelInput.automaticWorkItemLease)}]:[];
    const query={where:()=>query,limit:()=>query,orderBy:()=>query,innerJoin:()=>{joined=true;return query;},for:async()=>values(),
      then:<T>(resolve:(result:unknown[])=>T)=>values().then(resolve)};
    return query;
  }}),update:(table:unknown)=>({set:(changes:Record<string,unknown>)=>({where:(condition:SQL)=>({returning:async()=>{
    const query=dialect.sqlToQuery(condition);sqlStatements.push(query);
    if(!authorized)return [];
    if(table===workItemTable) {
      if(query.params[1]!==workItem.revision)return [];
      const next=JSON.parse(dialect.sqlToQuery(changes.projectionJson as SQL).params[0] as string) as CanonicalWorkItemProjection;
      Object.assign(workItem,next);return [{workItemId:workItem.workItemId}];
    }
    if(!row||row.cancelRequestedAt)return [];
    if(changes.status==='COMMITTING') {
      const expected=query.params.find(value=>typeof value==='string'&&value.includes('"candidateRef"')&&value.includes('"phase":"READ"'));
      if(typeof expected!=='string'||row.status!=='RUNNING'||canonicalJson(run?.pending)!==expected||
          run?.pending?.workRevisionRef!==saved[0]?.workRevisionRef)return [];
      const {leaseExpiresAt:_expression,...persisted}=changes;
      row={...row,...persisted} as ActionAttemptRow;
    } else {
      if(changes.status==='SUCCEEDED'&&row.status!=='COMMITTING')return [];
      row={...row,...changes} as ActionAttemptRow;
    }
    return [row];
  }})})})};
  grantDatabase.transaction.mockImplementation(async(operation:(db:typeof grantDatabase)=>Promise<unknown>)=>operation(grantDatabase));
  const actualAttempts=new ActionAttemptRepository(grantDatabase as never);
  repository.markCommitting.mockImplementation(input=>actualAttempts.markCommitting(input));
  repository.finishTerminal.mockImplementation(input=>actualAttempts.finishTerminal(input));
  const actualRegistrar=new MiaodaCanonicalWorkItemRegistrarAdapter(new MiaodaWorkItemRepository(grantDatabase as never));
  registrar.compareAndSet.mockImplementation(input=>actualRegistrar.compareAndSet(input));
  const actors = {assertHostedServiceRole:jest.fn(async()=>undefined),withActorScope:jest.fn(async (_actor:string,operation:()=>Promise<unknown>)=>operation()),
    withActorTransaction: jest.fn(async (_actor: string, operation: (input: {database: typeof grantDatabase}) => Promise<unknown>) => operation({database: grantDatabase}))};
  const dispatch = {claimAilyWorkItem:jest.fn(async () => ({...outer,leaseExpiresAt:outer.leaseExpiresAt.toISOString()})),
    acknowledgeAilyWorkItem:jest.fn(),authorizeAilyInitialSuccessor:jest.fn(async(_input:unknown)=>({status:'UNCHANGED',leaseGeneration:outer.leaseGeneration}))};
  const execution = new AilyTaskExecutionService(admission, jobAid, attempts, repository as never, actors as never, client,
    authenticationMode==='HOST_SERVICE'?{resolve:async input=>({...input,status:'READY' as const,transport:'APPLICATION' as const,
      identityRef:'synthetic-application-caller',callerAppId:'cli_synthetic',accessToken:'synthetic-only-tat'})}
      :UNAVAILABLE_AILY_HOST_INVOCATION_IDENTITY,dispatch as never);
  const sourceAuthorization={authorizeSourceRead:jest.fn(async(input:{tenantId:string;actorUserId:string;documentId:string;
    documentVersionId:string;sourceArtifactId:string;sourceFileSha256:string;sourceByteLength:number},_database?:unknown)=>({
      ...input,allowed:authorized,action:'DOCUMENT_READ',authorizationPolicy:'MIAODA_HOST_DOCUMENT_READ'}))};
  const identity = new AilyMcpIdentityService({resolveSubjectMapping:async () => ({id:'synthetic-mapping',revision:1,
    miaodaUserId:actor.userId,miaodaTenantId:actor.tenantId})} as never,authenticationMode==='HOST_SERVICE'?{authenticationMode,enabled:true,agentId:config.agentId,
    expectedClientId:'cli_synthetic',tenantId:config.tenantId,principalId:config.principalId}:{enabled:true,agentId:config.agentId,
    expectedClientId:'synthetic-host-app',signingSecret:'synthetic-test-secret',subjectNamespace:'FEISHU_OPEN_ID',tenantNamespace:'FEISHU_TENANT_KEY'});
  const domain = new AilyTaskDomainService(identity,actors as never,repository as never,work as never,jobAid,admission,registrar as never,dispatch as never,sourceAuthorization as never);
  const mcp = new CanonicalHostAilyMcpService(identity,domain);
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({exp:4102444800,agent_id:config.agentId,user_id:'synthetic-open-id',tenant_id:'synthetic-tenant-key'})).toString('base64url');
  const jwt = `${header}.${payload}.${createHmac('sha256','synthetic-test-secret').update(`${header}.${payload}`).digest('base64url')}`;
  const stage = (status: string) => ({status, attemptRef: null, attemptStatus: null, terminalCode: null});
  const initial = {hasExactAutoProcessingGrant: jest.fn(async () => true), cancelledContinuationBinding: jest.fn(async () => null),
    project: jest.fn(async () => ({status: 'FAILED', stages: {translation: stage('FAILED'), applicability: stage('WAITING_INPUT'),
      jobAid: stage('FAILED'), overall: stage('PENDING')}} as AilyInitialAnalysisStatus))};
  const session = {actor: {canonicalSubject: {id: actor.userId}, tenantId: actor.tenantId, applicationScopeId: actor.appId}, session: {id: sessionId}} as ResolvedSession;
  const httpRequest={headers:{},method:'POST',path:'/synthetic/initial-analysis/continue'} as unknown as Request;
  const sessions = {withVerifiedReviewServiceSql: jest.fn(async (operation: () => Promise<unknown>) => operation()),
    nativeBrowserIdentity:jest.fn((request:Request)=>request===httpRequest&&authorized?session:null)};
  const continuation = new CanonicalInitialAnalysisContinuationService(authorization as never, permissions as never,
    registrar as never, attempts, initial as never, {} as never, jobAid, sessions as never, undefined, sourceAuthorization as never, admission, execution,dispatch as never);
  const command = {requestId, expectedRevision: 5, operation: 'EVALUATE_JOBAID' as const, executionMode: 'AILY_AGENT_V1' as const, modelRef: 'aily/deepseek-v4-pro'};
  return {repository, attempts, jobAid, execution, client, grantLimit, actors, initial, config, session, command, authorization, permissions,
    original, previous, capture, order, work, artifacts, saved, commands, domain, identity, mcp, jwt, outer, dispatch,sqlStatements,registrar,
    continuation,sessions,httpRequest,sourceAuthorization,
    revoke:()=>{authorized=false;},row: () => row!, run: () => run!, setRow: (value: ActionAttemptRow) => {row = value;},
    setRun: (value: AilyExecutorRun) => {run = value;}, workItem, admission,
    send: (payload=command) => continuation.request(workItem.workItemId, payload, actor, session,httpRequest)};
}

/** Production provider definitions and real native/session/command/executor classes;
 * only SQL/artifact ports and fetch are synthetic. No application is bootstrapped.
 */
async function nativeCommandComposition(entry:'static'|'forRoot',mode:'READY'|'MCP_ONLY'='READY') {
  const h=harness('HOST_SERVICE',null);
  const state=syntheticAilyHostServiceConfiguration();state.configuration.task=h.config;
  state.configuration.background={enabled:false,allowOriginalRequest:false};
  process.env.SANDBOX_ID='synthetic-hosted-process';delete process.env.MIAODA_LOCAL_DEV;
  process.env.FEISHU_OAUTH_CLIENT_ID=state.configuration.caller.appId;
  process.env.FEISHU_OAUTH_CLIENT_SECRET='synthetic-application-secret';
  process.env.WL_AILY_ENTERPRISE_CONFIGURATION_JSON=JSON.stringify({
    schemaVersion:'wiselink.aily-enterprise-configuration.v1',enabled:true,...state.configuration,
    ...(mode==='MCP_ONLY'?{caller:undefined,task:{enabled:false}}:{}),
  });
  const counts={token:0,create:0,get:0};let postUnknown=false;
  const http=jest.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
    if(String(url)==='https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal') {
      counts.token++;expect(init?.method).toBe('POST');
      return Response.json({code:0,tenant_access_token:'synthetic-application-token',expire:7200});
    }
    expect(String(url)).toMatch(/^https:\/\/open[.]feishu[.]cn\/open-apis\/aily\/v1\/agents\/agent_synthetic\/chats(?:\/3333333333333333333)?$/u);
    expect(init?.headers).toMatchObject({authorization:'Bearer synthetic-application-token'});
    if(init?.method==='POST') {
      counts.create++;expect(h.run().post.state).toBe('STARTED');expect(String(init.body)).toBe(h.run().post.requestBody);
      const body=JSON.parse(String(init.body));expect(body.stream).toBe(false);
      const message=JSON.parse(body.user_message.content[0].text);
      expect(message.taskContextRef).toBe(h.row().operationRef);
      if(postUnknown)throw new Error('SYNTHETIC_REPLY_LOST');
      return Response.json({code:0,data:{agent_chat_id:'3333333333333333333',session_id:'synthetic-remote'}});
    }
    expect(init?.method).toBe('GET');counts.get++;
    return Response.json({code:0,data:{agent_chat_id:'3333333333333333333',session_id:'synthetic-remote',status:'Running'}});
  });
  h.grantLimit.mockRejectedValue(new Error('USER_GRANT_MUST_NOT_BE_READ'));
  const workItems={loadAutoProcessingProjection:jest.fn(async()=>({projection:h.workItem,
    row:{requestedByUserId:actor.userId,revision:h.workItem.revision}}))};
  const sessionStore={validate:jest.fn(async()=>{throw new Error('NO_OAUTH_COOKIE_EXPECTED');})};
  const sqlScopes:Array<{userId:unknown;isSystemAccount:unknown}>=[];
  const sqlContext={use:jest.fn((input:Request,_response:unknown,next:()=>void)=>{
    sqlScopes.push({userId:input.userContext?.userId,isSystemAccount:input.userContext?.isSystemAccount});next();
  })};
  const oauth:OAuthConfigPort={clientId:null,redirectUri:null,tokenApiVersion:'v3',mappingBootstrap:{kind:'DISABLED'},
    configured:false,applicationScopeId:'app_17bzc551rsg',sessionEnvironment:'runtime'};
  const dynamic=CanonicalHostModule.forRoot();
  const declared:Provider[]=entry==='static'?Reflect.getMetadata('providers',CanonicalHostModule):dynamic.providers??[];
  const required:unknown[]=[CanonicalInitialAnalysisContinuationService,AilyTaskAdmissionService,AilyTaskExecutionService,
    AilyHostInvocationIdentityProvider,AILY_ENTERPRISE_CONFIGURATION,AILY_TASK_CONFIGURATION,AILY_TASK_CHAT_CLIENT,
    AILY_HOST_INVOCATION_IDENTITY];
  const token=(provider:Provider):unknown=>typeof provider==='function'?provider:provider.provide;
  const providers=declared.filter(provider=>required.includes(token(provider)));
  for(const expected of required)expect(providers.filter(provider=>token(provider)===expected)).toHaveLength(1);
  const controllers:unknown[]=entry==='static'?Reflect.getMetadata('controllers',CanonicalHostModule):dynamic.controllers??[];
  expect(controllers).toContain(CanonicalInitialAnalysisContinuationController);
  const module=await Test.createTestingModule({controllers:[CanonicalInitialAnalysisContinuationController],providers:[
    ...providers,SessionResolver,{provide:SessionStore,useValue:sessionStore},{provide:OAUTH_CONFIG,useValue:oauth},
    {provide:SqlExecutionContextMiddleware,useValue:sqlContext},
    {provide:CANONICAL_AUTHORIZATION,useValue:h.authorization},{provide:CANONICAL_PERMISSION_SNAPSHOT,useValue:h.permissions},
    {provide:CANONICAL_WORK_ITEM_REGISTRAR,useValue:h.registrar},{provide:ActionAttemptLifecycleService,useValue:h.attempts},
    {provide:ActionAttemptRepository,useValue:h.repository},{provide:CanonicalHostInitialAnalysisStatusService,useValue:h.initial},
    {provide:CanonicalHostOpenClawTranslationService,useValue:{}},{provide:CanonicalJobAidProblemService,useValue:h.jobAid},
    {provide:EngineeringMatterWorkingRepository,useValue:h.actors},{provide:MiaodaWorkItemRepository,useValue:workItems},
    {provide:AutomaticWorkItemDispatchService,useValue:h.dispatch},
    {provide:AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION,useValue:h.sourceAuthorization},
  ]}).compile();
  const configured=module.get<AilyEnterpriseConfigurationState>(AILY_ENTERPRISE_CONFIGURATION);
  expect(configured.status).toBe(mode);
  if(configured.status==='READY')expect(configured.configuration.background).toEqual({enabled:false,allowOriginalRequest:false});
  const request=Object.assign(h.httpRequest,{userContext:{userId:actor.userId,tenantId:actor.tenantId,
    appId:actor.appId,env:'runtime',roles:[],isSystemAccount:false},headers:{},body:h.command});
  const sessions=module.get(SessionResolver);const native=jest.spyOn(sessions,'nativeBrowserIdentity');
  const controller=module.get(CanonicalInitialAnalysisContinuationController);
  const enqueue=jest.spyOn(h.jobAid,'enqueueContinuation');const reserve=jest.spyOn(h.attempts,'reserve');
  return {h,module,configured,controller,request,sessions,native,sessionStore,sqlScopes,http,counts,enqueue,reserve,
    invocation:module.get(AilyHostInvocationIdentityProvider),
    send:()=>controller.request(h.workItem.workItemId,h.command,request),setPostUnknown:()=>{postUnknown=true;}};
}

/** Actual reservation + successor/claim repositories; only the DB driver and
 * physical-source reader are synthetic. Existing C final fixtures stay intact. */
function legacySuccessor(h:ReturnType<typeof harness>) {
  h.work.listHeadersForRuntime.mockResolvedValue([]);h.work.listForRuntime.mockResolvedValue([]);
  Object.assign(h.outer,{leaseOwner:'service:legacy-synthetic',leaseGeneration:2,
    leaseToken:'00000000-0000-4000-8000-000000000802',leaseExpiresAt:new Date(Date.now()-60_000),
    completedAt:null,completedLeaseGeneration:null,completedLeaseTokenHash:null,blockedAt:null,blockedCode:null,
    blockedLeaseGeneration:null,blockedLeaseTokenHash:null,createdAt:new Date(Date.now()-7_200_000),updatedAt:new Date(Date.now()-3_600_000)});
  const fixture=ailyInitialSuccessorFixture({workItem:h.workItem,actorUserId:actor.userId,
    getQueued:()=>h.row(),storeQueued:row=>h.setRow(row),parseRunId:h.original.binding.parseRunId,
    principalId:h.config.principalId,grant:h.outer,
    stageRequestId:requestId,initialAilySessionId:sessionId});
  jest.spyOn(MiaodaDocumentVersionSourceResolver.prototype,'resolve').mockImplementation(async function(
    this:MiaodaDocumentVersionSourceResolver,documentVersionId,options) {
    expect(documentVersionId).toBe(h.workItem.source.documentVersionId);
    expect(options).toEqual({requireCurrent:true,expectedCreatorUserId:actor.userId});
    expect((this as unknown as {db:unknown}).db).toBe(fixture.database);
    return fixture.source.resolve() as never;
  });
  h.repository.nextAttemptNo.mockResolvedValue(3);
  const actual=new ActionAttemptRepository(fixture.database as never);
  Object.assign(h.repository,{reserve:jest.fn(async(...args:Parameters<ActionAttemptRepository['reserve']>)=>{
    h.order.push('reservation');return actual.reserve(...args);
  }),readByIdempotency:jest.fn(async(input:{idempotencyKey:string})=>h.row()?.idempotencyKey===input.idempotencyKey?h.row():null),
  readLatestByExactIdempotency:jest.fn(async(input:{idempotencyKey:string})=>h.row()?.idempotencyKey===input.idempotencyKey?h.row():null)});
  Object.assign(h.dispatch,{
    authorizeAilyInitialSuccessor:jest.fn(fixture.automatic.authorizeAilyInitialSuccessor.bind(fixture.automatic)),
    claimAilyWorkItem:jest.fn(fixture.automatic.claimAilyWorkItem.bind(fixture.automatic)),
  });
  return fixture;
}

function assessmentCandidate(sealed:ReturnType<typeof parseJobAidProblemTask>,sourceRef:string,label:string) {
  return {schemaVersion:JOBAID_PROBLEM_WORK_SCHEMA,headline:`合成完整候选 ${label}`,listBrief:'完整保留来源及阶段。',
    overview:'本轮合成解释保留版本边界。',roundCompletion:'COMPLETE',completionReason:'仅完成候选分析。',
    changeSummary:`以实际已读基线继续 ${label}。`,unchangedExplanation:'保留完整认识、证据与检查单映射。',
    issues:[{issueKey:'discussion',question:'方法如何表述？',body:`这里只讨论方法定义，未进行业务分级。 [[method:risk]] [[${sourceRef}]]`,
      methodUsage:[{methodRef:'method:risk',usage:'REFERENCE_ONLY',basisRefs:[]}],openQuestions:[]}],
    checklistResults:sealed.checklistBinding!.selection.map(selected=>({itemId:selected.itemId,
      itemApplicability:selected.mode==='INCLUDE'||selected.itemId==='ENG-METHOD-01'?'APPLICABLE':'NOT_APPLICABLE',
      outcome:'ANSWERED',resultRefs:[{issueKey:'discussion',fieldPath:'/body'}],basisRefs:[sourceRef]}))};
}

async function validateCandidate(h:ReturnType<typeof harness>,actor:AilyMcpVerifiedActor,label:string) {
  const message=JSON.parse(h.client.create.mock.calls[0][0].message);
  const sealed=parseJobAidProblemTask(parseTaskEnvelope(h.row().taskEnvelopeJson));
  const source=sealed.sourceCatalog.find(item=>item.kind==='DOCUMENT_PASSAGE')!;
  await h.domain.sources(actor,{taskContextRef:message.taskContextRef,sourceRefs:[source.evidenceRef],purpose:'核对合成原文',context:'EXACT'});
  const validation=await h.domain.validate(actor,{taskContextRef:message.taskContextRef,
    workJson:JSON.stringify(assessmentCandidate(sealed,source.evidenceRef,label))});
  if(validation.status!=='VALID'||!('candidateRef'in validation))throw new Error('SYNTHETIC_VALIDATION_REQUIRED');
  return {taskContextRef:message.taskContextRef,candidateRef:validation.candidateRef};
}

async function saveRead(h:ReturnType<typeof harness>,actor:AilyMcpVerifiedActor,candidate:Awaited<ReturnType<typeof validateCandidate>>) {
  const receipt=await h.domain.save(actor,candidate);
  const read=await h.domain.read(actor,{taskContextRef:candidate.taskContextRef,saveRequestId:receipt.saveRequestId});
  if(!read.revision)throw new Error('SYNTHETIC_READ_REQUIRED');
  return read.revision;
}

describe('normal enterprise task consumer', () => {
  const env = {...process.env};
  beforeEach(() => {
    process.env.WL_JOBAID_PROBLEM_V2_ENABLED = '1';
    jest.spyOn(grantCodec, 'openAilyUserGrant').mockReturnValue('synthetic-user-token');
  });
  afterEach(() => {process.env = {...env}; jest.restoreAllMocks();});

  it.each(['static','forRoot'] as const)('assembles the actual %s native command without OAuth or background and sends once',async entry=>{
    const f=await nativeCommandComposition(entry);
    try {
      expect(await f.send()).toMatchObject({requestId,replayed:false,ailyDispatch:{dispatchStatus:'ACCEPTED'}});
      expect(f.native.mock.results.some(result=>result.type==='return'&&result.value.oauthSession===null)).toBe(true);
      expect(await f.sessions.resolve(f.request)).toBeNull();expect(f.sessionStore.validate).not.toHaveBeenCalled();
      expect(f.enqueue.mock.calls[0][5]).toBeUndefined();
      expect(f.reserve.mock.calls[0][0].initialKnowledgeSession).toEqual({expectedSessionId:null});
      expect(f.h.run()).toMatchObject({hostSessionId:null,invocation:{purpose:'BROWSER',callerAppId:'cli_synthetic',
        identityRef:'synthetic-approved-caller'},post:{state:'ACCEPTED'}});
      expect(f.h.dispatch.claimAilyWorkItem).toHaveBeenCalledTimes(1);expect(f.counts).toEqual({token:1,create:1,get:0});
      expect(f.sqlScopes).toEqual(expect.arrayContaining([{userId:actor.userId,isSystemAccount:false},
        {userId:actor.userId,isSystemAccount:true}]));
      const sealed=f.h.row().taskEnvelopeJson;const persisted=canonicalJson(f.h.run());
      expect(await f.send()).toMatchObject({requestId,replayed:true,ailyDispatch:{dispatchStatus:'ACCEPTED'}});
      expect(f.counts).toEqual({token:1,create:1,get:1});expect(f.h.row().taskEnvelopeJson).toBe(sealed);
      expect(canonicalJson(f.h.run())).toBe(persisted);expect(f.h.grantLimit).not.toHaveBeenCalled();
    } finally {await f.module.close();}
  });

  it('keeps actual MCP-only composition closed before reservation, claim or transport',async()=>{
    const f=await nativeCommandComposition('forRoot','MCP_ONLY');
    try {
      await expect(f.send()).rejects.toThrow('INITIAL_CONTINUATION_AILY_NOT_CONFIGURED');
      expect(f.h.repository.reserve).not.toHaveBeenCalled();expect(f.h.dispatch.claimAilyWorkItem).not.toHaveBeenCalled();
      expect(f.h.run()).toBeNull();expect(f.http).not.toHaveBeenCalled();
    } finally {await f.module.close();}
  });

  it('rejects a native actor change after the status read before any queue or application transport',async()=>{
    const f=await nativeCommandComposition('forRoot');
    try {
      const project=f.h.initial.project.getMockImplementation()!;
      f.h.initial.project.mockImplementationOnce(async()=>{
        Object.assign(f.request.userContext,{userId:'other-synthetic-owner'});return project();
      });
      await expect(f.send()).rejects.toThrow('DIALOGUE_BROWSER_IDENTITY_MISMATCH');
      expect(f.h.repository.reserve).not.toHaveBeenCalled();expect(f.h.dispatch.claimAilyWorkItem).not.toHaveBeenCalled();
      expect(f.h.run()).toBeNull();expect(f.http).not.toHaveBeenCalled();
    } finally {await f.module.close();}
  });

  it('requires the formal application identity for a native command with no OAuth and reads no user grant',async()=>{
    const f=await nativeCommandComposition('forRoot');
    try {
      delete process.env.FEISHU_OAUTH_CLIENT_SECRET;
      await expect(f.send()).rejects.toThrow('AILY_APPLICATION_CALLER_NOT_CONFIGURED');
      expect(f.h.repository.reserve).not.toHaveBeenCalled();expect(f.h.dispatch.claimAilyWorkItem).not.toHaveBeenCalled();
      expect(f.h.grantLimit).not.toHaveBeenCalled();expect(f.h.run()).toBeNull();expect(f.http).not.toHaveBeenCalled();
    } finally {await f.module.close();}
  });

  it('does not accept a READY caller without application provenance for a native null-session command',async()=>{
    const f=await nativeCommandComposition('forRoot');
    try {
      jest.spyOn(f.invocation,'resolve').mockImplementation(async input=>({...input,status:'READY',
        identityRef:'synthetic-approved-caller',accessToken:'synthetic-only-token'}));
      await expect(f.send()).rejects.toThrow('AILY_INVOCATION_IDENTITY_BINDING_CHANGED');
      expect(f.h.repository.reserve).not.toHaveBeenCalled();expect(f.h.dispatch.claimAilyWorkItem).not.toHaveBeenCalled();
      expect(f.h.grantLimit).not.toHaveBeenCalled();expect(f.http).not.toHaveBeenCalled();
    } finally {await f.module.close();}
  });

  it('rejects a changed application caller on the original native request without GET or another POST',async()=>{
    const f=await nativeCommandComposition('forRoot');
    try {
      await f.send();const original=canonicalJson(f.h.run());
      jest.spyOn(f.invocation,'resolve').mockImplementation(async input=>({...input,status:'READY',transport:'APPLICATION',
        identityRef:'other-synthetic-caller',callerAppId:'cli_other_synthetic',accessToken:'synthetic-only-token'}));
      await expect(f.send()).rejects.toThrow('AILY_INVOCATION_CALLER_CHANGED');
      expect(f.counts).toEqual({token:1,create:1,get:0});expect(canonicalJson(f.h.run())).toBe(original);
      expect(f.h.grantLimit).not.toHaveBeenCalled();
    } finally {await f.module.close();}
  });

  it('keeps the original native UNKNOWN post and UUID without a second create or new claim',async()=>{
    const f=await nativeCommandComposition('forRoot');
    try {
      f.setPostUnknown();
      expect(await f.send()).toMatchObject({requestId,replayed:false,ailyDispatch:{dispatchStatus:'UNKNOWN'}});
      const original=canonicalJson(f.h.run());const sealed=f.h.row().taskEnvelopeJson;
      expect(await f.send()).toMatchObject({requestId,replayed:true,ailyDispatch:{dispatchStatus:'UNKNOWN'}});
      expect(f.counts).toEqual({token:1,create:1,get:0});expect(canonicalJson(f.h.run())).toBe(original);
      expect(f.h.row().taskEnvelopeJson).toBe(sealed);expect(f.h.dispatch.claimAilyWorkItem).toHaveBeenCalledTimes(1);
      expect(f.h.repository.claimExact).toHaveBeenCalledTimes(1);expect(f.h.grantLimit).not.toHaveBeenCalled();
    } finally {await f.module.close();}
  });

  it('uses the normal UUID reservation, explicit owner authorization, actual g2→g3 claim and one POST',async()=>{
    const h=harness();const f=legacySuccessor(h);const history=canonicalJson(f.history);
    expect(await h.send()).toMatchObject({requestId,replayed:false,ailyDispatch:{dispatchStatus:'ACCEPTED'}});
    expect(h.order.indexOf('reservation')).toBeLessThan(h.order.indexOf('claim'));
    expect(f.locks).toEqual(expect.arrayContaining(['WI','GRANT','ATTEMPT']));
    expect(f.statements.some(value=>value.kind==='INSERT')).toBe(true);
    expect(f.statements.some(value=>value.kind==='UPDATE'&&value.sql.includes('executor_run_json IS NULL'))).toBe(true);
    expect(f.changesApplied).toHaveLength(1);expect(f.grant.leaseGeneration).toBe(3);
    expect(f.grant.leaseOwner).toBe(h.config.principalId);expect(f.grant.leaseToken).not.toBe('00000000-0000-4000-8000-000000000802');
    expect(canonicalJson(f.history)).toBe(history);expect(h.row().status).toBe('RUNNING');
    expect(parseJobAidProblemTask(parseTaskEnvelope(h.row().taskEnvelopeJson)).automaticWorkItemLease)
      .toEqual({requestId:h.workItem.requestId,leaseGeneration:3});
    expect(h.sourceAuthorization.authorizeSourceRead.mock.calls.some(call=>call[1]===f.database)).toBe(true);
    expect(h.client.create).toHaveBeenCalledTimes(1);
    expect(h.client.create.mock.calls[0][0].message).not.toContain(f.grant.leaseToken!);
    const sealed=canonicalJson(parseTaskEnvelope(h.row().taskEnvelopeJson));
    await h.send();
    expect(h.client.create).toHaveBeenCalledTimes(1);expect(h.client.read).toHaveBeenCalledTimes(1);
    expect(f.changesApplied).toHaveLength(1);expect(f.grant.leaseGeneration).toBe(3);
    expect(canonicalJson(parseTaskEnvelope(h.row().taskEnvelopeJson))).toBe(sealed);
  });

  it('recovers the same queued UUID after authorization committed but before claim/POST without a new generation',async()=>{
    const h=harness();const f=legacySuccessor(h);
    jest.spyOn(h.execution,'execute').mockRejectedValueOnce(new Error('SYNTHETIC_LOST_BEFORE_EXECUTE'));
    await expect(h.send()).rejects.toThrow('SYNTHETIC_LOST_BEFORE_EXECUTE');
    expect(h.row().status).toBe('QUEUED');expect(h.client.create).not.toHaveBeenCalled();
    expect(f.grant.leaseGeneration).toBe(3);const token=f.grant.leaseToken;
    expect(await h.send()).toMatchObject({requestId,replayed:true,ailyDispatch:{dispatchStatus:'ACCEPTED'}});
    expect(f.grant.leaseGeneration).toBe(3);expect(f.grant.leaseToken).toBe(token);
    expect(f.changesApplied).toHaveLength(1);expect(h.client.create).toHaveBeenCalledTimes(1);
  });

  it('keeps concurrent same-UUID sends on one reservation, generation and POST',async()=>{
    const h=harness();const f=legacySuccessor(h);
    const results=await Promise.allSettled([h.send(),h.send()]);
    expect(results.some(result=>result.status==='fulfilled')).toBe(true);
    expect(f.statements.filter(value=>value.kind==='INSERT')).toHaveLength(1);
    expect(f.changesApplied).toHaveLength(1);expect(f.grant.leaseGeneration).toBe(3);
    expect(h.client.create).toHaveBeenCalledTimes(1);
    const attempt=h.row().attemptId;
    await h.send();expect(h.row().attemptId).toBe(attempt);expect(h.client.create).toHaveBeenCalledTimes(1);
  });

  it('does not let a concurrent different UUID replace the active successor intent',async()=>{
    const h=harness();const f=legacySuccessor(h);let entered!:()=>void;let release!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
    const create=h.client.create.getMockImplementation()!;
    h.client.create.mockImplementationOnce(async input=>{entered();await gate;return create(input);});
    const first=h.send();await started;
    try {
      await expect(h.send({...h.command,requestId:'00000000-0000-4000-8000-000000000902'})).rejects.toThrow();
      expect(h.row().idempotencyKey).toContain(requestId);
      expect(f.statements.filter(value=>value.kind==='INSERT')).toHaveLength(1);
      expect(f.grant.leaseGeneration).toBe(3);expect(f.changesApplied).toHaveLength(1);
    } finally {release();}
    await first;expect(h.client.create).toHaveBeenCalledTimes(1);
  });

  it('retains the queued UUID when authorization fails and resumes it through the original reservation',async()=>{
    const h=harness();const f=legacySuccessor(h);
    h.sourceAuthorization.authorizeSourceRead.mockRejectedValueOnce(new Error('SYNTHETIC_AUTHORIZATION_INTERRUPTED'));
    await expect(h.send()).rejects.toThrow('SYNTHETIC_AUTHORIZATION_INTERRUPTED');
    const queuedId=h.row().attemptId;
    expect(h.row().status).toBe('QUEUED');expect(f.grant.leaseGeneration).toBe(2);
    expect(f.changesApplied).toHaveLength(0);expect(h.client.create).not.toHaveBeenCalled();
    expect(await h.send()).toMatchObject({requestId,replayed:true,ailyDispatch:{dispatchStatus:'ACCEPTED'}});
    expect(h.row().attemptId).toBe(queuedId);expect(f.grant.leaseGeneration).toBe(3);
    expect(h.client.create).toHaveBeenCalledTimes(1);
  });

  it('keeps the newly authorized original POST UNKNOWN without another generation or POST when no chat was received',async()=>{
    const h=harness();const f=legacySuccessor(h);
    h.client.create.mockRejectedValueOnce(new Error('SYNTHETIC_POST_RESPONSE_UNKNOWN'));
    expect(await h.send()).toMatchObject({requestId,ailyDispatch:{dispatchStatus:'UNKNOWN'}});
    const attempt=h.row().attemptId;const token=f.grant.leaseToken;
    expect(await h.send()).toMatchObject({requestId,replayed:true,ailyDispatch:{dispatchStatus:'UNKNOWN'}});
    expect(h.row().attemptId).toBe(attempt);expect(f.grant.leaseGeneration).toBe(3);expect(f.grant.leaseToken).toBe(token);
    expect(f.changesApplied).toHaveLength(1);expect(h.client.create).toHaveBeenCalledTimes(1);expect(h.client.read).not.toHaveBeenCalled();
  });

  it.each(['V2_DISABLED','APPLICABILITY_PENDING','BROWSER_IDENTITY_REVOKED'] as const)(
    'does not authorize an expired legacy grant when %s',async reason=>{
      const h=harness();const f=legacySuccessor(h);
      if(reason==='V2_DISABLED')process.env.WL_JOBAID_PROBLEM_V2_ENABLED='0';
      if(reason==='APPLICABILITY_PENDING') {
        const progress=await h.initial.project();progress.stages.applicability.status='PENDING';
        h.initial.project.mockResolvedValue(progress);
      }
      if(reason==='BROWSER_IDENTITY_REVOKED')h.sessions.nativeBrowserIdentity.mockReturnValue(null);
      await expect(h.send()).rejects.toThrow();
      expect(f.grant.leaseGeneration).toBe(2);expect(f.changesApplied).toHaveLength(0);
      expect(h.repository.claimExact).not.toHaveBeenCalled();expect(h.client.create).not.toHaveBeenCalled();
    });

  it.each([false,true])('checks the identity before claiming an existing QUEUED/no-run request (available=%s)',async available=>{
    const h=harness();const selected=h.admission.require(actor.tenantId,h.workItem,h.command.modelRef);
    await h.jobAid.enqueueContinuation(h.workItem,actor.tenantId,'permission-test',requestId,'INITIAL_PROBLEM_ASSESSMENT',
      undefined,undefined,undefined,{...selected,executionMode:'AILY_AGENT_V1',modelRef:selected.model.modelRef,actorUserId:actor.userId});
    expect(h.row().status).toBe('QUEUED');expect(h.run()).toBeNull();const original=canonicalJson(h.row());
    const begin=jest.spyOn(h.jobAid,'beginAily');
    const resolve=jest.fn(async()=>available ? {status:'READY' as const,transport:'APPLICATION' as const,
      identityRef:'synthetic-caller',callerAppId:'cli_synthetic',accessToken:'synthetic-app-tat',tenantId:actor.tenantId,
      actorUserId:actor.userId,workItemId:h.workItem.workItemId,principalId:h.config.principalId,agentId:h.config.agentId}
      : {status:'UNAVAILABLE' as const,transport:'APPLICATION' as const,reason:'AILY_APPLICATION_IDENTITY_UNAVAILABLE' as const});
    Object.assign(h.execution,{invocation:{resolve}});h.grantLimit.mockRejectedValue(new Error('NO_BROWSER_GRANT_FALLBACK'));
    if(!available) {
      await expect(h.send()).rejects.toThrow('AILY_APPLICATION_IDENTITY_UNAVAILABLE');
      expect(h.dispatch.claimAilyWorkItem).not.toHaveBeenCalled();expect(begin).not.toHaveBeenCalled();
      expect(h.repository.claimExact).not.toHaveBeenCalled();expect(h.repository.prepareInitialRequestInput).not.toHaveBeenCalled();
      expect(h.repository.compareAndSetAilyExecutorRun).not.toHaveBeenCalled();
      expect(h.client.create).not.toHaveBeenCalled();expect(h.client.read).not.toHaveBeenCalled();
      expect(h.run()).toBeNull();expect(canonicalJson(h.row())).toBe(original);expect(h.row().status).toBe('QUEUED');
      expect(resolve).toHaveBeenCalledTimes(1);
    } else {
      expect(await h.send()).toMatchObject({replayed:true,ailyDispatch:{dispatchStatus:'ACCEPTED'}});
      expect(h.dispatch.claimAilyWorkItem).toHaveBeenCalledTimes(1);expect(begin).toHaveBeenCalledTimes(1);
      expect(h.repository.claimExact).toHaveBeenCalledTimes(1);expect(h.client.create).toHaveBeenCalledTimes(1);
      expect(h.row().status).toBe('RUNNING');expect(h.run().post.state).toBe('ACCEPTED');
      expect(resolve).toHaveBeenCalledTimes(3);
    }
    expect(h.grantLimit).not.toHaveBeenCalled();
  });

  it('consumes actual automation through the original producer, formal H identity, one POST and a later exact GET', async () => {
    const h = harness(); h.config.authorizationFingerprint = 'permission-test';
    const state = syntheticAilyEnterpriseConfiguration(); state.configuration.task = h.config;
    process.env.FEISHU_OAUTH_CLIENT_ID = state.configuration.caller.appId;
    process.env.FEISHU_OAUTH_CLIENT_SECRET = 'synthetic-application-secret';
    h.grantLimit.mockRejectedValue(new Error('BROWSER_GRANT_MUST_NOT_BE_READ'));
    const workItems = {loadAutoProcessingProjection: jest.fn(async () => ({projection: h.workItem,
      row: {requestedByUserId: actor.userId, revision: h.workItem.revision}})),
      loadActiveAutoProcessingLease: jest.fn(async () => ({authorization: h.outer}))};
    const provider = new AilyHostInvocationIdentityProvider(state, h.admission, h.actors as never, workItems as never);
    Object.assign(h.execution, {invocation: provider, client: AILY_TASK_CHAT_ADAPTER});
    const lifecycle = new AilyTaskLifecycleService(h.repository as never, h.attempts, h.admission, h.actors as never,
      workItems as never, AILY_TASK_CHAT_ADAPTER, provider);
    const initialProgress = await h.initial.project();
    h.initial.project.mockImplementation(async (): Promise<AilyInitialAnalysisStatus> => ({...initialProgress,
      status: h.row() ? 'BUSY' : 'REQUIRED', nextOperation: h.row() ? null : 'EVALUATE_JOBAID',
      stages: {...initialProgress.stages, jobAid: {status: h.row() ? 'BUSY' : 'PENDING',
        attemptRef: h.row()?.operationRef ?? null, attemptStatus: h.row()?.status ?? null, terminalCode: null,
        ...(h.row() ? {requestId: 'original-2'} : {})}}}));
    Object.assign(h.initial, {readAilyBackgroundRequest: jest.fn(async () => h.run() ? ({requestId: 'original-2',
      attemptRef: h.row().operationRef, modelRef: h.run().modelEvidence.selectedModelRef}) : undefined)});
    const background = new AilyBackgroundDispatchService(state, h.admission, h.actors as never, workItems as never,
      h.initial as never, h.repository as never, h.jobAid, h.work as never, h.execution, lifecycle, h.dispatch as never);
    const automation = new HierarchicalWikiAutomation({next: jest.fn()} as never, background);
    let postEntered!: () => void; let releasePost!: () => void;
    const entered = new Promise<void>(resolve => {postEntered = resolve;});
    const hold = new Promise<void>(resolve => {releasePost = resolve;});
    const http = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).endsWith('/tenant_access_token/internal'))
        return Response.json({code: 0, tenant_access_token: 'synthetic-application-token', expire: 7200});
      expect(init?.headers).toMatchObject({authorization: 'Bearer synthetic-application-token'});
      if (init?.method === 'POST') {
        postEntered();
        expect(h.run().post.state).toBe('STARTED'); expect(String(init.body)).toBe(h.run().post.requestBody);
        const body = JSON.parse(String(init.body)); const message = JSON.parse(body.user_message.content[0].text);
        expect(body.stream).toBe(false); expect(message.taskContextRef).toBe(h.row().operationRef);
        expect(message.modelInput.checklistBinding.selection).toHaveLength(8);
        expect(message.modelInput.checklistBinding.definitionContentHash).toBe(JOBAID_CHECKLIST_RC1_CONTENT_HASH);
        expect(message.modelInput.methodBinding).toEqual(JOBAID_METHOD_BINDING);
        expect(message.modelInput.programOriginal.units).toEqual(h.original.source.units);
        expect(String(init.body)).toContain('完整原文终点'); expect(String(init.body)).toContain(h.previous.content.understanding);
        expect(String(init.body)).not.toMatch(/synthetic-application-token|synthetic-application-secret/u);
        await hold;
        return Response.json({code: 0, data: {agent_chat_id: '123', session_id: 'original-remote'}});
      }
      expect(init?.method).toBe('GET'); expect(String(url).endsWith('/chats/123')).toBe(true);
      return Response.json({code: 0, data: {agent_chat_id: '123', session_id: 'original-remote', status: 'Completed',
        content: [{type: 'text', text: '完整内容'.repeat(20000)}]}});
    });
    const first = automation.tickAilyEngineering();
    await Promise.race([entered, first.then(() => {throw new Error('SYNTHETIC_POST_NOT_STARTED');})]);
    expect(await automation.tickAilyEngineering()).toMatchObject({status: 'TICK', result: {observation: null}});
    releasePost(); expect(await first).toMatchObject({status: 'DISPATCHED', requestId: 'original-2', result: {dispatchStatus: 'ACCEPTED'}});
    const sealed = h.row().taskEnvelopeJson; const originalRun = canonicalJson({...h.run(), observation: undefined});
    expect(h.run().hostSessionId).toBeNull(); expect(h.run().invocation?.callerAppId).toBe('cli_synthetic');
    h.config.modelOptions = [{modelRef: 'aily/glm-5.3', platformBuiltIn: true}]; h.config.publicationRef = 'new-glm-publication';
    state.configuration.caller.identityRef = 'same-caller-new-configuration-proof';
    expect(await automation.tickAilyEngineering()).toMatchObject({status: 'TICK', result: {observation: {remoteStatus: 'Completed'}, observationPersisted: true}});
    expect(h.row().taskEnvelopeJson).toBe(sealed); expect(canonicalJson({...h.run(), observation: undefined})).toBe(originalRun);
    expect(h.run().modelEvidence.selectedModelRef).toBe('aily/deepseek-v4-pro'); expect(h.row().status).toBe('RUNNING');
    expect(http.mock.calls.filter(([, init]) => init?.method === 'POST' && String(init.body).includes('user_message'))).toHaveLength(1);
    expect(http.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(1);
    expect(h.grantLimit).not.toHaveBeenCalled(); expect(h.repository.heartbeat).toHaveBeenCalledTimes(2);
  });

  it('does not fall back to a user grant after an explicitly selected application identity fails', async () => {
    const h = harness(); Object.assign(h.execution, {invocation: {resolve: async () => ({status: 'UNAVAILABLE',
      transport: 'APPLICATION', reason: 'AILY_APPLICATION_IDENTITY_UNAVAILABLE'})}});
    await expect(h.send()).rejects.toThrow('AILY_APPLICATION_IDENTITY_UNAVAILABLE');
    expect(h.grantLimit).not.toHaveBeenCalled(); expect(h.client.create).not.toHaveBeenCalled();
  });

  it.each(['VALIDATED','SAVE_STARTED','READ'] as const)('keeps finish A unfrozen while real B reaches %s, then completes B through commit and lifecycle',async phase=>{
    const h=harness();await h.send();const actor=await h.identity.verify(h.jwt);
    const a=await validateCandidate(h,actor,'A');const savedA=await saveRead(h,actor,a);
    await h.domain.stageOverall(actor,{taskContextRef:a.taskContextRef,workRevisionRef:savedA.workRevisionRef});
    const immutableTask=h.row().taskEnvelopeJson;
    let releaseA!:()=>void;let enteredA!:()=>void;
    const holdA=new Promise<void>(resolve=>{releaseA=resolve;});const waitA=new Promise<void>(resolve=>{enteredA=resolve;});
    const readArtifact=h.artifacts.readActualBytes.getMockImplementation()!;
    h.artifacts.readActualBytes.mockImplementationOnce(async artifact=>{const bytes=await readArtifact(artifact);enteredA();await holdA;return bytes;});
    const finishingA=h.domain.finish(actor,{taskContextRef:a.taskContextRef,workRevisionRef:savedA.workRevisionRef});await waitA;
    const b=await validateCandidate(h,actor,'B');
    let releaseB:()=>void=()=>undefined;let savingB:Promise<unknown>|undefined;
    if(phase==='SAVE_STARTED') {
      let enteredB!:()=>void;const waitB=new Promise<void>(resolve=>{enteredB=resolve;});const holdB=new Promise<void>(resolve=>{releaseB=resolve;});
      const cas=h.repository.compareAndSetAilyDomainRun.getMockImplementation()!;
      h.repository.compareAndSetAilyDomainRun.mockImplementationOnce(async input=>{const changed=await cas(input);enteredB();await holdB;return changed;});
      savingB=h.domain.save(actor,b);await waitB;
    } else if(phase==='READ')await saveRead(h,actor,b);
    expect(h.run().pending?.phase).toBe(phase);
    releaseA();await expect(finishingA).rejects.toThrow('ACTION_ATTEMPT_COMMIT_CUTOFF_LOST');
    expect(h.row().status).toBe('RUNNING');expect(h.row().resultEnvelopeJson).toBeNull();expect(h.row().resultContentHash).toBeNull();
    expect(h.workItem.revision).toBe(5);
    if(phase==='SAVE_STARTED') {releaseB();await savingB;await h.domain.read(actor,{taskContextRef:b.taskContextRef,saveRequestId:h.run().pending!.saveRequestId});}
    else if(phase==='VALIDATED')await saveRead(h,actor,b);
    const finalRef=h.run().pending!.workRevisionRef!;
    await h.domain.finish(actor,{taskContextRef:b.taskContextRef,workRevisionRef:finalRef});
    expect(h.row().status).toBe('SUCCEEDED');expect(h.row().projectionApplied).toBe(true);expect(h.workItem.revision).toBe(6);
    expect(JSON.parse(h.row().resultEnvelopeJson!).modelOutput).toBe(JSON.stringify({workRevisionRef:finalRef}));
    expect(h.repository.markCommitting).toHaveBeenCalledTimes(2);expect(h.repository.finishTerminal).toHaveBeenCalledTimes(1);
    expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
    expect(h.work.publishedOriginalBindingInTransaction).toHaveBeenCalledTimes(2);
    expect(h.row().taskEnvelopeJson).toBe(immutableTask);expect(h.client.create).toHaveBeenCalledTimes(1);
  });

  it('uses a formally bound application identity through the same real create consumer without a browser-grant read',async()=>{
    const h=harness();const resolve=jest.fn(async()=>({status:'READY',identityRef:'synthetic-app-sdk',accessToken:'synthetic-formal-token',
      transport:'APPLICATION' as const,callerAppId:'cli_synthetic',
      tenantId:actor.tenantId,actorUserId:actor.userId,workItemId:h.workItem.workItemId,principalId:h.config.principalId,agentId:h.config.agentId}));
    Object.assign(h.execution,{invocation:{resolve}});
    h.grantLimit.mockRejectedValue(new Error('BROWSER_GRANT_MUST_NOT_BE_READ'));
    await h.send();expect(h.client.create).toHaveBeenCalledWith(expect.objectContaining({accessToken:'synthetic-formal-token'}));
    expect(h.grantLimit).not.toHaveBeenCalled();expect(resolve).toHaveBeenCalledWith(expect.objectContaining({purpose:'BROWSER',workItemId:h.workItem.workItemId}));
    expect(h.client.create.mock.calls[0][0].message).not.toContain('synthetic-formal-token');
    expect(h.run().hostSessionId).toBe(sessionId);expect(h.run().invocation).toMatchObject({purpose:'BROWSER',callerAppId:'cli_synthetic'});
    const original=canonicalJson(h.run());await h.send();expect(canonicalJson(h.run())).toBe(original);
    resolve.mockResolvedValue({...(await resolve()),callerAppId:'cli_other'});
    await expect(h.send()).rejects.toThrow('AILY_INVOCATION_CALLER_CHANGED');
    expect(h.client.create).toHaveBeenCalledTimes(1);expect(h.client.read).toHaveBeenCalledTimes(1);
    expect(canonicalJson(h.run())).toBe(original);expect(h.grantLimit).not.toHaveBeenCalled();
    Object.assign(h.execution,{invocation:{resolve:async()=>({status:'UNAVAILABLE',reason:'AILY_INVOCATION_IDENTITY_UNAVAILABLE'})}});
    await expect(h.send()).rejects.toThrow('AILY_INVOCATION_IDENTITY_UNAVAILABLE');
    expect(h.grantLimit).not.toHaveBeenCalled();expect(h.client.read).toHaveBeenCalledTimes(1);
    expect(h.client.create).toHaveBeenCalledTimes(1);expect(canonicalJson(h.run())).toBe(original);
  });

  it('keeps a real old browser/UAT run on its original grant after current configuration selects application transport', async () => {
    const h = harness(); process.env.FEISHU_OAUTH_CLIENT_ID = 'cli_synthetic'; await h.send();
    expect(h.run().invocation).toBeUndefined(); const original = canonicalJson(h.run()); const sealed = h.row().taskEnvelopeJson;
    const state = syntheticAilyEnterpriseConfiguration(); state.configuration.task = h.config;
    process.env.FEISHU_OAUTH_CLIENT_SECRET = 'synthetic-application-secret';
    const workItems = {loadAutoProcessingProjection: async () => ({projection: h.workItem,
      row: {requestedByUserId: actor.userId, revision: h.workItem.revision}}),
      loadActiveAutoProcessingLease: jest.fn(async () => ({authorization: h.outer}))};
    const provider = new AilyHostInvocationIdentityProvider(state, h.admission, h.actors as never, workItems as never);
    const resolve = jest.spyOn(provider, 'resolve');
    Object.assign(h.execution, {invocation: provider});
    const http = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NEW_TAT_MUST_NOT_BE_REQUESTED'));
    await h.send();
    expect(h.client.read).toHaveBeenCalledWith({agentId: h.config.agentId, accessToken: 'synthetic-user-token',
      chatId: '9'.repeat(64), remoteSessionId: 'original-remote-session'});
    expect(resolve).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
    expect(h.run().invocation).toBeUndefined(); expect(canonicalJson(h.run())).toBe(original);
    expect(h.row().taskEnvelopeJson).toBe(sealed); expect(h.client.create).toHaveBeenCalledTimes(1);
    await expect(h.execution.execute({purpose:'BACKGROUND',identityRef:state.configuration.caller.identityRef,
      callerAppId:state.configuration.caller.appId,workItem:h.workItem,actor,requestId,row:h.row(),
      permissionSnapshotVersion:'permission-test',reauthorize:async()=>undefined})).rejects.toThrow('AILY_ORIGINAL_BROWSER_INVOCATION_REQUIRED');
    const lifecycle = new AilyTaskLifecycleService(h.repository as never, h.attempts, h.admission, h.actors as never,
      workItems as never, h.client, provider);
    expect(await lifecycle.tick(h.row().operationRef!)).toMatchObject({status:'UNAVAILABLE',reason:'AILY_ORIGINAL_BROWSER_INVOCATION_REQUIRED'});
    expect(h.client.read).toHaveBeenCalledTimes(1);expect(resolve).not.toHaveBeenCalled();
    expect(h.repository.heartbeat).not.toHaveBeenCalled();expect(workItems.loadActiveAutoProcessingLease).not.toHaveBeenCalled();
    h.grantLimit.mockResolvedValue([]);
    await expect(h.send()).rejects.toThrow('INITIAL_CONTINUATION_AILY_USER_GRANT_REQUIRED');
    expect(h.client.read).toHaveBeenCalledTimes(1); expect(http).not.toHaveBeenCalled();
    expect(h.client.create).toHaveBeenCalledTimes(1);expect(canonicalJson(h.run())).toBe(original);
  });

  it.each(['mapping','outer-owner','outer-expiry','cancel','committing','agent','source'])('keeps actual enterprise facade %s authorization failures outside semantic repair',async reason=>{
    const h=harness();await h.send();const verified=await h.identity.verify(h.jwt);
    if(reason==='mapping')h.revoke();if(reason==='outer-owner')h.outer.leaseOwner='service:other';
    if(reason==='outer-expiry')h.outer.leaseExpiresAt=new Date(0);
    if(reason==='cancel')h.setRow({...h.row(),cancelRequestedAt:new Date()});
    if(reason==='committing')h.setRow({...h.row(),status:'COMMITTING'});
    if(reason==='agent')h.config.agentId='agent_other';if(reason==='source')h.workItem.source.sourceFileSha256='b'.repeat(64);
    await expect(h.domain.validate(verified,{taskContextRef:h.row().operationRef,workJson:'{}'})).rejects.toThrow();
    expect(h.work.save).not.toHaveBeenCalled();expect(h.repository.compareAndSetAilyDomainRun).not.toHaveBeenCalled();
  });

  it.each(['AILY_USER_JWT','HOST_SERVICE'] as const)('uses the actual safe POST selector for %s MCP SAVE, independent READ and stage Overall before create returns', async authenticationMode => {
    const h = harness(authenticationMode);
    type Tool = {definition:{inputSchema:{parse(value:unknown):unknown}}; call:(input:never)=>Promise<{isError?:boolean;content:Array<{text:string}>}>};
    const tools = new Map<string,Tool>();
    const register = jest.spyOn(McpServer.prototype,'registerTool').mockImplementation(function(name,definition,call) {
      tools.set(name,{definition:definition as never,call:call as never});
      return {remove:jest.fn(),enable:jest.fn(),disable:jest.fn(),update:jest.fn()} as never;
    });
    let stageRef = '';
    let toolFailure:unknown;
    h.client.create.mockImplementationOnce(async request => {
      try {
      expect(h.run().post.state).toBe('STARTED');
      expect(h.order).toContain('STARTED');
      const message = JSON.parse(request.message);
      expect(message.taskContextRef).toBe(h.row().operationRef);
      expect(JSON.parse(request.expectedRequestBody).user_message.content).toEqual([{type:'text',text:request.message}]);
      expect(message.modelInput).toEqual(parseJobAidProblemTask(parseTaskEnvelope(h.row().taskEnvelopeJson)).modelInput);
      expect(message).not.toHaveProperty('task');
      expect(request.message).not.toContain(leaseToken);
      (h.mcp as unknown as {server(jwt:unknown):McpServer}).server(h.jwt);
      const call = async (name:string,args:object) => {
        const tool = tools.get(name)!;
        const input = tool.definition.inputSchema.parse({taskContextRef:message.taskContextRef,...args});
        const result = await tool.call(input as never);
        expect(result.isError).not.toBe(true);
        return JSON.parse(result.content[0].text);
      };
      const sealed = parseJobAidProblemTask(parseTaskEnvelope(h.row().taskEnvelopeJson));
      const source = sealed.sourceCatalog.find(item => item.kind === 'DOCUMENT_PASSAGE')!;
      expect(source).toBeDefined();
      const sources=await call('read_assessment_sources',{sourceRefs:[source.evidenceRef],purpose:'读取合成原文以核候选',context:'EXACT'});
      expect(sources.completeRequestedScope).toBe(true);expect(sources.evidence[0].excerpt).toBe(source.excerpt);
      const candidate = {schemaVersion:JOBAID_PROBLEM_WORK_SCHEMA,headline:'合成完整候选 A',listBrief:'完整保留来源及阶段。',
        overview:'本轮合成解释保留版本边界。',roundCompletion:'COMPLETE',completionReason:'仅完成候选分析。',
        changeSummary:'保留原条件并完成全检查单。',issues:[{issueKey:'discussion',question:'方法如何表述？',
          body:`这里只讨论方法定义，未进行业务分级。 [[method:risk]] [[${source.evidenceRef}]]`,
          methodUsage:[{methodRef:'method:risk',usage:'REFERENCE_ONLY',basisRefs:[]}],openQuestions:[]}],
        checklistResults:sealed.checklistBinding!.selection.map(selected => ({itemId:selected.itemId,
          itemApplicability:selected.mode === 'INCLUDE' || selected.itemId === 'ENG-METHOD-01' ? 'APPLICABLE' : 'NOT_APPLICABLE',
          outcome:'ANSWERED',resultRefs:[{issueKey:'discussion',fieldPath:'/body'}],basisRefs:[source.evidenceRef]}))};
      const beforeTask = h.row().taskEnvelopeJson;
      const valid = await call('validate_assessment_work',{workJson:JSON.stringify(candidate)});
      expect(valid.status).toBe('VALID');
      const save = await call('save_assessment_work',{candidateRef:valid.candidateRef});
      expect(h.run().pending?.phase).toBe('SAVED');
      expect(h.saved).toHaveLength(1);
      const read = await call('read_assessment_work',{saveRequestId:save.saveRequestId});
      expect(read.revision.content.issues[0].issueKey).toBe('discussion');
      expect(h.run().pending?.phase).toBe('READ');
      const stage = await call('project_assessment_stage_overall',{workRevisionRef:read.revision.workRevisionRef});
      stageRef = stage.artifact.ref;
      expect(h.artifacts.readActualBytes).not.toHaveBeenCalled();
      expect(h.work.recordAilyStage).toHaveBeenCalledTimes(1);
      expect(h.row().status).toBe('RUNNING');expect(h.workItem.revision).toBe(5);
      expect(h.row().resultEnvelopeJson).toBeNull();expect(h.dispatch.acknowledgeAilyWorkItem).not.toHaveBeenCalled();
      // A repeated READ selects a real later receipt; the existing stage keeps
      // the original receipt it actually consumed.
      await call('read_assessment_work',{workRevisionRef:read.revision.workRevisionRef});
      expect(await call('project_assessment_stage_overall',{workRevisionRef:read.revision.workRevisionRef})).toEqual(stage);
      expect(h.work.recordAilyStage).toHaveBeenCalledTimes(1);
      const next = {...candidate,headline:'合成完整候选 B',changeSummary:'以实际 A 正文为当前基线继续本轮。',
        unchangedExplanation:'保留 A 的完整正文、证据与全检查单，更新本轮标题。'};
      const validB = await call('validate_assessment_work',{workJson:JSON.stringify(next)});
      expect(validB.binding.expectedWorkRevision).toBe(read.revision.workRevision);
      expect(validB.binding.previousWorkRevisionRef).toBe(read.revision.workRevisionRef);
      const saveB = await call('save_assessment_work',{candidateRef:validB.candidateRef});
      const readB = await call('read_assessment_work',{saveRequestId:saveB.saveRequestId});
      expect(readB.revision.previousWorkRevisionRef).toBe(read.revision.workRevisionRef);
      await call('project_assessment_stage_overall',{workRevisionRef:readB.revision.workRevisionRef});
      expect(h.saved).toHaveLength(2);expect(h.row().taskEnvelopeJson).toBe(beforeTask);
      const historical=await (h.jobAid as unknown as {readBrowserStageOverall(revision:JobAidWorkRevision,
        workItem:CanonicalWorkItemProjection,reader:typeof actor):Promise<{receipt:unknown}>}).readBrowserStageOverall(h.saved[1],h.workItem,actor);
      expect(historical.receipt).toEqual(stage);
      expect(h.artifacts.readActualBytes).toHaveBeenCalledWith(stage.artifact);
      return {chatId:'9'.repeat(64),remoteSessionId:'original-remote-session'};
      } catch(cause) {toolFailure=cause;throw cause;}
    });
    try {
      const result = await h.send();
      if(toolFailure)throw toolFailure;
      expect(result.ailyDispatch?.dispatchStatus).toBe('ACCEPTED');
      expect(h.client.create).toHaveBeenCalledTimes(1);expect(h.run().pending?.phase).toBe('READ');
      expect(h.run().post.state).toBe('ACCEPTED');expect(stageRef).toMatch(/^artifact:\/\/synthetic\//u);
      expect(h.artifacts.persistAndReadback).toHaveBeenCalledTimes(2);
      const actor=await h.identity.authorizeCaller(h.jwt);const finalRef=h.run().pending!.workRevisionRef!;
      await h.domain.finish(actor,{taskContextRef:h.row().operationRef,workRevisionRef:finalRef});
      expect(h.row().status).toBe('SUCCEEDED');expect(h.row().projectionApplied).toBe(true);expect(h.workItem.revision).toBe(6);
      expect(h.repository.markCommitting).toHaveBeenCalledTimes(1);expect(h.repository.finishTerminal).toHaveBeenCalledTimes(1);
      expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
      expect(h.work.publishedOriginalBindingInTransaction).toHaveBeenCalledTimes(2);
      await h.domain.finish(actor,{taskContextRef:h.row().operationRef,workRevisionRef:finalRef});
      expect(h.repository.markCommitting).toHaveBeenCalledTimes(1);expect(h.client.create).toHaveBeenCalledTimes(1);
      if(authenticationMode==='HOST_SERVICE'){expect(h.actors.assertHostedServiceRole).toHaveBeenCalled();
        expect(h.repository.readAilyTaskActorBinding).toHaveBeenCalled();expect(h.sourceAuthorization.authorizeSourceRead).toHaveBeenCalled();
        expect(h.grantLimit).not.toHaveBeenCalled();expect(h.run().invocation?.callerAppId).toBe('cli_synthetic');}
    } finally {register.mockRestore();}
  });

  it('runs the normal owner continuation through reservation, full preparation, original claim and durable one-shot POST', async () => {
    const h = harness();
    const receipt = await h.send();
    expect(receipt).toMatchObject({requestId, operation: 'EVALUATE_JOBAID', status: 'RUNNING', replayed: false,
      candidateOnly: true, ailyDispatch: {dispatchStatus: 'ACCEPTED', chatId: '9'.repeat(64), remoteSessionId: 'original-remote-session'}});
    expect(h.order).toEqual(['reservation', 'prepared', 'claim', 'STARTED', 'POST', 'ACCEPTED']);
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.repository.claimExact).toHaveBeenCalledWith(expect.objectContaining({ailyExecution: true, leaseOwner: h.config.principalId}));
    const queued = h.repository.reserve.mock.calls[0][0];
    expect(parseTaskEnvelope(String(queued.taskEnvelopeJson)).modelInput.schemaVersion).toBe('wiselink.3_1.initial_analysis_request.v1');
    const sealed = parseTaskEnvelope(h.row().taskEnvelopeJson);
    expect(sealed.deadline).toBe(new Date(queued.deadlineAt as Date).toISOString());
    expect(sealed.idempotencyKey).toContain(requestId);
    const full = parseJobAidProblemTask(sealed);
    const call = h.client.create.mock.calls[0][0] as unknown as {message: string; expectedRequestBody: string};
    const message = JSON.parse(call.message);
    expect(message.modelInput).toEqual(full.modelInput);
    expect(message.modelInput.checklistBinding.definition).toEqual(JOBAID_CHECKLIST_RC1);
    expect(message.modelInput.checklistBinding.definitionContentHash).toBe(JOBAID_CHECKLIST_RC1_CONTENT_HASH);
    expect(message.modelInput.checklistBinding.selection).toHaveLength(8);
    expect(message.modelInput.methodBinding).toEqual(JOBAID_METHOD_BINDING);
    expect(message.modelInput.programOriginal.units).toEqual(h.original.source.units);
    expect(call.message).toContain('完整原文终点');
    expect(call.message).toContain(h.previous.content.understanding);
    expect(message.roleMapping).toEqual(AILY_TASK_ROLE_MAPPING);
    expect(h.run().post.requestBody).toBe(call.expectedRequestBody);
    expect(JSON.parse(call.expectedRequestBody).stream).toBe(false);
    expect(call.message).not.toContain(leaseToken);
    expect(message).not.toHaveProperty('task');
    expect(message.modelInput).not.toHaveProperty('actorUserId');
    expect(message.modelInput).not.toHaveProperty('permissionSnapshotVersion');
    expect(h.run().modelEvidence.actualModelRef).toBeNull();
  });

  it('queries only the original accepted chat on re-entry and does not treat an unknown platform status as Host completion', async () => {
    const h = harness(); await h.send(); const original = {...h.row()};
    const receipt = await h.send();
    expect(h.client.create).toHaveBeenCalledTimes(1);
    expect(h.client.read).toHaveBeenCalledWith({agentId: h.config.agentId, accessToken: 'synthetic-user-token',
      chatId: '9'.repeat(64), remoteSessionId: 'original-remote-session'});
    expect(receipt).toMatchObject({status: 'RUNNING', replayed: true, ailyDispatch: {remoteStatus: 'UnverifiedStatus'}});
    expect(h.row().leaseGeneration).toBe(original.leaseGeneration);
    expect(h.row().deadlineAt).toEqual(original.deadlineAt);
    expect(h.repository.prepareInitialRequestInput).toHaveBeenCalledTimes(1);
  });

  it.each(['authorization', 'grant'] as const)('rejects cancellation, deadline expiry and generation changes while awaiting final %s', async waitingOn => {
    for (const change of ['cancel', 'deadline', 'generation']) {
      const h = harness();
      const mutate = () => {
        if (!h.repository.claimExact.mock.calls.length) return;
        h.setRow({...h.row(), ...(change === 'cancel' ? {status: 'CANCELLED', cancelRequestedAt: new Date()} :
          change === 'deadline' ? {deadlineAt: new Date(0)} : {leaseGeneration: h.row().leaseGeneration + 1})});
      };
      if (waitingOn === 'authorization') h.initial.hasExactAutoProcessingGrant.mockImplementation(async () => {mutate(); return true;});
      else h.grantLimit.mockImplementation(async () => {mutate(); return [{sealed: 'synthetic-sealed-grant', tokenHash: 'synthetic-hash', mappingId: 'synthetic-mapping'}];});
      await expect(h.send()).rejects.toThrow('INITIAL_CONTINUATION_AILY_INTENT_UNCONFIRMED');
      expect(h.client.create).not.toHaveBeenCalled();
      expect(h.repository.compareAndSetAilyExecutorRun).toHaveBeenCalledTimes(1);
      expect(h.order).not.toContain('STARTED');
    }
  });

  it('reads an original DeepSeek run after the same agent publishes GLM in a new version without changing its snapshot or posting', async () => {
    const h = harness(); await h.send();
    const originalTask = h.row().taskEnvelopeJson; const originalRun = structuredClone(h.run());
    h.config.modelOptions = [{modelRef: 'aily/glm-5.3', platformBuiltIn: true}];
    h.config.publicationRef = 'new-synthetic-glm-publication';
    expect(h.admission.require(actor.tenantId, h.workItem).model.modelRef).toBe('aily/glm-5.3');
    await h.send();
    expect(h.client.create).toHaveBeenCalledTimes(1); expect(h.client.read).toHaveBeenCalledTimes(1);
    expect(h.row().taskEnvelopeJson).toBe(originalTask); expect(h.run()).toEqual(originalRun);
    expect(h.run().modelEvidence).toEqual({selectedModelRef: 'aily/deepseek-v4-pro', actualModelRef: null});
  });

  it.each(['agent', 'principal', 'source'] as const)('keeps original GET rejected when its %s binding changes', async changed => {
    const h = harness(); await h.send();
    if (changed === 'agent') h.config.agentId = 'agent_other';
    if (changed === 'principal') h.config.principalId = 'service:other';
    if (changed === 'source') h.workItem.source.sourceFileSha256 = 'b'.repeat(64);
    await expect(h.send()).rejects.toThrow(changed === 'source'
      ? 'INITIAL_CONTINUATION_AILY_TASK_BINDING_CHANGED' : 'INITIAL_CONTINUATION_AILY_RUN_BINDING_CHANGED');
    expect(h.client.create).toHaveBeenCalledTimes(1); expect(h.client.read).not.toHaveBeenCalled();
  });

  it.each(['STARTED', 'UNKNOWN'] as const)('never repeats POST or guesses a GET for original %s without a chat', async state => {
    const h = harness(); await h.send(); const original = h.run();
    h.setRun({...original, post: state === 'STARTED'
      ? {state, startedAt: original.post.startedAt, requestBody: original.post.requestBody}
      : {state, startedAt: original.post.startedAt, requestBody: original.post.requestBody,
          observedAt: '2026-10-29T00:01:00.000Z', errorCode: 'AILY_POST_RESULT_UNCONFIRMED'}});
    expect((await h.send()).ailyDispatch).toMatchObject({dispatchStatus: 'UNKNOWN', chatId: null});
    expect(h.client.create).toHaveBeenCalledTimes(1);
    expect(h.client.read).not.toHaveBeenCalled();
    expect(h.repository.claimExact).toHaveBeenCalledTimes(1);
  });

  it('retains UNKNOWN when POST fails and re-entry cannot create a replacement', async () => {
    const h = harness(); h.client.create.mockRejectedValueOnce(new Error('network details must stay private'));
    expect((await h.send()).ailyDispatch).toMatchObject({dispatchStatus: 'UNKNOWN', errorCode: 'AILY_POST_RESULT_UNCONFIRMED'});
    expect(h.run().post.state).toBe('UNKNOWN'); await h.send();
    expect(h.client.create).toHaveBeenCalledTimes(1);
  });

  it('keeps the exact terminal Host request UNKNOWN without claiming or posting another generation', async () => {
    const h = harness(); h.client.create.mockRejectedValueOnce(new Error('network unknown'));
    await h.send(); h.setRow({...h.row(), status: 'CANCELLED', completedAt: new Date(),
      leaseToken: null, leaseOwner: null, leaseExpiresAt: null, leaseSlot: null});
    expect(await h.send()).toMatchObject({requestId, status: 'CANCELLED', replayed: true,
      ailyDispatch: {dispatchStatus: 'UNKNOWN', chatId: null}});
    expect(h.client.create).toHaveBeenCalledTimes(1); expect(h.client.read).not.toHaveBeenCalled();
    expect(h.repository.claimExact).toHaveBeenCalledTimes(1);
  });

  it('leaves STARTED as unknown when a late acceptance cannot pass its original write fence', async () => {
    const h = harness(); const cas = h.repository.compareAndSetAilyExecutorRun.getMockImplementation()!;
    h.repository.compareAndSetAilyExecutorRun.mockImplementation(async input => input.next.post.state === 'ACCEPTED' ? false : cas(input));
    expect((await h.send()).ailyDispatch).toMatchObject({dispatchStatus: 'UNKNOWN', errorCode: 'AILY_POST_RECEIPT_UNCONFIRMED'});
    expect(h.run().post.state).toBe('STARTED'); await h.send();
    expect(h.client.create).toHaveBeenCalledTimes(1);
    expect(h.client.read).not.toHaveBeenCalled();
  });

  it.each(['COMMITTING', 'CANCELLED', 'TIMED_OUT'])('only reads an existing receipt in %s without reclaiming or resetting business state', async status => {
    const h = harness(); await h.send(); h.setRow({...h.row(), status});
    expect((await h.send()).status).toBe(status);
    expect(h.repository.claimExact).toHaveBeenCalledTimes(1);
    expect(h.repository.recoverExpiredRunning).not.toHaveBeenCalled();
    expect(h.client.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a changed Host session binding and a revoked exact grant before remote access', async () => {
    const h = harness(); await h.send();
    h.session.session.id = '00000000-0000-4000-8000-000000000199';
    await expect(h.send()).rejects.toThrow('INITIAL_CONTINUATION_AILY_RUN_BINDING_CHANGED');
    h.session.session.id = sessionId; h.initial.hasExactAutoProcessingGrant.mockResolvedValue(false);
    await expect(h.send()).rejects.toThrow('INITIAL_CONTINUATION_AILY_SCOPE_CHANGED');
    expect(h.client.create).toHaveBeenCalledTimes(1); expect(h.client.read).not.toHaveBeenCalled();
  });

  it('fails before reserving when private storage or current Host user grant is unavailable', async () => {
    const h = harness(); h.repository.assertAilyExecutorStorage.mockRejectedValueOnce(new Error('INITIAL_CONTINUATION_AILY_STORAGE_UNAVAILABLE'));
    await expect(h.send()).rejects.toThrow('INITIAL_CONTINUATION_AILY_STORAGE_UNAVAILABLE');
    h.grantLimit.mockResolvedValue([]);
    await expect(h.send()).rejects.toThrow('INITIAL_CONTINUATION_AILY_USER_GRANT_REQUIRED');
    expect(h.repository.reserve).not.toHaveBeenCalled(); expect(h.client.create).not.toHaveBeenCalled();
  });
});
