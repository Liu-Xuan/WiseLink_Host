import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type {
  CanonicalWorkItemProjection,
  CanonicalBaseRuleCandidateProjection,
} from '@shared/api.interface';
import {
  JOBAID_PROBLEM_RESULT_SCHEMA,
  JOBAID_PROBLEM_WORK_SCHEMA,
  jobAidReadingResult,
  type JobAidWorkRevision,
} from '@shared/jobaid-problem-assessment.interface';
import type { JobAidProblemTaskInput } from '@server/modules/canonical-host/jobaid-problem-task';
import type { CanonicalVerifiedOpenClawAttemptScope } from '@server/modules/canonical-host/canonical-service-scope.authorization';
import { CanonicalJobAidProblemService } from '@server/modules/canonical-host/canonical-jobaid-problem.service';
import { JobAidWorkRepository } from '@server/modules/canonical-host/jobaid-work.repository';
import { EngineeringMatterWorkingRepository } from '@server/modules/canonical-host/engineering-matter-working.repository';
import { MiaodaWorkItemRepository } from '@server/modules/work-item/miaoda-work-item.repository';
import { JOBAID_METHOD_BINDING } from '@server/modules/canonical-host/jobaid-method-pack';
import {
  assessmentWorkRevision,
  workItem,
  identitySubjectMapping,
  actionAttempt,
} from '@server/database/schema';
import { assertTdmsNativeInTransaction } from '@server/modules/canonical-host/tdms-native-evidence-verifier.port';
import type { ActionAttemptRow } from '@server/modules/action-attempt/action-attempt.types';
import { tdmsRuntimeFixture } from './fixtures/tdms-runtime.fixture';

