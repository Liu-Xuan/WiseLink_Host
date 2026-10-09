import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type {
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';
import type { AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';
import {
  JOBAID_PROBLEM_RESULT_SCHEMA,
  JOBAID_PROBLEM_WORK_SCHEMA,
  jobAidReadingResult,
  type JobAidWorkRevision,
} from '@shared/jobaid-problem-assessment.interface';
import {
  canonicalJson,
  sealResultEnvelope,
  sealTaskEnvelope,
} from '@server/modules/action-attempt/action-attempt-envelope';
import type { ActionAttemptRow } from '@server/modules/action-attempt/action-attempt.types';
import { CanonicalJobAidProblemService } from '@server/modules/canonical-host/canonical-jobaid-problem.service';
import { CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY } from '@server/modules/canonical-host/canonical-host-openclaw-runtime-policy';
import { projectCommonAssessmentContext } from '@server/modules/canonical-host/canonical-host-common-context.service';
import type { CanonicalWorkItemRegistrarPort } from '@server/modules/canonical-host/canonical-host.types';
import { buildJobAidProblemTask } from '@server/modules/canonical-host/jobaid-problem-task';
import { JOBAID_METHOD_BINDING } from '@server/modules/canonical-host/jobaid-method-pack';
import type { JobAidWorkRepository } from '@server/modules/canonical-host/jobaid-work.repository';
import type {
  TdmsNativeEvidenceActor,
  TdmsNativeEvidenceVerifier,
} from '@server/modules/canonical-host/tdms-native-evidence-verifier.port';
import { tdmsRuntimeFixture } from './fixtures/tdms-runtime.fixture';
import { tdmsTransactionProofFixture } from './fixtures/tdms-transaction-native-verifier.fixture';

type Kind = 'BASE' | 'OVERALL';
type CasInput = Parameters<CanonicalWorkItemRegistrarPort['compareAndSet']>[0];
const artifact: UnifiedPackageArtifactDescriptor = {
  ref: 'artifact://native-commit',
  sha256: 'b'.repeat(64),
  byteLength: 100,
  mediaType: 'application/json',
  storeRole: 'UnifiedArtifactStoreCandidate',
};

/** Constructed offline identity/storage only. Native reads and every permission
 * decision run through the real runtime adapter and shared authorization service.
 * Public commit also uses the real sealed task/result preflight and materializer. */
async function harness(kind: Kind, withNativeEvidence = true) {
  const f = tdmsRuntimeFixture({
    tenantId: 'fixture-tenant',
    actorUserId: 'owner',
    workItemId: 'WI-NATIVE-COMMIT',
    documentVersionId: 'DV-NATIVE-COMMIT',
    taskContextRef: 'OP-NATIVE-COMMIT',
  });
  f.principal.scope.appId = 'app_17bzc551rsg';
  Object.assign(f.principal.scope, { attemptRef: f.binding.taskContextRef });
  f.actor.applicationScopeId = f.principal.scope.appId;
  f.actor.subjectDecision.applicationScopeId = f.principal.scope.appId;
  const context = await f.adapter.discover(f.principal, f.binding);
  const read = await f.adapter.read(f.principal, {
    context,
    evidenceRefs: context.projection.selectedSetApprovedRefs,
    purpose: 'JOB_AID_NATIVE_RECORD',
    taskContextRef: f.binding.taskContextRef,
  });
  const revision: JobAidWorkRevision = {
    workRevisionRef: 'JAWR-NATIVE-COMMIT-1',
    workItemId: f.binding.workItemId,
    workRevision: 1,
    previousWorkRevisionRef: null,
    requestId: 'SAVE-NATIVE',
    actionAttemptId: 'ATT-NATIVE-COMMIT',
    basedOnWorkItemRevision: 1,
    documentVersionId: f.binding.documentVersionId,
    createdAt: '2026-10-07T00:00:00Z',
    content: {
      schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA,
      overviewStatus: 'CURRENT',
      headline: 'Conditional native judgment',
      listBrief: 'Verify installed configuration',
      understanding:
        'The source opinion remains conditional; execution is not verified.',
      decisiveIssueKeys: [],
      issues: [],
      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
      completionReason: 'Native source read',
      changeSummary: 'Read both siblings',
      unchangedExplanation: 'No adopted conclusion',
      methodBinding: structuredClone(JOBAID_METHOD_BINDING),
      evidence: withNativeEvidence ? read.evidence : [],
      readSourceRefs: withNativeEvidence
        ? read.evidence.map((item) => item.evidenceRef)
        : [],
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
  let current = {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: f.binding.workItemId,
    requestId: 'REQUEST-NATIVE',
    revision: 1,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'fixture-permission',
    source: {
      documentId: 'DOC-NATIVE',
      documentVersionId: f.binding.documentVersionId,
      sourceArtifactId: 'ART-NATIVE',
      sourceFileSha256: 'a'.repeat(64),
      sourceByteLength: 42,
    },
    classification: { status: 'CONFIRMED', normalizedFamily: 'SB' },
    package: null,
    failure: null,
    recordingFailure: null,
    integratedAssessment:
      kind === 'OVERALL'
        ? {
            status: 'BASE_RULE_CANDIDATE_READY',
            baseRules: {
              schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
              status: 'CANDIDATE_ONLY',
              revision: 1,
              sourceResultId: 'openclaw-dynamic://BASE',
              actionAttemptId: 'ATT-BASE',
              workRevisionRef: revision.workRevisionRef,
              workRevision: revision.workRevision,
              issueCount: 0,
              openQuestionCount: 0,
              roundCompletion: revision.content.roundCompletion,
              methodBinding: revision.content.methodBinding,
              headline: revision.content.headline,
              listBrief: revision.content.listBrief,
              artifact,
              readingResult: jobAidReadingResult(revision),
            },
            engineerReviews: null,
            overallSynthesis: null,
            overallForAeoConfirmation: null,
          }
        : null,
  } as unknown as CanonicalWorkItemProjection;
  const taskInput = buildJobAidProblemTask({
    workItem: current,
    actorUserId: f.binding.actorUserId,
    permissionSnapshotVersion: 'fixture-permission',
    purpose:
      kind === 'OVERALL' ? 'OVERALL_CONSISTENCY' : 'INITIAL_PROBLEM_ASSESSMENT',
    sourceCatalog: [],
    sourceBindings: [],
    previousWork: null,
    expectedWorkRevision: 0,
    priorAssessmentRefs: [],
    tdmsContext: context,
    common: projectCommonAssessmentContext(
      current,
      {
        context: { status: 'UNAVAILABLE', reason: 'OFFLINE_FIXTURE' },
        documentReadingStatus: 'AVAILABLE',
        items: [],
        sections: [],
        resourceRefs: [],
      },
      [],
    ),
  });
  const task = sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: revision.actionAttemptId,
    operationRef: f.binding.taskContextRef,
    taskType:
      kind === 'OVERALL'
        ? 'OPENCLAW_OVERALL_SYNTHESIS'
        : 'OPENCLAW_DYNAMIC_EVALUATION',
    priority: 1,
    tenantId: f.binding.tenantId,
    workItemId: current.workItemId,
    inputRevision: 1,
    baseRevision: 1,
    documentVersionId: f.binding.documentVersionId,
    sourceRefs: [],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput: taskInput,
    deadline: '2099-01-01T00:00:00Z',
    idempotencyKey: `offline-native-commit-${kind}`,
  });
  const policy = CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY;
  const result = sealResultEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
    actionAttemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    taskType: task.taskType,
    workItemId: task.workItemId,
    baseRevision: task.baseRevision,
    status: 'SUCCEEDED',
    businessOutcome: 'CANDIDATE_READY',
    candidateStatus: null,
    modelOutput: JSON.stringify({
      workRevisionRef: revision.workRevisionRef,
      consistencyCheck: 'Checked the exact saved conditional native evidence.',
    }),
    outputArtifactRefs: [],
    sourceRefs: [],
    factsConsidered: [],
    missingInputs: [],
    conflicts: [],
    warnings: [],
    modelVersion: 'offline-fixture-model',
    promptVersion: 'wiselink-jobaid-problem@v2',
    skillVersion: policy.minimumCompatibleSkillVersion,
    toolVersions: {
      [policy.mcpServerName]: policy.mcpServerVersion,
      'jobaid-problem-protocol': '2',
      'tdms-native-context': '1',
    },
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
    errorCode: null,
    errorDetail: null,
  });
  const row = {
    attemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    actionType: task.taskType,
    tenantId: task.tenantId,
    workItemId: task.workItemId,
    documentVersionId: task.documentVersionId,
    inputRevision: task.inputRevision,
    baseRevision: task.baseRevision,
    idempotencyKey: task.idempotencyKey,
    taskInputHash: task.inputHash,
    taskEnvelopeJson: canonicalJson(task),
    status: 'COMMITTING',
    triggerRequestId: 'TRIGGER-NATIVE',
  } as ActionAttemptRow;
  const prepared = { task, result, row };
  const database = {
    fixtureTransaction: 'native-projection',
  } as unknown as PostgresJsDatabase;
  const workDatabase = {
    fixtureTransaction: 'work-read',
  } as unknown as PostgresJsDatabase;
  let onArtifact: (() => Promise<void>) | undefined;
  let onFinish: (() => Promise<void>) | undefined;
  let onRead: (() => Promise<void>) | undefined;
  let onCasReturn: (() => Promise<void>) | undefined;
  const verifier: TdmsNativeEvidenceVerifier = {
    assertInTransaction: jest.fn(tdmsTransactionProofFixture(f)),
    authorize: jest.fn(
      async (
        evidence: AssessmentTdmsNativeEvidence[],
        actor: TdmsNativeEvidenceActor,
      ) => {
        expect(actor).toEqual({
          tenantId: f.binding.tenantId,
          actorUserId: f.binding.actorUserId,
        });
        await f.adapter.verifyEvidence(f.principal, evidence);
        const grant = await f.authorization.authorize(
          f.actor,
          f.scope,
          'READ_RECORD',
          { workItemId: f.binding.workItemId },
        );
        return evidence.map((item) => ({
          evidenceRef: item.evidenceRef,
          sourceRevisionRef: item.nativeSource.sourceRevisionRef,
          processingSetBinding: item.nativeScope.processingSetBinding,
          permissionRevision: grant.permissionRevision,
          sourceAudienceAuthorized: true as const,
          selectedObjectAuthorized: true as const,
        }));
      },
    ),
    readExactEvidence: jest.fn(
      async (evidence: AssessmentTdmsNativeEvidence[]) => {
        await f.adapter.verifyEvidence(f.principal, evidence);
        return structuredClone(evidence);
      },
    ),
    assertCurrentEvidence: jest.fn(
      async ({ evidence }: { evidence: AssessmentTdmsNativeEvidence[] }) => {
        await f.adapter.verifyEvidence(f.principal, evidence);
      },
    ),
  };
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => {
      await onRead?.();
      return structuredClone(current);
    }),
    compareAndSet: jest.fn(async (input: CasInput) => {
      await input.nativeEvidenceGuard?.(database);
      current = { ...input.next, revision: input.expectedRevision + 1 };
      await input.nativeEvidenceGuard?.(database);
      await onCasReturn?.();
      return structuredClone(current);
    }),
  };
  const artifactStore = {
    persistAndReadback: jest.fn(async () => {
      await onArtifact?.();
      return { artifact };
    }),
  };
  const attempts = {
    prepareCommit: jest.fn(async () => prepared),
    finishProjectionSuccess: jest.fn(async () => {
      await onFinish?.();
      return undefined;
    }),
    finishResultGateFailure: jest.fn(
      async (_prepared: unknown, error: Error) => {
        throw error;
      },
    ),
  };
  const readSaved = async (
    input: Parameters<JobAidWorkRepository['readByRefForRuntime']>[0],
  ): Promise<JobAidWorkRevision | null> => {
    if (
      input.tenantId !== f.binding.tenantId ||
      input.actorUserId !== f.binding.actorUserId ||
      input.workItemId !== f.binding.workItemId ||
      input.workRevisionRef !== revision.workRevisionRef
    )
      return null;
    return structuredClone(revision);
  };
  const work = {
    readByRefForRuntime: jest.fn(readSaved),
    readByRefForRuntimeInTransaction: jest.fn(
      async (
        input: Parameters<typeof readSaved>[0],
        executor: PostgresJsDatabase,
      ) => {
        expect(executor).toBe(database);
        return readSaved(input);
      },
    ),
    readByRef: jest.fn(readSaved),
    withActorTransaction: jest.fn(
      async (
        _actor: string,
        run: (db: PostgresJsDatabase) => Promise<unknown>,
      ) => run(workDatabase),
    ),
    withActorScope: jest.fn(
      async (_actor: string, run: () => Promise<unknown>) => run(),
    ),
    loadOwnedSourceBinding: jest.fn(async () => ({
      documentVersionId: f.binding.documentVersionId,
    })),
    listForRuntime: jest.fn(async () => [revision]),
  };
  const service = new CanonicalJobAidProblemService(
    registrar as never,
    artifactStore as never,
    {} as never,
    {} as never,
    {} as never,
    attempts as never,
    {} as never,
    { hasActiveOfficialActorMapping: async () => true } as never,
    {} as never,
    work as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    f.adapter,
    verifier,
  );
  const commitInput = {
    row,
    scope: { ...f.principal.scope, attemptRef: task.operationRef },
    leaseToken: 'fixture-lease',
    leaseGeneration: 1,
    result,
  };
  return {
    service,
    work,
    f,
    verifier,
    registrar,
    artifactStore,
    attempts,
    database,
    row,
    revision,
    commit: () => service.commit(commitInput),
    current: () => current,
    revoke: () => {
      f.control.sourceAllowed = false;
    },
    onArtifact: (fn: () => Promise<void>) => {
      onArtifact = fn;
    },
    onFinish: (fn: () => Promise<void>) => {
      onFinish = fn;
    },
    onRead: (fn: () => Promise<void>) => {
      onRead = fn;
    },
    onCasReturn: (fn: () => Promise<void>) => {
      onCasReturn = fn;
    },
  };
}

