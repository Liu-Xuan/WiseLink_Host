import { sql } from 'drizzle-orm';
import { integer, index, pgTable, text, uniqueIndex, uuid, varchar, customType } from 'drizzle-orm/pg-core';

/** PostgreSQL full text vector maintained by the generated projection column. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

/** Rebuildable projection; source records and work revisions remain authoritative. */
export const engineeringSearchProjection = pgTable('engineering_search_projection', {
  id: uuid('id').primaryKey().defaultRandom(),
  entryId: varchar('entry_id', { length: 160 }).notNull(),
  tenantId: varchar('tenant_id', { length: 128 }).notNull(),
  ownerKind: varchar('owner_kind', { length: 32 }).notNull(),
  ownerId: varchar('owner_id', { length: 255 }).notNull(),
  exactRevisionRef: varchar('exact_revision_ref', { length: 160 }).notNull(),
  entryKind: varchar('entry_kind', { length: 32 }).notNull(),
  locatorRef: varchar('locator_ref', { length: 255 }),
  parentContextRef: varchar('parent_context_ref', { length: 255 }),
  title: text('title').notNull().default(''),
  identifiers: text('identifiers').array().notNull().default(sql`ARRAY[]::text[]`),
  originalOrWorkText: text('original_or_work_text').notNull(),
  tokenizedText: text('tokenized_text').notNull(),
  searchVector: tsvector('search_vector').notNull().generatedAlwaysAs(sql`
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(tokenized_text, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(original_or_work_text, '')), 'C')
  `),
  indexedVersion: integer('indexed_version').notNull().default(1),
}, table => [
  uniqueIndex('uk_engineering_search_projection_entry').on(table.tenantId, table.entryId),
  uniqueIndex('uk_engineering_search_projection_revision_locator').on(table.tenantId, table.exactRevisionRef, table.locatorRef),
  index('idx_engineering_search_projection_vector').using('gin', table.searchVector),
  index('idx_engineering_search_projection_owner_revision').on(table.tenantId, table.ownerKind, table.ownerId, table.exactRevisionRef),
  index('idx_engineering_search_projection_identifiers').using('gin', table.identifiers),
]);

/** Durable retry marker; projection rows remain rebuildable derived state. */
export const engineeringSearchProjectionPending = pgTable('engineering_search_projection_pending', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 128 }).notNull(),
  exactRevisionRef: varchar('exact_revision_ref', { length: 160 }).notNull(),
  ownerKind: varchar('owner_kind', { length: 32 }).notNull(),
  ownerId: varchar('owner_id', { length: 255 }).notNull(),
  subjectId: varchar('subject_id', { length: 255 }),
  lastError: text('last_error').notNull(),
  attempts: integer('attempts').notNull().default(1),
  sourceNextOffset: integer('source_next_offset').notNull().default(0),
}, table => [
  uniqueIndex('uk_engineering_search_projection_pending_revision').on(table.tenantId, table.exactRevisionRef),
]);
