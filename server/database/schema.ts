/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { bigint, boolean, foreignKey, index, integer, pgTable, text, uniqueIndex, uuid, varchar, customType } from "drizzle-orm/pg-core"

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

export const configurationEvidenceQueryAttempt = pgTable("configuration_evidence_query_attempt", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  queryAttemptRef: varchar("query_attempt_ref", { length: 160 }).notNull(),
  candidateEvidenceRef: varchar("candidate_evidence_ref", { length: 160 }).notNull(),
  requestId: varchar("request_id", { length: 96 }).notNull(),
  inputRevision: integer("input_revision").notNull(),
  roundNo: integer("round_no").notNull(),
  queryCount: integer("query_count").notNull(),
  queryFingerprint: varchar("query_fingerprint", { length: 64 }).notNull(),
  requestJson: text("request_json").notNull(),
  projectionsJson: text("projections_json"),
  candidateSnapshotJson: text("candidate_snapshot_json"),
  terminalStatus: varchar("terminal_status", { length: 32 }).notNull(),
  sourceRecordCount: integer("source_record_count").notNull().default(0),
  adoptionStatus: varchar("adoption_status", { length: 32 }).notNull().default('CANDIDATE_UNADOPTED'),
  adoptedSnapshotId: varchar("adopted_snapshot_id", { length: 160 }),
  adoptedWorkItemRevision: integer("adopted_work_item_revision"),
  recordedByActorId: varchar("recorded_by_actor_id", { length: 255 }).notNull(),
  startedAt: customTimestamptz("started_at", { precision: 3 }).notNull(),
  deadlineAt: customTimestamptz("deadline_at", { precision: 3 }).notNull(),
  completedAt: customTimestamptz("completed_at", { precision: 3 }),
  adoptedAt: customTimestamptz("adopted_at", { precision: 3 }),
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
  uniqueIndex("uk_configuration_evidence_query_attempt").on(table.tenantId, table.workItemId, table.queryAttemptRef),
  uniqueIndex("uk_configuration_evidence_candidate").on(table.tenantId, table.workItemId, table.candidateEvidenceRef),
  uniqueIndex("uk_configuration_evidence_query_request").on(table.tenantId, table.workItemId, table.requestId),
  uniqueIndex("uk_configuration_evidence_query_fingerprint").on(table.tenantId, table.workItemId, table.inputRevision, table.queryFingerprint),
  uniqueIndex("uk_configuration_evidence_query_running").on(table.tenantId, table.workItemId),
  index("idx_configuration_evidence_query_cycle").on(table.tenantId, table.workItemId, table.inputRevision, table.roundNo),
  index("idx_configuration_evidence_query_candidate").on(table.tenantId, table.workItemId, table.candidateEvidenceRef),
  foreignKey({
    columns: [table.workItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_configuration_evidence_query_work_item",
  }),
]);

export const configurationEvidenceWorkItemHead = pgTable("configuration_evidence_work_item_head", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  currentSnapshotId: varchar("current_snapshot_id", { length: 160 }).notNull(),
  configurationRevision: integer("configuration_revision").notNull(),
  updatedByActorId: varchar("updated_by_actor_id", { length: 255 }).notNull(),
  updatedAt: customTimestamptz("updated_at", { precision: 3 }).notNull(),
}, (table) => [
  uniqueIndex("uk_configuration_evidence_work_item_head").on(table.tenantId, table.workItemId),
  foreignKey({
    columns: [table.configurationRevision, table.currentSnapshotId, table.tenantId, table.workItemId],
    foreignColumns: [configurationEvidenceSnapshotVersion.configurationRevision, configurationEvidenceSnapshotVersion.snapshotId, configurationEvidenceSnapshotVersion.tenantId, configurationEvidenceSnapshotVersion.workItemId],
    name: "fk_configuration_evidence_head_snapshot",
  }),
]);

