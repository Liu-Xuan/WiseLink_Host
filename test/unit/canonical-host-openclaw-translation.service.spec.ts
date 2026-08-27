import { createHash } from 'node:crypto';

import type {
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
  UnifiedReaderQueryResult,
} from '../../shared/api.interface';
import {
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
import { CanonicalHostOpenClawTranslationService } from '../../server/modules/canonical-host/canonical-host-openclaw-translation.service';
import { CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY } from '../../server/modules/canonical-host/canonical-host-openclaw-runtime-policy';
import {
  TRANSLATION_RESULT_SCHEMA_VERSION,
  type TranslationTaskContract,
} from '../../server/modules/canonical-host/canonical-translation-rule-contract';
import { HostOwnedV1TranslationRuleSetPrivateProvider } from '../../server/modules/canonical-host/canonical-translation-rule-set-v1.private';

type RuntimeProvenanceOverrides = Partial<
  Pick<
    OpenClawResultEnvelope,
    'modelVersion' | 'promptVersion' | 'skillVersion' | 'toolVersions'
  >
>;

describe('CanonicalHostOpenClawTranslationService', () => {
  it('freezes Reader units and exact rules, validates, persists readback bytes, and CAS-projects candidate-only bilingual output', async () => {
    const harness = harnessForTranslation();
    const begin = await harness.service.begin(harness.workItem.workItemId);
    const taskContract = begin.modelInput as unknown as TranslationTaskContract;
    expect(begin.task.taskType).toBe('OPENCLAW_TRANSLATE');
    expect(taskContract.sourceUnits).toHaveLength(2);
    expect(taskContract.rulePack.meta).toMatchObject({
      rulePackId: 'wiselink.host.translation-rules.zh-cn.v1',
      rulePackVersion: '1.0.0',
      targetLocale: 'zh-CN',
    });
    expect(begin.task.sourceRefs).toEqual([
      {
        ref: harness.workItem.package!.artifact.ref,
        sha256: harness.workItem.package!.artifact.sha256,
      },
    ]);

    const modelOutput = JSON.stringify({
      schemaVersion: TRANSLATION_RESULT_SCHEMA_VERSION,
      rulePackId: taskContract.rulePack.meta.rulePackId,
      rulePackVersion: taskContract.rulePack.meta.rulePackVersion,
      taskStartBinding: taskContract.taskStartBinding,
      candidateUnits: [
        {
          unitKey: 'UNIT-1',
          text: '警告 飞机 AIMS-2 P/N 123-ABC 5 kg。',
          sourceRefIds: ['SRC-1'],
          engineerRevision: null,
        },
        {
          unitKey: 'UNIT-2',
          text: '注 驾驶舱。',
          sourceRefIds: ['SRC-2'],
          engineerRevision: null,
        },
      ],
    });
    harness.prepare(modelOutput);

    const committed = await harness.service.commit(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      harness.result,
    );

    expect(committed).toMatchObject({
      workItemId: harness.workItem.workItemId,
      workItemRevision: 8,
      status: 'CANDIDATE_ONLY',
      translation: {
        currentness: 'CURRENT',
        sourceUnitCount: 2,
        translatedUnitCount: 2,
        pendingTranslationUnitCount: 0,
        validationVerdict: 'ACCEPTED',
        validationFindingCount: 0,
      },
    });
    expect(harness.artifactStore.persistAndReadback).toHaveBeenCalledTimes(1);
    expect(harness.registrar.compareAndSet).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: harness.workItem.workItemId,
        expectedRevision: 7,
        syncPrimaryAttempt: false,
      }),
    );
    expect(harness.attempts.finishProjectionSuccess).toHaveBeenCalledTimes(1);
    expect(harness.attempts.finishResultGateFailure).not.toHaveBeenCalled();

    const persistedBytes = harness.persistedBytes();
    const artifact = JSON.parse(new TextDecoder().decode(persistedBytes));
    expect(artifact).toMatchObject({
      schemaVersion: 'wiselink.3_1.bilingual_translation_artifact.v1',
      candidateOnly: true,
      source: taskContract.taskStartBinding,
      ruleSet: {
        ruleSetId: taskContract.rulePack.meta.rulePackId,
        ruleSetVersion: taskContract.rulePack.meta.rulePackVersion,
      },
      validation: { verdict: 'ACCEPTED', validatedUnitCount: 2 },
      execution: { actionAttemptId: begin.task.actionAttemptId },
    });
    expect(
      artifact.units.map((unit: { unitId: string }) => unit.unitId),
    ).toEqual(['UNIT-1', 'UNIT-2']);
  });

  it('fails ResultGate and performs no artifact or projection write when a number changes', async () => {
    const harness = harnessForTranslation();
    const begin = await harness.service.begin(harness.workItem.workItemId);
    const taskContract = begin.modelInput as unknown as TranslationTaskContract;
    harness.prepare(
      JSON.stringify({
        schemaVersion: TRANSLATION_RESULT_SCHEMA_VERSION,
        rulePackId: taskContract.rulePack.meta.rulePackId,
        rulePackVersion: taskContract.rulePack.meta.rulePackVersion,
        taskStartBinding: taskContract.taskStartBinding,
        candidateUnits: [
          {
            unitKey: 'UNIT-1',
            text: '警告 飞机 AIMS-2 P/N 123-ABC 6 kg。',
            sourceRefIds: ['SRC-1'],
            engineerRevision: null,
          },
          {
            unitKey: 'UNIT-2',
            text: '注 驾驶舱。',
            sourceRefIds: ['SRC-2'],
            engineerRevision: null,
          },
        ],
      }),
    );

    const terminal = await harness.service.commit(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      harness.result,
    );

    expect(terminal).toEqual({
      attemptRef: begin.attemptRef,
      status: 'FAILED',
      projectionApplied: false,
      terminalReason: 'RESULT_GATE_REJECTED',
    });
    expect(harness.attempts.finishResultGateFailure).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        message: expect.stringContaining('NUMBER_NOT_PRESERVED'),
      }),
    );
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
  });

  it('fails ResultGate on a non-exact model result shape without writing', async () => {
    const harness = harnessForTranslation();
    const begin = await harness.service.begin(harness.workItem.workItemId);
    const taskContract = begin.modelInput as unknown as TranslationTaskContract;
    harness.prepare(
      JSON.stringify({
        schemaVersion: TRANSLATION_RESULT_SCHEMA_VERSION,
        rulePackId: taskContract.rulePack.meta.rulePackId,
        rulePackVersion: taskContract.rulePack.meta.rulePackVersion,
        taskStartBinding: taskContract.taskStartBinding,
        candidateUnits: [],
        invented: true,
      }),
    );

    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        harness.result,
      ),
    ).resolves.toMatchObject({
      status: 'FAILED',
      projectionApplied: false,
      terminalReason: 'RESULT_GATE_REJECTED',
    });
    expect(harness.attempts.finishResultGateFailure).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        message: 'TRANSLATION_RESULT_CONTRACT_INVALID',
      }),
    );
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
  });

  it.each<[string, RuntimeProvenanceOverrides]>([
    ['missing model provenance', { modelVersion: '' }],
    ['unreadable fallback provenance', { modelVersion: 'fallback' }],
    ['unreadable unknown provenance', { modelVersion: 'unknown' }],
    [
      'wrong skill',
      { skillVersion: 'wiselink-research-and-synthesize@r09.c3' },
    ],
    [
      'wrong MCP',
      {
        toolVersions: {
          [CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY.mcpServerName]: '1.1.0',
        },
      },
    ],
    ['empty prompt', { promptVersion: '' }],
  ])(
    'rejects %s before prepareCommit, artifact persistence, or CAS',
    async (_caseName, overrides) => {
      const harness = harnessForTranslation();
      const begin = await harness.service.begin(harness.workItem.workItemId);
      harness.prepare('{}', overrides);

      await expect(
        harness.service.commit(
          begin.attemptRef,
          begin.leaseToken,
          begin.leaseGeneration,
          harness.result,
        ),
      ).rejects.toThrow();
      expect(harness.attempts.prepareCommit).not.toHaveBeenCalled();
      expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
      expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    },
  );
});

