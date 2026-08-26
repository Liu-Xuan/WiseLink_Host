import { createHash } from 'node:crypto';

import type {
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
  UnifiedReaderQueryResult,
} from '../../shared/api.interface';
import {
  canonicalSha256,
  sealResultEnvelope,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type {
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope.types';
import type {
  ActionAttemptRow,
  PreparedActionAttemptCommit,
  ReserveAndClaimInput,
} from '../../server/modules/action-attempt/action-attempt.types';
import {
  APPLICABILITY_MCP_SERVER_NAME,
  APPLICABILITY_MCP_SERVER_VERSION,
  APPLICABILITY_MODEL_VERSION,
  APPLICABILITY_PROMPT_VERSION,
  APPLICABILITY_SKILL_VERSION,
  applicabilityRuntimePolicy,
  type ApplicabilityTaskContract,
} from '../../server/modules/canonical-host/canonical-host-openclaw-applicability.contract';
import { CanonicalHostOpenClawApplicabilityService } from '../../server/modules/canonical-host/canonical-host-openclaw-applicability.service';

describe('CanonicalHostOpenClawApplicabilityService', () => {
  it('freezes only the selected aircraft, bilingual SourceUnits and current SourceRefs', async () => {
    const harness = applicabilityHarness();
    const begin = await harness.begin();
    const task = begin.modelInput as unknown as ApplicabilityTaskContract;

    expect(begin.task.taskType).toBe('OPENCLAW_APPLICABILITY_EVALUATION');
    expect(task.aircraft).toEqual({
      aircraftNumber: 'B-1234',
      assessmentAsOf: '2026-08-27',
    });
    expect(task.fleetBinding.selectionRevision).toBe('selection-r1');
    expect(task.sourceExpressions).toEqual([
      {
        expressionId: 'EXP-1',
        text: 'Applicable to Boeing 737-8 airplanes.',
        sourceRefIds: ['SRC-1'],
        assignmentId: 'ASSIGN-1',
        targetKind: 'module',
        targetId: 'MODULE-1',
        targetSourceRefIds: ['SRC-1'],
        applicabilityLevel: 'document_effectivity',
        contentRef: null,
      },
    ]);
    expect(task.bilingualSourceUnits).toEqual([
      {
        unitId: 'UNIT-1',
        kind: 'paragraph',
        sourceText: 'Applicable to Boeing 737-8 airplanes.',
        translatedText: '适用于波音 737-8 飞机。',
        sourceRefIds: ['SRC-1'],
      },
    ]);
    expect(task.controlledAircraft?.assetId).toBe('ASSET-1');
    expect(task.controlledFacts.map((fact) => fact.factId)).toEqual(['FACT-1']);
    expect(JSON.stringify(task)).not.toContain('ASSET-OTHER');
    expect(JSON.stringify(task)).not.toContain('drive-file-token');
    expect(JSON.stringify(task)).not.toContain('tenant-1');
    expect(JSON.stringify(task)).not.toContain('WI-APP-1');
    expect(begin.task.sourceRefs).toHaveLength(2);
    expect(harness.applicabilityInputs.produceAuthorized).toHaveBeenCalledTimes(
      1,
    );
  });

  it.each([
    [
      'missing frozen assignment target',
      (harness: ReturnType<typeof applicabilityHarness>) => undefined,
      { packageAssignments: [] },
      'APPLICABILITY_FROZEN_USAGE_COUNT_DRIFT',
    ],
    [
      'missing bilingual current',
      (harness: ReturnType<typeof applicabilityHarness>) =>
        harness.mutateCurrent((current) => {
          current.translation = null;
        }),
      {},
      'CURRENT_BILINGUAL_TRANSLATION_REQUIRED',
    ],
    [
      'non-current controlled selection',
      (harness: ReturnType<typeof applicabilityHarness>) =>
        harness.mutateCurrent((current) => {
          current.applicabilityInput!.currentness = 'STALE';
        }),
      {},
      'APPLICABILITY_INPUT_NOT_CURRENT',
    ],
  ])(
    'fails begin before attempt reservation: %s',
    async (_label, mutate, options, expected) => {
      const harness = applicabilityHarness(options);
      mutate(harness);
      await expect(harness.begin()).rejects.toThrow(expected);
      expect(harness.attempts.reserveAndClaim).not.toHaveBeenCalled();
    },
  );

  it('CAS-projects an APPLICABLE candidate through the existing lifecycle', async () => {
    const harness = applicabilityHarness();
    const begin = await harness.begin();
    const result = harness.resultFor(candidateFor(begin));

    const committed = await harness.service.commit(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      result,
    );

    expect(committed).toMatchObject({
      workItemId: 'WI-APP-1',
      workItemRevision: 8,
      status: 'CANDIDATE_ONLY',
      applicability: {
        decision: 'APPLICABLE',
        kleeneResult: true,
        pass: true,
        aircraftNumber: 'B-1234',
        assessmentAsOf: '2026-08-27',
      },
    });
    expect(harness.attempts.prepareCommit).toHaveBeenCalledTimes(1);
    expect(harness.attempts.finishProjectionSuccess).toHaveBeenCalledTimes(1);
    expect(
      harness.artifactStore.stageCandidateAndReadback,
    ).toHaveBeenCalledTimes(1);
    expect(harness.artifactStore.finalizeStagedCandidate).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.registrar.compareAndSet).toHaveBeenCalledTimes(1);
  });

  it('preserves FALSE as NOT_APPLICABLE with pass=false', async () => {
    const harness = applicabilityHarness();
    const begin = await harness.begin();
    const candidate = candidateFor(begin);
    candidate.expressions[0].expressionAst.value = 'A320';

    const committed = await harness.service.commit(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      harness.resultFor(candidate),
    );

    expect(committed).toMatchObject({
      status: 'CANDIDATE_ONLY',
      applicability: {
        decision: 'NOT_APPLICABLE',
        kleeneResult: false,
        pass: false,
      },
    });
  });

  it('uses UNKNOWN only for a Host-missing controlled fact and terminalizes WAITING_INPUT', async () => {
    const harness = applicabilityHarness();
    const begin = await harness.begin();
    const candidate = candidateFor(begin);
    candidate.expressions[0].expressionAst = {
      type: 'assert',
      property: 'optionInstalled',
      operator: 'eq',
      value: true,
      qualifier: 'OPT-X',
    };

    const committed = await harness.service.commit(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      harness.resultFor(candidate),
    );

    expect(committed).toMatchObject({
      status: 'WAITING_INPUT',
      applicability: {
        decision: 'UNKNOWN',
        kleeneResult: 'unknown',
        pass: false,
        blockingUnknownCount: 1,
      },
    });
    expect(harness.attempts.finishProjectionWaitingInput).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.attempts.finishProjectionSuccess).not.toHaveBeenCalled();
  });

  it('accepts only an exact Host-frozen controlled Fleet WAIT', async () => {
    const harness = applicabilityHarness();
    harness.mutateCurrent((current) => {
      current.applicabilityInput!.fleetMasterData.assets = [];
      current.applicabilityInput!.fleetMasterData.facts = [];
    });
    const begin = await harness.begin();
    expect(begin.task.hostResolvedMissingInputs).toHaveLength(1);
    const waiting = harness.resultFor(candidateFor(begin), {
      status: 'WAITING_INPUT',
      businessOutcome: 'WAITING_INPUT',
      candidateStatus: 'WAITING_INPUT',
      modelOutput: null,
      factsConsidered: [],
      missingInputs: structuredClone(begin.task.hostResolvedMissingInputs),
    });

    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        waiting,
      ),
    ).resolves.toMatchObject({ status: 'WAITING_INPUT' });
    expect(
      harness.artifactStore.stageCandidateAndReadback,
    ).not.toHaveBeenCalled();
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
  });

  it('rejects model-invented WAIT/MODEL_AST_UNSUPPORTED with zero mutation', async () => {
    const harness = applicabilityHarness();
    const begin = await harness.begin();
    const waiting = harness.resultFor(candidateFor(begin), {
      status: 'WAITING_INPUT',
      businessOutcome: 'UNKNOWN',
      candidateStatus: 'UNKNOWN',
      modelOutput: null,
      factsConsidered: [],
      missingInputs: [
        {
          code: 'MODEL_AST_UNSUPPORTED',
          message: 'The model declined to parse the expression.',
        },
      ],
    });
    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        waiting,
      ),
    ).rejects.toThrow('APPLICABILITY_WAITING_INPUT_NOT_HOST_RESOLVED');
    expectNoCommitMutation(harness);
  });

  it.each([
    [
      'cross-WorkItem SourceRef',
      (harness: ReturnType<typeof applicabilityHarness>, candidate: any) => {
        candidate.expressions[0].sourceRefIds = ['SRC-CROSS-WI'];
      },
      'APPLICABILITY_CANDIDATE_SOURCE_REF_MISMATCH',
    ],
    [
      'wrong aircraft',
      (_harness: ReturnType<typeof applicabilityHarness>, candidate: any) => {
        candidate.aircraft.aircraftNumber = 'B-9999';
      },
      'APPLICABILITY_CANDIDATE_TASK_BINDING_MISMATCH',
    ],
    [
      'wrong asOf',
      (_harness: ReturnType<typeof applicabilityHarness>, candidate: any) => {
        candidate.aircraft.assessmentAsOf = '2026-08-26';
      },
      'APPLICABILITY_CANDIDATE_TASK_BINDING_MISMATCH',
    ],
    [
      'wrong fact version',
      (_harness: ReturnType<typeof applicabilityHarness>, candidate: any) => {
        candidate.fleetBinding.authorityRevision = 'authority-forged';
      },
      'APPLICABILITY_CANDIDATE_TASK_BINDING_MISMATCH',
    ],
    [
      'wrong candidate provenance',
      (_harness: ReturnType<typeof applicabilityHarness>, candidate: any) => {
        candidate.runtime.runtimeAppId = 'app_forged';
      },
      'APPLICABILITY_RUNTIME_MISMATCH',
    ],
  ])('rejects %s before any mutation', async (_label, mutate, expected) => {
    const harness = applicabilityHarness();
    const begin = await harness.begin();
    const candidate = candidateFor(begin);
    mutate(harness, candidate);

    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        harness.resultFor(candidate),
      ),
    ).rejects.toThrow(expected);
    expectNoCommitMutation(harness);
  });

  it('rejects stale WorkItem revision and same-revision Host fact drift before mutation', async () => {
    const stale = applicabilityHarness();
    const staleBegin = await stale.begin();
    stale.mutateCurrent((current) => {
      current.revision += 1;
    });
    await expect(
      stale.service.commit(
        staleBegin.attemptRef,
        staleBegin.leaseToken,
        staleBegin.leaseGeneration,
        stale.resultFor(candidateFor(staleBegin)),
      ),
    ).rejects.toThrow('WORK_ITEM_REVISION_CONFLICT');
    expectNoCommitMutation(stale);

    const drift = applicabilityHarness();
    const driftBegin = await drift.begin();
    drift.mutateCurrent((current) => {
      current.applicabilityInput!.bindingRevision = 'binding-r2';
    });
    await expect(
      drift.service.commit(
        driftBegin.attemptRef,
        driftBegin.leaseToken,
        driftBegin.leaseGeneration,
        drift.resultFor(candidateFor(driftBegin)),
      ),
    ).rejects.toThrow('APPLICABILITY_TASK_MODEL_INPUT_DRIFT');
    expectNoCommitMutation(drift);
  });

  it('rejects a post-begin controlled owner selection drift before prepare or artifact mutation', async () => {
    const harness = applicabilityHarness();
    const begin = await harness.begin();
    harness.mutateControlledOwner((input) => {
      input!.selectionRevision = 'selection-r2';
      input!.fleetMasterData.sourceRevisionKey = 'fleet-r2';
      input!.fleetMasterData.authorityRevision = 'authority-r2';
    });

    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        harness.resultFor(candidateFor(begin)),
      ),
    ).rejects.toThrow('APPLICABILITY_CONTROLLED_SELECTION_DRIFT');
    expectNoCommitMutation(harness);
    expect(harness.readAttempt()).toMatchObject({
      status: 'RUNNING',
      resultEnvelopeJson: null,
      resultContentHash: null,
      completedAt: null,
      projectionApplied: false,
    });
  });

  it('preserves COMMITTING and its sealed result when WorkItem drifts after prepare', async () => {
    const harness = applicabilityHarness({
      afterPrepare(current) {
        current.revision += 1;
      },
    });
    const begin = await harness.begin();
    const result = harness.resultFor(candidateFor(begin));

    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        result,
      ),
    ).rejects.toThrow('APPLICABILITY_COMMITTING_WORK_ITEM_DRIFT');
    expect(harness.readAttempt()).toMatchObject({
      status: 'COMMITTING',
      resultContentHash: result.contentHash,
      completedAt: null,
      terminalReason: null,
      projectionApplied: false,
      leaseGeneration: begin.leaseGeneration,
      leaseToken: begin.leaseToken,
    });
    expect(harness.attempts.finishProjectionConflict).not.toHaveBeenCalled();
    expect(
      harness.artifactStore.stageCandidateAndReadback,
    ).not.toHaveBeenCalled();
  });

  it('discards a private staged artifact when a competing WorkItem CAS wins', async () => {
    const harness = applicabilityHarness({
      beforeCandidateCas(current) {
        current.revision += 1;
      },
    });
    const begin = await harness.begin();
    const result = harness.resultFor(candidateFor(begin));

    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        result,
      ),
    ).rejects.toThrow('WORK_ITEM_CAS_CONFLICT');
    expect(
      harness.artifactStore.stageCandidateAndReadback,
    ).toHaveBeenCalledTimes(1);
    expect(harness.artifactStore.discardStagedCandidate).toHaveBeenCalledTimes(
      1,
    );
    expect(
      harness.artifactStore.finalizeStagedCandidate,
    ).not.toHaveBeenCalled();
    expect(harness.readCurrent().applicability ?? null).toBeNull();
    expect(harness.readAttempt()).toMatchObject({
      status: 'COMMITTING',
      resultContentHash: result.contentHash,
      completedAt: null,
      terminalReason: null,
      projectionApplied: false,
    });
  });

  it.each(['WAITING_INPUT', 'FAILED'] as const)(
    'rejects stale %s terminalization before ActionAttempt mutation',
    async (status) => {
      const harness = applicabilityHarness();
      const begin = await harness.begin();
      harness.mutateCurrent((current) => {
        current.revision += 1;
      });
      const overrides: Partial<OpenClawResultEnvelope> =
        status === 'WAITING_INPUT'
          ? {
              status,
              businessOutcome: 'WAITING_INPUT',
              candidateStatus: 'WAITING_INPUT',
              modelOutput: null,
              factsConsidered: [],
              missingInputs: [
                { code: 'FORGED_WAIT', message: 'forged model wait' },
              ],
            }
          : {
              status,
              businessOutcome: 'NOT_PRODUCED',
              candidateStatus: null,
              modelOutput: null,
              factsConsidered: [],
              errorCode: 'MODEL_AST_UNSUPPORTED',
              errorDetail: 'unsupported model AST',
            };
      await expect(
        harness.service.commit(
          begin.attemptRef,
          begin.leaseToken,
          begin.leaseGeneration,
          harness.resultFor(candidateFor(begin), overrides),
        ),
      ).rejects.toThrow('WORK_ITEM_REVISION_CONFLICT');
      expectNoCommitMutation(harness);
    },
  );

  it('rejects actual ResultEnvelope provenance and damaged envelope before mutation', async () => {
    const provenance = applicabilityHarness();
    const begin = await provenance.begin();
    const wrong = provenance.resultFor(candidateFor(begin), {
      modelVersion: 'fallback-model',
    });
    await expect(
      provenance.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        wrong,
      ),
    ).rejects.toThrow('APPLICABILITY_RESULT_PROVENANCE_MISMATCH');
    expectNoCommitMutation(provenance);

    const damaged = applicabilityHarness();
    const damagedBegin = await damaged.begin();
    await expect(
      damaged.service.commit(
        damagedBegin.attemptRef,
        damagedBegin.leaseToken,
        damagedBegin.leaseGeneration,
        { schemaVersion: 'damaged' },
      ),
    ).rejects.toThrow('RESULT_ENVELOPE_SCHEMA_INVALID');
    expectNoCommitMutation(damaged);
  });

  it.each([
    ['expired lease', { expiredLease: true }, 'ACTION_ATTEMPT_LEASE_EXPIRED'],
    [
      'stale generation',
      { expectedGeneration: 2 },
      'ACTION_ATTEMPT_LEASE_FENCE_REJECTED',
    ],
  ])(
    'rejects %s without artifact/current mutation',
    async (_label, options, expected) => {
      const harness = applicabilityHarness(options);
      const begin = await harness.begin();
      await expect(
        harness.service.commit(
          begin.attemptRef,
          begin.leaseToken,
          begin.leaseGeneration,
          harness.resultFor(candidateFor(begin)),
        ),
      ).rejects.toThrow(expected);
      expect(
        harness.artifactStore.stageCandidateAndReadback,
      ).not.toHaveBeenCalled();
      expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    },
  );

  it('reconciles COMMITTING recovery and duplicate submission without a second artifact or CAS', async () => {
    const harness = applicabilityHarness();
    const begin = await harness.begin();
    const result = harness.resultFor(candidateFor(begin));
    const first = await harness.service.commit(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      result,
    );
    expect(first).toMatchObject({ status: 'CANDIDATE_ONLY' });

    harness.setAttemptStatus('COMMITTING');
    const recovered = await harness.service.commit(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      result,
    );
    expect(recovered).toEqual(first);
    harness.setAttemptStatus('SUCCEEDED');
    const duplicate = await harness.service.commit(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      result,
    );
    expect(duplicate).toEqual(first);
    expect(
      harness.artifactStore.stageCandidateAndReadback,
    ).toHaveBeenCalledTimes(1);
    expect(harness.registrar.compareAndSet).toHaveBeenCalledTimes(1);
  });
});

