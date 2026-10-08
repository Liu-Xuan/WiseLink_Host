import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type {
  TdmsProcessingRevisionSet,
  TdmsProcessingSetHead,
} from '@shared/tdms-processing-set.interface';
import type {
  TdmsSourceScope,
  TdmsStoredAssertion,
  TdmsStoredRevision,
} from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import { SqlTdmsTransaction } from './tdms-source.repository';
import type {
  TdmsProcessingSetRepository,
  TdmsProcessingSetTransaction,
} from './tdms-processing-set.types';

/** Explicit inactive repository seam, using the existing actor-scoped transaction. */
export class MiaodaTdmsProcessingSetRepository implements TdmsProcessingSetRepository {
  constructor(private readonly db: PostgresJsDatabase) {}
  transaction<T>(
    operation: (tx: TdmsProcessingSetTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction((db) =>
      operation(new SqlTdmsProcessingSetTransaction(db)),
    );
  }
}
export class SqlTdmsProcessingSetTransaction
  extends SqlTdmsTransaction
  implements TdmsProcessingSetTransaction
{
  constructor(private readonly setDb: Pick<PostgresJsDatabase, 'execute'>) {
    super(setDb);
  }
  override async revision(tenantId: string, ref: string) {
    const rows = await this.setDb.execute<{
      data: TdmsStoredRevision;
      data_kind: string;
    }>(
      sql`SELECT data,jsonb_typeof(data) AS data_kind FROM tdms_record_revision WHERE tenant_id=${tenantId} AND source_revision_ref=${ref}`,
    );
    if (!rows[0]) return null;
    if (rows[0].data_kind !== 'object')
      throw tdmsError('TDMS_SET_STORED_DATA_INVALID', 409);
    return storedData(rows[0].data);
  }
  async processingSet(s: TdmsSourceScope, ref: string) {
    const rows = await this.setDb.execute<{ data: TdmsProcessingRevisionSet }>(
      sql`SELECT data FROM tdms_processing_revision_set WHERE ${scope(s)} AND set_revision_ref=${ref}`,
    );
    return storedData(rows[0]?.data ?? null);
  }
  async processingSetHead(s: TdmsSourceScope, family: string) {
    const rows = await this.setDb.execute<{ data: TdmsProcessingSetHead }>(
      sql`SELECT data FROM tdms_processing_set_head WHERE ${scope(s)} AND processing_family_ref=${family} FOR UPDATE`,
    );
    return storedData(rows[0]?.data ?? null);
  }
  async processingSetHistory(
    s: TdmsSourceScope,
    family: string,
    after: string | null,
  ) {
    const rows = await this.setDb.execute<{ data: TdmsProcessingRevisionSet }>(
      sql`SELECT data FROM tdms_processing_revision_set WHERE ${scope(s)} AND processing_family_ref=${family} AND (${after}::text IS NULL OR set_revision_ref>${after}) ORDER BY set_revision_ref LIMIT 51`,
    );
    return rows.map((r) => storedData(r.data)!);
  }
  async processingAssertion(s: TdmsSourceScope, ref: string) {
    const rows = await this.setDb.execute<{ data: TdmsStoredAssertion }>(
      sql`SELECT data FROM tdms_relation_assertion WHERE ${scope(s)} AND assertion_ref=${ref}`,
    );
    return storedData(rows[0]?.data ?? null);
  }
  async insertProcessingSet(set: TdmsProcessingRevisionSet) {
    const s = set.scope;
    await this.setDb.execute(sql`INSERT INTO tdms_processing_revision_set
      (tenant_id,source_key,source_instance_id,scope_id,set_revision_ref,processing_family_ref,cohort_ref,processing_observation_ref,data)
      VALUES (${s.tenantId},${s.sourceKey},${s.sourceInstanceId},${s.scopeId},${set.setRevisionRef},${set.processingFamilyRef},${set.cohortRef},${set.processingObservationRef},${JSON.stringify(set)}::text::jsonb)`);
  }
  async selectProcessingSet(
    head: TdmsProcessingSetHead,
    expected: number | null,
  ) {
    const s = head.scope;
    const rows =
      expected === null
        ? await this.setDb.execute(sql`INSERT INTO tdms_processing_set_head
        (tenant_id,source_key,source_instance_id,scope_id,processing_family_ref,selected_set_revision_ref,generation,data)
        VALUES (${s.tenantId},${s.sourceKey},${s.sourceInstanceId},${s.scopeId},${head.processingFamilyRef},${head.selectedSetRevisionRef},${head.generation},${JSON.stringify(head)}::text::jsonb)
        ON CONFLICT DO NOTHING RETURNING generation`)
        : await this.setDb
            .execute(sql`UPDATE tdms_processing_set_head SET selected_set_revision_ref=${head.selectedSetRevisionRef},generation=${head.generation},data=${JSON.stringify(head)}::text::jsonb
        WHERE ${scope(s)} AND processing_family_ref=${head.processingFamilyRef} AND generation=${expected} RETURNING generation`);
    if (rows.length !== 1)
      throw tdmsError('TDMS_PROCESSING_SET_CAS_CONFLICT', 409);
  }
}
function scope(s: TdmsSourceScope) {
  return sql`tenant_id=${s.tenantId} AND source_key=${s.sourceKey} AND source_instance_id=${s.sourceInstanceId} AND scope_id=${s.scopeId}`;
}
/** Native Drizzle raw execute returns JSON text; the Host SDK can return objects.
 * Decode only this new seam; do not reinterpret the old repository/client API. */
function storedData<T>(value: T | null): T | null {
  if (value === null) return null;
  let decoded: unknown = value;
  try {
    if (typeof value === 'string') decoded = JSON.parse(value);
  } catch {
    throw tdmsError('TDMS_SET_STORED_DATA_INVALID', 409);
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw tdmsError('TDMS_SET_STORED_DATA_INVALID', 409);
  }
  const stored = decoded as Record<string, unknown>;
  if (
    !stored.scope ||
    typeof stored.scope !== 'object' ||
    Array.isArray(stored.scope)
  ) {
    throw tdmsError('TDMS_SET_STORED_DATA_INVALID', 409);
  }
  return decoded as T;
}
