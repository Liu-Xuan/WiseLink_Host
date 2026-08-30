import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq } from 'drizzle-orm';

import type { CanonicalRuleSetActivationAction } from '@shared/api.interface';
import {
  canonicalRuleSetActivation,
  canonicalRuleSetSnapshot,
} from '../../database/schema';

export const CANONICAL_JOB_AID_RULE_SET_KEY = 'JOB_AID' as const;

export interface StoredCanonicalRuleSetSnapshot {
  tenantId: string;
  ruleSetKey: typeof CANONICAL_JOB_AID_RULE_SET_KEY;
  criterionSetId: string;
  criterionSetHash: string;
  memberIdentityHash: string;
  criteriaCount: number;
  rulePackVersion: string;
  artifactRef: string;
  artifactDigest: string;
  artifactVersion: string;
  canonicalCriteriaHash: string;
  sourceJobAidDocumentVersionId: string | null;
  sourceJobAidVersionStatus: 'CONFIRMED' | 'VERSION_UNCONFIRMED';
  createdByEngineeringOwnerUserId: string;
  createdAt: Date;
}

export interface StoredCanonicalRuleSetRuntime extends StoredCanonicalRuleSetSnapshot {
  rulePackJson: string;
}

export interface StoredCanonicalRuleSetActivation {
  activationId: string;
  tenantId: string;
  ruleSetKey: typeof CANONICAL_JOB_AID_RULE_SET_KEY;
  activationRevision: number;
  expectedRevision: number;
  action: CanonicalRuleSetActivationAction;
  fromCriterionSetId: string | null;
  activeCriterionSetId: string;
  engineeringOwnerUserId: string;
  requiredRoleId: string;
  reason: string;
  activatedAt: Date;
}

export interface CreateCanonicalRuleSetSnapshotRecord {
  tenantId: string;
  criterionSetId: string;
  criterionSetHash: string;
  memberIdentityHash: string;
  criteriaCount: number;
  rulePackVersion: string;
  rulePackJson: string;
  artifactRef: string;
  artifactDigest: string;
  artifactVersion: string;
  canonicalCriteriaHash: string;
  sourceJobAidDocumentVersionId: string | null;
  sourceJobAidVersionStatus: 'CONFIRMED' | 'VERSION_UNCONFIRMED';
  createdByEngineeringOwnerUserId: string;
}

