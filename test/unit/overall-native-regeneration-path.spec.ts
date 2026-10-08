import { dmDocumentParseRun } from '@server/database/document-parsing.schema';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  canonicalJson,
  sealTaskEnvelope,
} from '@server/modules/action-attempt/action-attempt-envelope';
import type { ActionAttemptRow } from '@server/modules/action-attempt/action-attempt.types';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import {
  JOBAID_PROBLEM_RESULT_SCHEMA,
  JOBAID_PROBLEM_WORK_SCHEMA,
  jobAidReadingResult,
  type JobAidWorkRevision,
} from '@shared/jobaid-problem-assessment.interface';
import { assessmentWorkRevision, workItem } from '@server/database/schema';
import { CanonicalHostOverallRegenerationService } from '@server/modules/canonical-host/canonical-host-overall-regeneration.service';
import { CanonicalJobAidProblemService } from '@server/modules/canonical-host/canonical-jobaid-problem.service';
import { readInitialAnalysisRequestInput } from '@server/modules/action-attempt/initial-analysis-request';
import type { ReserveActionAttemptInput } from '@server/modules/action-attempt/action-attempt.types';
import type { OpenClawTaskEnvelope } from '@server/modules/action-attempt/action-attempt-envelope.types';
import { JobAidWorkRepository } from '@server/modules/canonical-host/jobaid-work.repository';
import { MiaodaWorkItemRepository } from '@server/modules/work-item/miaoda-work-item.repository';
import { MiaodaCanonicalWorkItemRegistrarAdapter } from '@server/modules/work-item/miaoda-canonical-work-item-registrar.adapter';
import { JOBAID_METHOD_BINDING } from '@server/modules/canonical-host/jobaid-method-pack';
import { tdmsRuntimeFixture } from './fixtures/tdms-runtime.fixture';
import { tdmsTransactionProofFixture } from './fixtures/tdms-transaction-native-verifier.fixture';
import type { TdmsNativeTransactionInput } from '@server/modules/canonical-host/tdms-native-evidence-verifier.port';

/** Offline constructed authority/storage only. Actual browser service, registrar,
 * CAS and JobAid immutable-work reader; a serial single-connection DB protocol
 * double stages writes until transaction completion and rejects root-pool IO. */