export const configurationEvidenceTraceStaleness = pgTable("configuration_evidence_trace_staleness", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  stalenessId: text("staleness_id").notNull(),
  priorSnapshotId: varchar("prior_snapshot_id", { length: 160 }).notNull(),
  predicateTraceId: text("predicate_trace_id").notNull(),
  incomingSnapshotId: varchar("incoming_snapshot_id", { length: 160 }).notNull(),
  incomingConfigurationRevision: integer("incoming_configuration_revision").notNull(),
  previousStatus: varchar("previous_status", { length: 32 }).notNull(),
  staleReasonJson: text("stale_reason_json").notNull(),
  recordedByActorId: varchar("recorded_by_actor_id", { length: 255 }).notNull(),
  recordedAt: customTimestamptz("recorded_at", { precision: 3 }).notNull(),
}, (table) => [
  uniqueIndex("uk_configuration_evidence_trace_staleness").on(table.tenantId, table.workItemId, table.priorSnapshotId, table.predicateTraceId, table.incomingSnapshotId),
  index("idx_configuration_evidence_trace_stale_read").on(table.tenantId, table.workItemId, table.priorSnapshotId, table.incomingConfigurationRevision),
  foreignKey({
    columns: [table.priorSnapshotId, table.tenantId, table.workItemId],
    foreignColumns: [configurationEvidenceSnapshotVersion.snapshotId, configurationEvidenceSnapshotVersion.tenantId, configurationEvidenceSnapshotVersion.workItemId],
    name: "fk_configuration_evidence_stale_prior_snapshot",
  }),
  foreignKey({
    columns: [table.incomingSnapshotId, table.tenantId, table.workItemId],
    foreignColumns: [configurationEvidenceSnapshotVersion.snapshotId, configurationEvidenceSnapshotVersion.tenantId, configurationEvidenceSnapshotVersion.workItemId],
    name: "fk_configuration_evidence_stale_incoming_snapshot",
  }),
]);

export const configurationEvidencePredicateTraceVersion = pgTable("configuration_evidence_predicate_trace_version", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  snapshotId: varchar("snapshot_id", { length: 160 }).notNull(),
  predicateTraceId: text("predicate_trace_id").notNull(),
  factAssertionId: text("fact_assertion_id").notNull(),
  targetKey: text("target_key").notNull(),
  truth: varchar("truth", { length: 16 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  assessmentAsOf: customTimestamptz("assessment_as_of", { precision: 3 }).notNull(),
  sourceSliceRef: text("source_slice_ref").notNull(),
  traceJson: text("trace_json").notNull(),
  recordedByActorId: varchar("recorded_by_actor_id", { length: 255 }).notNull(),
  persistedAt: customTimestamptz("persisted_at", { precision: 3 }).notNull(),
}, (table) => [
  uniqueIndex("uk_configuration_evidence_trace").on(table.tenantId, table.workItemId, table.snapshotId, table.predicateTraceId),
  index("idx_configuration_evidence_trace_dependency").on(table.tenantId, table.workItemId, table.targetKey, table.assessmentAsOf),
  foreignKey({
    columns: [table.snapshotId, table.tenantId, table.workItemId],
    foreignColumns: [configurationEvidenceSnapshotVersion.snapshotId, configurationEvidenceSnapshotVersion.tenantId, configurationEvidenceSnapshotVersion.workItemId],
    name: "fk_configuration_evidence_trace_snapshot",
  }),
]);

export const configurationEvidenceFactVersion = pgTable("configuration_evidence_fact_version", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  snapshotId: varchar("snapshot_id", { length: 160 }).notNull(),
  factAssertionId: text("fact_assertion_id").notNull(),
  targetKey: text("target_key").notNull(),
  property: varchar("property", { length: 96 }).notNull(),
  truth: varchar("truth", { length: 16 }).notNull(),
  valueJson: text("value_json").notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  authority: varchar("authority", { length: 32 }).notNull(),
  assessmentAsOf: customTimestamptz("assessment_as_of", { precision: 3 }).notNull(),
  validFrom: customTimestamptz("valid_from", { precision: 3 }),
  validThroughAsOf: customTimestamptz("valid_through_as_of", { precision: 3 }).notNull(),
  sourceSliceRef: text("source_slice_ref").notNull(),
  factJson: text("fact_json").notNull(),
  recordedByActorId: varchar("recorded_by_actor_id", { length: 255 }).notNull(),
  persistedAt: customTimestamptz("persisted_at", { precision: 3 }).notNull(),
}, (table) => [
  uniqueIndex("uk_configuration_evidence_fact").on(table.tenantId, table.workItemId, table.snapshotId, table.factAssertionId),
  index("idx_configuration_evidence_fact_lookup").on(table.tenantId, table.workItemId, table.snapshotId, table.property),
  foreignKey({
    columns: [table.snapshotId, table.tenantId, table.workItemId],
    foreignColumns: [configurationEvidenceSnapshotVersion.snapshotId, configurationEvidenceSnapshotVersion.tenantId, configurationEvidenceSnapshotVersion.workItemId],
    name: "fk_configuration_evidence_fact_snapshot",
  }),
]);

