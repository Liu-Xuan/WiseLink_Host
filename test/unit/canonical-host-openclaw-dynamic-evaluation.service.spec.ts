import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type { DynamicRulesEvaluationRequest } from '../../server/modules/assessment-workbench/assessment-host-consumer.public-api';
import { CanonicalHostOpenClawDynamicEvaluationService } from '../../server/modules/canonical-host/canonical-host-openclaw-dynamic-evaluation.service';
import type {
  CanonicalAuthorizationPort,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from '../../server/modules/canonical-host/canonical-host.types';
import type { CanonicalHostAssessmentService } from '../../server/modules/canonical-host/canonical-host-assessment.service';
import type { DynamicRulesEvaluationProcessor } from '../../server/modules/assessment-workbench/dynamic-rules-evaluation.processor';
import type { UnifiedArtifactStorePort } from '../../server/modules/unified-reader/unified-reader.types';
import type {
  DynamicEvaluationActionAttempt,
  MiaodaWorkItemRepository,
} from '../../server/modules/work-item/miaoda-work-item.repository';

const WORK_ITEM_ID = 'WI-DYNAMIC-150';
const ATTEMPT_ID = 'ATT-INTERNAL-NOT-FOR-MODEL';
const ATTEMPT_REF = 'DYN-OPAQUE-CALLER-REF';

describe('CanonicalHostOpenClawDynamicEvaluationService', () => {
  it('keeps a pre-model transient failure recoverable on the same opaque ref', async () => {
    const harness = createHarness({ transientBeginFailures: 1 });

    await expect(harness.service.begin(WORK_ITEM_ID)).rejects.toThrow(
      'TRANSIENT_READER_FAILURE',
    );
    const recovered = await harness.service.begin(WORK_ITEM_ID);

    expect(recovered.attemptRef).toBe(ATTEMPT_REF);
    expect(JSON.stringify(recovered.modelInput)).not.toContain(ATTEMPT_ID);
    expect(JSON.stringify(recovered.modelInput)).not.toContain(WORK_ITEM_ID);
    expect(JSON.stringify(recovered.modelInput)).not.toContain('actor');
    expect(harness.state.reserveCount).toBe(2);
    expect(harness.state.failedAttempts).toEqual([]);
    expect(harness.state.status).toBe('RUNNING');
  });

  it('rejects invalid output without persistence and permits corrected N/N commit', async () => {
    const harness = createHarness();
    await harness.service.begin(WORK_ITEM_ID);

    await expect(
      harness.service.commit(ATTEMPT_REF, '{"incomplete":true}'),
    ).rejects.toThrow('DYNAMIC_RULES_OUTPUT_INVALID');
    expect(harness.state.persistedOutputs).toEqual([]);
    expect(harness.state.failedAttempts).toEqual([]);
    expect(harness.state.status).toBe('RUNNING');

    const output = validOutput();
    const committed = await harness.service.commit(ATTEMPT_REF, output);

    expect(harness.state.persistedOutputs).toEqual([output]);
    expect(harness.state.casCount).toBe(1);
    expect(harness.state.completedAttempts).toEqual([ATTEMPT_ID]);
    expect(committed).toMatchObject({
      workItemId: WORK_ITEM_ID,
      workItemRevision: 6,
      status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: {
        criterionCount: 150,
        evaluationItemCount: 150,
        unresolvedCount: 119,
        sourceBoundCandidateCount: 150,
        actionAttemptId: ATTEMPT_ID,
      },
    });
  });

  it('rejects a stale WorkItem revision before consume, claim or persist', async () => {
    const harness = createHarness({ workItemRevision: 6, attemptNo: 5 });

    await expect(
      harness.service.commit(ATTEMPT_REF, validOutput()),
    ).rejects.toThrow('WORK_ITEM_CAS_CONFLICT');
    expect(harness.state.consumeCount).toBe(0);
    expect(harness.state.claimCount).toBe(0);
    expect(harness.state.persistedOutputs).toEqual([]);
  });

  it('atomically allows only one of two concurrent commits to persist', async () => {
    const harness = createHarness();
    const output = validOutput();

    const results = await Promise.allSettled([
      harness.service.commit(ATTEMPT_REF, output),
      harness.service.commit(ATTEMPT_REF, output),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(harness.state.claimCount).toBe(2);
    expect(harness.state.persistedOutputs).toEqual([output]);
    expect(harness.state.casCount).toBe(1);
    expect(harness.state.failedAttempts).toEqual([]);
  });
});

interface HarnessOptions {
  transientBeginFailures?: number;
  workItemRevision?: number;
  attemptNo?: number;
}

interface HarnessState {
  status: string;
  reserveCount: number;
  consumeCount: number;
  claimCount: number;
  casCount: number;
  transientBeginFailures: number;
  persistedOutputs: string[];
  failedAttempts: string[];
  completedAttempts: string[];
}

function createHarness(options: HarnessOptions = {}) {
  const workItem = workItemProjection(options.workItemRevision ?? 5);
  const attempt: DynamicEvaluationActionAttempt = {
    attemptId: ATTEMPT_ID,
    workItemId: WORK_ITEM_ID,
    actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
    attemptNo: options.attemptNo ?? workItem.revision,
    triggerRequestId: ATTEMPT_REF,
    requestOrigin: 'OPENCLAW',
    status: 'RUNNING',
    actorUserId: 'service:openclaw-main',
    tenantId: 'tenant-dynamic',
    createdAt: new Date('2026-08-16T12:00:00.000Z'),
  };
  const state: HarnessState = {
    status: 'RUNNING',
    reserveCount: 0,
    consumeCount: 0,
    claimCount: 0,
    casCount: 0,
    transientBeginFailures: options.transientBeginFailures ?? 0,
    persistedOutputs: [],
    failedAttempts: [],
    completedAttempts: [],
  };
  const registrar = {
    getByWorkItemId: async () => workItem,
    compareAndSet: async (input: {
      expectedRevision: number;
      next: Omit<CanonicalWorkItemProjection, 'revision'>;
    }) => {
      state.casCount += 1;
      if (input.expectedRevision !== workItem.revision) {
        throw new Error('WORK_ITEM_CAS_CONFLICT');
      }
      return { ...input.next, revision: input.expectedRevision + 1 };
    },
  } as unknown as CanonicalWorkItemRegistrarPort;
  const authorization = {
    authorize: async (input: { actor: { userId: string } }) => ({
      action: 'PERSIST_BASE_RULE_RESULT' as const,
      allowed: input.actor.userId === 'service:openclaw-main',
      actorFingerprint: 'server-derived',
      decisionId: 'decision-dynamic',
      decisionHash: 'decision-dynamic-hash',
      permissionSnapshotVersion: 'permission-dynamic',
    }),
  } as unknown as CanonicalAuthorizationPort;
  const permissions = {
    freshRead: async () => ({
      permissionSnapshotVersion: 'permission-dynamic',
    }),
  } as unknown as CanonicalPermissionSnapshotPort;
  const artifactStore = {
    persistAndReadback: async (bytes: Uint8Array) => {
      const output = new TextDecoder().decode(bytes);
      state.persistedOutputs.push(output);
      return {
        artifact: {
          storeRole: 'UnifiedArtifactStoreCandidate' as const,
          ref: 'artifact://dynamic-output',
          sha256: 'a'.repeat(64),
          byteLength: bytes.byteLength,
          mediaType: 'application/json' as const,
        },
        actualBytes: bytes,
        reused: false,
      };
    },
  } as unknown as UnifiedArtifactStorePort;
  const repository = {
    getRow: async () => ({ tenantId: 'tenant-dynamic' }),
    reserveDynamicEvaluationAction: async () => {
      state.reserveCount += 1;
      return { ...attempt, status: state.status, created: state.reserveCount === 1 };
    },
    getDynamicEvaluationActionByCallerRef: async () => ({
      ...attempt,
      status: state.status,
    }),
    claimDynamicEvaluationCommit: async () => {
      state.claimCount += 1;
      if (state.status !== 'RUNNING') {
        throw new Error('DYNAMIC_EVALUATION_COMMIT_ALREADY_CLAIMED');
      }
      state.status = 'COMMITTING';
    },
    completeAssessmentAction: async (attemptId: string) => {
      state.status = 'SUCCEEDED';
      state.completedAttempts.push(attemptId);
    },
    failAssessmentAction: async (input: { attemptId: string }) => {
      state.status = 'FAILED';
      state.failedAttempts.push(input.attemptId);
    },
  } as unknown as MiaodaWorkItemRepository;
  const assessment = {
    prepareDynamicRulesCandidate: async () => {
      if (state.transientBeginFailures > 0) {
        state.transientBeginFailures -= 1;
        throw new Error('TRANSIENT_READER_FAILURE');
      }
      return {
        candidateArtifact: { schemaVersion: 'assessment-input' },
        overall: { transport: { evaluationContext: {} } },
      };
    },
  } as unknown as CanonicalHostAssessmentService;
  const processor = {
    buildRequest: (
      _assessmentInput: unknown,
      _transport: unknown,
      correlation: Record<string, unknown>,
      callerCorrelationRef: string,
    ): DynamicRulesEvaluationRequest => ({
      privateEnvelope: {
        callerCorrelationRef,
        correlation: correlation as DynamicRulesEvaluationRequest['privateEnvelope']['correlation'],
      },
      modelInput: {
        purpose: 'EVALUATE_DYNAMIC_RULES',
        callerCorrelationRef,
        operatorInstruction: [],
        subjectContext: {},
        jobAidContext: {},
        expectedSelfCheck: {
          criterionSetId: 'JACS-DYNAMIC-150',
          criterionCount: 150,
        },
        responseInstruction: {},
      } as unknown as DynamicRulesEvaluationRequest['modelInput'],
    }),
    consumeOutput: (_request: unknown, output: string) => {
      state.consumeCount += 1;
      const parsed = JSON.parse(output) as Record<string, unknown>;
      if (
        parsed.callerCorrelationRef !== ATTEMPT_REF ||
        !Array.isArray(parsed.ruleResults) ||
        parsed.ruleResults.length !== 150
      ) {
        throw new Error('DYNAMIC_RULES_OUTPUT_INVALID');
      }
      return {
        ruleResults: parsed.ruleResults,
        overallSelfCheck: { rulesWithMissingInputs: 119 },
        criterionCount: 150,
      };
    },
  } as unknown as DynamicRulesEvaluationProcessor;
  return {
    state,
    service: new CanonicalHostOpenClawDynamicEvaluationService(
      registrar,
      authorization,
      permissions,
      artifactStore,
      repository,
      assessment,
      processor,
    ),
  };
}

function workItemProjection(revision: number): CanonicalWorkItemProjection {
  return {
    workItemId: WORK_ITEM_ID,
    requestId: 'REQ-DYNAMIC-150',
    revision,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    source: {
      documentVersionId: 'document-version-dynamic-150',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
    },
    package: { packageId: 'package-dynamic-150' },
    integratedAssessment: null,
  } as unknown as CanonicalWorkItemProjection;
}

function validOutput(): string {
  return JSON.stringify({
    callerCorrelationRef: ATTEMPT_REF,
    ruleResults: Array.from({ length: 150 }, (_value, index) => ({
      ruleId: `RULE-${index + 1}`,
      sourceRefs: [`SOURCE-${index + 1}`],
    })),
  });
}