async function harness() {
  const f = tdmsRuntimeFixture({
    tenantId: 'fixture-tenant',
    actorUserId: 'owner-held',
    workItemId: 'WI-HELD',
    documentVersionId: 'DV-HELD',
    taskContextRef: 'OP-HELD',
  });
  f.principal.scope.appId = 'app_17bzc551rsg';
  Object.assign(f.principal.scope, { attemptRef: 'OP-HELD' });
  f.actor.applicationScopeId = f.principal.scope.appId;
  f.actor.subjectDecision.applicationScopeId = f.principal.scope.appId;
  const context = await f.adapter.discover(f.principal, f.binding);
  const read = await f.adapter.read(f.principal, {
    context,
    evidenceRefs: [context.projection.selectedSetApprovedRefs[0]],
    purpose: 'JOB_AID_NATIVE_RECORD',
    taskContextRef: f.binding.taskContextRef,
  });
  const native = read.evidence[0];
  const revision: JobAidWorkRevision = {
    workRevisionRef: 'JAWR-HELD-1',
    workItemId: 'WI-HELD',
    workRevision: 1,
    previousWorkRevisionRef: null,
    requestId: 'SAVE-HELD',
    actionAttemptId: 'ATT-HELD',
    basedOnWorkItemRevision: 1,
    documentVersionId: 'DV-HELD',
    createdAt: '2026-10-07T00:00:00.000Z',
    content: {
      schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA,
      overviewStatus: 'CURRENT',
      headline: 'Conditional source opinion',
      listBrief: 'Verify configuration',
      understanding: 'Execution remains unknown.',
      decisiveIssueKeys: [],
      issues: [],
      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
      completionReason: 'Read exact native source',
      changeSummary: 'Recorded candidate',
      unchangedExplanation: 'No adoption',
      methodBinding: structuredClone(JOBAID_METHOD_BINDING),
      evidence: [native],
      readSourceRefs: [native.evidenceRef],
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
  const scope: CanonicalVerifiedOpenClawAttemptScope = {
    ...f.principal.scope,
    attemptRef: 'OP-HELD',
  };
  const task = {
    actorUserId: 'owner-held',
    tdmsContext: context,
  } as unknown as JobAidProblemTaskInput;
  const projection = {
    schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
    workRevisionRef: revision.workRevisionRef,
    workRevision: revision.workRevision,
    readingResult: jobAidReadingResult(revision),
  } as CanonicalBaseRuleCandidateProjection;
  const stored = {
    assessmentWorkRevisionId: revision.workRevisionRef,
    tenantId: scope.tenantId,
    createdByUserId: 'owner-held',
    workItemId: revision.workItemId,
    workRevision: revision.workRevision,
    previousWorkRevisionId: null,
    requestId: revision.requestId,
    actionAttemptId: revision.actionAttemptId,
    basedOnWorkItemRevision: 1,
    documentVersionId: revision.documentVersionId,
    createdAt: new Date(revision.createdAt),
    contentJson: JSON.stringify(revision.content),
  };
  let held = false;
  let activeActor = 'ambient';
  let isHostedService = true;
  let allowed = true;
  let revokeOnUpdate = false;
  let committed = false;
  let writeMode = false;
  const attempt = {
    attemptId: 'ATT-HELD',
    operationRef: 'OP-HELD',
    tenantId: 'fixture-tenant',
    workItemId: 'WI-HELD',
    taskInputHash: 'hash-held',
    baseRevision: 1,
    documentVersionId: 'DV-HELD',
    actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
    status: 'RUNNING',
    leaseOwner: scope.principalId,
    leaseToken: 'held-lease',
    leaseGeneration: 1,
    leaseExpiresAt: new Date('2099-01-01'),
    deadlineAt: new Date('2099-01-01'),
    cancelRequestedAt: null,
    reviewActivityJson: '[]',
  } as ActionAttemptRow;
  const sourceBinding = {
    kind: 'SOURCE_FILE' as const,
    workItemId: 'WI-HELD',
    documentVersionId: 'DV-HELD',
    artifactRef: 'ART-HELD',
    artifactSha256: 'a'.repeat(64),
  };
  const writeOwner = {
    revision: 1,
    workItemId: 'WI-HELD',
    documentVersionId: 'DV-HELD',
    requestedByUserId: 'owner-held',
    projectionJson: JSON.stringify({
      source: {
        sourceArtifactId: sourceBinding.artifactRef,
        sourceFileSha256: sourceBinding.artifactSha256,
      },
    }),
  };
  const events: string[] = [];
  const predicates: Array<ReturnType<PgDialect['sqlToQuery']>> = [];
  const dialect = new PgDialect();
  const update = jest.fn(() => ({
    set: () => ({
      where: () => {
        const persist = async () => {
          events.push('update');
          await Promise.resolve();
          if (revokeOnUpdate) allowed = false;
          return [{ workItemId: scope.workItemId }];
        };
        return {
          returning: persist,
          then: (
            resolve: (value: unknown) => void,
            reject: (error: unknown) => void,
          ) => persist().then(resolve, reject),
        };
      },
    }),
  }));
  const insert = jest.fn(() => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        events.push('insert');
        await Promise.resolve();
        if (revokeOnUpdate) allowed = false;
        return [{ ...stored, ...values }];
      },
    }),
  }));
  const transaction = {
    execute: jest.fn(async (statement: SQL) => {
      const query = dialect.sqlToQuery(statement);
      if (query.sql.includes('"isHostedService"')) {
        events.push('transaction-role');
        return [{ isHostedService }];
      }
      events.push('latest-work');
      return [
        {
          workRevisionRef: revision.workRevisionRef,
          documentVersionId: revision.documentVersionId,
        },
      ];
    }),
    select: jest.fn(() => ({
      from: (table: unknown) => ({
        where: (predicate: SQL) => {
          predicates.push(dialect.sqlToQuery(predicate));
          if (table === identitySubjectMapping)
            return { limit: async () => [{ id: 'offline-owner-mapping' }] };
          if (table === actionAttempt) return { for: async () => [attempt] };
          if (table === workItem)
            return {
              for: async () => [writeOwner],
              limit: () => ({ for: async () => [writeOwner] }),
            };
          if (writeMode && table === assessmentWorkRevision)
            return {
              limit: async () => [],
              orderBy: () => ({ limit: async () => [] }),
            };
          if (table !== assessmentWorkRevision)
            throw new Error('UNEXPECTED_TABLE');
          const query = dialect.sqlToQuery(predicate);
          const expectedColumns = [
            'tenant_id',
            'work_item_id',
            'assessment_work_revision_id',
            'created_by_user_id',
          ];
          for (const column of expectedColumns)
            expect(query.sql).toContain(
              `"assessment_work_revision"."${column}"`,
            );
          expect(query.params).toEqual(
            expect.arrayContaining([
              'fixture-tenant',
              'WI-HELD',
              'JAWR-HELD-1',
              'owner-held',
            ]),
          );
          events.push(`saved-read:${activeActor}`);
          return {
            limit: async () =>
              activeActor === stored.createdByUserId &&
              [
                stored.tenantId,
                stored.workItemId,
                stored.assessmentWorkRevisionId,
                stored.createdByUserId,
              ].every((value) => query.params.includes(value))
                ? [stored]
                : [],
          };
        },
      }),
    })),
    update,
    insert,
  };
  const root = {
    execute: jest.fn(async () => {
      if (writeMode && !held) {
        events.push('root-admission-role');
        return [{ isHostedService }];
      }
      throw new Error(held ? 'ROOT_POOL_EXHAUSTED' : 'ROOT_POOL_UNEXPECTED');
    }),
    transaction: jest.fn(
      async (run: (database: typeof transaction) => Promise<unknown>) => {
        if (held) throw new Error('ROOT_POOL_EXHAUSTED');
        held = true;
        try {
          const result = await run(transaction);
          committed = true;
          events.push('commit');
          return result;
        } catch (error) {
          events.push('rollback');
          throw error;
        } finally {
          held = false;
        }
      },
    ),
  };
  const middleware = {
    use: jest.fn(
      (
        request: { userContext: { userId: string; isSystemAccount: boolean } },
        _response: unknown,
        next: () => void,
      ) => {
        expect(request.userContext.isSystemAccount).toBe(true);
        activeActor = request.userContext.userId;
        events.push(`actor:${activeActor}`);
        next();
      },
    ),
  };
  const actors = new EngineeringMatterWorkingRepository(
    root as never,
    middleware as never,
    { roleSchema: 'fixture' },
    {} as never,
  );
  const searchProjection = { enqueuePending: jest.fn(async () => undefined) };
  const work = new JobAidWorkRepository(
    root as never,
    actors,
    searchProjection as never,
  );
  const ordinary = jest.fn(async () => {
    throw new Error(
      held
        ? 'ORDINARY_NATIVE_READER_UNDER_HELD_TRANSACTION'
        : 'UNEXPECTED_NATIVE_READER',
    );
  });
  const verifier = {
    authorize: ordinary,
    readExactEvidence: ordinary,
    assertCurrentEvidence: ordinary,
    assertInTransaction: jest.fn(
      async (input: {
        database: PostgresJsDatabase;
        actor: { tenantId: string; actorUserId: string };
        runtime: {
          principal: {
            scope: CanonicalVerifiedOpenClawAttemptScope;
            actorUserId: string;
          };
          context: unknown;
        };
        evidence: unknown[];
      }) => {
        expect(input.database).toBe(transaction);
        expect(held).toBe(true);
        expect(input.actor).toEqual({
          tenantId: scope.tenantId,
          actorUserId: 'owner-held',
        });
        expect(input.runtime).toEqual({
          principal: { scope, actorUserId: 'owner-held' },
          context: task.tdmsContext,
        });
        expect(input.evidence).toEqual([native]);
        if (!allowed) throw new Error('FIXTURE_NATIVE_PROOF_REVOKED');
        events.push('transaction-native-proof');
      },
    ),
  };
  const service = new CanonicalJobAidProblemService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    work,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      discover: ordinary,
      read: ordinary,
      assertAuthorized: ordinary,
      verifyEvidence: ordinary,
    } as never,
    verifier as never,
  );
  const guard = service as unknown as {
    assertNativeProjectionAuthorized(
      projection: CanonicalBaseRuleCandidateProjection,
      task: JobAidProblemTaskInput,
      scope: CanonicalVerifiedOpenClawAttemptScope,
      database: PostgresJsDatabase,
    ): Promise<void>;
  };
  const repository = new MiaodaWorkItemRepository(root as never);
  const next = {
    workItemId: scope.workItemId,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    source: { documentVersionId: 'DV-HELD' },
    package: null,
    failure: null,
    recordingFailure: null,
    integratedAssessment: { baseRules: projection },
  } as unknown as Omit<CanonicalWorkItemProjection, 'revision'>;
  const commit = () =>
    repository.compareAndSet({
      workItemId: scope.workItemId,
      expectedRevision: 1,
      next,
      syncPrimaryAttempt: false,
      jobAidWorkRevisionGuard: {
        tenantId: scope.tenantId,
        workRevisionRef: revision.workRevisionRef,
      },
      nativeEvidenceGuard: (database) =>
        guard.assertNativeProjectionAuthorized(
          projection,
          task,
          scope,
          database,
        ),
    });
  const writeGuard = (database: PostgresJsDatabase) =>
    assertTdmsNativeInTransaction(
      {
        database,
        actor: { tenantId: scope.tenantId, actorUserId: task.actorUserId },
        runtime: {
          principal: { scope, actorUserId: task.actorUserId },
          context: task.tdmsContext!,
        },
        evidence: [native],
      },
      verifier as never,
    );
  const writeBase = {
    row: attempt,
    actorUserId: 'owner-held',
    sourceBindings: [sourceBinding],
    fence: {
      principalId: scope.principalId,
      leaseToken: 'held-lease',
      leaseGeneration: 1,
    },
    assertNativeAuthorized: writeGuard,
  };
  const journal = () => {
    writeMode = true;
    return work.recordSourceRead({
      ...writeBase,
      sourceRefs: [native.evidenceRef],
      purpose: 'held native read',
      nativeEvidence: [native],
    });
  };
  const save = () => {
    writeMode = true;
    return work.save({
      ...writeBase,
      requestId: 'SAVE-HELD-NEW',
      expectedWorkRevision: 0,
      command: { kind: 'offline' },
      content: revision.content,
    });
  };
  return {
    commit,
    journal,
    save,
    searchProjection,
    root,
    transaction,
    ordinary,
    verifier,
    work,
    actors,
    middleware,
    events,
    predicates,
    stored,
    scope,
    task,
    projection,
    setHosted: (value: boolean) => {
      isHostedService = value;
    },
    revoke: () => {
      allowed = false;
    },
    revokeDuringUpdate: () => {
      revokeOnUpdate = true;
    },
    committed: () => committed,
  };
}

