import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { CanonicalHostOpenClawOverallService } from '../../server/modules/canonical-host/canonical-host-openclaw-overall.service';

const WORK_ITEM_ID = 'WI-OVERALL-150';
const ATTEMPT_ID = 'ATT-INTERNAL-OVERALL';
const ATTEMPT_REF = 'OVR-OPAQUE-CALLER-REF';
const BASE_SHA = 'a'.repeat(64);

describe('CanonicalHostOpenClawOverallService', () => {
  it('returns an authority-free input with an opaque caller ref', async () => {
    const harness = createHarness();
    const begun = await harness.service.begin(WORK_ITEM_ID, []);

    expect(begun.attemptRef).toBe(ATTEMPT_REF);
    expect(begun.selectedDiscoveryRefs).toEqual([]);
    expect(begun.modelInput.baseRuleResult).toMatchObject({
      revision: 1,
      criterionCount: 1,
      evaluationItemCount: 1,
    });
    expect((begun.modelInput.baseRuleResult.items as Array<Record<string, unknown>>)[0]
      .sourceRefIds).toEqual(['SRC-001']);
    const serialized = JSON.stringify(begun.modelInput);
    expect(serialized).not.toContain(WORK_ITEM_ID);
    expect(serialized).not.toContain(ATTEMPT_ID);
    expect(serialized).not.toContain('actor');
    expect(serialized).not.toContain('"authority"');
    expect(begun.modelInput.engineerReviewContext).toEqual({
      revision: null,
      artifactSha256: null,
      reviewCount: 0,
      history: [],
      effective: [],
    });
  });

  it('rejects a source-evidence candidate whose mapped ref is not in frozen.2', async () => {
    const harness = createHarness({ candidateSourceRef: 'SRC-NOT-IN-PACKAGE' });

    await expect(harness.service.begin(WORK_ITEM_ID, [])).rejects.toThrow(
      'BASE_SOURCE_EVIDENCE_UNKNOWN_SOURCE_REF:SRC-NOT-IN-PACKAGE',
    );
  });

  it('rejects a legacy Base result that was not produced by OpenClaw dynamic N/N', async () => {
    const harness = createHarness({
      dynamicSourceResultId: 'base://legacy-one-shot-result',
    });

    await expect(harness.service.begin(WORK_ITEM_ID, [])).rejects.toThrow(
      'OPENCLAW_OVERALL_DYNAMIC_N_CANDIDATE_REQUIRED',
    );
  });

  it('rejects a fresh rule catalog whose criterionSet drifted from the dynamic artifact', async () => {
    const harness = createHarness({ freshCriterionSetId: 'JACS-B' });

    await expect(harness.service.begin(WORK_ITEM_ID, [])).rejects.toThrow(
      'OPENCLAW_OVERALL_DYNAMIC_N_CONTEXT_DRIFT',
    );
  });

  it.each([
    [{ dynamicAttemptId: 'ATT-OTHER' }],
    [{ dynamicAttemptWorkItemId: 'WI-OTHER' }],
    [{ dynamicAttemptTriggerRef: 'DYN-OTHER' }],
    [{ dynamicAttemptStatus: 'RUNNING' }],
  ])('rejects dynamic ActionAttempt identity drift: %o', async (options) => {
    const harness = createHarness(options);

    await expect(harness.service.begin(WORK_ITEM_ID, [])).rejects.toThrow(
      'OPENCLAW_OVERALL_DYNAMIC_N_ATTEMPT_MISMATCH',
    );
  });

  it('keeps invalid output retryable, then persists exact corrected bytes and CASes once', async () => {
    const harness = createHarness();

    await expect(harness.service.commit(ATTEMPT_REF, '{}')).rejects.toThrow(
      'OVERALL_OUTPUT_SHAPE_INVALID',
    );
    expect(harness.state.persisted).toEqual([]);
    expect(harness.state.failed).toEqual([]);
    expect(harness.state.status).toBe('RUNNING');

    const output = validOutput();
    const committed = await harness.service.commit(ATTEMPT_REF, output);

    expect(harness.state.persisted).toEqual([output]);
    expect(harness.state.casCount).toBe(1);
    expect(harness.state.completed).toEqual([ATTEMPT_ID]);
    expect(committed).toMatchObject({
      workItemId: WORK_ITEM_ID,
      workItemRevision: 6,
      status: 'OVERALL_CANDIDATE_READY',
      overallSynthesis: {
        authorityLevel: 'candidate_only',
        externalDiscoveryIsEvidence: false,
        actionAttemptId: ATTEMPT_ID,
      },
    });
  });

  it('rejects a stale WorkItem revision before claim and persistence', async () => {
    const harness = createHarness({ workItemRevision: 6, attemptNo: 5 });

    await expect(harness.service.commit(ATTEMPT_REF, validOutput())).rejects.toThrow(
      'WORK_ITEM_CAS_CONFLICT',
    );
    expect(harness.state.claimCount).toBe(0);
    expect(harness.state.persisted).toEqual([]);
  });

  it('releases a claimed transient FileService failure for the same opaque attempt', async () => {
    const harness = createHarness({ transientPersistFailures: 1 });
    const output = validOutput();

    await expect(harness.service.commit(ATTEMPT_REF, output)).rejects.toThrow(
      'FILESERVICE_TRANSIENT_READBACK_FAILURE',
    );
    expect(harness.state.status).toBe('RUNNING');
    expect(harness.state.releaseCount).toBe(1);
    expect(harness.state.failed).toEqual([]);

    await expect(harness.service.commit(ATTEMPT_REF, output)).resolves.toMatchObject({
      workItemId: WORK_ITEM_ID,
      workItemRevision: 6,
    });
    expect(harness.state.persisted).toEqual([output]);
    expect(harness.state.casCount).toBe(1);
  });

  it('allows only one of two concurrent commits to persist', async () => {
    const harness = createHarness();
    const output = validOutput();
    const results = await Promise.allSettled([
      harness.service.commit(ATTEMPT_REF, output),
      harness.service.commit(ATTEMPT_REF, output),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(harness.state.persisted).toEqual([output]);
    expect(harness.state.casCount).toBe(1);
    expect(harness.state.failed).toEqual([]);
  });

  it('does not release another caller active COMMITTING claim', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const harness = createHarness({ persistGate: { entered, release } });
    const output = validOutput();
    const first = harness.service.commit(ATTEMPT_REF, output);
    await entered.promise;

    await expect(harness.service.commit(ATTEMPT_REF, output)).rejects.toThrow(
      'OPENCLAW_OVERALL_COMMIT_IN_PROGRESS',
    );
    expect(harness.state.releaseCount).toBe(0);
    expect(harness.state.claimCount).toBe(1);

    release.resolve();
    await expect(first).resolves.toMatchObject({ workItemId: WORK_ITEM_ID });
    expect(harness.state.persisted).toEqual([output]);
    expect(harness.state.casCount).toBe(1);
  });
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value?: T): void;
}

interface PersistGate {
  entered: Deferred<void>;
  release: Deferred<void>;
}

function createHarness(options: {
  workItemRevision?: number;
  attemptNo?: number;
  candidateSourceRef?: string;
  dynamicSourceResultId?: string;
  freshCriterionSetId?: string;
  dynamicAttemptId?: string;
  dynamicAttemptWorkItemId?: string;
  dynamicAttemptTriggerRef?: string;
  dynamicAttemptStatus?: string;
  transientPersistFailures?: number;
  persistGate?: PersistGate;
} = {}) {
  const workItem = workItemProjection(
    options.workItemRevision ?? 5,
    options.dynamicSourceResultId,
  );
  const attempt = {
    attemptId: ATTEMPT_ID,
    workItemId: WORK_ITEM_ID,
    actionType: 'OPENCLAW_OVERALL_SYNTHESIS' as const,
    attemptNo: options.attemptNo ?? workItem.revision,
    triggerRequestId: ATTEMPT_REF,
    requestOrigin: 'OPENCLAW_OVR_NONE',
    status: 'RUNNING' as const,
    actorUserId: 'service:openclaw-main',
    tenantId: 'tenant-overall',
    createdAt: new Date('2026-08-16T12:00:00.000Z'),
  };
  const state = {
    status: 'RUNNING',
    claimCount: 0,
    casCount: 0,
    releaseCount: 0,
    transientPersistFailures: options.transientPersistFailures ?? 0,
    persisted: [] as string[],
    completed: [] as string[],
    failed: [] as string[],
  };
  const registrar = {
    getByWorkItemId: async () => workItem,
    compareAndSet: async (input: {
      expectedRevision: number;
      next: Omit<CanonicalWorkItemProjection, 'revision'>;
    }) => {
      state.casCount += 1;
      return { ...input.next, revision: input.expectedRevision + 1 };
    },
  };
  const repository = {
    getRow: async () => ({ tenantId: 'tenant-overall' }),
    getDynamicEvaluationActionByAttemptId: async () => ({
      attemptId: options.dynamicAttemptId ?? 'ATT-BASE',
      workItemId: options.dynamicAttemptWorkItemId ?? WORK_ITEM_ID,
      actionType: 'OPENCLAW_DYNAMIC_EVALUATION' as const,
      attemptNo: 4,
      triggerRequestId:
        options.dynamicAttemptTriggerRef ?? 'DYN-RESULT-1',
      requestOrigin: 'OPENCLAW' as const,
      status: options.dynamicAttemptStatus ?? 'SUCCEEDED',
      actorUserId: 'service:openclaw-main',
      tenantId: 'tenant-overall',
      createdAt: new Date('2026-08-16T11:00:00.000Z'),
    }),
    reserveOverallSynthesisAction: async () => ({ ...attempt, status: state.status }),
    getOverallSynthesisActionByCallerRef: async () => ({ ...attempt, status: state.status }),
    claimOverallSynthesisCommit: async () => {
      state.claimCount += 1;
      if (state.status !== 'RUNNING') throw new Error('OPENCLAW_OVERALL_COMMIT_ALREADY_CLAIMED');
      state.status = 'COMMITTING';
    },
    releaseOpenClawCommitForRetry: async () => {
      if (state.status !== 'COMMITTING') {
        throw new Error('OPENCLAW_COMMIT_RETRY_RELEASE_CONFLICT');
      }
      state.releaseCount += 1;
      state.status = 'RUNNING';
    },
    completeAssessmentAction: async (attemptId: string) => {
      state.status = 'SUCCEEDED';
      state.completed.push(attemptId);
    },
    failAssessmentAction: async (input: { attemptId: string }) => {
      state.status = 'FAILED';
      state.failed.push(input.attemptId);
    },
  };
  const artifactStore = {
    readActualBytes: async (artifact: { ref: string }) =>
      artifact.ref === 'artifact://base' ? baseArtifactBytes() : packageBytes(),
    persistAndReadback: async (bytes: Uint8Array) => {
      if (state.transientPersistFailures > 0) {
        state.transientPersistFailures -= 1;
        throw new Error('FILESERVICE_TRANSIENT_READBACK_FAILURE');
      }
      if (options.persistGate) {
        options.persistGate.entered.resolve();
        await options.persistGate.release.promise;
      }
      const output = new TextDecoder().decode(bytes);
      state.persisted.push(output);
      return {
        artifact: {
          storeRole: 'UnifiedArtifactStoreCandidate' as const,
          ref: 'artifact://overall-output',
          sha256: 'c'.repeat(64),
          byteLength: bytes.byteLength,
          mediaType: 'application/json' as const,
        },
        actualBytes: bytes,
        reused: false,
      };
    },
  };
  return {
    state,
    service: new CanonicalHostOpenClawOverallService(
      registrar as never,
      {
        authorize: async (input: { action: string }) => ({
          action: input.action,
          allowed: true,
          permissionSnapshotVersion: 'permission-overall',
        }),
      } as never,
      { freshRead: async () => ({ permissionSnapshotVersion: 'permission-overall' }) } as never,
      artifactStore as never,
      repository as never,
      { latestSearchRunsAsOf: async () => [] } as never,
      {
        prepareDynamicRulesCandidate: async () => ({
          summary: {
            workItemId: WORK_ITEM_ID,
            documentVersionId: 'DV-737',
            parsedPackageId: 'PKG-737',
            criterionSetId: options.freshCriterionSetId ?? 'JACS-ONE',
            criterionCount: 1,
            evaluationItemCount: 1,
          },
          overall: {
            context: {
              criterionCards: [{
                sourceEvidenceCandidates: [{
                  candidateId: 'SEC-001',
                  sourceRefs: [{
                    sourceRefId: options.candidateSourceRef ?? 'SRC-001',
                  }],
                }],
              }],
            },
          },
        }),
      } as never,
      {
        modelContext: async () => ({
          revision: null,
          artifactSha256: null,
          reviewCount: 0,
          history: [],
          effective: [],
        }),
      } as never,
    ),
  };
}

function workItemProjection(
  revision: number,
  dynamicSourceResultId = 'openclaw-dynamic://DYN-RESULT-1',
): CanonicalWorkItemProjection {
  return {
    workItemId: WORK_ITEM_ID,
    requestId: 'REQ-OVERALL-150',
    revision,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    source: { documentId: 'DOC-737', documentVersionId: 'DV-737' },
    classification: { parserProfileId: 'issuer.boeing.sb' },
    package: {
      packageId: 'PKG-737',
      contractRevision: 'frozen.2',
      contentUnitCount: 1,
      documentIdentity: { documentCode: '737-34-3830', businessRevision: 'Original Issue' },
      artifact: artifact('artifact://package', 'b'.repeat(64)),
    },
    integratedAssessment: {
      status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        sourceResultId: dynamicSourceResultId,
        criterionSetId: 'JACS-ONE',
        criterionCount: 1,
        evaluationItemCount: 1,
        unresolvedCount: 0,
        sourceBoundCandidateCount: 1,
        authorityLevel: 'candidate_only',
        artifact: artifact('artifact://base', BASE_SHA),
        actionAttemptId: 'ATT-BASE',
        staleReason: null,
      },
      overallSynthesis: null,
      overallForAeoConfirmation: null,
    },
  } as unknown as CanonicalWorkItemProjection;
}