function harnessForTranslation() {
  const workItem = parsedWorkItem();
  let current = structuredClone(workItem);
  let task: OpenClawTaskEnvelope | null = null;
  let result: OpenClawResultEnvelope | null = null;
  let persisted: Uint8Array | null = null;
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => structuredClone(current)),
    compareAndSet: jest.fn(
      async (input: {
        expectedRevision: number;
        next: Omit<CanonicalWorkItemProjection, 'revision'>;
      }) => {
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
    persistAndReadback: jest.fn(async (bytes: Uint8Array) => {
      persisted = bytes.slice();
      const artifact: UnifiedPackageArtifactDescriptor = {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: 'artifact://UnifiedArtifactStoreCandidate/translation/accepted.json',
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
        mediaType: 'application/json',
      };
      return { artifact, bytes: bytes.slice(), reused: false };
    }),
    readActualBytes: jest.fn(),
  };
  const attempts = {
    reserveAndClaim: jest.fn(async (input: ReserveAndClaimInput) => {
      const identity = {
        attemptId: 'ATT-TRANSLATE-1',
        operationRef: 'TRN-TRANSLATE-1',
        triggerRequestId: 'REQ-TRANSLATE-1',
        attemptNo: 1,
        createdAt: new Date('2026-08-26T10:00:00.000Z'),
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
        deadline: '2026-08-26T10:10:00.000Z',
        idempotencyKey: input.idempotencyKey,
      });
      return {
        attemptRef: identity.operationRef,
        status: 'RUNNING' as const,
        leaseToken: '00000000-0000-4000-8000-000000000001',
        leaseGeneration: 1,
        leaseExpiresAt: '2026-08-26T10:01:00.000Z',
        task,
        created: true,
        triggerRequestId: identity.triggerRequestId,
      };
    }),
    readScoped: jest.fn(async () => preparedCommit(task!, result!).row),
    prepareCommit: jest.fn(async () => preparedCommit(task!, result!)),
    finishProjectionSuccess: jest.fn(async () => ({
      attemptRef: 'TRN-TRANSLATE-1',
      status: 'SUCCEEDED',
      projectionApplied: true,
      terminalReason: 'PROJECTION_CAS_APPLIED',
    })),
    finishProjectionConflict: jest.fn(),
    finishResultGateFailure: jest.fn(async () => ({
      attemptRef: 'TRN-TRANSLATE-1',
      status: 'FAILED',
      projectionApplied: false,
      terminalReason: 'RESULT_GATE_REJECTED',
    })),
    projectTerminal: jest.fn(),
  };
  const serviceScope = {
    authorizeOpenClawWorkItem: jest.fn(async () => verifiedScope()),
    authorizeOpenClawAttempt: jest.fn(async () => ({
      ...verifiedScope(),
      attemptRef: 'TRN-TRANSLATE-1',
    })),
  };
  const service = new CanonicalHostOpenClawTranslationService(
    registrar as never,
    artifactStore as never,
    reader as never,
    new HostOwnedV1TranslationRuleSetPrivateProvider(),
    attempts as never,
    serviceScope as never,
  );
  return {
    service,
    workItem,
    registrar,
    artifactStore,
    attempts,
    get result() {
      return result!;
    },
    prepare(modelOutput: string, overrides: RuntimeProvenanceOverrides = {}) {
      result = sealResultEnvelope({
        schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
        actionAttemptId: task!.actionAttemptId,
        operationRef: task!.operationRef,
        taskType: 'OPENCLAW_TRANSLATE',
        workItemId: task!.workItemId,
        baseRevision: task!.baseRevision,
        status: 'SUCCEEDED',
        businessOutcome: 'CANDIDATE_READY',
        candidateStatus: null,
        modelOutput,
        outputArtifactRefs: [],
        sourceRefs: structuredClone(task!.sourceRefs),
        factsConsidered: task!.sourceRefs.map((ref) => ref.ref),
        missingInputs: [],
        conflicts: [],
        warnings: [],
        modelVersion: overrides.modelVersion ?? 'GLM-5.3',
        promptVersion:
          overrides.promptVersion ??
          'wiselink.3_1.openclaw_translation_prompt.v1',
        skillVersion:
          overrides.skillVersion ??
          CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY.skillVersion,
        toolVersions:
          overrides.toolVersions ??
          ({
            [CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY.mcpServerName]:
              CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY.mcpServerVersion,
          } as Record<string, string>),
        runMetrics: { durationMs: 10, inputUnits: 100, outputUnits: 100 },
        errorCode: null,
        errorDetail: null,
      });
    },
    persistedBytes() {
      return persisted!;
    },
  };
}

