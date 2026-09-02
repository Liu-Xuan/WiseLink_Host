import {
  canonicalJson,
  sealResultEnvelope,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type { OpenClawLeaseClaim } from '../../server/modules/action-attempt/action-attempt-envelope.types';
import {
  buildOpenClawTranslationDelivery,
  OPENCLAW_TRANSLATION_DELIVERY_MAX_UTF8_BYTES,
} from '../../server/modules/canonical-host/canonical-host-openclaw-attempt-delivery';

describe('OpenClaw translation delivery', () => {
  it('batches the serialized 196-unit shape into readable bounded responses', () => {
    const claim = actualRunShapedTranslationClaim();
    const first = buildOpenClawTranslationDelivery(claim);
    const parts = Array.from({ length: first.delivery.partCount }, (_, index) =>
      buildOpenClawTranslationDelivery(claim, index),
    );

    expect(canonicalJson(claim.task).length).toBeGreaterThan(65_000);
    expect(JSON.stringify(claim.task.modelInput).length).toBeGreaterThan(
      65_000,
    );
    expect(parts.length).toBeGreaterThan(1);
    for (const [partIndex, part] of parts.entries()) {
      expect(part).toEqual(buildOpenClawTranslationDelivery(claim, partIndex));
      expect(serializedToolResultBytes(part)).toBeLessThanOrEqual(
        OPENCLAW_TRANSLATION_DELIVERY_MAX_UTF8_BYTES,
      );
      expect(part).toMatchObject({
        schemaVersion: 'wiselink.3_1.openclaw_translation_delivery.v1',
        attemptRef: claim.attemptRef,
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
        delivery: { partIndex, partCount: parts.length, sourceUnitCount: 196 },
      });
      expect(part.delivery.sourceUnits.length).toBeGreaterThan(0);
      expect(part).not.toHaveProperty('task');
      expect(part).not.toHaveProperty('modelInput');
      expect(part).not.toHaveProperty('recoveryResult');
    }

    expect(parts[0]!.delivery.modelInputBase).toBeDefined();
    expect(parts.slice(1).every((part) => !part.delivery.modelInputBase)).toBe(
      true,
    );
    const reconstructed = {
      ...parts[0]!.delivery.modelInputBase,
      sourceUnits: parts.flatMap((part) => part.delivery.sourceUnits),
    };
    expect(reconstructed).toEqual(claim.task.modelInput);

    const text = JSON.stringify(parts);
    expect(text).not.toContain('tenant-control-plane');
    expect(text).not.toContain('artifact://private/fileservice/locator');
    expect(text).not.toContain('credential-secret');
    expect(text).not.toContain('session-key-secret');
    expect(text).not.toContain('raw-pdf-secret');
    expect(text).not.toContain('full-fleet-secret');
  });

  it('binds COMMITTING recovery by hash and leaves the full result on status', () => {
    const running = actualRunShapedTranslationClaim();
    const recoveryResult = sealResultEnvelope({
      schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
      actionAttemptId: running.task.actionAttemptId,
      operationRef: running.task.operationRef,
      taskType: running.task.taskType,
      workItemId: running.task.workItemId,
      baseRevision: running.task.baseRevision,
      status: 'SUCCEEDED',
      businessOutcome: 'CANDIDATE_READY',
      candidateStatus: null,
      modelOutput: '{"candidate":true}',
      outputArtifactRefs: [],
      sourceRefs: [],
      factsConsidered: [],
      missingInputs: [],
      conflicts: [],
      warnings: [],
      modelVersion: 'GLM-5.3',
      promptVersion: 'r09.prompt.fixture.1',
      skillVersion: 'wiselink-research-and-synthesize@r09.c7',
      toolVersions: {
        'wiselink-openclaw-engineering-assessment': '1.2.0',
      },
      runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
      errorCode: null,
      errorDetail: null,
    });
    const committing: OpenClawLeaseClaim = {
      ...running,
      status: 'COMMITTING',
      recoveryResult,
    };

    const delivery = buildOpenClawTranslationDelivery(committing);

    expect(delivery.recoveryResultContentHash).toBe(recoveryResult.contentHash);
    expect(delivery).not.toHaveProperty('recoveryResult');
    expect(serializedToolResultBytes(delivery)).toBeLessThanOrEqual(
      OPENCLAW_TRANSLATION_DELIVERY_MAX_UTF8_BYTES,
    );
  });
});

function serializedToolResultBytes(value: unknown): number {
  return Buffer.byteLength(
    JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(value) }],
    }),
    'utf8',
  );
}

function actualRunShapedTranslationClaim(): OpenClawLeaseClaim {
  const textLengths = [153, ...Array(146).fill(67), ...Array(49).fill(66)];
  expect(textLengths).toHaveLength(196);
  expect(textLengths.reduce((sum, length) => sum + length, 0)).toBe(13_169);
  const modelInput = {
    schemaVersion: 'wiselink.3_1.translation_task.v0.candidate',
    sourceUnits: textLengths.map((length, index) => ({
      unitKey: `urn:techpub:content-unit:v1:sha256:${String(index).padStart(64, '0')}`,
      kind: index % 11 === 0 ? 'heading' : 'paragraph',
      text: `${String(index).padStart(4, '0')}:${'T'.repeat(length - 5)}`,
      sourceRefIds: [
        `urn:techpub:source-ref:v1:sha256:${String(index).padStart(64, 'a')}:page-001`,
      ],
    })),
    rulePack: {
      meta: {
        schemaVersion: 'wiselink.3_1.translation_rule_pack.v0.candidate',
        rulePackId: 'wiselink.host.translation-rules.zh-cn.v1',
        rulePackVersion: '1.0.0',
        label: 'Boeing FTD zh-CN baseline',
        targetLocale: 'zh-CN',
        sourceLocales: ['en'],
      },
      terms: [],
      noTranslate: [],
      deterministic: {
        preservedIdentifierPatterns: [],
        numericFidelity: true,
        preservedUnits: [],
        preserveAtaChapterNumbers: true,
        preservePartNumbers: true,
        segmentAlignment: true,
        tableAlignment: true,
        preserveCitations: true,
      },
    },
    taskStartBinding: {
      documentId: 'DOC-real-shape',
      revisionId: 'REV-real-shape',
      packageId: 'PKG-real-shape',
      contentHash: 'sha256:real-shape',
    },
  };
  const task = sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-large-translation',
    operationRef: 'AQ-large-translation',
    taskType: 'OPENCLAW_TRANSLATE',
    priority: 100,
    tenantId: 'tenant-control-plane',
    workItemId: 'WI-large-translation',
    inputRevision: 4,
    baseRevision: 4,
    documentVersionId: 'DV-large-translation',
    sourceRefs: [
      {
        ref: 'artifact://private/fileservice/locator',
        sha256: 'a'.repeat(64),
      },
    ],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput,
    deadline: '2026-08-28T13:00:00.000Z',
    idempotencyKey: 'translation:WI-large-translation:4',
  });
  return {
    attemptRef: task.operationRef,
    status: 'RUNNING',
    leaseToken: '00000000-0000-4000-8000-000000000001',
    leaseGeneration: 1,
    leaseExpiresAt: '2026-08-28T12:30:00.000Z',
    task,
  };
}
