import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { dmSourceArtifact } from '@server/database/schema';
import { MiaodaHostedDocumentCatalog } from '@server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';

function fixture(rows: unknown[] = []) {
  const limit = jest.fn(async () => rows);
  const where = jest.fn((_condition: SQL) => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  const catalog = new MiaodaHostedDocumentCatalog({ select } as never);
  return { catalog, select, from, where, limit };
}
describe('inactive adapter exact internal catalog content lookup', () => {
  it.each([
    { sha256: 'A'.repeat(64), byteLength: 1 }, { sha256: 'a'.repeat(63), byteLength: 1 },
    { sha256: 'g'.repeat(64), byteLength: 1 }, { sha256: 'a'.repeat(64), byteLength: 0 },
    { sha256: 'a'.repeat(64), byteLength: -1 }, { sha256: 'a'.repeat(64), byteLength: 1.5 },
    { sha256: 'a'.repeat(64), byteLength: NaN }, { sha256: 'a'.repeat(64), byteLength: Infinity },
    { sha256: 'a'.repeat(64), byteLength: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects invalid content identity before SQL %p', async identity => {
    const f = fixture(); await expect(f.catalog.readSourceArtifactByContent(identity)).rejects.toMatchObject({ code: 'SOURCE_ARTIFACT_IDENTITY_INVALID' });
    expect(f.select).not.toHaveBeenCalled();
  });
  it('queries existing db with exact SHA AND positive length and limit one', async () => {
    const row = { sourceArtifactId: 'synthetic-candidate' }; const f = fixture([row]);
    expect(await f.catalog.readSourceArtifactByContent({ sha256: 'b'.repeat(64), byteLength: 321 })).toBe(row);
    expect(f.from).toHaveBeenCalledWith(dmSourceArtifact);
    const query = new PgDialect().sqlToQuery(f.where.mock.calls[0][0]);
    expect(query.params).toEqual(['b'.repeat(64), 321]);
    expect(query.sql).toMatch(/"sha256" = .* and .*"byte_length" = /u);
    expect(f.limit).toHaveBeenCalledWith(1); expect(f.select).toHaveBeenCalledTimes(1);
  });
  it('returns null for an absent or invisible exact content row without fallback', async () => {
    const f = fixture(); expect(await f.catalog.readSourceArtifactByContent({ sha256: 'b'.repeat(64), byteLength: 322 })).toBeNull();
    expect(f.select).toHaveBeenCalledTimes(1);
  });
  it('propagates existing SQL failure without another connection', async () => {
    const f = fixture(); const failure = new Error('synthetic-sql-denied'); f.limit.mockRejectedValueOnce(failure);
    await expect(f.catalog.readSourceArtifactByContent({ sha256: 'b'.repeat(64), byteLength: 321 })).rejects.toBe(failure);
    expect(f.select).toHaveBeenCalledTimes(1);
  });
});
