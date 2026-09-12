import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import type { DocumentParseStatus } from '@shared/document-parsing.interface';
import type { DocumentOriginalArtifact } from '@shared/document-original.interface';
import type { MineruDocumentVersionBinding, MineruStoredArtifact } from '../modules/professional-input/mineru/mineru-artifact-store';
import { customTimestamptz, dmDocumentVersion } from './schema';

/** Derived parse runs belong to the existing DM version; they never move family currentness. */
export const dmDocumentParseRun = pgTable('dm_document_parse_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  parseRunId: varchar('parse_run_id', { length: 96 }).notNull().unique(),
  documentVersionId: varchar('document_version_id', { length: 96 }).notNull().references(() => dmDocumentVersion.documentVersionId),
  tenantId: varchar('tenant_id', { length: 128 }).notNull(),
  actorUserId: varchar('actor_user_id', { length: 255 }).notNull(),
  requestId: varchar('request_id', { length: 128 }).notNull(),
  parseRevision: integer('parse_revision').notNull(),
  expectedPublishedRevision: integer('expected_published_revision').notNull(),
  status: varchar('status', { length: 32 }).$type<DocumentParseStatus>().notNull(),
  bucketId: varchar('bucket_id', { length: 255 }).notNull(),
  sourceBinding: jsonb('source_binding').$type<MineruDocumentVersionBinding>().notNull(),
  artifactProgress: jsonb('artifact_progress').$type<Array<DocumentOriginalArtifact | MineruStoredArtifact>>().notNull().default([]),
  pendingObject: jsonb('pending_object').$type<{ bucketId: string; filePath: string } | null>(),
  manifestArtifact: jsonb('manifest_artifact').$type<DocumentOriginalArtifact | MineruStoredArtifact | null>(),
  leaseOwner: varchar('lease_owner', { length: 160 }),
  leaseToken: varchar('lease_token', { length: 96 }),
  leaseGeneration: integer('lease_generation').notNull().default(0),
  leaseExpiresAt: customTimestamptz('lease_expires_at', { precision: 3 }),
  cancelRequestedAt: customTimestamptz('cancel_requested_at', { precision: 3 }),
  errorCode: varchar('error_code', { length: 160 }),
  errorMessage: text('error_message'),
  startedAt: customTimestamptz('started_at', { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  deadlineAt: customTimestamptz('deadline_at', { precision: 3 }).notNull(),
  completedAt: customTimestamptz('completed_at', { precision: 3 }),
}, table => [
  uniqueIndex('uk_dm_parse_request').on(table.tenantId, table.actorUserId, table.documentVersionId, table.requestId),
  uniqueIndex('uk_dm_parse_revision').on(table.tenantId, table.documentVersionId, table.parseRevision),
  uniqueIndex('uk_dm_parse_active').on(table.tenantId, table.documentVersionId).where(sql`${table.status} IN ('RUNNING', 'STAGING')`),
]);
