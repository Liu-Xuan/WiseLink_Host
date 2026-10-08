import type {
  TdmsCapture,
  TdmsRecordHead,
  TdmsStoredRevision,
  TdmsRelationHead,
  TdmsStoredAssertion,
  TdmsStoredReceipt,
} from '../modules/tdms-source/tdms-source.types';
import { jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
export const tdmsCapture = pgTable(
  'tdms_capture',
  {
    tenantId: text('tenant_id').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceInstanceId: text('source_instance_id').notNull(),
    scopeId: text('scope_id').notNull(),
    packageId: text('package_id').notNull(),
    captureRef: text('capture_ref').notNull(),
    data: jsonb('data').$type<TdmsCapture>().notNull(),
  },
  (t) => [
    uniqueIndex('tdms_capture_identity').on(
      t.tenantId,
      t.sourceKey,
      t.sourceInstanceId,
      t.scopeId,
      t.packageId,
    ),
  ],
);
export const tdmsRecord = pgTable(
  'tdms_record',
  {
    tenantId: text('tenant_id').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceInstanceId: text('source_instance_id').notNull(),
    scopeId: text('scope_id').notNull(),
    recordKind: text('record_kind').notNull(),
    sourceRecordId: text('source_record_id').notNull(),
    recordRef: text('record_ref').notNull(),
    sourceRevisionRef: text('source_revision_ref').notNull(),
    data: jsonb('data').$type<TdmsRecordHead>().notNull(),
  },
  (t) => [
    uniqueIndex('tdms_record_identity').on(
      t.tenantId,
      t.sourceKey,
      t.sourceInstanceId,
      t.scopeId,
      t.recordKind,
      t.sourceRecordId,
    ),
  ],
);
export const tdmsRecordRevision = pgTable(
  'tdms_record_revision',
  {
    tenantId: text('tenant_id').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceInstanceId: text('source_instance_id').notNull(),
    scopeId: text('scope_id').notNull(),
    sourceRevisionRef: text('source_revision_ref').notNull(),
    recordRef: text('record_ref').notNull(),
    data: jsonb('data').$type<TdmsStoredRevision>().notNull(),
  },
  (t) => [
    uniqueIndex('tdms_record_revision_identity').on(
      t.tenantId,
      t.sourceRevisionRef,
    ),
  ],
);
export const tdmsRelation = pgTable(
  'tdms_relation',
  {
    tenantId: text('tenant_id').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceInstanceId: text('source_instance_id').notNull(),
    scopeId: text('scope_id').notNull(),
    sourceRelationId: text('source_relation_id').notNull(),
    relationRef: text('relation_ref').notNull(),
    assertionRef: text('assertion_ref').notNull(),
    data: jsonb('data').$type<TdmsRelationHead>().notNull(),
  },
  (t) => [
    uniqueIndex('tdms_relation_identity').on(
      t.tenantId,
      t.sourceKey,
      t.sourceInstanceId,
      t.scopeId,
      t.sourceRelationId,
    ),
  ],
);
export const tdmsRelationAssertion = pgTable(
  'tdms_relation_assertion',
  {
    tenantId: text('tenant_id').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceInstanceId: text('source_instance_id').notNull(),
    scopeId: text('scope_id').notNull(),
    assertionRef: text('assertion_ref').notNull(),
    relationRef: text('relation_ref').notNull(),
    fromRevisionRef: text('from_revision_ref'),
    toRevisionRef: text('to_revision_ref'),
    data: jsonb('data').$type<TdmsStoredAssertion>().notNull(),
  },
  (t) => [
    uniqueIndex('tdms_relation_assertion_identity').on(
      t.tenantId,
      t.assertionRef,
    ),
  ],
);
export const tdmsReadReceipt = pgTable(
  'tdms_read_receipt',
  {
    tenantId: text('tenant_id').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceInstanceId: text('source_instance_id').notNull(),
    scopeId: text('scope_id').notNull(),
    receiptRef: text('receipt_ref').notNull(),
    sourceRevisionRef: text('source_revision_ref').notNull(),
    actorId: text('actor_id').notNull(),
    data: jsonb('data').$type<TdmsStoredReceipt>().notNull(),
  },
  (t) => [
    uniqueIndex('tdms_read_receipt_identity').on(t.tenantId, t.receiptRef),
  ],
);