function preparedCommit(
  task: OpenClawTaskEnvelope,
  result: OpenClawResultEnvelope,
): PreparedActionAttemptCommit {
  return {
    row: {
      attemptId: task.actionAttemptId,
      operationRef: task.operationRef,
      triggerRequestId: 'REQ-TRANSLATE-1',
      workItemId: task.workItemId,
      actionType: 'OPENCLAW_TRANSLATE',
      attemptNo: 1,
      status: 'COMMITTING',
      requestOrigin: 'OPENCLAW_MCP_V1',
      tenantId: task.tenantId,
      actorUserId: 'service:openclaw-main',
      priority: 100,
      inputRevision: task.inputRevision,
      baseRevision: task.baseRevision,
      documentVersionId: task.documentVersionId,
      taskEnvelopeJson: JSON.stringify(task),
      taskInputHash: task.inputHash,
      resultEnvelopeJson: JSON.stringify(result),
      resultContentHash: result.contentHash,
      idempotencyKey: task.idempotencyKey,
      claimCount: 1,
      retryCount: 0,
      maxAttempts: 3,
      leaseOwner: 'service:openclaw-main',
      leaseToken: '00000000-0000-4000-8000-000000000001',
      leaseGeneration: 1,
      leaseExpiresAt: new Date('2026-08-26T10:01:00.000Z'),
      lastHeartbeatAt: new Date('2026-08-26T10:00:30.000Z'),
      nextAttemptAt: null,
      deadlineAt: new Date('2026-08-26T10:10:00.000Z'),
      cancelRequestedAt: null,
      cancelReason: null,
      terminalReason: null,
      projectionApplied: false,
      executorSessionKey: `wiselink:${task.tenantId}:${task.workItemId}:${task.actionAttemptId}`,
      commitStartedAt: new Date('2026-08-26T10:00:40.000Z'),
      leaseSlot: 0,
      startedAt: new Date('2026-08-26T10:00:00.000Z'),
      completedAt: null,
      createdAt: new Date('2026-08-26T10:00:00.000Z'),
      updatedAt: new Date('2026-08-26T10:00:40.000Z'),
    } satisfies ActionAttemptRow,
    task,
    result,
    recovery: false,
  };
}