async function harness(actualQueue = false) {
  const f = tdmsRuntimeFixture({
    tenantId: 'fixture-tenant',
    actorUserId: 'owner',
    workItemId: 'WI-NATIVE',
    documentVersionId: 'DV-NATIVE',
    taskContextRef: 'OP-ORIGINAL',
  });
  f.principal.scope.appId = 'app_17bzc551rsg';
  f.actor.applicationScopeId = f.principal.scope.appId;
  f.actor.subjectDecision.applicationScopeId = f.principal.scope.appId;
  f.actor.subjectDecision.version = 'miaoda-hosted-native-sso.v1';
  const context = await f.adapter.discover(f.principal, f.binding);
  const evidence = (
    await f.adapter.read(f.principal, {
      context,
      evidenceRefs: context.projection.selectedSetApprovedRefs,
      purpose: 'JOB_AID_NATIVE_RECORD',
      taskContextRef: f.binding.taskContextRef,
    })
  ).evidence;
  const authenticEvidence = structuredClone(evidence);
  const revision: JobAidWorkRevision = {
    workRevisionRef: 'JAWR-NATIVE-1',
    workItemId: 'WI-NATIVE',
    workRevision: 1,
    previousWorkRevisionRef: null,
    requestId: 'SAVE-ORIGINAL',
    actionAttemptId: 'ATT-ORIGINAL',
    basedOnWorkItemRevision: 11,
    documentVersionId: 'DV-NATIVE',
    createdAt: '2026-10-07T00:00:00.000Z',
    content: {
      schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA,
      overviewStatus: 'CURRENT',
      headline: 'Conditional judgment',
      listBrief: 'Verify applicability',
      understanding: 'Execution is unverified.',
      decisiveIssueKeys: [],
      issues: [],
      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
      completionReason: 'Native sources read',
      changeSummary: 'Candidate only',
      unchangedExplanation: 'No adoption',
      methodBinding: structuredClone(JOBAID_METHOD_BINDING),
      evidence,
      readSourceRefs: evidence.map((e) => e.evidenceRef),
      capabilities: [],
      historyReview: {
        required: false,
        priorAssessmentRefs: [],
        engineeringDocumentRefs: [],
        coverage: 'NOT_REQUIRED',
        limitation: null,
      },
    },
  };
  const sourceIdentity = {
    documentVersionId: 'DV-NATIVE',
    sourceArtifactId: 'ART-NATIVE',
    sourceFileSha256: 'a'.repeat(64),
    packageId: 'PKG-NATIVE',
    packageArtifactSha256: 'b'.repeat(64),
  };
  let current = {
    workItemId: 'WI-NATIVE',
    requestId: 'REQ-ORIGINAL',
    revision: 12,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    source: { ...sourceIdentity },
    package: { packageId: 'PKG-NATIVE', artifact: { sha256: 'b'.repeat(64) } },
    classification: { status: 'CONFIRMED', normalizedFamily: 'SB' },
    aeo: null,
    failure: null,
    recordingFailure: null,
    integratedAssessment: {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: {
        schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
        workRevisionRef: revision.workRevisionRef,
        workRevision: 1,
        readingResult: jobAidReadingResult(revision),
      },
      overallSynthesis: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        actionAttemptId: 'ATT-OVERALL',
        artifact: { sha256: 'c'.repeat(64) },
        staleReason: null,
        basedOnJobAidWorkRevisionRef: revision.workRevisionRef,
        readingResult: jobAidReadingResult(revision),
      },
      overallForAeoConfirmation: null,
    },
  } as unknown as CanonicalWorkItemProjection;
  const original = structuredClone(current),
    originalWork = structuredClone(revision),
    originalReceipts = structuredClone(f.receipts);
  let pending: CanonicalWorkItemProjection | undefined,
    queued = false,
    latestRef = revision.workRevisionRef;
  let ownerId = 'owner',
    databaseActor = 'owner';
  let onUpdate: (() => void | Promise<void>) | undefined,
    beforeLock: (() => void | Promise<void>) | undefined;
  const events: string[] = [],
    dialect = new PgDialect();
  const row = () => ({
    revision: (pending ?? current).revision,
    workItemId: current.workItemId,
    documentVersionId: current.source.documentVersionId,
    requestedByUserId: ownerId,
    projectionJson: JSON.stringify(pending ?? current),
  });
  const historical = new Map<string, JobAidWorkRevision>();
  const saved = (revision: JobAidWorkRevision) => ({
    assessmentWorkRevisionId: revision.workRevisionRef,
    tenantId: 'fixture-tenant',
    createdByUserId: ownerId,
    workItemId: revision.workItemId,
    workRevision: revision.workRevision,
    previousWorkRevisionId: revision.previousWorkRevisionRef,
    requestId: revision.requestId,
    actionAttemptId: revision.actionAttemptId,
    basedOnWorkItemRevision: revision.basedOnWorkItemRevision,
    documentVersionId: revision.documentVersionId,
    createdAt: new Date(revision.createdAt),
    contentJson: JSON.stringify(revision.content),
  });
  const tx = {
    execute: jest.fn(async (statement: SQL) => {
      const query = dialect.sqlToQuery(statement);
      if (query.sql.includes('"actorId"')) return [{ actorId: databaseActor }];
      events.push('latest-work');
      return [
        {
          workRevisionRef: latestRef,
          documentVersionId: revision.documentVersionId,
        },
      ];
    }),
    select: jest.fn(() => ({
      from: (table: unknown) => ({
        where: (predicate: SQL) => {
          const query = dialect.sqlToQuery(predicate);
          const rows = () =>
            table === workItem
              ? [row()]
              : table === assessmentWorkRevision
                ? (() => {
                    const match = [revision, ...historical.values()].find((r) =>
                      query.params.includes(r.workRevisionRef),
                    );
                    return match &&
                      (!query.sql.includes('"created_by_user_id"') ||
                        query.params.includes(ownerId))
                      ? [saved(match)]
                      : [];
                  })()
                : (() => {
                    throw new Error('UNEXPECTED_TABLE');
                  })();
          const limit = () =>
            Object.assign(Promise.resolve(rows()), {
              for: async () => {
                await beforeLock?.();
                return rows();
              },
            });
          return {
            limit,
            orderBy: () => ({
              limit: async () =>
                table === dmDocumentParseRun
                  ? [{ parseRunId: 'PR-NATIVE-1', parseRevision: 1 }]
                  : [{ ...saved(revision), workRevisionRef: latestRef }],
            }),
          };
        },
      }),
    })),
    update: jest.fn(() => ({
      set: (value: { projectionJson: string }) => ({
        where: () => ({
          returning: async () => {
            events.push('update');
            pending = JSON.parse(value.projectionJson);
            await onUpdate?.();
            return [{ workItemId: 'WI-NATIVE' }];
          },
        }),
      }),
    })),
  };
  const transactionContext = new AsyncLocalStorage<boolean>();
  let tail = Promise.resolve();
  const transaction = jest.fn(
    async <T>(
      operation: (db: PostgresJsDatabase) => Promise<T>,
    ): Promise<T> => {
      if (transactionContext.getStore())
        throw new Error('ROOT_POOL_ACQUISITION_WHILE_HELD');
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      events.push('transaction');
      try {
        const result = await transactionContext.run(true, () =>
          operation(tx as never),
        );
        if (pending) current = pending;
        events.push('commit');
        return result;
      } catch (error) {
        events.push('rollback');
        throw error;
      } finally {
        pending = undefined;
        release();
      }
    },
  );
  const rootRead = jest.fn(() => {
    throw new Error('ROOT_POOL_READ_FORBIDDEN');
  });
  const database = {
    transaction,
    select: rootRead,
    execute: rootRead,
    update: rootRead,
  };
  const repository = new MiaodaWorkItemRepository(database as never);
  const registrar = new MiaodaCanonicalWorkItemRegistrarAdapter(repository);
  // Read/loading is outside this test's CAS focus; mutation never replaces the repository.
  registrar.getTenantScopedByWorkItemId = jest.fn(async () =>
    structuredClone(current),
  );
  const grant = () => ({
    allowed: true,
    action: 'REQUEST_OVERALL_REGENERATION',
    accessRoot: { kind: 'WORK_ITEM', id: 'WI-NATIVE' },
    workItemId: 'WI-NATIVE',
    workItemRevision: (pending ?? current).revision,
    requestId: 'REQ-ORIGINAL',
    documentVersionId: 'DV-NATIVE',
    tenantId: 'fixture-tenant',
    actorUserId: ownerId,
    applicationScopeId: 'app_17bzc551rsg',
    authorizationFingerprint: 'fixture-browser-decision',
  });
  const objectAccess = {
    freshRead: jest.fn(async (_input: unknown, db?: PostgresJsDatabase) => {
      if (transactionContext.getStore() && db !== (tx as unknown))
        throw new Error('OBJECT_ACCESS_ROOT_POOL_WHILE_HELD');
      return grant();
    }),
  };
  const proof = tdmsTransactionProofFixture(f);
  const verifier = {
    assertInTransaction: jest.fn(async (input: TdmsNativeTransactionInput) => {
      expect(input.database).toBe(tx);
      events.push('native-guard');
      const caller = (
        input as TdmsNativeTransactionInput & {
          browserCaller?: {
            actor: typeof f.actor;
            workItemId: string;
            documentVersionId: string;
            workRevisionRef: string;
          };
        }
      ).browserCaller;
      if (
        caller &&
        (caller.actor.canonicalSubject.id !== 'owner' ||
          caller.actor.tenantId !== 'fixture-tenant' ||
          caller.workItemId !== 'WI-NATIVE' ||
          caller.documentVersionId !== 'DV-NATIVE' ||
          caller.workRevisionRef !== revision.workRevisionRef ||
          input.runtime !== undefined ||
          input.summaryCaller !== undefined)
      )
        throw new Error('FIXTURE_BROWSER_PROOF_REQUIRED');
      if (
        !caller &&
        (!actualQueue ||
          databaseActor !== 'owner' ||
          input.runtime !== undefined)
      )
        throw new Error('FIXTURE_BROWSER_PROOF_REQUIRED');
      // Independently retained original READ facts, rather than trusting caller fields.
      for (const carrier of input.evidence) {
        const original = authenticEvidence.find(
          (e) =>
            e.kind === 'TDMS_NATIVE_RECORD' &&
            carrier.kind === 'TDMS_NATIVE_RECORD' &&
            e.nativeReadReceipt.receiptRef ===
              carrier.nativeReadReceipt.receiptRef,
        );
        if (!original || JSON.stringify(original) !== JSON.stringify(carrier))
          throw new Error('FIXTURE_EXACT_NATIVE_PROOF_CHANGED');
      }
      await proof(input as never);
    }),
    authorize: rootRead,
    readExactEvidence: rootRead,
    assertCurrentEvidence: rootRead,
  };
  const work = new JobAidWorkRepository(
    database as never,
    {} as never,
    {} as never,
  );
  const jobAid = {
    enqueueOverall: jest.fn(async () => {
      queued = true;
      return { attemptRef: 'OP-REGEN', created: true };
    }),
  };
  const attempts = {
    readExactIdempotency: jest.fn(
      async (input: { baseRevision: number; idempotencyKey: string }) =>
        queued ? queuedAttempt(input.baseRevision, input.idempotencyKey) : null,
    ),
  };
  let queuedTask: OpenClawTaskEnvelope | undefined;
  const reserve = jest.fn(async (input: ReserveActionAttemptInput) => {
    const modelInput = await input.buildModelInput({
      attemptId: 'ATT-REGEN',
      operationRef: 'OP-REGEN',
      triggerRequestId: 'REQ-QUEUE',
      attemptNo: 1,
      createdAt: new Date('2026-10-07T00:00:00Z'),
    });
    queuedTask = sealTaskEnvelope({
      schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
      actionAttemptId: 'ATT-REGEN',
      operationRef: 'OP-REGEN',
      taskType: input.taskType,
      priority: 1,
      tenantId: input.tenantId,
      workItemId: input.workItemId,
      inputRevision: input.inputRevision,
      baseRevision: input.baseRevision,
      documentVersionId: input.documentVersionId,
      sourceRefs: input.sourceRefs ?? [],
      allowedConnectors: input.allowedConnectors ?? [],
      hostResolvedMissingInputs: [],
      modelInput,
      deadline: '2099-01-01T00:00:00Z',
      idempotencyKey: input.idempotencyKey,
    });
    queued = true;
    return { task: queuedTask, created: true };
  });
  const actualJobAid = new CanonicalJobAidProblemService(
    registrar,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { reserve } as never,
    {
      loadTenantScopedProjection: async () => ({
        row: { ...row(), initialAilySessionId: null },
      }),
    } as never,
    {
      hasActiveOfficialActorMapping: async () => f.control.authenticated,
    } as never,
    {} as never,
    work,
    undefined,
    undefined,
    undefined,
    database as never,
    undefined,
    objectAccess as never,
    undefined,
    verifier as never,
  );
  if (actualQueue)
    jobAid.enqueueOverall = jest.fn(
      actualJobAid.enqueueOverall.bind(actualJobAid),
    ) as typeof jobAid.enqueueOverall;
  const service = new CanonicalHostOverallRegenerationService(
    { resolve: async () => ({ actor: f.actor }) } as never,
    objectAccess as never,
    registrar,
    { nowIso: () => '2026-10-07T10:00:00Z' },
    {} as never,
    attempts as never,
    jobAid as never,
  );
  // New optional dependencies are populated like Nest injection; no guard method is mocked.
  Object.assign(service, { database, work, nativeVerifier: verifier });
  const input = {
    requestId: 'REQ-REGEN',
    expectedRevision: 12,
    sourceIdentity,
  };
  return {
    f,
    service,
    input,
    tx,
    database,
    verifier,
    events,
    original,
    originalWork,
    originalReceipts,
    revision,
    jobAid,
    attempts,
    objectAccess,
    rootRead,
    addIndependentHistoricalCarriers: async () => {
      historical.set(revision.workRevisionRef, structuredClone(revision));
      const oldBase = structuredClone(current.integratedAssessment!.baseRules);
      const fresh = (
        await f.adapter.read(f.principal, {
          context,
          evidenceRefs: context.projection.selectedSetApprovedRefs,
          purpose: 'JOB_AID_NATIVE_RECORD',
          taskContextRef: f.binding.taskContextRef,
        })
      ).evidence;
      authenticEvidence.push(...structuredClone(fresh));
      revision.workRevisionRef = 'JAWR-NATIVE-2';
      revision.workRevision = 2;
      revision.content.evidence = fresh;
      latestRef = revision.workRevisionRef;
      current.integratedAssessment!.baseRules = {
        ...oldBase,
        workRevisionRef: revision.workRevisionRef,
        workRevision: revision.workRevision,
        readingResult: jobAidReadingResult(revision),
      } as never;
      Object.assign(current, {
        configurationEvidenceReevaluation: {
          stagedBundle: { baseRules: oldBase },
        },
      });
    },
    queuedTask: () => queuedTask,
    reserve,
    current: () => current,
    setCurrent: (value: CanonicalWorkItemProjection) => {
      current = value;
    },
    onUpdate: (fn: typeof onUpdate) => {
      onUpdate = fn;
    },
    beforeLock: (fn: typeof beforeLock) => {
      beforeLock = fn;
    },
    latest: (ref: string) => {
      latestRef = ref;
    },
    owner: (id: string) => {
      ownerId = id;
    },
    actor: (id: string) => {
      databaseActor = id;
    },
    request: () => service.request('WI-NATIVE', input, {} as never),
  };
}

