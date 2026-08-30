import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import { CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ENV } from '../../server/modules/canonical-host/canonical-host.constants';
import type { CanonicalRuleSetArtifactReadResult } from '../../server/modules/canonical-host/canonical-rule-set-artifact.reader';
import {
  CANONICAL_JOB_AID_RULE_SET_KEY,
  type CreateCanonicalRuleSetSnapshotRecord,
  type StoredCanonicalRuleSetActivation,
  type StoredCanonicalRuleSetRuntime,
  type StoredCanonicalRuleSetSnapshot,
} from '../../server/modules/canonical-host/canonical-rule-set-lifecycle.repository';
import { CanonicalRuleSetLifecycleService } from '../../server/modules/canonical-host/canonical-rule-set-lifecycle.service';
import { buildUnifiedSbJobAidAssessmentInput } from '../../server/modules/assessment-workbench/unified-assessment-input';
import { buildSbJobAidAssessmentPackage } from '../../server/modules/assessment-workbench/job-aid-runtime/assessmentPackage.js';
import type {
  DocumentVersionUnifiedArtifactBinding,
  UnifiedParsedPackageArtifactRecord,
} from '../../server/modules/assessment-workbench/unified-parsed-package-reader';

const TENANT_ID = 'tenant-rule-set-test';
const ENGINEERING_OWNER_ROLE_ID = 'role_rule_set_engineering_owner_test';
const RULE_PACK_PATH = resolve(
  process.cwd(),
  'server/runtime-assets/assessment-host/job-aid/rule-pack-0.2.json',
);
const REAL_PACKAGE_DIRECTORY = resolve(
  process.cwd(),
  'server/runtime-assets/assessment-host/real-sb/737-34-3830-original-issue',
);
const buildRuntimeAssessment =
  buildSbJobAidAssessmentPackage as unknown as (input: {
    input: Record<string, unknown>;
    rulePack: Record<string, unknown>;
    rulePackHash: string;
    criterionSet: Record<string, unknown>;
    generatedAt: string;
  }) => {
    rulePackBinding: { criterionSetId: string };
    evaluationItems: unknown[];
  };