@Injectable()
export class CanonicalRuleSetLifecycleRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async createSnapshot(
    input: CreateCanonicalRuleSetSnapshotRecord,
  ): Promise<{ snapshot: StoredCanonicalRuleSetSnapshot; replayed: boolean }> {
    const [created] = await this.db
      .insert(canonicalRuleSetSnapshot)
      .values({
        ...input,
        ruleSetKey: CANONICAL_JOB_AID_RULE_SET_KEY,
      })
      .onConflictDoNothing()
      .returning(snapshotSelection());
    if (created) {
      return { snapshot: toStoredSnapshot(created), replayed: false };
    }
    const existing = await this.getSnapshot(
      input.tenantId,
      input.criterionSetId,
    );
    if (!existing)
      throw lifecycleError('RULE_SET_SNAPSHOT_CREATE_CONFLICT', 409);
    assertSnapshotReplay(existing, input);
    return { snapshot: withoutRulePack(existing), replayed: true };
  }

  async listSnapshots(
    tenantId: string,
  ): Promise<StoredCanonicalRuleSetSnapshot[]> {
    const rows = await this.db
      .select(snapshotSelection())
      .from(canonicalRuleSetSnapshot)
      .where(
        and(
          eq(canonicalRuleSetSnapshot.tenantId, tenantId),
          eq(
            canonicalRuleSetSnapshot.ruleSetKey,
            CANONICAL_JOB_AID_RULE_SET_KEY,
          ),
        ),
      )
      .orderBy(desc(canonicalRuleSetSnapshot.createdAt));
    return rows.map(toStoredSnapshot);
  }

  async getSnapshot(
    tenantId: string,
    criterionSetId: string,
  ): Promise<StoredCanonicalRuleSetRuntime | null> {
    const [row] = await this.db
      .select({
        ...snapshotSelection(),
        rulePackJson: canonicalRuleSetSnapshot.rulePackJson,
      })
      .from(canonicalRuleSetSnapshot)
      .where(
        and(
          eq(canonicalRuleSetSnapshot.tenantId, tenantId),
          eq(
            canonicalRuleSetSnapshot.ruleSetKey,
            CANONICAL_JOB_AID_RULE_SET_KEY,
          ),
          eq(canonicalRuleSetSnapshot.criterionSetId, criterionSetId),
        ),
      )
      .limit(1);
    return row
      ? { ...toStoredSnapshot(row), rulePackJson: row.rulePackJson }
      : null;
  }

  async listActivations(
    tenantId: string,
  ): Promise<StoredCanonicalRuleSetActivation[]> {
    const rows = await this.db
      .select(activationSelection())
      .from(canonicalRuleSetActivation)
      .where(
        and(
          eq(canonicalRuleSetActivation.tenantId, tenantId),
          eq(
            canonicalRuleSetActivation.ruleSetKey,
            CANONICAL_JOB_AID_RULE_SET_KEY,
          ),
        ),
      )
      .orderBy(desc(canonicalRuleSetActivation.activationRevision));
    return rows.map(toStoredActivation);
  }

  async currentActivation(
    tenantId: string,
  ): Promise<StoredCanonicalRuleSetActivation | null> {
    const [row] = await this.db
      .select(activationSelection())
      .from(canonicalRuleSetActivation)
      .where(
        and(
          eq(canonicalRuleSetActivation.tenantId, tenantId),
          eq(
            canonicalRuleSetActivation.ruleSetKey,
            CANONICAL_JOB_AID_RULE_SET_KEY,
          ),
        ),
      )
      .orderBy(desc(canonicalRuleSetActivation.activationRevision))
      .limit(1);
    return row ? toStoredActivation(row) : null;
  }

  async appendActivation(input: {
    tenantId: string;
    targetCriterionSetId: string;
    expectedRevision: number;
    action: CanonicalRuleSetActivationAction;
    engineeringOwnerUserId: string;
    requiredRoleId: string;
    reason: string;
  }): Promise<StoredCanonicalRuleSetActivation> {
    const current = await this.currentActivation(input.tenantId);
    const currentRevision: number = current?.activationRevision ?? 0;
    if (currentRevision !== input.expectedRevision) {
      throw lifecycleError('RULE_SET_CURRENT_CAS_CONFLICT', 409);
    }
    if (current?.activeCriterionSetId === input.targetCriterionSetId) {
      throw lifecycleError('RULE_SET_TARGET_ALREADY_ACTIVE', 409);
    }
    const target = await this.getSnapshot(
      input.tenantId,
      input.targetCriterionSetId,
    );
    if (!target) throw lifecycleError('RULE_SET_SNAPSHOT_NOT_FOUND', 404);
    const targetWasActive = await this.wasActive(
      input.tenantId,
      input.targetCriterionSetId,
    );
    if (input.action === 'ROLLBACK' && !targetWasActive) {
      throw lifecycleError(
        'RULE_SET_ROLLBACK_TARGET_NOT_PREVIOUSLY_ACTIVE',
        409,
      );
    }
    if (input.action === 'PROMOTE' && targetWasActive) {
      throw lifecycleError('RULE_SET_PROMOTION_TARGET_SUPERSEDED', 409);
    }
    if (input.action === 'ROLLBACK' && current === null) {
      throw lifecycleError('RULE_SET_ROLLBACK_REQUIRES_ACTIVE_HEAD', 409);
    }
    try {
      const [created] = await this.db
        .insert(canonicalRuleSetActivation)
        .values({
          tenantId: input.tenantId,
          ruleSetKey: CANONICAL_JOB_AID_RULE_SET_KEY,
          activationRevision: input.expectedRevision + 1,
          expectedRevision: input.expectedRevision,
          action: input.action,
          fromCriterionSetId: current?.activeCriterionSetId ?? null,
          activeCriterionSetId: target.criterionSetId,
          engineeringOwnerUserId: input.engineeringOwnerUserId,
          requiredRoleId: input.requiredRoleId,
          reason: input.reason,
        })
        .returning(activationSelection());
      if (!created)
        throw lifecycleError('RULE_SET_ACTIVATION_WRITE_FAILED', 500);
      return toStoredActivation(created);
    } catch (error) {
      if (databaseErrorMatches(error, '23505')) {
        throw lifecycleError('RULE_SET_CURRENT_CAS_CONFLICT', 409);
      }
      throw error;
    }
  }

  private async wasActive(
    tenantId: string,
    criterionSetId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ activationId: canonicalRuleSetActivation.activationId })
      .from(canonicalRuleSetActivation)
      .where(
        and(
          eq(canonicalRuleSetActivation.tenantId, tenantId),
          eq(
            canonicalRuleSetActivation.ruleSetKey,
            CANONICAL_JOB_AID_RULE_SET_KEY,
          ),
          eq(canonicalRuleSetActivation.activeCriterionSetId, criterionSetId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
}

function snapshotSelection() {
  return {
    tenantId: canonicalRuleSetSnapshot.tenantId,
    ruleSetKey: canonicalRuleSetSnapshot.ruleSetKey,
    criterionSetId: canonicalRuleSetSnapshot.criterionSetId,
    criterionSetHash: canonicalRuleSetSnapshot.criterionSetHash,
    memberIdentityHash: canonicalRuleSetSnapshot.memberIdentityHash,
    criteriaCount: canonicalRuleSetSnapshot.criteriaCount,
    rulePackVersion: canonicalRuleSetSnapshot.rulePackVersion,
    artifactRef: canonicalRuleSetSnapshot.artifactRef,
    artifactDigest: canonicalRuleSetSnapshot.artifactDigest,
    artifactVersion: canonicalRuleSetSnapshot.artifactVersion,
    canonicalCriteriaHash: canonicalRuleSetSnapshot.canonicalCriteriaHash,
    sourceJobAidDocumentVersionId:
      canonicalRuleSetSnapshot.sourceJobAidDocumentVersionId,
    sourceJobAidVersionStatus:
      canonicalRuleSetSnapshot.sourceJobAidVersionStatus,
    createdByEngineeringOwnerUserId:
      canonicalRuleSetSnapshot.createdByEngineeringOwnerUserId,
    createdAt: canonicalRuleSetSnapshot.createdAt,
  };
}

function activationSelection() {
  return {
    activationId: canonicalRuleSetActivation.activationId,
    tenantId: canonicalRuleSetActivation.tenantId,
    ruleSetKey: canonicalRuleSetActivation.ruleSetKey,
    activationRevision: canonicalRuleSetActivation.activationRevision,
    expectedRevision: canonicalRuleSetActivation.expectedRevision,
    action: canonicalRuleSetActivation.action,
    fromCriterionSetId: canonicalRuleSetActivation.fromCriterionSetId,
    activeCriterionSetId: canonicalRuleSetActivation.activeCriterionSetId,
    engineeringOwnerUserId: canonicalRuleSetActivation.engineeringOwnerUserId,
    requiredRoleId: canonicalRuleSetActivation.requiredRoleId,
    reason: canonicalRuleSetActivation.reason,
    activatedAt: canonicalRuleSetActivation.activatedAt,
  };
}

function toStoredSnapshot(
  row: ReturnType<typeof snapshotSelection> extends infer Selection
    ? { [Key in keyof Selection]: unknown }
    : never,
): StoredCanonicalRuleSetSnapshot {
  return row as unknown as StoredCanonicalRuleSetSnapshot;
}

function toStoredActivation(
  row: ReturnType<typeof activationSelection> extends infer Selection
    ? { [Key in keyof Selection]: unknown }
    : never,
): StoredCanonicalRuleSetActivation {
  return row as unknown as StoredCanonicalRuleSetActivation;
}

function withoutRulePack(
  value: StoredCanonicalRuleSetRuntime,
): StoredCanonicalRuleSetSnapshot {
  const { rulePackJson: _rulePackJson, ...snapshot } = value;
  return snapshot;
}

function assertSnapshotReplay(
  existing: StoredCanonicalRuleSetRuntime,
  input: CreateCanonicalRuleSetSnapshotRecord,
): void {
  if (
    existing.criterionSetHash !== input.criterionSetHash ||
    existing.memberIdentityHash !== input.memberIdentityHash ||
    existing.artifactDigest !== input.artifactDigest ||
    existing.artifactRef !== input.artifactRef ||
    existing.artifactVersion !== input.artifactVersion ||
    existing.rulePackJson !== input.rulePackJson
  ) {
    throw lifecycleError('RULE_SET_SNAPSHOT_IDENTITY_CONFLICT', 409);
  }
}

function databaseErrorMatches(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth: number = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== 'object') return false;
    const value = current as Record<string, unknown>;
    if (value.code === code) return true;
    current = value.cause;
  }
  return false;
}

function lifecycleError(
  code: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}