test('actual browser service → registrar → repository CAS retains exact native work and queues once', async () => {
  const h = await harness();
  await expect(h.request()).resolves.toMatchObject({
    replayed: false,
    regeneration: { executionRevision: 13 },
  });
  expect(h.current().revision).toBe(13);
  expect(h.current().integratedAssessment?.baseRules).toEqual(
    h.original.integratedAssessment?.baseRules,
  );
  expect(
    h.current().integratedAssessment?.overallSynthesis?.readingResult,
  ).toEqual(h.original.integratedAssessment?.overallSynthesis?.readingResult);
  expect(h.revision).toEqual(h.originalWork);
  expect(h.f.receipts).toEqual(h.originalReceipts);
  expect(h.verifier.assertInTransaction).toHaveBeenCalledTimes(2);
  expect(h.events).toEqual([
    'transaction',
    'latest-work',
    'native-guard',
    'update',
    'native-guard',
    'commit',
  ]);
  expect(h.jobAid.enqueueOverall).toHaveBeenCalledTimes(1);
  expect(h.rootRead).not.toHaveBeenCalled();
});

test.each(['missing-provider', 'missing-capability'] as const)(
  '%s keeps native regeneration fail-closed',
  async (mode) => {
    const h = await harness();
    if (mode === 'missing-provider')
      Object.assign(h.service, { nativeVerifier: undefined });
    else Reflect.deleteProperty(h.verifier, 'assertInTransaction');
    await expect(h.request()).rejects.toThrow(
      'TDMS_NATIVE_TRANSACTION_AUTHORIZATION_NOT_CONNECTED',
    );
    expect(h.tx.update).not.toHaveBeenCalled();
    expect(h.database.transaction).not.toHaveBeenCalled();
    expect(h.current()).toEqual(h.original);
    expect(h.jobAid.enqueueOverall).not.toHaveBeenCalled();
  },
);

