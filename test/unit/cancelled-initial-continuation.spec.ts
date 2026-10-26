import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { SQL } from 'drizzle-orm';
import { actionAttempt, workItem } from '../../server/database/schema';
import { autoWorkItemAuthorization } from '../../server/database/auto-work-item-authorization.schema';
import { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';
import type { CancelledAutoProcessingLeaseInput } from '../../server/modules/work-item/cancelled-auto-processing-lease';
import {
  canonicalJson,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';

import {
  assertCancelledInitialContinuation,
  readCancelledInitialContinuation,
} from '../../server/modules/action-attempt/cancelled-initial-continuation';
import { MiaodaDocumentVersionSourceResolver } from '../../server/modules/work-item/miaoda-document-version-source.resolver';
import { ActionAttemptRepository } from '../../server/modules/action-attempt/action-attempt.repository';
import { readBrowserInitialContinuationClaim } from '../../server/modules/action-attempt/cancelled-initial-continuation';
import type { OpenClawTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope.types';
import { buildInitialAnalysisRequestInput } from '../../server/modules/action-attempt/initial-analysis-request';
import { buildProgramAgentPolicy } from '../../server/modules/canonical-host/program-agent-policy';
import { JOBAID_METHOD_BINDING, JOBAID_METHOD_EVIDENCE } from '../../server/modules/canonical-host/jobaid-method-pack';
import { overallModelEvidenceRegistry, OVERALL_EVIDENCE_SOURCE_STATEMENT_VERSION } from '../../server/modules/canonical-host/overall-assessment-reading';

const NOW = new Date('2026-10-12T00:00:00.000Z');
const TOKEN = 'b1686364-7ee9-4ca1-a3aa-0b62794cb436';
const MODEL = {
  modelRef: 'miaoda/glm-5.3',
  displayName: 'GLM 5.3',
  providerKind: 'BUILT_IN' as const,
  settingsRevision: 1,
  selectedAt: NOW.toISOString(),
};

function fixture() {
  const task = sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-old',
    operationRef: 'AQ-old',
    taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    priority: 100,
    tenantId: 'tenant-fixture',
    workItemId: 'WI-fixture',
    inputRevision: 3,
    baseRevision: 3,
    documentVersionId: 'DV-fixture',
    sourceRefs: [],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput: { fixture: 'synthetic-control-only' },
    executionModel: MODEL,
    deadline: '2026-10-12T00:30:00.000Z',
    idempotencyKey: 'openclaw-v2:cancelled-fixture',
  });
  const source = {
    documentId: 'DOC-fixture',
    documentVersionId: 'DV-fixture',
    sourceArtifactId: 'ART-fixture',
    sourceFileSha256: 'a'.repeat(64),
    sourceByteLength: 1024,
  };
  const owner = {
    ...source,
    tenantId: 'tenant-fixture',
    workItemId: 'WI-fixture',
    requestId: 'REQ-parse',
    revision: 3,
    requestedByUserId: 'actor-fixture',
    actionType: 'PARSE_PDF',
    status: 'CANDIDATE_READBACK_VERIFIED',
    packageId: 'PKG-fixture',
    packageArtifactRef: 'package.json',
    packageArtifactSha256: 'sha256:' + 'c'.repeat(64),
    analysisModelJson: canonicalJson(MODEL) as string | null,
    projectionJson: canonicalJson({
      workItemId: 'WI-fixture',
      requestId: 'REQ-parse',
      revision: 3,
      phase: 'CANDIDATE_READBACK_VERIFIED',
      source,
      package: {
        packageId: 'PKG-fixture',
        artifact: { ref: 'package.json', sha256: 'sha256:' + 'c'.repeat(64) },
      },
    }),
  };
  const target = {
    tenantId: owner.tenantId,
    actorUserId: owner.requestedByUserId,
    workItemId: owner.workItemId,
    documentVersionId: owner.documentVersionId,
    subjectKind: 'WORK_ITEM',
    requestOrigin: 'OPENCLAW_MCP_V1',
    status: 'CANCELLED',
    attemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    actionType: task.taskType,
    attemptNo: 6,
    triggerRequestId: 'REQ-job',
    inputRevision: 3,
    baseRevision: 3,
    taskInputHash: task.inputHash,
    taskEnvelopeJson: canonicalJson(task),
    idempotencyKey: task.idempotencyKey,
    executionModelJson: canonicalJson(MODEL),
    completedAt: NOW,
    createdAt: new Date(NOW.getTime() - 60000),
    projectionApplied: false,
    commitStartedAt: null,
    resultEnvelopeJson: null,
    resultContentHash: null,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
  };
  const attempts = [target];
  const grant = {
    ...source,
    tenantId: owner.tenantId,
    actorUserId: owner.requestedByUserId,
    workItemId: owner.workItemId,
    requestId: owner.requestId,
    grantKind: 'MIAODA_CANONICAL_PARSE_REQUEST',
    status: 'BLOCKED',
    leaseOwner: null as string | null,
    leaseToken: null as string | null,
    leaseGeneration: 10,
    completedAt: null,
    completedLeaseGeneration: null,
    completedLeaseTokenHash: null,
    updatedAt: new Date(NOW.getTime() + 2),
    leaseExpiresAt: null as Date | null,
    blockedAt: NOW as Date | null,
    blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_CANCELLED' as string | null,
    blockedLeaseTokenHash: 'f'.repeat(64) as string | null,
    blockedLeaseGeneration: 10 as number | null,
  };
  const input: CancelledAutoProcessingLeaseInput = {
    tenantId: owner.tenantId,
    workItemId: owner.workItemId,
    actorUserId: owner.requestedByUserId,
    leaseOwner: 'service:openclaw-main',
    leaseToken: TOKEN,
    leaseGeneration: 10,
    replayOnly: false,
    expectedCancellation: {
      ...source,
      requestId: owner.requestId,
      workItemRevision: 3,
      attemptId: target.attemptId,
      attemptRef: target.operationRef,
      attemptNo: target.attemptNo,
      attemptRequestId: target.triggerRequestId,
      actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
      inputRevision: 3,
      baseRevision: 3,
      inputHash: task.inputHash,
      executionModel: MODEL,
    },
  };
  const sql: { sql: string; params: unknown[] }[] = [];
  const events: string[] = [];
  let beforeLock: (table: unknown) => Promise<void> = async () => {};
  const returning = jest.fn(async () => {
    grant.status = 'WAITING';
    events.push('WAITING');
    return [{ id: grant.workItemId }];
  });
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: SQL) => {
          const builder = drizzle
            .mock()
            .select()
            .from(table as typeof workItem)
            .where(condition);
          const query = {
            limit: (count: number) => {
              builder.limit(count);
              return query;
            },
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve(
                table === workItem
                  ? [owner]
                  : table === actionAttempt
                    ? attempts
                    : [grant],
              ).then(resolve),
            for: async (mode: 'update' | 'share') => {
              builder.for(mode);
              sql.push(builder.toSQL());
              events.push(
                table === workItem
                  ? 'WI_LOCK'
                  : table === actionAttempt
                    ? 'ATT_LOCK'
                    : 'GRANT_LOCK',
              );
              await beforeLock(table);
              return table === workItem
                ? [owner]
                : table === actionAttempt
                  ? attempts
                  : [grant];
            },
          };
          return query;
        },
      }),
    }),
    update: jest.fn((table: unknown) => {
      expect(table).toBe(autoWorkItemAuthorization);
      return {
        set: (values: Record<string, unknown>) => {
          expect(Object.keys(values).sort()).toEqual(['status', 'updatedAt']);
          return {
            where: (condition: SQL) => {
              sql.push(
                drizzle
                  .mock()
                  .update(autoWorkItemAuthorization)
                  .set(values)
                  .where(condition)
                  .toSQL(),
              );
              return { returning };
            },
          };
        },
      };
    }),
    transaction: jest.fn(async (perform: (tx: unknown) => Promise<unknown>) =>
      perform(db),
    ),
  };
  const repository = new MiaodaWorkItemRepository(db as never);
  return {
    owner,
    target,
    attempts,
    grant,
    input,
    repository,
    db,
    returning,
    sql,
    events,
    setBeforeLock: (perform: typeof beforeLock) => {
      beforeLock = perform;
    },
  };
}