test('native CAS uses its held executor through real JobAid and actor repositories with no root-pool acquisition', async () => {
  const h = await harness();
  await expect(h.commit()).resolves.toMatchObject({
    workItemId: 'WI-HELD',
    revision: 2,
  });
  expect(h.root.execute).not.toHaveBeenCalled();
  expect(h.root.transaction).toHaveBeenCalledTimes(1);
  expect(h.ordinary).not.toHaveBeenCalled();
  expect(h.verifier.assertInTransaction).toHaveBeenCalledTimes(2);
  expect(h.events).toContain('saved-read:owner-held');
});

test('missing transaction-native verifier capability denies before saved-work reads', async () => {
  const h = await harness();
  Reflect.deleteProperty(h.verifier, 'assertInTransaction');
  await expect(h.commit()).rejects.toThrow('TRANSACTION');
  expect(h.root.execute).not.toHaveBeenCalled();
  expect(h.root.transaction).toHaveBeenCalledTimes(1);
  expect(h.events.some((event) => event.startsWith('saved-read:'))).toBe(false);
  expect(h.transaction.update).not.toHaveBeenCalled();
  expect(h.ordinary).not.toHaveBeenCalled();
});

test('a non-service database role cannot enter the owner scope inside the held transaction', async () => {
  const h = await harness();
  h.setHosted(false);
  await expect(h.commit()).rejects.toThrow();
  expect(h.events).toContain('transaction-role');
  expect(h.middleware.use).not.toHaveBeenCalled();
  expect(h.root.execute).not.toHaveBeenCalled();
  expect(h.root.transaction).toHaveBeenCalledTimes(1);
  expect(h.transaction.update).not.toHaveBeenCalled();
  expect(h.ordinary).not.toHaveBeenCalled();
});

