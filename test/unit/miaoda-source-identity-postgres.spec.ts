import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { MiaodaDocumentVersionSourceResolver } from '../../server/modules/work-item/miaoda-document-version-source.resolver';

const enabled = process.env.WL_SOURCE_IDENTITY_LOCAL_PG === '1';
(enabled ? describe : describe.skip)('source identity isolated PostgreSQL joins and RLS', () => {
  const client = postgres({ host: '127.0.0.1', port: 55441, database: 'postgres', max: 1 });
  const schema = `source_identity_fixture_${process.pid}`;
  const role = `source_identity_reader_${process.pid}`;
  const queries: string[] = [];
  const resolver = new MiaodaDocumentVersionSourceResolver(drizzle(client, {
    logger: { logQuery(query: string) { queries.push(query); } },
  }) as never);
  const tables = ['dm_document_version', 'dm_publication_family', 'dm_source_artifact', 'dm_acquisition', 'dm_ingress_preflight'];
  async function reader(actor = 'actor-1') {
    await client.unsafe(`SET ROLE "${role}"`);
    await client`SELECT set_config('fixture.actor', ${actor}, false)`;
  }
  beforeAll(async () => {
    await client.unsafe(`CREATE SCHEMA "${schema}"`);
    await client.unsafe(`SET search_path TO "${schema}"`);
    await client.unsafe(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    // Only identity and join columns exist: descriptors, acquisition payloads and
    // currentness table deliberately do not. This is not a production schema.
    await client.unsafe('CREATE TABLE dm_document_version (document_version_id text PRIMARY KEY, document_id text, family_id text, source_artifact_id text, acquisition_id text, lifecycle_status text, pdf_sha256 text, byte_length bigint, owner_id text)');
    await client.unsafe('CREATE TABLE dm_publication_family (family_id text PRIMARY KEY, owner_id text)');
    await client.unsafe('CREATE TABLE dm_source_artifact (source_artifact_id text PRIMARY KEY, readback_verified boolean, sha256 text, byte_length bigint, owner_id text)');
    await client.unsafe('CREATE TABLE dm_acquisition (acquisition_id text PRIMARY KEY, owner_id text)');
    await client.unsafe('CREATE TABLE dm_ingress_preflight (preflight_id text PRIMARY KEY, acquisition_id text, document_version_id text, status text, owner_id text)');
    for (const suffix of ['1', '2']) {
      const owner = `actor-${suffix}`;
      await client`INSERT INTO dm_publication_family VALUES (${`F${suffix}`}, ${owner})`;
      await client`INSERT INTO dm_source_artifact VALUES (${`S${suffix}`}, true, ${'a'.repeat(64)}, 1234, ${owner})`;
      await client`INSERT INTO dm_acquisition VALUES (${`A${suffix}`}, ${owner})`;
      await client`INSERT INTO dm_document_version VALUES (${`V${suffix}`}, ${`D${suffix}`}, ${`F${suffix}`}, ${`S${suffix}`}, ${`A${suffix}`}, 'COMMITTED_IMMUTABLE', ${'a'.repeat(64)}, 1234, ${owner})`;
      await client`INSERT INTO dm_ingress_preflight VALUES (${`P${suffix}`}, ${`A${suffix}`}, ${`V${suffix}`}, 'COMMITTED', ${owner})`;
    }
    await client.unsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    for (const table of tables) {
      await client.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await client.unsafe(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await client.unsafe(`CREATE POLICY reader ON ${table} FOR SELECT USING (owner_id = current_setting('fixture.actor', true))`);
      await client.unsafe(`GRANT SELECT ON ${table} TO "${role}"`);
    }
    await reader();
  });
  afterAll(async () => {
    try {
      await client.unsafe('RESET ROLE');
      await client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.unsafe(`DROP ROLE IF EXISTS "${role}"`);
    } finally { await client.end(); }
  });

  it('executes one eight-column query as a non-owner and enforces actor isolation', async () => {
    const [identity] = await client`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(identity).toEqual({ rolsuper: false, rolbypassrls: false });
    queries.length = 0;
    await expect(resolver.resolveIdentity('V1')).resolves.toEqual({ version: { documentId: 'D1', documentVersionId: 'V1' } });
    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toMatch(/currentness|descriptor|payload/);
    await expect(resolver.resolveIdentity('V2')).rejects.toThrow('DOCUMENT_VERSION_NOT_FOUND');
    await reader('actor-2');
    await expect(resolver.resolveIdentity('V1')).rejects.toThrow('DOCUMENT_VERSION_NOT_FOUND');
    await expect(resolver.resolveIdentity('V2')).resolves.toEqual({ version: { documentId: 'D2', documentVersionId: 'V2' } });
    await reader();
  });

  it.each(tables)('fails closed when %s registration is hidden by RLS', async table => {
    await client.unsafe('RESET ROLE');
    await client.unsafe(`UPDATE ${table} SET owner_id = 'hidden' WHERE owner_id = 'actor-1'`);
    try {
      await reader();
      await expect(resolver.resolveIdentity('V1')).rejects.toThrow('DOCUMENT_VERSION_NOT_FOUND');
    } finally {
      await client.unsafe('RESET ROLE');
      await client.unsafe(`UPDATE ${table} SET owner_id = 'actor-1' WHERE owner_id = 'hidden'`);
      await reader();
    }
  });

  it.each([
    ['acquisition_id', 'wrong-acquisition', 'A1'],
    ['document_version_id', 'wrong-version', 'V1'],
    ['status', 'PREPARED', 'COMMITTED'],
  ])('rejects a preflight with mismatched %s', async (column, wrong, original) => {
    await client.unsafe('RESET ROLE');
    await client.unsafe(`UPDATE dm_ingress_preflight SET ${column} = $1 WHERE preflight_id = 'P1'`, [wrong]);
    try {
      await reader();
      await expect(resolver.resolveIdentity('V1')).rejects.toThrow('DOCUMENT_VERSION_NOT_FOUND');
    } finally {
      await client.unsafe('RESET ROLE');
      await client.unsafe(`UPDATE dm_ingress_preflight SET ${column} = $1 WHERE preflight_id = 'P1'`, [original]);
      await reader();
    }
  });

  it('still rejects a source digest mismatch after a successful joined read', async () => {
    await client.unsafe('RESET ROLE');
    await client`UPDATE dm_source_artifact SET sha256 = 'different' WHERE source_artifact_id = 'S1'`;
    await reader();
    await expect(resolver.resolveIdentity('V1')).rejects.toThrow('DOCUMENT_VERSION_SOURCE_IDENTITY_INVALID');
  });
});