function eligibility(f: Pick<ReturnType<typeof fixture>, 'owner'>) {
  return {
    tenantId: f.owner.tenantId,
    actorUserId: f.owner.requestedByUserId,
    workItem: JSON.parse(f.owner.projectionJson),
  };
}

const AGENT_MODEL = { ...MODEL, settingsRevision:2,selectedAt:'2026-10-11T23:59:30.000Z',
  schemaVersion:'wiselink.3_1.execution_model_selection.v2' as const,maxOutputTokens:131072 };
const OLD_PROGRAM_REQUEST = '11111111-1111-4111-8111-111111111111';
const NEW_PROGRAM_REQUEST = '22222222-2222-4222-8222-222222222222';
function resealRow(row: ReturnType<typeof fixture>['target'], change: (task:OpenClawTaskEnvelope) => void) {
  const task = JSON.parse(row.taskEnvelopeJson) as OpenClawTaskEnvelope;
  change(task);
  const {inputHash:_previous,...unsealed} = task;
  const sealed = sealTaskEnvelope(unsealed);
  row.taskEnvelopeJson = canonicalJson(sealed); row.taskInputHash = sealed.inputHash;
}
function programCancellation(stage:'initial'|'v3' = 'v3') {
  const f = fixture(), policy = buildProgramAgentPolicy(AGENT_MODEL);
  const method = JOBAID_METHOD_EVIDENCE.find(item => item.kind === 'METHOD_CLAUSE')!;
  const original = {binding:{documentVersionId:f.owner.documentVersionId,parseRunId:'PR-original',parseRevision:1,
    sourceArtifactId:f.owner.sourceArtifactId,sourceSha256:f.owner.sourceFileSha256,sourceByteLength:f.owner.sourceByteLength},
    coverage:{knownPageCount:1,readPageIndexes:[0],unresolvedRanges:[]},units:[],sourceLocators:[],findings:[]};
  resealRow(f.target, task => {
    task.executionModel = AGENT_MODEL;
    task.sourceRefs = [{ref:f.owner.sourceArtifactId,sha256:f.owner.sourceFileSha256}];
    task.idempotencyKey = `openclaw-v2:dynamic:${task.workItemId}:${task.documentVersionId}:${OLD_PROGRAM_REQUEST}`;
    task.modelInput = stage === 'initial'
      ? buildInitialAnalysisRequestInput({taskType:'OPENCLAW_DYNAMIC_EVALUATION',requestId:OLD_PROGRAM_REQUEST,
          originalParseRunId:'PR-original',executionMode:'PROGRAM_AGENT_V1',modelRef:AGENT_MODEL.modelRef,agentPolicy:policy})
      : {schemaVersion:'wiselink.jobaid-problem-task.v3',executionMode:'PROGRAM_AGENT_V1',requestedModelRef:AGENT_MODEL.modelRef,
          agentPolicy:policy,actorUserId:f.owner.requestedByUserId,permissionSnapshotVersion:'fixture-permission',
          sourceBindings:[],sourceCatalog:[method],initiallyDeliveredRefs:[method.evidenceRef],sourceActivityProjections:[],previousWork:null,
          modelInput:{schemaVersion:'wiselink.jobaid-problem-task.v3',executionMode:'PROGRAM_AGENT_V1',programOriginal:original,
            purpose:'INITIAL_PROBLEM_ASSESSMENT',methodBinding:JOBAID_METHOD_BINDING,documentOverview:{original:structuredClone(original)},
            availableSources:[{ref:method.evidenceRef,kind:method.kind,title:method.title,versionLabel:method.versionLabel,
              locator:'locator' in method ? method.locator : null}],
            deliveredEvidence:overallModelEvidenceRegistry([method],OVERALL_EVIDENCE_SOURCE_STATEMENT_VERSION),expectedWorkRevision:0,
            evidenceProjectionVersion:OVERALL_EVIDENCE_SOURCE_STATEMENT_VERSION,
            sourceStatementAvailability:{status:'AVAILABLE',semanticFieldsAvailability:'LEGACY_PARTIAL',limitations:[]}}};
    f.target.idempotencyKey = task.idempotencyKey;
  });
  f.target.executionModelJson = canonicalJson(AGENT_MODEL); f.target.actorUserId = 'service:openclaw-main';
  return f;
}
function queueNewProgram(f:ReturnType<typeof fixture>) {
  const model = {...AGENT_MODEL,settingsRevision:3,selectedAt:new Date(NOW.getTime()+1).toISOString()};
  const task = sealTaskEnvelope({schemaVersion:'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId:'ATT-new-intent',operationRef:'AQ-new-intent',taskType:'OPENCLAW_DYNAMIC_EVALUATION',priority:100,
    tenantId:f.owner.tenantId,workItemId:f.owner.workItemId,inputRevision:f.owner.revision,baseRevision:f.owner.revision,
    documentVersionId:f.owner.documentVersionId,sourceRefs:[{ref:f.owner.sourceArtifactId,sha256:f.owner.sourceFileSha256}],
    allowedConnectors:[],hostResolvedMissingInputs:[],executionModel:model,deadline:'2100-01-01T00:00:00.000Z',
    idempotencyKey:`openclaw-v2:dynamic:${f.owner.workItemId}:${f.owner.documentVersionId}:${NEW_PROGRAM_REQUEST}`,
    modelInput:buildInitialAnalysisRequestInput({taskType:'OPENCLAW_DYNAMIC_EVALUATION',requestId:NEW_PROGRAM_REQUEST,
      originalParseRunId:'PR-original',executionMode:'PROGRAM_AGENT_V1',modelRef:model.modelRef,agentPolicy:buildProgramAgentPolicy(model)})});
  const next = {...f.target,attemptId:task.actionAttemptId,operationRef:task.operationRef,attemptNo:7,status:'QUEUED',
    triggerRequestId:'REQ-new-intent',createdAt:new Date(NOW.getTime()+1),completedAt:null,priority:100,
    taskInputHash:task.inputHash,taskEnvelopeJson:canonicalJson(task),idempotencyKey:task.idempotencyKey,executionModelJson:canonicalJson(model),
    claimCount:0,retryCount:0,leaseGeneration:0,leaseSlot:null,startedAt:null,lastHeartbeatAt:null,
    cancelRequestedAt:null,cancelReason:null,executorSessionKey:null,deadlineAt:new Date(task.deadline)};
  f.attempts.push(next as unknown as typeof f.target);
  return next;
}
function claimInput(f:ReturnType<typeof fixture>) {
  return {...f.owner,actorUserId:f.owner.requestedByUserId,expectedWorkItemRevision:f.owner.revision,
    now:new Date(NOW.getTime()+60000)};
}