test.each([
  'tenant',
  'owner',
  'work-item',
  'work-ref',
  'document',
  'revision',
] as const)(
  'held transaction rejects a saved-work row with foreign %s',
  async (mismatch) => {
    const h = await harness();
    if (mismatch === 'tenant') h.stored.tenantId = 'foreign-tenant';
    if (mismatch === 'owner') h.stored.createdByUserId = 'foreign-owner';
    if (mismatch === 'work-item') h.stored.workItemId = 'WI-FOREIGN';
    if (mismatch === 'work-ref')
      h.stored.assessmentWorkRevisionId = 'JAWR-FOREIGN';
    if (mismatch === 'document') h.stored.documentVersionId = 'DV-FOREIGN';
    if (mismatch === 'revision') h.stored.workRevision = 99;
    await expect(h.commit()).rejects.toThrow(
      'TDMS_NATIVE_PROJECTION_WORK_MISMATCH',
    );
    expect(h.root.execute).not.toHaveBeenCalled();
    expect(h.root.transaction).toHaveBeenCalledTimes(1);
    expect(h.transaction.update).not.toHaveBeenCalled();
    expect(h.ordinary).not.toHaveBeenCalled();
    expect(h.verifier.assertInTransaction).not.toHaveBeenCalled();
    expect(h.committed()).toBe(false);
  },
);

