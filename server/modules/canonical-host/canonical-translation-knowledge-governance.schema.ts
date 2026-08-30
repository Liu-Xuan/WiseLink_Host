import {
  boolean,
  integer,
  pgTable,
  text,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { customTimestamptz } from '../../database/schema';

/**
 * Exact 0015 mappings kept in the owning domain until the platform schema
 * generator runs after deployment. Do not add fields outside 0015.
 */
export const translationKnowledgeCandidate = pgTable(
  'translation_knowledge_candidate',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: varchar('tenant_id', { length: 128 }).notNull(),
    workItemId: varchar('work_item_id', { length: 96 }).notNull(),
    snapshotWorkItemRevision: integer('snapshot_work_item_revision').notNull(),
    assetId: varchar('asset_id', { length: 96 }).notNull(),
    knowledgeKind: varchar('knowledge_kind', { length: 48 }).notNull(),
    candidateOnly: boolean('candidate_only').notNull().default(true),
    usagePolicy: varchar('usage_policy', { length: 48 })
      .notNull()
      .default('SUGGESTION_ONLY'),
    ownerActorId: varchar('owner_actor_id', { length: 255 }).notNull(),
    importedByActorId: varchar('imported_by_actor_id', {
      length: 255,
    }).notNull(),
    sourceArtifactRef: text('source_artifact_ref').notNull(),
    sourceArtifactSha256: varchar('source_artifact_sha256', {
      length: 64,
    }).notNull(),
    sourceDocumentId: varchar('source_document_id', { length: 96 }).notNull(),
    sourceRevisionId: varchar('source_revision_id', { length: 96 }).notNull(),
    sourceSbdPackageId: text('source_sbd_package_id').notNull(),
    sourceSbdContentHash: text('source_sbd_content_hash').notNull(),
    sourceTcpPackageId: text('source_tcp_package_id'),
    sourceTcpContentHash: text('source_tcp_content_hash'),
    actionAttemptId: varchar('action_attempt_id', { length: 96 }).notNull(),
    resultContentHash: varchar('result_content_hash', {
      length: 64,
    }).notNull(),
    modelVersion: varchar('model_version', { length: 160 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 160 }).notNull(),
    skillVersion: varchar('skill_version', { length: 160 }).notNull(),
    ruleSetId: varchar('rule_set_id', { length: 160 }).notNull(),
    ruleSetVersion: varchar('rule_set_version', { length: 96 }).notNull(),
    sourceLocale: varchar('source_locale', { length: 32 }).notNull(),
    targetLocale: varchar('target_locale', { length: 32 }).notNull(),
    sourceUnitId: varchar('source_unit_id', { length: 160 }).notNull(),
    sourceUnitKind: varchar('source_unit_kind', { length: 48 }).notNull(),
    sourceUnitCount: integer('source_unit_count').notNull(),
    sourceRefCount: integer('source_ref_count').notNull(),
    sourceText: text('source_text').notNull(),
    translatedText: text('translated_text').notNull(),
    engineerRevisionId: varchar('engineer_revision_id', { length: 96 }),
    validFrom: customTimestamptz('valid_from', { precision: 3 }).notNull(),
    expiresAt: customTimestamptz('expires_at', { precision: 3 }).notNull(),
    createdAt: customTimestamptz('created_at', { precision: 3 }).notNull(),
  },
);

export const translationKnowledgeSourceRef = pgTable(
  'translation_knowledge_source_ref',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: varchar('tenant_id', { length: 128 }).notNull(),
    workItemId: varchar('work_item_id', { length: 96 }).notNull(),
    assetId: varchar('asset_id', { length: 96 }).notNull(),
    sourceRefId: text('source_ref_id').notNull(),
    sourceRefOrdinal: integer('source_ref_ordinal').notNull(),
  },
);

export const translationKnowledgeImportRequestItem = pgTable(
  'translation_knowledge_import_request_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: varchar('tenant_id', { length: 128 }).notNull(),
    workItemId: varchar('work_item_id', { length: 96 }).notNull(),
    requestId: varchar('request_id', { length: 96 }).notNull(),
    snapshotWorkItemRevision: integer('snapshot_work_item_revision').notNull(),
    sourceArtifactSha256: varchar('source_artifact_sha256', {
      length: 64,
    }).notNull(),
    sourceUnitId: varchar('source_unit_id', { length: 160 }).notNull(),
    sourceUnitOrdinal: integer('source_unit_ordinal').notNull(),
    expectedUnitCount: integer('expected_unit_count').notNull(),
    assetId: varchar('asset_id', { length: 96 }).notNull(),
    validFrom: customTimestamptz('valid_from', { precision: 3 }).notNull(),
    expiresAt: customTimestamptz('expires_at', { precision: 3 }).notNull(),
    createdAt: customTimestamptz('created_at', { precision: 3 }).notNull(),
  },
);

export const translationKnowledgeGovernanceEvent = pgTable(
  'translation_knowledge_governance_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: varchar('tenant_id', { length: 128 }).notNull(),
    workItemId: varchar('work_item_id', { length: 96 }).notNull(),
    snapshotWorkItemRevision: integer('snapshot_work_item_revision').notNull(),
    eventId: varchar('event_id', { length: 96 }).notNull(),
    requestId: varchar('request_id', { length: 96 }),
    assetId: varchar('asset_id', { length: 96 }).notNull(),
    eventType: varchar('event_type', { length: 48 }).notNull(),
    feedbackDecision: varchar('feedback_decision', { length: 64 }),
    expectedRevision: integer('expected_revision').notNull(),
    resultingRevision: integer('resulting_revision').notNull(),
    actorKind: varchar('actor_kind', { length: 24 }).notNull(),
    actorId: varchar('actor_id', { length: 255 }).notNull(),
    reason: text('reason').notNull(),
    createdAt: customTimestamptz('created_at', { precision: 3 }).notNull(),
  },
);