test.each(['initial','v3'] as const)('carries a sealed %s program model through cancellation release and a distinct new browser claim', async stage => {
  const f = programCancellation(stage), before = canonicalJson({owner:f.owner,target:f.target});
  const value = await readCancelledInitialContinuation(f.db as never,eligibility(f));
  expect(value?.binding.executionModel).toEqual(AGENT_MODEL);
  const release = await assertCancelledInitialContinuation(f.db as never,{binding:value!.binding,authorize:async()=>{}});
  const next = queueNewProgram(f);
  // The reservation and release occur under the same existing transaction/locks.
  await release();
  expect(f.grant.status).toBe('WAITING');
  const claim = await readBrowserInitialContinuationClaim(f.db as never,f.owner as never,f.grant as never,claimInput(f));
  expect(claim).toMatchObject({attemptId:next.attemptId,requestId:NEW_PROGRAM_REQUEST,
    executionModel:JSON.parse(next.executionModelJson),executionMode:'PROGRAM_AGENT_V1'});
  expect(canonicalJson({owner:f.owner,target:f.target})).toBe(before);
  expect(f.target.status).toBe('CANCELLED');
});
test('rechecks a queued new program while the cancellation receipt is still BLOCKED', async () => {
  const f = programCancellation(); queueNewProgram(f);
  const value = await readCancelledInitialContinuation(f.db as never,eligibility(f),true,NEW_PROGRAM_REQUEST);
  expect(value?.binding.executionModel).toEqual(AGENT_MODEL);
  expect(value?.binding.queuedRequest?.requestId).toBe(NEW_PROGRAM_REQUEST);
});
test.each([
  ['FAILED','program'],['TIMED_OUT','program'],['FAILED','legacy'],['TIMED_OUT','legacy'],
])('preserves the %s %s new-browser-intent claim path', async (status,mode) => {
  const f = failJobAid(fixture(),status); const next = queueNewProgram(f); f.grant.status = 'WAITING';
  if (mode === 'legacy') resealRow(next as unknown as typeof f.target,task => {
    delete task.modelInput.executionMode; delete task.modelInput.modelRef; delete task.modelInput.agentPolicy;
  });
  expect(await readBrowserInitialContinuationClaim(f.db as never,f.owner as never,f.grant as never,claimInput(f)))
    .toMatchObject({attemptId:next.attemptId,requestId:NEW_PROGRAM_REQUEST});
});
test.each(['bad-previous','changed-model','result','committing','actor','source','receipt','early-receipt','many-queued','replay','older-replay'] as const)(
  'rejects a CANCELLED successor claim with %s', async boundary => {
    const f = programCancellation(); const next = queueNewProgram(f); f.grant.status = 'WAITING';
    if (boundary === 'bad-previous') f.target.status = 'FAILED';
    if (boundary === 'changed-model') f.target.executionModelJson = canonicalJson({...AGENT_MODEL,settingsRevision:3});
    if (boundary === 'result') f.target.resultEnvelopeJson = '{}' as never;
    if (boundary === 'committing') f.target.status = 'COMMITTING';
    if (boundary === 'actor') f.grant.actorUserId = 'other-actor';
    if (boundary === 'source') f.grant.sourceArtifactId = 'ART-other';
    if (boundary === 'receipt') f.grant.blockedLeaseGeneration = 9;
    if (boundary === 'early-receipt') f.grant.blockedAt = new Date(NOW.getTime()-1);
    if (boundary === 'many-queued') f.attempts.push({...next,attemptId:'ATT-another'} as unknown as typeof f.target);
    if (boundary === 'replay') {
      next.idempotencyKey = f.target.idempotencyKey;
      resealRow(next as unknown as typeof f.target,task => {
        task.idempotencyKey = f.target.idempotencyKey; task.modelInput.requestId = OLD_PROGRAM_REQUEST;
      });
    }
    if (boundary === 'older-replay') {
      const earlier = {...f.target,attemptId:'ATT-earlier',operationRef:'AQ-earlier',attemptNo:5,
        createdAt:new Date(NOW.getTime()-120000),idempotencyKey:next.idempotencyKey};
      resealRow(earlier,task => {
        task.actionAttemptId = earlier.attemptId; task.operationRef = earlier.operationRef;
        task.idempotencyKey = earlier.idempotencyKey;
      });
      f.attempts.push(earlier);
    }
    expect(await readBrowserInitialContinuationClaim(f.db as never,f.owner as never,f.grant as never,claimInput(f))).toBeNull();
    expect(f.db.update).not.toHaveBeenCalled();
  });