export const configurationEvidenceEventVersion = pgTable("configuration_evidence_event_version", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  snapshotId: varchar("snapshot_id", { length: 160 }).notNull(),
  configEventId: text("config_event_id").notNull(),
  evidenceRecordId: text("evidence_record_id").notNull(),
  eventKind: varchar("event_kind", { length: 32 }).notNull(),
  aircraftAssetId: varchar("aircraft_asset_id", { length: 96 }).notNull(),
  positionId: varchar("position_id", { length: 160 }),
  effectiveAt: customTimestamptz("effective_at", { precision: 3 }).notNull(),
  sourceRecordedAt: customTimestamptz("source_recorded_at", { precision: 3 }).notNull(),
  evidenceJson: text("evidence_json").notNull(),
  eventJson: text("event_json").notNull(),
  recordedByActorId: varchar("recorded_by_actor_id", { length: 255 }).notNull(),
  persistedAt: customTimestamptz("persisted_at", { precision: 3 }).notNull(),
}, (table) => [
  uniqueIndex("uk_configuration_evidence_event").on(table.tenantId, table.workItemId, table.snapshotId, table.configEventId),
  index("idx_configuration_evidence_event_aircraft_time").on(table.tenantId, table.aircraftAssetId, table.effectiveAt),
  index("idx_configuration_evidence_event_source").on(table.tenantId, table.evidenceRecordId),
  foreignKey({
    columns: [table.snapshotId, table.tenantId, table.workItemId],
    foreignColumns: [configurationEvidenceSnapshotVersion.snapshotId, configurationEvidenceSnapshotVersion.tenantId, configurationEvidenceSnapshotVersion.workItemId],
    name: "fk_configuration_evidence_event_snapshot",
  }),
]);

export const configurationEvidenceSnapshotVersion = pgTable("configuration_evidence_snapshot_version", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  snapshotId: varchar("snapshot_id", { length: 160 }).notNull(),
  requestId: varchar("request_id", { length: 96 }).notNull(),
  requestJson: text("request_json").notNull(),
  aircraftAssetId: varchar("aircraft_asset_id", { length: 96 }).notNull(),
  assessmentAsOf: customTimestamptz("assessment_as_of", { precision: 3 }).notNull(),
  configurationRevision: integer("configuration_revision").notNull(),
  workItemRevisionBefore: integer("work_item_revision_before").notNull(),
  workItemRevisionAfter: integer("work_item_revision_after").notNull(),
  sourceCompleteness: varchar("source_completeness", { length: 16 }).notNull(),
  requestedTargetCount: integer("requested_target_count").notNull(),
  trueCount: integer("true_count").notNull(),
  falseCount: integer("false_count").notNull(),
  unknownCount: integer("unknown_count").notNull(),
  conflictCount: integer("conflict_count").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  recordedByActorId: varchar("recorded_by_actor_id", { length: 255 }).notNull(),
  recordedAt: customTimestamptz("recorded_at", { precision: 3 }).notNull(),
}, (table) => [
  uniqueIndex("uk_configuration_evidence_snapshot").on(table.tenantId, table.workItemId, table.snapshotId),
  uniqueIndex("uk_configuration_evidence_snapshot_revision_binding").on(table.tenantId, table.workItemId, table.snapshotId, table.configurationRevision),
  uniqueIndex("uk_configuration_evidence_request").on(table.tenantId, table.workItemId, table.requestId),
  uniqueIndex("uk_configuration_evidence_revision").on(table.tenantId, table.workItemId, table.configurationRevision),
  uniqueIndex("uk_configuration_evidence_work_item_revision").on(table.workItemId, table.workItemRevisionAfter),
  index("idx_configuration_evidence_snapshot_history").on(table.tenantId, table.workItemId, table.configurationRevision),
  index("idx_configuration_evidence_snapshot_aircraft_asof").on(table.tenantId, table.aircraftAssetId, table.assessmentAsOf),
  foreignKey({
    columns: [table.workItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_configuration_evidence_snapshot_work_item",
  }),
]);

