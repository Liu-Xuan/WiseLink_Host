/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, foreignKey, index, integer, pgTable, text, uniqueIndex, uuid, varchar, customType } from "drizzle-orm/pg-core"

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

export const actionAttempt = pgTable("action_attempt", {
  id: uuid("id").primaryKey().defaultRandom(),
  attemptId: varchar("attempt_id", { length: 96 }).notNull().unique(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  actionType: varchar("action_type", { length: 64 }).notNull(),
  attemptNo: integer("attempt_no").notNull().default(1),
  triggerRequestId: varchar("trigger_request_id", { length: 96 }).notNull(),
  requestOrigin: varchar("request_origin", { length: 32 }).notNull(),
  status: varchar("status", { length: 64 }).notNull().default('pending'),
  producerRunId: varchar("producer_run_id", { length: 96 }),
  packageArtifactRef: text("package_artifact_ref"),
  packageArtifactSha256: varchar("package_artifact_sha256", { length: 64 }),
  failureArtifactRef: text("failure_artifact_ref"),
  failureArtifactSha256: varchar("failure_artifact_sha256", { length: 64 }),
  errorCode: varchar("error_code", { length: 160 }),
  errorMessage: text("error_message"),
  actorUserId: varchar("actor_user_id", { length: 255 }).notNull(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  startedAt: customTimestamptz("started_at", { precision: 3 }),
  completedAt: customTimestamptz("completed_at", { precision: 3 }),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  priority: integer("priority").notNull().default(100),
  inputRevision: integer("input_revision"),
  baseRevision: integer("base_revision"),
  documentVersionId: varchar("document_version_id", { length: 96 }),
  taskEnvelopeJson: text("task_envelope_json"),
  taskInputHash: varchar("task_input_hash", { length: 64 }),
  resultEnvelopeJson: text("result_envelope_json"),
  resultContentHash: varchar("result_content_hash", { length: 64 }),
  idempotencyKey: varchar("idempotency_key", { length: 255 }),
  claimCount: integer("claim_count").notNull().default(0),
  retryCount: integer("retry_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  leaseOwner: varchar("lease_owner", { length: 160 }),
  leaseToken: varchar("lease_token", { length: 96 }),
  leaseGeneration: integer("lease_generation").notNull().default(0),
  leaseExpiresAt: customTimestamptz("lease_expires_at", { precision: 3 }),
  lastHeartbeatAt: customTimestamptz("last_heartbeat_at", { precision: 3 }),
  nextAttemptAt: customTimestamptz("next_attempt_at", { precision: 3 }),
  deadlineAt: customTimestamptz("deadline_at", { precision: 3 }),
  cancelRequestedAt: customTimestamptz("cancel_requested_at", { precision: 3 }),
  cancelReason: text("cancel_reason"),
  terminalReason: varchar("terminal_reason", { length: 160 }),
  projectionApplied: boolean("projection_applied").notNull().default(false),
  executorSessionKey: varchar("executor_session_key", { length: 512 }),
  operationRef: varchar("operation_ref", { length: 128 }),
  commitStartedAt: customTimestamptz("commit_started_at", { precision: 3 }),
  leaseSlot: integer("lease_slot"),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("uk_action_attempt_business_id").on(table.attemptId),
  uniqueIndex("uk_action_attempt_primary").on(table.workItemId, table.actionType, table.attemptNo),
  index("idx_action_attempt_status").on(table.status, table.updatedAt),
  index("idx_action_attempt_work_item").on(table.workItemId, table.attemptNo),
  uniqueIndex("uk_action_attempt_idempotency")
    .on(table.tenantId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL AND ${table.status} IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING')`),
  index("idx_action_attempt_due_queue").on(table.status, table.nextAttemptAt, table.priority, table.createdAt),
  index("idx_action_attempt_lease").on(table.status, table.leaseExpiresAt),
  uniqueIndex("uk_action_attempt_active_work_task")
    .on(table.workItemId, table.actionType)
    .where(sql`${table.status} IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING')`),
  uniqueIndex("uk_action_attempt_operation_ref")
    .on(table.operationRef)
    .where(sql`${table.operationRef} IS NOT NULL`),
  uniqueIndex("uk_action_attempt_lease_slot")
    .on(table.tenantId, table.requestOrigin, table.leaseSlot)
    .where(sql`${table.status} IN ('RUNNING', 'COMMITTING') AND ${table.leaseSlot} IS NOT NULL`),
  foreignKey({
    columns: [table.workItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_action_attempt_work_item",
  }),
]);

export const workItem = pgTable("work_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull().unique(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  actionType: varchar("action_type", { length: 64 }).notNull(),
  documentId: varchar("document_id", { length: 96 }).notNull(),
  documentVersionId: varchar("document_version_id", { length: 96 }).notNull(),
  sourceArtifactId: varchar("source_artifact_id", { length: 96 }).notNull(),
  sourceFileSha256: varchar("source_file_sha256", { length: 64 }).notNull(),
  sourceByteLength: bigint("source_byte_length", { mode: 'number' }).notNull(),
  normalizedFamily: varchar("normalized_family", { length: 64 }).notNull(),
  requestId: varchar("request_id", { length: 96 }).notNull(),
  status: varchar("status", { length: 64 }).notNull().default('reserved'),
  revision: integer("revision").notNull().default(0),
  projectionJson: text("projection_json"),
  packageId: text("package_id"),
  packageArtifactRef: text("package_artifact_ref"),
  packageArtifactSha256: varchar("package_artifact_sha256", { length: 64 }),
  failureCode: varchar("failure_code", { length: 160 }),
  failureArtifactRef: text("failure_artifact_ref"),
  failureArtifactSha256: varchar("failure_artifact_sha256", { length: 64 }),
  requestedByUserId: varchar("requested_by_user_id", { length: 255 }).notNull(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  runKey: varchar("run_key", { length: 96 }).notNull().default('canonical'),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("uk_work_item_business_id").on(table.workItemId),
  uniqueIndex("uk_work_item_document_parse").on(table.tenantId, table.actionType, table.documentVersionId, table.runKey),
  index("idx_work_item_status").on(table.status, table.updatedAt),
  index("idx_work_item_document").on(table.documentId, table.documentVersionId),
]);

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

export const externalSearchRun = pgTable("external_search_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  searchRunRef: varchar("search_run_ref", { length: 255 }).notNull(),
  sourceSystem: varchar("source_system", { length: 128 }).notNull(),
  query: text("query").notNull(),
  resultStatus: varchar("result_status", { length: 64 }).notNull(),
  failureCode: varchar("failure_code", { length: 96 }),
  observedAt: customTimestamptz("observed_at", { precision: 3 }).notNull(),
  accessRestricted: boolean("access_restricted").notNull().default(false),
  truncated: boolean("truncated").notNull().default(false),
  partialOnly: boolean("partial_only").notNull().default(false),
  recordedByUserId: varchar("recorded_by_user_id", { length: 255 }).notNull(),
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
  uniqueIndex("uk_external_search_run_tenant_ref").on(table.tenantId, table.searchRunRef),
  index("idx_external_search_run_observed").on(table.tenantId, table.observedAt),
  check("ck_external_search_run_status", sql`${table.resultStatus} IN ('ZERO_RESULTS_FOR_TARGET_IDENTIFIER', 'ACCESS_DENIED', 'PARTIAL_RESULTS', 'TRUNCATED', 'CANDIDATES_FOUND')`),
]);

export const externalDiscoveryCandidate = pgTable("external_discovery_candidate", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  searchRunRef: varchar("search_run_ref", { length: 255 }).notNull(),
  candidateRef: varchar("candidate_ref", { length: 255 }).notNull(),
  publisher: varchar("publisher", { length: 32 }).notNull(),
  title: text("title").notNull(),
  sourceUrl: text("source_url").notNull(),
  disposition: varchar("disposition", { length: 96 }).notNull(),
  reviewStatus: varchar("review_status", { length: 32 }).notNull().default('PENDING'),
  reviewDecision: varchar("review_decision", { length: 64 }),
  reviewedByUserId: varchar("reviewed_by_user_id", { length: 255 }),
  reviewedAt: customTimestamptz("reviewed_at", { precision: 3 }),
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
  uniqueIndex("uk_external_candidate_tenant_ref").on(table.tenantId, table.candidateRef),
  index("idx_external_candidate_run").on(table.tenantId, table.searchRunRef),
  index("idx_external_candidate_review").on(table.tenantId, table.reviewStatus, table.updatedAt),
  foreignKey({
    columns: [table.tenantId, table.searchRunRef],
    foreignColumns: [externalSearchRun.tenantId, externalSearchRun.searchRunRef],
    name: "fk_external_candidate_search_run",
  }),
  check("ck_external_candidate_publisher", sql`${table.publisher} IN ('AIRBUS', 'BOEING', 'COMAC')`),
  check("ck_external_candidate_review_status", sql`${table.reviewStatus} IN ('PENDING', 'HUMAN_SELECTED', 'REJECTED')`),
  check("ck_external_candidate_review_group", sql`(
    (${table.reviewStatus} = 'PENDING' AND ${table.reviewDecision} IS NULL AND ${table.reviewedByUserId} IS NULL AND ${table.reviewedAt} IS NULL)
    OR
    (${table.reviewStatus} = 'HUMAN_SELECTED' AND ${table.reviewDecision} = 'HUMAN_SELECTED_FOR_INGEST' AND ${table.reviewedByUserId} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)
    OR
    (${table.reviewStatus} = 'REJECTED' AND ${table.reviewDecision} = 'HUMAN_REJECTED' AND ${table.reviewedByUserId} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)
  )`),
]);

// table aliases
export const actionAttemptTable = actionAttempt;
export const dmAcquisitionTable = dmAcquisition;
export const dmCurrentnessDecisionTable = dmCurrentnessDecision;
export const dmDocumentTable = dmDocument;
export const dmDocumentVersionTable = dmDocumentVersion;
export const dmIngressPreflightTable = dmIngressPreflight;
export const dmPublicationFamilyTable = dmPublicationFamily;
export const dmSourceArtifactTable = dmSourceArtifact;
export const externalDiscoveryCandidateTable = externalDiscoveryCandidate;
export const externalSearchRunTable = externalSearchRun;
export const workItemTable = workItem;