describe.each<Kind>(['BASE', 'OVERALL'])(
  'JobAid %s native commit authority',
  (kind) => {
    it('commits the exact native carrier with a transaction-bound verifier and without minting another READ', async () => {
      const h = await harness(kind);
      const receiptCount = h.f.receipts.length;
      const result = await h.commit();
      expect(result).toMatchObject({
        workItemId: h.f.binding.workItemId,
        workItemRevision: 2,
      });
      expect(h.registrar.compareAndSet).toHaveBeenCalledWith(
        expect.objectContaining({
          jobAidWorkRevisionGuard: {
            tenantId: h.f.binding.tenantId,
            workRevisionRef: h.revision.workRevisionRef,
          },
          nativeEvidenceGuard: expect.any(Function),
          syncPrimaryAttempt: false,
        }),
      );
      expect(
        jest
          .mocked(h.verifier.authorize)
          .mock.calls.filter((call) => call[2] === h.database),
      ).toHaveLength(0);
      expect(
        jest
          .mocked(h.verifier.assertCurrentEvidence)
          .mock.calls.filter(([input]) => input.database === h.database),
      ).toHaveLength(0);
      const transactionalCalls = jest
        .mocked(h.verifier.assertInTransaction!)
        .mock.calls.filter(([input]) => input.database === h.database);
      expect(transactionalCalls).toHaveLength(2);
      for (const [input] of transactionalCalls) {
        expect(input.actor).toEqual({
          tenantId: h.f.binding.tenantId,
          actorUserId: h.f.binding.actorUserId,
        });
        expect(input.runtime?.principal).toEqual(h.f.principal);
      }
      expect(h.attempts.finishProjectionSuccess).toHaveBeenCalledTimes(1);
      expect(h.f.receipts).toHaveLength(receiptCount);
    });

    it('denies a source revocation after awaited artifact I/O before projection CAS', async () => {
      const h = await harness(kind);
      h.onArtifact(async () => {
        await Promise.resolve();
        h.revoke();
      });
      await expect(h.commit()).rejects.toThrow();
      expect(h.artifactStore.persistAndReadback).toHaveBeenCalledTimes(1);
      expect(h.registrar.compareAndSet).not.toHaveBeenCalled();
      expect(h.attempts.finishProjectionSuccess).not.toHaveBeenCalled();
      expect(h.current().revision).toBe(1);
    });

    it('denies a revocation after awaited CAS returns before finishing success', async () => {
      const h = await harness(kind);
      h.onCasReturn(async () => {
        await Promise.resolve();
        h.revoke();
      });
      await expect(h.commit()).rejects.toThrow();
      expect(h.current().revision).toBe(2);
      expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
      expect(h.attempts.finishProjectionSuccess).not.toHaveBeenCalled();
    });

    it('recovers an authorized lost CAS response without republishing or minting another READ', async () => {
      const h = await harness(kind);
      const receipts = h.f.receipts.length;
      h.onCasReturn(async () => {
        throw new Error('FIXTURE_LOST_CAS_RESPONSE');
      });
      await expect(h.commit()).resolves.toMatchObject({
        workItemId: h.f.binding.workItemId,
        workItemRevision: 2,
      });
      expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
      expect(h.artifactStore.persistAndReadback).toHaveBeenCalledTimes(1);
      expect(h.attempts.finishProjectionSuccess).toHaveBeenCalledTimes(1);
      expect(h.f.receipts).toHaveLength(receipts);
    });

    it('does not return native evidence if finishing success crosses a source revocation', async () => {
      const h = await harness(kind);
      h.onFinish(async () => {
        await Promise.resolve();
        h.revoke();
      });
      await expect(h.commit()).rejects.toThrow();
      expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
      expect(h.attempts.finishProjectionSuccess).toHaveBeenCalledTimes(1);
    });

    it('reauthorizes the persisted carrier on committed replay before finishing success', async () => {
      const h = await harness(kind);
      await h.commit();
      h.row.status = 'SUCCEEDED';
      h.attempts.finishProjectionSuccess.mockClear();
      h.onRead(async () => {
        h.revoke();
      });
      await expect(h.commit()).rejects.toThrow();
      expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
      expect(h.attempts.finishProjectionSuccess).not.toHaveBeenCalled();
    });

    it('reauthorizes again after finishProjectionSuccess on committed replay', async () => {
      const h = await harness(kind);
      await h.commit();
      h.row.status = 'SUCCEEDED';
      h.attempts.finishProjectionSuccess.mockClear();
      h.onFinish(async () => {
        await Promise.resolve();
        h.revoke();
      });
      await expect(h.commit()).rejects.toThrow();
      expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
      expect(h.attempts.finishProjectionSuccess).toHaveBeenCalledTimes(1);
    });

    it('denies lost-CAS-response recovery when the fresh persisted projection read crosses revocation', async () => {
      const h = await harness(kind);
      h.onCasReturn(async () => {
        h.onRead(async () => {
          h.revoke();
        });
        throw new Error('FIXTURE_LOST_CAS_RESPONSE');
      });
      await expect(h.commit()).rejects.toThrow();
      expect(h.current().revision).toBe(2);
      expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
      expect(h.attempts.finishProjectionSuccess).not.toHaveBeenCalled();
    });

    it('reauthorizes after finishing recovered success without retrying CAS or artifact I/O', async () => {
      const h = await harness(kind);
      h.onCasReturn(async () => {
        throw new Error('FIXTURE_LOST_CAS_RESPONSE');
      });
      h.onFinish(async () => {
        await Promise.resolve();
        h.revoke();
      });
      await expect(h.commit()).rejects.toThrow();
      expect(h.current().revision).toBe(2);
      expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
      expect(h.artifactStore.persistAndReadback).toHaveBeenCalledTimes(1);
      expect(h.attempts.finishProjectionSuccess).toHaveBeenCalledTimes(1);
    });
  },
);