function artifact(ref: string, sha256: string) {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref,
    sha256,
    byteLength: 1,
    mediaType: 'application/json' as const,
  };
}

function baseArtifactBytes(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    ruleResults: {
      columns: [
        'ruleId', 'result', 'factsConsidered', 'ruleApplication',
        'analysisSummary', 'conclusion', 'sourceRefs', 'missingInputs',
        'humanReviewRequired',
      ],
      rows: [[
        'RULE-001', 'PASS', ['Fact'], 'Applied rule', 'Analysis',
        'Candidate finding', ['SEC-001'], [], true,
      ]],
    },
  }));
}

function packageBytes(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    sourceRefs: [{ sourceRefId: 'SRC-001', pageStart: 1, pageEnd: 1 }],
  }));
}

function validOutput(): string {
  return JSON.stringify({
    sourceResultId: ATTEMPT_REF,
    documentVersionId: 'DV-737',
    packageId: 'PKG-737',
    baseRuleRevision: 1,
    baseRuleArtifactSha256: `sha256:${BASE_SHA}`,
    engineerReviewRevision: null,
    engineerReviewArtifactSha256: null,
    discoveryStatus: 'NO_DISCOVERY',
    gap: null,
    candidateRefCount: 0,
    findingCount: 1,
    unresolvedCount: 0,
    authorityLevel: 'candidate_only',
    externalDiscoveryIsEvidence: false,
    overallCandidate: '候选综合：当前规则结果与来源定位一致，仍需工程师复核。',
    findings: [{
      finding: '候选发现',
      basis: '来源定位 SRC-001',
      sourceRefIds: ['SRC-001'],
      assumptions: [],
      uncertainty: '需工程师复核',
    }],
    missingInputs: [],
    applicabilityStatus: 'CANDIDATE_REVIEW_REQUIRED',
    engineeringReviewRequired: true,
    adopted: false,
    usableAsEvidence: false,
    providers: {},
  });
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value?: T) => resolvePromise(value as T),
  };
}
