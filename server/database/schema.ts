/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, pgTable, text, uniqueIndex, uuid, varchar, customType } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const dmCurrentnessDecision = pgTable("dm_currentness_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  currentnessDecisionId: varchar("currentness_decision_id", { length: 96 }).notNull().unique(),
  familyId: varchar("family_id", { length: 96 }).notNull(),
  previousDocumentVersionId: varchar("previous_document_version_id", { length: 96 }),
  nextDocumentVersionId: varchar("next_document_version_id", { length: 96 }).notNull(),
  previousGeneration: integer("previous_generation").notNull(),
  nextGeneration: integer("next_generation").notNull(),
  reason: varchar("reason", { length: 96 }).notNull(),
  decidedAt: customTimestamptz("decided_at", { precision: 3 }).notNull(),
  decidedBy: varchar("decided_by", { length: 255 }).notNull(),
  preflightId: varchar("preflight_id", { length: 96 }).notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("uk_dm_currentness_decision_business_id").on(table.currentnessDecisionId),
  uniqueIndex("uk_dm_currentness_decision_generation").on(table.familyId, table.nextGeneration),
  index("idx_dm_currentness_decision_next_version").on(table.nextDocumentVersionId),
]);

export const dmIngressPreflight = pgTable("dm_ingress_preflight", {
  id: uuid("id").primaryKey().defaultRandom(),
  preflightId: varchar("preflight_id", { length: 96 }).notNull().unique(),
  acquisitionId: varchar("acquisition_id", { length: 96 }).notNull(),
  decision: varchar("decision", { length: 96 }).notNull(),
  branch: varchar("branch", { length: 64 }).notNull(),
  executionAuthorized: boolean("execution_authorized").notNull().default(false),
  observedCurrentGeneration: integer("observed_current_generation").notNull(),
  observedCurrentDocumentVersionId: varchar("observed_current_document_version_id", { length: 96 }),
  normalizedDescriptorJson: text("normalized_descriptor_json").notNull(),
  decisionPayloadJson: text("decision_payload_json").notNull(),
  status: varchar("status", { length: 64 }).notNull(),
  documentVersionId: varchar("document_version_id", { length: 96 }),
  commitIdempotencyKey: varchar("commit_idempotency_key", { length: 255 }).unique(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull(),
  committedAt: customTimestamptz("committed_at", { precision: 3 }),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("uk_dm_ingress_preflight_business_id").on(table.preflightId),
  uniqueIndex("uk_dm_ingress_preflight_commit_key").on(table.commitIdempotencyKey),
  index("idx_dm_ingress_preflight_acquisition").on(table.acquisitionId),
]);

export const dmDocumentVersion = pgTable("dm_document_version", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentVersionId: varchar("document_version_id", { length: 96 }).notNull().unique(),
  documentId: varchar("document_id", { length: 96 }).notNull(),
  familyId: varchar("family_id", { length: 96 }).notNull(),
  revisionId: varchar("revision_id", { length: 96 }).notNull(),
  canonicalRevisionIdentity: varchar("canonical_revision_identity", { length: 255 }).notNull(),
  businessRevision: varchar("business_revision", { length: 96 }).notNull(),
  revisionDate: varchar("revision_date", { length: 16 }).notNull(),
  sourceGeneratedDate: varchar("source_generated_date", { length: 16 }).notNull(),
  originalFilename: text("original_filename").notNull(),
  sourceArtifactId: varchar("source_artifact_id", { length: 96 }).notNull(),
  acquisitionId: varchar("acquisition_id", { length: 96 }).notNull(),
  pdfSha256: varchar("pdf_sha256", { length: 64 }).notNull(),
  byteLength: bigint("byte_length", { mode: 'number' }).notNull(),
  mediaType: varchar("media_type", { length: 160 }).notNull(),
  lifecycleStatus: varchar("lifecycle_status", { length: 64 }).notNull(),
  committedAt: customTimestamptz("committed_at", { precision: 3 }).notNull(),
  committedBy: varchar("committed_by", { length: 255 }).notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("uk_dm_document_version_business_id").on(table.documentVersionId),
  uniqueIndex("uk_dm_document_version_revision").on(table.familyId, table.canonicalRevisionIdentity),
  index("idx_dm_document_version_content").on(table.pdfSha256, table.byteLength),
  index("idx_dm_document_version_acquisition").on(table.acquisitionId),
]);

