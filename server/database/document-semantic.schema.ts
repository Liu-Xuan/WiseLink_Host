// Generated from dev after 0055; separate schema follows the existing document-parsing schema layout.
import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, integer, jsonb, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core';
import { customTimestamptz, userProfile } from './schema';
import { dmDocumentParseRun } from './document-parsing.schema';

export const dmDocumentSemanticRevision = pgTable("dm_document_semantic_revision", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  documentVersionId: varchar("document_version_id", { length: 96 }).notNull(),
  parseRunId: varchar("parse_run_id", { length: 96 }).notNull(),
  parseRevision: integer("parse_revision").notNull(),
  semanticRevision: integer("semantic_revision").notNull(),
  actorUserId: varchar("actor_user_id", { length: 255 }).notNull(),
  profileRef: varchar("profile_ref", { length: 160 }).notNull(),
  originalManifestSha256: varchar("original_manifest_sha256", { length: 64 }).notNull(),
  mapJson: jsonb("map_json").notNull(),
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
  uniqueIndex("dm_document_semantic_revision_tenant_id_document_version_id_key").on(table.tenantId, table.documentVersionId, table.parseRunId, table.semanticRevision),
  foreignKey({
    columns: [table.documentVersionId, table.parseRunId, table.tenantId],
    foreignColumns: [dmDocumentParseRun.documentVersionId, dmDocumentParseRun.parseRunId, dmDocumentParseRun.tenantId],
    name: "dm_document_semantic_revision_tenant_id_document_version_i_fkey",
  }),
]);