test('revoked native source proof denies inside the held transaction before the update', async () => {
  const h = await harness();
  h.revoke();
  await expect(h.commit()).rejects.toThrow('FIXTURE_NATIVE_PROOF_REVOKED');
  expect(h.root.execute).not.toHaveBeenCalled();
  expect(h.root.transaction).toHaveBeenCalledTimes(1);
  expect(h.transaction.update).not.toHaveBeenCalled();
  expect(h.ordinary).not.toHaveBeenCalled();
  expect(h.committed()).toBe(false);
});

test('late native proof revocation after the awaited update rolls back the same held transaction', async () => {
  const h = await harness();
  h.revokeDuringUpdate();
  await expect(h.commit()).rejects.toThrow('FIXTURE_NATIVE_PROOF_REVOKED');
  expect(h.root.execute).not.toHaveBeenCalled();
  expect(h.root.transaction).toHaveBeenCalledTimes(1);
  expect(h.transaction.update).toHaveBeenCalledTimes(1);
  expect(h.ordinary).not.toHaveBeenCalled();
  expect(h.verifier.assertInTransaction).toHaveBeenCalledTimes(2);
  expect(h.events.at(-1)).toBe('rollback');
  expect(h.committed()).toBe(false);
});

describe.each(['journal', 'save'] as const)(
  'actual JobAid %s repository held transaction',
  (operation) => {
    test('uses one admitted transaction and supplied native proof without nested root acquisitions', async () => {
      const h = await harness();
      await h[operation]();
      expect(h.root.execute).toHaveBeenCalledTimes(1);
      expect(
        h.events.filter((event) => event === 'root-admission-role'),
      ).toHaveLength(1);
      expect(h.root.transaction).toHaveBeenCalledTimes(1);
      expect(h.ordinary).not.toHaveBeenCalled();
      expect(h.verifier.assertInTransaction).toHaveBeenCalledTimes(3);
      expect(h.committed()).toBe(true);
    });
    test('rolls back after persistence when the exact native proof is revoked', async () => {
      const h = await harness();
      h.revokeDuringUpdate();
      await expect(h[operation]()).rejects.toThrow(
        'FIXTURE_NATIVE_PROOF_REVOKED',
      );
      expect(h.root.execute).toHaveBeenCalledTimes(1);
      expect(h.root.transaction).toHaveBeenCalledTimes(1);
      expect(h.ordinary).not.toHaveBeenCalled();
      expect(h.committed()).toBe(false);
      expect(h.events.at(-1)).toBe('rollback');
    });
  },
);