test.each([
  'authenticated',
  'applicationAllowed',
  'sourceAllowed',
  'objectAllowed',
  'documentAllowed',
] as const)('revoked %s denies before write', async (permission) => {
  const h = await harness();
  h.f.control[permission] = false;
  await expect(h.request()).rejects.toThrow(
    'FIXTURE_NATIVE_TRANSACTION_PROOF_REVOKED',
  );
  expect(h.tx.update).not.toHaveBeenCalled();
  expect(h.current()).toEqual(h.original);
  expect(h.jobAid.enqueueOverall).not.toHaveBeenCalled();
});

test('revocation during awaited persistence rolls back stale marker and every retained carrier', async () => {
  const h = await harness();
  h.onUpdate(async () => {
    await Promise.resolve();
    h.f.control.sourceAllowed = false;
  });
  await expect(h.request()).rejects.toThrow(
    'FIXTURE_NATIVE_TRANSACTION_PROOF_REVOKED',
  );
  expect(h.verifier.assertInTransaction).toHaveBeenCalledTimes(2);
  expect(h.events.at(-1)).toBe('rollback');
  expect(h.current()).toEqual(h.original);
  expect(h.revision).toEqual(h.originalWork);
  expect(h.f.receipts).toEqual(h.originalReceipts);
  expect(h.jobAid.enqueueOverall).not.toHaveBeenCalled();
});