export const batchApplicabilityConfirmation = pgTable("batch_applicability_confirmation", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: varchar("receipt_id", { length: 96 }).notNull().unique(),
  runId: varchar("run_id", { length: 96 }).notNull(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  actorId: varchar("actor_id", { length: 255 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  requestId: varchar("request_id", { length: 96 }).notNull(),
  requestPayloadJson: text("request_payload_json").notNull(),
  workItemRevision: integer("work_item_revision").notNull(),
  candidateClusterId: varchar("candidate_cluster_id", { length: 255 }).notNull(),
  decision: varchar("decision", { length: 48 }).notNull(),
  reason: text("reason").notNull(),
  confirmedAt: customTimestamptz("confirmed_at", { precision: 3 }).notNull(),
  validUntil: customTimestamptz("valid_until", { precision: 3 }).notNull(),
  confirmationCandidateJson: text("confirmation_candidate_json").notNull(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uk_batch_applicability_confirmation_receipt").on(table.receiptId),
  uniqueIndex("uk_batch_applicability_confirmation_request").on(table.tenantId, table.workItemId, table.requestId),
  uniqueIndex("uk_batch_applicability_confirmation_cluster").on(table.runId, table.candidateClusterId),
  index("idx_batch_applicability_confirmation_run").on(table.runId, table.createdAt),
  foreignKey({
    columns: [table.runId],
    foreignColumns: [batchApplicabilityRun.runId],
    name: "fk_batch_applicability_confirmation_run",
  }),
  foreignKey({
    columns: [table.workItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_batch_applicability_confirmation_work_item",
  }),
]);

export const batchApplicabilityRun = pgTable("batch_applicability_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: varchar("run_id", { length: 96 }).notNull().unique(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  actorId: varchar("actor_id", { length: 255 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  requestId: varchar("request_id", { length: 96 }).notNull(),
  requestPayloadJson: text("request_payload_json").notNull(),
  workItemRevision: integer("work_item_revision").notNull(),
  documentVersionId: varchar("document_version_id", { length: 96 }).notNull(),
  sourcePackageId: text("source_package_id").notNull(),
  sourceExpressionId: varchar("source_expression_id", { length: 160 }).notNull(),
  sourceConditionId: varchar("source_condition_id", { length: 160 }).notNull(),
  sourceRefIdsJson: text("source_ref_ids_json").notNull(),
  fleetSourceSnapshotId: varchar("fleet_source_snapshot_id", { length: 96 }).notNull(),
  fleetSourceRevisionKey: varchar("fleet_source_revision_key", { length: 255 }).notNull(),
  fleetAuthorityRevision: varchar("fleet_authority_revision", { length: 96 }).notNull(),
  fleetSourceAsOf: varchar("fleet_source_as_of", { length: 10 }).notNull(),
  hostBindingStatus: varchar("host_binding_status", { length: 32 }).notNull(),
  candidateSetJson: text("candidate_set_json").notNull(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uk_batch_applicability_run_id").on(table.runId),
  uniqueIndex("uk_batch_applicability_run_request").on(table.tenantId, table.workItemId, table.requestId),
  index("idx_batch_applicability_run_work_item").on(table.workItemId, table.createdAt),
  foreignKey({
    columns: [table.workItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_batch_applicability_run_work_item",
  }),
]);

export const translationKnowledgeGovernanceEvent = pgTable("translation_knowledge_governance_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  snapshotWorkItemRevision: integer("snapshot_work_item_revision").notNull(),
  eventId: varchar("event_id", { length: 96 }).notNull(),
  requestId: varchar("request_id", { length: 96 }),
  assetId: varchar("asset_id", { length: 96 }).notNull(),
  eventType: varchar("event_type", { length: 48 }).notNull(),
  feedbackDecision: varchar("feedback_decision", { length: 64 }),
  expectedRevision: integer("expected_revision").notNull(),
  resultingRevision: integer("resulting_revision").notNull(),
  actorKind: varchar("actor_kind", { length: 24 }).notNull(),
  actorId: varchar("actor_id", { length: 255 }).notNull(),
  reason: text("reason").notNull(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull(),
}, (table) => [
  uniqueIndex("uk_translation_knowledge_event").on(table.tenantId, table.workItemId, table.eventId),
  uniqueIndex("uk_translation_knowledge_event_revision").on(table.tenantId, table.workItemId, table.assetId, table.resultingRevision),
  uniqueIndex("uk_translation_knowledge_feedback_request").on(table.tenantId, table.workItemId, table.requestId),
  index("idx_translation_knowledge_event_history").on(table.tenantId, table.workItemId, table.assetId, table.resultingRevision),
  foreignKey({
    columns: [table.assetId, table.snapshotWorkItemRevision, table.tenantId, table.workItemId],
    foreignColumns: [translationKnowledgeCandidate.assetId, translationKnowledgeCandidate.snapshotWorkItemRevision, translationKnowledgeCandidate.tenantId, translationKnowledgeCandidate.workItemId],
    name: "fk_translation_knowledge_event_asset",
  }),
]);

export const translationKnowledgeImportRequestItem = pgTable("translation_knowledge_import_request_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  requestId: varchar("request_id", { length: 96 }).notNull(),
  snapshotWorkItemRevision: integer("snapshot_work_item_revision").notNull(),
  sourceArtifactSha256: varchar("source_artifact_sha256", { length: 64 }).notNull(),
  sourceUnitId: varchar("source_unit_id", { length: 160 }).notNull(),
  sourceUnitOrdinal: integer("source_unit_ordinal").notNull(),
  expectedUnitCount: integer("expected_unit_count").notNull(),
  assetId: varchar("asset_id", { length: 96 }).notNull(),
  validFrom: customTimestamptz("valid_from", { precision: 3 }).notNull(),
  expiresAt: customTimestamptz("expires_at", { precision: 3 }).notNull(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull(),
}, (table) => [
  uniqueIndex("uk_translation_knowledge_import_request_unit").on(table.tenantId, table.workItemId, table.requestId, table.sourceUnitId),
  uniqueIndex("uk_translation_knowledge_import_request_asset").on(table.tenantId, table.workItemId, table.requestId, table.assetId),
  uniqueIndex("uk_translation_knowledge_import_request_ordinal").on(table.tenantId, table.workItemId, table.requestId, table.sourceUnitOrdinal),
  index("idx_translation_knowledge_import_request").on(table.tenantId, table.workItemId, table.requestId, table.sourceUnitId),
  foreignKey({
    columns: [table.assetId, table.snapshotWorkItemRevision, table.tenantId, table.workItemId],
    foreignColumns: [translationKnowledgeCandidate.assetId, translationKnowledgeCandidate.snapshotWorkItemRevision, translationKnowledgeCandidate.tenantId, translationKnowledgeCandidate.workItemId],
    name: "fk_translation_knowledge_import_request_asset",
  }),
]);

export const translationKnowledgeSourceRef = pgTable("translation_knowledge_source_ref", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  assetId: varchar("asset_id", { length: 96 }).notNull(),
  sourceRefId: text("source_ref_id").notNull(),
  sourceRefOrdinal: integer("source_ref_ordinal").notNull(),
}, (table) => [
  uniqueIndex("uk_translation_knowledge_source_ref").on(table.tenantId, table.workItemId, table.assetId, table.sourceRefId),
  uniqueIndex("uk_translation_knowledge_source_ref_ordinal").on(table.tenantId, table.workItemId, table.assetId, table.sourceRefOrdinal),
  foreignKey({
    columns: [table.assetId, table.tenantId, table.workItemId],
    foreignColumns: [translationKnowledgeCandidate.assetId, translationKnowledgeCandidate.tenantId, translationKnowledgeCandidate.workItemId],
    name: "fk_translation_knowledge_source_ref_asset",
  }),
]);

export const translationKnowledgeCandidate = pgTable("translation_knowledge_candidate", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  snapshotWorkItemRevision: integer("snapshot_work_item_revision").notNull(),
  assetId: varchar("asset_id", { length: 96 }).notNull(),
  knowledgeKind: varchar("knowledge_kind", { length: 48 }).notNull(),
  candidateOnly: boolean("candidate_only").notNull().default(true),
  usagePolicy: varchar("usage_policy", { length: 48 }).notNull().default('SUGGESTION_ONLY'),
  ownerActorId: varchar("owner_actor_id", { length: 255 }).notNull(),
  importedByActorId: varchar("imported_by_actor_id", { length: 255 }).notNull(),
  sourceArtifactRef: text("source_artifact_ref").notNull(),
  sourceArtifactSha256: varchar("source_artifact_sha256", { length: 64 }).notNull(),
  sourceDocumentId: varchar("source_document_id", { length: 96 }).notNull(),
  sourceRevisionId: varchar("source_revision_id", { length: 96 }).notNull(),
  sourceSbdPackageId: text("source_sbd_package_id").notNull(),
  sourceSbdContentHash: text("source_sbd_content_hash").notNull(),
  sourceTcpPackageId: text("source_tcp_package_id"),
  sourceTcpContentHash: text("source_tcp_content_hash"),
  actionAttemptId: varchar("action_attempt_id", { length: 96 }).notNull(),
  resultContentHash: varchar("result_content_hash", { length: 64 }).notNull(),
  modelVersion: varchar("model_version", { length: 160 }).notNull(),
  promptVersion: varchar("prompt_version", { length: 160 }).notNull(),
  skillVersion: varchar("skill_version", { length: 160 }).notNull(),
  ruleSetId: varchar("rule_set_id", { length: 160 }).notNull(),
  ruleSetVersion: varchar("rule_set_version", { length: 96 }).notNull(),
  sourceLocale: varchar("source_locale", { length: 32 }).notNull(),
  targetLocale: varchar("target_locale", { length: 32 }).notNull(),
  sourceUnitId: varchar("source_unit_id", { length: 160 }).notNull(),
  sourceUnitKind: varchar("source_unit_kind", { length: 48 }).notNull(),
  sourceUnitCount: integer("source_unit_count").notNull(),
  sourceRefCount: integer("source_ref_count").notNull(),
  sourceText: text("source_text").notNull(),
  translatedText: text("translated_text").notNull(),
  engineerRevisionId: varchar("engineer_revision_id", { length: 96 }),
  validFrom: customTimestamptz("valid_from", { precision: 3 }).notNull(),
  expiresAt: customTimestamptz("expires_at", { precision: 3 }).notNull(),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uk_translation_knowledge_asset").on(table.tenantId, table.workItemId, table.assetId),
  uniqueIndex("uk_translation_knowledge_asset_snapshot").on(table.tenantId, table.workItemId, table.assetId, table.snapshotWorkItemRevision),
  uniqueIndex("uk_translation_knowledge_artifact_unit").on(table.tenantId, table.workItemId, table.snapshotWorkItemRevision, table.sourceArtifactSha256, table.sourceUnitId),
  index("idx_translation_knowledge_owner_validity").on(table.tenantId, table.workItemId, table.ownerActorId, table.expiresAt),
  foreignKey({
    columns: [table.tenantId, table.workItemId],
    foreignColumns: [workItem.tenantId, workItem.workItemId],
    name: "fk_translation_knowledge_work_item",
  }),
  foreignKey({
    columns: [table.actionAttemptId],
    foreignColumns: [actionAttempt.attemptId],
    name: "fk_translation_knowledge_action_attempt",
  }),
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
    columns: [table.matterId, table.matterRevisionId, table.tenantId],
    foreignColumns: [engineeringMatterRevision.matterId, engineeringMatterRevision.matterRevisionId, engineeringMatterRevision.tenantId],
    name: "fk_engineering_matter_revision_work_item_revision",
  }),
  foreignKey({
    columns: [table.workItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_engineering_matter_revision_work_item_work_item",
  }),
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
    columns: [table.changedWorkItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_engineering_matter_revision_changed_work_item",
  }),
  foreignKey({
    columns: [table.matterId, table.tenantId],
    foreignColumns: [engineeringMatter.matterId, engineeringMatter.tenantId],
    name: "fk_engineering_matter_revision_matter",
  }),
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
  foreignKey({
    columns: [table.currentMatterRevisionId, table.matterId, table.tenantId],
    foreignColumns: [engineeringMatterRevision.matterId, engineeringMatterRevision.matterRevisionId, engineeringMatterRevision.tenantId],
    name: "fk_engineering_matter_current_revision",
  }),
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
    columns: [table.activeCriterionSetId, table.ruleSetKey, table.tenantId],
    foreignColumns: [canonicalRuleSetSnapshot.criterionSetId, canonicalRuleSetSnapshot.ruleSetKey, canonicalRuleSetSnapshot.tenantId],
    name: "fk_canonical_rule_set_activation_target",
  }),
  foreignKey({
    columns: [table.fromCriterionSetId, table.ruleSetKey, table.tenantId],
    foreignColumns: [canonicalRuleSetSnapshot.criterionSetId, canonicalRuleSetSnapshot.ruleSetKey, canonicalRuleSetSnapshot.tenantId],
    name: "fk_canonical_rule_set_activation_previous",
  }),
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
    columns: [table.assetId, table.sourceSnapshotId, table.tenantId],
    foreignColumns: [canonicalFleetAssetVersion.assetId, canonicalFleetAssetVersion.sourceSnapshotId, canonicalFleetAssetVersion.tenantId],
    name: "fk_canonical_fleet_fact_asset",
  }),
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
    columns: [table.assetId, table.sourceSnapshotId, table.tenantId],
    foreignColumns: [canonicalFleetAssetVersion.assetId, canonicalFleetAssetVersion.sourceSnapshotId, canonicalFleetAssetVersion.tenantId],
    name: "fk_canonical_fleet_alias_asset",
  }),
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
    columns: [table.sourceSnapshotId, table.tenantId],
    foreignColumns: [canonicalFleetSourceSnapshot.sourceSnapshotId, canonicalFleetSourceSnapshot.tenantId],
    name: "fk_canonical_fleet_asset_snapshot",
  }),
]);

