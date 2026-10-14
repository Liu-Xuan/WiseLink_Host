import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { TdmsRecordRevision } from '@shared/tdms-source.interface';
import { SqlTdmsTransaction } from '@server/modules/tdms-source/tdms-source.repository';
import { TdmsSourceService } from '@server/modules/tdms-source/tdms-source.service';
import {
  tdmsError,
  type TdmsCataloguePage,
  type TdmsRepository,
  type TdmsSourceAuthorization,
  type TdmsSourceScope,
  type TdmsStoredRevision,
  type TdmsTransaction,
} from '@server/modules/tdms-source/tdms-source.types';
import { actor, fixture } from '../tdms-source/tdms-fixtures';
import { MemoryTdmsRepository, nativeScope } from '../tdms-source/tdms-memory-double';

function revision(index: number, documentVersionIds: string[] = []): TdmsRecordRevision {
  const source = fixture().records[0]!;
  return {
    recordRef: `TDMS-REC-${index}`,
    sourceRevisionRef: `TDMS-REV-${String(index).padStart(4, '0')}`,
    captureRef: `TDMS-CAP-${index}`,
    recordKind: source.recordKind,
    sourceRecordId: `AEO-${index}`,
    sourceKey: nativeScope.sourceKey,
    sourceInstanceId: nativeScope.sourceInstanceId,
    title: source.title,
    fileType: source.fileType,
    sourceVersion: source.sourceVersion,
    state: source.state,
    authors: source.authors,
    sourceModifiedAt: source.sourceModifiedAt,
    observedAt: source.observedAt,
    capturedAt: source.observedAt,
    coverage: source.coverage,
    rawFields: source.rawFields,
    content: source.content,
    fieldProvenance: source.fieldProvenance,
    fieldSelectors: [],
    artifacts: [],
    unreadAttachments: [],
    relatedDocumentVersionIds: documentVersionIds,
    sourceVerification: 'DECLARED_ONLY',
    currentness: 'SELECTED_HOST_OBSERVATION',
    selectedHead: true,
  };
}

function serviceFixture(rows: TdmsStoredRevision[], scopes = [nativeScope]) {
  const memory = new MemoryTdmsRepository();
  const pages: Array<{ scope: TdmsSourceScope; page?: TdmsCataloguePage }> = [];
  const repository: TdmsRepository = {
    transaction: <T>(operation: (tx: TdmsTransaction) => Promise<T>) =>
      memory.transaction((tx: TdmsTransaction) => operation({
        ...tx,
        catalogue: async (scope: TdmsSourceScope, page?: TdmsCataloguePage) => {
          pages.push({ scope, page });
          const ordered: TdmsStoredRevision[] = rows
            .filter((row: TdmsStoredRevision) =>
              row.scope.scopeId === scope.scopeId &&
              (!page?.after || row.record.sourceRevisionRef > page.after) &&
              (!page?.documentVersionId ||
                row.record.relatedDocumentVersionIds.includes(page.documentVersionId)),
            )
            .sort((left: TdmsStoredRevision, right: TdmsStoredRevision) =>
              left.record.sourceRevisionRef.localeCompare(right.record.sourceRevisionRef),
            );
          return ordered.slice(0, page?.limit ?? ordered.length);
        },
      })),
  };
  let enabled = true;
  const authorization: TdmsSourceAuthorization = {
    available: true,
    catalogue: async () => enabled
      ? scopes.map((scope: TdmsSourceScope) => ({ scope, permissionRevision: 'policy-1' }))
      : [],
    authorize: async (_actor, scope: TdmsSourceScope) => {
      if (!enabled) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
      return { scope, permissionRevision: 'policy-1' };
    },
    authorizeImport: async () => { throw new Error('UNEXPECTED_IMPORT'); },
  };
  const documents = {
    assertRead: jest.fn(async (_actor, id: string): Promise<void> => {
      if (id !== 'DV-exact') throw tdmsError('DOCUMENT_NOT_FOUND', 404);
    }),
  };
  return {
    memory,
    pages,
    documents,
    revoke: () => { enabled = false; },
    service: new TdmsSourceService(repository, authorization, {
      acquire: async () => { throw new Error('UNEXPECTED_FILE_ACQUISITION'); },
    }, documents),
  };
}