test('selected-set generation advancement refuses to rebind historical native evidence', async () => {
  const h = await harness();
  h.f.head.generation += 1;
  await expect(h.request()).rejects.toThrow(
    'FIXTURE_NATIVE_TRANSACTION_PROOF_REVOKED',
  );
  expect(h.tx.update).not.toHaveBeenCalled();
  expect(h.current()).toEqual(h.original);
});

test('latest JobAid work changed before lock refuses the old source work', async () => {
  const h = await harness();
  h.beforeLock(() => h.latest('JAWR-NATIVE-2'));
  await expect(h.request()).rejects.toThrow(
    'JOBAID_OVERALL_EXACT_WORK_CHANGED',
  );
  expect(h.verifier.assertInTransaction).not.toHaveBeenCalled();
  expect(h.tx.update).not.toHaveBeenCalled();
});

test.each(['actor', 'owner'] as const)(
  'same database %s binding is mandatory',
  async (binding) => {
    const h = await harness();
    h.beforeLock(() => h[binding]('foreign-user'));
    await expect(h.request()).rejects.toThrow(
      binding === 'actor'
        ? 'JOBAID_REQUEST_ACTOR_CONTEXT_REQUIRED'
        : 'WORK_ITEM_CAS_CONFLICT',
    );
    expect(h.tx.update).not.toHaveBeenCalled();
    expect(h.current()).toEqual(h.original);
  },
);

