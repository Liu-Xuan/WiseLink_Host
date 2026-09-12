import { integer, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

/** Host-owned resumable source scan state; file contents and credentials stay elsewhere. */
export const wiselinkDriveScanCheckpoint = pgTable('wiselink_drive_scan_checkpoint', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 128 }).notNull(),
  sourceKey: varchar('source_key', { length: 128 }).notNull(),
  checkpointJson: text('checkpoint_json').notNull(),
  candidateSnapshotJson: text('candidate_snapshot_json'),
  pendingCandidatesJson: text('pending_candidates_json').notNull().default('[]'),
  checkpointVersion: integer('checkpoint_version').notNull().default(1),
}, table => [
  uniqueIndex('uk_wiselink_drive_scan_checkpoint_source').on(table.tenantId, table.sourceKey),
]);