test.each(['schema','mode','legacy-intent','policy','source','identity'] as const)('validates the newly sealed browser intent: %s', async boundary => {
  const f = programCancellation(); const next = queueNewProgram(f); f.grant.status = 'WAITING';
  resealRow(next as unknown as typeof f.target,task => {
    if (boundary === 'schema') task.modelInput.schemaVersion = 'unrecognized-program-schema';
    if (boundary === 'mode') task.modelInput.executionMode = 'PROGRAM_AGENT_V2';
    if (boundary === 'legacy-intent') {
      delete task.modelInput.executionMode; delete task.modelInput.modelRef; delete task.modelInput.agentPolicy;
    }
    if (boundary === 'policy') task.modelInput.agentPolicy = {...buildProgramAgentPolicy(AGENT_MODEL),maxOutputTokens:65536};
    if (boundary === 'source') task.sourceRefs[0].ref = 'ART-other';
    if (boundary === 'identity') task.operationRef = 'AQ-other';
  });
  expect(await readBrowserInitialContinuationClaim(f.db as never,f.owner as never,f.grant as never,claimInput(f))).toBeNull();
  expect(f.db.update).not.toHaveBeenCalled();
});

function failJobAid<F extends Pick<ReturnType<typeof fixture>, 'target' | 'grant' | 'owner'>>(
  f: F, status = 'TIMED_OUT',
): F {
  f.target.status = status;
  f.grant.blockedCode = 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED';
  // The persisted blocking lease may be later than the failed task's lease.
  return f;
}
beforeEach(() =>
  jest
    .spyOn(MiaodaDocumentVersionSourceResolver.prototype, 'resolve')
    .mockResolvedValue({
      version: {
        documentId: 'DOC-fixture',
        sourceArtifactId: 'ART-fixture',
        pdfSha256: 'a'.repeat(64),
        byteLength: 1024,
      },
    } as never),
);
afterEach(() => jest.restoreAllMocks());