function parsedWorkItem(): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-TRANSLATE-1',
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
      driveFileToken: 'drive-1',
      driveSourceVersion: 'v1',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'FTD',
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
      artifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: 'artifact://UnifiedArtifactStoreCandidate/frozen.2.json',
        sha256: 'a'.repeat(64),
        byteLength: 100,
        mediaType: 'application/json',
      },
      contentHash: 'sha256:package-content',
      semanticHash: 'sha256:semantic',
      provenanceHash: 'sha256:provenance',
      coverageHash: 'sha256:coverage',
      resultStatus: 'complete',
      title: 'FTD test',
      contentUnitCount: 2,
      sourceRefCount: 2,
      readerReceiptId: 'READER-1',
      fullValidatorProof: {} as never,
      acceptanceReceipt: {} as never,
    },
    failure: null,
    recordingFailure: null,
  };
}

function sourceUnits(): UnifiedReaderQueryResult[] {
  return [
    {
      unitId: 'UNIT-1',
      kind: 'warning',
      text: 'WARNING airplane AIMS-2 P/N 123-ABC 5 kg.',
      sourceRefIds: ['SRC-1'],
    },
    {
      unitId: 'UNIT-2',
      kind: 'note',
      text: 'NOTE flight deck.',
      sourceRefIds: ['SRC-2'],
    },
  ];
}

function verifiedScope() {
  return {
    principalId: 'service:openclaw-main',
    appId: 'app_17bzc551rsg',
    tenantId: 'tenant-1',
    workItemId: 'WI-TRANSLATE-1',
    authorizationFingerprint: 'scope-fingerprint-1',
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
