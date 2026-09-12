import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq } from 'drizzle-orm';
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
    const [row] = await this.db.select({ pending: wiselinkDriveScanCheckpoint.pendingCandidatesJson })
      .from(wiselinkDriveScanCheckpoint)
      .where(and(eq(wiselinkDriveScanCheckpoint.tenantId, tenantId), eq(wiselinkDriveScanCheckpoint.sourceKey, sourceKey))).limit(1);
    return row ? decodeDriveSourceCandidates(row.pending) : [];
  }

  private async loadForTenant(tenantId: string, sourceKey: string): Promise<string | null> {
    const [row] = await this.db.select({ checkpoint: wiselinkDriveScanCheckpoint.checkpointJson })
      .from(wiselinkDriveScanCheckpoint)
      .where(and(eq(wiselinkDriveScanCheckpoint.tenantId, tenantId), eq(wiselinkDriveScanCheckpoint.sourceKey, sourceKey)))
      .limit(1);
    return row?.checkpoint ?? null;
  }

  private async savePage(tenantId: string, sourceKey: string, checkpoint: string,
    candidates: DriveSourceCandidate[], expected: string | null): Promise<void> {
    await this.db.transaction(async tx => {
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
        if (kind !== 'UNCHANGED') intents.set(key(candidate), candidate);
      }
      await tx.update(wiselinkDriveScanCheckpoint).set({ checkpointJson: checkpoint,
        candidateSnapshotJson: encodeDriveSourceCandidates([...observed.values()]),
        pendingCandidatesJson: encodeDriveSourceCandidates([...intents.values()]),
      }).where(eq(wiselinkDriveScanCheckpoint.id, row.id));
    });
  }

  private async loadCandidatesForTenant(tenantId: string, sourceKey: string): Promise<string | null> {
    const [row] = await this.db.select({ candidates: wiselinkDriveScanCheckpoint.candidateSnapshotJson })
      .from(wiselinkDriveScanCheckpoint)
      .where(and(eq(wiselinkDriveScanCheckpoint.tenantId, tenantId), eq(wiselinkDriveScanCheckpoint.sourceKey, sourceKey)))
      .limit(1);
    return row?.candidates ?? null;
  }

}