test.each(['FAILED', 'TIMED_OUT'])(
  'allows only an exact %s successor and inherits the stored initial model without changing history',
  async (terminalStatus) => {
    const f = failJobAid(fixture(), terminalStatus);
    f.owner.analysisModelJson = null;
    const before = canonicalJson({ owner: f.owner, attempts: f.attempts });
    const value = await readCancelledInitialContinuation(f.db as never, eligibility(f));
    expect(value!.binding).toMatchObject({
      terminalStatus, blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED',
      leaseGeneration: 10, executionModel: MODEL,
    });
    const release = await assertCancelledInitialContinuation(f.db as never, {
      binding: value!.binding, authorize: async () => {},
    });
    await release();
    expect(f.grant.status).toBe('WAITING');
    expect(f.grant.blockedCode).toBe('AUTO_WORK_ITEM_STAGE_JOBAID_FAILED');
    expect(canonicalJson({ owner: f.owner, attempts: f.attempts })).toBe(before);
  },
);

test('keeps the failed task model self-consistent while inheriting the earliest initial selection', async () => {
  const f = failJobAid(fixture());
  f.owner.analysisModelJson = null;
  const inherited = { ...MODEL, selectedAt: '2026-10-11T00:00:00.000Z' };
  f.attempts.push({ ...f.target, attemptId: 'ATT-earliest',
    createdAt: new Date(NOW.getTime() - 120000), attemptNo: 5,
    executionModelJson: canonicalJson(inherited) });
  const value = await readCancelledInitialContinuation(f.db as never, eligibility(f));
  expect(value?.binding.executionModel).toEqual(inherited);
  f.target.executionModelJson = canonicalJson(inherited);
  expect(await readCancelledInitialContinuation(f.db as never, eligibility(f))).toBeNull();
});

