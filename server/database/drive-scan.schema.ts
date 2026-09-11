import { integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

/** Host-owned resumable source scan state; file contents and credentials stay elsewhere. */
export const wiselinkDriveScanCheckpoint = pgTable('wiselink_drive_scan_checkpoint', {
  id: varchar('id', { length: 160 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 128 }).notNull(),
  sourceKey: varchar('source_key', { length: 128 }).notNull(),
  checkpointJson: text('checkpoint_json').notNull(),
  checkpointVersion: integer('checkpoint_version').notNull().default(1),
}, table => [
  uniqueIndex('uk_wiselink_drive_scan_checkpoint_source').on(table.tenantId, table.sourceKey),
]);
