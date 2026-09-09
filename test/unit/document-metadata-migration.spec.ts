import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const enabled = process.env.WL_DM_LIBRARY_LOCAL_PG === '1';
(enabled ? describe : describe.skip)(
  'metadata revision migration on isolated PostgreSQL',
  () => {
    const client = postgres({
      host: '127.0.0.1',
      port: 55439,
      database: 'postgres',
      max: 1,
      onnotice: () => {},
    });
    const fixtureSchema = `dm_metadata_migration_${process.pid}`;
    const original = {
      title: { status: 'NOT_FOUND', observations: [] },
      sourceSha256: 'a'.repeat(64),
    };
    let before: unknown;
    beforeAll(async () => {
      await client.unsafe(`CREATE SCHEMA "${fixtureSchema}"; SET search_path TO "${fixtureSchema}", public;
      CREATE TABLE dm_document_version (document_version_id varchar(96) PRIMARY KEY, original_filename text);
      CREATE TABLE dm_document_version_metadata (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_version_id varchar(96) NOT NULL UNIQUE REFERENCES dm_document_version(document_version_id), extracted_metadata jsonb NOT NULL);
      CREATE FUNCTION dm_reject_immutable_row_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'immutable metadata'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER dm_document_version_metadata_immutable BEFORE UPDATE OR DELETE ON dm_document_version_metadata
        FOR EACH ROW EXECUTE FUNCTION dm_reject_immutable_row_mutation();`);
      await client`INSERT INTO dm_document_version VALUES ('old-version', 'original.pdf')`;
      await client`INSERT INTO dm_document_version_metadata(document_version_id,extracted_metadata) VALUES ('old-version', ${JSON.stringify(original)})`;
      before =
        await client`SELECT id,document_version_id,extracted_metadata FROM dm_document_version_metadata`;
      await client.unsafe(
        await readFile(
          'migrations/0028_document_metadata_revision.sql',
          'utf8',
        ),
      );
    });
    afterAll(async () => {
      await client.unsafe(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await client.end();
    });
    it('preserves the existing observation and its immutable trigger, assigning revision one without a data UPDATE', async () => {
      expect(
        await client`SELECT id,document_version_id,extracted_metadata FROM dm_document_version_metadata`,
      ).toEqual(before);
      expect(
        (
          await client`SELECT metadata_revision,request_id FROM dm_document_version_metadata`
        )[0],
      ).toMatchObject({ metadata_revision: 1, request_id: null });
      await expect(
        client`UPDATE dm_document_version_metadata SET extracted_metadata='{}'`,
      ).rejects.toThrow('immutable metadata');
      await expect(
        client`DELETE FROM dm_document_version_metadata`,
      ).rejects.toThrow('immutable metadata');
    });
    it('allows another revision while enforcing revision/request uniqueness and retaining the source version', async () => {
      await client`INSERT INTO dm_document_version_metadata(document_version_id,metadata_revision,request_id,extracted_metadata) VALUES ('old-version',2,'correction-1','{}')`;
      await expect(
        client`INSERT INTO dm_document_version_metadata(document_version_id,metadata_revision,request_id,extracted_metadata) VALUES ('old-version',2,'correction-other','{}')`,
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        client`INSERT INTO dm_document_version_metadata(document_version_id,metadata_revision,request_id,extracted_metadata) VALUES ('old-version',3,'correction-1','{}')`,
      ).rejects.toMatchObject({ code: '23505' });
      expect(
        (await client`SELECT original_filename FROM dm_document_version`)[0]
          .original_filename,
      ).toBe('original.pdf');
      expect(
        (
          await client`SELECT count(*)::int AS count FROM dm_document_version_metadata`
        )[0].count,
      ).toBe(2);
    });
  },
);