test.each([
  { status: 'CONFLICT' }, { status: 'OBSOLETE' }, { status: 'CANCELLED' },
  { actionType: 'OPENCLAW_OVERALL_SYNTHESIS' }, { documentVersionId: 'DV-other' },
  { inputRevision: 2 }, { baseRevision: 2 }, { completedAt: null },
  { commitStartedAt: NOW }, { projectionApplied: true },
  { resultEnvelopeJson: '{}' }, { resultContentHash: 'b'.repeat(64) },
  { leaseOwner: 'stale-owner' }, { taskInputHash: 'changed' },
  { triggerRequestId: '' },
])('rejects a failed successor outside the exact terminal binding: %j', async change => {
  const f = failJobAid(fixture());
  Object.assign(f.target, change);
  expect(await readCancelledInitialContinuation(f.db as never, eligibility(f))).toBeNull();
  expect(f.db.update).not.toHaveBeenCalled();
});

test.each([
  { blockedCode: 'AUTO_WORK_ITEM_STAGE_OVERALL_FAILED' },
  { status: 'COMPLETED' }, { blockedAt: null },
  { blockedAt: new Date(NOW.getTime() - 1) },
  { blockedLeaseTokenHash: 'invalid' }, { blockedLeaseGeneration: 11 },
  { leaseToken: TOKEN }, { leaseExpiresAt: NOW }, { completedAt: NOW },
])('requires the complete current failure receipt: %j', async change => {
  const f = failJobAid(fixture());
  Object.assign(f.grant, change);
  expect(await readCancelledInitialContinuation(f.db as never, eligibility(f))).toBeNull();
});

test.each(['generation', 'blockedAt'])(
  'rechecks the original %s under lock instead of accepting a replaced block', async field => {
    const f = failJobAid(fixture());
    const value = await readCancelledInitialContinuation(f.db as never, eligibility(f));
    if (field === 'generation') {
      f.grant.leaseGeneration += 1; f.grant.blockedLeaseGeneration = f.grant.leaseGeneration;
    } else f.grant.blockedAt = new Date(NOW.getTime() + 1);
    await expect(assertCancelledInitialContinuation(f.db as never, {
      binding: value!.binding, authorize: async () => {},
    })).rejects.toThrow('BINDING_CHANGED');
    expect(f.db.update).not.toHaveBeenCalled();
  },
);