export const canonicalFleetScopeHead = pgTable("canonical_fleet_scope_head", {
  tenantId: varchar("tenant_id", { length: 128 }).primaryKey(),
  currentSourceSnapshotId: varchar("current_source_snapshot_id", { length: 96 }).notNull(),
  authorityRevision: integer("authority_revision").notNull(),
  updatedAt: customTimestamptz("updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  foreignKey({
    columns: [table.currentSourceSnapshotId, table.tenantId],
    foreignColumns: [canonicalFleetSourceSnapshot.sourceSnapshotId, canonicalFleetSourceSnapshot.tenantId],
    name: "fk_canonical_fleet_scope_head_snapshot",
  }),
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
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
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
  actionAttemptId: varchar("action_attempt_id", { length: 96 }).unique(),
  assistantCompletedAt: customTimestamptz("assistant_completed_at", { precision: 3 }),
}, (table) => [
  uniqueIndex("uk_review_turn_business_id").on(table.reviewTurnId),
  uniqueIndex("uk_review_turn_engineer_input").on(table.engineerSuppliedInputId),
  uniqueIndex("uk_review_turn_request").on(table.reviewConversationId, table.requestId),
  uniqueIndex("uk_review_turn_number").on(table.reviewConversationId, table.turnNo),
  index("idx_review_turn_conversation").on(table.reviewConversationId, table.turnNo),
  index("idx_review_turn_work_item").on(table.workItemId, table.createdAt),
  uniqueIndex("uk_review_turn_action_attempt").on(table.actionAttemptId),
  foreignKey({
    columns: [table.reviewConversationId],
    foreignColumns: [reviewConversation.reviewConversationId],
    name: "fk_review_turn_conversation",
  }),
  foreignKey({
    columns: [table.workItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_review_turn_work_item",
  }),
  foreignKey({
    columns: [table.engineerSuppliedInputId],
    foreignColumns: [engineerSuppliedInput.engineerSuppliedInputId],
    name: "fk_review_turn_engineer_input",
  }),
  foreignKey({
    columns: [table.actionAttemptId],
    foreignColumns: [actionAttempt.attemptId],
    name: "fk_review_turn_action_attempt",
  }),
]);

