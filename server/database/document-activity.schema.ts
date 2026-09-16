// Generated from dev after 0058; isolated like the existing parsing/semantic schemas.
import { sql } from 'drizzle-orm';
import { pgTable, varchar, integer, jsonb, uuid, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core';
import { customTimestamptz, userProfile } from './schema';
import { dmDocumentParseRun } from './document-parsing.schema';

export const dmDocumentActivityRun = pgTable("dm_document_activity_run", {
  runRef: varchar("run_ref", { length: 96 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  actorUserId: varchar("actor_user_id", { length: 255 }).notNull(),
  requestId: varchar("request_id", { length: 160 }).notNull(),
  documentVersionId: varchar("document_version_id", { length: 96 }).notNull(),
  parseRunId: varchar("parse_run_id", { length: 96 }).notNull(),
  parseRevision: integer("parse_revision").notNull(),
  semanticRevision: integer("semantic_revision").notNull(),
  originalManifestSha256: varchar("original_manifest_sha256", { length: 64 }).notNull(),
  /**
   * @type { { sectionIds: string[] } }
   */
  selectionJson: jsonb("selection_json").notNull(),
  expectedRevision: integer("expected_revision").notNull(),
  candidateRevision: integer("candidate_revision"),
  status: varchar("status", { length: 16 }).notNull(),
  leaseOwner: varchar("lease_owner", { length: 160 }),
  leaseToken: uuid("lease_token"),
  leaseGeneration: integer("lease_generation").notNull().default(0),
  leaseExpiresAt: customTimestamptz("lease_expires_at", { precision: 6 }),
  deadlineAt: customTimestamptz("deadline_at", { precision: 6 }).notNull(),
  /**
   * @type { Array<{ sectionId: string; offset: number; unitIds: string[]; anchorIds: string[]; nextOffset: number | null }> }
   */
  deliveredJson: jsonb("delivered_json").notNull().default('[]'),
  /**
   * @type { Record<string, unknown> }
   */
  resultJson: jsonb("result_json"),
  /**
   * @type { Record<string, unknown> }
   */
  saveCommandJson: jsonb("save_command_json"),
  /**
   * @type { { skillVersion: string; modelVersion: string } }
   */
  producerJson: jsonb("producer_json"),
  errorCode: varchar("error_code", { length: 160 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("dm_document_activity_run_tenant_id_actor_user_id_request_id_key").on(table.tenantId, table.actorUserId, table.requestId),
  uniqueIndex("dm_document_activity_run_tenant_id_document_version_id_pars_key").on(table.tenantId, table.documentVersionId, table.parseRunId, table.candidateRevision),
  foreignKey({
    columns: [table.documentVersionId, table.parseRunId, table.tenantId],
    foreignColumns: [dmDocumentParseRun.documentVersionId, dmDocumentParseRun.parseRunId, dmDocumentParseRun.tenantId],
    name: "dm_document_activity_run_tenant_id_document_version_id_par_fkey",
  }),
]);