test('locks WI then original grant then latest cancelled attempts; exact source and fresh ACL precede WAITING without changing history', async () => {
  const f = fixture();
  const before = canonicalJson({ owner: f.owner, attempts: f.attempts });
  const value = await readCancelledInitialContinuation(
    f.db as never,
    eligibility(f),
  );
  expect(value).not.toBeNull();
  const authorize = jest.fn(async () => {});
  const release = await assertCancelledInitialContinuation(f.db as never, {
    binding: value!.binding,
    authorize,
  });
  expect(f.events).toEqual(['WI_LOCK', 'GRANT_LOCK', 'ATT_LOCK']);
  expect(f.db.update).not.toHaveBeenCalled();
  await release();
  expect(f.events).toEqual(['WI_LOCK', 'GRANT_LOCK', 'ATT_LOCK', 'WAITING']);
  expect(authorize).toHaveBeenCalledWith(f.db);
  expect(f.grant.status).toBe('WAITING');
  expect(f.grant.blockedCode).toBe('AUTO_WORK_ITEM_STAGE_JOBAID_CANCELLED');
  expect(canonicalJson({ owner: f.owner, attempts: f.attempts })).toBe(before);
  expect(f.sql[2].sql).toMatch(/for share$/u);
  expect(f.sql[3].params).toContain('BLOCKED');
});
test.each([
  { revision: 4 },
  { requestedByUserId: 'other' },
  { documentVersionId: 'DV-new' },
  { sourceFileSha256: 'b'.repeat(64) },
  { packageArtifactSha256: 'sha256:' + 'd'.repeat(64) },
  { analysisModelJson: canonicalJson({ ...MODEL, settingsRevision: 2 }) },
])('rejects fresh owner/source/package/model drift %j', async (change) => {
  const f = fixture(),
    input = eligibility(f);
  Object.assign(f.owner, change);
  expect(
    await readCancelledInitialContinuation(f.db as never, input),
  ).toBeNull();
  expect(f.db.update).not.toHaveBeenCalled();
});
test.each(['FAILED', 'COMMITTING', 'RUNNING', 'SUCCEEDED'])(
  'rejects non-cancelled %s',
  async (status) => {
    const f = fixture();
    f.target.status = status;
    expect(
      await readCancelledInitialContinuation(f.db as never, eligibility(f)),
    ).toBeNull();
  },
);
test.each(['FAILED', 'CANCELLED', 'QUEUED', 'COMMITTING'])(
  'rejects any newer %s attempt',
  async (status) => {
    const f = fixture();
    f.attempts.push({
      ...f.target,
      attemptId: 'ATT-new',
      status,
      createdAt: NOW,
    });
    expect(
      await readCancelledInitialContinuation(f.db as never, eligibility(f)),
    ).toBeNull();
  },
);
test.each([
  { blockedCode: 'DIFFERENT' },
  { status: 'COMPLETED' },
  { leaseOwner: 'service:other' },
  { blockedLeaseGeneration: 9 },
])('rejects grant outside exact parked scope %j', async (change) => {
  const f = fixture();
  Object.assign(f.grant, change);
  expect(
    await readCancelledInitialContinuation(f.db as never, eligibility(f)),
  ).toBeNull();
});
test('changed sealed task, revoked ACL and changed current source cannot requeue', async () => {
  const f = fixture();
  const value = await readCancelledInitialContinuation(
    f.db as never,
    eligibility(f),
  );
  await expect(
    assertCancelledInitialContinuation(f.db as never, {
      binding: value!.binding,
      authorize: async () => {
        throw new Error('REVOKED');
      },
    }),
  ).rejects.toThrow('REVOKED');
  expect(f.db.update).not.toHaveBeenCalled();
  jest
    .mocked(MiaodaDocumentVersionSourceResolver.prototype.resolve)
    .mockResolvedValueOnce({ version: { documentId: 'DOC-other' } } as never);
  await expect(
    assertCancelledInitialContinuation(f.db as never, {
      binding: value!.binding,
      authorize: async () => {},
    }),
  ).rejects.toThrow('BINDING_CHANGED');
  const task = JSON.parse(f.target.taskEnvelopeJson);
  task.modelInput = { changed: true };
  f.target.taskEnvelopeJson = JSON.stringify(task);
  expect(
    await readCancelledInitialContinuation(f.db as never, eligibility(f)),
  ).toBeNull();
  expect(f.db.update).not.toHaveBeenCalled();
});