export const reviewConversation = pgTable("review_conversation", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewConversationId: varchar("review_conversation_id", { length: 96 }).notNull().unique(),
  tenantId: varchar("tenant_id", { length: 128 }).notNull(),
  actorId: varchar("actor_id", { length: 255 }).notNull(),
  workItemId: varchar("work_item_id", { length: 96 }).notNull(),
  openclawAgentId: varchar("openclaw_agent_id", { length: 96 }).notNull(),
  openclawSessionKey: varchar("openclaw_session_key", { length: 1024 }).notNull().unique(),
  startedAtRevision: integer("started_at_revision").notNull(),
  lastSyncedRevision: integer("last_synced_revision").notNull(),
  lastTurnNo: integer("last_turn_no").notNull().default(0),
  status: varchar("status", { length: 32 }).notNull().default('ACTIVE'),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  lastActiveAt: customTimestamptz("last_active_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  closedAt: customTimestamptz("closed_at", { precision: 3 }),
}, (table) => [
  uniqueIndex("uk_review_conversation_business_id").on(table.reviewConversationId),
  uniqueIndex("uk_review_conversation_openclaw_session").on(table.openclawSessionKey),
  uniqueIndex("uk_review_conversation_live").on(table.tenantId, table.actorId, table.workItemId),
  index("idx_review_conversation_work_item").on(table.workItemId, table.status, table.lastActiveAt),
  index("idx_review_conversation_actor").on(table.tenantId, table.actorId, table.status, table.lastActiveAt),
  foreignKey({
    columns: [table.workItemId],
    foreignColumns: [workItem.workItemId],
    name: "fk_review_conversation_work_item",
  }),
]);

