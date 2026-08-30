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

export const engineeringMatter = pgTable("engineering_matter", {
  id: uuid("id").primaryKey().defaultRandom(),
  matterId: varchar("matter_id", { length: 96 }).notNull().unique(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  title: text("title").notNull(),
  status: varchar("status", { length: 32 }).notNull().default('ACTIVE'),
  currentRevisionNo: integer("current_revision_no").notNull(),
  currentMatterRevisionId: varchar("current_matter_revision_id", { length: 96 }).notNull(),
  requestId: varchar("request_id", { length: 96 }).notNull(),
  createdByUserId: varchar("created_by_user_id", { length: 255 }).notNull(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uk_engineering_matter_business_id").on(table.matterId),
  uniqueIndex("uk_engineering_matter_tenant_identity").on(table.tenantId, table.matterId),
  uniqueIndex("uk_engineering_matter_create_request").on(table.tenantId, table.createdByUserId, table.requestId),
  index("idx_engineering_matter_owner").on(table.tenantId, table.createdByUserId, table.updatedAt),
  check("ck_engineering_matter_title", sql`length(btrim(${table.title})) BETWEEN 1 AND 240`),
  check("ck_engineering_matter_status", sql`${table.status} = 'ACTIVE'`),
  check("ck_engineering_matter_revision", sql`${table.currentRevisionNo} > 0`),
]);

export const engineeringMatterRevision = pgTable("engineering_matter_revision", {
  id: uuid("id").primaryKey().defaultRandom(),
  matterRevisionId: varchar("matter_revision_id", { length: 96 }).notNull().unique(),
  matterId: varchar("matter_id", { length: 96 }).notNull(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  revisionNo: integer("revision_no").notNull(),
  requestId: varchar("request_id", { length: 96 }).notNull(),
  changeKind: varchar("change_kind", { length: 32 }).notNull(),
  changeSummary: text("change_summary").notNull(),
  changedWorkItemId: varchar("changed_work_item_id", { length: 96 }).notNull(),
  createdByUserId: varchar("created_by_user_id", { length: 255 }).notNull(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uk_engineering_matter_revision_business_id").on(table.matterRevisionId),
  uniqueIndex("uk_engineering_matter_revision_scope").on(table.tenantId, table.matterId, table.matterRevisionId),
  uniqueIndex("uk_engineering_matter_revision_number").on(table.matterId, table.revisionNo),
  uniqueIndex("uk_engineering_matter_revision_request").on(table.matterId, table.requestId),
  index("idx_engineering_matter_revision_history").on(table.matterId, table.revisionNo),
  foreignKey({
    columns: [table.tenantId, table.matterId],
    foreignColumns: [engineeringMatter.tenantId, engineeringMatter.matterId],
    name: "fk_engineering_matter_revision_matter",
  }),
  foreignKey({
    columns: [table.changedWorkItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_engineering_matter_revision_changed_work_item",
  }),
  check("ck_engineering_matter_revision_number", sql`${table.revisionNo} > 0`),
  check("ck_engineering_matter_revision_kind", sql`${table.changeKind} IN ('CREATED', 'WORK_ITEM_LINKED')`),
  check("ck_engineering_matter_revision_summary", sql`length(btrim(${table.changeSummary})) BETWEEN 1 AND 1000`),
]);

export const engineeringMatterRevisionWorkItem = pgTable("engineering_matter_revision_work_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  matterRevisionId: varchar("matter_revision_id", { length: 96 }).notNull(),
  matterId: varchar("matter_id", { length: 96 }).notNull(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  ordinal: integer("ordinal").notNull(),
  relationRole: varchar("relation_role", { length: 32 }).notNull(),
  linkedAtWorkItemRevision: integer("linked_at_work_item_revision").notNull(),
}, (table) => [
  uniqueIndex("uk_engineering_matter_revision_work_item").on(table.matterRevisionId, table.workItemId),
  uniqueIndex("uk_engineering_matter_revision_ordinal").on(table.matterRevisionId, table.ordinal),
  index("idx_engineering_matter_work_item_lookup").on(table.workItemId, table.matterRevisionId),
  foreignKey({
    columns: [table.tenantId, table.matterId, table.matterRevisionId],
    foreignColumns: [engineeringMatterRevision.tenantId, engineeringMatterRevision.matterId, engineeringMatterRevision.matterRevisionId],
    name: "fk_engineering_matter_revision_work_item_revision",
  }),
  foreignKey({
    columns: [table.workItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_engineering_matter_revision_work_item_work_item",
  }),
  check("ck_engineering_matter_revision_work_item_ordinal", sql`${table.ordinal} > 0`),
  check("ck_engineering_matter_revision_work_item_role", sql`${table.relationRole} IN ('PRIMARY', 'RELATED')`),
  check("ck_engineering_matter_revision_work_item_revision", sql`${table.linkedAtWorkItemRevision} >= 0`),
]);

export const reviewConversation = pgTable("review_conversation", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewConversationId: varchar("review_conversation_id", { length: 96 }).notNull().unique(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  actorId: varchar("actor_id", { length: 255 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  openClawAgentId: varchar("openclaw_agent_id", { length: 96 }).notNull(),
  openClawSessionKey: varchar("openclaw_session_key", { length: 1024 }).notNull().unique(),
  startedAtRevision: integer("started_at_revision").notNull(),
  lastSyncedRevision: integer("last_synced_revision").notNull(),
  lastTurnNo: integer("last_turn_no").notNull().default(0),
  status: varchar("status", { length: 32 }).notNull().default('ACTIVE'),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  lastActiveAt: customTimestamptz("last_active_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  closedAt: customTimestamptz("closed_at", { precision: 3 }),
}, (table) => [
  uniqueIndex("uk_review_conversation_business_id").on(table.reviewConversationId),
  uniqueIndex("uk_review_conversation_openclaw_session").on(table.openClawSessionKey),
  uniqueIndex("uk_review_conversation_live")
    .on(table.tenantId, table.actorId, table.workItemId)
    .where(sql`${table.status} = 'ACTIVE'`),
  index("idx_review_conversation_work_item").on(table.workItemId, table.status, table.lastActiveAt),
  index("idx_review_conversation_actor").on(table.tenantId, table.actorId, table.status, table.lastActiveAt),
  foreignKey({
    columns: [table.workItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_review_conversation_work_item",
  }),
  check("ck_review_conversation_agent", sql`${table.openClawAgentId} = 'wiselink-engineering'`),
  check("ck_review_conversation_revisions", sql`${table.startedAtRevision} >= 0 AND ${table.lastSyncedRevision} >= ${table.startedAtRevision}`),
  check("ck_review_conversation_last_turn", sql`${table.lastTurnNo} >= 0`),
  check("ck_review_conversation_status", sql`${table.status} IN ('ACTIVE', 'CLOSED')`),
  check("ck_review_conversation_closed_state", sql`(
    (${table.status} = 'ACTIVE' AND ${table.closedAt} IS NULL)
    OR
    (${table.status} = 'CLOSED' AND ${table.closedAt} IS NOT NULL)
  )`),
]);

export const reviewTurn = pgTable("review_turn", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewTurnId: varchar("review_turn_id", { length: 96 }).notNull().unique(),
  reviewConversationId: varchar("review_conversation_id", { length: 96 }).notNull(),
  engineerSuppliedInputId: varchar("engineer_supplied_input_id", { length: 96 }).notNull().unique(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  actorId: varchar("actor_id", { length: 255 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  turnNo: integer("turn_no").notNull(),
  requestId: varchar("request_id", { length: 96 }).notNull(),
  inputRevision: integer("input_revision").notNull(),
  userMessage: text("user_message").notNull(),
  inputType: varchar("input_type", { length: 32 }).notNull(),
  adoptionStatus: varchar("adoption_status", { length: 32 }).notNull(),
  responseType: varchar("response_type", { length: 48 }),
  assistantResponse: text("assistant_response"),
  sourceRefsJson: text("source_refs_json"),
  missingInputsJson: text("missing_inputs_json"),
  candidateEvidenceRefsJson: text("candidate_evidence_refs_json"),
  reviewActionDraftJson: text("review_action_draft_json"),
  affectedItemIdsJson: text("affected_item_ids_json"),
  warningsJson: text("warnings_json"),
  resultProvenanceJson: text("result_provenance_json"),
  resultContentHash: varchar("result_content_hash", { length: 64 }),
  actionAttemptId: varchar("action_attempt_id", { length: 96 }),
  assistantCompletedAt: customTimestamptz("assistant_completed_at", { precision: 3 }),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uk_review_turn_business_id").on(table.reviewTurnId),
  uniqueIndex("uk_review_turn_engineer_input").on(table.engineerSuppliedInputId),
  uniqueIndex("uk_review_turn_request").on(table.reviewConversationId, table.requestId),
  uniqueIndex("uk_review_turn_number").on(table.reviewConversationId, table.turnNo),
  uniqueIndex("uk_review_turn_action_attempt").on(table.actionAttemptId),
  index("idx_review_turn_conversation").on(table.reviewConversationId, table.turnNo),
  index("idx_review_turn_work_item").on(table.workItemId, table.createdAt),
  foreignKey({
    columns: [table.reviewConversationId],
    foreignColumns: [reviewConversation.reviewConversationId],
    name: "fk_review_turn_conversation",
  }),
  foreignKey({
    columns: [table.engineerSuppliedInputId],
    foreignColumns: [engineerSuppliedInput.engineerSuppliedInputId],
    name: "fk_review_turn_engineer_input",
  }),
  foreignKey({
    columns: [table.workItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_review_turn_work_item",
  }),
  foreignKey({
    columns: [table.actionAttemptId],
    foreignColumns: [actionAttempt.attemptId],
    name: "fk_review_turn_action_attempt",
  }),
  check("ck_review_turn_number", sql`${table.turnNo} > 0`),
  check("ck_review_turn_revision", sql`${table.inputRevision} >= 0`),
  check("ck_review_turn_request", sql`length(btrim(${table.requestId})) > 0`),
  check("ck_review_turn_message", sql`length(btrim(${table.userMessage})) > 0`),
  check("ck_review_turn_input_type", sql`${table.inputType} = 'ENGINEER_TEXT'`),
  check("ck_review_turn_adoption_status", sql`${table.adoptionStatus} = 'CANDIDATE_UNADOPTED'`),
  check("ck_review_turn_c2_candidate_state", sql`(
    (
      ${table.responseType} IS NULL
      AND ${table.assistantResponse} IS NULL
      AND ${table.sourceRefsJson} IS NULL
      AND ${table.missingInputsJson} IS NULL
      AND ${table.candidateEvidenceRefsJson} IS NULL
      AND ${table.reviewActionDraftJson} IS NULL
      AND ${table.affectedItemIdsJson} IS NULL
      AND ${table.warningsJson} IS NULL
      AND ${table.resultProvenanceJson} IS NULL
      AND ${table.resultContentHash} IS NULL
      AND ${table.actionAttemptId} IS NULL
      AND ${table.assistantCompletedAt} IS NULL
    )
    OR
    (
      ${table.responseType} IN (
        'ANSWER', 'CLARIFYING_QUESTION', 'SOURCE_LINK',
        'CANDIDATE_EVIDENCE', 'REVIEW_ACTION_DRAFT', 'INPUT_REQUEST',
        'AFFECTED_ITEMS_PREVIEW', 'RESYNTHESIS_RESULT', 'TASK_STATUS'
      )
      AND length(btrim(${table.assistantResponse})) > 0
      AND ${table.sourceRefsJson} IS NOT NULL
      AND ${table.missingInputsJson} IS NOT NULL
      AND ${table.candidateEvidenceRefsJson} IS NOT NULL
      AND ${table.reviewActionDraftJson} IS NOT NULL
      AND ${table.affectedItemIdsJson} IS NOT NULL
      AND ${table.warningsJson} IS NOT NULL
      AND ${table.resultProvenanceJson} IS NOT NULL
      AND ${table.resultContentHash} ~ '^[0-9a-f]{64}$'
      AND length(btrim(${table.actionAttemptId})) > 0
      AND ${table.assistantCompletedAt} IS NOT NULL
    )
  )`),
]);

export const engineerSuppliedInput = pgTable("engineer_supplied_input", {
  id: uuid("id").primaryKey().defaultRandom(),
  engineerSuppliedInputId: varchar("engineer_supplied_input_id", { length: 96 }).notNull().unique(),
  reviewConversationId: varchar("review_conversation_id", { length: 96 }).notNull(),
  reviewTurnId: varchar("review_turn_id", { length: 96 }).notNull().unique(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  actorId: varchar("actor_id", { length: 255 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  requestId: varchar("request_id", { length: 96 }).notNull(),
  inputRevision: integer("input_revision").notNull(),
  inputType: varchar("input_type", { length: 32 }).notNull(),
  adoptionStatus: varchar("adoption_status", { length: 32 }).notNull(),
  candidateText: text("candidate_text").notNull(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uk_engineer_supplied_input_business_id").on(table.engineerSuppliedInputId),
  uniqueIndex("uk_engineer_supplied_input_turn").on(table.reviewTurnId),
  uniqueIndex("uk_engineer_supplied_input_request").on(table.reviewConversationId, table.requestId),
  index("idx_engineer_supplied_input_conversation").on(table.reviewConversationId, table.createdAt),
  index("idx_engineer_supplied_input_work_item").on(table.workItemId, table.createdAt),
  foreignKey({
    columns: [table.reviewConversationId],
    foreignColumns: [reviewConversation.reviewConversationId],
    name: "fk_engineer_supplied_input_conversation",
  }),
  foreignKey({
    columns: [table.reviewTurnId],
    foreignColumns: [reviewTurn.reviewTurnId],
    name: "fk_engineer_supplied_input_turn",
  }),
  foreignKey({
    columns: [table.workItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_engineer_supplied_input_work_item",
  }),
  check("ck_engineer_supplied_input_revision", sql`${table.inputRevision} >= 0`),
  check("ck_engineer_supplied_input_type", sql`${table.inputType} = 'ENGINEER_TEXT'`),
  check("ck_engineer_supplied_input_adoption_status", sql`${table.adoptionStatus} = 'CANDIDATE_UNADOPTED'`),
  check("ck_engineer_supplied_input_text", sql`length(btrim(${table.candidateText})) > 0`),
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

export const canonicalFleetSourceSnapshot = pgTable("canonical_fleet_source_snapshot", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  sourceSnapshotId: varchar("source_snapshot_id", { length: 96 }).notNull(),
  sourceKind: varchar("source_kind", { length: 96 }).notNull(),
  logicalSourceKey: varchar("logical_source_key", { length: 160 }).notNull(),
  sourceRevisionKey: varchar("source_revision_key", { length: 255 }).notNull(),
  sourceContentHash: varchar("source_content_hash", { length: 71 }).notNull(),
  sourceAsOf: varchar("source_as_of", { length: 10 }).notNull(),
  snapshotAsOf: customTimestamptz("snapshot_as_of", { precision: 3 }).notNull(),
  fleetSnapshotDigest: varchar("fleet_snapshot_digest", { length: 64 }).notNull(),
  upstreamLineageJson: text("upstream_lineage_json").notNull(),
  aircraftAssetCount: integer("aircraft_asset_count").notNull(),
  identityAliasCount: integer("identity_alias_count").notNull(),
  configurationFactCount: integer("configuration_fact_count").notNull().default(0),
  importedByActorId: varchar("imported_by_actor_id", { length: 255 }).notNull(),
  importedAt: customTimestamptz("imported_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uk_canonical_fleet_source_snapshot").on(table.tenantId, table.sourceSnapshotId),
  check("ck_canonical_fleet_source_content_hash", sql`${table.sourceContentHash} ~ '^sha256:[0-9a-f]{64}$'`),
  check("ck_canonical_fleet_snapshot_digest", sql`${table.fleetSnapshotDigest} ~ '^[0-9a-f]{64}$'`),
  check("ck_canonical_fleet_source_as_of", sql`${table.sourceAsOf} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  check("ck_canonical_fleet_source_counts", sql`${table.aircraftAssetCount} > 0 AND ${table.identityAliasCount} >= 0 AND ${table.configurationFactCount} >= 0`),
]);

export const canonicalFleetScopeHead = pgTable("canonical_fleet_scope_head", {
  tenantId: varchar("tenant_id", { length: 128 }).primaryKey(),
  currentSourceSnapshotId: varchar("current_source_snapshot_id", { length: 96 }).notNull(),
  authorityRevision: integer("authority_revision").notNull(),
  updatedAt: customTimestamptz("updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  foreignKey({
    columns: [table.tenantId, table.currentSourceSnapshotId],
    foreignColumns: [canonicalFleetSourceSnapshot.tenantId, canonicalFleetSourceSnapshot.sourceSnapshotId],
    name: "fk_canonical_fleet_scope_head_snapshot",
  }),
  check("ck_canonical_fleet_authority_revision", sql`${table.authorityRevision} > 0`),
]);

export const canonicalFleetAssetVersion = pgTable("canonical_fleet_asset_version", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  sourceSnapshotId: varchar("source_snapshot_id", { length: 96 }).notNull(),
  assetId: varchar("asset_id", { length: 96 }).notNull(),
  assetVersionId: varchar("asset_version_id", { length: 96 }).notNull(),
  aircraftNumber: varchar("aircraft_number", { length: 64 }).notNull(),
  fleetFamily: varchar("fleet_family", { length: 64 }),
  aircraftModel: varchar("aircraft_model", { length: 64 }),
  series: varchar("series", { length: 64 }),
  msn: varchar("msn", { length: 64 }),
  lineNumber: integer("line_number"),
  deliveryDate: varchar("delivery_date", { length: 10 }),
  validFrom: customTimestamptz("valid_from", { precision: 3 }).notNull(),
  validTo: customTimestamptz("valid_to", { precision: 3 }),
  status: varchar("status", { length: 32 }).notNull(),
  sourceRecordId: varchar("source_record_id", { length: 128 }).notNull(),
  recordHash: varchar("record_hash", { length: 71 }).notNull(),
  sourceRecordHash: varchar("source_record_hash", { length: 71 }).notNull(),
}, (table) => [
  uniqueIndex("uk_canonical_fleet_asset_version").on(table.tenantId, table.assetVersionId),
  uniqueIndex("uk_canonical_fleet_asset_snapshot").on(table.tenantId, table.sourceSnapshotId, table.assetId),
  index("idx_canonical_fleet_asset_identifier").on(table.tenantId, table.sourceSnapshotId, table.aircraftNumber),
  foreignKey({
    columns: [table.tenantId, table.sourceSnapshotId],
    foreignColumns: [canonicalFleetSourceSnapshot.tenantId, canonicalFleetSourceSnapshot.sourceSnapshotId],
    name: "fk_canonical_fleet_asset_snapshot",
  }),
  check("ck_canonical_fleet_asset_status", sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
  check("ck_canonical_fleet_asset_record_hash", sql`${table.recordHash} ~ '^sha256:[0-9a-f]{64}$'`),
  check("ck_canonical_fleet_asset_source_record_hash", sql`${table.sourceRecordHash} ~ '^sha256:[0-9a-f]{64}$'`),
  check("ck_canonical_fleet_asset_delivery_date", sql`${table.deliveryDate} IS NULL OR ${table.deliveryDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  check("ck_canonical_fleet_asset_validity", sql`${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`),
]);

export const canonicalFleetAliasVersion = pgTable("canonical_fleet_alias_version", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  sourceSnapshotId: varchar("source_snapshot_id", { length: 96 }).notNull(),
  aliasVersionId: varchar("alias_version_id", { length: 96 }).notNull(),
  aliasId: varchar("alias_id", { length: 96 }).notNull(),
  assetId: varchar("asset_id", { length: 96 }).notNull(),
  aliasType: varchar("alias_type", { length: 64 }).notNull(),
  aliasValue: varchar("alias_value", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  recordHash: varchar("record_hash", { length: 71 }).notNull(),
}, (table) => [
  uniqueIndex("uk_canonical_fleet_alias_version").on(table.tenantId, table.aliasVersionId),
  uniqueIndex("uk_canonical_fleet_alias_snapshot").on(table.tenantId, table.sourceSnapshotId, table.aliasId),
  index("idx_canonical_fleet_alias_identifier").on(table.tenantId, table.sourceSnapshotId, table.aliasValue),
  foreignKey({
    columns: [table.tenantId, table.sourceSnapshotId, table.assetId],
    foreignColumns: [canonicalFleetAssetVersion.tenantId, canonicalFleetAssetVersion.sourceSnapshotId, canonicalFleetAssetVersion.assetId],
    name: "fk_canonical_fleet_alias_asset",
  }),
  check("ck_canonical_fleet_alias_status", sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
  check("ck_canonical_fleet_alias_record_hash", sql`${table.recordHash} ~ '^sha256:[0-9a-f]{64}$'`),
]);

export const canonicalFleetConfigurationFactVersion = pgTable("canonical_fleet_configuration_fact_version", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  sourceSnapshotId: varchar("source_snapshot_id", { length: 96 }).notNull(),
  factId: varchar("fact_id", { length: 96 }).notNull(),
  factVersionId: varchar("fact_version_id", { length: 96 }).notNull(),
  assetId: varchar("asset_id", { length: 96 }).notNull(),
  factType: varchar("fact_type", { length: 64 }).notNull(),
  property: varchar("property", { length: 96 }).notNull(),
  qualifier: varchar("qualifier", { length: 255 }),
  valueJson: text("value_json").notNull(),
  validAsOf: varchar("valid_as_of", { length: 10 }),
  status: varchar("status", { length: 32 }).notNull(),
  sourceRecordId: varchar("source_record_id", { length: 128 }).notNull(),
  recordHash: varchar("record_hash", { length: 71 }).notNull(),
}, (table) => [
  uniqueIndex("uk_canonical_fleet_fact_version").on(table.tenantId, table.factVersionId),
  uniqueIndex("uk_canonical_fleet_fact_snapshot").on(table.tenantId, table.sourceSnapshotId, table.factId),
  index("idx_canonical_fleet_fact_lookup").on(table.tenantId, table.sourceSnapshotId, table.assetId, table.property, table.qualifier),
  foreignKey({
    columns: [table.tenantId, table.sourceSnapshotId, table.assetId],
    foreignColumns: [canonicalFleetAssetVersion.tenantId, canonicalFleetAssetVersion.sourceSnapshotId, canonicalFleetAssetVersion.assetId],
    name: "fk_canonical_fleet_fact_asset",
  }),
  check("ck_canonical_fleet_fact_type", sql`${table.factType} IN ('fleet_configuration', 'sb_incorporation', 'data_quality_issue')`),
  check("ck_canonical_fleet_fact_status", sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
  check("ck_canonical_fleet_fact_valid_as_of", sql`${table.validAsOf} IS NULL OR ${table.validAsOf} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  check("ck_canonical_fleet_fact_record_hash", sql`${table.recordHash} ~ '^sha256:[0-9a-f]{64}$'`),
]);

export const canonicalRuleSetSnapshot = pgTable("canonical_rule_set_snapshot", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  ruleSetKey: varchar("rule_set_key", { length: 64 }).notNull(),
  criterionSetId: varchar("criterion_set_id", { length: 96 }).notNull(),
  criterionSetHash: varchar("criterion_set_hash", { length: 71 }).notNull(),
  memberIdentityHash: varchar("member_identity_hash", { length: 71 }).notNull(),
  criteriaCount: integer("criteria_count").notNull(),
  rulePackVersion: varchar("rule_pack_version", { length: 96 }).notNull(),
  rulePackJson: text("rule_pack_json").notNull(),
  artifactRef: text("artifact_ref").notNull(),
  artifactDigest: varchar("artifact_digest", { length: 71 }).notNull(),
  artifactVersion: varchar("artifact_version", { length: 255 }).notNull(),
  canonicalCriteriaHash: varchar("canonical_criteria_hash", { length: 71 }).notNull(),
  sourceJobAidDocumentVersionId: varchar("source_job_aid_document_version_id", { length: 96 }),
  sourceJobAidVersionStatus: varchar("source_job_aid_version_status", { length: 32 }).notNull(),
  createdByEngineeringOwnerUserId: varchar("created_by_engineering_owner_user_id", { length: 255 }).notNull(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uk_canonical_rule_set_snapshot").on(table.tenantId, table.ruleSetKey, table.criterionSetId),
  index("idx_canonical_rule_set_snapshot_created").on(table.tenantId, table.ruleSetKey, table.createdAt),
  check("ck_canonical_rule_set_key", sql`${table.ruleSetKey} = 'JOB_AID'`),
  check("ck_canonical_rule_set_criterion_hash", sql`${table.criterionSetHash} ~ '^sha256:[0-9a-f]{64}$'`),
  check("ck_canonical_rule_set_member_hash", sql`${table.memberIdentityHash} ~ '^sha256:[0-9a-f]{64}$'`),
  check("ck_canonical_rule_set_artifact_digest", sql`${table.artifactDigest} ~ '^sha256:[0-9a-f]{64}$'`),
  check("ck_canonical_rule_set_criteria_hash", sql`${table.canonicalCriteriaHash} ~ '^sha256:[0-9a-f]{64}$'`),
  check("ck_canonical_rule_set_criteria_count", sql`${table.criteriaCount} > 0`),
  check("ck_canonical_rule_set_source_status", sql`${table.sourceJobAidVersionStatus} IN ('CONFIRMED', 'VERSION_UNCONFIRMED')`),
  check("ck_canonical_rule_set_source_version", sql`(
    (${table.sourceJobAidVersionStatus} = 'CONFIRMED' AND ${table.sourceJobAidDocumentVersionId} IS NOT NULL)
    OR
    (${table.sourceJobAidVersionStatus} = 'VERSION_UNCONFIRMED' AND ${table.sourceJobAidDocumentVersionId} IS NULL)
  )`),
  check("ck_canonical_rule_set_payload", sql`length(${table.rulePackJson}) > 0`),
]);

export const canonicalRuleSetActivation = pgTable("canonical_rule_set_activation", {
  activationId: uuid("activation_id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  ruleSetKey: varchar("rule_set_key", { length: 64 }).notNull(),
  activationRevision: integer("activation_revision").notNull(),
  expectedRevision: integer("expected_revision").notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  fromCriterionSetId: varchar("from_criterion_set_id", { length: 96 }),
  activeCriterionSetId: varchar("active_criterion_set_id", { length: 96 }).notNull(),
  engineeringOwnerUserId: varchar("engineering_owner_user_id", { length: 255 }).notNull(),
  requiredRoleId: varchar("required_role_id", { length: 96 }).notNull(),
  reason: text("reason").notNull(),
  activatedAt: customTimestamptz("activated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uk_canonical_rule_set_activation_revision").on(table.tenantId, table.ruleSetKey, table.activationRevision),
  index("idx_canonical_rule_set_activation_target").on(table.tenantId, table.ruleSetKey, table.activeCriterionSetId, table.activationRevision),
  foreignKey({
    columns: [table.tenantId, table.ruleSetKey, table.activeCriterionSetId],
    foreignColumns: [canonicalRuleSetSnapshot.tenantId, canonicalRuleSetSnapshot.ruleSetKey, canonicalRuleSetSnapshot.criterionSetId],
    name: "fk_canonical_rule_set_activation_target",
  }),
  foreignKey({
    columns: [table.tenantId, table.ruleSetKey, table.fromCriterionSetId],
    foreignColumns: [canonicalRuleSetSnapshot.tenantId, canonicalRuleSetSnapshot.ruleSetKey, canonicalRuleSetSnapshot.criterionSetId],
    name: "fk_canonical_rule_set_activation_previous",
  }),
  check("ck_canonical_rule_set_activation_key", sql`${table.ruleSetKey} = 'JOB_AID'`),
  check("ck_canonical_rule_set_activation_revision", sql`${table.expectedRevision} >= 0 AND ${table.activationRevision} = ${table.expectedRevision} + 1`),
  check("ck_canonical_rule_set_activation_action", sql`${table.action} IN ('PROMOTE', 'ROLLBACK')`),
  check("ck_canonical_rule_set_activation_change", sql`${table.fromCriterionSetId} IS NULL OR ${table.fromCriterionSetId} <> ${table.activeCriterionSetId}`),
  check("ck_canonical_rule_set_activation_reason", sql`length(btrim(${table.reason})) > 0`),
]);

/** Host-owned Feishu OAuth subject -> canonical Miaoda subject mapping. */
export const identitySubjectMapping = pgTable("identity_subject_mapping", {
  id: uuid("id").primaryKey().defaultRandom(),
  feishuOpenId: varchar("feishu_open_id", { length: 255 }).notNull(),
  feishuTenantKey: varchar("feishu_tenant_key", { length: 255 }).notNull(),
  feishuUserId: varchar("feishu_user_id", { length: 255 }),
  miaodaUserId: varchar("miaoda_user_id", { length: 255 }).notNull(),
  miaodaTenantId: varchar("miaoda_tenant_id", { length: 128 }).notNull(),
  expectedClientId: varchar("expected_client_id", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default('ACTIVE'),
  revision: integer("revision").notNull().default(1),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("uk_identity_subject_feishu_app").on(table.feishuTenantKey, table.feishuOpenId, table.expectedClientId),
  uniqueIndex("uk_identity_subject_active_miaoda_app")
    .on(table.miaodaUserId, table.expectedClientId)
    .where(sql`${table.status} = 'ACTIVE'`),
  index("idx_identity_subject_miaoda").on(table.miaodaTenantId, table.miaodaUserId),
  check("ck_identity_subject_status", sql`${table.status} IN ('ACTIVE', 'REVOKED')`),
  check("ck_identity_subject_revision", sql`${table.revision} > 0`),
]);

/** One-time server-side OAuth state and PKCE verifier. Raw state is never stored. */
export const identityOauthState = pgTable("identity_oauth_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  stateHash: varchar("state_hash", { length: 64 }).notNull(),
  codeVerifier: varchar("code_verifier", { length: 128 }).notNull(),
  expiresAt: customTimestamptz("expires_at", { precision: 3 }).notNull(),
  consumedAt: customTimestamptz("consumed_at", { precision: 3 }),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("uk_identity_oauth_state_hash").on(table.stateHash),
  index("idx_identity_oauth_state_expiry").on(table.expiresAt),
]);

/** Persistent opaque browser session. Only a SHA-256 token digest is stored. */
export const identitySession = pgTable("identity_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionTokenHash: varchar("session_token_hash", { length: 64 }).notNull(),
  subjectMappingId: uuid("subject_mapping_id").notNull(),
  feishuUserId: varchar("feishu_user_id", { length: 255 }),
  revision: integer("revision").notNull().default(1),
  expiresAt: customTimestamptz("expires_at", { precision: 3 }).notNull(),
  revokedAt: customTimestamptz("revoked_at", { precision: 3 }),
  lastSeenAt: customTimestamptz("last_seen_at", { precision: 3 }).notNull(),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("uk_identity_session_token_hash").on(table.sessionTokenHash),
  index("idx_identity_session_subject").on(table.subjectMappingId, table.expiresAt),
  check("ck_identity_session_revision", sql`${table.revision} > 0`),
  foreignKey({
    columns: [table.subjectMappingId],
    foreignColumns: [identitySubjectMapping.id],
    name: "fk_identity_session_subject_mapping",
  }),
]);

// table aliases
export const actionAttemptTable = actionAttempt;
export const canonicalFleetAliasVersionTable = canonicalFleetAliasVersion;
export const canonicalFleetAssetVersionTable = canonicalFleetAssetVersion;
export const canonicalFleetConfigurationFactVersionTable = canonicalFleetConfigurationFactVersion;
export const canonicalFleetScopeHeadTable = canonicalFleetScopeHead;
export const canonicalFleetSourceSnapshotTable = canonicalFleetSourceSnapshot;
export const canonicalRuleSetActivationTable = canonicalRuleSetActivation;
export const canonicalRuleSetSnapshotTable = canonicalRuleSetSnapshot;
export const dmAcquisitionTable = dmAcquisition;
export const dmCurrentnessDecisionTable = dmCurrentnessDecision;
export const dmDocumentTable = dmDocument;
export const dmDocumentVersionTable = dmDocumentVersion;
export const dmIngressPreflightTable = dmIngressPreflight;
export const dmPublicationFamilyTable = dmPublicationFamily;
export const dmSourceArtifactTable = dmSourceArtifact;
export const engineeringMatterTable = engineeringMatter;
export const engineeringMatterRevisionTable = engineeringMatterRevision;
export const engineeringMatterRevisionWorkItemTable = engineeringMatterRevisionWorkItem;
export const externalDiscoveryCandidateTable = externalDiscoveryCandidate;
export const externalSearchRunTable = externalSearchRun;
export const identityOauthStateTable = identityOauthState;
export const identitySessionTable = identitySession;
export const identitySubjectMappingTable = identitySubjectMapping;
export const engineerSuppliedInputTable = engineerSuppliedInput;
export const reviewConversationTable = reviewConversation;
export const reviewTurnTable = reviewTurn;
export const workItemTable = workItem;
