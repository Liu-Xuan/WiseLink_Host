import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import type {
  DerivedSummaryMember, DerivedSummaryRevision, DerivedSummaryScopeSelection,
} from '@shared/derived-summary.interface';
import { customTimestamptz } from './schema';

/** Additive schema follows the document parsing/runtime schema pattern. */
export const derivedSummary = pgTable('derived_summary', {
  id: uuid('id').primaryKey().defaultRandom(),
  summaryId: varchar('summary_id', { length: 96 }).notNull().unique(),
  tenantId: varchar('tenant_id', { length: 128 }).notNull(),
  actorUserId: varchar('actor_user_id', { length: 255 }).notNull(),
  createRequestId: varchar('create_request_id', { length: 96 }).notNull(),
  scopeJson: jsonb('scope_json').$type<DerivedSummaryScopeSelection>().notNull(),
  membersJson: jsonb('members_json').$type<DerivedSummaryMember[]>().notNull(),
  currentRevision: integer('current_revision').notNull().default(0),
  currentSummaryRef: varchar('current_summary_ref', { length: 96 }),
  createdAt: customTimestamptz('created_at', { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz('updated_at', { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex('uk_derived_summary_request').on(table.tenantId, table.actorUserId, table.createRequestId),
  uniqueIndex('uk_derived_summary_tenant_id').on(table.tenantId, table.summaryId),
]);

export const derivedSummaryRevision = pgTable('derived_summary_revision', {
  id: uuid('id').primaryKey().defaultRandom(),
  summaryRef: varchar('summary_ref', { length: 96 }).notNull().unique(),
  summaryId: varchar('summary_id', { length: 96 }).notNull(),
  tenantId: varchar('tenant_id', { length: 128 }).notNull(),
  actorUserId: varchar('actor_user_id', { length: 255 }).notNull(),
  revision: integer('revision').notNull(),
  requestId: varchar('request_id', { length: 96 }).notNull(),
  attemptId: varchar('attempt_id', { length: 96 }).notNull(),
  contentJson: jsonb('content_json').$type<DerivedSummaryRevision>().notNull(),
  createdAt: customTimestamptz('created_at', { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex('uk_derived_summary_revision').on(table.tenantId, table.summaryId, table.revision),
  uniqueIndex('uk_derived_summary_save_request').on(table.tenantId, table.summaryId, table.requestId),
]);

/** Only the additive column; ordinary queue operations retain their existing table schema. */
export const derivedSummaryAttemptBinding = pgTable('action_attempt', {
  attemptId: varchar('attempt_id', { length: 96 }).primaryKey(),
  summaryId: varchar('summary_id', { length: 96 }),
  requestCommandJson: text('summary_request_command_json'),
  delegatedPrincipalId: varchar('summary_delegated_principal_id', { length: 160 }),
});