export const identitySession = pgTable("identity_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionTokenHash: varchar("session_token_hash", { length: 64 }).notNull().unique(),
  subjectMappingId: uuid("subject_mapping_id").notNull(),
  feishuUserId: varchar("feishu_user_id", { length: 255 }),
  revision: integer("revision").notNull().default(1),
  expiresAt: customTimestamptz("expires_at", { precision: 3 }).notNull(),
  revokedAt: customTimestamptz("revoked_at", { precision: 3 }),
  lastSeenAt: customTimestamptz("last_seen_at", { precision: 3 }).notNull(),
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
  uniqueIndex("uk_identity_session_token_hash").on(table.sessionTokenHash),
  index("idx_identity_session_subject").on(table.subjectMappingId, table.expiresAt),
  foreignKey({
    columns: [table.subjectMappingId],
    foreignColumns: [identitySubjectMapping.id],
    name: "fk_identity_session_subject_mapping",
  }),
]);

export const identityOauthState = pgTable("identity_oauth_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  stateHash: varchar("state_hash", { length: 64 }).notNull().unique(),
  codeVerifier: varchar("code_verifier", { length: 128 }).notNull(),
  expiresAt: customTimestamptz("expires_at", { precision: 3 }).notNull(),
  consumedAt: customTimestamptz("consumed_at", { precision: 3 }),
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
  uniqueIndex("uk_identity_oauth_state_hash").on(table.stateHash),
  index("idx_identity_oauth_state_expiry").on(table.expiresAt),
]);

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
  uniqueIndex("uk_identity_subject_feishu_app").on(table.feishuTenantKey, table.feishuOpenId, table.expectedClientId),
  index("idx_identity_subject_miaoda").on(table.miaodaTenantId, table.miaodaUserId),
  uniqueIndex("uk_identity_subject_active_miaoda_app").on(table.miaodaUserId, table.expectedClientId),
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
    columns: [table.searchRunRef, table.tenantId],
    foreignColumns: [externalSearchRun.searchRunRef, externalSearchRun.tenantId],
    name: "fk_external_candidate_search_run",
  }),
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
]);

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
  operationRef: varchar("operation_ref", { length: 128 }).unique(),
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
  uniqueIndex("uk_action_attempt_idempotency").on(table.tenantId, table.idempotencyKey),
  index("idx_action_attempt_due_queue").on(table.status, table.nextAttemptAt, table.priority, table.createdAt),
  index("idx_action_attempt_lease").on(table.status, table.leaseExpiresAt),
  uniqueIndex("uk_action_attempt_active_work_task").on(table.workItemId, table.actionType),
  uniqueIndex("uk_action_attempt_operation_ref").on(table.operationRef),
  uniqueIndex("uk_action_attempt_lease_slot").on(table.tenantId, table.requestOrigin, table.leaseSlot),
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
  index("idx_work_item_status").on(table.status, table.updatedAt),
  index("idx_work_item_document").on(table.documentId, table.documentVersionId),
  uniqueIndex("uk_work_item_document_parse").on(table.tenantId, table.actionType, table.documentVersionId, table.runKey),
  uniqueIndex("uk_work_item_tenant_business_id").on(table.tenantId, table.workItemId),
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