function reservationFixture() {
  const f = fixture();
  const events: string[] = [];
  let tail = Promise.resolve();
  const database = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (condition: SQL) => {
          const params = drizzle
            .mock()
            .select()
            .from(table as typeof workItem)
            .where(condition)
            .toSQL().params;
          let limited = false;
          const rows = () =>
            table === workItem
              ? [
                  {
                    ...f.owner,
                    id: f.owner.workItemId,
                    initialAilySessionId: null,
                  },
                ]
              : table === autoWorkItemAuthorization
                ? [f.grant]
                : limited
                  ? f.attempts.filter(
                      (row) =>
                        params.includes(row.idempotencyKey) ||
                        ([
                          'QUEUED',
                          'RUNNING',
                          'RETRY_SCHEDULED',
                          'COMMITTING',
                        ].includes(row.status) &&
                          params.includes(row.status)),
                    )
                  : f.attempts;
          const query = {
            limit: () => {
              limited = true;
              return query;
            },
            orderBy: () => query,
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve(rows()).then(resolve),
            for: async (mode: string) => {
              events.push(
                table === workItem
                  ? 'WI:' + mode
                  : table === autoWorkItemAuthorization
                    ? 'GRANT:' + mode
                    : 'ATT:' + mode,
              );
              return rows();
            },
          };
          void fields;
          return query;
        },
      }),
    }),
    update: f.db.update,
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const previous = tail;
      let release = () => {};
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const count = f.attempts.length,
        status = f.grant.status;
      try {
        return await run(database);
      } catch (error) {
        f.attempts.splice(count);
        f.grant.status = status;
        throw error;
      } finally {
        release();
      }
    },
  };
  const repository = new ActionAttemptRepository(database as never);
  const insert = jest
    .spyOn(repository as never, 'insertReservation' as never)
    .mockImplementation((async (attempt: unknown) => {
      f.attempts.push(attempt as typeof f.target);
      return { row: attempt, created: true };
    }) as never);
  const attempt = {
    ...f.target,
    attemptId: 'ATT-new',
    operationRef: 'AQ-new',
    attemptNo: 7,
    status: 'QUEUED',
    completedAt: null,
    createdAt: NOW,
    idempotencyKey: 'openclaw-v2:dynamic:WI-fixture:DV-fixture:request-new',
  };
  return { ...f, repository, insert, attempt, events, database };
}
test.each(['CANCELLED', 'FAILED', 'TIMED_OUT'])('same request concurrent %s reserve queues one successor atomically; different request is rejected and old JA/attempt/source stay unchanged', async status => {
  const f = reservationFixture();
  if (status !== 'CANCELLED') failJobAid(f, status);
  const before = canonicalJson(f.target);
  const value = await readCancelledInitialContinuation(
    f.database as never,
    eligibility(f),
  );
  const guard = { binding: value!.binding, authorize: jest.fn(async () => {}) };
  const results = await Promise.all([
    f.repository.reserve(f.attempt as never, undefined, guard),
    f.repository.reserve(f.attempt as never, undefined, guard),
  ]);
  expect(results.map((row) => row.created)).toEqual([true, false]);
  expect(f.insert).toHaveBeenCalledTimes(1);
  expect(f.grant.status).toBe('WAITING');
  expect(f.attempts).toHaveLength(2);
  expect(canonicalJson(f.target)).toBe(before);
  expect(f.events.slice(0, 4)).toEqual([
    'WI:update',
    'WI:update',
    'GRANT:update',
    'ATT:share',
  ]);
  await expect(
    f.repository.reserve(
      {
        ...f.attempt,
        attemptId: 'ATT-different',
        idempotencyKey: 'openclaw-v2:request-other',
      } as never,
      undefined,
      guard,
    ),
  ).rejects.toMatchObject({ code: 'ACTION_ATTEMPT_ACTIVE_CONFLICT' });
  expect(f.attempts).toHaveLength(2);
});
test.each(['CANCELLED', 'FAILED', 'TIMED_OUT'])('failed grant CAS rolls back the %s reservation and does not change the parked grant/history', async status => {
  const f = reservationFixture();
  if (status !== 'CANCELLED') failJobAid(f, status);
  const value = await readCancelledInitialContinuation(
    f.database as never,
    eligibility(f),
  );
  f.returning.mockResolvedValueOnce([]);
  await expect(
    f.repository.reserve(f.attempt as never, undefined, {
      binding: value!.binding,
      authorize: async () => {},
    }),
  ).rejects.toThrow('BINDING_CHANGED');
  expect(f.grant.status).toBe('BLOCKED');
  expect(f.attempts).toHaveLength(1);
  expect(f.target.status).toBe(status);
});