test.each(['baseRules', 'overallSynthesis', 'stagedBaseRules'] as const)(
  'forged retained %s native carrier cannot receive a blanket guard',
  async (slot) => {
    const h = await harness();
    const item = h.current();
    if (slot === 'stagedBaseRules')
      Object.assign(item, {
        configurationEvidenceReevaluation: {
          stagedBundle: {
            baseRules: structuredClone(item.integratedAssessment!.baseRules),
          },
        },
      });
    const projection =
      slot === 'stagedBaseRules'
        ? (item.configurationEvidenceReevaluation as any).stagedBundle.baseRules
        : item.integratedAssessment![slot];
    (projection as any).readingResult.evidence[0].excerpt =
      'forged retained bytes';
    await expect(h.request()).rejects.toThrow(
      'TDMS_NATIVE_PROJECTION_WORK_MISMATCH',
    );
    expect(h.tx.update).not.toHaveBeenCalled();
  },
);

test('unchanged request replay re-verifies native facts without rewriting history or queuing twice', async () => {
  const h = await harness();
  await h.request();
  const saved = structuredClone(h.current());
  await expect(h.request()).resolves.toMatchObject({ replayed: true });
  expect(h.tx.update).toHaveBeenCalledTimes(1);
  expect(h.jobAid.enqueueOverall).toHaveBeenCalledTimes(1);
  expect(h.verifier.assertInTransaction).toHaveBeenCalledTimes(3);
  expect(h.current()).toEqual(saved);
  expect(h.rootRead).not.toHaveBeenCalled();
});

