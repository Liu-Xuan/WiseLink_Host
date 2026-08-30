import { createHash } from 'node:crypto';

import type {
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
  UnifiedReaderQueryResult,
} from '../../shared/api.interface';
import {
  canonicalJson,
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
  CanonicalHostOpenClawTranslationService,
  parseBilingualTranslationArtifact,
  type BilingualTranslationArtifact,
} from '../../server/modules/canonical-host/canonical-host-openclaw-translation.service';
import { CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY } from '../../server/modules/canonical-host/canonical-host-openclaw-runtime-policy';
import {
  CanonicalTranslationKnowledgeGovernanceService,
  type SaveTranslationKnowledgeCandidateResult,
  type TranslationKnowledgeAggregate,
  type TranslationKnowledgeCandidateRecord,
  type TranslationKnowledgeCandidateStore,
  type TranslationKnowledgeGovernanceEvent,
  type TranslationKnowledgeIdFactory,
} from '../../server/modules/canonical-host/canonical-translation-knowledge-governance';
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
  it('reuses the same active attempt and lease when delivery parts repeat begin', async () => {
    const harness = harnessForTranslation();

    const first = await harness.service.begin(harness.workItem.workItemId);
    const nextPart = await harness.service.begin(harness.workItem.workItemId);

    expect(nextPart).toEqual(first);
    expect(nextPart.attemptRef).toBe(first.attemptRef);
    expect(nextPart.leaseToken).toBe(first.leaseToken);
    expect(nextPart.leaseGeneration).toBe(first.leaseGeneration);
    expect(nextPart.task.inputHash).toBe(first.task.inputHash);
    expect(first).not.toHaveProperty('modelInput');
    expect(harness.attempts.reserveAndClaim).toHaveBeenCalledTimes(2);
    expect(harness.reader.readAllSourceUnits).toHaveBeenCalledTimes(1);
  });

  it('freezes Reader units and exact rules, validates, persists readback bytes, and CAS-projects candidate-only bilingual output', async () => {
    const harness = harnessForTranslation();
    const begin = await harness.service.begin(harness.workItem.workItemId);
    const taskContract = begin.task
      .modelInput as unknown as TranslationTaskContract;
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
    if (!('translation' in committed)) {
      throw new Error('TRANSLATION_COMMIT_NOT_PROJECTED');
    }

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

  it('imports the real service artifact into candidate-only governed memory with dedupe, trace, confirmation, expiry and invalidation readback', async () => {
    const harness = harnessForTranslation();
    const begin = await harness.service.begin(harness.workItem.workItemId);
    const taskContract: TranslationTaskContract = begin.task
      .modelInput as unknown as TranslationTaskContract;
    harness.prepare(
      JSON.stringify({
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
      }),
    );
    const committed = await harness.service.commit(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      harness.result,
    );
    if (!('translation' in committed)) {
      throw new Error('TRANSLATION_KNOWLEDGE_COMMIT_NOT_PROJECTED');
    }
    const artifact: BilingualTranslationArtifact =
      parseBilingualTranslationArtifact(harness.persistedBytes());
    const store = new ReadbackTranslationKnowledgeCandidateStore();
    let assetSequence = 0;
    let eventSequence = 0;
    const idFactory: TranslationKnowledgeIdFactory = (
      kind: 'ASSET' | 'EVENT',
    ): string => {
      if (kind === 'ASSET') {
        assetSequence += 1;
        return `TM-CANDIDATE-${assetSequence}`;
      }
      eventSequence += 1;
      return `TM-EVENT-${eventSequence}`;
    };
    const governance = new CanonicalTranslationKnowledgeGovernanceService(
      store,
      new HostOwnedV1TranslationRuleSetPrivateProvider(),
      idFactory,
    );
    const importInput = {
      tenantId: 'tenant-1',
      workItemId: harness.workItem.workItemId,
      snapshotWorkItemRevision: 8,
      ownerActorId: 'user:translation-owner',
      importedByActorId: 'user:translation-owner',
      sourceArtifact: committed.translation.artifact,
      artifact,
      currentBinding: taskContract.taskStartBinding,
      validFrom: '2026-08-30T00:00:00.000Z',
      expiresAt: '2026-09-30T00:00:00.000Z',
      importedAt: '2026-08-30T01:00:00.000Z',
    };

    const imported = await governance.importBilingualCandidates(importInput);
    const replayed = await governance.importBilingualCandidates(importInput);

    expect(imported).toEqual({
      status: 'CANDIDATE_ONLY',
      createdCount: 2,
      reusedCount: 0,
      assetIds: ['TM-CANDIDATE-1', 'TM-CANDIDATE-2'],
    });
    expect(replayed).toEqual({
      status: 'CANDIDATE_ONLY',
      createdCount: 0,
      reusedCount: 2,
      assetIds: ['TM-CANDIDATE-1', 'TM-CANDIDATE-2'],
    });

    const pending = await governance.readCandidate({
      tenantId: 'tenant-1',
      workItemId: harness.workItem.workItemId,
      currentWorkItemRevision: 8,
      assetId: imported.assetIds[0],
      asOf: '2026-08-30T02:00:00.000Z',
      currentBinding: taskContract.taskStartBinding,
    });
    expect(pending).toMatchObject({
      confirmationStatus: 'PENDING_HUMAN_CONFIRMATION',
      validityStatus: 'CURRENT',
      sourceCurrentness: 'CURRENT',
      retrievalEligibility: 'BLOCKED',
      activeTerminology: false,
      formalKnowledge: false,
      candidate: {
        candidateOnly: true,
        usagePolicy: 'SUGGESTION_ONLY',
        ownerActorId: 'user:translation-owner',
        sourceArtifact: {
          sha256: committed.translation.artifact.sha256,
        },
        sourceBinding: taskContract.taskStartBinding,
        ruleSet: {
          ruleSetId: taskContract.rulePack.meta.rulePackId,
          ruleSetVersion: taskContract.rulePack.meta.rulePackVersion,
        },
        unit: {
          unitId: 'UNIT-1',
          sourceRefIds: ['SRC-1'],
        },
      },
    });
    await expect(
      governance.confirmByHuman({
        tenantId: 'tenant-1',
        workItemId: harness.workItem.workItemId,
        currentWorkItemRevision: 8,
        assetId: imported.assetIds[0],
        actorKind: 'MODEL',
        actorId: 'model:GLM-5.3',
        reason: 'model suggestion',
        occurredAt: '2026-08-30T03:00:00.000Z',
        currentBinding: taskContract.taskStartBinding,
      }),
    ).rejects.toThrow('KNOWLEDGE_HUMAN_CONFIRMATION_REQUIRED');
    await expect(
      governance.confirmByHuman({
        tenantId: 'tenant-1',
        workItemId: harness.workItem.workItemId,
        currentWorkItemRevision: 8,
        assetId: imported.assetIds[0],
        actorKind: 'HUMAN',
        actorId: 'user:not-owner',
        reason: 'unowned review',
        occurredAt: '2026-08-30T03:01:00.000Z',
        currentBinding: taskContract.taskStartBinding,
      }),
    ).rejects.toThrow('KNOWLEDGE_OWNER_CONFIRMATION_REQUIRED');

    const confirmedFirst = await governance.confirmByHuman({
      tenantId: 'tenant-1',
      workItemId: harness.workItem.workItemId,
      currentWorkItemRevision: 8,
      assetId: imported.assetIds[0],
      actorKind: 'HUMAN',
      actorId: 'user:translation-owner',
      reason: 'source and translation reviewed',
      occurredAt: '2026-08-31T00:00:00.000Z',
      currentBinding: taskContract.taskStartBinding,
    });
    const confirmedSecond = await governance.confirmByHuman({
      tenantId: 'tenant-1',
      workItemId: harness.workItem.workItemId,
      currentWorkItemRevision: 8,
      assetId: imported.assetIds[1],
      actorKind: 'HUMAN',
      actorId: 'user:translation-owner',
      reason: 'source and translation reviewed',
      occurredAt: '2026-08-31T00:01:00.000Z',
      currentBinding: taskContract.taskStartBinding,
    });
    expect(confirmedFirst).toMatchObject({
      governanceRevision: 1,
      confirmationStatus: 'HUMAN_CONFIRMED',
      retrievalEligibility: 'SUGGESTION_ONLY',
      activeTerminology: false,
      formalKnowledge: false,
    });
    expect(confirmedSecond.candidate.unit.sourceRefIds).toEqual(['SRC-2']);

    const invalidated = await governance.invalidateIfSourceStale({
      tenantId: 'tenant-1',
      workItemId: harness.workItem.workItemId,
      currentWorkItemRevision: 8,
      assetId: imported.assetIds[0],
      invalidatedAt: '2026-09-01T00:00:00.000Z',
      currentBinding: {
        ...taskContract.taskStartBinding,
        revisionId: 'DV-2',
      },
    });
    expect(invalidated).toMatchObject({
      governanceRevision: 2,
      confirmationStatus: 'HUMAN_CONFIRMED',
      validityStatus: 'INVALIDATED',
      sourceCurrentness: 'STALE',
      retrievalEligibility: 'BLOCKED',
      events: [
        { eventType: 'HUMAN_CONFIRMED', actorKind: 'HUMAN' },
        {
          eventType: 'INVALIDATED',
          actorKind: 'SYSTEM',
          reason: 'SOURCE_BINDING_CHANGED',
        },
      ],
    });

    const expired = await governance.readCandidate({
      tenantId: 'tenant-1',
      workItemId: harness.workItem.workItemId,
      currentWorkItemRevision: 8,
      assetId: imported.assetIds[1],
      asOf: '2026-09-30T00:00:00.000Z',
      currentBinding: taskContract.taskStartBinding,
    });
    expect(expired).toMatchObject({
      confirmationStatus: 'HUMAN_CONFIRMED',
      validityStatus: 'EXPIRED',
      retrievalEligibility: 'BLOCKED',
      activeTerminology: false,
      formalKnowledge: false,
    });
  });

  it('reports NOT_YET_VALID immediately before validFrom and blocks retrieval', async () => {
    const { governance, candidate } = await knowledgeValidityHarness();

    const snapshot = await governance.readCandidate({
      tenantId: candidate.tenantId,
      workItemId: candidate.workItemId,
      currentWorkItemRevision: candidate.snapshotWorkItemRevision,
      assetId: candidate.assetId,
      asOf: '2026-08-29T23:59:59.999Z',
      currentBinding: candidate.sourceBinding,
    });

    expect(snapshot.validityStatus).toBe('NOT_YET_VALID');
    expect(snapshot.retrievalEligibility).toBe('BLOCKED');
    await expect(
      governance.confirmByHuman({
        tenantId: candidate.tenantId,
        workItemId: candidate.workItemId,
        currentWorkItemRevision: candidate.snapshotWorkItemRevision,
        assetId: candidate.assetId,
        actorKind: 'HUMAN',
        actorId: candidate.ownerActorId,
        reason: 'review attempted before validity starts',
        occurredAt: '2026-08-29T23:59:59.999Z',
        currentBinding: candidate.sourceBinding,
      }),
    ).rejects.toThrow('KNOWLEDGE_CANDIDATE_NOT_YET_VALID');
  });

  it('treats asOf equal to validFrom as CURRENT and permits owner confirmation', async () => {
    const { governance, candidate } = await knowledgeValidityHarness();

    const confirmed = await governance.confirmByHuman({
      tenantId: candidate.tenantId,
      workItemId: candidate.workItemId,
      currentWorkItemRevision: candidate.snapshotWorkItemRevision,
      assetId: candidate.assetId,
      actorKind: 'HUMAN',
      actorId: candidate.ownerActorId,
      reason: 'review at validity start',
      occurredAt: candidate.validFrom,
      currentBinding: candidate.sourceBinding,
    });

    expect(confirmed.validityStatus).toBe('CURRENT');
    expect(confirmed.confirmationStatus).toBe('HUMAN_CONFIRMED');
    expect(confirmed.retrievalEligibility).toBe('SUGGESTION_ONLY');
    expect(confirmed.activeTerminology).toBe(false);
    expect(confirmed.formalKnowledge).toBe(false);
  });

  it('treats asOf equal to expiresAt as EXPIRED and blocks retrieval', async () => {
    const { governance, candidate } = await knowledgeValidityHarness();
    await governance.confirmByHuman({
      tenantId: candidate.tenantId,
      workItemId: candidate.workItemId,
      currentWorkItemRevision: candidate.snapshotWorkItemRevision,
      assetId: candidate.assetId,
      actorKind: 'HUMAN',
      actorId: candidate.ownerActorId,
      reason: 'review during validity window',
      occurredAt: candidate.validFrom,
      currentBinding: candidate.sourceBinding,
    });

    const snapshot = await governance.readCandidate({
      tenantId: candidate.tenantId,
      workItemId: candidate.workItemId,
      currentWorkItemRevision: candidate.snapshotWorkItemRevision,
      assetId: candidate.assetId,
      asOf: candidate.expiresAt,
      currentBinding: candidate.sourceBinding,
    });

    expect(snapshot.validityStatus).toBe('EXPIRED');
    expect(snapshot.confirmationStatus).toBe('HUMAN_CONFIRMED');
    expect(snapshot.retrievalEligibility).toBe('BLOCKED');
    expect(snapshot.activeTerminology).toBe(false);
    expect(snapshot.formalKnowledge).toBe(false);
  });

  it('uploads and finalizes an approximately 67KB 196-unit result with exact replay and one candidate publication', async () => {
    const units = sourceUnits196();
    const harness = harnessForTranslation(units);
    const begin = await harness.service.begin(harness.workItem.workItemId);
    const taskContract = begin.task
      .modelInput as unknown as TranslationTaskContract;
    const filler =
      '完成驾驶舱显示系统构型核对并保留所有警告注意步骤与件号单位。'.repeat(2) +
      '严格复核完成并确认';
    harness.prepare(
      JSON.stringify({
        schemaVersion: TRANSLATION_RESULT_SCHEMA_VERSION,
        rulePackId: taskContract.rulePack.meta.rulePackId,
        rulePackVersion: taskContract.rulePack.meta.rulePackVersion,
        taskStartBinding: taskContract.taskStartBinding,
        candidateUnits: units.map((unit) => ({
          unitKey: unit.unitId,
          text: `警告 飞机 AIMS-2 P/N 123-ABC 5 kg。 ${filler}`,
          sourceRefIds: [...unit.sourceRefIds],
          engineerRevision: null,
        })),
      }),
    );
    const payload = new TextEncoder().encode(canonicalJson(harness.result));
    expect(payload.byteLength).toBeGreaterThanOrEqual(65_000);
    expect(payload.byteLength).toBeLessThanOrEqual(75_000);
    const chunks = chunkBytes(payload, 6_144);
    const receipts = [];
    for (let partIndex = 0; partIndex < chunks.length; partIndex += 1) {
      const args = {
        resultContentHash: harness.result.contentHash,
        partIndex,
        partCount: chunks.length,
        payloadBase64: Buffer.from(chunks[partIndex]).toString('base64'),
      };
      expect(
        new TextEncoder().encode(JSON.stringify(args)).byteLength,
      ).toBeLessThan(12_000);
      receipts.push(
        await harness.service.uploadResultPart(
          begin.attemptRef,
          begin.leaseToken,
          begin.leaseGeneration,
          args,
        ),
      );
    }
    const replay = await harness.service.uploadResultPart(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      {
        resultContentHash: harness.result.contentHash,
        partIndex: 0,
        partCount: chunks.length,
        payloadBase64: Buffer.from(chunks[0]).toString('base64'),
      },
    );
    expect(replay.replayed).toBe(true);
    const { replayed: _firstReplay, ...firstReceipt } = receipts[0];
    expect(replay).toMatchObject(firstReceipt);
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
    expect(harness.currentRevision()).toBe(7);

    const committed = await harness.service.finalizeResultParts(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      {
        resultContentHash: harness.result.contentHash,
        partCount: chunks.length,
        parts: receipts
          .map(({ partIndex, sha256, byteLength }) => ({
            partIndex,
            sha256,
            byteLength,
          }))
          .reverse(),
      },
    );

    expect(payload.byteLength).toBeGreaterThan(67_000);
    expect(chunks).toHaveLength(12);
    expect(harness.attempts.finishResultGateFailure).not.toHaveBeenCalled();
    expect(committed).toMatchObject({
      workItemRevision: 8,
      status: 'CANDIDATE_ONLY',
      translation: {
        sourceUnitCount: 196,
        translatedUnitCount: 196,
      },
    });
    expect(harness.registrar.compareAndSet).toHaveBeenCalledTimes(1);
    expect(harness.artifactStore.persistAndReadback).toHaveBeenCalledTimes(1);
    expect(harness.currentRevision()).toBe(8);
    const artifact = JSON.parse(
      new TextDecoder().decode(harness.persistedBytes()),
    ) as { units: unknown[] };
    expect(artifact.units).toHaveLength(196);
  });

  it('rejects finalize with a missing part before ResultGate, artifact persistence, or WorkItem mutation', async () => {
    const harness = harnessForTranslation();
    const begin = await harness.service.begin(harness.workItem.workItemId);
    harness.prepare('{}');
    const payload = new TextEncoder().encode(canonicalJson(harness.result));
    const chunks = chunkBytes(payload, Math.ceil(payload.byteLength / 2));
    const first = await harness.service.uploadResultPart(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      {
        resultContentHash: harness.result.contentHash,
        partIndex: 0,
        partCount: chunks.length,
        payloadBase64: Buffer.from(chunks[0]).toString('base64'),
      },
    );

    await expect(
      harness.service.finalizeResultParts(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        {
          resultContentHash: harness.result.contentHash,
          partCount: chunks.length,
          parts: [
            {
              partIndex: first.partIndex,
              sha256: first.sha256,
              byteLength: first.byteLength,
            },
          ],
        },
      ),
    ).rejects.toThrow('TRANSLATION_RESULT_PARTS_INCOMPLETE');
    expect(harness.attempts.prepareCommit).not.toHaveBeenCalled();
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.currentRevision()).toBe(7);
  });

  it('fails ResultGate and performs no artifact or projection write when a number changes', async () => {
    const harness = harnessForTranslation();
    const begin = await harness.service.begin(harness.workItem.workItemId);
    const taskContract = begin.task
      .modelInput as unknown as TranslationTaskContract;
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
    const taskContract = begin.task
      .modelInput as unknown as TranslationTaskContract;
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

function harnessForTranslation(selectedSourceUnits = sourceUnits()) {
  const workItem = parsedWorkItem(selectedSourceUnits.length);
  let current = structuredClone(workItem);
  let task: OpenClawTaskEnvelope | null = null;
  let result: OpenClawResultEnvelope | null = null;
  let persisted: Uint8Array | null = null;
  const stagedParts = new Map<string, Uint8Array>();
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
    readAllSourceUnits: jest.fn(async () =>
      structuredClone(selectedSourceUnits),
    ),
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
    stageResultEnvelopePartAndReadback: jest.fn(
      async (input: {
        bytes: Uint8Array;
        ownerRef: string;
        partIndex: number;
      }) => {
        const key = `${input.ownerRef}:${input.partIndex}`;
        const existing = stagedParts.get(key);
        if (
          existing &&
          !Buffer.from(existing).equals(Buffer.from(input.bytes))
        ) {
          throw new Error('RESULT_ENVELOPE_PART_REPLAY_MISMATCH');
        }
        stagedParts.set(key, existing ?? input.bytes.slice());
        return {
          schemaVersion: 'wiselink.3_1.staged_result_envelope_part.v1' as const,
          ownerRefHash: sha256(new TextEncoder().encode(input.ownerRef)),
          partIndex: input.partIndex,
          sha256: sha256(input.bytes),
          byteLength: input.bytes.byteLength,
          reused: existing !== undefined,
        };
      },
    ),
    readStagedResultEnvelopePart: jest.fn(
      async (input: {
        ownerRef: string;
        part: { partIndex: number; sha256: string; byteLength: number };
      }) => {
        const bytes = stagedParts.get(
          `${input.ownerRef}:${input.part.partIndex}`,
        );
        if (
          !bytes ||
          bytes.byteLength !== input.part.byteLength ||
          sha256(bytes) !== input.part.sha256
        ) {
          throw new Error('RESULT_ENVELOPE_PART_READBACK_MISMATCH');
        }
        return bytes.slice();
      },
    ),
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
      if (task) {
        return {
          attemptRef: identity.operationRef,
          status: 'RUNNING' as const,
          leaseToken: '00000000-0000-4000-8000-000000000001',
          leaseGeneration: 1,
          leaseExpiresAt: '2026-08-26T10:01:00.000Z',
          task,
          created: false,
          triggerRequestId: identity.triggerRequestId,
        };
      }
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
    readScoped: jest.fn(async () => actionAttemptRow(task!, 'RUNNING', null)),
    prepareCommit: jest.fn(
      async (input: { result: OpenClawResultEnvelope }) => {
        result = input.result;
        return preparedCommit(task!, input.result);
      },
    ),
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
    reader,
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
    currentRevision() {
      return current.revision;
    },
  };
}

function preparedCommit(
  task: OpenClawTaskEnvelope,
  result: OpenClawResultEnvelope,
): PreparedActionAttemptCommit {
  return {
    row: actionAttemptRow(task, 'COMMITTING', result),
    task,
    result,
    recovery: false,
  };
}

function actionAttemptRow(
  task: OpenClawTaskEnvelope,
  status: 'RUNNING' | 'COMMITTING',
  result: OpenClawResultEnvelope | null,
): ActionAttemptRow {
  return {
    attemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    triggerRequestId: 'REQ-TRANSLATE-1',
    workItemId: task.workItemId,
    actionType: 'OPENCLAW_TRANSLATE',
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
    resultEnvelopeJson: result ? JSON.stringify(result) : null,
    resultContentHash: result?.contentHash ?? null,
    idempotencyKey: task.idempotencyKey,
    claimCount: 1,
    retryCount: 0,
    maxAttempts: 3,
    leaseOwner: 'service:openclaw-main',
    leaseToken: '00000000-0000-4000-8000-000000000001',
    leaseGeneration: 1,
    leaseExpiresAt: new Date('2099-08-26T10:01:00.000Z'),
    lastHeartbeatAt: new Date('2026-08-26T10:00:30.000Z'),
    nextAttemptAt: null,
    deadlineAt: new Date('2099-08-26T10:10:00.000Z'),
    cancelRequestedAt: null,
    cancelReason: null,
    terminalReason: null,
    projectionApplied: false,
    executorSessionKey: `wiselink:${task.tenantId}:${task.workItemId}:${task.actionAttemptId}`,
    commitStartedAt:
      status === 'COMMITTING' ? new Date('2026-08-26T10:00:40.000Z') : null,
    leaseSlot: 0,
    startedAt: new Date('2026-08-26T10:00:00.000Z'),
    completedAt: null,
    createdAt: new Date('2026-08-26T10:00:00.000Z'),
    updatedAt: new Date('2026-08-26T10:00:40.000Z'),
  };
}

function parsedWorkItem(contentUnitCount = 2): CanonicalWorkItemProjection {
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
      contentUnitCount,
      sourceRefCount: contentUnitCount,
      readerReceiptId: 'READER-1',
      fullValidatorProof: {} as never,
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

function sourceUnits196(): UnifiedReaderQueryResult[] {
  return Array.from({ length: 196 }, (_, index) => {
    const suffix = String(index + 1).padStart(3, '0');
    return {
      unitId: `UNIT-${suffix}`,
      kind: index % 17 === 0 ? 'warning' : 'paragraph',
      text: 'WARNING airplane AIMS-2 P/N 123-ABC 5 kg.',
      sourceRefIds: [`SRC-${suffix}`],
    };
  });
}

function chunkBytes(bytes: Uint8Array, partBytes: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += partBytes) {
    parts.push(bytes.slice(offset, offset + partBytes));
  }
  return parts;
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

async function knowledgeValidityHarness(): Promise<{
  governance: CanonicalTranslationKnowledgeGovernanceService;
  candidate: TranslationKnowledgeCandidateRecord;
}> {
  const store = new ReadbackTranslationKnowledgeCandidateStore();
  const candidate: TranslationKnowledgeCandidateRecord = {
    schemaVersion: 'wiselink.3_1.translation_knowledge_candidate.v1',
    assetId: 'TM-VALIDITY-CANDIDATE-1',
    tenantId: 'tenant-1',
    workItemId: 'WI-VALIDITY-1',
    snapshotWorkItemRevision: 1,
    knowledgeKind: 'TRANSLATION_MEMORY',
    candidateOnly: true,
    usagePolicy: 'SUGGESTION_ONLY',
    ownerActorId: 'user:translation-owner',
    importedByActorId: 'user:translation-owner',
    sourceArtifact: {
      ref: 'artifact://translation/bilingual-validity-test.json',
      sha256:
        'a323aac6cdec5033eef62927853daf59a97044bbc30408c65666c99167c58855',
    },
    sourceBinding: {
      documentId: 'DOC-VALIDITY-1',
      revisionId: 'REV-VALIDITY-1',
      sbdPackageId: 'SBD-VALIDITY-1',
      sbdContentHash: 'sbd-validity-content-hash',
      tcpPackageId: 'TCP-VALIDITY-1',
      tcpContentHash: 'tcp-validity-content-hash',
    },
    translationExecution: {
      actionAttemptId: 'AA-VALIDITY-1',
      resultContentHash: 'translation-result-validity-hash',
      modelVersion: 'GLM-5.3',
      promptVersion: 'translation.prompt.v1',
      skillVersion: 'translation.skill.v1',
    },
    ruleSet: {
      ruleSetId: 'wiselink.host.translation-rules.zh-cn.v1',
      ruleSetVersion: '1.0.0',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
    },
    unit: {
      unitId: 'UNIT-VALIDITY-1',
      kind: 'paragraph',
      sourceUnitCount: 1,
      sourceText: 'Validity boundary source unit.',
      translatedText: '有效期边界源单元。',
      sourceRefIds: ['SRC-VALIDITY-1'],
      engineerRevisionId: null,
    },
    validFrom: '2026-08-30T00:00:00.000Z',
    expiresAt: '2026-09-30T00:00:00.000Z',
    createdAt: '2026-08-30T00:00:00.000Z',
  };
  await store.saveCandidate(candidate);
  return {
    governance: new CanonicalTranslationKnowledgeGovernanceService(
      store,
      new HostOwnedV1TranslationRuleSetPrivateProvider(),
      (): string => 'TM-VALIDITY-EVENT-1',
    ),
    candidate,
  };
}

class ReadbackTranslationKnowledgeCandidateStore implements TranslationKnowledgeCandidateStore {
  private readonly candidates = new Map<
    string,
    TranslationKnowledgeCandidateRecord
  >();

  private readonly dedupe = new Map<string, string>();

  private readonly events = new Map<
    string,
    TranslationKnowledgeGovernanceEvent[]
  >();

  async saveCandidate(
    candidate: TranslationKnowledgeCandidateRecord,
  ): Promise<SaveTranslationKnowledgeCandidateResult> {
    const dedupeKey: string = [
      candidate.tenantId,
      candidate.workItemId,
      candidate.snapshotWorkItemRevision,
      candidate.sourceArtifact.sha256,
      candidate.unit.unitId,
    ].join(':');
    const existingId: string | undefined = this.dedupe.get(dedupeKey);
    if (existingId !== undefined) {
      const existing: TranslationKnowledgeCandidateRecord | undefined =
        this.candidates.get(existingId);
      if (existing === undefined) throw new Error('TEST_STORE_CORRUPT');
      return {
        candidate: structuredClone(existing),
        disposition: 'REUSED',
      };
    }
    const stored: TranslationKnowledgeCandidateRecord =
      structuredClone(candidate);
    this.candidates.set(stored.assetId, stored);
    this.dedupe.set(dedupeKey, stored.assetId);
    this.events.set(stored.assetId, []);
    return {
      candidate: structuredClone(stored),
      disposition: 'CREATED',
    };
  }

  async readAggregate(
    tenantId: string,
    workItemId: string,
    assetId: string,
  ): Promise<TranslationKnowledgeAggregate | null> {
    const candidate: TranslationKnowledgeCandidateRecord | undefined =
      this.candidates.get(assetId);
    if (
      candidate === undefined ||
      candidate.tenantId !== tenantId ||
      candidate.workItemId !== workItemId
    ) {
      return null;
    }
    return {
      candidate: structuredClone(candidate),
      events: structuredClone(this.events.get(assetId) ?? []),
    };
  }

  async appendEvent(
    event: TranslationKnowledgeGovernanceEvent,
  ): Promise<TranslationKnowledgeGovernanceEvent> {
    const candidate: TranslationKnowledgeCandidateRecord | undefined =
      this.candidates.get(event.assetId);
    const events: TranslationKnowledgeGovernanceEvent[] | undefined =
      this.events.get(event.assetId);
    if (
      candidate === undefined ||
      events === undefined ||
      candidate.tenantId !== event.tenantId ||
      candidate.workItemId !== event.workItemId
    ) {
      throw new Error('KNOWLEDGE_CANDIDATE_NOT_FOUND');
    }
    if (
      event.expectedRevision !== events.length ||
      event.resultingRevision !== events.length + 1
    ) {
      throw new Error('KNOWLEDGE_GOVERNANCE_CAS_CONFLICT');
    }
    events.push(structuredClone(event));
    return structuredClone(event);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