function applicabilityHarness(
  options: {
    expiredLease?: boolean;
    expectedGeneration?: number;
    packageAssignments?: unknown[];
    afterPrepare?: (
      current: CanonicalWorkItemProjection,
      row: ActionAttemptRow,
    ) => void;
    beforeCandidateCas?: (
      current: CanonicalWorkItemProjection,
      row: ActionAttemptRow,
    ) => void;
  } = {},
) {
  const packageAssignments = options.packageAssignments ?? [
    {
      assignmentId: 'ASSIGN-1',
      expressionId: 'EXP-1',
      authority: 'source_asserted',
      target: {
        kind: 'module',
        targetId: 'MODULE-1',
        sourceRefIds: ['SRC-1'],
      },
    },
  ];
  const packageBytes = new TextEncoder().encode(
    JSON.stringify({
      sourceRefs: [{ sourceRefId: 'SRC-1' }],
      modules: [{ moduleId: 'MODULE-1' }],
      applicability: {
        sourceExpressions: [
          {
            expressionId: 'EXP-1',
            text: 'Applicable to Boeing 737-8 airplanes.',
            form: 'display_text',
            authority: 'source_asserted',
            sourceRefIds: ['SRC-1'],
          },
        ],
        assignments: packageAssignments,
      },
    }),
  );
  const bilingualBytes = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 'wiselink.3_1.bilingual_translation_artifact.v1',
      candidateOnly: true,
      source: {
        documentId: 'DOC-1',
        revisionId: 'DV-1',
        sbdPackageId: 'PKG-1',
        sbdContentHash: 'sha256:package-content',
        tcpPackageId: null,
        tcpContentHash: null,
      },
      ruleSet: {
        ruleSetId: 'wiselink.host.translation-rules.zh-cn.v1',
        ruleSetVersion: '1.0.0',
      },
      units: [
        {
          unitId: 'UNIT-1',
          kind: 'paragraph',
          sourceText: 'Applicable to Boeing 737-8 airplanes.',
          translatedText: '适用于波音 737-8 飞机。',
          sourceRefIds: ['SRC-1'],
          engineerRevisionId: null,
        },
      ],
      validation: { verdict: 'ACCEPTED' },
      execution: { actionAttemptId: 'ATT-TRANSLATE-1' },
    }),
  );
  let current = parsedWorkItem(packageBytes, bilingualBytes);
  let ownerInput = structuredClone(current.applicabilityInput!);
  let task: OpenClawTaskEnvelope | null = null;
  let row: ActionAttemptRow | null = null;
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => structuredClone(current)),
    compareAndSet: jest.fn(
      async (input: {
        expectedRevision: number;
        next: Omit<CanonicalWorkItemProjection, 'revision'>;
      }) => {
        if (input.next.applicability?.actionAttemptId === row?.attemptId) {
          options.beforeCandidateCas?.(current, row);
        }
        if (input.expectedRevision !== current.revision) {
          throw new Error('WORK_ITEM_CAS_CONFLICT');
        }
        current = {
          ...structuredClone(input.next),
          revision: current.revision + 1,
        };
        return structuredClone(current);
      },
    ),
  };
  const reader = {
    readAllSourceUnits: jest.fn(async () => sourceUnits()),
  };
  const artifactStore = {
    readActualBytes: jest.fn(
      async (artifact: UnifiedPackageArtifactDescriptor) =>
        artifact.ref === current.package!.artifact.ref
          ? packageBytes.slice()
          : bilingualBytes.slice(),
    ),
    persistAndReadback: jest.fn(async (bytes: Uint8Array) => ({
      artifact: {
        storeRole: 'UnifiedArtifactStoreCandidate' as const,
        ref: 'artifact://UnifiedArtifactStoreCandidate/applicability.json',
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
        mediaType: 'application/json' as const,
      },
      bytes: bytes.slice(),
      reused: false,
    })),
    stageCandidateAndReadback: jest.fn(
      async ({ bytes, ownerRef }: { bytes: Uint8Array; ownerRef: string }) => ({
        schemaVersion: 'wiselink.3_1.staged_candidate_artifact.v1' as const,
        ownerRefHash: sha256(new TextEncoder().encode(ownerRef)),
        artifact: {
          storeRole: 'UnifiedArtifactStoreCandidate' as const,
          ref: `artifact://UnifiedArtifactStoreCandidate/_staging/${ownerRef}/${sha256(bytes)}`,
          sha256: sha256(bytes),
          byteLength: bytes.byteLength,
          mediaType: 'application/json' as const,
        },
        bytes: bytes.slice(),
        reused: false,
      }),
    ),
    finalizeStagedCandidate: jest.fn(async (staged: any) => ({
      artifact: structuredClone(staged.artifact),
      bytes: staged.bytes.slice(),
      reused: staged.reused,
    })),
    discardStagedCandidate: jest.fn(async () => undefined),
  };
  const attempts = {
    reserveAndClaim: jest.fn(async (input: ReserveAndClaimInput) => {
      const identity = {
        attemptId: 'ATT-APP-1',
        operationRef: 'AQ-APP-1',
        triggerRequestId: 'REQ-APP-INTERNAL-1',
        attemptNo: 1,
        createdAt: new Date('2026-08-27T10:00:00.000Z'),
      };
      const modelInput = await input.buildModelInput(identity);
      task = sealTaskEnvelope({
        schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
        actionAttemptId: identity.attemptId,
        operationRef: identity.operationRef,
        taskType: input.taskType,
        priority: 100,
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        inputRevision: input.inputRevision,
        baseRevision: input.baseRevision,
        documentVersionId: input.documentVersionId,
        sourceRefs: input.sourceRefs ?? [],
        allowedConnectors: input.allowedConnectors ?? [],
        hostResolvedMissingInputs: input.hostResolvedMissingInputs ?? [],
        modelInput,
        deadline: '2026-08-27T10:10:00.000Z',
        idempotencyKey: input.idempotencyKey,
      });
      row = attemptRow(task, 'RUNNING');
      return {
        attemptRef: identity.operationRef,
        status: 'RUNNING' as const,
        leaseToken: row.leaseToken!,
        leaseGeneration: row.leaseGeneration,
        leaseExpiresAt: row.leaseExpiresAt!.toISOString(),
        task,
        created: true,
        triggerRequestId: identity.triggerRequestId,
      };
    }),
    readScoped: jest.fn(async () => structuredClone(row!)),
    prepareCommit: jest.fn(
      async (input: { leaseGeneration: number; result: unknown }) => {
        if (options.expiredLease)
          throw new Error('ACTION_ATTEMPT_LEASE_EXPIRED');
        if (
          options.expectedGeneration !== undefined &&
          input.leaseGeneration !== options.expectedGeneration
        ) {
          throw new Error('ACTION_ATTEMPT_LEASE_FENCE_REJECTED');
        }
        const result = input.result as OpenClawResultEnvelope;
        if (result.status === 'WAITING_INPUT') {
          row!.status = 'WAITING_INPUT';
          row!.terminalReason = 'HOST_MISSING_CONTROLLED_FACTS';
        } else if (result.status === 'FAILED') {
          row!.status = 'FAILED';
          row!.terminalReason = result.errorCode;
        } else if (row!.status === 'RUNNING') {
          row!.status = 'COMMITTING';
        }
        row!.resultEnvelopeJson = JSON.stringify(result);
        row!.resultContentHash = result.contentHash;
        options.afterPrepare?.(current, row!);
        return preparedCommit(row!, task!, result);
      },
    ),
    finishProjectionSuccess: jest.fn(
      async (prepared: PreparedActionAttemptCommit) => {
        row!.status = 'SUCCEEDED';
        row!.projectionApplied = true;
        return {
          attemptRef: prepared.task.operationRef,
          status: 'SUCCEEDED',
          projectionApplied: true,
          terminalReason: 'PROJECTION_CAS_APPLIED',
        };
      },
    ),
    finishProjectionWaitingInput: jest.fn(
      async (prepared: PreparedActionAttemptCommit) => {
        row!.status = 'WAITING_INPUT';
        row!.projectionApplied = true;
        return {
          attemptRef: prepared.task.operationRef,
          status: 'WAITING_INPUT',
          projectionApplied: true,
          terminalReason: 'HOST_MISSING_CONTROLLED_FACTS',
        };
      },
    ),
    finishProjectionConflict: jest.fn(),
    projectTerminal: jest.fn((selected: ActionAttemptRow) => ({
      attemptRef: selected.operationRef!,
      status: selected.status,
      projectionApplied: selected.projectionApplied,
      terminalReason: selected.terminalReason,
    })),
  };
  const serviceScope = {
    authorizeOpenClawApplicabilityContext: jest.fn(
      async ({ applicabilityContextRef, requestId }) => ({
        ...verifiedScope(),
        applicabilityContextRef,
        requestId,
      }),
    ),
    authorizeOpenClawAttempt: jest.fn(async () => ({
      ...verifiedScope(),
      attemptRef: 'AQ-APP-1',
    })),
  };
  const applicabilityInputs = {
    produceAuthorized: jest.fn(async () => structuredClone(current)),
    resolveCurrent: jest.fn(async () => ({
      workItem: structuredClone(current),
      applicabilityInput: structuredClone(current.applicabilityInput!),
    })),
    readCurrentOwnerValidated: jest.fn(async () => {
      if (
        canonicalSha256(ownerInput) !==
        canonicalSha256(current.applicabilityInput!)
      ) {
        throw new Error('APPLICABILITY_CONTROLLED_SELECTION_DRIFT');
      }
      return {
        workItem: structuredClone(current),
        applicabilityInput: structuredClone(current.applicabilityInput!),
      };
    }),
  };
  const service = new CanonicalHostOpenClawApplicabilityService(
    registrar as never,
    artifactStore as never,
    reader as never,
    attempts as never,
    serviceScope as never,
    applicabilityInputs as never,
  );
  return {
    service,
    registrar,
    artifactStore,
    applicabilityInputs,
    attempts,
    begin: () => service.begin('APCTX-OPAQUE-1', 'request-1'),
    resultFor(
      candidate: Record<string, any>,
      overrides: Partial<OpenClawResultEnvelope> = {},
    ) {
      const taskContract = task!
        .modelInput as unknown as ApplicabilityTaskContract;
      return sealResultEnvelope({
        schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
        actionAttemptId: task!.actionAttemptId,
        operationRef: task!.operationRef,
        taskType: 'OPENCLAW_APPLICABILITY_EVALUATION',
        workItemId: task!.workItemId,
        baseRevision: task!.baseRevision,
        status: 'SUCCEEDED',
        businessOutcome: 'CANDIDATE_READY',
        candidateStatus: null,
        modelOutput: JSON.stringify(candidate),
        outputArtifactRefs: [],
        sourceRefs: structuredClone(task!.sourceRefs),
        factsConsidered: taskContract.controlledFacts.map(
          (fact) => fact.factId,
        ),
        missingInputs: [],
        conflicts: [],
        warnings: [],
        modelVersion: APPLICABILITY_MODEL_VERSION,
        promptVersion: APPLICABILITY_PROMPT_VERSION,
        skillVersion: APPLICABILITY_SKILL_VERSION,
        toolVersions: {
          [APPLICABILITY_MCP_SERVER_NAME]: APPLICABILITY_MCP_SERVER_VERSION,
        },
        runMetrics: { durationMs: 10, inputUnits: 100, outputUnits: 100 },
        errorCode: null,
        errorDetail: null,
        ...overrides,
      });
    },
    mutateCurrent(mutate: (value: CanonicalWorkItemProjection) => void) {
      mutate(current);
      ownerInput = structuredClone(current.applicabilityInput!);
    },
    mutateControlledOwner(
      mutate: (
        value: CanonicalWorkItemProjection['applicabilityInput'],
      ) => void,
    ) {
      mutate(ownerInput);
    },
    setAttemptStatus(status: string) {
      row!.status = status;
    },
    readAttempt: () => structuredClone(row!),
    readCurrent: () => structuredClone(current),
  };
}