// table aliases
export const actionAttemptTable = actionAttempt;
export const batchApplicabilityConfirmationTable = batchApplicabilityConfirmation;
export const batchApplicabilityRunTable = batchApplicabilityRun;
export const canonicalFleetAliasVersionTable = canonicalFleetAliasVersion;
export const canonicalFleetAssetVersionTable = canonicalFleetAssetVersion;
export const canonicalFleetConfigurationFactVersionTable = canonicalFleetConfigurationFactVersion;
export const canonicalFleetScopeHeadTable = canonicalFleetScopeHead;
export const canonicalFleetSourceSnapshotTable = canonicalFleetSourceSnapshot;
export const canonicalRuleSetActivationTable = canonicalRuleSetActivation;
export const canonicalRuleSetSnapshotTable = canonicalRuleSetSnapshot;
export const configurationEvidenceEventVersionTable = configurationEvidenceEventVersion;
export const configurationEvidenceFactVersionTable = configurationEvidenceFactVersion;
export const configurationEvidencePredicateTraceVersionTable = configurationEvidencePredicateTraceVersion;
export const configurationEvidenceQueryAttemptTable = configurationEvidenceQueryAttempt;
export const configurationEvidenceSnapshotVersionTable = configurationEvidenceSnapshotVersion;
export const configurationEvidenceTraceStalenessTable = configurationEvidenceTraceStaleness;
export const configurationEvidenceWorkItemHeadTable = configurationEvidenceWorkItemHead;
export const dmAcquisitionTable = dmAcquisition;
export const dmCurrentnessDecisionTable = dmCurrentnessDecision;
export const dmDocumentTable = dmDocument;
export const dmDocumentVersionTable = dmDocumentVersion;
export const dmIngressPreflightTable = dmIngressPreflight;
export const dmPublicationFamilyTable = dmPublicationFamily;
export const dmSourceArtifactTable = dmSourceArtifact;
export const engineerSuppliedInputTable = engineerSuppliedInput;
export const engineeringMatterTable = engineeringMatter;
export const engineeringMatterRevisionTable = engineeringMatterRevision;
export const engineeringMatterRevisionWorkItemTable = engineeringMatterRevisionWorkItem;
export const externalDiscoveryCandidateTable = externalDiscoveryCandidate;
export const externalSearchRunTable = externalSearchRun;
export const identityOauthStateTable = identityOauthState;
export const identitySessionTable = identitySession;
export const identitySubjectMappingTable = identitySubjectMapping;
export const reviewConversationTable = reviewConversation;
export const reviewTurnTable = reviewTurn;
export const translationKnowledgeCandidateTable = translationKnowledgeCandidate;
export const translationKnowledgeGovernanceEventTable = translationKnowledgeGovernanceEvent;
export const translationKnowledgeImportRequestItemTable = translationKnowledgeImportRequestItem;
export const translationKnowledgeSourceRefTable = translationKnowledgeSourceRef;
export const workItemTable = workItem;