describe('TDMS P1 bounded catalogue without physical PG or business-read claims', () => {
  it('seeks and exact-version filters in SQL before LIMIT, with every identity parameter bound', async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const dialect = new PgDialect();
    const db = {
      execute: jest.fn(async (query: SQL) => {
        statements.push(dialect.sqlToQuery(query));
        return [];
      }),
    };
    const tx = new SqlTdmsTransaction(db as unknown as Pick<PostgresJsDatabase, 'execute'>);
    await tx.catalogue(nativeScope, {
      after: "TDMS-REV-0010' OR TRUE --",
      documentVersionId: "DV-exact' OR TRUE --",
      limit: 51,
    });
    const statement = statements[0]!;
    expect(statement.sql).toContain("jsonb_exists(v.data->'record'->'relatedDocumentVersionIds'");
    expect(statement.sql).toContain('h.source_revision_ref >');
    expect(statement.sql.indexOf('jsonb_exists')).toBeLessThan(statement.sql.indexOf('LIMIT'));
    expect(statement.sql).not.toContain('OR TRUE');
    expect(statement.sql).not.toContain('LIKE');
    expect(statement.params).toEqual([
      'tenant-a', 'TDMS', 'instance', 'narrow',
      "TDMS-REV-0010' OR TRUE --", "DV-exact' OR TRUE --", 51,
    ]);
  });

  it.each([0, 52, 1.5, Number.NaN])('rejects unbounded/invalid repository limit %s before SQL', async (limit: number) => {
    const db = { execute: jest.fn(async () => []) };
    const tx = new SqlTdmsTransaction(db as unknown as Pick<PostgresJsDatabase, 'execute'>);
    await expect(tx.catalogue(nativeScope, { limit })).rejects.toMatchObject({ code: 'TDMS_CATALOGUE_LIMIT_INVALID' });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('uses one global seek across two interleaved scopes without skipping later records', async () => {
    const other: TdmsSourceScope = { ...nativeScope, scopeId: 'second' };
    const rows: TdmsStoredRevision[] = Array.from({ length: 124 }, (_value: unknown, index: number) => ({
      scope: index % 2 ? other : nativeScope,
      record: revision(index + 1),
    }));
    const f = serviceFixture(rows, [nativeScope, other]);
    const found: string[] = [];
    let after: string | undefined;
    for (let index = 0; index < 3; index++) {
      const page = await f.service.catalogue(actor(), {}, after);
      found.push(...page.records.map((record) => record.sourceRevisionRef));
      after = page.nextAfter ?? undefined;
      expect(page.readPerformed).toBe(false);
    }
    expect(found).toEqual(rows.map((row: TdmsStoredRevision) => row.record.sourceRevisionRef));
    expect(new Set(found).size).toBe(124);
    expect(f.pages).toHaveLength(6);
    expect(f.pages.every((item) => item.page?.limit === 51)).toBe(true);
    expect(f.memory.state.receipts).toHaveLength(0);
  });

  it('selects an exact DV beyond an unrelated first page and retains missing-original metadata', async () => {
    const rows: TdmsStoredRevision[] = Array.from({ length: 70 }, (_value: unknown, index: number) => ({
      scope: nativeScope,
      record: revision(index + 1, index === 69 ? ['DV-exact'] : []),
    }));
    const f = serviceFixture(rows);
    const page = await f.service.catalogue(actor(), { documentVersionId: 'DV-exact' });
    expect(page.records.map((record) => record.sourceRevisionRef)).toEqual(['TDMS-REV-0070']);
    expect(page.hasMore).toBe(false);
    expect(page.nextAfter).toBeNull();
    expect(f.pages[0]?.page).toEqual({ documentVersionId: 'DV-exact', limit: 51 });
    expect(f.documents.assertRead).toHaveBeenCalledWith(expect.anything(), 'DV-exact');
    expect(page.records[0]).not.toHaveProperty('content');
    expect(page.records[0]).not.toHaveProperty('rawFields');
  });

  it('checks selected DV even with no matches and rejects permission drift before releasing rows', async () => {
    const f = serviceFixture([{ scope: nativeScope, record: revision(1, ['DV-exact']) }]);
    await expect(f.service.catalogue(actor(), { documentVersionId: 'DV-denied' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_NOT_FOUND' });
    expect(f.pages).toHaveLength(0);
    f.memory.beforeCommit = f.revoke;
    await expect(f.service.catalogue(actor(), {}))
      .rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
  });
});