test('replay cannot borrow an already queued attempt after permission revocation', async () => {
  const h = await harness();
  await h.request();
  h.f.control.sourceAllowed = false;
  await expect(h.request()).rejects.toThrow(
    'FIXTURE_NATIVE_TRANSACTION_PROOF_REVOKED',
  );
  expect(h.tx.update).toHaveBeenCalledTimes(1);
  expect(h.jobAid.enqueueOverall).toHaveBeenCalledTimes(1);
});

test('concurrent distinct request ids have one exact CAS winner and one conflict', async () => {
  const h = await harness();
  const results = await Promise.allSettled([
    h.request(),
    h.service.request(
      'WI-NATIVE',
      { ...h.input, requestId: 'REQ-COMPETITOR' },
      {} as never,
    ),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const failed = results.find(
    (r) => r.status === 'rejected',
  ) as PromiseRejectedResult;
  expect(failed.reason.message).toBe('WORK_ITEM_CAS_CONFLICT');
  expect(h.current().revision).toBe(13);
  expect(h.tx.update).toHaveBeenCalledTimes(1);
  expect(h.jobAid.enqueueOverall).toHaveBeenCalledTimes(1);
});

function queuedAttempt(
  baseRevision: number,
  idempotencyKey: string,
): ActionAttemptRow {
  const task = sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-REGEN',
    operationRef: 'OP-REGEN',
    taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
    priority: 100,
    tenantId: 'fixture-tenant',
    workItemId: 'WI-NATIVE',
    inputRevision: baseRevision,
    baseRevision,
    documentVersionId: 'DV-NATIVE',
    sourceRefs: [],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput: { operation: 'SYNTHESIZE_OVERALL_CANDIDATE' },
    deadline: '2026-08-29T06:00:00.000Z',
    idempotencyKey,
  });
  const now = new Date('2026-08-29T05:00:00.000Z');
  return {
    attemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    triggerRequestId: 'REQ-ATTEMPT-1',
    workItemId: task.workItemId,
    actionType: task.taskType,
    attemptNo: 2,
    status: 'QUEUED',
    requestOrigin: 'OPENCLAW_MCP_V1',
    tenantId: task.tenantId,
    actorUserId: 'service:openclaw-main',
    priority: task.priority,
    inputRevision: task.inputRevision,
    baseRevision: task.baseRevision,
    documentVersionId: task.documentVersionId,
    taskEnvelopeJson: canonicalJson(task),
    taskInputHash: task.inputHash,
    resultEnvelopeJson: null,
    resultContentHash: null,
    idempotencyKey: task.idempotencyKey,
    claimCount: 0,
    retryCount: 0,
    maxAttempts: 3,
    leaseOwner: null,
    leaseToken: null,
    leaseGeneration: 0,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    nextAttemptAt: now,
    deadlineAt: new Date(task.deadline),
    cancelRequestedAt: null,
    cancelReason: null,
    terminalReason: null,
    projectionApplied: false,
    executorSessionKey: null,
    commitStartedAt: null,
    leaseSlot: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

test('existing exact attempt replay survives a successor saved work without requeuing', async () => {
  const h = await harness();
  await h.request();
  h.latest('JAWR-NATIVE-2');
  await expect(h.request()).resolves.toMatchObject({ replayed: true });
  expect(h.tx.update).toHaveBeenCalledTimes(1);
  expect(h.jobAid.enqueueOverall).toHaveBeenCalledTimes(1);
  expect(h.current().integratedAssessment?.baseRules).toEqual(
    h.original.integratedAssessment?.baseRules,
  );
});

test('a missing-attempt recovery still rejects successor work', async () => {
  const h = await harness();
  await h.request();
  h.latest('JAWR-NATIVE-2');
  h.attempts.readExactIdempotency.mockResolvedValue(null);
  await expect(h.request()).rejects.toThrow(
    'JOBAID_OVERALL_EXACT_WORK_CHANGED',
  );
  expect(h.tx.update).toHaveBeenCalledTimes(1);
  expect(h.jobAid.enqueueOverall).toHaveBeenCalledTimes(1);
});

test('actual browser CAS continues through real JobAid enqueueOverall into metadata-only reservation', async () => {
  const h = await harness(true);
  await expect(h.request()).resolves.toMatchObject({ replayed: false });
  const task = h.queuedTask()!;
  expect(task).toBeDefined();
  expect(readInitialAnalysisRequestInput(task)?.nativeOverallAdmission).toEqual(
    {
      workRevisionRef: 'JAWR-NATIVE-1',
      workRevision: 1,
      regenerationRequestId: 'REQ-REGEN',
    },
  );
  expect(task.idempotencyKey).toBe(
    'openclaw-v1:overall:WI-NATIVE:13:USER_REQUESTED_REGENERATION:REQ-REGEN',
  );
  expect(task.modelInput).not.toHaveProperty('tdmsContext');
  expect(JSON.stringify(task.modelInput)).not.toContain('Only if installed');
  expect(h.rootRead).not.toHaveBeenCalled();
  expect(h.reserve).toHaveBeenCalledTimes(1);
});

test.each(['baseRules', 'overallSynthesis', 'stagedBaseRules'] as const)(
  'stripped retained %s native carrier fails exact-work comparison',
  async (slot) => {
    const h = await harness();
    const item = h.current();
    if (slot === 'stagedBaseRules')
      Object.assign(item, {
        configurationEvidenceReevaluation: {
          stagedBundle: {
            baseRules: structuredClone(item.integratedAssessment!.baseRules),
          },
        },
      });
    const projection =
      slot === 'stagedBaseRules'
        ? (item.configurationEvidenceReevaluation as any).stagedBundle.baseRules
        : item.integratedAssessment![slot];
    (projection as any).readingResult.evidence = [];
    await expect(h.request()).rejects.toThrow(
      'TDMS_NATIVE_PROJECTION_WORK_MISMATCH',
    );
    expect(h.tx.update).not.toHaveBeenCalled();
  },
);

test('distinct original receipts survive across base, historical Overall, and staged exact work', async () => {
  const h = await harness();
  await h.addIndependentHistoricalCarriers();
  const before = structuredClone(h.current());
  await expect(h.request()).resolves.toMatchObject({ replayed: false });
  const carriers = h.verifier.assertInTransaction.mock.calls[0][0].evidence;
  expect(carriers).toHaveLength(4);
  expect(
    new Set(
      carriers.map((e) =>
        e.kind === 'TDMS_NATIVE_RECORD' ? e.nativeReadReceipt.receiptRef : '',
      ),
    ),
  ).toHaveProperty('size', 4);
  expect(h.current().integratedAssessment?.baseRules).toEqual(
    before.integratedAssessment?.baseRules,
  );
  expect(
    h.current().integratedAssessment?.overallSynthesis?.readingResult,
  ).toEqual(before.integratedAssessment?.overallSynthesis?.readingResult);
  expect(h.current().configurationEvidenceReevaluation).toEqual(
    before.configurationEvidenceReevaluation,
  );
});

test('coordinated saved-work and projection metadata forgery still fails independently retained proof', async () => {
  const h = await harness();
  const item = h.current();
  const carrier = h.revision.content.evidence[0];
  if (carrier.kind !== 'TDMS_NATIVE_RECORD') throw new Error('fixture');
  carrier.nativeScope.processingSetBinding.memberRef = 'forged-member';
  (item.integratedAssessment!.baseRules as any).readingResult =
    jobAidReadingResult(h.revision);
  item.integratedAssessment!.overallSynthesis!.readingResult =
    jobAidReadingResult(h.revision);
  await expect(h.request()).rejects.toThrow(
    'FIXTURE_EXACT_NATIVE_PROOF_CHANGED',
  );
  expect(h.tx.update).not.toHaveBeenCalled();
});