describe('CanonicalRuleSetLifecycleService', () => {
  const originalRoleId =
    process.env[CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ENV];

  beforeAll(() => {
    process.env[CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ENV] =
      ENGINEERING_OWNER_ROLE_ID;
  });

  afterAll(() => {
    if (originalRoleId === undefined) {
      delete process.env[CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ENV];
    } else {
      process.env[CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ENV] =
        originalRoleId;
    }
  });

  it('runs real Job-Aid bytes through promote, ACTIVE, and rollback', async () => {
    const rulePackBytes: Uint8Array = new Uint8Array(
      readFileSync(RULE_PACK_PATH),
    );
    const repository = new InMemoryRuleSetRepository();
    const artifacts = new InMemoryRuleSetArtifacts(rulePackBytes);
    const service = new CanonicalRuleSetLifecycleService(
      repository as never,
      artifacts as never,
    );
    const actor: CanonicalHostActor = engineeringOwner();

    const first = await service.createSnapshot(
      selection('rule-pack-a.json'),
      actor,
    );
    const second = await service.createSnapshot(
      selection('rule-pack-b.json'),
      actor,
    );
    expect(first.snapshot.criteriaCount).toBe(150);
    expect(second.snapshot.criteriaCount).toBe(150);
    expect(second.snapshot.snapshotId).not.toBe(first.snapshot.snapshotId);

    const promotedFirst = await service.promote(
      {
        targetSnapshotId: first.snapshot.snapshotId,
        expectedRevision: 0,
        reason: 'Activate the engineering-owner-reviewed baseline.',
      },
      actor,
    );
    expect(promotedFirst.lifecycle.activeSnapshotId).toBe(
      first.snapshot.snapshotId,
    );
    expect(promotedFirst.lifecycle.headRevision).toBe(1);
    const firstRun = runActual737Assessment(
      await service.readActiveRuntime(TENANT_ID),
    );
    expect(firstRun.criterionSetId).toBe(first.snapshot.snapshotId);
    expect(firstRun.evaluationItemCount).toBe(150);

    const promotedSecond = await service.promote(
      {
        targetSnapshotId: second.snapshot.snapshotId,
        expectedRevision: 1,
        reason: 'Promote the reviewed replacement artifact.',
      },
      actor,
    );
    expect(promotedSecond.lifecycle.activeSnapshotId).toBe(
      second.snapshot.snapshotId,
    );
    const secondRun = runActual737Assessment(
      await service.readActiveRuntime(TENANT_ID),
    );
    expect(secondRun.criterionSetId).toBe(second.snapshot.snapshotId);
    expect(secondRun.evaluationItemCount).toBe(150);

    const rolledBack = await service.rollback(
      {
        targetSnapshotId: first.snapshot.snapshotId,
        expectedRevision: 2,
        reason: 'Rollback after replacement runtime verification failed.',
      },
      actor,
    );
    expect(rolledBack.lifecycle.activeSnapshotId).toBe(
      first.snapshot.snapshotId,
    );
    expect(rolledBack.lifecycle.headRevision).toBe(3);
    expect(rolledBack.activation.action).toBe('ROLLBACK');
    expect(rolledBack.activation.fromSnapshotId).toBe(
      second.snapshot.snapshotId,
    );
    expect(rolledBack.lifecycle.rollbackCandidates).toEqual([
      {
        targetSnapshotId: second.snapshot.snapshotId,
        expectedRevision: 3,
      },
    ]);
    const rollbackRun = runActual737Assessment(
      await service.readActiveRuntime(TENANT_ID),
    );
    expect(rollbackRun).toEqual(firstRun);
    expect(
      rolledBack.lifecycle.snapshots.find(
        (snapshot): boolean =>
          snapshot.snapshotId === second.snapshot.snapshotId,
      )?.lifecycleStatus,
    ).toBe('SUPERSEDED');
  });

  it('rejects stale current and non-owner attempts', async () => {
    const rulePackBytes: Uint8Array = new Uint8Array(
      readFileSync(RULE_PACK_PATH),
    );
    const repository = new InMemoryRuleSetRepository();
    const service = new CanonicalRuleSetLifecycleService(
      repository as never,
      new InMemoryRuleSetArtifacts(rulePackBytes) as never,
    );
    const actor: CanonicalHostActor = engineeringOwner();
    const created = await service.createSnapshot(
      selection('rule-pack-a.json'),
      actor,
    );
    await service.promote(
      {
        targetSnapshotId: created.snapshot.snapshotId,
        expectedRevision: 0,
        reason: 'Activate reviewed baseline.',
      },
      actor,
    );

    await expect(
      service.promote(
        {
          targetSnapshotId: created.snapshot.snapshotId,
          expectedRevision: 0,
          reason: 'Stale request.',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'RULE_SET_CURRENT_CAS_CONFLICT' });
    await expect(service.read({ ...actor, roles: [] })).rejects.toMatchObject({
      code: 'RULE_SET_ENGINEERING_OWNER_REQUIRED',
    });
    await expect(
      service.read({ ...actor, objectAccessActor: undefined }),
    ).rejects.toMatchObject({ code: 'RULE_SET_ENGINEERING_OWNER_REQUIRED' });
  });

  it('fails closed when the owner role is absent or reuses development', async () => {
    const service = new CanonicalRuleSetLifecycleService(
      new InMemoryRuleSetRepository() as never,
      new InMemoryRuleSetArtifacts(new Uint8Array([123, 125])) as never,
    );
    const previousRoleId =
      process.env[CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ENV];
    try {
      delete process.env[CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ENV];
      await expect(service.read(engineeringOwner())).rejects.toMatchObject({
        code: 'RULE_SET_ENGINEERING_OWNER_ROLE_NOT_CONFIGURED',
        statusCode: 503,
      });

      process.env[CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ENV] =
        'wiselink_development';
      await expect(
        service.read(engineeringOwner('wiselink_development')),
      ).rejects.toMatchObject({
        code: 'RULE_SET_ENGINEERING_OWNER_ROLE_NOT_DEDICATED',
        statusCode: 503,
      });
    } finally {
      if (previousRoleId === undefined) {
        delete process.env[CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ENV];
      } else {
        process.env[CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ENV] =
          previousRoleId;
      }
    }
  });

  it('rejects invalid candidate rule bytes as a client error', async () => {
    const service = new CanonicalRuleSetLifecycleService(
      new InMemoryRuleSetRepository() as never,
      new InMemoryRuleSetArtifacts(new Uint8Array([123, 125])) as never,
    );

    await expect(
      service.createSnapshot(
        selection('invalid-rule-pack.json'),
        engineeringOwner(),
      ),
    ).rejects.toMatchObject({
      code: 'RULE_SET_ARTIFACT_RULE_PACK_INVALID',
      statusCode: 400,
    });
  });
});

function runActual737Assessment(runtime: {
  rulePack: Record<string, unknown>;
  rulePackHash: string;
  criterionSet: Record<string, unknown>;
}): { criterionSetId: string; evaluationItemCount: number } {
  const artifactBytes: Uint8Array = new Uint8Array(
    readFileSync(
      resolve(REAL_PACKAGE_DIRECTORY, 'unified-package.frozen-2.json'),
    ),
  );
  const artifactRecord = JSON.parse(
    readFileSync(
      resolve(REAL_PACKAGE_DIRECTORY, 'artifact-record.frozen-2.json'),
      'utf8',
    ),
  ) as UnifiedParsedPackageArtifactRecord;
  const input = buildUnifiedSbJobAidAssessmentInput({
    documentVersionBinding: documentBinding(artifactRecord),
    artifactBytes,
    assessmentAsOf: '2026-08-30T00:00:00.000Z',
  });
  const result = buildRuntimeAssessment({
    input,
    rulePack: runtime.rulePack,
    rulePackHash: runtime.rulePackHash,
    criterionSet: runtime.criterionSet,
    generatedAt: '2026-08-30T00:00:00.000Z',
  });
  return {
    criterionSetId: result.rulePackBinding.criterionSetId,
    evaluationItemCount: result.evaluationItems.length,
  };
}

function documentBinding(
  artifactRecord: UnifiedParsedPackageArtifactRecord,
): DocumentVersionUnifiedArtifactBinding {
  return {
    documentId: 'document_10085d27e5c05266403bb74c',
    documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
    artifactRecord,
    lifecycleStatus: 'FROZEN' as const,
    selectionStatus: 'SELECTED' as const,
    isCurrent: true as const,
    classification: {
      schemaVersion: 'wiselink.v3_1.document_classification_envelope.v1',
      classificationId: 'CLS-RULE-SET-LIFECYCLE-TEST',
      classificationHash: `sha256:${'a'.repeat(64)}`,
      status: 'CONFIRMED' as const,
      normalizedFamily: 'SB' as const,
      issuer: 'BOEING',
      subtype: 'service_bulletin',
      profileId: 'document-family-profile:issuer.boeing.service_bulletin@1.0.0',
      nativeParseProfileId: 'boeing.sb' as const,
    },
  };
}

function selection(filePath: string) {
  return { selection: { bucketId: 'bucket-rule-set-test', filePath } };
}

function engineeringOwner(
  roleId = ENGINEERING_OWNER_ROLE_ID,
): CanonicalHostActor {
  const roles: string[] = [roleId];
  return {
    userId: 'engineering-owner-rule-set-test',
    tenantId: TENANT_ID,
    appId: 'app_17bzc551rsg',
    roles,
    env: 'preview',
    objectAccessActor: {
      principalKind: 'FINAL_USER',
      transport: 'MIAODA_AUTHENTICATED_HTTP',
      canonicalSubject: {
        namespace: 'MIAODA_USER_ID',
        id: 'engineering-owner-rule-set-test',
      },
      subjectDecision: {
        source: 'MIAODA_GATEWAY_USER_CONTEXT',
        applicationScopeId: 'app_17bzc551rsg',
        tenantId: TENANT_ID,
        version: 'test',
        decidedAt: '2026-08-30T00:00:00.000Z',
      },
      tenantId: TENANT_ID,
      applicationScopeId: 'app_17bzc551rsg',
      applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
      workspaceId: null,
      workspaceProvenance: 'UNAVAILABLE',
      env: 'preview',
      platformRoles: roles,
      identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
      feishuUserId: null,
      feishuOpenId: null,
      feishuIdentityProvenance: 'UNAVAILABLE',
      sessionId: null,
      sessionRevision: null,
      sessionProvenance: 'UNAVAILABLE',
    },
  };
}

class InMemoryRuleSetArtifacts {
  constructor(private readonly bytes: Uint8Array) {}

  async read(selectionValue: {
    bucketId: string;
    filePath: string;
  }): Promise<CanonicalRuleSetArtifactReadResult> {
    const digest: string = createHash('sha256')
      .update(this.bytes)
      .digest('hex');
    return {
      bytes: Uint8Array.from(this.bytes),
      artifactRef:
        `miaoda-fileservice://${selectionValue.bucketId}/` +
        `${selectionValue.filePath}?object=${selectionValue.filePath}`,
      artifactDigest: `sha256:${digest}`,
      artifactVersion: `version:${selectionValue.filePath}`,
    };
  }
}

class InMemoryRuleSetRepository {
  private readonly snapshots: Map<string, StoredCanonicalRuleSetRuntime> =
    new Map();
  private readonly activations: StoredCanonicalRuleSetActivation[] = [];

  async createSnapshot(
    input: CreateCanonicalRuleSetSnapshotRecord,
  ): Promise<{ snapshot: StoredCanonicalRuleSetSnapshot; replayed: boolean }> {
    const existing = this.snapshots.get(input.criterionSetId);
    if (existing) return { snapshot: withoutPayload(existing), replayed: true };
    const snapshot: StoredCanonicalRuleSetRuntime = {
      ...input,
      ruleSetKey: CANONICAL_JOB_AID_RULE_SET_KEY,
      createdAt: new Date('2026-08-30T00:00:00.000Z'),
    };
    this.snapshots.set(snapshot.criterionSetId, snapshot);
    return { snapshot: withoutPayload(snapshot), replayed: false };
  }

  async listSnapshots(): Promise<StoredCanonicalRuleSetSnapshot[]> {
    return [...this.snapshots.values()].map(withoutPayload);
  }

  async getSnapshot(
    _tenantId: string,
    criterionSetId: string,
  ): Promise<StoredCanonicalRuleSetRuntime | null> {
    return this.snapshots.get(criterionSetId) ?? null;
  }

  async listActivations(): Promise<StoredCanonicalRuleSetActivation[]> {
    return [...this.activations].sort(
      (
        left: StoredCanonicalRuleSetActivation,
        right: StoredCanonicalRuleSetActivation,
      ): number => right.activationRevision - left.activationRevision,
    );
  }

  async currentActivation(): Promise<StoredCanonicalRuleSetActivation | null> {
    return this.activations.at(-1) ?? null;
  }

  async appendActivation(input: {
    tenantId: string;
    targetCriterionSetId: string;
    expectedRevision: number;
    action: 'PROMOTE' | 'ROLLBACK';
    engineeringOwnerUserId: string;
    requiredRoleId: string;
    reason: string;
  }): Promise<StoredCanonicalRuleSetActivation> {
    const current = this.activations.at(-1) ?? null;
    if ((current?.activationRevision ?? 0) !== input.expectedRevision) {
      throw Object.assign(new Error('RULE_SET_CURRENT_CAS_CONFLICT'), {
        code: 'RULE_SET_CURRENT_CAS_CONFLICT',
        statusCode: 409,
      });
    }
    if (current?.activeCriterionSetId === input.targetCriterionSetId) {
      throw Object.assign(new Error('RULE_SET_TARGET_ALREADY_ACTIVE'), {
        code: 'RULE_SET_TARGET_ALREADY_ACTIVE',
        statusCode: 409,
      });
    }
    const activation: StoredCanonicalRuleSetActivation = {
      activationId: `activation-${input.expectedRevision + 1}`,
      tenantId: input.tenantId,
      ruleSetKey: CANONICAL_JOB_AID_RULE_SET_KEY,
      activationRevision: input.expectedRevision + 1,
      expectedRevision: input.expectedRevision,
      action: input.action,
      fromCriterionSetId: current?.activeCriterionSetId ?? null,
      activeCriterionSetId: input.targetCriterionSetId,
      engineeringOwnerUserId: input.engineeringOwnerUserId,
      requiredRoleId: input.requiredRoleId,
      reason: input.reason,
      activatedAt: new Date(
        `2026-08-30T00:00:0${input.expectedRevision + 1}.000Z`,
      ),
    };
    this.activations.push(activation);
    return activation;
  }
}

function withoutPayload(
  value: StoredCanonicalRuleSetRuntime,
): StoredCanonicalRuleSetSnapshot {
  const { rulePackJson: _rulePackJson, ...snapshot } = value;
  return snapshot;
}