type ProjectionMutation =
  | 'empty-evidence'
  | 'stripped-evidence'
  | 'missing-reading'
  | 'malformed-pointer'
  | 'wrong-pointer'
  | 'wrong-reading-revision'
  | 'changed-native-derived-text';
function mutateCommittedCarrier(
  h: Awaited<ReturnType<typeof harness>>,
  kind: Kind,
  mutation: ProjectionMutation,
) {
  const projection =
    kind === 'BASE'
      ? h.current().integratedAssessment!.baseRules
      : h.current().integratedAssessment!.overallSynthesis!;
  if (!('readingResult' in projection) || !projection.readingResult)
    throw new Error('FIXTURE_READING_RESULT_REQUIRED');
  const reading = projection.readingResult;
  const pointer =
    kind === 'BASE' ? 'workRevisionRef' : 'basedOnJobAidWorkRevisionRef';
  if (mutation === 'empty-evidence') reading.evidence = [];
  if (mutation === 'stripped-evidence')
    Reflect.deleteProperty(reading, 'evidence');
  if (mutation === 'missing-reading')
    Reflect.deleteProperty(projection, 'readingResult');
  if (mutation === 'malformed-pointer')
    Object.assign(projection, { [pointer]: '../not-a-work-revision' });
  if (mutation === 'wrong-pointer')
    Object.assign(projection, { [pointer]: 'JAWR-ANOTHER-SAVED-WORK' });
  if (mutation === 'wrong-reading-revision') reading.resultRevision += 1;
  if (mutation === 'changed-native-derived-text')
    reading.content.lead = 'Altered native-derived conclusion';
}

