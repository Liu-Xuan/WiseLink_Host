import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq } from 'drizzle-orm';
import { wiselinkDriveScanCheckpoint } from '../../../../../database/drive-scan.schema';
import type { DriveFolderScanCheckpointStore } from '../drive-folder-scan-coordinator';

@Injectable()
export class DriveScanCheckpointRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  forTenant(tenantId: string): DriveFolderScanCheckpointStore {
    if (!tenantId) throw new Error('DRIVE_SCAN_TENANT_REQUIRED');
    return {
      load: sourceKey => this.loadForTenant(tenantId, sourceKey),
      save: (sourceKey, checkpoint) => this.saveForTenant(tenantId, sourceKey, checkpoint),
      loadCandidates: sourceKey => this.loadCandidatesForTenant(tenantId, sourceKey),
      saveCandidates: (sourceKey, candidates) => this.saveCandidatesForTenant(tenantId, sourceKey, candidates),
    };
  }

  private async loadForTenant(tenantId: string, sourceKey: string): Promise<string | null> {
    const [row] = await this.db.select({ checkpoint: wiselinkDriveScanCheckpoint.checkpointJson })
      .from(wiselinkDriveScanCheckpoint)
      .where(and(eq(wiselinkDriveScanCheckpoint.tenantId, tenantId), eq(wiselinkDriveScanCheckpoint.sourceKey, sourceKey)))
      .limit(1);
    return row?.checkpoint ?? null;
  }

  private async saveForTenant(tenantId: string, sourceKey: string, checkpoint: string): Promise<void> {
    await this.db.insert(wiselinkDriveScanCheckpoint).values({
      tenantId, sourceKey, checkpointJson: checkpoint, checkpointVersion: 1,
    }).onConflictDoUpdate({
      target: [wiselinkDriveScanCheckpoint.tenantId, wiselinkDriveScanCheckpoint.sourceKey],
      set: { checkpointJson: checkpoint, checkpointVersion: 1 },
    });
  }

  private async loadCandidatesForTenant(tenantId: string, sourceKey: string): Promise<string | null> {
    const [row] = await this.db.select({ candidates: wiselinkDriveScanCheckpoint.candidateSnapshotJson })
      .from(wiselinkDriveScanCheckpoint)
      .where(and(eq(wiselinkDriveScanCheckpoint.tenantId, tenantId), eq(wiselinkDriveScanCheckpoint.sourceKey, sourceKey)))
      .limit(1);
    return row?.candidates ?? null;
  }

  private async saveCandidatesForTenant(tenantId: string, sourceKey: string, candidates: string): Promise<void> {
    await this.db.update(wiselinkDriveScanCheckpoint)
      .set({ candidateSnapshotJson: candidates })
      .where(and(eq(wiselinkDriveScanCheckpoint.tenantId, tenantId), eq(wiselinkDriveScanCheckpoint.sourceKey, sourceKey)));
  }
}