export const dmDocument = pgTable("dm_document", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: varchar("document_id", { length: 96 }).notNull().unique(),
  familyId: varchar("family_id", { length: 96 }).notNull().unique(),
  documentFamily: varchar("document_family", { length: 32 }).notNull(),
  status: varchar("status", { length: 64 }).notNull(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull(),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("uk_dm_document_business_id").on(table.documentId),
  uniqueIndex("uk_dm_document_family").on(table.familyId),
]);

export const dmPublicationFamily = pgTable("dm_publication_family", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: varchar("family_id", { length: 96 }).notNull().unique(),
  canonicalIdentityKey: varchar("canonical_identity_key", { length: 512 }).notNull().unique(),
  documentFamily: varchar("document_family", { length: 32 }).notNull(),
  issuerAuthority: varchar("issuer_authority", { length: 255 }).notNull(),
  canonicalDocumentNumber: varchar("canonical_document_number", { length: 255 }).notNull(),
  currentDocumentVersionId: varchar("current_document_version_id", { length: 96 }),
  currentGeneration: integer("current_generation").notNull().default(0),
  status: varchar("status", { length: 64 }).notNull(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull(),
  updatedAt: customTimestamptz("updated_at", { precision: 3 }).notNull(),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("uk_dm_publication_family_business_id").on(table.familyId),
  uniqueIndex("uk_dm_publication_family_identity").on(table.canonicalIdentityKey),
  index("idx_dm_publication_family_current").on(table.currentDocumentVersionId),
]);

export const dmAcquisition = pgTable("dm_acquisition", {
  id: uuid("id").primaryKey().defaultRandom(),
  acquisitionId: varchar("acquisition_id", { length: 96 }).notNull().unique(),
  sourceArtifactId: varchar("source_artifact_id", { length: 96 }).notNull(),
  documentVersionId: varchar("document_version_id", { length: 96 }),
  sourceChannel: varchar("source_channel", { length: 96 }).notNull(),
  sourceRef: text("source_ref").notNull(),
  selectionBucketId: varchar("selection_bucket_id", { length: 255 }).notNull(),
  selectionFilePath: text("selection_file_path").notNull(),
  providerObjectId: varchar("provider_object_id", { length: 255 }).notNull(),
  providerVersionId: varchar("provider_version_id", { length: 255 }).notNull(),
  acquiredBy: varchar("acquired_by", { length: 255 }).notNull(),
  acquiredAt: customTimestamptz("acquired_at", { precision: 3 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
  sourceDescriptorJson: text("source_descriptor_json").notNull(),
  status: varchar("status", { length: 96 }).notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("uk_dm_acquisition_business_id").on(table.acquisitionId),
  uniqueIndex("uk_dm_acquisition_idempotency").on(table.idempotencyKey),
  index("idx_dm_acquisition_source_artifact").on(table.sourceArtifactId),
  index("idx_dm_acquisition_document_version").on(table.documentVersionId),
]);

export const dmSourceArtifact = pgTable("dm_source_artifact", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceArtifactId: varchar("source_artifact_id", { length: 96 }).notNull().unique(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  byteLength: bigint("byte_length", { mode: 'number' }).notNull(),
  mediaType: varchar("media_type", { length: 160 }).notNull(),
  bucketId: varchar("bucket_id", { length: 255 }).notNull(),
  filePath: text("file_path").notNull(),
  providerObjectId: varchar("provider_object_id", { length: 255 }).notNull(),
  providerVersionId: varchar("provider_version_id", { length: 255 }).notNull(),
  readbackVerified: boolean("readback_verified").notNull(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull(),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("uk_dm_source_artifact_business_id").on(table.sourceArtifactId),
  uniqueIndex("uk_dm_source_artifact_content").on(table.sha256, table.byteLength),
  uniqueIndex("uk_dm_source_artifact_locator").on(table.bucketId, table.filePath),
]);

// table aliases
export const dmAcquisitionTable = dmAcquisition;
export const dmCurrentnessDecisionTable = dmCurrentnessDecision;
export const dmDocumentTable = dmDocument;
export const dmDocumentVersionTable = dmDocumentVersion;
export const dmIngressPreflightTable = dmIngressPreflight;
export const dmPublicationFamilyTable = dmPublicationFamily;
export const dmSourceArtifactTable = dmSourceArtifact;