function candidateFor(begin: {
  modelInput: Record<string, unknown>;
}): Record<string, any> {
  const task = begin.modelInput as unknown as ApplicabilityTaskContract;
  return {
    schemaVersion: 'wiselink.3_1.applicability_candidate.v1',
    operation: 'EXTRACT_APPLICABILITY',
    candidateStatus: 'CANDIDATE',
    inputRevision: task.inputRevision,
    documentVersionRef: task.documentVersionRef,
    sourcePackage: structuredClone(task.sourcePackage),
    bilingualBinding: structuredClone(task.bilingualBinding),
    aircraft: structuredClone(task.aircraft),
    fleetBinding: structuredClone(task.fleetBinding),
    expressions: [
      {
        expressionId: 'EXP-1',
        sourceRefIds: ['SRC-1'],
        extractionStatus: 'extracted',
        expressionAst: {
          type: 'assert',
          property: 'model',
          operator: 'eq',
          value: 'B737-8',
        },
      },
    ],
    runtime: applicabilityRuntimePolicy(),
    authority: {
      candidateOnly: true,
      createsEvidenceRef: false,
      createsClosureDecision: false,
      createsActionReadiness: false,
      createsAirworthinessConclusion: false,
    },
  };
}

function parsedWorkItem(
  packageBytes: Uint8Array,
  bilingualBytes: Uint8Array,
): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-APP-1',
    requestId: 'REQ-PARSE-1',
    revision: 7,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'perm-1',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor-1',
      decisionId: 'decision-1',
      decisionHash: 'decision-hash-1',
      permissionSnapshotVersion: 'perm-1',
    },
    source: {
      documentId: 'DOC-1',
      documentVersionId: 'DV-1',
      parserRequestId: 'PARSER-1',
      sourceArtifactId: 'SOURCE-1',
      sourceFileSha256: 'b'.repeat(64),
      sourceByteLength: 25556,
      driveFileToken: 'drive-file-token',
      driveSourceVersion: 'v1',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      classifierReleaseId: 'classifier-1',
      classifierReleaseHash: 'c'.repeat(64),
      parserProfileId: 'parser-1',
      parserProfileHash: 'd'.repeat(64),
      fingerprint: 'classification-1',
    },
    package: {
      packageId: 'PKG-1',
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: artifact('package.json', packageBytes),
      contentHash: 'sha256:package-content',
      semanticHash: 'sha256:semantic',
      provenanceHash: 'sha256:provenance',
      coverageHash: 'sha256:coverage',
      resultStatus: 'complete',
      title: 'SB test',
      contentUnitCount: 1,
      sourceRefCount: 1,
      readerReceiptId: 'READER-1',
      usagePolicy: {
        presentationMode: 'ENGINEERING_DOCUMENT',
        qualityStatus: 'PASS',
        applicability: {
          sourceExpressionCount: 1,
          normalizedCandidateCount: 0,
          assignmentCount: 1,
        },
        assessmentAutoAdoptionAllowed: false,
        aeoAutoAdoptionAllowed: false,
        projectionSource: 'IMMUTABLE_PACKAGE_ACTUAL_BYTES',
      },
      fullValidatorProof: {} as never,
    },
    translation: {
      schemaVersion: 'wiselink.3_1.translation_candidate_projection.v1',
      status: 'CANDIDATE_ONLY',
      currentness: 'CURRENT',
      staleReason: null,
      sourceResultId: 'translation-result-1',
      actionAttemptId: 'ATT-TRANSLATE-1',
      inputRevision: 6,
      documentId: 'DOC-1',
      documentVersionId: 'DV-1',
      sourcePackageId: 'PKG-1',
      sourcePackageContentHash: 'sha256:package-content',
      ruleSetId: 'wiselink.host.translation-rules.zh-cn.v1',
      ruleSetVersion: '1.0.0',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      sourceUnitCount: 1,
      translatedUnitCount: 1,
      pendingTranslationUnitCount: 0,
      sourceRefCount: 1,
      engineerRevisionCount: 0,
      validationVerdict: 'ACCEPTED',
      validationFindingCount: 0,
      artifact: artifact('translation.json', bilingualBytes),
    },
    applicabilityInput: {
      schemaVersion: 'wiselink.3_1.applicability_input_projection.v1',
      applicabilityContextRef: 'APCTX-OPAQUE-1',
      workItemId: 'WI-APP-1',
      documentVersionId: 'DV-1',
      sourcePackageId: 'PKG-1',
      sourcePackageContentHash: 'sha256:package-content',
      sourcePackageArtifactSha256: sha256(packageBytes),
      targetBindingHash: canonicalSha256([
        {
          expressionId: 'EXP-1',
          sourceRefIds: ['SRC-1'],
          assignmentId: 'ASSIGN-1',
          targetKind: 'module',
          targetId: 'MODULE-1',
          targetSourceRefIds: ['SRC-1'],
          applicabilityLevel: 'document_effectivity',
          contentRef: null,
        },
      ]),
      selectionRevision: 'selection-r1',
      bindingRevision: 'binding-r1',
      currentness: 'CURRENT',
      aircraftNumber: 'B-1234',
      assessmentAsOf: '2026-08-27',
      fleetMasterData: {
        schemaVersion: 'wiselink.v3_1.applicability_fleet.fleet_master_data.v1',
        sourceSnapshotId: 'fleet-snapshot-1',
        sourceRevisionKey: 'fleet-r1',
        authorityRevision: 'authority-r1',
        sourceAsOf: '2026-08-27',
        assets: [
          {
            assetId: 'ASSET-1',
            assetVersionId: 'ASSET-V1',
            aircraftNumber: 'B-1234',
            fleetFamily: 'B737',
            aircraftModel: 'B737-8',
            series: '737-8',
            sourceRef: {
              sourceTable: 'fleet_asset',
              sourceRecordId: 'asset-row-1',
            },
            recordHash: 'asset-record-hash-1',
          },
          {
            assetId: 'ASSET-OTHER',
            assetVersionId: 'ASSET-OTHER-V1',
            aircraftNumber: 'B-9999',
            sourceRef: {
              sourceTable: 'fleet_asset',
              sourceRecordId: 'asset-row-other',
            },
            recordHash: 'asset-record-hash-other',
          },
        ],
        facts: [
          {
            factId: 'FACT-1',
            assetId: 'ASSET-1',
            factType: 'fleet_configuration',
            property: 'optionInstalled',
            qualifier: 'OPT-KNOWN',
            value: true,
            validAsOf: '2026-08-20',
            sourceRef: {
              sourceTable: 'fleet_fact',
              sourceRecordId: 'fact-row-1',
            },
            recordHash: 'fact-record-hash-1',
          },
          {
            factId: 'FACT-OTHER',
            assetId: 'ASSET-OTHER',
            factType: 'fleet_configuration',
            property: 'optionInstalled',
            qualifier: 'OPT-SECRET-OTHER',
            value: true,
            sourceRef: {
              sourceTable: 'fleet_fact',
              sourceRecordId: 'fact-row-other',
            },
            recordHash: 'fact-record-hash-other',
          },
        ],
      },
    },
    failure: null,
    recordingFailure: null,
  };
}

