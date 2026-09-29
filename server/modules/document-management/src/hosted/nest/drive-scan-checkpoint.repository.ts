import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql } from 'drizzle-orm';
import { wiselinkDriveScanCheckpoint } from '../../../../../database/drive-scan.schema';
import { classifyDriveSourceCandidates, decodeDriveSourceCandidates, encodeDriveSourceCandidates, type DriveSourceCandidate } from '../drive-source-candidate';
import type { DriveFolderScanCheckpointStore } from '../drive-folder-scan-coordinator';

@Injectable()
// Registered in DocumentManagementHostedModule.register dynamic providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DriveScanCheckpointRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  forTenant(tenantId: string): DriveFolderScanCheckpointStore {
    if (!tenantId) throw new Error('DRIVE_SCAN_TENANT_REQUIRED');
    return {
      load: sourceKey => this.loadForTenant(tenantId, sourceKey),
      savePage: (sourceKey, checkpoint, candidates, expected) => this.savePage(tenantId, sourceKey, checkpoint, candidates, expected),
      loadCandidates: sourceKey => this.loadCandidatesForTenant(tenantId, sourceKey),
    };
  }

  async listPendingCandidates(tenantId: string, sourceKey: string): Promise<DriveSourceCandidate[]> {
    if (!tenantId || !sourceKey) throw new Error('DRIVE_SCAN_SCOPE_REQUIRED');
    return this.db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.tenant_id',${tenantId},true)`);
      const [row] = await tx.select({ pending: wiselinkDriveScanCheckpoint.pendingCandidatesJson })
        .from(wiselinkDriveScanCheckpoint)
        .where(and(eq(wiselinkDriveScanCheckpoint.tenantId, tenantId), eq(wiselinkDriveScanCheckpoint.sourceKey, sourceKey))).limit(1);
      return row ? decodeDriveSourceCandidates(row.pending) : [];
    });
  }

  private async loadForTenant(tenantId: string, sourceKey: string): Promise<string | null> {
    return this.db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.tenant_id',${tenantId},true)`);
      const [row] = await tx.select({ checkpoint: wiselinkDriveScanCheckpoint.checkpointJson })
        .from(wiselinkDriveScanCheckpoint)
        .where(and(eq(wiselinkDriveScanCheckpoint.tenantId, tenantId), eq(wiselinkDriveScanCheckpoint.sourceKey, sourceKey)))
        .limit(1);
      return row?.checkpoint ?? null;
    });
  }

  private async savePage(tenantId: string, sourceKey: string, checkpoint: string,
    candidates: DriveSourceCandidate[], expected: string | null): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.tenant_id',${tenantId},true)`);
      const created = await tx.insert(wiselinkDriveScanCheckpoint).values({
        tenantId, sourceKey, checkpointJson: checkpoint, checkpointVersion: 1,
      }).onConflictDoNothing({ target: [wiselinkDriveScanCheckpoint.tenantId, wiselinkDriveScanCheckpoint.sourceKey] })
        .returning({ id: wiselinkDriveScanCheckpoint.id });
      const [row] = await tx.select().from(wiselinkDriveScanCheckpoint)
        .where(and(eq(wiselinkDriveScanCheckpoint.tenantId, tenantId), eq(wiselinkDriveScanCheckpoint.sourceKey, sourceKey))).for('update');
      if (!row || (created.length === 0 && row.checkpointJson !== expected) || (created.length > 0 && expected !== null)) {
        throw new Error('DRIVE_SCAN_CHECKPOINT_CONFLICT');
      }
      const prior = row.candidateSnapshotJson ? decodeDriveSourceCandidates(row.candidateSnapshotJson) : [];
      const pending = decodeDriveSourceCandidates(row.pendingCandidatesJson);
      const key = (item: DriveSourceCandidate) => `${item.sourceKey}:${item.providerObjectId}`;
      const observed = new Map(prior.map(item => [key(item), item]));
      const intents = new Map(pending.map(item => [key(item), item]));
      for (const change of classifyDriveSourceCandidates(prior, candidates)) {
        const { change: kind, ...candidate } = change;
        observed.set(key(candidate), candidate);
        // Refresh a pending legacy observation with a real list-derived chain.
        if (kind !== 'UNCHANGED' || (intents.has(key(candidate)) &&
          candidate.ancestorTokens?.length)) intents.set(key(candidate), candidate);
      }
      await tx.update(wiselinkDriveScanCheckpoint).set({ checkpointJson: checkpoint,
        candidateSnapshotJson: encodeDriveSourceCandidates([...observed.values()]),
        pendingCandidatesJson: encodeDriveSourceCandidates([...intents.values()]),
      }).where(eq(wiselinkDriveScanCheckpoint.id, row.id));
    });
  }

  private async loadCandidatesForTenant(tenantId: string, sourceKey: string): Promise<string | null> {
    return this.db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.tenant_id',${tenantId},true)`);
      const [row] = await tx.select({ candidates: wiselinkDriveScanCheckpoint.candidateSnapshotJson })
        .from(wiselinkDriveScanCheckpoint)
        .where(and(eq(wiselinkDriveScanCheckpoint.tenantId, tenantId), eq(wiselinkDriveScanCheckpoint.sourceKey, sourceKey)))
        .limit(1);
      return row?.candidates ?? null;
    });
  }

  /** Remove only the exact observed pending row after durable acquisition and intake. */
  async acknowledgeCandidate(tenantId: string, sourceKey: string,
    observed: DriveSourceCandidate): Promise<boolean> {
    if (!tenantId || !sourceKey || observed.sourceKey !== sourceKey)
      throw new Error('DRIVE_SCAN_SCOPE_REQUIRED');
    return this.db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.tenant_id',${tenantId},true)`);
      const [row] = await tx.select().from(wiselinkDriveScanCheckpoint)
        .where(and(eq(wiselinkDriveScanCheckpoint.tenantId, tenantId),
          eq(wiselinkDriveScanCheckpoint.sourceKey, sourceKey))).for('update');
      if (!row) return false;
      const pending = decodeDriveSourceCandidates(row.pendingCandidatesJson);
      const index = pending.findIndex(item => item.sourceKey === sourceKey &&
        item.providerObjectId === observed.providerObjectId);
      if (index < 0 || encodeDriveSourceCandidates([pending[index]!]) !==
        encodeDriveSourceCandidates([observed])) return false;
      pending.splice(index, 1);
      await tx.update(wiselinkDriveScanCheckpoint).set({
        pendingCandidatesJson: encodeDriveSourceCandidates(pending),
      }).where(eq(wiselinkDriveScanCheckpoint.id, row.id));
      return true;
    });
  }

  /** Move one failed exact observation behind its peers for bounded fair retry. */
  async deferCandidate(tenantId: string, sourceKey: string,
    observed: DriveSourceCandidate): Promise<boolean> {
    if (!tenantId || !sourceKey || observed.sourceKey !== sourceKey)
      throw new Error('DRIVE_SCAN_SCOPE_REQUIRED');
    return this.db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.tenant_id',${tenantId},true)`);
      const [row] = await tx.select().from(wiselinkDriveScanCheckpoint)
        .where(and(eq(wiselinkDriveScanCheckpoint.tenantId, tenantId),
          eq(wiselinkDriveScanCheckpoint.sourceKey, sourceKey))).for('update');
      if (!row) return false;
      const pending = decodeDriveSourceCandidates(row.pendingCandidatesJson);
      const index = pending.findIndex(item => item.sourceKey === sourceKey &&
        item.providerObjectId === observed.providerObjectId);
      if (index < 0 || encodeDriveSourceCandidates([pending[index]!]) !==
        encodeDriveSourceCandidates([observed])) return false;
      if (index === pending.length - 1) return true;
      pending.push(...pending.splice(index, 1));
      await tx.update(wiselinkDriveScanCheckpoint).set({
        pendingCandidatesJson: encodeDriveSourceCandidates(pending),
      }).where(eq(wiselinkDriveScanCheckpoint.id, row.id));
      return true;
    });
  }

}
