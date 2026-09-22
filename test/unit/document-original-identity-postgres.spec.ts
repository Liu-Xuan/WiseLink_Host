import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { MiaodaHostedDocumentCatalog, tenantFamilyIdentityPrefix } from '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';

const enabled = process.env.WL_DM_ORIGINAL_IDENTITY_LOCAL_PG === '1';
(enabled ? describe : describe.skip)('original identity isolated PostgreSQL projection', () => {
  const client = postgres({ host: '127.0.0.1', port: 55439, database: 'postgres', max: 1 });
  const queries: string[] = [];
  const catalog = new MiaodaHostedDocumentCatalog(drizzle(client, {
    logger: { logQuery(query: string) { queries.push(query); } },
  }) as never);
  const schema = `original_identity_fixture_${process.pid}`;
  beforeAll(async () => {
    await client.unsafe(`CREATE SCHEMA "${schema}"`);
    await client.unsafe(`SET search_path TO "${schema}"`);
    // Deliberately no metadata table or large extraction columns: this endpoint
    // must not depend on the full metadata read or a metadata revision subquery.
    await client.unsafe('CREATE TABLE dm_document_version (document_version_id text PRIMARY KEY, family_id text, source_artifact_id text, pdf_sha256 text, byte_length bigint)');
    await client.unsafe('CREATE TABLE dm_publication_family (family_id text PRIMARY KEY, canonical_identity_key text)');
    await client.unsafe('CREATE TABLE dm_source_artifact (source_artifact_id text PRIMARY KEY, sha256 text, byte_length bigint)');
    await client`INSERT INTO dm_publication_family VALUES ('F1', ${tenantFamilyIdentityPrefix('tenant-1') + 'fixture'}), ('F10', ${tenantFamilyIdentityPrefix('tenant-10') + 'fixture'})`;
    await client`INSERT INTO dm_source_artifact VALUES ('S1', ${'a'.repeat(64)}, 1234), ('S10', ${'b'.repeat(64)}, 99)`;
    await client`INSERT INTO dm_document_version VALUES ('V1', 'F1', 'S1', ${'a'.repeat(64)}, 1234), ('V10', 'F10', 'S10', ${'b'.repeat(64)}, 99)`;
  });
  afterAll(async () => {
    try { await client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await client.end(); }
  });
  it('reads only registered digest/length with exact version and tenant family binding', async () => {
    queries.length = 0;
    expect(await catalog.readOriginalRegistryIdentity('V1', 'tenant-1')).toEqual({
      version: { documentVersionId: 'V1', pdfSha256: 'a'.repeat(64), byteLength: 1234 },
      source: { sha256: 'a'.repeat(64), byteLength: 1234 },
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toMatch(/metadata|select max/i);
    expect(await catalog.readOriginalRegistryIdentity('V10', 'tenant-1')).toBeNull();
    expect(await catalog.readOriginalRegistryIdentity('V1', 'tenant-10')).toBeNull();
    expect(await catalog.readOriginalRegistryIdentity('missing', 'tenant-1')).toBeNull();
    await client`DELETE FROM dm_source_artifact WHERE source_artifact_id = 'S1'`;
    expect(await catalog.readOriginalRegistryIdentity('V1', 'tenant-1')).toBeNull();
    await expect(catalog.readOriginalRegistryIdentity('V1', '')).rejects.toThrow();
  });
});
