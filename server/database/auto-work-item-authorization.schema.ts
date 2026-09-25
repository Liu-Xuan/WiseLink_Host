import { sql } from 'drizzle-orm';
import {
  foreignKey,
  bigint,
  index,
  integer,
  pgTable,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { customTimestamptz, workItem } from './schema';

export type AutoWorkItemAuthorizationStatus =
  | 'WAITING'
  | 'LEASED'
  | 'BLOCKED'
  | 'COMPLETED';

/**
 * Explicit Host-side authorization for automatic processing of one newly
 * accepted WorkItem. Legacy WorkItems have no row and are never enrolled by
 * discovery.
 */
export const autoWorkItemAuthorization = pgTable(
  'auto_work_item_authorization',
  {
    tenantId: varchar('tenant_id', { length: 128 }).notNull(),
    workItemId: varchar('work_item_id', { length: 96 }).notNull(),
    requestId: varchar('request_id', { length: 96 }).notNull(),
    actorUserId: varchar('actor_user_id', { length: 255 }).notNull(),
    documentId: varchar('document_id', { length: 96 }).notNull(),
    documentVersionId: varchar('document_version_id', { length: 96 }).notNull(),
    sourceArtifactId: varchar('source_artifact_id', { length: 96 }).notNull(),
    sourceFileSha256: varchar('source_file_sha256', { length: 64 }).notNull(),
    sourceByteLength: bigint('source_byte_length', {
      mode: 'number',
    }).notNull(),
    grantKind: varchar('grant_kind', { length: 48 }).notNull(),
    status: varchar('status', { length: 16 })
      .$type<AutoWorkItemAuthorizationStatus>()
      .notNull()
      .default('WAITING'),
    leaseOwner: varchar('lease_owner', { length: 160 }),
    leaseToken: uuid('lease_token'),
    leaseGeneration: integer('lease_generation').notNull().default(0),
    leaseExpiresAt: customTimestamptz('lease_expires_at', { precision: 3 }),
    completedLeaseTokenHash: varchar('completed_lease_token_hash', {
      length: 64,
    }),
    completedLeaseGeneration: integer('completed_lease_generation'),
    completedAt: customTimestamptz('completed_at', { precision: 3 }),
    blockedCode: varchar('blocked_code', { length: 120 }),
    createdAt: customTimestamptz('created_at', { precision: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: customTimestamptz('updated_at', { precision: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.workItemId],
      foreignColumns: [workItem.tenantId, workItem.workItemId],
      name: 'fk_auto_work_item_authorization_work_item',
    }),
    index('idx_auto_work_item_authorization_due').on(
      table.tenantId,
      table.status,
      table.createdAt,
      table.leaseExpiresAt,
    ),
  ],
);