function sourceUnits(): UnifiedReaderQueryResult[] {
  return [
    {
      unitId: 'UNIT-1',
      kind: 'paragraph',
      text: 'Applicable to Boeing 737-8 airplanes.',
      sourceRefIds: ['SRC-1'],
    },
  ];
}

function attemptRow(
  task: OpenClawTaskEnvelope,
  status: string,
): ActionAttemptRow {
  return {
    attemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    triggerRequestId: 'REQ-APP-INTERNAL-1',
    workItemId: task.workItemId,
    actionType: 'OPENCLAW_APPLICABILITY_EVALUATION',
    attemptNo: 1,
    status,
    requestOrigin: 'OPENCLAW_MCP_V1',
    tenantId: task.tenantId,
    actorUserId: 'service:openclaw-main',
    priority: 100,
    inputRevision: task.inputRevision,
    baseRevision: task.baseRevision,
    documentVersionId: task.documentVersionId,
    taskEnvelopeJson: JSON.stringify(task),
    taskInputHash: task.inputHash,
    resultEnvelopeJson: null,
    resultContentHash: null,
    idempotencyKey: task.idempotencyKey,
    claimCount: 1,
    retryCount: 0,
    maxAttempts: 3,
    leaseOwner: 'service:openclaw-main',
    leaseToken: '00000000-0000-4000-8000-000000000001',
    leaseGeneration: 1,
    leaseExpiresAt: new Date('2026-08-27T10:01:00.000Z'),
    lastHeartbeatAt: new Date('2026-08-27T10:00:30.000Z'),
    nextAttemptAt: null,
    deadlineAt: new Date('2026-08-27T10:10:00.000Z'),
    cancelRequestedAt: null,
    cancelReason: null,
    terminalReason: null,
    projectionApplied: false,
    executorSessionKey: `g2-action-attempt:${task.operationRef}`,
    commitStartedAt: null,
    leaseSlot: 0,
    startedAt: new Date('2026-08-27T10:00:00.000Z'),
    completedAt: null,
    createdAt: new Date('2026-08-27T10:00:00.000Z'),
    updatedAt: new Date('2026-08-27T10:00:00.000Z'),
  };
}

function preparedCommit(
  row: ActionAttemptRow,
  task: OpenClawTaskEnvelope,
  result: OpenClawResultEnvelope,
): PreparedActionAttemptCommit {
  return {
    row: structuredClone(row),
    task: structuredClone(task),
    result: structuredClone(result),
    recovery: row.status !== 'RUNNING',
  };
}

function verifiedScope() {
  return {
    principalId: 'service:openclaw-main',
    appId: 'app_17bzc551rsg',
    tenantId: 'tenant-1',
    workItemId: 'WI-APP-1',
    authorizationFingerprint: 'scope-fingerprint-1',
  };
}

function artifact(
  name: string,
  bytes: Uint8Array,
): UnifiedPackageArtifactDescriptor {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref: `artifact://UnifiedArtifactStoreCandidate/${name}`,
    sha256: sha256(bytes),
    byteLength: bytes.byteLength,
    mediaType: 'application/json',
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function expectNoCommitMutation(
  harness: ReturnType<typeof applicabilityHarness>,
): void {
  expect(harness.attempts.prepareCommit).not.toHaveBeenCalled();
  expect(
    harness.artifactStore.stageCandidateAndReadback,
  ).not.toHaveBeenCalled();
  expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
}
