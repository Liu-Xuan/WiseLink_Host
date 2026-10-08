import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import type {
  TdmsProcessingRevisionSet,
  TdmsProcessingSetHead,
} from '@shared/tdms-processing-set.interface';
import { tdmsRecordRevision } from './tdms-source.schema';

/** Inactive additive schema; the draft SQL owns FORCE RLS and immutable trigger. */
export const tdmsProcessingRevisionSet = pgTable(
  'tdms_processing_revision_set',
  {
    tenantId: text('tenant_id').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceInstanceId: text('source_instance_id').notNull(),
    scopeId: text('scope_id').notNull(),
    setRevisionRef: text('set_revision_ref').notNull(),
    processingFamilyRef: text('processing_family_ref').notNull(),
    cohortRef: text('cohort_ref'),
    processingObservationRef: text('processing_observation_ref').notNull(),
    data: jsonb('data').$type<TdmsProcessingRevisionSet>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.setRevisionRef] }),
    unique('tdms_processing_set_scoped_ref').on(
      t.tenantId,
      t.sourceKey,
      t.sourceInstanceId,
      t.scopeId,
      t.processingFamilyRef,
      t.setRevisionRef,
    ),
    foreignKey({
      columns: [t.tenantId, t.processingObservationRef],
      foreignColumns: [
        tdmsRecordRevision.tenantId,
        tdmsRecordRevision.sourceRevisionRef,
      ],
    }),
    index('tdms_processing_set_family_cohort').on(
      t.tenantId,
      t.sourceKey,
      t.sourceInstanceId,
      t.scopeId,
      t.processingFamilyRef,
      t.cohortRef,
      t.setRevisionRef,
    ),
    index('tdms_processing_set_observation').on(
      t.tenantId,
      t.processingObservationRef,
    ),
  ],
);
export const tdmsProcessingSetHead = pgTable(
  'tdms_processing_set_head',
  {
    tenantId: text('tenant_id').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceInstanceId: text('source_instance_id').notNull(),
    scopeId: text('scope_id').notNull(),
    processingFamilyRef: text('processing_family_ref').notNull(),
    selectedSetRevisionRef: text('selected_set_revision_ref').notNull(),
    generation: integer('generation').notNull(),
    data: jsonb('data').$type<TdmsProcessingSetHead>().notNull(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.tenantId,
        t.sourceKey,
        t.sourceInstanceId,
        t.scopeId,
        t.processingFamilyRef,
      ],
    }),
    foreignKey({
      columns: [
        t.tenantId,
        t.sourceKey,
        t.sourceInstanceId,
        t.scopeId,
        t.processingFamilyRef,
        t.selectedSetRevisionRef,
      ],
      foreignColumns: [
        tdmsProcessingRevisionSet.tenantId,
        tdmsProcessingRevisionSet.sourceKey,
        tdmsProcessingRevisionSet.sourceInstanceId,
        tdmsProcessingRevisionSet.scopeId,
        tdmsProcessingRevisionSet.processingFamilyRef,
        tdmsProcessingRevisionSet.setRevisionRef,
      ],
    }),
  ],
);