describe.each<Kind>(['BASE', 'OVERALL'])(
  'JobAid %s exact saved carrier release',
  (kind) => {
    describe.each(['replay', 'recovery'] as const)('%s', (path) => {
      it.each<ProjectionMutation>([
        'empty-evidence',
        'stripped-evidence',
        'missing-reading',
        'malformed-pointer',
        'wrong-pointer',
        'wrong-reading-revision',
        'changed-native-derived-text',
      ])(
        'denies %s without releasing cached native-derived text or finishing success',
        async (mutation) => {
          const h = await harness(kind);
          if (path === 'replay') {
            await h.commit();
            h.row.status = 'SUCCEEDED';
            h.attempts.finishProjectionSuccess.mockClear();
            mutateCommittedCarrier(h, kind, mutation);
          } else {
            h.onCasReturn(async () => {
              mutateCommittedCarrier(h, kind, mutation);
              throw new Error('FIXTURE_LOST_CAS_RESPONSE');
            });
          }
          await expect(h.commit()).rejects.toThrow();
          expect(h.current().revision).toBe(2);
          expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
          expect(h.attempts.finishProjectionSuccess).not.toHaveBeenCalled();
          // The saved immutable work retains both original native carriers.
          expect(h.revision.content.evidence).toHaveLength(2);
        },
      );

      it('allows an exact saved zero-native readingResult on an addon task', async () => {
        const h = await harness(kind, false);
        if (path === 'replay') {
          await h.commit();
          h.row.status = 'SUCCEEDED';
          h.attempts.finishProjectionSuccess.mockClear();
        } else {
          h.onCasReturn(async () => {
            throw new Error('FIXTURE_LOST_CAS_RESPONSE');
          });
        }
        await expect(h.commit()).resolves.toMatchObject({
          workItemId: h.f.binding.workItemId,
          workItemRevision: 2,
        });
        expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
        expect(h.attempts.finishProjectionSuccess).toHaveBeenCalledTimes(1);
        expect(h.revision.content.evidence).toEqual([]);
        expect(h.work.readByRefForRuntime).toHaveBeenCalledWith({
          tenantId: h.f.binding.tenantId,
          actorUserId: h.f.binding.actorUserId,
          workItemId: h.f.binding.workItemId,
          workRevisionRef: h.revision.workRevisionRef,
        });
      });
    });
  },
);
